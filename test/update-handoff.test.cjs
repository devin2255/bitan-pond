"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { waitForUpdaterHandoff } = require("../update-handoff");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tangli-handoff-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { file: path.join(dir, "handoff.txt"), child: { exitCode: null, signalCode: null } };
}

test("waits for the current helper to acknowledge before quitting", async (t) => {
  const { file, child } = fixture(t);
  setTimeout(() => fs.writeFileSync(file, "current-token"), 30);
  await waitForUpdaterHandoff(child, file, "current-token", { timeout: 500, poll: 5, settle: 5 });
  assert.equal(fs.existsSync(file), false);
});

test("does not accept stale acknowledgements or a helper that exits", async (t) => {
  const { file, child } = fixture(t);
  fs.writeFileSync(file, "old-token");
  setTimeout(() => { child.exitCode = 1; }, 30);
  await assert.rejects(waitForUpdaterHandoff(child, file, "current-token", { timeout: 500, poll: 5, settle: 5 }), /未能启动/);
});

test("reports an unresponsive helper instead of silently closing the app", async (t) => {
  const { file, child } = fixture(t);
  await assert.rejects(waitForUpdaterHandoff(child, file, "current-token", { timeout: 30, poll: 5, settle: 5 }), /超时/);
});

test("rejects a helper that exits just after acknowledging", async (t) => {
  const { file, child } = fixture(t);
  fs.writeFileSync(file, "current-token");
  setTimeout(() => { child.exitCode = 1; }, 10);
  await assert.rejects(waitForUpdaterHandoff(child, file, "current-token", { timeout: 500, poll: 5, settle: 40 }), /意外退出/);
});

test("a cancelled helper leaves the running installation untouched", { skip: process.platform !== "win32", timeout: 15000 }, async (t) => {
  const { file } = fixture(t), dir = path.dirname(file);
  const source = path.join(dir, "new.exe"), target = path.join(dir, "current.exe"), cancel = path.join(dir, "cancel.txt"), status = path.join(dir, "status.json");
  fs.writeFileSync(source, "new version"); fs.writeFileSync(target, "old version");
  const sha = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  const token = crypto.randomBytes(16).toString("hex");
  const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const child = spawn(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.resolve(__dirname, "..", "portable-update.ps1"),
    "-ParentId", String(process.pid), "-Source", source, "-Target", target, "-Sha256", sha, "-ReadyToken", token,
    "-HandoffFile", file, "-CancelFile", cancel, "-StatusFile", status, "-NoUserInterface"], { windowsHide: true, stdio: "ignore" });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await waitForUpdaterHandoff(child, file, token, { timeout: 8000, poll: 25, settle: 25 });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  fs.writeFileSync(cancel, token);
  assert.equal(await exited, 1);
  assert.equal(JSON.parse(fs.readFileSync(status, "utf8")).state, "failed");
  assert.equal(fs.readFileSync(target, "utf8"), "old version");
});

test("a helper never replaces the app if the handoff was not committed", { skip: process.platform !== "win32", timeout: 15000 }, async (t) => {
  const { file } = fixture(t), dir = path.dirname(file);
  const source = path.join(dir, "new.exe"), target = path.join(dir, "current.exe"), commit = path.join(dir, "commit.txt"), status = path.join(dir, "status.json");
  fs.writeFileSync(source, "new version"); fs.writeFileSync(target, "old version");
  const sha = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"), token = crypto.randomBytes(16).toString("hex");
  const ps = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const child = spawn(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.resolve(__dirname, "..", "portable-update.ps1"),
    "-ParentId", "2147483647", "-Source", source, "-Target", target, "-Sha256", sha, "-ReadyToken", token,
    "-HandoffFile", file, "-CommitFile", commit, "-StatusFile", status, "-NoUserInterface"], { windowsHide: true, stdio: "ignore" });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  assert.equal(await new Promise((resolve) => child.once("exit", resolve)), 1);
  assert.equal(JSON.parse(fs.readFileSync(status, "utf8")).state, "failed");
  assert.equal(fs.readFileSync(target, "utf8"), "old version");
});
