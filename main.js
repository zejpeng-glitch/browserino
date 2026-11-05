"use strict";
const { app, BrowserWindow, ipcMain, session, Menu, shell } = require("electron");
const IS_MAC = process.platform === "darwin";
const path = require("path");
const fs = require("fs");
const videos = require("./videos");
const recorder = require("./recorder");
const edition = require("./edition");

let win;
const cfgFile = () => path.join(app.getPath("userData"), "browserino.json");
function loadCfg() { try { return JSON.parse(fs.readFileSync(cfgFile(), "utf8")); } catch (_) { return {}; } }
function saveCfg(c) { try { fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 1)); } catch (_) {} }
let cfg = {};

const blocklist = JSON.parse(fs.readFileSync(path.join(__dirname, "blocklist.json"), "utf8"));
const blockerJs = fs.readFileSync(path.join(__dirname, "blocker.js"), "utf8");
const isAd = host => blocklist.some(d => host === d || host.endsWith("." + d));
const SECOND = new Set(["co", "com", "org", "net", "gov", "edu"]);
function site(host) {
  const p = host.split(".");
  if (p.length <= 2) return host;
  return SECOND.has(p[p.length - 2]) ? p.slice(-3).join(".") : p.slice(-2).join(".");
}
function hostOf(u) { try { return new URL(u).hostname; } catch (_) { return ""; } }

let blockedCount = 0;
function tell(kind, detail) {
  blockedCount++;
  if (win && !win.isDestroyed()) win.webContents.send("blocked", { n: blockedCount, kind, detail });
}

function setupGuest(wc) {
  let lastInput = -1e9;
  const now = () => Date.now();
  wc.on("before-input-event", (_e, input) => {
    if (input.type === "mouseDown" || input.type === "keyDown" || input.type === "touchStart") lastInput = now();
  });
  const trusted = () => now() - lastInput < 1500;

  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (trusted() && /^https?:/i.test(url) && !isAd(hostOf(url))) {
      // Ctrl+clic / clic centrale su un link: nuova scheda vera
      if (disposition === "background-tab" || disposition === "foreground-tab") {
        if (win && !win.isDestroyed()) win.webContents.send("newtab", url, disposition === "foreground-tab");
        return { action: "deny" };
      }
      // altrimenti: nella stessa scheda, solo se l'ho chiesto io con un clic e resta nello stesso sito
      if (site(hostOf(url)) === site(hostOf(wc.getURL()))) { setImmediate(() => wc.loadURL(url)); return { action: "deny" }; }
    }
    tell("popup", url);
    return { action: "deny" };
  });

  // scorciatoie anche quando il focus è dentro la pagina
  const FWD = new Set(["ctrl+t", "ctrl+w", "ctrl+tab", "ctrl+shift+tab", "ctrl+l", "ctrl+d", "ctrl+j", "ctrl+shift+r", "f5", "alt+arrowleft", "alt+arrowright",
    "ctrl+1", "ctrl+2", "ctrl+3", "ctrl+4", "ctrl+5", "ctrl+6", "ctrl+7", "ctrl+8", "ctrl+9"]);
  wc.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const combo = (input.control || (IS_MAC && input.meta) ? "ctrl+" : "") + (input.shift ? "shift+" : "") + (input.alt ? "alt+" : "") + String(input.key).toLowerCase();
    if (FWD.has(combo)) { e.preventDefault(); if (win && !win.isDestroyed()) win.webContents.send("shortcut", combo); }
  });

  wc.on("will-navigate", (e, url) => {
    if (cfg.blockJump === false) return;
    const from = hostOf(wc.getURL()), to = hostOf(url);
    if (!from || !to) return;
    if (isAd(to)) { e.preventDefault(); tell("pubblicità", url); return; }
    if (site(from) !== site(to) && !trusted()) { e.preventDefault(); tell("salto", url); }
  });
  wc.on("will-redirect", (e, url, _in, isMain) => {
    if (isMain && isAd(hostOf(url))) { e.preventDefault(); tell("pubblicità", url); }
  });

  const inject = () => { wc.executeJavaScript(blockerJs).catch(() => {}); };
  wc.on("dom-ready", inject);
  wc.on("did-frame-finish-load", inject);

  videos.onGuest(wc);
  wc.on("console-message", (e, _lvl, msg) => {
    if (typeof msg !== "string") msg = (e && e.message) || ""; // Electron nuovi: il messaggio sta nell'evento
    if (msg.startsWith("__BN__:found:")) {
      try { videos.addScraped(wc.id, JSON.parse(msg.slice(13))); } catch (_) {}
    } else if (msg === "__BN__:playing") {
      // video grande partito dopo un tuo gesto: schermo intero
      wc.executeJavaScript(
        "(function(){var v=window.__bnBig&&window.__bnBig();if(v&&!document.fullscreenElement){(v.requestFullscreen||v.webkitRequestFullscreen).call(v)}})()", true).catch(() => {});
    } else if (msg.startsWith("__BN__:blocked:")) tell("pagina", msg.slice(15));
  });

  wc.on("enter-html-full-screen", () => win && win.webContents.send("player", true));
  wc.on("leave-html-full-screen", () => win && win.webContents.send("player", false));
}

function setupSession(ses) {
  ses.webRequest.onBeforeRequest((d, cb) => {
    const h = hostOf(d.url);
    if (h && isAd(h) && d.resourceType !== "mainFrame") { blockedCount++; if (win && !win.isDestroyed()) win.webContents.send("blocked", { n: blockedCount, kind: "pubblicità", detail: h }); return cb({ cancel: true }); }
    cb({});
  });
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(["fullscreen", "media", "clipboard-sanitized-write"].includes(perm)));
}

app.whenReady().then(() => {
  if (IS_MAC) {
    // menu minimo: copia/incolla funzionano, e Cmd+W / Cmd+T restano alle schede di Browserino
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: "appMenu" }, { role: "editMenu" },
      { label: "Vista", submenu: [{ role: "togglefullscreen" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }] }
    ]));
  }
  cfg = loadCfg();
  if (cfg.blockJump === undefined) cfg.blockJump = true;
  const guestSes = session.fromPartition("persist:browserino");
  setupSession(guestSes);
  videos.init({ guestSes, getWin: () => win, isAd });
  recorder.init();

  win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: "#0e1117", title: edition.demo ? "Browserino Demo" : "Browserino", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), webviewTag: true, contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, "ui", "index.html"));

  app.on("web-contents-created", (_e, wc) => { if (wc.getType() === "webview") setupGuest(wc); });

  ipcMain.handle("cfg:get", () => cfg);
  ipcMain.handle("cfg:set", (_e, patch) => { cfg = Object.assign(cfg, patch); saveCfg(cfg); return cfg; });
  ipcMain.on("fs", (_e, on) => win.setFullScreen(!!on));
  ipcMain.handle("edition:get", () => ({ demo: edition.demo, fraction: edition.fraction, recSecs: edition.recSecs, hasBuy: /^https?:\/\//i.test(edition.buyUrl) }));
  ipcMain.handle("edition:buy", () => { if (/^https?:\/\//i.test(edition.buyUrl)) { shell.openExternal(edition.buyUrl); return true; } return false; });
});
app.on("window-all-closed", () => app.quit());
