const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("journalEditor", { submit: (text) => ipcRenderer.invoke("journal:submit", text) });
