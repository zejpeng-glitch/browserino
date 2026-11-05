// Costruisce l'installer. Uso:
//   node scripts/dist.js <full|demo> <win|mac> [arm64|x64]
// Scrive edition.json, costruisce, e alla fine rimette edition.json su "full".
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const [edition = "full", target = process.platform === "darwin" ? "mac" : "win", arch] = process.argv.slice(2);
if (!["full", "demo"].includes(edition) || !["win", "mac"].includes(target)) {
  console.error("Uso: node scripts/dist.js <full|demo> <win|mac> [arm64|x64]");
  process.exit(1);
}
if (target === "mac" && process.platform !== "darwin") {
  console.error("L'app per Mac si costruisce solo su un Mac (o con il workflow GitHub).");
  process.exit(1);
}

const edFile = path.join(root, "edition.json");
const cfgFile = path.join(root, ".build-config.json");
let ed = {};
try { ed = JSON.parse(fs.readFileSync(edFile, "utf8")); } catch (_) {}
const write = e => fs.writeFileSync(edFile, JSON.stringify(Object.assign({}, ed, { edition: e }), null, 1) + "\n");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const cfg = JSON.parse(JSON.stringify(pkg.build));
const demo = edition === "demo";
if (demo) { cfg.productName = "Browserino Demo"; cfg.appId += ".demo"; }
cfg.nsis = Object.assign({}, cfg.nsis, { artifactName: (demo ? "Browserino-Demo" : "Browserino") + "-Setup-${version}.${ext}" });
cfg.mac = Object.assign({}, cfg.mac, { artifactName: (demo ? "Browserino-Demo" : "Browserino") + "-${version}-${arch}.${ext}" });

try {
  write(edition);
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 1));
  const args = ["electron-builder", "--config", ".build-config.json", target === "win" ? "--win" : "--mac"];
  if (target === "win") args.push("nsis");
  if (arch) args.push("--" + arch);
  console.log(">>> costruisco " + edition.toUpperCase() + " per " + target + (arch ? " (" + arch + ")" : ""));
  const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  process.exitCode = r.status == null ? 1 : r.status;
} finally {
  write("full");
  try { fs.unlinkSync(cfgFile); } catch (_) {}
}
