"use strict";
// Modulo video di Browserino: trova i flussi .m3u8/.mp4/.mp3 (rete + scraper della pagina),
// li apre in un player pulito e permette di scaricarli (anche solo l'audio in mp3).
const { net, ipcMain, dialog, BrowserWindow, app, shell } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const dl = require("./downloader");
const edition = require("./edition");

let guestSes, getWin, isAd;
const states = new Map();     // id scheda (webContents) -> { items, hidden, reqHdr }
const guests = new Map();    // id scheda -> webContents
let activeId = null;         // scheda in primo piano
const playerItems = new Map();
const hdrByWc = new Map();
const playerSessions = new WeakSet();
const learned = new Map();   // host -> variante di intestazioni che ha funzionato
let nextId = 1, nextJob = 1, notifyT = null;
const jobs = new Map(); // id -> { signal, file }

const MIN_FILE = 400e3;      // sotto i 400 KB di solito sono anteprime o pubblicità
const MIN_AUDIO = 150e3;
const AD_PATH = /(^|[\/_.-])(ads?|advert|adserver|preroll|vast|banner|promo)([\/_.-]|\d|$)/i;
const EXT_MEDIA = /\.(m3u8|mp4|m4v|webm|mov|mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i;
const EXT_AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i;
const DENY_HDR = /^(range|host|content-length|content-type|connection|accept-encoding|if-range|if-none-match|if-modified-since|te|upgrade-insecure-requests|sec-.*)$/i;

// ---- log di debug (pannello 🐞 e file video-debug.log nella cartella dati dell'app) ----
const logLines = [];
let logFile = null;
const p2 = n => String(n).padStart(2, "0");
function dbg(msg) {
  const t = new Date();
  const line = "[" + p2(t.getHours()) + ":" + p2(t.getMinutes()) + ":" + p2(t.getSeconds()) + "] " + msg;
  logLines.push(line); if (logLines.length > 800) logLines.shift();
  try { if (!logFile) logFile = path.join(app.getPath("userData"), "video-debug.log"); fs.appendFileSync(logFile, line + "\n"); } catch (_) {}
  const w = getWin && getWin();
  if (w && !w.isDestroyed()) w.webContents.send("dbg", line);
}

const hostOf = u => { try { return new URL(u).hostname; } catch (_) { return ""; } };
const keyOf = u => { try { const x = new URL(u); return x.host + x.pathname; } catch (_) { return u; } };
const S = id => { let st = states.get(id); if (!st) { st = { id, items: new Map(), hidden: new Set(), reqHdr: new Map() }; states.set(id, st); } return st; };
const pageUrl = id => { const w = guests.get(id); return w && !w.isDestroyed() ? w.getURL() : ""; };
const pageTitle = id => { const w = guests.get(id); return w && !w.isDestroyed() ? w.getTitle() : ""; };
const allItems = () => { const a = []; states.forEach(st => st.items.forEach(i => a.push(i))); return a; };

// ---- rete: apre un URL con le intestazioni giuste; se il server risponde 403 prova varianti ----
function rawOpen(url, headers) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, session: guestSes, useSessionCookies: true });
    for (const [k, v] of Object.entries(headers || {})) { try { req.setHeader(k, v); } catch (_) {} }
    req.on("response", res => resolve({ status: res.statusCode, headers: res.headers, res, abort: () => { try { req.abort(); } catch (_) {} } }));
    req.on("error", reject);
    req.end();
  });
}
function variantsOf(h) {
  const ref = h.Referer || h.referer || "";
  let og = ""; try { og = new URL(ref).origin; } catch (_) {}
  const noOrigin = !h.Origin && !h.origin;
  return [
    h,
    Object.assign({}, h, { Range: "bytes=0-" }),
    og && noOrigin ? Object.assign({}, h, { Origin: og }) : null,
    og && noOrigin ? Object.assign({}, h, { Origin: og, Range: "bytes=0-" }) : null
  ].filter(Boolean);
}
// ---- link a tempo: tengo l'ultimo link con scadenza usato dalla pagina per ogni cartella del CDN ----
const lastSearch = new Map(); // host+cartella -> { search, exp }
const dirOf = pn => pn.slice(0, pn.lastIndexOf("/") + 1);
function observe(d) {
  const ex = dl.expiryOf(d.url);
  if (ex == null) return;
  const u = new URL(d.url), k = u.host + dirOf(u.pathname), old = lastSearch.get(k);
  if (old && old.search === u.search) return;
  if (old && old.exp && ex < old.exp) return; // tengo il più recente
  lastSearch.set(k, { search: u.search, exp: ex });
  if (lastSearch.size > 200) lastSearch.delete(lastSearch.keys().next().value);
  dbg("🔑 la pagina usa un link con scadenza alle " + dl.hhmmss(ex) + " su " + u.host);
}
const tokens = {
  latest(url) { try { const u = new URL(url), o = lastSearch.get(u.host + dirOf(u.pathname)); return o ? o.search : null; } catch (_) { return null; } },
  async wait(url, ms, accept) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = this.latest(url);
      if (s && accept(s)) return s;
      await new Promise(r => setTimeout(r, 1000));
    }
    return null;
  }
};

