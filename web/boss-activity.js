(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PondBossActivity = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function idleDuration(pose, random) {
    return pose === "lying" ? 5 + random() * 4 : 11 + random() * 9;
  }

  function create(random = Math.random) {
    return { mode: "lying", pose: "lying", from: "lying", to: "sitting",
      elapsed: 0, duration: idleDuration("lying", random), clock: 0,
      gesturesDone: 0, nextGesture: random() < 0.5 ? "scratch" : "water" };
  }

  function enter(activity, mode, duration) {
    activity.mode = mode;
    activity.elapsed = 0;
    activity.duration = duration;
  }

  function strike(activity) {
    if (!["lying", "sitting", "changing", "scratch", "water"].includes(activity.mode)) return false;
    if (activity.mode === "scratch" || activity.mode === "water") activity.pose = "lying";
    if (activity.mode === "changing") {
      activity.pose = activity.elapsed < activity.duration / 2 ? activity.from : activity.to;
    }
    enter(activity, "whip", 0.96);
    return true;
  }

  // Explicit states make a click produce one complete cycle:
  // react, fall, swim back, climb, then settle back on the leaf.
  function advance(activity, dt, random = Math.random) {
    const events = [];
    let remaining = Math.max(0, dt);
    activity.clock += remaining;
    while (remaining > 0) {
      const step = Math.min(remaining, Math.max(0, activity.duration - activity.elapsed));
      activity.elapsed += step;
      remaining -= step;
      if (activity.elapsed + 1e-8 < activity.duration) break;
      if (activity.mode === "lying" && activity.gesturesDone < 2) {
        const gesture = activity.nextGesture;
        activity.nextGesture = gesture === "scratch" ? "water" : "scratch";
        enter(activity, gesture, gesture === "scratch" ? 4.6 : 5.2);
      } else if (activity.mode === "scratch" || activity.mode === "water") {
        activity.gesturesDone++;
        enter(activity, "lying", idleDuration("lying", random));
      } else if (activity.mode === "lying" || activity.mode === "sitting") {
        activity.from = activity.mode;
        activity.to = activity.mode === "lying" ? "sitting" : "lying";
        enter(activity, "changing", 1.05);
      } else if (activity.mode === "changing") {
        activity.pose = activity.to;
        if (activity.pose === "lying") activity.gesturesDone = 0;
        enter(activity, activity.pose, idleDuration(activity.pose, random));
      } else if (activity.mode === "whip") {
        enter(activity, "fall", 1.0);
      } else if (activity.mode === "fall") {
        enter(activity, "swim", 5.8);
        events.push("splash");
      } else if (activity.mode === "swim") {
        enter(activity, "climb", 3.4);
      } else if (activity.mode === "climb") {
        activity.pose = "sitting";
        activity.gesturesDone = 0;
        enter(activity, "sitting", idleDuration("sitting", random));
      } else {
        activity.pose = "lying";
        enter(activity, "lying", idleDuration("lying", random));
      }
    }
    return events;
  }

  function progress(activity) {
    return Math.max(0, Math.min(1, activity.elapsed / activity.duration));
  }

  function swimStroke(seconds) {
    const cycle = ((Math.max(0, seconds) / 1.5) % 1) * 8;
    const first = Math.floor(cycle), between = cycle - first;
    const blend = Math.max(0, Math.min(1, (between - 0.28) / 0.44));
    return { first, next: (first + 1) % 8, blend: blend * blend * (3 - 2 * blend) };
  }

  // A face-down breaststroke: reach forward, pull, recover with bent knees,
  // then kick both legs out and close them for the glide. Values describe a
  // single continuous cycle for the connected swimming mesh.
  const swimKeys = [
    { t: 0,    arm: 1.10, elbow: 0.00, leg: 0.02, kick: 0.04 },
    { t: 0.18, arm: 0.84, elbow: 0.08, leg: 0.02, kick: 0.04 },
    { t: 0.37, arm: 0.05, elbow: -0.22, leg: 0.22, kick: 0.35 },
    { t: 0.52, arm: 0.18, elbow: -0.48, leg: 0.48, kick: 0.75 },
    { t: 0.70, arm: 1.02, elbow: -0.08, leg: 0.45, kick: 0.38 },
    { t: 0.90, arm: 1.10, elbow: 0.00, leg: 0.02, kick: 0.04 },
    { t: 1,    arm: 1.10, elbow: 0.00, leg: 0.02, kick: 0.04 },
  ];

  function swimPose(seconds) {
    const t = ((Math.max(0, Number(seconds) || 0) / 1.5) % 1);
    let index = 0;
    while (index < swimKeys.length - 2 && t >= swimKeys[index + 1].t) index++;
    const from = swimKeys[index], to = swimKeys[index + 1];
    const u = (t - from.t) / (to.t - from.t), k = u * u * (3 - 2 * u);
    const at = (name) => from[name] + (to[name] - from[name]) * k;
    const arm = at("arm"), elbow = at("elbow"), leg = at("leg"), kick = at("kick");
    return { armLeft: arm, armRight: arm, elbowLeft: elbow, elbowRight: elbow,
      legLeft: leg, legRight: leg, kickLeft: kick, kickRight: kick, bodySway: 0 };
  }

  // One connected mesh carries the whole reaction: the arms come up after
  // contact, then both arms and legs flail as the person loses balance.
  // Progress runs from 0 at the impact to 1 at the start of the fall and 2
  // at the water, so the pose is continuous across the state boundary.
  function reactionPose(progress) {
    const p = Math.max(0, Math.min(2, Number(progress) || 0));
    const u = Math.min(1, p / 0.35), lift = u * u * (3 - 2 * u);
    const wave = Math.sin(p * Math.PI * 2), counter = Math.sin(p * Math.PI * 2 - 0.6) - Math.sin(-0.6);
    return {
      armLeft: -0.72 + 1.38 * lift + 0.16 * wave * lift,
      armRight: -0.72 + 0.72 * lift - 0.16 * wave * lift,
      elbowLeft: -0.08 + 0.38 * lift + 0.12 * counter * lift,
      elbowRight: -0.08 - 0.30 * lift - 0.12 * counter * lift,
      legLeft: 0.02 + 0.24 * lift + 0.10 * wave * lift,
      legRight: 0.02 + 0.24 * lift - 0.10 * wave * lift,
      kickLeft: 0.04 + 0.20 * lift + 0.10 * wave * lift,
      kickRight: 0.04 + 0.20 * lift - 0.10 * wave * lift,
      bodySway: 0.018 * wave * lift,
    };
  }

  return { create, advance, strike, progress, swimStroke, swimPose, reactionPose };
});
