const { contextBridge, ipcRenderer, webUtils } = require("electron");
const prefix = "tangli:dock:";
const call = (name) => (...args) => ipcRenderer.invoke(prefix + name, ...args);
const receive = (name) => (fn) => ipcRenderer.on(prefix + name, (_event, value) => fn(value));

contextBridge.exposeInMainWorld("tangliDock", {
  state: call("get"), enabled: call("enabled"), save: call("save"), takeover: call("takeover"),
  choose: call("pick"), reorder: call("reorder"), shape: call("shape"),
  item: call("item"), context: call("context"), command: call("command"),
  drop: (files) => call("drop")(files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)),
  query: call("query"), searchAction: call("search-action"), hideSearch: call("search-hide"),
  openSettings: call("search-settings"), drives: call("drives"), setIndex: call("index"), indexStatus: call("index-status"),
  onBar: receive("bar"), onSettings: receive("settings"), onIndex: receive("index"),
  onError: receive("error"), onFocus: receive("focus"),
});
