"use strict";
// Anteprima di un sito per i preferiti: lo apre in una finestra nascosta (stessa sessione di Browserino, quindi con i tuoi accessi),
// aspetta che si disegni, fa una foto ridotta e chiude la finestra.
const { BrowserWindow } = require("electron");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function make(url, ses) {
  if (!/^https?:\/\//i.test(url)) throw new Error("indirizzo non valido");
  const w = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { session: ses, sandbox: true, backgroundThrottling: false } });
  try {
    const wc = w.webContents;
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.setAudioMuted(true);
    await Promise.race([wc.loadURL(url).catch(() => {}), sleep(20000)]);
    await sleep(2500); // il tempo di disegnare la pagina
    const img = await wc.capturePage();
    if (!img || img.isEmpty()) throw new Error("la pagina non si è disegnata");
    return "data:image/jpeg;base64," + img.resize({ width: 480, quality: "good" }).toJPEG(72).toString("base64");
  } finally { try { w.destroy(); } catch (_) {} }
}
module.exports = { make };
