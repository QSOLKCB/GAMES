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

function scriptedInput(gameId, tick) {
  let actions = 0;
  if (tick % 240 < 72) actions |= core.INPUT.LEFT;
  else if (tick % 240 < 145) actions |= core.INPUT.RIGHT;
  if (["gridburn", "rift-runner", "iron-circuit"].includes(gameId)) {
    if (tick % 300 < 115) actions |= core.INPUT.UP;
    else if (tick % 300 > 245) actions |= core.INPUT.DOWN;
  }
  if (tick % 17 < 3) actions |= core.INPUT.FIRE;
  if (tick % 311 === 0) actions |= core.INPUT.SECOND;
  return actions;
}

function runScript(gameId, seed, difficulty, ticks) {
  const state = core.createRun(gameId, seed, difficulty);
  for (let tick = 0; tick < ticks; tick += 1) core.step(state, scriptedInput(gameId, tick));
  return state;
}

function assertFinite(value, trail) {
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true, `${trail} must remain finite`);
    assert.equal(Number.isInteger(value), true, `${trail} must remain integral`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => assertFinite(item, `${trail}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertFinite(item, `${trail}.${key}`);
  }
}

test("the cartridge exposes seven distinct original programs and stable inputs", () => {
  assert.equal(core.GAMES.length, 7);
  assert.equal(new Set(core.GAMES.map((game) => game.id)).size, 7);
  assert.equal(new Set(core.GAMES.map((game) => game.name)).size, 7);
  assert.deepEqual(core.GAMES.map((game) => game.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(core.seedHex(core.normalizeSeed("SEVEN-SIGNALS-GOLDEN")), "666067D1");
  assert.equal(core.normalizeGame("invalid"), "prism-break");
  assert.equal(core.normalizeDifficulty(-9), 0);
  assert.equal(core.normalizeDifficulty(99), 2);
  assert.equal(core.ACTION_MASK, Object.values(core.INPUT).reduce((mask, bit) => mask | bit, 0));
});

test("every program repeats exactly for one seed and input ledger", () => {
  for (const game of core.GAMES) {
    const first = runScript(game.id, "REPEATABLE-CARTRIDGE", 1, 1600);
    const second = runScript(game.id, "REPEATABLE-CARTRIDGE", 1, 1600);
    assert.equal(core.stateDigest(first), core.stateDigest(second), game.name);
    assert.deepEqual(first, second, game.name);
  }
});

test("seed identity reaches the canonical state of every program", () => {
  for (const game of core.GAMES) {
    const first = runScript(game.id, "SIGNAL-ALPHA", 1, 480);
    const second = runScript(game.id, "SIGNAL-BETA", 1, 480);
    assert.notEqual(core.stateDigest(first), core.stateDigest(second), game.name);
  }
});

test("the seven checked simulation traces match their golden digests", () => {
  const expected = {
    "prism-break": "813DA0E6",
    gridburn: "2E9112E6",
    "orbital-siege": "78BF0224",
    "star-talon": "9E4384C2",
    "rift-runner": "F3BBB7EA",
    "iron-circuit": "784EAEEC",
    "skywater-command": "5E5609C4",
  };
  for (const game of core.GAMES) {
    const state = runScript(game.id, "CARTRIDGE-GOLDEN", 1, 1800);
    assert.equal(core.stateDigest(state), expected[game.id], game.name);
  }
});

test("Prism Break serves, strikes bricks, and advances a cleared wall", () => {
  const state = core.createRun("prism-break", "PRISM-TEST", 1);
  core.step(state, core.INPUT.FIRE);
  assert.equal(state.game.ball.stuck, false);
  const brick = state.game.bricks[0];
  const priorScore = state.score;
  state.game.ball.x = brick.x;
  state.game.ball.y = brick.y + 3 * core.FP;
  state.game.ball.vx = 0;
  state.game.ball.vy = -3 * core.FP;
  core.step(state, 0);
  assert.ok(state.score > priorScore);
  state.game.bricks = [];
  core.step(state, 0);
  assert.equal(state.level, 2);
  assert.equal(state.game.bricks.length, 48);
  assert.equal(state.game.ball.stuck, true);
});

test("Gridburn accepts sustained lane control and produces hostile traffic", () => {
  const state = core.createRun("gridburn", "GRID-TEST", 1);
  const startingLane = state.game.lane;
  for (let tick = 0; tick < 25; tick += 1) core.step(state, core.INPUT.LEFT | (tick % 9 === 0 ? core.INPUT.FIRE : 0));
  assert.ok(state.game.lane < startingLane);
  assert.ok(state.game.shots.length > 0);
  for (let tick = 0; tick < 150; tick += 1) core.step(state, 0);
  assert.ok(state.game.nextId > 1);
  assertFinite(state.game, "gridburn");
});

test("Orbital Siege resolves a final formation target into the next wave", () => {
  const state = core.createRun("orbital-siege", "ORBITAL-TEST", 1);
  const enemy = { ...state.game.enemies[0], x: 80 * core.FP, y: 90 * core.FP, hp: 1 };
  state.game.enemies = [enemy];
  state.game.playerShots = [{ x: enemy.x, y: enemy.y + 48 }];
  core.step(state, 0);
  assert.equal(state.level, 2);
  assert.ok(state.game.enemies.length > 20);
  assert.ok(state.score >= 750);
});

test("Star Talon launches deterministic autonomous dives", () => {
  const first = core.createRun("star-talon", "DIVE-TEST", 2);
  const second = core.createRun("star-talon", "DIVE-TEST", 2);
  for (let tick = 0; tick < 110; tick += 1) { core.step(first, 0); core.step(second, 0); }
  const firstDiver = first.game.enemies.find((enemy) => enemy.state === "diving");
  const secondDiver = second.game.enemies.find((enemy) => enemy.state === "diving");
  assert.ok(firstDiver);
  assert.equal(firstDiver.id, secondDiver.id);
  assert.deepEqual(firstDiver, secondDiver);
});

test("Rift Runner keeps its procedural river navigable and fuel canonical", () => {
  const state = core.createRun("rift-runner", "RIVER-TEST", 0);
  for (let tick = 0; tick < 1200; tick += 1) core.step(state, scriptedInput(state.gameId, tick));
  assert.equal(state.game.rows.length, 27);
  for (const row of state.game.rows) {
    assert.ok(row.width >= 52 && row.width <= 94);
    assert.ok(row.center - row.width / 2 >= 4);
    assert.ok(row.center + row.width / 2 <= core.WIDTH - 4);
  }
  assert.ok(state.game.distance > 0);
  assert.ok(state.game.fuel >= 0 && state.game.fuel <= 1000);
  assertFinite(state.game, "river");
});

test("Iron Circuit fields deterministic AI opponents that move and fire", () => {
  const state = core.createRun("iron-circuit", "CIRCUIT-AI", 2);
  const initial = state.game.bots.map((bot) => ({ x: bot.x, y: bot.y }));
  for (let tick = 0; tick < 900; tick += 1) core.step(state, tick % 80 < 30 ? core.INPUT.RIGHT : 0);
  assert.ok(state.game.aiShots > 0);
  assert.ok(state.game.bots.some((bot, index) => !initial[index] || bot.x !== initial[index].x || bot.y !== initial[index].y) || state.level > 1);

  const hit = core.createRun("iron-circuit", "CIRCUIT-HIT", 0);
  hit.game.walls = [];
  const bot = hit.game.bots[0];
  hit.game.bots = [bot];
  hit.game.shells = [{ id: 999, owner: "player", x: bot.x, y: bot.y, vx: 0, vy: 0, age: 8 }];
  core.step(hit, 0);
  assert.equal(hit.level, 2);
  assert.ok(hit.score >= 1500);
});

test("Skywater Command runs a deterministic rival battery to a terminal score", () => {
  const state = core.createRun("skywater-command", "SKYWATER-AI", 2);
  for (let tick = 0; tick < 75 * core.TICK_RATE; tick += 1) core.step(state, scriptedInput(state.gameId, tick));
  assert.equal(state.game.timeLeft, 0);
  assert.equal(state.gameOver, true);
  assert.ok(state.game.aiShots > 0);
  assert.ok(state.game.playerShots > 0);
  assert.ok(state.game.aiScore >= 0);
  assert.equal(state.victory, state.score > state.game.aiScore);
});

test("CZ01 receipts reproduce all seven canonical program states", () => {
  for (const game of core.GAMES) {
    const original = core.createRun(game.id, `REPLAY-${game.code}`, 1);
    const recorder = core.createRecorder(game.id, original.seed, original.difficulty);
    for (let tick = 0; tick < 900; tick += 1) {
      const word = scriptedInput(game.id, tick);
      core.recordInput(recorder, word);
      core.step(original, word);
    }
    const code = core.encodeReplay(recorder);
    assert.match(code, /^CZ01\.[0-9A-F]{8}\.[A-Za-z0-9_-]+$/);
    const replay = core.decodeReplay(code);
    assert.equal(replay.gameId, game.id);
    const reproduced = core.createRun(replay.gameId, replay.seed, replay.difficulty);
    const cursor = core.createReplayCursor(replay);
    let word;
    while ((word = core.nextReplayInput(cursor)) !== null) core.step(reproduced, word);
    assert.equal(core.stateDigest(reproduced), core.stateDigest(original), game.name);
  }
});

test("terminal ledger tails remain canonical and tampering fails closed", () => {
  const state = core.createRun("prism-break", "TERMINAL-TAIL", 1);
  state.gameOver = true;
  core.step(state, core.INPUT.LEFT | core.INPUT.FIRE);
  assert.equal(state.previousActions, core.INPUT.LEFT | core.INPUT.FIRE);
  const firstDigest = core.stateDigest(state);
  core.step(state, core.INPUT.RIGHT | core.INPUT.SECOND);
  assert.notEqual(core.stateDigest(state), firstDigest);

  const recorder = core.createRecorder("gridburn", "TAMPER", 1);
  for (let tick = 0; tick < 90; tick += 1) core.recordInput(recorder, scriptedInput("gridburn", tick));
  const code = core.encodeReplay(recorder);
  const last = code.at(-1);
  assert.throws(() => core.decodeReplay(`${code.slice(0, -1)}${last === "A" ? "B" : "A"}`), /checksum|base64|JSON/i);
});

test("the two-hour receipt boundary covers a maximally changing valid ledger", () => {
  const recorder = core.createRecorder("star-talon", "MAX-LEDGER", 2);
  recorder.ticks = core.MAX_REPLAY_TICKS;
  recorder.runs = Array.from({ length: recorder.ticks }, (_value, index) => [index % 2 ? core.ACTION_MASK : core.ACTION_MASK - 1, 1]);
  const code = core.encodeReplay(recorder);
  assert.ok(code.length <= core.MAX_REPLAY_CODE_LENGTH);
  const replay = core.decodeReplay(code);
  assert.equal(replay.ticks, core.MAX_REPLAY_TICKS);
  assert.equal(replay.runs.length, core.MAX_REPLAY_TICKS);
  assert.equal(core.tryRecordInput(recorder, 0), false);
  assert.throws(() => core.recordInput(recorder, 0), /two-hour limit/);
});

test("seed sweeps preserve finite integer state across every program", () => {
  for (let seed = 0; seed < 20; seed += 1) {
    for (const game of core.GAMES) {
      const state = runScript(game.id, `SWEEP-${seed}`, seed % 3, 360);
      assertFinite(state, `${game.id}-${seed}`);
      assert.ok(state.tick <= 360);
      assert.ok(state.score >= 0);
    }
  }
});

test("the canonical core has no ambient clock, random source, DOM, storage, or network", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "core.js"), "utf8");
  for (const forbidden of ["Math.random", "Date.now", "performance.now", "document.", "window.", "localStorage", "sessionStorage", "fetch("]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must remain outside canonical state`);
  }
});

process.on("exit", () => {
  if (!process.exitCode) process.stdout.write(`# ${passed} CARTRIDGE ZERO deterministic core tests passed\n`);
});