const noLadder = new Map(); // host -> fino a quando non riprovo le varianti (ms)
async function open(url, headers) {
  const host = hostOf(url), vs = variantsOf(headers || {});
  const start = Math.min(learned.get(host) || 0, vs.length - 1);
  let r = await rawOpen(url, vs[start]);
  if ((r.status !== 403 && r.status !== 401) || (noLadder.get(host) || 0) > Date.now() || dl.isExpired(url)) return r;
  dbg("↪ " + r.status + " su " + host + ": provo altre combinazioni di intestazioni");
  for (let i = 0; i < vs.length; i++) {
    if (i === start) continue;
    r.abort();
    r = await rawOpen(url, vs[i]);
    if (r.status < 400) {
      learned.set(host, i);
      dbg("✔ su " + host + " funziona con: " + (Object.keys(vs[i]).filter(k => !(k in vs[0])).join(", ") || "intestazioni base"));
      return r;
    }
  }
  noLadder.set(host, Date.now() + 20000);
  dbg("✖ nessuna combinazione funziona per " + host + " (per 20 s non riprovo, per non peggiorare)");
  return r;
}
function hdrs(it, extra) {
  const h = Object.assign({ Accept: "*/*" }, it.reqHeaders || {});
  if (!h.Referer && it.ref) h.Referer = it.ref;
  return Object.assign(h, extra || {});
}

// ---- elenco ----
function notify() {
  clearTimeout(notifyT);
  notifyT = setTimeout(() => {
    const win = getWin();
    if (!win || win.isDestroyed()) return;
    win.webContents.send("videos", list(activeId));
  }, 120);
}
function list(id) {
  const st = states.get(id);
  if (!st) return [];
  return [...st.items.values()].filter(i => i.ready)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "hls" ? -1 : b.kind === "hls" ? 1 : 0) || (b.size - a.size))
    .map(i => ({
      id: i.id, kind: i.kind, label: i.label, host: hostOf(i.url), size: i.size, drm: i.drm || "", live: !!i.live, src: i.src,
      isMp3: i.kind === "audio" && /\.mp3(\?|#|$)/i.test(i.url)
    }));
}
function hideKey(st, k) { st.hidden.add(k); if (st.items.delete(k)) notify(); }
function reset(id) { const st = S(id); st.items.clear(); st.hidden.clear(); st.reqHdr.clear(); notify(); }

