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

test("bounded recording reports its limit without throwing into the frame loop", () => {
  const recorder = core.createRecorder("RECORDING-LIMIT");
  recorder.ticks = core.MAX_REPLAY_TICKS;
  assert.equal(core.tryRecordInput(recorder, core.INPUT.FIRE), false);
  assert.equal(recorder.ticks, core.MAX_REPLAY_TICKS);
  assert.deepEqual(recorder.runs, []);
  assert.throws(() => core.recordInput(recorder, core.INPUT.FIRE), /six-hour limit/);
});

test("defeating a command craft advances to a harder derived level", () => {
  const state = core.createRun("LEVEL-TRANSITION");
  const firstSignature = state.blueprint.signature;
  state.levelTick = state.blueprint.bossTick - 1;
  state.nextEvent = state.blueprint.events.length - 1;
  core.step(state, 0);

  const boss = state.enemies.find((enemy) => enemy.kind === "boss");
  assert.ok(boss, "boss event must spawn at the scheduled tick");
  state.enemies.push({
    id: state.nextEntityId++,
    eventId: -1,
    kind: "turret",
    x: 80 * core.SCALE,
    y: 140 * core.SCALE,
    baseX: 80 * core.SCALE,
    age: 0,
    health: 999,
    maxHealth: 999,
    radius: 16 * core.SCALE,
    fireTimer: 1_000_000,
    pathSeed: 0,
    drop: null,
    dead: false,
  });
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
  assert.deepEqual(state.enemies, [], "surviving prior-sector enemies must not leak into the next blueprint");
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

test("enemy collisions emit complete hit and destruction snapshots", () => {
  const state = core.createRun("COLLISION-EVENTS");
  state.nextEvent = state.blueprint.events.length;
  const enemy = {
    id: state.nextEntityId++,
    eventId: -1,
    kind: "turret",
    x: 240 * core.SCALE,
    y: 200 * core.SCALE,
    baseX: 240 * core.SCALE,
    age: 0,
    health: 3,
    maxHealth: 3,
    radius: 16 * core.SCALE,
    fireTimer: 1_000_000,
    pathSeed: 0,
    drop: null,
    dead: false,
  };
  state.enemies.push(enemy);

  state.playerBullets.push({
    id: state.nextEntityId++,
    x: enemy.x,
    y: enemy.y + 650,
    vx: 0,
    vy: -650,
    radius: 500 * core.SCALE,
    damage: 1,
    dead: false,
  });
  core.step(state, 0);

  const hit = state.events.find((event) => event.type === "enemy-hit");
  assert.deepEqual(hit, {
    type: "enemy-hit",
    id: enemy.id,
    kind: "turret",
    x: enemy.x,
    y: enemy.y,
    radius: enemy.radius,
    health: 2,
    maxHealth: 3,
    damage: 1,
    source: "shot",
  });
  assert.equal(enemy.health, 2);
  assert.equal(state.stats.hits, 1);

  state.playerBullets.push({
    id: state.nextEntityId++,
    x: enemy.x,
    y: enemy.y + 650,
    vx: 0,
    vy: -650,
    radius: 500 * core.SCALE,
    damage: 2,
    dead: false,
  });
  core.step(state, 0);

  const destroyed = state.events.find((event) => event.type === "enemy-down");
  assert.deepEqual(destroyed, {
    type: "enemy-down",
    id: enemy.id,
    kind: "turret",
    x: enemy.x,
    y: enemy.y,
    radius: enemy.radius,
    health: 0,
    maxHealth: 3,
  });
  assert.equal(state.events.find((event) => event.type === "enemy-hit").health, 0);
  assert.equal(state.enemies.some((item) => item.id === enemy.id), false);
  assert.equal(state.stats.hits, 2);
  assert.equal(state.stats.kills, 1);
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
