"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("the Windows update helper survives the app exiting and receives literal paths", { skip: process.platform !== "win32", timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tangli test & ! % ' "));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, "helper's test.ps1"), marker = path.join(dir, "ready.txt"), result = path.join(dir, "result.txt");
  const payload = "literal & ! % ' 路径";
  fs.writeFileSync(script, [
    "param([int]$ParentId,[string]$HandoffFile,[string]$Output,[string]$Message)",
    "[IO.File]::WriteAllText($HandoffFile,'ready')",
    "while (Get-Process -Id $ParentId -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 100 }",
    "[IO.File]::WriteAllText($Output,$Message,[Text.UTF8Encoding]::new($false))",
  ].join("\n"));
  const modulePath = path.resolve(__dirname, "..", "update-launch.js");
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const parentSource = `
    const fs=require('fs'),{spawn}=require('child_process'),{createUpdaterLaunch}=require(${JSON.stringify(modulePath)});
    const launch=createUpdaterLaunch(${JSON.stringify(powershell)},${JSON.stringify(script)},
      {ParentId:process.pid,HandoffFile:${JSON.stringify(marker)},Output:${JSON.stringify(result)},Message:${JSON.stringify(payload)}});
    const child=spawn(launch.executable,launch.args,{detached:true,windowsHide:true,windowsVerbatimArguments:true,env:launch.env,stdio:'ignore'});
    let count=0;const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(marker)})){clearInterval(timer);child.unref();}
      else if(++count>100){clearInterval(timer);child.kill();process.exitCode=1;}},100);
  `;
  const parent = spawn(process.execPath, ["-e", parentSource], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let errors = "";
  parent.stderr.on("data", (chunk) => { errors += chunk.toString(); });
  const exit = await new Promise((resolve, reject) => { parent.once("error", reject); parent.once("exit", resolve); });
  assert.equal(exit, 0, errors);
  for (let i = 0; i < 100 && !fs.existsSync(result); i++) await pause(100);
  assert.equal(fs.existsSync(result), true, "The helper stopped when its parent exited");
  assert.equal(fs.readFileSync(result, "utf8"), payload);
});
