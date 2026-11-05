"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("bn", {
  getCfg: () => ipcRenderer.invoke("cfg:get"),
  setCfg: p => ipcRenderer.invoke("cfg:set", p),
  onBlocked: cb => ipcRenderer.on("blocked", (_e, d) => cb(d)),
  onPlayer: cb => ipcRenderer.on("player", (_e, on) => cb(on)),
  fullscreen: on => ipcRenderer.send("fs", on),
  // video
  onVideos: cb => ipcRenderer.on("videos", (_e, l) => cb(l)),
  vidPlay: id => ipcRenderer.invoke("vid:play", id),
  vidDownload: (id, mode) => ipcRenderer.invoke("vid:dl", id, mode || "video"),
  vidCapture: id => ipcRenderer.invoke("vid:capture", id),
  vidCtl: (id, action) => ipcRenderer.invoke("vid:ctl", id, action),
  onDl: cb => ipcRenderer.on("vid:dl", (_e, d) => cb(d)),
  // debug video
  dbgGet: () => ipcRenderer.invoke("dbg:get"),
  dbgOpen: () => ipcRenderer.invoke("dbg:open"),
  onDbg: cb => ipcRenderer.on("dbg", (_e, l) => cb(l)),
  // schede
  vidActive: id => ipcRenderer.invoke("vid:active", id),
  onPasteGo: cb => ipcRenderer.on("pastego", (_e, t) => cb(t)),
  onNewTab: cb => ipcRenderer.on("newtab", (_e, url, fg) => cb(url, fg)),
  onShortcut: cb => ipcRenderer.on("shortcut", (_e, c) => cb(c)),
  // registratore audio di sistema
  recStart: (sr, ch) => ipcRenderer.invoke("rec:start", sr, ch),
  recChunk: buf => ipcRenderer.send("rec:chunk", buf),
  recStop: () => ipcRenderer.invoke("rec:stop"),
  // edizione demo / completa
  edition: () => ipcRenderer.invoke("edition:get"),
  buy: () => ipcRenderer.invoke("edition:buy")
});
