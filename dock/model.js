const path = require("node:path");

const defaults = Object.freeze({
  enabled: false,
  material: "frosted",
  layout: "floating",
  edge: "bottom",
  displayId: null,
  opacity: 78,
  iconSize: 40,
  magnify: false,
  autohide: false,
  followPond: false,
  pins: [],
  indexRoots: [],
});

function pathKey(value) {
  return path.win32.normalize(value).toLowerCase();
}

function normalizePin(value) {
  if (!value || typeof value !== "object") return null;
  const type = value.type === "app" ? "app" : "path";
  const target = typeof value.target === "string" ? value.target.trim() : "";
  if (!target || target.length > 32767 || target.includes("\0")) return null;
  if (type === "path" && !/^(?:[a-z]:[\\/]|\\\\[^\\.?])/i.test(target)) return null;
  if (type === "app") {
    const simple = /^[\p{L}\p{N}_.!{}+@ -]+$/u.test(target);
    const knownFolder = /^\{[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\}(?:\\[^\\/:*?"<>|\x00-\x1f]+)+$/i.test(target);
    if ((!simple && !knownFolder) || target.split("\\").some((part) => part === "." || part === "..")) return null;
  }
  return {
    id: `${type}:${type === "path" ? pathKey(target) : target.toLowerCase()}`,
    type,
    target,
    name: typeof value.name === "string" && value.name.trim()
      ? value.name.trim().slice(0, 200)
      : type === "path" ? path.win32.basename(target) || target : target,
  };
}

function normalizeSettings(value = {}) {
  if (!value || typeof value !== "object") value = {};
  const choose = (key, choices) => choices.includes(value[key]) ? value[key] : defaults[key];
  const number = (key, min, max) => Number.isFinite(value[key])
    ? Math.max(min, Math.min(max, Math.round(value[key]))) : defaults[key];
  const pins = new Map();
  for (const item of Array.isArray(value.pins) ? value.pins : []) {
    const pin = normalizePin(item);
    if (pin && !pins.has(pin.id) && pins.size < 150) pins.set(pin.id, pin);
  }
  const roots = (Array.isArray(value.indexRoots) ? value.indexRoots : [])
    .filter((root) => typeof root === "string" && /^[a-z]:\\$/i.test(root))
    .map((root) => root.toUpperCase());
  return {
    enabled: value.enabled === true,
    material: choose("material", ["frosted", "transparent", "solid"]),
    layout: choose("layout", ["floating", "full"]),
    edge: choose("edge", ["bottom", "left", "right"]),
    displayId: Number.isSafeInteger(value.displayId) ? value.displayId : null,
    opacity: number("opacity", 35, 100),
    iconSize: number("iconSize", 28, 56),
    magnify: value.magnify === true,
    autohide: value.autohide === true,
    followPond: value.followPond === true,
    pins: [...pins.values()],
    indexRoots: [...new Set(roots)].sort(),
  };
}

function dockGeometry(display, settings, itemCount) {
  const area = display.workArea;
  const edge = settings.edge;
  const full = settings.layout === "full";
  const vertical = edge !== "bottom";
  const gap = full ? 0 : 7;
  const thickness = settings.iconSize + 20;
  const room = (vertical ? area.height : area.width) - gap * 2;
  // Three compact utility buttons, Start, app slots, and the group separators.
  const desired = Math.max(0, itemCount - 4) * (settings.iconSize + 9) + 4 * (settings.iconSize + 1) + 34;
  const length = Math.max(1, full ? room : Math.min(room, Math.max(180, desired)));
  const width = vertical ? thickness : length;
  const height = vertical ? length : thickness;
  return {
    edge, full, thickness, vertical,
    bounds: {
      x: vertical ? edge === "left" ? area.x + gap : area.x + area.width - width - gap
        : area.x + Math.floor((area.width - width) / 2),
      y: vertical ? area.y + Math.floor((area.height - height) / 2)
        : area.y + area.height - height - gap,
      width, height,
    },
  };
}

function groupWindows(windows, pins) {
  const matches = new Map();
  for (const pin of pins) {
    if (pin.appKey && !matches.has(pin.appKey)) matches.set(pin.appKey, pin.id);
  }
  const groups = new Map();
  for (const win of windows) {
    const key = matches.get(win.appKey) || win.appKey;
    if (!groups.has(key)) {
      groups.set(key, { id: key, appKey: win.appKey, name: win.name, path: win.path, appId: win.appId, windows: [] });
    }
    groups.get(key).windows.push(win);
  }
  return [...groups.values()];
}

module.exports = { defaults, normalizePin, normalizeSettings, pathKey, dockGeometry, groupWindows };
