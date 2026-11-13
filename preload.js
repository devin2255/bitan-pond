const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wallpaper", {
  toggle: () => ipcRenderer.invoke("wallpaper:toggle"),
  state: () => ipcRenderer.invoke("wallpaper:state"),
  onChange: (cb) => {
    ipcRenderer.on("wallpaper-state", (_event, on) => cb(!!on));
  },
});

contextBridge.exposeInMainWorld("systemMusic", {
  state: () => ipcRenderer.invoke("music:state"),
  onChange: (cb) => ipcRenderer.on("system-music-state", (_event, value) => cb(value)),
  setRhythmEnabled: (enabled) => ipcRenderer.invoke("music:rhythm-enabled", !!enabled),
  onBeat: (cb) => ipcRenderer.on("system-music-beat", (_event, value) => cb(value)),
});
