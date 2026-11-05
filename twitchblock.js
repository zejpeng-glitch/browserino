"use strict";
// Blocca le pubblicità di Twitch con lo script "vaft" del progetto TwitchAdSolutions (licenza MIT, vedi THIRD-PARTY-TwitchAdSolutions-LICENSE.txt).
// Parte dentro le pagine di twitch.tv PRIMA degli script del sito, quindi funziona solo dove Electron permette il precaricamento.
const fs = require("fs");
const path = require("path");
const ID = "bn-twitch";
let file = null;

function build(dataDir) {
  const src = fs.readFileSync(path.join(__dirname, "twitch-vaft.js"), "utf8");
  file = path.join(dataDir, "bn-twitch-preload.js");
  fs.writeFileSync(file,
    "const { contextBridge } = require('electron');\n" +
    "try { contextBridge.executeInMainWorld({ func: function () {\n" +
    "if (!/(^|\\.)twitch\\.tv$/.test(location.hostname)) return;\n" + src + "\n} }); } catch (e) {}\n");
}

function set(ses, dataDir, on, dbg) {
  try {
    if (typeof ses.registerPreloadScript !== "function") { dbg("ℹ twitch: precaricamento non disponibile in questa versione di Electron"); return false; }
    try { ses.unregisterPreloadScript(ID); } catch (_) {}
    if (!on) { dbg("ℹ twitch: blocco pubblicità spento"); return true; }
    build(dataDir);
    ses.registerPreloadScript({ type: "frame", filePath: file, id: ID });
    dbg("ℹ twitch: blocco pubblicità attivo");
    return true;
  } catch (e) { dbg("ℹ twitch: non riuscito (" + (e && e.message) + ")"); return false; }
}

module.exports = { set };
