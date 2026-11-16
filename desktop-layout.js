// Electron reports DIP coordinates, while the desktop hook and WorkerW use
// physical pixels. Pair each display with its actual Windows monitor rectangle.
function contains(rect, point) {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

function matchDisplays(displays, monitors, dipToScreenPoint) {
  const remaining = monitors.slice();
  return displays.map((display) => {
    const b = display.bounds;
    const point = dipToScreenPoint({ x: Math.floor(b.x + b.width / 2), y: Math.floor(b.y + b.height / 2) });
    const index = remaining.findIndex((monitor) => contains(monitor, point));
    if (index < 0) throw new Error(`Cannot match display ${display.id} to a Windows monitor`);
    const [rect] = remaining.splice(index, 1);
    return { id: display.id, bounds: { ...b }, rect: { ...rect } };
  });
}

function targetAt(entries, x, y) {
  return entries.find((entry) => contains(entry.rect, { x, y })) || null;
}

function normalizedPoint(rect, x, y) {
  return [(x - rect.x) / rect.width, (y - rect.y) / rect.height];
}

module.exports = { contains, matchDisplays, targetAt, normalizedPoint };