function fmtDur(s) { s = Math.round(s); if (s < 60) return s + " s"; const m = Math.floor(s / 60); return m >= 60 ? Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0") : m + " min"; }
function fmtSize(n) { return n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + " MB"; }

async function probe(st, it, key) {
  if (it.kind === "hls") {
    const p = await dl.probeHls(open, it.url, hdrs(it));
    if (p.type === "master") {
      p.variants.forEach(v => { hideKey(st, keyOf(v.url)); if (v.audio) hideKey(st, keyOf(v.audio)); });
      const hs = [...new Set(p.variants.map(v => v.height).filter(Boolean))];
      it.label = "HLS · " + (hs.length ? hs[0] + "p · " : "") + p.variants.length + " qualità";
    } else {
      const m = p.media;
      m.segs.forEach(s => hideKey(st, keyOf(s.url)));
      if (m.map) hideKey(st, keyOf(m.map.url));
      it.drm = m.drm || ""; it.live = m.live;
      it.label = "HLS · " + (m.live ? "diretta" : m.drm ? "protetto (DRM)" : fmtDur(m.duration));
    }
  } else {
    const r = await open(it.url, hdrs(it, { Range: "bytes=0-1" }));
    r.abort();
    if (r.status !== 200 && r.status !== 206) throw new Error("HTTP " + r.status);
    const ct = dl.h1(r.headers, "content-type");
    if (!/video|audio|mp4|mpeg|octet-stream|webm|ogg/i.test(ct)) throw new Error("non è un media");
    const cr = /\/(\d+)\s*$/.exec(dl.h1(r.headers, "content-range"));
    const size = cr ? +cr[1] : parseInt(dl.h1(r.headers, "content-length"), 10) || 0;
    if (size) it.size = Math.max(it.size, size);
    if (it.size && it.size < (it.kind === "audio" ? MIN_AUDIO : MIN_FILE)) throw new Error("troppo piccolo");
    const m = /\.([a-z0-9]{2,4})(\?|#|$)/i.exec(new URL(it.url).pathname + "#");
    const ext = (m ? m[1] : it.kind === "audio" ? "audio" : "mp4").toUpperCase();
    it.label = (it.kind === "audio" ? "🎵 " : "") + ext + (it.size ? " · " + fmtSize(it.size) : "");
  }
  if (!st.items.has(key)) return; // nel frattempo nascosto
  it.ready = true;
  dbg("✔ pronto: " + it.label + " · " + it.url);
  notify();
}

function add(wcId, url, kind, ctx) {
  ctx = ctx || {};
  const st = S(wcId), key = keyOf(url);
  if (st.hidden.has(key) || isAd(hostOf(url)) || AD_PATH.test(new URL(url).pathname)) return;
  if (kind === "file" && ctx.size && ctx.size < MIN_FILE) return;
  if (kind === "audio" && ctx.size && ctx.size < MIN_AUDIO) return;
  const old = st.items.get(key);
  if (old) {
    old.url = url; if (st.reqHdr.has(key)) old.reqHeaders = st.reqHdr.get(key);
    if ((ctx.size || 0) > old.size) {
      old.size = ctx.size;
      if (old.ready && old.kind !== "hls") old.label = old.label.replace(/ · .*$/, "") + " · " + fmtSize(old.size);
      notify();
    }
    return;
  }
  const it = {
    id: nextId++, wcId, kind, url, ref: ctx.ref || pageUrl(wcId), reqHeaders: st.reqHdr.get(key) || null,
    src: ctx.src || "rete", size: ctx.size || 0, label: "", ready: false, drm: "", live: false
  };
  st.items.set(key, it);
  dbg("🎬 trovato " + kind + " (" + it.src + ") " + url);
  probe(st, it, key).catch(e => { dbg("✖ scartato (" + (e && e.message) + ") " + url); if (st.items.get(key) === it) { st.items.delete(key); notify(); } });
}

function sniff(d) {
  if (d.statusCode >= 400) return;
  const wcId = d.webContents ? d.webContents.id : d.webContentsId;
  if (wcId == null) return;
  if (!["media", "xhr", "other", "object"].includes(d.resourceType)) return;
  const ct = dl.h1(d.responseHeaders, "content-type");
  let p = ""; try { p = new URL(d.url).pathname; } catch (_) { return; }
  let kind = null;
  if (/\.m3u8$/i.test(p) || /mpegurl/i.test(ct)) kind = "hls";
  else if (/\.(mp4|m4v|webm|mov)$/i.test(p) || /^video\/(mp4|webm|x-m4v|quicktime)/i.test(ct)) kind = "file";
  else if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i.test(p) || /^audio\/(mpeg|mp3|mp4|x-m4a|aac|ogg|wav|x-wav|flac|opus)/i.test(ct)) kind = "audio";
  if (!kind) return;
  const cr = /\/(\d+)\s*$/.exec(dl.h1(d.responseHeaders, "content-range"));
  const size = cr ? +cr[1] : (d.statusCode === 200 ? parseInt(dl.h1(d.responseHeaders, "content-length"), 10) || 0 : 0);
  add(wcId, d.url, kind, { size, ref: /^https?:/.test(d.referrer || "") ? d.referrer : pageUrl(wcId) });
}

function captureHeaders(d) {
  let p = ""; try { p = new URL(d.url).pathname; } catch (_) { return; }
  if ((d.webContents ? d.webContents.id : d.webContentsId) != null) { try { observe(d); } catch (_) {} }
  if (!EXT_MEDIA.test(p + "#")) return;
  const wcId = d.webContents ? d.webContents.id : d.webContentsId;
  if (wcId == null) return;
  const st = S(wcId), h = {};
  for (const [k, v] of Object.entries(d.requestHeaders || {})) if (!DENY_HDR.test(k)) h[k] = v;
  st.reqHdr.set(keyOf(d.url), h);
  if (st.reqHdr.size > 400) st.reqHdr.delete(st.reqHdr.keys().next().value);
}

function addScraped(wcId, urls) {
  (urls || []).slice(0, 40).forEach(u => {
    if (typeof u !== "string" || !/^https?:/i.test(u)) return;
    try { add(wcId, u, /\.m3u8(\?|#|$)/i.test(u) ? "hls" : EXT_AUDIO.test(u) ? "audio" : "file", { src: "pagina" }); } catch (_) {}
  });
}

// ---- player ----
function ensurePlayerSession(ses) {
  if (playerSessions.has(ses)) return;
  playerSessions.add(ses);
  ses.webRequest.onBeforeSendHeaders((d, cb) => {
    const id = d.webContents ? d.webContents.id : d.webContentsId;
    const c = hdrByWc.get(id), h = d.requestHeaders;
    if (c && /^https?:/.test(d.url)) {
      if (c.Referer) h["Referer"] = c.Referer;
      if (c.Origin) h["Origin"] = c.Origin;
      else if (c.Referer) { try { h["Origin"] = new URL(c.Referer).origin; } catch (_) {} }
      if (hostOf(d.url) === c.__host) { if (c["User-Agent"]) h["User-Agent"] = c["User-Agent"]; if (c.Cookie) h["Cookie"] = c.Cookie; }
    }
    cb({ requestHeaders: h });
  });
}

function niceTitle(it) {
  const t = (it.title || "").replace(/\s*[-–|·].*$/, "").trim();
  return t || hostOf(it.url) || "video";
}

function openPlayer(it) {
  const w = new BrowserWindow({
    width: 1100, height: 660, backgroundColor: "#000", autoHideMenuBar: true, title: "Browserino · Player",
    webPreferences: {
      preload: path.join(__dirname, "player-preload.js"), partition: "browserino-player",
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: false,
      autoplayPolicy: "no-user-gesture-required"
    }
  });
  const wc = w.webContents, id = wc.id;
  ensurePlayerSession(wc.session);
  hdrByWc.set(id, Object.assign({}, it.reqHeaders || {}, { Referer: (it.reqHeaders && it.reqHeaders.Referer) || it.ref, __host: hostOf(it.url) }));
  playerItems.set(id, it);
  w.on("closed", () => { hdrByWc.delete(id); playerItems.delete(id); });
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", e => e.preventDefault());
  w.loadFile(path.join(__dirname, "player.html"), { query: { u: it.url, k: it.kind === "audio" ? "file" : it.kind, t: it.title || "" } });
}

// ---- download ----
const safe = s => String(s).replace(/[<>:"\/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "video";

async function startDownload(it, level, sender, mode) {
  if (!it) return { error: "Video non più disponibile: riaprilo dalla pagina." };
  if (it.drm) return { error: "Protetto da DRM (" + it.drm + "): non lo posso scaricare." };
  if (it.live) return { error: "È una diretta: non è un file scaricabile." };
  const mp3 = mode === "mp3";
  const owner = BrowserWindow.fromWebContents(sender) || getWin();
  const m = /\.(mp4|webm|m4v|mov|mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|#|$)/i.exec(new URL(it.url).pathname + "#");
  const ext = mp3 ? "mp3" : it.kind === "hls" ? "mp4" : (m ? m[1].toLowerCase() : it.kind === "audio" ? "mp3" : "mp4");
  const r = await dialog.showSaveDialog(owner, {
    defaultPath: path.join(app.getPath("downloads"), safe(it.title || hostOf(it.url)) + "." + ext),
    filters: [{ name: mp3 ? "Audio MP3" : it.kind === "audio" ? "Audio" : "Video", extensions: [ext] }]
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  const id = nextJob++, name = path.basename(r.filePath);
  const signal = { aborted: false, paused: false, aborts: new Set() };
  jobs.set(id, { signal, file: r.filePath });
  const send = x => { if (!sender.isDestroyed()) sender.send("vid:dl", Object.assign({ id, name }, x)); };
  const ex = dl.expiryOf(it.url), left = ex ? Math.round((ex - Date.now()) / 1000) : null;
  send({ pct: 0, text: edition.demo ? "DEMO: salvo l'" + Math.round(edition.fraction * 100) + "% del video" : left != null && left < 900 ? "⚠ link a tempo (" + Math.max(left, 0) + " s): lascia il video in riproduzione nella scheda" : "parto" });
  if (left != null) dbg("⏱ il link scade " + (left > 0 ? "tra " + left + " s" : "già " + (-left) + " s fa") + " (alle " + dl.hhmmss(ex) + "): se serve, ne prendo uno nuovo dalla pagina");
  dbg("⬇ download #" + id + " " + (mp3 ? "MP3" : it.kind) + " → " + r.filePath + "\n    sorgente: " + it.url + "\n    pagina: " + (it.ref || "-") + "\n    intestazioni: " + JSON.stringify(dl.maskH(hdrs(it))));
  (async () => {
    try {
      const o = { open, url: it.url, headers: hdrs(it), outPath: r.filePath, onProgress: send, fraction: edition.fraction, signal };
      let res;
      if (mp3) res = await dl.downloadAudio(Object.assign(o, { tokens, kind: it.kind, pick: level || null, tmpBase: path.join(os.tmpdir(), "browserino-" + Date.now() + "-" + id) }));
      else if (it.kind === "hls") res = await dl.downloadHls(Object.assign(o, { tokens, pick: level || null }));
      else res = await dl.downloadDirect(o);
      dbg("✅ download #" + id + " finito: " + res.file + (res.note ? " · " + res.note : ""));
      const jb = jobs.get(id); if (jb) jb.file = res.file;
      send({ done: true, pct: 100, file: res.file, name: path.basename(res.file), note: res.note });
      shell.showItemInFolder(res.file);
    } catch (e) {
      if (signal.aborted) { dbg("⛔ download #" + id + " annullato da te"); send({ canceled: true }); }
      else { dbg("❌ download #" + id + " fallito: " + (e.message || e)); send({ error: (e.message || String(e)) + " (vedi 🐞 Log)" }); }
    }
  })();
  return { started: true, id };
}

function init(opts) {
  guestSes = opts.guestSes; getWin = opts.getWin; isAd = opts.isAd;
  dl.setLogger(dbg);
  try { logFile = path.join(app.getPath("userData"), "video-debug.log"); fs.writeFileSync(logFile, ""); } catch (_) {}
  ipcMain.handle("dbg:get", () => logLines.slice(-400).join("\n"));
  ipcMain.handle("dbg:open", () => { if (logFile) shell.showItemInFolder(logFile); return logFile; });
  guestSes.webRequest.onBeforeSendHeaders((d, cb) => { try { captureHeaders(d); } catch (_) {} cb({}); });
  guestSes.webRequest.onHeadersReceived((d, cb) => { try { sniff(d); } catch (_) {} cb({}); });
  const byId = id => allItems().find(x => x.id === id);
  ipcMain.handle("vid:list", () => list(activeId));
  ipcMain.handle("vid:active", (_e, id) => { activeId = id == null ? null : id; clearTimeout(notifyT); const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send("videos", list(activeId)); });
  ipcMain.handle("vid:play", (_e, id) => {
    const it = byId(id);
    if (it) openPlayer(Object.assign({}, it, { title: niceTitle({ title: pageTitle(it.wcId), url: it.url }) }));
  });
  ipcMain.handle("vid:dl", (e, id, mode) => {
    const it = byId(id);
    return startDownload(it && Object.assign({}, it, { title: pageTitle(it.wcId) }), null, e.sender, mode);
  });
  // pausa / riprendi / annulla / mostra nella cartella, per ogni download
  ipcMain.handle("vid:ctl", (_e, id, action) => {
    const j = jobs.get(id); if (!j) return false;
    if (action === "pause") { j.signal.paused = true; dbg("⏸ download #" + id + " in pausa"); }
    else if (action === "resume") { j.signal.paused = false; dbg("▶ download #" + id + " riparte"); }
    else if (action === "cancel") {
      j.signal.aborted = true; j.signal.paused = false;
      j.signal.aborts.forEach(f => { try { f(); } catch (_) {} });
    }
    else if (action === "show") { if (j.file) shell.showItemInFolder(j.file); }
    else if (action === "remove") jobs.delete(id);
    return true;
  });
  ipcMain.handle("vid:dl-player", (e, level, mode) => startDownload(playerItems.get(e.sender.id), level, e.sender, mode));
}

function onGuest(wc) {
  const id = wc.id;
  guests.set(id, wc);
  wc.on("did-navigate", () => reset(id));
  wc.on("destroyed", () => { guests.delete(id); states.delete(id); if (activeId === id) activeId = null; });
}

module.exports = { init, onGuest, addScraped, _open: open };
