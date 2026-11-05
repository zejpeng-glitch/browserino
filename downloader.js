"use strict";
// Download di video: file diretti (mp4/webm) e playlist HLS (m3u8).
// Non dipende da Electron: riceve una funzione open(url, headers) -> {status, headers, res, abort}.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const abs = (u, base) => new URL(u, base).href;
const h1 = (h, n) => {
  if (!h) return "";
  for (const k of Object.keys(h)) if (k.toLowerCase() === n) { const v = h[k]; return Array.isArray(v) ? v[0] : String(v); }
  return "";
};

function parseAttrs(s) {
  const o = {}, re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(s))) o[m[1]] = m[2].replace(/^"|"$/g, "");
  return o;
}

const isMaster = text => /#EXT-X-STREAM-INF/.test(text);

function parseMaster(text, base) {
  const L = text.split(/\r?\n/).map(x => x.trim()), variants = [], audio = {};
  for (const l of L) {
    if (!l.startsWith("#EXT-X-MEDIA:")) continue;
    const a = parseAttrs(l.slice(13));
    if (a.TYPE === "AUDIO" && a.URI) (audio[a["GROUP-ID"]] = audio[a["GROUP-ID"]] || []).push({ url: abs(a.URI, base), def: a.DEFAULT === "YES" });
  }
  for (let i = 0; i < L.length; i++) {
    if (!L[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const a = parseAttrs(L[i].slice(18));
    let j = i + 1;
    while (j < L.length && (!L[j] || L[j].startsWith("#"))) j++;
    if (j >= L.length) break;
    const grp = a.AUDIO && audio[a.AUDIO];
    const res = a.RESOLUTION || "";
    variants.push({
      url: abs(L[j], base), bandwidth: +a.BANDWIDTH || 0, res, height: +(res.split("x")[1]) || 0,
      audio: grp ? (grp.find(x => x.def) || grp[0]).url : null
    });
  }
  return variants.sort((x, y) => (y.height - x.height) || (y.bandwidth - x.bandwidth));
}

function parseMedia(text, base) {
  if (/#EXT-X-BYTERANGE/.test(text)) throw new Error("playlist con BYTERANGE: non supportata");
  let seq = 0, key = null, map = null, drm = null, duration = 0, dur = 0;
  const segs = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("#EXT-X-MEDIA-SEQUENCE:")) seq = parseInt(l.split(":")[1], 10) || 0;
    else if (l.startsWith("#EXTINF:")) dur = parseFloat(l.slice(8)) || 0;
    else if (l.startsWith("#EXT-X-KEY:")) {
      const a = parseAttrs(l.slice(11));
      if (a.METHOD === "NONE") key = null;
      else if (a.METHOD === "AES-128" && (!a.KEYFORMAT || a.KEYFORMAT === "identity")) key = { uri: abs(a.URI, base), iv: a.IV || null };
      else drm = a.METHOD + (a.KEYFORMAT ? " / " + a.KEYFORMAT : "");
    } else if (l.startsWith("#EXT-X-MAP:")) {
      const a = parseAttrs(l.slice(11));
      map = { url: abs(a.URI, base) };
    } else if (l[0] !== "#") {
      segs.push({ url: abs(l, base), key, seq: seq++ });
      duration += dur; dur = 0;
    }
  }
  return { segs, map, drm, duration, live: !/#EXT-X-ENDLIST/.test(text) };
}

async function readAll(res, limit) {
  const ch = []; let n = 0;
  for await (const c of res) { n += c.length; if (n > limit) throw new Error("risposta troppo grande"); ch.push(c); }
  return Buffer.concat(ch);
}
// ---- log di debug ----
let LOG = () => {};
const setLogger = f => { LOG = typeof f === "function" ? f : () => {}; };
const SHOW_RESP = ["server", "content-type", "content-length", "www-authenticate", "retry-after", "x-cache", "cf-ray", "via", "x-amz-cf-id", "x-error", "x-reason", "age", "date", "expires"];
function maskH(h) {
  const o = {};
  for (const [k, v] of Object.entries(h || {})) o[k] = /^(cookie|authorization)$/i.test(k) ? "(nascosto, " + String(v).length + " car.)" : String(v).slice(0, 160);
  return o;
}
async function httpErr(r, url, headers, what) {
  let body = "";
  try { const ch = []; let n = 0; for await (const c of r.res) { ch.push(c); n += c.length; if (n > 400) break; } body = Buffer.concat(ch).toString("utf8").slice(0, 300).replace(/\s+/g, " "); } catch (_) {}
  try { r.abort && r.abort(); } catch (_) {}
  const rh = {};
  for (const k of SHOW_RESP) { const v = h1(r.headers, k); if (v) rh[k] = v; }
  LOG("✖ HTTP " + r.status + (what ? " · " + what : "") + "\n    url: " + url + "\n    inviato: " + JSON.stringify(maskH(headers)) + "\n    risposta: " + JSON.stringify(rh) + (body ? "\n    corpo: " + body : ""));
  const e = new Error("HTTP " + r.status); e.status = r.status; e.url = url;
  return e;
}

async function getBuf(open, url, headers, limit = 400e6, what = "", meter = null) {
  const t0 = Date.now();
  const r = await open(url, headers);
  const t1 = Date.now();
  if (r.status >= 400) throw await httpErr(r, url, headers, what);
  const b = await readAll(r.res, limit);
  if (meter) { meter.ttfb += t1 - t0; meter.body += Date.now() - t1; meter.bytes += b.length; meter.n++; }
  return b;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- link a tempo: molti CDN mettono la scadenza nell'indirizzo (e=, exp=, expires=...) ----
function expiryOf(url) {
  try {
    const q = new URL(url).searchParams;
    for (const k of ["e", "exp", "expires", "expiry", "expire", "Expires"]) {
      const v = q.get(k);
      if (v && /^\d{9,13}$/.test(v)) { const n = +v; return n > 1e12 ? n : n * 1000; }
    }
  } catch (_) {}
  return null;
}
const isExpired = url => { const x = expiryOf(url); return x != null && x < Date.now() - 1500; };
const withSearch = (url, search) => { const u = new URL(url); u.search = search; return u.href; };
const hhmmss = ms => { const d = new Date(ms), p = n => String(n).padStart(2, "0"); return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()); };
// st.conc: numero di richieste in parallelo, si abbassa a 2 se il server comincia a rifiutare
const NETERR = /ERR_(NETWORK_CHANGED|INTERNET_DISCONNECTED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_ABORTED|HTTP2_PROTOCOL_ERROR|TIMED_OUT|EMPTY_RESPONSE|NAME_NOT_RESOLVED)|socket hang up|ECONNRESET|ETIMEDOUT|EPIPE/;
async function retry(fn, n, st) {
  let err, extra = 0;
  for (let i = 0; i < n + extra; i++) {
    if (st && st.signal && st.signal.aborted) throw new Error("annullato");
    try { return await fn(); } catch (e) {
      err = e;
      if (st && st.signal && st.signal.aborted) throw new Error("annullato");
      if (e.status === 404 || e.status === 410) break;
      const expired = e.url && isExpired(e.url);
      if (expired) break; // inutile riprovare: serve un link nuovo
      const net = !e.status && NETERR.test(e.message || "");
      if (net) {
        // la rete ha balbettato (cambio cella 5G, reset): più tentativi e attese più lunghe; se è il server che chiude, meno richieste insieme
        extra = 5;
        if (/HTTP2_PROTOCOL_ERROR|CONNECTION_RESET/.test(e.message) && st && st.conc > 4) { st.conc = Math.max(4, st.conc - 2); LOG("⚠ il server chiude le connessioni: scendo a " + st.conc + " richieste alla volta"); }
        if (i < n + extra - 1) { LOG("↻ riprovo (" + (i + 2) + "/" + (n + extra) + ") dopo: " + e.message); await sleep(Math.min(1500 * (i + 1), 8000)); }
        continue;
      }
      const hard = e.status === 403 || e.status === 429 || e.status >= 500;
      const lim = e.status === 403 ? 4 : 2;
      if (hard && st && st.conc > lim) { st.conc = lim; LOG("⚠ il server rifiuta: scendo a " + lim + " richieste alla volta"); }
      if (i < n + extra - 1) { LOG("↻ riprovo (" + (i + 2) + "/" + (n + extra) + ") dopo: " + e.message); await sleep(hard ? 1500 * (i + 1) : 400 * (i + 1)); }
    }
  }
  throw err;
}

async function probeHls(open, url, headers) {
  const text = (await getBuf(open, url, headers, 4e6)).toString("utf8");
  if (!/^\s*#EXTM3U/.test(text)) throw new Error("non è una playlist HLS");
  if (isMaster(text)) return { type: "master", variants: parseMaster(text, url) };
  return { type: "media", media: parseMedia(text, url) };
}

let ffCache;
function findFfmpeg() {
  if (ffCache !== undefined) return ffCache;
  const home = os.homedir();
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const c = [process.env.FFMPEG_PATH, "ffmpeg", path.join(home, "Downloads", "YT-DLP", exe),
    path.join(__dirname, exe), path.join(__dirname, "..", exe),
    // le app del Mac non vedono il PATH di Homebrew
    "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/local/bin/ffmpeg"].filter(Boolean);
  ffCache = null;
  for (const x of c) {
    try { if (spawnSync(x, ["-version"], { timeout: 5000 }).status === 0) { ffCache = x; break; } } catch (_) {}
  }
  return ffCache;
}

function runFfmpeg(ff, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ff, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", d => { err += d; });
    p.on("error", reject);
    p.on("close", code => code === 0 ? resolve() : reject(new Error("ffmpeg: " + err.trim().split("\n").pop())));
  });
}

// durata di un file in secondi (letta da ffmpeg), null se non la trovo
function durationOf(ff, file) {
  try {
    const r = spawnSync(ff, ["-hide_banner", "-i", file], { encoding: "utf8", timeout: 20000, windowsHide: true });
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec((r.stderr || "") + (r.stdout || ""));
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null;
  } catch (_) { return null; }
}
const demoNote = f => "Versione demo: salvato l'" + Math.round(f * 100) + "% del video. La versione Pro lo scarica intero.";
const seqIv = n => { const b = Buffer.alloc(16); b.writeUInt32BE(n >>> 0, 12); return b; };
const rm = f => { try { fs.unlinkSync(f); } catch (_) {} };

// pick: URL della playlist di qualità scelta (se url è una master). Ritorna {file, note}
// audioOnly: se esiste una traccia audio separata scarica solo quella, altrimenti la qualità più leggera
// raw: non unire con ffmpeg, restituisci il file grezzo (.raw.ts / .raw.mp4)
async function downloadHls({ open, url, headers, outPath, pick, onProgress = () => {}, ffmpeg, concurrency = 6, signal, audioOnly = false, raw = false, tokens = null, fraction = null }) {
  if (tokens && isExpired(url)) {
    let ns = tokens.latest(url);
    if (!ns || !(expiryOf(withSearch(url, ns)) > Date.now())) {
      LOG("⏳ il link di partenza è scaduto: aspetto un link nuovo dalla pagina (tieni il video in riproduzione nella scheda)");
      onProgress({ pct: -1, text: "⏳ link scaduto: tieni il video in riproduzione nella scheda" });
      ns = await tokens.wait(url, 90000, x => !!x && expiryOf(withSearch(url, x)) > Date.now());
    }
    if (ns) { LOG("🔑 partenza con un link nuovo dalla pagina"); if (pick) { const oldPick = pick; try { pick = withSearch(oldPick, ns); } catch (_) {} } url = withSearch(url, ns); }
  }
  let p = await probeHls(open, url, headers);
  let audioUrl = null, mediaUrl = url;
  if (p.type === "master") {
    if (!p.variants.length) throw new Error("playlist senza qualità");
    const samePath = (a, b) => { try { return new URL(a).pathname === new URL(b).pathname; } catch (_) { return false; } };
    let v = p.variants.find(x => x.url === pick) || (pick && p.variants.find(x => samePath(x.url, pick)));
    if (!v && audioOnly) v = p.variants.find(x => x.audio) || p.variants[p.variants.length - 1];
    if (!v) v = p.variants[0];
    mediaUrl = v.url; audioUrl = v.audio;
    p = await probeHls(open, mediaUrl, headers);
    if (p.type !== "media") throw new Error("playlist annidata: non supportata");
  }
  let vm = p.media;
  let am = null;
  if (audioUrl) {
    const ap = await probeHls(open, audioUrl, headers);
    if (ap.type === "media" && !ap.media.drm && !ap.media.live) am = ap.media;
  }
  if (audioOnly && am) { vm = am; am = null; }
  if (vm.drm) throw new Error("protetto da DRM (" + vm.drm + "): non lo scarico");
  if (vm.live) throw new Error("è una diretta, non un video completo");
  let cutNote = "";
  if (fraction && fraction > 0 && fraction < 1) {
    // demo: tengo solo la prima parte dei segmenti (video e audio insieme)
    const keep = a => Math.max(1, Math.floor(a.length * fraction));
    vm = Object.assign({}, vm, { segs: vm.segs.slice(0, keep(vm.segs)) });
    if (am) am = Object.assign({}, am, { segs: am.segs.slice(0, keep(am.segs)) });
    cutNote = demoNote(fraction);
  }
  LOG("HLS: " + mediaUrl + " · " + vm.segs.length + " segmenti" + (vm.segs.some(s => s.key) ? " · cifrato AES-128" : "") + (vm.map ? " · fMP4" : "") + (am ? " · audio separato" : "") + (vm.segs[0] ? "\n    primo segmento: " + vm.segs[0].url : ""));
  const total = vm.segs.length + (am ? am.segs.length : 0);
  let done = 0, lastT = 0;
  const tick = () => {
    done++;
    const now = Date.now();
    if (now - lastT > 250 || done === total) { lastT = now; onProgress({ pct: Math.round(done * 100 / total), text: "scarico " + done + "/" + total }); }
  };

  const st = { conc: concurrency, search: null, waiting: null, signal };
  const BOOST = 16; // con il boost acceso: fino a 16 richieste alla volta (se il server comincia a rifiutare scendo da solo)
  if (signal) signal.setBoost = on => {
    st.conc = on ? BOOST : Math.min(st.conc, concurrency);
    LOG(on ? "⚡ boost acceso: fino a " + BOOST + " richieste alla volta" : "⚡ boost spento: " + st.conc + " richieste alla volta");
  };
  const urlOf = u => (st.search ? withSearch(u, st.search) : u);
  const sameQ = (u, ns) => new URL(urlOf(u)).search === ns;
  const accept = (u, ns) => {
    if (!ns || sameQ(u, ns)) return false;
    const a = expiryOf(withSearch(u, ns)), b = expiryOf(urlOf(u));
    return a == null || b == null || a > b;
  };
  // quando il link scade chiede alla pagina (che sta riproducendo il video) quello nuovo
  async function renew(u) {
    if (!tokens) return false;
    const before = urlOf(u);
    let ns = tokens.latest(u);
    if (!accept(u, ns)) {
      if (!st.waiting) {
        LOG("⏳ link scaduto" + (expiryOf(u) ? " alle " + hhmmss(expiryOf(u)) : "") + ": aspetto un link nuovo dalla pagina (tieni il video in riproduzione nella scheda)");
        onProgress({ pct: Math.round(done * 100 / total), text: "⏳ link scaduto: tieni il video in riproduzione nella scheda" });
        st.waiting = tokens.wait(u, 90000, x => accept(u, x)).finally(() => { st.waiting = null; });
      }
      ns = await st.waiting;
    }
    if (urlOf(u) !== before) return true; // un altro segmento ha già preso il link nuovo mentre aspettavo
    if (!accept(u, ns)) return false;
    st.search = ns;
    const ex = expiryOf(urlOf(u));
    LOG("🔑 preso un link nuovo dalla pagina" + (ex ? " (valido fino alle " + hhmmss(ex) + ")" : ""));
    return true;
  }
  async function fetchTrack(media, file) {
    const out = fs.createWriteStream(file);
    const keys = new Map();
    const getKey = k => { if (!keys.has(k.uri)) keys.set(k.uri, getBuf(open, k.uri, headers, 1e6, "chiave di cifratura")); return keys.get(k.uri); };
    const write = b => new Promise((res, rej) => out.write(b, e => e ? rej(e) : res()));
    try {
      if (media.map) await write(await retry(() => getBuf(open, media.map.url, headers, 400e6, "init fMP4"), 3, st));
      const n = media.segs.length;
      const meter = { ttfb: 0, body: 0, bytes: 0, n: 0 };
      const tStart = Date.now();
      let lastLog = tStart;
      const results = new Map();
      let next = 0, writeIdx = 0, active = 0, failed = null, flushP = Promise.resolve();
      // scrive i segmenti sempre nell'ordine giusto, appena sono pronti
      const flush = () => (flushP = flushP.then(async () => {
        while (results.has(writeIdx)) { const b = results.get(writeIdx); results.delete(writeIdx); await write(b); writeIdx++; }
      }));
      const report = force => {
        const now = Date.now();
        if (!force && now - lastLog < 15000) return;
        lastLog = now;
        const sec = Math.max((now - tStart) / 1000, 0.001);
        if (meter.n) LOG("📈 " + writeIdx + "/" + n + " · " + (meter.n / sec).toFixed(1) + " seg/s · " + (meter.bytes / 1048576 / sec).toFixed(2) + " MB/s · segmento medio " +
          Math.round(meter.bytes / meter.n / 1024) + " KB · attesa risposta " + Math.round(meter.ttfb / meter.n) + " ms · scarico " + Math.round(meter.body / meter.n) + " ms · in parallelo " + st.conc);
      };
      async function getSegment(i) {
        const s = media.segs[i], lab = "segmento " + (i + 1) + "/" + n;
        let buf;
        for (let round = 0; ; round++) {
          const u0 = urlOf(s.url);
          try { buf = await retry(() => getBuf(open, urlOf(s.url), headers, 400e6, lab, meter), isExpired(u0) ? 1 : 4, st); break; }
          catch (e) {
            if ((e.status === 403 || e.status === 401) && round < 8 && (urlOf(s.url) !== u0 || await renew(u0))) continue; // già rinnovato da un altro segmento
            e.message = lab + ": " + e.message + ((e.status === 403 || e.status === 401) && isExpired(u0) ? " — il link è scaduto alle " + hhmmss(expiryOf(u0)) + " e la pagina non ne ha dato uno nuovo" : "");
            throw e;
          }
        }
        if (s.key) {
          const key = await getKey(s.key);
          const iv = s.key.iv ? Buffer.from(s.key.iv.replace(/^0x/i, "").padStart(32, "0"), "hex") : seqIv(s.seq);
          const d = crypto.createDecipheriv("aes-128-cbc", key, iv);
          buf = Buffer.concat([d.update(buf), d.final()]);
        }
        tick();
        return buf;
      }
      // pool di richieste: appena una finisce ne parte un'altra (niente attese del segmento più lento)
      async function worker() {
        while (!failed) {
          if (signal && signal.aborted) { failed = failed || new Error("annullato"); return; }
          if (signal && signal.paused) { await sleep(200); continue; }
          if (active >= st.conc || next - writeIdx > st.conc * 4 + 8) { await sleep(25); continue; }
          const i = next++;
          if (i >= n) return;
          active++;
          try { results.set(i, await getSegment(i)); await flush(); report(false); }
          catch (e) { failed = failed || e; return; }
          finally { active--; }
        }
      }
      await Promise.all(Array.from({ length: Math.max(concurrency, BOOST, 1) }, worker));
      if (failed) throw failed;
      await flush();
      report(true);
    } finally { await new Promise(r => out.end(r)); }
  }

  const base = outPath.replace(/\.[^.\\/]+$/, "");
  const vFile = base + (vm.map ? ".video.part.mp4" : ".video.part.ts");
  const aFile = am ? base + (am.map ? ".audio.part.mp4" : ".audio.part.ts") : null;
  try {
    await fetchTrack(vm, vFile);
    if (am) await fetchTrack(am, aFile);
  } catch (e) { rm(vFile); if (aFile) rm(aFile); throw e; }

  if (raw) {
    const f = base + (vm.map ? ".raw.mp4" : ".raw.ts");
    fs.renameSync(vFile, f);
    if (aFile) rm(aFile);
    return { file: f, note: cutNote };
  }
  const ff = ffmpeg === undefined ? findFfmpeg() : ffmpeg;
  const finalMp4 = base + ".mp4";
  if (ff) {
    onProgress({ pct: 100, text: "unisco con ffmpeg" });
    try {
      const args = ["-y", "-loglevel", "error", "-i", vFile];
      if (aFile) args.push("-i", aFile);
      args.push("-c", "copy", "-movflags", "+faststart", finalMp4);
      await runFfmpeg(ff, args);
      rm(vFile); if (aFile) rm(aFile);
      return { file: finalMp4, note: cutNote };
    } catch (e) {
      rm(finalMp4);
      // ripiego: tengo il file grezzo
    }
  }
  const rawOut = vm.map ? finalMp4 : base + ".ts";
  fs.renameSync(vFile, rawOut);
  if (aFile) rm(aFile);
  let note = "";
  if (!vm.map) note = "Salvato come .ts (si apre con VLC). Con ffmpeg diventa .mp4.";
  if (am) note += " L'audio era separato: serve ffmpeg per unirlo.";
  return { file: rawOut, note: (cutNote + " " + note).trim() };
}

async function downloadDirect({ open, url, headers, outPath, onProgress = () => {}, fraction = null, ffmpeg, signal }) {
  if (fraction && fraction > 0 && fraction < 1) {
    // demo: scarico il file e ne tengo solo la prima parte (taglio per durata, così il file si apre normalmente)
    const ff = ffmpeg === undefined ? findFfmpeg() : ffmpeg;
    if (!ff) throw new Error("la versione demo ha bisogno di ffmpeg per tagliare il video: su Windows mettilo nel PATH o in Downloads\\YT-DLP, su Mac: brew install ffmpeg");
    const full = outPath + ".full" + (path.extname(outPath) || "");
    await downloadDirect({ open, url, headers, outPath: full, onProgress, signal });
    try {
      const dur = durationOf(ff, full);
      if (!dur) throw new Error("non riesco a leggere la durata del video per la demo");
      onProgress({ pct: 100, text: "taglio (demo)" });
      await runFfmpeg(ff, ["-y", "-loglevel", "error", "-i", full, "-t", String(Math.max(1, dur * fraction)), "-c", "copy", outPath]);
    } catch (e) { rm(outPath); throw e; } finally { rm(full); }
    return { file: outPath, note: demoNote(fraction) };
  }
  if (signal && signal.aborted) throw new Error("annullato");
  const r = await open(url, headers);
  if (r.status >= 400) throw await httpErr(r, url, headers, "file diretto");
  if (signal && signal.aborts) signal.aborts.add(() => { try { r.abort && r.abort(); } catch (_) {} });
  const total = parseInt(h1(r.headers, "content-length"), 10) || 0;
  const out = fs.createWriteStream(outPath);
  let n = 0, lastT = 0;
  try {
    for await (const c of r.res) {
      while (signal && signal.paused && !signal.aborted) await sleep(200); // in pausa: smetto di leggere, il flusso si ferma da solo
      if (signal && signal.aborted) throw new Error("annullato");
      n += c.length;
      if (!out.write(c)) await new Promise(res => out.once("drain", res));
      const now = Date.now();
      if (now - lastT > 250) { lastT = now; onProgress({ pct: total ? Math.round(n * 100 / total) : -1, text: (n / 1048576).toFixed(1) + " MB" }); }
    }
    if (signal && signal.aborted) throw new Error("annullato");
    await new Promise((res, rej) => out.end(e => e ? rej(e) : res()));
  } catch (e) { out.destroy(); rm(outPath); throw (signal && signal.aborted) ? new Error("annullato") : e; }
  return { file: outPath, note: "" };
}

// Estrae l'audio in mp3. kind: "hls" | "file" | "audio". Serve ffmpeg (tranne se la sorgente è già un .mp3).
async function downloadAudio({ open, url, kind, headers, outPath, pick, onProgress = () => {}, ffmpeg, tmpBase, tokens, fraction = null, signal }) {
  if (kind === "audio" && /\.mp3(\?|#|$)/i.test(url)) return downloadDirect({ open, url, headers, outPath, onProgress, fraction, ffmpeg, signal });
  const ff = ffmpeg === undefined ? findFfmpeg() : ffmpeg;
  if (!ff) throw new Error("per ricavare l'mp3 serve ffmpeg: su Windows mettilo nel PATH o in Downloads\\YT-DLP, su Mac: brew install ffmpeg");
  const sub = (a, b) => p => onProgress({ pct: p.pct < 0 ? -1 : Math.round(a + (b - a) * p.pct / 100), text: p.text });
  let src, demoCut = "";
  if (kind === "hls") {
    src = (await downloadHls({ open, url, headers, outPath: tmpBase + ".x", pick, onProgress: sub(0, 90), ffmpeg: null, audioOnly: true, raw: true, tokens, fraction, signal })).file;
  } else {
    src = tmpBase + ".src";
    await downloadDirect({ open, url, headers, outPath: src, onProgress: sub(0, 90), signal });
  }
  try {
    if (signal && signal.aborted) throw new Error("annullato");
    onProgress({ pct: 92, text: "converto in mp3" });
    const args = ["-y", "-loglevel", "error", "-i", src, "-vn", "-map", "0:a:0", "-c:a", "libmp3lame", "-q:a", "2", "-map_metadata", "0"];
    let cut = false;
    if (fraction && kind !== "hls") { // demo, file intero scaricato: tengo solo la prima parte
      const dur = durationOf(ff, src);
      if (!dur) throw new Error("non riesco a leggere la durata per la demo");
      args.push("-t", String(Math.max(1, dur * fraction))); cut = true;
    }
    if (fraction && kind === "hls") cut = true;
    args.push(outPath);
    await runFfmpeg(ff, args);
    if (cut) demoCut = demoNote(fraction);
  } catch (e) {
    rm(outPath);
    throw new Error(/matches no streams|does not contain any stream|Invalid argument/i.test(e.message) ? "nel file non c'è una traccia audio" : e.message);
  } finally { rm(src); }
  return { file: outPath, note: demoCut };
}

module.exports = { setLogger, maskH, expiryOf, isExpired, hhmmss, parseMaster, parseMedia, probeHls, downloadHls, downloadDirect, downloadAudio, findFfmpeg, runFfmpeg, durationOf, h1 };
