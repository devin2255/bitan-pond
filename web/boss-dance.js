(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PondBossDance = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
  const phrases = [
    { name: "舒展划水", turn: 0.14, armBase: 0.03, armMotion: 0.28, armAsym: 0.04, legBase: 0.05, legMotion: 0.10, legAsym: 0.02, kick: 0.12 },
    { name: "花式伸展", turn: -0.16, armBase: 0.13, armMotion: 0.38, armAsym: 0.05, legBase: 0.10, legMotion: 0.16, legAsym: 0.03, kick: 0.08 },
    { name: "侧身划水", turn: 0.22, armBase: 0.03, armMotion: 0.23, armAsym: 0.16, legBase: 0.06, legMotion: 0.09, legAsym: 0.06, kick: 0.14 },
    { name: "交替踢腿", turn: -0.12, armBase: 0.01, armMotion: 0.16, armAsym: 0.07, legBase: 0.05, legMotion: 0.09, legAsym: 0.07, kick: 0.31 },
  ];
  const beatsPerPhrase = 16;
  const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

  function poseAt(phase) {
    const phrase = Math.floor(phase / beatsPerPhrase), within = (phase % beatsPerPhrase) / beatsPerPhrase;
    const from = phrases[phrase % phrases.length], to = phrases[(phrase + 1) % phrases.length];
    // Start changing the movement gradually before the next musical phrase.
    const blend = smooth((within - 0.65) / 0.35);
    const value = (key) => from[key] + (to[key] - from[key]) * blend;
    const stroke = phase * Math.PI / 2, wave = Math.sin(stroke), slow = Math.sin(stroke / 2);
    const arm = value("armBase") + value("armMotion") * wave;
    const leg = value("legBase") + value("legMotion") * (0.5 - 0.5 * Math.cos(stroke));
    const alternating = value("kick") * (0.5 - 0.5 * Math.cos(stroke));
    return {
      armLeft: arm + value("armAsym") * slow,
      armRight: arm - value("armAsym") * slow,
      elbowLeft: 0.10 * Math.sin(stroke - 0.35),
      elbowRight: 0.10 * Math.sin(stroke + 0.35),
      legLeft: Math.max(0, leg + value("legAsym") * slow),
      legRight: Math.max(0, leg - value("legAsym") * slow),
      kickLeft: alternating,
      kickRight: value("kick") - alternating,
      bodySway: 0.012 * Math.sin(stroke / 2),
      tailAmplitude: 0.115,
      bodyWave: 0.018,
      // Four beats per tail wave. Keeping this as a continuous phase lets the
      // mermaid move at the detected tempo without swapping whole poses.
      tailPhase: phase / 4,
    };
  }

  function create() {
    let phase = 0, tempo = 96, targetTempo = 96, beatAge = Infinity, pulse = 0;
    let correction = 0, angle = 0, turn = 0, lastPhrase = 0;
    let rhythmEnabled = true;

    function reset() {
      phase = 0; tempo = targetTempo = 96; beatAge = Infinity; pulse = 0; correction = 0;
      angle = 0; turn = 0; lastPhrase = 0;
    }
    function setRhythmEnabled(value) {
      rhythmEnabled = !!value;
      if (!rhythmEnabled) { targetTempo = 96; beatAge = Infinity; correction = 0; }
    }
    function beat(event) {
      const bpm = Number(event && event.bpm), confidence = Number(event && event.confidence);
      if (!rhythmEnabled || !(bpm >= 50 && bpm <= 180 && confidence >= 0.4)) return;
      targetTempo = bpm; beatAge = 0;
      pulse = Math.max(pulse, clamp(Number(event.strength) || 0.4, 0.2, 1));
      // Gently pull the animation phase towards the heard beat over several
      // frames instead of snapping a limb to a new pose.
      correction = clamp(correction + clamp(Math.round(phase) - phase, -0.35, 0.35) * 0.3, -0.35, 0.35);
    }
    function advance(dt) {
      dt = clamp(Number(dt) || 0, 0, 0.1);
      beatAge += dt;
      if (beatAge > 3.5) targetTempo = 96;
      tempo += (targetTempo - tempo) * (1 - Math.exp(-dt * 1.4));
      const maxNudge = dt * tempo / 60 * 0.3;
      const nudge = clamp(correction * (1 - Math.exp(-dt * 4)), -maxNudge, maxNudge);
      correction -= nudge;
      phase += dt * tempo / 60 + nudge;
      pulse *= Math.exp(-dt * 2.8);
      lastPhrase = Math.floor(phase / beatsPerPhrase) % phrases.length;
      const targetTurn = phrases[lastPhrase].turn * clamp(tempo / 110, 0.7, 1.45);
      turn += (targetTurn - turn) * (1 - Math.exp(-dt * 1.7));
      angle += turn * dt;
    }
    function snapshot() {
      return { phase, tempo, synchronized: rhythmEnabled && beatAge < 3.5,
        pulse, angle, current: phrases[lastPhrase], pose: poseAt(phase) };
    }
    return { reset, setRhythmEnabled, beat, advance, snapshot };
  }

  const formationNames = ["ring", "lotus", "heart", "double", "spiral"];

  // Coordinates are deliberately smaller than the fish outlines so that the
  // swimmer has room to turn without passing through the formation.
  function performancePoint(name, phase) {
    const angle = phase * Math.PI * 2 / 16 - Math.PI / 2;
    if (name === "heart") {
      const t = phase * Math.PI * 2 / 16;
      return { x: 16 * Math.sin(t) ** 3 / 17,
        y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 - 0.08 };
    }
    let radius = 1;
    if (name === "lotus") radius = 0.72 + 0.20 * Math.cos(5 * (angle + Math.PI / 2));
    else if (name === "double") radius = 0.66 + 0.06 * Math.sin(angle * 2);
    else if (name === "spiral") {
      const breathing = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2 / 32);
      radius = 0.20 + 0.72 * smooth(breathing);
    }
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  }

  // A swimming stroke has a pull and a recovery, with the elbow following the
  // shoulder. Each formation has its own timing; weighted poses blend while
  // the fish are changing formation, never by swapping whole-body frames.
  function mermaidPoseAt(phase, formation) {
    const profiles = {
      ring:   { base: -0.68, amplitude: 0.38, offset: 0, elbow: -0.26 },
      lotus:  { base: -0.57, amplitude: 0.42, offset: 0, elbow: -0.32 },
      heart:  { base: -0.64, amplitude: 0.40, offset: Math.PI / 2, elbow: -0.30 },
      double: { base: -0.75, amplitude: 0.34, offset: Math.PI, elbow: -0.26 },
      spiral: { base: -0.68, amplitude: 0.40, offset: Math.PI / 3, elbow: -0.35 },
    };
    const stroke = phase * Math.PI / 2;
    const pose = { ...poseAt(phase), armLeft: 0, armRight: 0, elbowLeft: 0, elbowRight: 0 };
    const total = formationNames.reduce((sum, name) => sum + Math.max(0, Number(formation && formation[name]) || 0), 0);
    formationNames.forEach((name) => {
      const weight = total ? Math.max(0, Number(formation && formation[name]) || 0) / total : (name === "ring" ? 1 : 0);
      const p = profiles[name];
      pose.armLeft += weight * (p.base + p.amplitude * Math.sin(stroke));
      pose.armRight += weight * (p.base + p.amplitude * Math.sin(stroke + p.offset));
      pose.elbowLeft += weight * (p.elbow + 0.22 * Math.sin(stroke - 0.8));
      pose.elbowRight += weight * (p.elbow + 0.22 * Math.sin(stroke + p.offset - 0.8));
    });
    return pose;
  }

  const duetMoves = ["同步抱水", "双人牵手游", "前后追游", "交替仰泳", "波浪接力", "对向伸手", "交错换位", "同步转体"];
  const duetBeatsPerMove = 12;
  function duetMoveAt(phase) {
    const index = Math.floor(Math.max(0, phase) / duetBeatsPerMove) % duetMoves.length;
    const within = (Math.max(0, phase) % duetBeatsPerMove) / duetBeatsPerMove;
    return { index, next: (index + 1) % duetMoves.length,
      name: duetMoves[index], within, blend: smooth((within - 0.68) / 0.32) };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function turnDifference(from, to) {
    let turn = (to - from) % (Math.PI * 2);
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    return turn;
  }
  function duetArmStroke(index, phase, role) {
    // Each sequence contains distinct reach, pull and recovery poses. Four
    // poses cover eight musical beats, with eased movement between the poses.
    const sequences = [
      [[.72,.72,-.05,-.05],[-.06,-.06,-.14,-.14],[-.92,-.92,-.36,-.36],[-.38,-.38,-.48,-.48]],
      [[0,.55,0,-.08],[0,-.20,0,-.24],[0,-.72,0,-.38],[0,-.20,0,-.25]],
      [[.62,.62,-.10,-.10],[-.20,-.20,-.20,-.20],[-.84,-.84,-.38,-.38],[-.36,-.36,-.45,-.45]],
      [[.84,-.90,-.08,-.36],[-.10,-.66,-.18,-.38],[-.90,.84,-.36,-.08],[-.66,-.10,-.38,-.18]],
      [[.82,.18,-.06,-.20],[-.16,-.55,-.20,-.38],[-.84,-.84,-.36,-.36],[-.12,.58,-.45,-.08]],
      [[-.55,-.55,-.25,-.25],[.76,.76,-.08,-.08],[.76,.76,-.08,-.08],[-.48,-.48,-.32,-.32]],
      [[.66,-.82,-.08,-.35],[-.32,-.50,-.25,-.40],[-.82,.66,-.35,-.08],[-.50,-.32,-.40,-.25]],
      [[.72,.72,-.06,-.06],[.16,.16,-.08,-.08],[-.75,-.75,-.30,-.30],[.16,.16,-.08,-.08]],
    ];
    const keys = sequences[index];
    // The second swimmer follows two beats later during the ripple sequence.
    const beat = ((phase - ((index === 4 && role) || (index === 2 && role) ? 2 : 0)) % 8 + 8) % 8;
    const step = Math.floor(beat / 2), t = smooth((beat % 2) / 2);
    const values = keys[step].map((value, i) => lerp(value, keys[(step + 1) % keys.length][i], t));
    // In the hand-hold the inner arms remain extended to the shared contact
    // point; the outer arms keep a slow, mirrored swimming stroke.
    if (index === 1 && role) return { armLeft: values[1], armRight: values[0], elbowLeft: values[3], elbowRight: values[2] };
    return { armLeft: values[0], armRight: values[1], elbowLeft: values[2], elbowRight: values[3] };
  }
  function duetPoseAt(phase, formation, role) {
    const move = duetMoveAt(phase), pose = mermaidPoseAt(phase, formation);
    const from = duetArmStroke(move.index, phase, role), to = duetArmStroke(move.next, phase, role);
    Object.keys(from).forEach((key) => { pose[key] = lerp(from[key], to[key], move.blend); });
    // Both tails follow the music, with a slight delay to keep them alive.
    pose.tailPhase = phase / 4 + (role ? 0.06 : 0);
    const waves = [0.11, 0.10, 0.18, 0.12, 0.13, 0.10, 0.16, 0.12];
    pose.tailAmplitude = lerp(waves[move.index], waves[move.next], move.blend);
    pose.bodyWave = 0.018 + Math.max(0, pose.tailAmplitude - 0.10) * 0.35;
    return pose;
  }

  function createDuet() {
    let midpointX = 0, midpointY = 0, halfSpacing = null, headings = [null, null];
    let orbitAngle = null, previousPhase = null;
    function reset() {
      midpointX = midpointY = 0; halfSpacing = orbitAngle = previousPhase = null;
      headings = [null, null];
    }
    function advance(dt, phase, formation, firstRadius, secondRadius) {
      const bodyRadius = Math.max(9, Number(firstRadius) || 0, Number(secondRadius) || 0);
      const fishRadius = Math.max(0, Number(formation && formation.radius) || 0) || bodyRadius * 6;
      const clearance = Number.isFinite(formation && formation.clearance) ? Math.max(0, formation.clearance) : fishRadius;
      const limit = Math.max(0, clearance - bodyRadius * 1.35 - 8);
      const move = duetMoveAt(phase);
      const expansions = [1.65, 1.04, 1.72, 1.72, 1.76, 1.60, 1.75, 1.76];
      const pulses = [0.06, 0, 0.05, 0.06, 0.10, 0.20, 0.08, 0.04];
      const expansion = lerp(expansions[move.index], expansions[move.next], move.blend);
      const pulse = lerp(pulses[move.index], pulses[move.next], move.blend);
      const desiredSpacing = Math.min(limit, bodyRadius * (expansion + pulse * Math.sin(phase * Math.PI / 4)));
      if (halfSpacing == null) halfSpacing = desiredSpacing;
      const blend = 1 - Math.exp(-Math.max(0, dt) * 2.2);
      halfSpacing += (desiredSpacing - halfSpacing) * blend;
      let x = 0, y = 0;
      const total = formationNames.reduce((sum, name) => sum + Math.max(0, Number(formation && formation[name]) || 0), 0);
      const budget = Math.min(bodyRadius * 0.65, Math.max(0, limit - halfSpacing));
      formationNames.forEach((name) => {
        const weight = total ? Math.max(0, Number(formation && formation[name]) || 0) / total : (name === "ring" ? 1 : 0);
        const point = performancePoint(name, phase);
        x += point.x * budget * weight; y += point.y * budget * weight;
      });
      midpointX += (x - midpointX) * blend; midpointY += (y - midpointY) * blend;
      // The pair shares an orbit, drawing close to hold hands or following
      // each other along a curved path without crossing through one another.
      if (orbitAngle == null) orbitAngle = -Math.PI / 2;
      if (previousPhase != null) {
        const speeds = [0.025, 0.025, 0.24, 0.035, 0.04, 0.035, 0.30, 0.015];
        orbitAngle += Math.max(0, phase - previousPhase) * lerp(speeds[move.index], speeds[move.next], move.blend);
      }
      previousPhase = phase;
      const angle = orbitAngle;
      const dx = Math.cos(angle) * halfSpacing, dy = Math.sin(angle) * halfSpacing;
      // In the follow sequence the second swimmer occupies the same curved
      // path ahead of the first, instead of staying opposite on a fixed axis.
      const gaps = [Math.PI, Math.PI, Math.PI * 2 / 3, Math.PI, Math.PI, Math.PI, Math.PI, Math.PI];
      const gap = lerp(gaps[move.index], gaps[move.next], move.blend);
      const partnerAngle = angle + gap;
      // In the last phrase both rotate once around their own axes. During the
      // previous phrase its initial value is zero, keeping the transition smooth.
      const spin = move.index === 7 ? Math.PI * 2 * smooth((move.within - 0.08) / 0.52) : 0;
      const targets = [
        [angle, angle],                              // synchronized scull
        [angle, angle],                              // held hands
        [angle - Math.PI, partnerAngle - Math.PI],   // follow on a shared curve
        [angle, angle],                              // alternating backstroke
        [angle, angle],                              // delayed arm ripple
        [angle - Math.PI / 2, angle + Math.PI / 2], // face and reach
        [angle - Math.PI, angle],                   // pass around one another
        [angle + spin, angle + spin],                // rotate in unison
      ];
      const response = 1 - Math.exp(-Math.max(0, dt) * 3.5);
      const handHold = (move.index === 1 ? 1 - move.blend : 0) + (move.next === 1 ? move.blend : 0);
      for (let role = 0; role < 2; role++) {
        const from = targets[move.index][role], to = targets[move.next][role];
        const target = from + turnDifference(from, to) * move.blend + 0.05 * (1 - handHold) * Math.sin(phase * Math.PI / 4);
        if (headings[role] == null) headings[role] = target;
        else {
          const maxTurn = Math.max(0, dt) * 4;
          headings[role] += clamp(turnDifference(headings[role], target) * response, -maxTurn, maxTurn);
        }
      }
      return {
        first: { x: midpointX + dx, y: midpointY + dy, angle: headings[0] },
        second: { x: midpointX + Math.cos(partnerAngle) * halfSpacing,
          y: midpointY + Math.sin(partnerAngle) * halfSpacing, angle: headings[1] },
        halfSpacing, move,
      };
    }
    return { advance, reset };
  }

  function createOrbit() {
    let x = 0, y = 0, heading = 0;
    return {
      advance(dt, phase, formation, characterRadius) {
        const fishRadius = Math.max(0, Number(formation && formation.radius) || 0);
        const total = formationNames.reduce((sum, name) => sum + Math.max(0, Number(formation && formation[name]) || 0), 0);
        let budget = Math.min(fishRadius * 0.26, Math.max(0, characterRadius) * 1.3);
        if (Number.isFinite(formation && formation.clearance)) {
          budget = Math.min(budget, Math.max(0, formation.clearance - characterRadius * 1.4 - 8));
        }
        let targetX = 0, targetY = 0;
        if (total) formationNames.forEach((name) => {
          const weight = Math.max(0, Number(formation[name]) || 0) / total;
          if (!weight) return;
          const point = performancePoint(name, phase);
          targetX += point.x * budget * weight; targetY += point.y * budget * weight;
        });
        const previousX = x, previousY = y;
        const response = 1 - Math.exp(-Math.max(0, dt) * 2.2);
        x += (targetX - x) * response; y += (targetY - y) * response;
        const dx = x - previousX, dy = y - previousY;
        const targetHeading = Math.hypot(dx, dy) > Math.max(0, dt) * 0.35 ? Math.atan2(dy, dx) + Math.PI / 2 : heading;
        let turn = (targetHeading - heading) % (Math.PI * 2);
        if (turn > Math.PI) turn -= Math.PI * 2;
        if (turn < -Math.PI) turn += Math.PI * 2;
        heading += turn * (1 - Math.exp(-Math.max(0, dt) * 4));
        return { x, y, angle: heading, radius: Math.hypot(x, y) };
      },
    };
  }
  return { create, createOrbit, createDuet, formationNames, performancePoint, mermaidPoseAt, duetPoseAt,
    duetMoves, duetBeatsPerMove, duetMoveAt, phrases, beatsPerPhrase, poseAt };
});
