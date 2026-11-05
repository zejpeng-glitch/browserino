"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pl", {
  download: (level, mode) => ipcRenderer.invoke("vid:dl-player", level || null, mode || "video"),
  onDl: cb => ipcRenderer.on("vid:dl", (_e, d) => cb(d))
});
