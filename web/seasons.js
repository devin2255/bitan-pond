(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PondSeasons = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const names = ["spring", "summer", "autumn", "winter"];
  const transitionDays = 21;

  function localDate(date, timeZone) {
    try {
      const parts = {};
      new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
        .formatToParts(date).forEach((part) => { parts[part.type] = Number(part.value); });
      return { year: parts.year, month: parts.month - 1, day: parts.day };
    } catch (err) {
      return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
    }
  }

  // Calendar seasons are an approximation; southern locations are reversed.
  // Natural transitions take three weeks instead of flipping on one day.
  function resolve(date, timeZone, latitude, mode) {
    const weights = { spring: 0, summer: 0, autumn: 0, winter: 0 };
    if (names.includes(mode)) {
      weights[mode] = 1;
      return weights;
    }
    const local = localDate(date, timeZone);
    const today = Date.UTC(local.year, local.month, local.day);
    const starts = [];
    for (let year = local.year - 1; year <= local.year; year++) {
      [2, 5, 8, 11].forEach((month, i) => starts.push({ at: Date.UTC(year, month, 1), index: i }));
    }
    const current = starts.filter((item) => item.at <= today).pop();
    const offset = Number.isFinite(latitude) && latitude < 0 ? 2 : 0;
    const index = (current.index + offset) % 4;
    const progress = Math.min(1, Math.max(0, (today - current.at) / (86400000 * transitionDays)));
    const eased = progress * progress * (3 - 2 * progress);
    weights[names[(index + 3) % 4]] = 1 - eased;
    weights[names[index]] = eased;
    return weights;
  }

  return { resolve, names };
});
