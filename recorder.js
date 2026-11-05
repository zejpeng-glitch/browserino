"use strict";
// Registratore dell'audio di sistema (loopback, come Audacity): un tasto REC, parte subito,
// con STOP salva in Download. Il rendering dell'audio lo fa la finestra (ui/rec.js), qui si scrive il file.
const { ipcMain, session, desktopCapturer, app, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const dl = require("./downloader");
const edition = require("./edition");

let cur = null; // {fd, file, sr, ch, bytes}

function wavHeader(dataLen, sr, ch) {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0); b.writeUInt32LE(36 + dataLen, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(dataLen, 40);
  return b;
}
const pad = n => String(n).padStart(2, "0");
function stamp() { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + "-" + pad(d.getMinutes()) + "-" + pad(d.getSeconds()); }

function closeWav() {
  if (!cur) return null;
  const c = cur; cur = null;
  try { fs.writeSync(c.fd, wavHeader(c.bytes, c.sr, c.ch), 0, 44, 0); } catch (_) {}
  try { fs.closeSync(c.fd); } catch (_) {}
  return c;
}

function init() {
  // getDisplayMedia della finestra principale: audio di tutto il sistema (solo Windows)
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const src = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
      cb({ video: src[0], audio: "loopback" });
    } catch (_) { cb({}); }
  });

  ipcMain.handle("rec:start", (_e, sr, ch) => {
    if (cur) closeWav();
    const file = path.join(app.getPath("downloads"), "Registrazione " + stamp() + ".wav");
    const fd = fs.openSync(file, "w");
    fs.writeSync(fd, wavHeader(0, sr, ch));
    cur = { fd, file, sr, ch, bytes: 0 };
    return { file };
  });
  ipcMain.on("rec:chunk", (_e, buf) => {
    if (!cur || !buf) return;
    let b = Buffer.from(buf);
    if (edition.demo) { // demo: oltre il limite non scrivo più
      const cap = edition.recSecs * cur.sr * cur.ch * 2;
      if (cur.bytes >= cap) { cur.capped = true; return; }
      if (cur.bytes + b.length > cap) { b = b.subarray(0, cap - cur.bytes); cur.capped = true; }
    }
    try { fs.writeSync(cur.fd, b); cur.bytes += b.length; } catch (_) {}
  });
  ipcMain.handle("rec:stop", async () => {
    const c = closeWav();
    if (!c) return { error: "Nessuna registrazione in corso." };
    const secs = Math.round(c.bytes / (c.sr * c.ch * 2));
    if (c.bytes < 2000) { try { fs.unlinkSync(c.file); } catch (_) {} return { error: "Non ho sentito nessun suono: file non creato." }; }
    let file = c.file, note = c.capped ? "Versione demo: registrazione limitata a " + (edition.recSecs / 60) + " minuti. La versione Pro non ha limiti." : "";
    const ff = dl.findFfmpeg();
    if (ff) {
      const mp3 = c.file.replace(/\.wav$/i, ".mp3");
      try {
        await dl.runFfmpeg(ff, ["-y", "-loglevel", "error", "-i", c.file, "-c:a", "libmp3lame", "-q:a", "2", mp3]);
        fs.unlinkSync(c.file); file = mp3;
      } catch (e) { note = (note ? note + " " : "") + "mp3 non riuscito, tengo il WAV"; try { fs.unlinkSync(mp3); } catch (_) {} }
    } else note = (note ? note + " " : "") + "senza ffmpeg salvo in WAV";
    shell.showItemInFolder(file);
    return { file, name: path.basename(file), secs, note };
  });
  app.on("will-quit", closeWav);
}

module.exports = { init };
