(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PondPerformance = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const TAU = Math.PI * 2;
  function frogOwnsLeaf(index, seats, frogs) {
    if (index < 0) return false;
    if (seats.some((seat) => seat.leaf === index && seat.frog)) return true;
    return frogs.some((frog) => [frog.seat, frog.goal, frog.jump && frog.jump.seat]
      .some((seat) => seat && seat.leaf === index));
  }
  function chooseLeaf(candidates, previous, random = Math.random) {
    if (!candidates.length) return null;
    const others = candidates.filter((leaf) => leaf !== previous);
    const pool = others.length ? others : candidates;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  }
  function conflictsWithReservedLeaf(leaf, radius, other, otherRadius) {
    return !!other && (leaf === other || Math.hypot(leaf.cx - other.cx, leaf.cy - other.cy) <
      (radius + otherRadius) * 1.1);
  }
  // The scene rebuilds leaf objects when artwork loads or the window resizes.
  // Match the old physical leaf instead of treating that as a new destination.
  function matchLeaf(previous, candidates, width, height, oldWidth, oldHeight, radius) {
    if (!previous || !candidates.length) return null;
    const sx = oldWidth ? width / oldWidth : 1, sy = oldHeight ? height / oldHeight : 1;
    const x = previous.cx * sx, y = previous.cy * sy;
    const limit = Math.max(12, radius * 1.1 * Math.min(sx, sy));
    let match = null, nearest = limit;
    candidates.forEach((leaf) => {
      const distance = Math.hypot(leaf.cx - x, leaf.cy - y);
      if (distance <= nearest) { nearest = distance; match = leaf; }
    });
    return match;
  }
  function ringSlot(index, count, time, width, height) {
    const radius = Math.min(Math.min(width, height) * 0.30, Math.max(80, 64 + count * 3));
    const angle = -Math.PI / 2 + TAU * index / Math.max(1, count) + time * 0.20;
    return { x: width / 2 + radius * Math.cos(angle), y: height / 2 + radius * Math.sin(angle),
      tangentX: -Math.sin(angle), tangentY: Math.cos(angle), radius, angle };
  }

  const formations = ["ring", "lotus", "heart", "double", "spiral"];
  const holdSeconds = 11.5, transitionSeconds = 4.5, period = holdSeconds + transitionSeconds;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
  const wrap = (x) => ((x % 1) + 1) % 1;
  const oneHot = (name) => Object.fromEntries(formations.map((f) => [f, f === name ? 1 : 0]));

  // Fewer fish make complex outlines illegible: retain simpler patterns first.
  function availableFormations(count) {
    if (count < 12) return ["ring"];
    if (count < 24) return ["ring", "heart"];
    if (count < 40) return ["ring", "heart", "double"];
    return formations.slice();
  }

  function mixWeights(a, b, amount) {
    const t = smooth(amount);
    return Object.fromEntries(formations.map((name) => [name, (a[name] || 0) * (1 - t) + (b[name] || 0) * t]));
  }

  function formationWeights(time, count, selection = "auto", transition = null, automaticWeights = null) {
    const available = availableFormations(count);
    let target;
    if (selection !== "auto") target = oneHot(available.includes(selection) ? selection : "ring");
    else if (automaticWeights) target = automaticWeights;
    else {
      const clock = Math.max(0, time), stage = Math.floor(clock / period), within = clock % period;
      const current = available[stage % available.length], next = available[(stage + 1) % available.length];
      target = mixWeights(oneHot(current), oneHot(next), (within - holdSeconds) / transitionSeconds);
    }
    if (transition && time < transition.start + transitionSeconds) {
      return mixWeights(transition.from, target, (time - transition.start) / transitionSeconds);
    }
    return target;
  }

  // Hold for a short musical phrase, then start the morph on the next beat.
  // A deadline also covers sparse or unreliable detections: a few sporadic
  // beats must not postpone a formation indefinitely.
  function createConductor() {
    let stage = 0, phase = "hold", elapsed = 0, clock = 0, beatCount = 0;
    let lastBeatAt = -Infinity, tempo = 0, duration = transitionSeconds;
    const beatTimeout = 3, beatWait = 1.2;
    const freshBeat = () => tempo > 0 && clock - lastBeatAt <= beatTimeout;
    const targetHold = () => freshBeat() ? clamp(16 * 60 / tempo, 5.5, 16) : holdSeconds;
    function reset() { stage = 0; phase = "hold"; elapsed = 0; clock = 0; beatCount = 0; lastBeatAt = -Infinity; tempo = 0; duration = transitionSeconds; }
    function resetRhythm() { beatCount = 0; lastBeatAt = -Infinity; tempo = 0; }
    function beginTransition(withBeat) {
      phase = "transition"; elapsed = 0; beatCount = 0;
      duration = withBeat && tempo > 0 ? clamp(8 * 60 / tempo, 2.8, 6) : transitionSeconds;
    }
    function advance(dt) {
      dt = clamp(Number(dt) || 0, 0, 5);
      clock += dt; elapsed += dt;
      if (phase === "hold" && elapsed >= targetHold() + (freshBeat() ? beatWait : 0)) beginTransition(freshBeat());
      else if (phase === "transition" && elapsed >= duration) {
        stage++; phase = "hold"; elapsed -= duration; beatCount = 0;
      }
    }
    function beat(event) {
      const bpm = Number(event && event.bpm), confidence = Number(event && event.confidence);
      if (!(bpm >= 50 && bpm <= 180 && confidence >= 0.4)) return;
      lastBeatAt = clock; tempo = bpm;
      if (phase === "hold") {
        beatCount++;
        if (elapsed + 1e-6 >= targetHold()) beginTransition(true);
      }
    }
    function position(ahead = 0) {
      const within = phase === "transition" ? holdSeconds + transitionSeconds * clamp((elapsed + ahead) / duration, 0, 1) : 0;
      return stage * period + within;
    }
    return { reset, resetRhythm, advance, beat, position,
      state: () => ({ stage, phase, elapsed, beatCount, tempo, duration, synchronized: freshBeat() }) };
  }

  // Curves are dimensionless. Sampling by arc length keeps the fish spaced
  // along the outline instead of bunching up at corners and narrow petals.
  function curve(name, u) {
    const t = TAU * u;
    if (name === "lotus") {
      const angle = t - Math.PI / 2, r = 0.70 + 0.30 * Math.cos(5 * t);
      return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    }
    if (name === "heart") {
      return { x: 16 * Math.sin(t) ** 3 / 17,
        y: -(13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t)) / 17 - 0.08 };
    }
    if (name === "spiral") {
      // An open spiral: its turns never cross one another. Rotate the whole
      // curve in shapePoint rather than wrapping a fish from one end to the other.
      const angle = 1.55 * t - Math.PI / 2, r = 0.53 + 0.47 * u;
      return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    }
    return { x: Math.sin(t), y: -Math.cos(t) };
  }

  const arcTables = {};
  function arcParameter(name, progress) {
    if (name === "ring") return wrap(progress);
    let table = arcTables[name];
    if (!table) {
      const steps = 480, lengths = [0]; let last = curve(name, 0), total = 0;
      for (let i = 1; i <= steps; i++) {
        const point = curve(name, i / steps);
        total += Math.hypot(point.x - last.x, point.y - last.y);
        lengths.push(total); last = point;
      }
      table = arcTables[name] = { lengths, total, steps };
    }
    const wanted = wrap(progress) * table.total;
    let lo = 0, hi = table.steps;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (table.lengths[mid] < wanted) lo = mid; else hi = mid; }
    const distance = table.lengths[hi] - table.lengths[lo];
    return (lo + (distance ? (wanted - table.lengths[lo]) / distance : 0)) / table.steps;
  }

  const spiralSlots = new Map();
  function spiralPoint(index, count) {
    let slots = spiralSlots.get(count);
    if (!slots) {
      // Assign the two turns by their actual polar angle, interleaving the
      // inner and outer fish just like the double ring. Equal arc-length slots
      // stay evenly distributed along the open spiral.
      slots = Array.from({ length: count }, (_, i) => {
        const point = curve("spiral", arcParameter("spiral", (i + 0.5) / count));
        return { ...point, order: wrap((Math.atan2(point.y, point.x) + Math.PI / 2) / TAU) };
      }).sort((a, b) => a.order - b.order);
      spiralSlots.set(count, slots);
    }
    return slots[index];
  }

  function shapePoint(name, index, count, time) {
    const n = Math.max(1, count), phase = time * (0.20 / TAU);
    if (name === "double") {
      const outerCount = Math.max(1, Math.ceil(n * 0.65));
      // Distribute both rings through the original angular order. Dividing the
      // list in two sends half the fish across the pond on every transition.
      const before = Math.floor(index * outerCount / n);
      const after = Math.floor((index + 1) * outerCount / n);
      const outer = after > before, ringCount = Math.max(1, outer ? outerCount : n - outerCount);
      const ringIndex = outer ? after - 1 : index - before;
      const angle = TAU * (ringIndex / ringCount + phase) - Math.PI / 2;
      const radius = outer ? 1 : 0.56;
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    }
    if (name === "spiral") {
      // Rotate the open spiral as one piece so no fish jumps from its end to
      // its beginning.
      const point = spiralPoint(index, n);
      const angle = TAU * phase, cos = Math.cos(angle), sin = Math.sin(angle);
      return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
    }
    if (name === "lotus") {
      // Fish follow the petals slowly enough to turn, while the flower itself
      // also rotates. Together those phases follow the other formations, so
      // a late change cannot send an individual fish across the pond.
      const progress = index / n + phase * 0.30;
      const point = curve(name, arcParameter(name, progress));
      const angle = TAU * phase * 0.70, cos = Math.cos(angle), sin = Math.sin(angle);
      return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
    }
    const progress = index / n + phase;
    return curve(name, arcParameter(name, progress));
  }

  function formationPoint(index, count, time, width, height, weights, performerClearance = 0) {
    const radius = Math.min(Math.min(width, height) * 0.30, Math.max(80, 64 + count * 3));
    let x = 0, y = 0;
    formations.forEach((name) => {
      const weight = weights[name] || 0;
      if (weight <= 0.00001) return;
      const p = shapePoint(name, index, count, time);
      x += p.x * weight; y += p.y * weight;
    });
    // During transitions fish take a path around the performer, not through them.
    const distance = Math.hypot(x, y);
    const soloClear = Math.min(0.34, Math.max(0.18, 38 / Math.max(1, radius)));
    const clear = Math.max(soloClear, Math.min(0.82, Math.max(0, performerClearance) / Math.max(1, radius)));
    if (distance < clear) {
      const angle = distance > 0.0001 ? Math.atan2(y, x) : TAU * index / Math.max(1, count) - Math.PI / 2;
      x = Math.cos(angle) * clear; y = Math.sin(angle) * clear;
    }
    // A slight independent drift leaves breathing room between individuals.
    const drift = Math.sin(time * 0.37 + index * 2.17) * Math.min(3, radius * 0.012);
    const length = Math.hypot(x, y) || 1;
    return { x: width / 2 + x * radius + x / length * drift,
      y: height / 2 + y * radius + y / length * drift, radius, clearance: clear * radius };
  }

  function formationSlot(index, count, time, width, height, weights, nextWeights = weights, timeRate = 1, performerClearance = 0) {
    const step = 0.08;
    const p = formationPoint(index, count, time, width, height, weights, performerClearance);
    const next = formationPoint(index, count, time + step * timeRate, width, height, nextWeights, performerClearance);
    const dx = next.x - p.x, dy = next.y - p.y, length = Math.hypot(dx, dy);
    return { ...p, tangentX: length ? dx / length : 1, tangentY: length ? dy / length : 0,
      velocityX: dx / step, velocityY: dy / step, travelSpeed: clamp(length / step, 0, 160) };
  }

  // Match the moving slot's velocity as well as its position. Avoidance only
  // applies inside the protected area, so it cannot push an inner ring away
  // from its own target and flatten petals or heart lobes.
  function formationGuidance(fish, slot, centerX, centerY) {
    const dx = slot.x - fish.x, dy = slot.y - fish.y, distance = Math.hypot(dx, dy);
    let x = slot.velocityX + dx * 1.25, y = slot.velocityY + dy * 1.25;
    const awayX = fish.x - centerX, awayY = fish.y - centerY, away = Math.hypot(awayX, awayY);
    const safe = Math.max(28, slot.clearance * 0.88);
    if (away < safe) {
      const directionX = away > 0.001 ? awayX / away : (dx >= 0 ? 1 : -1);
      const directionY = away > 0.001 ? awayY / away : 0;
      const force = (1 - away / safe) * 85;
      x += directionX * force; y += directionY * force;
    }
    const length = Math.hypot(x, y), scale = length > 160 ? 160 / length : 1;
    return { x: x * scale, y: y * scale, distance, speed: length * scale };
  }

  return { frogOwnsLeaf, chooseLeaf, conflictsWithReservedLeaf, matchLeaf, ringSlot, formations, holdSeconds, transitionSeconds,
    availableFormations, formationWeights, formationPoint, formationSlot, formationGuidance, createConductor };
});
