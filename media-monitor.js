"use strict";

// Smooth short gaps between tracks and ignore very brief media sessions.
function createStabilizer(startDelay = 1200, stopDelay = 2250) {
  let candidate = false, since = null, playing = false;
  return {
    update(raw, now) {
      raw = !!raw;
      if (since === null || candidate !== raw) { candidate = raw; since = now; }
      if (candidate !== playing && now - since >= (candidate ? startDelay : stopDelay)) playing = candidate;
      return playing;
    },
    reset() { candidate = false; since = null; playing = false; },
  };
}

module.exports = { createStabilizer };
