"use strict";

const fs = require("node:fs");

// A spawned process is not necessarily a running updater: PowerShell may
// fail during startup. Keep the old application open until the helper has
// validated its inputs and explicitly acknowledged this particular update.
async function waitForUpdaterHandoff(child, file, token, { timeout = 30000, poll = 100, settle = 250 } = {}) {
  const deadline = Date.now() + timeout;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  while (Date.now() < deadline) {
    let acknowledged = false;
    try { acknowledged = (await fs.promises.readFile(file, "utf8")) === token; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (acknowledged) {
      await sleep(settle);
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("更新助手启动后意外退出");
      await fs.promises.unlink(file).catch(() => {});
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("更新助手未能启动");
    await sleep(poll);
  }
  throw new Error("等待更新助手启动超时");
}

module.exports = { waitForUpdaterHandoff };
