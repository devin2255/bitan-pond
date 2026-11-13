"use strict";

// Consume only short-lived RMS levels, never audio samples or song metadata.
// A rolling baseline finds onsets; a median interval rejects occasional noise.
function createBeatTracker() {
  const history = [], intervals = [];
  let lastBeat = null, lastEmitted = null, lastTime = null, previous = 0;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const median = (values) => {
    const ordered = values.slice().sort((a, b) => a - b), mid = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2;
  };
  function reset() { history.length = 0; intervals.length = 0; lastBeat = null; lastEmitted = null; lastTime = null; previous = 0; }
  function update(full, low, time) {
    if (![full, low, time].every(Number.isFinite)) return null;
    if (lastTime != null && (time < lastTime || time - lastTime > 2500)) reset();
    lastTime = time;
    const energy = clamp(full, 0, 1) * 0.35 + clamp(low, 0, 1) * 0.65;
    const average = history.length ? history.reduce((sum, value) => sum + value, 0) / history.length : 0;
    const onset = history.length >= 5 && energy > Math.max(0.00004, average * 1.45) &&
      energy > previous * 1.20 && (lastBeat == null || time - lastBeat >= 240);
    history.push(energy);
    if (history.length > 24) history.shift();
    previous = energy;
    if (!onset) return null;
    if (lastBeat != null) {
      let interval = time - lastBeat;
      if (interval > 1200) intervals.length = 0;
      else if (interval >= 240) {
        if (interval < 335) interval *= 2;
        intervals.push(interval);
        if (intervals.length > 8) intervals.shift();
      }
    }
    lastBeat = time;
    if (intervals.length < 3) return null;
    const beatMs = median(intervals);
    const deviation = median(intervals.map((value) => Math.abs(value - beatMs))) / Math.max(1, beatMs);
    const confidence = clamp((intervals.length - 2) / 4, 0, 1) * clamp(1 - deviation / 0.24, 0, 1);
    if (confidence < 0.4 || (lastEmitted != null && time - lastEmitted < beatMs * 0.65)) return null;
    lastEmitted = time;
    return { bpm: clamp(60000 / beatMs, 50, 180), confidence,
      strength: clamp((energy / Math.max(average, 0.00001) - 1) / 4, 0, 1) };
  }
  return { update, reset };
}

module.exports = { createBeatTracker };
