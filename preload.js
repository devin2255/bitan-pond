const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wallpaper", {
  toggle: () => ipcRenderer.invoke("wallpaper:toggle"),
  state: () => ipcRenderer.invoke("wallpaper:state"),
  onChange: (cb) => {
    ipcRenderer.on("wallpaper-state", (_event, on) => cb(!!on));
  },
});
