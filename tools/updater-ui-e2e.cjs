"use strict";

// Explicit, isolated integration test: start an actual installed old version,
// request its real signed update, click its native confirmation dialogs, and
// verify the replacement and restarted window. It never targets user files.
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const [setupArg, expectedArg] = process.argv.slice(2);
const oldSetup = setupArg && path.resolve(setupArg);
if (!oldSetup || !expectedArg || process.platform !== "win32") {
  console.error("Usage: node tools/updater-ui-e2e.cjs <old-setup.exe> <expected-new-exe-or-sha256>");
  process.exit(2);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const testId = crypto.randomBytes(16).toString("hex");
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const testRoot = fs.mkdtempSync(path.join(root, "dist", "update-ui-e2e-"));
const install = path.join(testRoot, "installed"), profile = path.join(testRoot, "profile");
const temp = path.join(testRoot, "temp"), programs = path.join(testRoot, "programs");
for (const dir of [profile, temp, programs]) fs.mkdirSync(dir, { recursive: true });
const target = path.join(install, "塘里.exe"), statusFile = path.join(profile, "update-status.json");
const env = { ...process.env, TEMP: temp, TMP: temp, TANGLI_TEST_MODE: "1", TANGLI_TEST_USER_DATA: profile, TANGLI_TEST_PROGRAMS: programs };
let wrapper, driver, socket, success = false;
let driverText = "";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function evaluate(socket, expression) {
  const id = Math.floor(Math.random() * 1000000000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.removeEventListener("message", onMessage); reject(new Error("DevTools response timed out")); }, 10000);
    function onMessage(event) {
      const data = JSON.parse(String(event.data));
      if (data.id !== id) return;
      clearTimeout(timer); socket.removeEventListener("message", onMessage);
      if (data.error || data.result?.exceptionDetails) reject(new Error(JSON.stringify(data.error || data.result.exceptionDetails)));
      else resolve(data.result?.result?.value);
    }
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
}

async function run() {
  const expected = /^[a-f\d]{64}$/i.test(expectedArg) ? expectedArg.toLowerCase() : hash(path.resolve(expectedArg));
  const setup = spawnSync(oldSetup, ["/S", `/TANGLI_TEST_ROOT=${testRoot}`, `/TANGLI_TEST_ID=${testId}`, `/D=${install}`],
    { env, windowsHide: true, timeout: 120000, encoding: "utf8" });
  if (setup.error || setup.status !== 0 || !fs.existsSync(target)) throw new Error(`Isolated setup failed: ${setup.error || setup.status}`);
  if (hash(target) === expected) throw new Error("The old installation already matches the expected update");
  const port = await freePort();
  wrapper = spawn(target, [`--remote-debugging-port=${port}`, `--tangli-e2e=${testId}`], { env, windowsHide: true, stdio: "ignore" });
  wrapper.on("error", (error) => { driverText += `\nlauncher error: ${error.message}`; });
  driver = spawn(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "update-dialog-driver.ps1"), "-TestId", testId],
    { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  driver.stdout.on("data", (chunk) => { driverText += chunk.toString(); });
  driver.stderr.on("data", (chunk) => { driverText += chunk.toString(); });
  let page;
  const startupDeadline = Date.now() + 80000;
  while (Date.now() < startupDeadline && !page) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((item) => item.type === "page" && item.webSocketDebuggerUrl); }
    catch (_) { /* The portable launcher is still unpacking. */ }
    if (!page) await pause(500);
  }
  if (!page) throw new Error("The old application's debugging endpoint did not become ready");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    ready = await evaluate(socket, "document.readyState === 'complete' && !!window.appUpdates");
    if (!ready) await pause(250);
  }
  if (!ready) throw new Error("The old application did not finish loading");
  await evaluate(socket, "window.appUpdates.check(); true");
  let state = null;
  const deadline = Date.now() + 210000;
  let confirmTime = null;
  while (Date.now() < deadline) {
    if ((driverText.match(/clicked:/g) || []).length >= 2 && confirmTime === null) confirmTime = Date.now();
    try { state = JSON.parse(fs.readFileSync(statusFile, "utf8")); } catch (_) { /* no state yet */ }
    if (state?.state === "failed") throw new Error(`The actual updater failed: ${state.detail}`);
    if (state?.state === "complete") break;
    if (driver.exitCode && driver.exitCode !== 0) throw new Error(`Dialog driver failed: ${driverText}`);
    if (confirmTime !== null && !state && Date.now() - confirmTime > 25000) throw new Error("The updater did not start after confirmation");
    await pause(500);
  }
  if (state?.state !== "complete") throw new Error(`Update did not complete; last state=${JSON.stringify(state)}; dialogs=${driverText}`);
  if (hash(target) !== expected) throw new Error("Installed executable does not match the downloaded release");
  if ((driverText.match(/clicked:/g) || []).length !== 2) throw new Error(`Not all real update buttons were clicked: ${driverText}`);
  const escaped = testRoot.replace(/'/g, "''");
  const visibleQuery = `$r='${escaped}'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($r, [StringComparison]::OrdinalIgnoreCase) -and $_.CommandLine -and $_.CommandLine.Contains('--tangli-update-ready=') } | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { 'VISIBLE' } }`;
  let visible = false;
  for (let i = 0; i < 20 && !visible; i++) {
    const query = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", visibleQuery], { windowsHide: true, timeout: 10000, encoding: "utf8" });
    visible = query.status === 0 && query.stdout.includes("VISIBLE");
    if (!visible) await pause(500);
  }
  if (!visible) throw new Error("The updated application did not open a visible window");
  success = true;
  console.log(JSON.stringify({ ok: true, testRoot, updated: state.state, visible, sha256: expected, dialogs: driverText.trim() }));
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (socket) socket.close();
  if (driver && driver.exitCode == null) driver.kill();
  // The test profile and TEMP are unique, so only processes whose executable
  // resides under this test directory can be stopped here.
  const escaped = testRoot.replace(/'/g, "''");
  const command = `$r='${escaped}'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($r, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 15000 });
  if (success) {
    const uninstall = path.join(install, "卸载塘里.exe");
    if (fs.existsSync(uninstall)) spawnSync(uninstall, ["/S", `/TANGLI_TEST_ROOT=${testRoot}`, `/TANGLI_TEST_ID=${testId}`], { env, windowsHide: true, timeout: 60000 });
  } else {
    console.error(`Diagnostics retained at ${testRoot}; dialog output: ${driverText}`);
  }
});
