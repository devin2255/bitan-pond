const test = require("node:test");
const assert = require("node:assert/strict");
const Boss = require("../web/boss-activity.js");
const Rig = require("../web/boss-dance-rig.js");

test("lying alternates hand activities before changing to sitting", () => {
  const person = Boss.create(() => 0.5);
  const finish = () => Boss.advance(person, person.duration - person.elapsed + 0.01, () => 0.5);
  assert.equal(person.mode, "lying");
  finish(); assert.equal(person.mode, "water");
  finish(); assert.equal(person.mode, "lying");
  finish(); assert.equal(person.mode, "scratch");
  finish(); assert.equal(person.mode, "lying");
  finish(); assert.equal(person.mode, "changing");
  finish();
  assert.equal(person.mode, "sitting");
  finish(); assert.equal(person.mode, "changing");
  finish();
  assert.equal(person.mode, "lying");
});

test("a hit has one splash, a swim and a return to the leaf", () => {
  const person = Boss.create(() => 0.5);
  assert.equal(Boss.strike(person), true);
  assert.equal(Boss.strike(person), false);
  assert.deepEqual(Boss.advance(person, 2.0, () => 0.5), ["splash"]);
  assert.equal(person.mode, "swim");
  assert.equal(Boss.strike(person), false);
  assert.deepEqual(Boss.advance(person, 5.8, () => 0.5), []);
  assert.equal(person.mode, "climb");
  Boss.advance(person, 1.6, () => 0.5);
  assert.equal(person.mode, "climb");
  assert.ok(Boss.progress(person) > 0.4 && Boss.progress(person) < 0.6);
  Boss.advance(person, 1.9, () => 0.5);
  assert.equal(person.mode, "sitting");
});

test("the person can be clicked while playing with the water", () => {
  const person = Boss.create(() => 0.5);
  Boss.advance(person, person.duration + 0.01, () => 0.5);
  assert.equal(person.mode, "water");
  assert.equal(Boss.strike(person), true);
  assert.equal(person.mode, "whip");
  assert.equal(person.pose, "lying");
});

test("breaststroke advances through all poses and loops back smoothly", () => {
  const poses = Array.from({ length: 8 }, (_, i) => Boss.swimStroke(i * 1.5 / 8).first);
  assert.deepEqual(poses, [0, 1, 2, 3, 4, 5, 6, 7]);
  const nearEnd = Boss.swimStroke(1.49);
  assert.equal(nearEnd.first, 7);
  assert.equal(nearEnd.next, 0);
  assert.ok(nearEnd.blend > 0.9);
  assert.equal(Boss.swimStroke(1.5).first, 0);
});

test("the prone swimmer pulls and kicks both legs together in a smooth cycle", () => {
  let previous = Boss.swimPose(0), minArm = Infinity, maxArm = -Infinity;
  let maxSpread = 0, maxBend = 0;
  for (let i = 0; i <= 1500; i++) {
    const pose = Boss.swimPose(i / 1000);
    assert.equal(pose.armLeft, pose.armRight);
    assert.equal(pose.elbowLeft, pose.elbowRight);
    assert.equal(pose.legLeft, pose.legRight);
    assert.equal(pose.kickLeft, pose.kickRight);
    for (const key of Object.keys(pose)) assert.ok(Math.abs(pose[key] - previous[key]) < 0.02, key + " jumped");
    minArm = Math.min(minArm, pose.armLeft); maxArm = Math.max(maxArm, pose.armLeft);
    maxSpread = Math.max(maxSpread, pose.legLeft); maxBend = Math.max(maxBend, pose.kickLeft);
    previous = pose;
  }
  assert.ok(maxArm - minArm > 0.9, "the arms should reach forward and pull back");
  assert.ok(maxSpread > 0.4 && maxBend > 0.7, "both legs should bend and kick out");
  assert.deepEqual(Boss.swimPose(1.5), Boss.swimPose(0));
});

test("the frog kick bends at the knees without crossing the feet", () => {
  for (let i = 0; i <= 150; i++) {
    const pose = Boss.swimPose(i / 100);
    const left = Rig.deform(0.46, 0.96, -1, pose), right = Rig.deform(0.54, 0.96, 1, pose);
    assert.ok(right.x - left.x > 0.06, "the feet crossed during the kick");
  }
  const bent = Boss.swimPose(1.5 * 0.52);
  const knee = Rig.deform(0.46, 0.82, -1, bent), foot = Rig.deform(0.46, 0.96, -1, bent);
  assert.ok(foot.x > knee.x + 0.02, "the lower leg should fold inward at the knee");
});

test("the startled reaction moves arms and legs continuously into the fall", () => {
  const before = Boss.reactionPose(1 - 0.0001), after = Boss.reactionPose(1 + 0.0001);
  for (const key of Object.keys(before)) assert.ok(Math.abs(before[key] - after[key]) < 0.001, key + " jumped at the fall");
  const paths = [[], [], [], []];
  for (let i = 0; i <= 200; i++) {
    const pose = Boss.reactionPose(i / 100);
    [Rig.deform(0.10, 0.27, -1, pose), Rig.deform(0.90, 0.27, 1, pose),
      Rig.deform(0.46, 0.92, -1, pose), Rig.deform(0.54, 0.92, 1, pose)].forEach((p, n) => paths[n].push(p));
  }
  paths.forEach((points) => {
    const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
    assert.ok(Math.hypot(width, height) > 0.05, "a limb did not visibly react");
  });
});
