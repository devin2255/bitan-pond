const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { createInterface } = require("node:readline");

const runFile = promisify(execFile);
const sources = ["windows.cs", "appearance.cs", "taskbar.cs", "preview.cs", "search.cs"];
const libraries = ["System.Web.Extensions", "System.Windows.Forms", "System.Drawing", "System.Data", "Microsoft.CSharp"];

function createNative(directory, log = () => {}) {
  let building;
  function executable() {
    building ??= buildNative(directory).catch((error) => {
      building = null;
      throw error;
    });
    return building;
  }

  function client(mode, args = [], timeout = 3000) {
    let process, opening, stopped = false, sequence = 0;
    const pending = new Map();

    function fail(error, child) {
      if (process !== child) return;
      process = null;
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      pending.clear();
    }

    async function open() {
      if (stopped) throw new Error("Windows 助手已退出");
      if (process) return process;
      opening ??= executable().then((binary) => {
        if (stopped) throw new Error("Windows 助手已退出");
        const child = spawn(binary, [mode, ...args], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        process = child;
        const lines = createInterface({ input: child.stdout });
        lines.on("line", (line) => {
          let reply;
          try { reply = JSON.parse(line); }
          catch (error) { log(error); return; }
          const request = pending.get(reply.id);
          if (!request) return;
          pending.delete(reply.id);
          clearTimeout(request.timer);
          if (reply.error) request.reject(new Error(reply.error));
          else request.resolve(reply.value);
        });
        child.stderr.setEncoding("utf8").on("data", (data) => log(new Error(data.trim())));
        child.stdin.on("error", (error) => fail(error, child));
        child.on("error", (error) => fail(error, child));
        child.on("exit", () => fail(new Error("Windows 助手已关闭"), child));
        return child;
      }).finally(() => { opening = null; });
      return opening;
    }

    async function request(command, values = {}) {
      const child = await open();
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          fail(new Error("Windows 助手响应超时"), child);
          child.kill();
        }, timeout);
        pending.set(id, { timer, resolve, reject });
        child.stdin.write(JSON.stringify({ ...values, id, command }) + "\n", (error) => {
          if (error) fail(error, child);
        });
      });
    }

    function stop() {
      stopped = true;
      const child = process;
      if (!child) return;
      fail(new Error("Windows 助手已退出"), child);
      child.stdin.end();
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 2000);
      timer.unref();
      child.once("exit", () => clearTimeout(timer));
    }

    return { request, stop };
  }

  return { executable, client };
}

async function buildNative(directory) {
  const contents = await Promise.all(sources.map((name) => fs.readFile(path.join(__dirname, "native", name))));
  const hash = createHash("sha256");
  for (const source of contents) hash.update(source);
  const key = hash.digest("hex").slice(0, 20);
  const folder = path.join(directory, "native");
  const executable = path.join(folder, "dock-" + key + ".exe");
  await fs.mkdir(folder, { recursive: true });
  try { await fs.access(executable); return executable; } catch { /* Compile the current sources. */ }

  const scratch = await fs.mkdtemp(path.join(folder, "build-"));
  const target = path.join(scratch, "dock.exe");
  try {
    const locations = sources.map((name) => path.join(scratch, name));
    await Promise.all(locations.map((location, index) => fs.writeFile(location, contents[index])));
    const tool = path.win32.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET",
      "Framework64", "v4.0.30319", "csc.exe");
    try {
      await runFile(tool, [
        "/nologo", "/utf8output", "/codepage:65001", "/optimize+", "/target:exe", "/platform:x64",
        "/out:" + target, ...libraries.map((name) => "/reference:" + name + ".dll"), ...locations,
      ], { windowsHide: true, timeout: 25000 });
    } catch (error) {
      throw new Error("无法编译 Windows 助手：" + (error.stdout || error.stderr || error.message).trim());
    }
    try { await fs.rename(target, executable); }
    catch (error) { await fs.access(executable).catch(() => { throw error; }); }
    return executable;
  } finally {
    await Promise.all([...sources.map((name) => path.join(scratch, name)), target]
      .map((file) => fs.rm(file, { force: true }).catch(() => {})));
    await fs.rmdir(scratch).catch(() => {});
  }
}

module.exports = { createNative, buildNative };
