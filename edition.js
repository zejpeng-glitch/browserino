"use strict";
// Edizione dell'app: "full" (completa) o "demo". La decide edition.json, scritto da scripts/dist.js al momento della costruzione.
const fs = require("fs");
const path = require("path");
let j = {};
try { j = JSON.parse(fs.readFileSync(path.join(__dirname, "edition.json"), "utf8")); } catch (_) {}
const demo = j.edition === "demo";
module.exports = {
  demo,
  fraction: demo ? 0.8 : null,   // la demo salva solo questa parte del video
  recSecs: demo ? 120 : null,    // e registra al massimo questi secondi
  buyUrl: typeof j.buyUrl === "string" ? j.buyUrl : ""
};
