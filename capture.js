"use strict";
// Cattura dal player della pagina (MSE): quando un sito non mostra mai un link scaricabile, Browserino copia i pezzi
// di video che il player passa al tag <video> (vedi capture-hook.js) e li monta in un file. Va alla velocità di
// riproduzione (si può accelerare). Non funziona sui contenuti con DRM: i pezzi arrivano cifrati e non si vedono.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { webFrameMain } = require("electron");
const dl = require("./downloader");

const HOOK = fs.readFileSync(path.join(__dirname, "capture-hook.js"), "utf8");
const safe = s => String(s || "video").replace(/[<>:"\/\\|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "video";
const p2 = n => String(n).padStart(2, "0");
const clock = s => (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + p2(Math.floor(s / 60) % 60) + ":" + p2(s % 60);
const mb = n => (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + " MB";

function framesOf(wc) { try { return wc.mainFrame.framesInSubtree; } catch (_) { return []; } }

// Mette lo script dentro la pagina (e nei suoi iframe). Si può chiamare quante volte si vuole.
function installIn(wc) {
  for (const f of framesOf(wc)) { try { f.executeJavaScript(HOOK).catch(() => {}); } catch (_) {} }
}
function install(wc) {
  // appena un frame (anche un iframe) viene caricato, prima che parta il suo codice, se ci si arriva in tempo
  wc.on("did-frame-navigate", (_e, _url, _code, _status, _isMain, pid, rid) => {
    try { const f = webFrameMain.fromId(pid, rid); if (f) f.executeJavaScript(HOOK).catch(() => {}); } catch (_) {}
  });
  wc.on("dom-ready", () => installIn(wc));
  wc.on("did-frame-finish-load", () => installIn(wc));
}

// Se la versione di Electron lo permette, lo script parte PRIMA di quelli della pagina (così vede anche i player che partono da soli).
function registerEarly(ses, dataDir, dbg) {
  try {
    if (typeof ses.registerPreloadScript !== "function") { dbg("ℹ cattura: precaricamento non disponibile, uso l'iniezione tardiva"); return; }
    const f = path.join(dataDir, "bn-mse-preload.js");
    fs.writeFileSync(f, "const { contextBridge } = require('electron');\ntry { contextBridge.executeInMainWorld({ func: function () {\n" + HOOK + "\n} }); } catch (e) {}\n");
    ses.registerPreloadScript({ type: "frame", filePath: f, id: "bn-mse" });
    dbg("ℹ cattura: script di intercettazione registrato in anticipo");
  } catch (e) { dbg("ℹ cattura: precaricamento non riuscito (" + (e && e.message) + "), uso l'iniezione tardiva"); }
}

function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + "." + ext), n = 2;
  while (fs.existsSync(p)) p = path.join(dir, base + " (" + n++ + ")." + ext);
  return p;
}
function startsLikeMedia(file) {
  try {
    const fd = fs.openSync(file, "r"), b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, 0); fs.closeSync(fd);
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true;
    const t = b.toString("latin1", 4, 8); return t === "ftyp" || t === "moov";
  } catch (_) { return false; }
}

// o: { wc, send(x), dbg, outDir, title, demoSecs, onFile(file) }
async function start(o) {
  const dbg = o.dbg || (() => {});
  // 1) trovo il frame che sta davvero passando più dati al player (gli altri possono essere pubblicità)
  let best = null;
  for (const f of framesOf(o.wc)) {
    try {
      await f.executeJavaScript(HOOK);
      const st = await f.executeJavaScript("window.__bnMse ? window.__bnMse.status() : null");
      if (st && st.bufs.length) {
        const total = st.bufs.reduce((a, b) => a + b.bytes, 0);
        if (!best || total > best.total) best = { f, total, st };
      }
    } catch (_) {}
  }
  if (!best) return { error: "In questa pagina non vedo un player che usa MSE. Fai partire il video nella pagina e riprova; se non cambia, il sito usa un altro metodo." };
  const frame = best.f;
  const arm = await frame.executeJavaScript("window.__bnMse.arm()").catch(() => null);
  if (!arm) return { error: "Non riesco ad attivare la cattura in questa pagina." };
  dbg("⏺ cattura: frame scelto " + (frame.url || "?") + " · buffer: " + best.st.bufs.map(b => b.mime + " (" + mb(b.bytes) + ")").join(", ") + " · intestazioni già viste: " + arm.withInit + "/" + arm.bufs);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "browserino-cap-"));
  const bufs = new Map(); // id -> { id, mime, kind, ext, file, ws, bytes }
  const t0 = Date.now();
  let finished = false, rate = 1, busy = false, fails = 0, lastBytes = 0, lastGrow = Date.now(), total = 0, timer = null, hb = null;
  const warnNoInit = arm.withInit < arm.bufs;

  function bufFor(g) {
    let b = bufs.get(g.b);
    if (!b) {
      const m = String(g.m || "");
      const ext = /webm/i.test(m) ? "webm" : "mp4";
      const file = path.join(tmp, "b" + g.b + "." + ext);
      b = { id: g.b, mime: m, kind: /^audio\//i.test(m) ? "audio" : "video", ext, file, ws: fs.createWriteStream(file), bytes: 0 };
      bufs.set(g.b, b);
    }
    return b;
  }
  async function pull() {
    if (busy || finished) return;
    busy = true;
    try {
      const gs = await frame.executeJavaScript("window.__bnMse.drain()");
      fails = 0;
      for (const g of gs || []) {
        if (!g || !g.s) continue;
        const buf = Buffer.from(g.s, "base64"), b = bufFor(g);
        b.ws.write(buf); b.bytes += buf.length; total += buf.length;
      }
    } catch (e) {
      fails++;
      if (fails >= 6 && !finished) { dbg("⏺ cattura: la pagina non risponde più, salvo quello che ho"); save("la pagina è cambiata o chiusa: ho salvato quello che c'era").catch(() => {}); }
    } finally { busy = false; }
  }
  function report() {
    if (finished) return;
    const el = Math.round((Date.now() - t0) / 1000);
    if (total > lastBytes) { lastBytes = total; lastGrow = Date.now(); }
    let txt = "⏺ Cattura " + clock(el) + " · " + mb(total) + (rate > 1 ? " · ×" + rate : "");
    if (Date.now() - lastGrow > 8000) txt = "⏺ Cattura ferma: nessun dato da 8 s. Premi play nella pagina. (" + mb(total) + ")";
    else if (warnNoInit && !startsOk()) txt += " · ⚠ pagina aperta prima: se non funziona ricaricala e rifai la cattura";
    o.send({ capture: true, pct: -1, text: txt, rate });
    if (o.demoSecs > 0 && el >= o.demoSecs) save("Versione demo: la cattura si ferma dopo " + clock(o.demoSecs)).catch(() => {});
  }
  function startsOk() { for (const b of bufs.values()) if (startsLikeMedia(b.file)) return true; return false; }

  async function closeAll() {
    clearInterval(timer); clearInterval(hb);
    await pull();
    try { await frame.executeJavaScript("window.__bnMse.disarm(); window.__bnMse.speed(1)"); } catch (_) {}
    await Promise.all([...bufs.values()].map(b => new Promise(r => b.ws.end(r))));
  }
  function cleanup() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }

  async function save(note) {
    if (finished) return; finished = true;
    o.send({ saving: true, pct: -1, text: "Salvo il file…" });
    try {
      await closeAll();
      const got = [...bufs.values()].filter(b => b.bytes > 0);
      if (!got.length) throw new Error("Nessun dato catturato: mentre la cattura è attiva il video deve andare avanti nella pagina (premi play).");
      const pickBy = k => got.filter(b => b.kind === k).sort((a, b) => b.bytes - a.bytes)[0];
      const v = pickBy("video"), a = pickBy("audio");
      const chosen = [v, a].filter(Boolean);
      for (const b of chosen) if (!startsLikeMedia(b.file)) throw new Error("Mi manca l'inizio del video (l'intestazione). Ricarica la pagina, premi 🎬 e rifai la cattura prima di far partire il video.");
      const allWebm = chosen.every(b => b.ext === "webm");
      const ext = allWebm ? "webm" : "mp4";
      const base = safe(o.title) + " (cattura)";
      const ff = dl.findFfmpeg();
      let out, msg = note || "";
      if (ff) {
        out = uniquePath(o.outDir, base, ext);
        const args = ["-y", "-hide_banner", "-loglevel", "error"];
        chosen.forEach(b => args.push("-i", b.file));
        if (chosen.length === 2) args.push("-map", "0:v:0", "-map", "1:a:0");
        args.push("-c", "copy", "-avoid_negative_ts", "make_zero");
        if (ext === "mp4") args.push("-movflags", "+faststart");
        args.push(out);
        await dl.runFfmpeg(ff, args);
      } else if (chosen.length === 1) {
        out = uniquePath(o.outDir, base, chosen[0].ext);
        fs.copyFileSync(chosen[0].file, out);
        msg = (msg ? msg + " · " : "") + "senza ffmpeg: file grezzo, potrebbe non aprirsi in tutti i player";
      } else {
        const vf = uniquePath(o.outDir, base + " (video)", v.ext), af = uniquePath(o.outDir, base + " (audio)", a.ext);
        fs.copyFileSync(v.file, vf); fs.copyFileSync(a.file, af);
        out = vf;
        msg = (msg ? msg + " · " : "") + "senza ffmpeg: video e audio restano in due file separati";
      }
      dbg("✅ cattura salvata: " + out + " (" + mb(total) + ")");
      cleanup();
      if (o.onFile) o.onFile(out);
      o.send({ done: true, pct: 100, file: out, name: path.basename(out), note: msg });
    } catch (e) {
      dbg("❌ cattura fallita: " + (e.message || e));
      cleanup();
      o.send({ error: e.message || String(e) });
    }
  }
  async function cancel() {
    if (finished) return; finished = true;
    try { await closeAll(); } catch (_) {}
    cleanup();
    dbg("⛔ cattura annullata da te");
    o.send({ canceled: true });
  }
  async function speed(r) {
    rate = Number(r) || 1;
    try { await frame.executeJavaScript("window.__bnMse.speed(" + rate + ")"); dbg("⏩ cattura: velocità ×" + rate); } catch (_) {}
  }

  timer = setInterval(pull, 400);
  hb = setInterval(report, 1000);
  report();
  return { ok: true, save, cancel, speed };
}

module.exports = { install, installIn, registerEarly, start, HOOK };
