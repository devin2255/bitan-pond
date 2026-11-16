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

contextBridge.exposeInMainWorld("appUpdates", {
  check: () => ipcRenderer.invoke("update:check"),
});

contextBridge.exposeInMainWorld("scenePreview", {
  state: () => ipcRenderer.invoke("scene:preview-state"),
  set: (key, value) => ipcRenderer.send("scene:preview", key, value),
  onChange: (cb) => ipcRenderer.on("scene:preview", (_event, value) => cb(value)),
});
