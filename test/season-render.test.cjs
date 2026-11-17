"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("autumn and winter leaves remain visible during real canvas rendering",
  { skip: process.platform !== "win32", timeout: 90000 }, () => {
    const electron = require("electron"), runner = path.resolve(__dirname, "..", "tools", "season-leaf-render-smoke.cjs");
    for (const software of [false, true]) {
      const args = [runner];
      if (software) args.push("--software");
      const result = spawnSync(electron, args, { windowsHide: true, timeout: 40000, encoding: "utf8" });
      const line = String(result.stdout || "").split(/\r?\n/).find((item) => item.startsWith("{\"ok\":"));
      let report;
      try {
        if (line) report = JSON.parse(line);
        assert.equal(result.status, 0, [result.error?.message, result.stdout, result.stderr].filter(Boolean).join("\n"));
        assert.equal(report?.ok, true);
        assert.ok(report.overOne > 0, "The test must exercise floating-point overflow");
        assert.equal(report.invisible, 0);
        assert.equal(report.changes, 0);
      } finally {
        if (report?.temp && fs.existsSync(report.temp)) {
          const tempBase = fs.realpathSync(os.tmpdir()), target = fs.realpathSync(report.temp);
          if (target.startsWith(tempBase + path.sep) && path.basename(target).startsWith("tangli-season-render-")) {
            fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          }
        }
      }
    }
  });
