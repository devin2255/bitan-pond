(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PondFishMotion = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const TAU = Math.PI * 2;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const profiles = {
    koi:       { wave: 1,    beat: 1,    tail: 0.045 },
    goldfish:  { wave: 0.82, beat: 0.95, tail: 0.11 },
    crucian:   { wave: 0.90, beat: 1.04, tail: 0.055 },
    grasscarp: { wave: 1.08, beat: 1.08, tail: 0.04 },
    ranchu:    { wave: 0.74, beat: 1.04, tail: 0.10 },
    guppy:     { wave: 0.97, beat: 1.18, tail: 0.16 },
    betta:     { wave: 0.78, beat: 0.82, tail: 0.18 },
  };

  function random01(random) { return clamp(Number(random()) || 0, 0, 1); }
  function profile(species) { return profiles[species] || profiles.koi; }
  function approach(current, target, rate, dt) { return current + (target - current) * (1 - Math.exp(-rate * dt)); }

  function create(baseSpeed, phase, random = Math.random) {
    const factor = 0.72 + random01(random) * 0.42;
    return { cruiseFactor: factor, targetFactor: factor, changeIn: 8 + random01(random) * 52,
      speed: Math.max(0, baseSpeed) * factor, ratio: factor,
      phase: Number.isFinite(phase) ? phase : 0, finPhase: (Number.isFinite(phase) ? phase : 0) * 0.73,
      turnRate: 0 };
  }

  // Choose an individual cruising speed about once per minute. The target is
  // approached over several seconds, while a startled fish accelerates faster.
  function advance(motion, baseSpeed, weather, boost, dt, species, random = Math.random) {
    if (!(dt > 0)) return motion;
    const base = Math.max(1, baseSpeed);
    motion.changeIn -= dt;
    while (motion.changeIn <= 0) {
      motion.targetFactor = 0.55 + random01(random) * 0.70;
      motion.changeIn += 50 + random01(random) * 20;
    }
    motion.cruiseFactor = approach(motion.cruiseFactor, motion.targetFactor, 0.18, dt);
    const desired = (base * motion.cruiseFactor + (boost ? 46 : 0)) * clamp(weather, 0, 2);
    motion.speed = approach(motion.speed, desired, boost ? 3.2 : 1.1, dt);
    motion.ratio = clamp(motion.speed / base, 0.1, 2.2);
    const p = profile(species);
    motion.phase = (motion.phase + dt * TAU * (0.48 + motion.ratio * 0.73) * p.beat) % TAU;
    motion.finPhase = (motion.finPhase + dt * TAU * (0.52 + motion.ratio * 0.52) * p.beat) % TAU;
    return motion;
  }

  function turn(motion, difference, dt) {
    const desired = clamp(difference * 2.1, -2.2, 2.2);
    motion.turnRate = approach(motion.turnRate, desired, 3.8, dt);
    return motion.turnRate * dt;
  }

  // The head stays steady while a delayed wave travels down the body to the
  // tail. Turning adds a small continuous curve in the opposite direction.
  function bend(motion, x, species) {
    const u = clamp((35 - x) / 113, 0, 1);
    const envelope = u * u;
    const amplitude = (3.5 + 5.8 * clamp(motion.ratio, 0, 1.6)) * profile(species).wave;
    return envelope * (amplitude * Math.sin(motion.phase - u * 3.5) - clamp(motion.turnRate, -2, 2) * 2.3);
  }

  function spread(motion, x, species) {
    const u = clamp((35 - x) / 113, 0, 1);
    const tail = clamp((u - 0.42) / 0.58, 0, 1);
    const fan = profile(species).tail * tail * (0.5 - 0.5 * Math.cos(motion.phase - u * 2.2));
    const nearFin = Math.exp(-(((x - 15) / 17) ** 2)) * 0.05 * Math.sin(motion.finPhase);
    return 1 - fan + nearFin;
  }

  function draw(ctx, image, motion, species, bounds) {
    const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
    const width = bounds.x1 - bounds.x0, height = width * ih / iw;
    const strips = 22, stripWidth = width / strips, overlap = 0.45;
    for (let i = 0; i < strips; i++) {
      const a = Math.max(bounds.x0, bounds.x0 + i * stripWidth - overlap);
      const b = Math.min(bounds.x1, bounds.x0 + (i + 1) * stripWidth + overlap);
      const center = bounds.x0 + (i + 0.5) * stripWidth;
      const offset = bend(motion, center, species);
      const slope = bend(motion, center + 0.5, species) - bend(motion, center - 0.5, species);
      ctx.save(); ctx.translate(center, offset); ctx.rotate(Math.atan(slope));
      ctx.scale(1, spread(motion, center, species));
      ctx.drawImage(image, ((a - bounds.x0) / width) * iw, 0, ((b - a) / width) * iw, ih,
        a - center, -height / 2, b - a, height);
      ctx.restore();
    }
  }

  return { create, advance, turn, bend, spread, draw };
});
