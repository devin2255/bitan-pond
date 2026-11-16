// Opt-in Windows integration test using two virtual rectangles on one display.
const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
process.env.TANGLI_SMOKE_OUTPUT = path.join(root, "dist");
const profile = path.join(root, "dist", "multi-display-test-" + Date.now());
fs.mkdirSync(profile, { recursive: true });
electron.app.setPath("appData", profile);
const appRoot = process.env.TANGLI_TEST_APP_ASAR || root;
const entry = path.join(appRoot, "main.js");
const instrument = fs.readFileSync(path.join(__dirname, "multiscreen-smoke-instrument.js"), "utf8");
const target = new Module(entry, module);
target.filename = entry;
target.paths = Module._nodeModulePaths(appRoot).concat(Module._nodeModulePaths(root));
target._compile(fs.readFileSync(entry, "utf8") + "\n" + instrument, entry);
