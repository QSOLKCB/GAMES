"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../core.js");

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`ok ${passed} - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok ${passed + 1} - ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

function scriptedMask(tick) {
  let mask = core.INPUT.FIRE;
  const phase = tick % 480;
  if (phase < 120) mask |= core.INPUT.LEFT;
  else if (phase < 240) mask |= core.INPUT.UP;
  else if (phase < 360) mask |= core.INPUT.RIGHT;
  else mask |= core.INPUT.DOWN;
  if (tick % 180 < 60) mask |= core.INPUT.FOCUS;
  if (tick === 360 || tick === 840 || tick === 1320) mask |= core.INPUT.BOMB;
  return mask;
}

test("seed parsing produces stable canonical uint32 values", () => {
  assert.equal(core.normalizeSeed(0x1234abcd), 0x1234abcd);
  assert.equal(core.normalizeSeed("0x1234ABCD"), 0x1234abcd);
  assert.equal(core.normalizeSeed("305441741"), 0x1234abcd);
  assert.equal(core.seedHex(core.normalizeSeed("QSOL-SEEDSTORM")), "95E96D8D");
});

test("level blueprints are identical for the same seed and level", () => {
  const first = core.makeLevelBlueprint("REPEATABLE", 4);
  const second = core.makeLevelBlueprint("REPEATABLE", 4);
  assert.equal(first.signature, second.signature);
  assert.deepEqual(first.events, second.events);
  assert.notEqual(first.signature, core.makeLevelBlueprint("DIFFERENT", 4).signature);
  assert.notEqual(first.signature, core.makeLevelBlueprint("REPEATABLE", 5).signature);
});

test("procedural rank increases monotonically with every level", () => {
  let previous = core.difficultyFor(1);
  for (let level = 2; level <= 80; level += 1) {
    const current = core.difficultyFor(level);
    assert.ok(current.rank > previous.rank);
    assert.ok(current.spawnGap <= previous.spawnGap);
    assert.ok(current.enemySpeed >= previous.enemySpeed);
    assert.ok(current.bulletSpeed >= previous.bulletSpeed);
    assert.ok(current.healthPercent > previous.healthPercent);
    assert.ok(current.fireGap <= previous.fireGap);
    assert.ok(current.bossHealth > previous.bossHealth);
    assert.ok(current.bossPatterns >= previous.bossPatterns);
    previous = current;
  }
});

test("the fixed-tick core matches its checked golden digest", () => {
  const state = core.createRun("GOLDEN-QSOL-1");
  for (let tick = 0; tick < 1500; tick += 1) core.step(state, scriptedMask(tick));
  assert.equal(state.tick, 1500);
  assert.equal(state.gameOver, false);
  assert.equal(core.stateDigest(state), "AD1C3116");
});

test("replay run-length encoding reconstructs the exact final state", () => {
  const original = core.createRun("REPLAY-ROUNDTRIP");
  const recorder = core.createRecorder(original.seed);
  for (let tick = 0; tick < 1800 && !original.gameOver; tick += 1) {
    const mask = scriptedMask(tick);
    core.recordInput(recorder, mask);
    core.step(original, mask);
  }

  const code = core.encodeReplay(recorder);
  const decoded = core.decodeReplay(code);
  const replayed = core.createRun(decoded.seed);
  const cursor = core.createReplayCursor(decoded);
  let mask;
  while ((mask = core.nextReplayInput(cursor)) !== null) core.step(replayed, mask);

  assert.equal(decoded.ticks, recorder.ticks);
  assert.equal(cursor.tick, recorder.ticks);
  assert.equal(core.stateDigest(replayed), core.stateDigest(original));
  assert.deepEqual(replayed.stats, original.stats);
});

test("replay checksums reject tampering before simulation", () => {
  const recorder = core.createRecorder("TAMPER-CHECK");
  for (let tick = 0; tick < 40; tick += 1) core.recordInput(recorder, tick & 1 ? core.INPUT.FIRE : 0);
  const code = core.encodeReplay(recorder);
  const final = code.at(-1);
  const tampered = `${code.slice(0, -1)}${final === "A" ? "B" : "A"}`;
  assert.throws(() => core.decodeReplay(tampered), /checksum|base64|JSON/i);
});

test("defeating a command craft advances to a harder derived level", () => {
  const state = core.createRun("LEVEL-TRANSITION");
  const firstSignature = state.blueprint.signature;
  state.levelTick = state.blueprint.bossTick - 1;
  state.nextEvent = state.blueprint.events.length - 1;
  core.step(state, 0);

  const boss = state.enemies.find((enemy) => enemy.kind === "boss");
  assert.ok(boss, "boss event must spawn at the scheduled tick");
  boss.y = 200 * core.SCALE;
  boss.health = 1;
  state.playerBullets.push({
    id: state.nextEntityId++,
    x: boss.x,
    y: boss.y + 650,
    vx: 0,
    vy: -650,
    radius: 500 * core.SCALE,
    damage: 1,
    dead: false,
  });
  core.step(state, 0);
  assert.equal(state.bossDefeated, true);

  for (let tick = 0; tick < 149; tick += 1) core.step(state, 0);
  assert.equal(state.level, 2);
  assert.equal(state.stats.levelsCleared, 1);
  assert.notEqual(state.blueprint.signature, firstSignature);
  assert.ok(state.blueprint.difficulty.healthPercent > 100);
});

test("bomb input is edge-triggered rather than consumed every held tick", () => {
  const state = core.createRun("BOMB-EDGE");
  state.player.invulnerable = 0;
  core.step(state, core.INPUT.BOMB);
  core.step(state, core.INPUT.BOMB);
  core.step(state, core.INPUT.BOMB);
  assert.equal(state.bombs, 2);
  core.step(state, 0);
  core.step(state, core.INPUT.BOMB);
  assert.equal(state.bombs, 1);
});

test("the simulation core contains no ambient random source", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "core.js"), "utf8");
  assert.equal(source.includes("Math.random"), false);
  assert.equal(source.includes("Date.now"), false);
  assert.equal(source.includes("performance.now"), false);
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("sessionStorage"), false);
});

process.on("exit", () => {
  if (!process.exitCode) process.stdout.write(`# ${passed} deterministic core tests passed\n`);
});
