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

function scriptedInput(tick) {
  let actions = 0;
  if (tick % 480 < 250) actions |= core.INPUT.FORWARD;
  else if (tick % 480 < 340) actions |= core.INPUT.STRAFE_RIGHT;
  else actions |= core.INPUT.RISE;
  if (tick % 72 < 18) actions |= core.INPUT.FIRE;
  if (tick % 500 === 260) actions |= core.INPUT.MISSILE;
  if (tick % 320 < 80) actions |= core.INPUT.ROLL_RIGHT;
  if (tick % 600 < 150) actions |= core.INPUT.BOOST;
  return core.packInput(actions, tick % 23 === 0 ? 2 : 0, tick % 41 === 0 ? -1 : 0);
}

function assertConnected(blueprint) {
  const origin = blueprint.start.cell;
  const seen = new Set([core.cellKey(origin.x, origin.y, origin.z)]);
  const queue = [origin];
  while (queue.length) {
    const cell = queue.shift();
    for (const direction of core.DIRECTIONS) {
      const next = { x: cell.x + direction.x, y: cell.y + direction.y, z: cell.z + direction.z };
      const key = core.cellKey(next.x, next.y, next.z);
      if (!core.isOpenCell(blueprint, next.x, next.y, next.z) || seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  assert.equal(seen.size, blueprint.cells.length);
}

test("seed, integer trigonometry, and packed six-axis input are stable", () => {
  assert.equal(core.seedHex(core.normalizeSeed("VECTOR-ZERO-GOLDEN")), "13DD0B81");
  assert.equal(core.sinAngle(0), 0);
  assert.equal(core.cosAngle(0), core.TRIG_SCALE);
  assert.equal(core.sinAngle(core.ANGLE_MAX / 4), core.TRIG_SCALE);
  const actions = core.INPUT.FORWARD | core.INPUT.RISE | core.INPUT.ROLL_LEFT | core.INPUT.MISSILE;
  const word = core.packInput(actions, -37, 42);
  assert.equal(core.inputActions(word), actions);
  assert.equal(core.inputYaw(word), -37);
  assert.equal(core.inputPitch(word), 42);
  assert.equal(core.inputYaw(core.packInput(0, -900, 0)), -64);
  assert.equal(core.inputPitch(core.packInput(0, 0, 900)), 63);
});

test("camera bases are orthogonal across yaw, pitch, and roll", () => {
  const cases = [[0, 0, 0], [12345, 7000, 31000], [50000, -12000, 9000]];
  for (const angles of cases) {
    const basis = core.getBasis(...angles);
    const dot = (first, second) => first.x * second.x + first.y * second.y + first.z * second.z;
    const length = (vector) => Math.sqrt(dot(vector, vector));
    assert.ok(Math.abs(dot(basis.forward, basis.right)) < core.TRIG_SCALE * 10);
    assert.ok(Math.abs(dot(basis.forward, basis.up)) < core.TRIG_SCALE * 10);
    assert.ok(Math.abs(dot(basis.right, basis.up)) < core.TRIG_SCALE * 10);
    for (const vector of Object.values(basis)) assert.ok(Math.abs(length(vector) - core.TRIG_SCALE) < 40);
  }
});

test("all seeded mine sectors are connected, bounded, repeatable, and diverse", () => {
  const fingerprints = new Set();
  for (let seedIndex = 0; seedIndex < 80; seedIndex += 1) {
    for (let sector = 1; sector <= 3; sector += 1) {
      const first = core.makeMineBlueprint(`MINE-${seedIndex}`, sector, seedIndex % 3);
      const second = core.makeMineBlueprint(`MINE-${seedIndex}`, sector, seedIndex % 3);
      assert.equal(first.signature, second.signature);
      assert.deepEqual(first.cells, second.cells);
      assertConnected(first);
      assert.equal(first.cells.length, 46 + sector * 8);
      assert.equal(first.pickups.filter((pickup) => pickup.kind === "core").length, 3);
      assert.ok(first.enemies.length >= 6);
      if (sector === 3) assert.equal(first.enemies.filter((enemy) => enemy.kind === "custodian").length, 1);
      assert.ok(core.isOpenCell(first, first.exit.cell.x, first.exit.cell.y, first.exit.cell.z));
      for (const enemy of first.enemies) assert.equal(core.isOpenPosition(first, enemy.x, enemy.y, enemy.z), true);
      fingerprints.add(first.signature);
    }
  }
  assert.ok(fingerprints.size >= 238, `expected at least 238 unique layouts, received ${fingerprints.size}`);
});

test("difficulty scales explicit combat contracts rather than ambient state", () => {
  assert.equal(core.normalizeDifficulty(-12), 0);
  assert.equal(core.normalizeDifficulty(99), 2);
  assert.equal(core.normalizeDifficulty("invalid"), 1);
  const easy = core.makeMineBlueprint("DIFFICULTY", 2, 0);
  const hard = core.makeMineBlueprint("DIFFICULTY", 2, 2);
  assert.equal(easy.cells.map(coreCell => JSON.stringify(coreCell)).join("|"), hard.cells.map(coreCell => JSON.stringify(coreCell)).join("|"));
  assert.ok(hard.enemies[0].health > easy.enemies[0].health);
});

test("six-axis movement translates independently and collides with closed cells", () => {
  const state = core.createRun("FLIGHT-AXES", 0);
  const origin = { x: state.player.x, y: state.player.y, z: state.player.z };
  for (let tick = 0; tick < 12; tick += 1) core.step(state, core.packInput(core.INPUT.FORWARD, 0, 0));
  assert.notEqual(state.player.x, origin.x);
  const afterForward = { x: state.player.x, y: state.player.y, z: state.player.z };
  for (let tick = 0; tick < 12; tick += 1) core.step(state, core.packInput(core.INPUT.STRAFE_RIGHT, 0, 0));
  assert.ok(state.player.x !== afterForward.x || state.player.z !== afterForward.z);
  const afterStrafeY = state.player.y;
  for (let tick = 0; tick < 12; tick += 1) core.step(state, core.packInput(core.INPUT.RISE, 0, 0));
  assert.notEqual(state.player.y, afterStrafeY);
  for (let tick = 0; tick < 600; tick += 1) core.step(state, core.packInput(core.INPUT.FORWARD | core.INPUT.BOOST, 0, 0));
  assert.equal(core.canOccupy(state.blueprint, state.player.x, state.player.y, state.player.z, core.PLAYER_RADIUS), true);
});

test("line of sight crosses open cells and rejects mine hulls", () => {
  const blueprint = core.makeMineBlueprint("LOS", 1, 1);
  const adjacent = blueprint.cells.find((cell) => {
    const dx = Math.abs(cell.x - blueprint.start.cell.x);
    const dy = Math.abs(cell.y - blueprint.start.cell.y);
    const dz = Math.abs(cell.z - blueprint.start.cell.z);
    return dx + dy + dz === 1;
  });
  assert.ok(adjacent);
  const target = core.cellCenter(adjacent);
  assert.equal(core.hasLineOfSight(blueprint, blueprint.start.x, blueprint.start.y, blueprint.start.z, target.x, target.y, target.z), true);
  assert.equal(core.hasLineOfSight(blueprint, blueprint.start.x, blueprint.start.y, blueprint.start.z, -core.CELL_SIZE, -core.CELL_SIZE, -core.CELL_SIZE), false);
});

test("pulse lasers damage and destroy a deterministic point-blank hostile", () => {
  const state = core.createRun("COMBAT", 0);
  const enemy = state.enemies[0];
  enemy.x = state.player.x + 2 * core.FP;
  enemy.y = state.player.y;
  enemy.z = state.player.z;
  enemy.cooldown = 999;
  for (let tick = 0; tick < 100 && state.enemies.some((item) => item.id === enemy.id); tick += 1) {
    core.step(state, core.packInput(core.INPUT.FIRE, 0, 0));
  }
  assert.equal(state.enemies.some((item) => item.id === enemy.id), false);
  assert.ok(state.stats.shots > 0);
  assert.ok(state.stats.hits > 0);
  assert.equal(state.stats.kills, 1);
});

test("autonomous plasma projectiles cross a chamber and damage the player", () => {
  const state = core.createRun("ENEMY-FIRE", 1);
  const enemy = state.enemies[0];
  state.enemies = [enemy];
  enemy.x = state.player.x + 2 * core.FP;
  enemy.y = state.player.y;
  enemy.z = state.player.z;
  enemy.cooldown = 0;
  enemy.phase = 1;
  const shield = state.player.shield;
  for (let tick = 0; tick < 40 && state.player.shield === shield; tick += 1) core.step(state, 0);
  assert.ok(state.player.shield < shield);
  assert.ok(state.stats.damageTaken > 0);
});

test("vector cores gate the exit and campaign transitions end in victory", () => {
  const state = core.createRun("CAMPAIGN", 0);
  for (let sector = 1; sector <= 3; sector += 1) {
    state.player.x = state.blueprint.exit.x;
    state.player.y = state.blueprint.exit.y;
    state.player.z = state.blueprint.exit.z;
    core.step(state, core.packInput(core.INPUT.FORWARD, 0, 0));
    assert.equal(state.sectorComplete, false);
    assert.ok(state.events.some((event) => event.type === "denied"));
    core.step(state, 0);
    assert.equal(state.events.some((event) => event.type === "denied"), false);
    state.player.x = state.blueprint.start.x;
    state.player.y = state.blueprint.start.y;
    state.player.z = state.blueprint.start.z;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.vz = 0;
    core.step(state, 0);
    state.player.x = state.blueprint.exit.x;
    state.player.y = state.blueprint.exit.y;
    state.player.z = state.blueprint.exit.z;
    core.step(state, 0);
    assert.ok(state.events.some((event) => event.type === "denied"));
    state.coresCollected = state.coresRequired;
    core.step(state, 0);
    assert.equal(state.sectorComplete, true);
    for (let tick = 0; tick < 120; tick += 1) core.step(state, 0);
    if (sector < 3) assert.equal(state.sector, sector + 1);
  }
  assert.equal(state.victory, true);
  assert.equal(state.stats.sectors, 3);
});

test("the fixed-tick simulation matches its checked golden digest", () => {
  const state = core.createRun("GOLDEN-VECTOR-ZERO", 1);
  for (let tick = 0; tick < 1500 && !state.gameOver; tick += 1) core.step(state, scriptedInput(tick));
  assert.ok(state.tick > 300);
  assert.equal(core.stateDigest(state), "D1FE35C6");
});

test("replay receipts reproduce the exact canonical state including terminal tails", () => {
  const original = core.createRun("REPLAY-VECTOR-ZERO", 0);
  const recorder = core.createRecorder(original.seed, original.difficulty);
  for (let tick = 0; tick < 720; tick += 1) {
    const word = scriptedInput(tick);
    core.recordInput(recorder, word);
    core.step(original, word);
  }
  const code = core.encodeReplay(recorder);
  assert.match(code, /^VZ02\.[0-9A-F]{8}\.[A-Za-z0-9_-]+$/);
  const decoded = core.decodeReplay(code);
  const replayed = core.createRun(decoded.seed, decoded.difficulty);
  const cursor = core.createReplayCursor(decoded);
  let word;
  while ((word = core.nextReplayInput(cursor)) !== null) core.step(replayed, word);
  assert.equal(cursor.tick, decoded.ticks);
  assert.equal(core.stateDigest(replayed), core.stateDigest(original));

  original.gameOver = true;
  replayed.gameOver = true;
  const tail = core.packInput(core.INPUT.MISSILE | core.INPUT.ROLL_LEFT, 7, -3);
  core.step(original, tail);
  core.step(replayed, tail);
  assert.equal(replayed.previousActions, original.previousActions);
  assert.equal(core.stateDigest(replayed), core.stateDigest(original));
});

test("receipts reject tampering and the size bound covers all permitted ticks", () => {
  const recorder = core.createRecorder("TAMPER", 1);
  for (let tick = 0; tick < 50; tick += 1) core.recordInput(recorder, scriptedInput(tick));
  const code = core.encodeReplay(recorder);
  const last = code.at(-1);
  assert.throws(() => core.decodeReplay(`${code.slice(0, -1)}${last === "A" ? "B" : "A"}`), /checksum|base64|JSON/i);
  recorder.ticks = core.MAX_REPLAY_TICKS;
  assert.equal(core.tryRecordInput(recorder, 0), false);
  assert.throws(() => core.recordInput(recorder, 0), /two-hour limit/);
  const emptyPayload = JSON.stringify([core.ENGINE_VERSION, 0xffffffff, 2, core.MAX_REPLAY_TICKS, []]);
  const largestRun = JSON.stringify([0xffffffff, 1]);
  const worstPayload = emptyPayload.length + core.MAX_REPLAY_TICKS * (largestRun.length + 1) - 1;
  const worstCode = core.REPLAY_PREFIX.length + 10 + Math.ceil(worstPayload / 3) * 4;
  assert.ok(core.MAX_REPLAY_CODE_LENGTH >= worstCode);

  const nativeBtoa = globalThis.btoa;
  const nativeAtob = globalThis.atob;
  let encodeCalls = 0;
  let decodeCalls = 0;
  globalThis.btoa = (text) => {
    encodeCalls += 1;
    return nativeBtoa(text);
  };
  globalThis.atob = (text) => {
    decodeCalls += 1;
    return nativeAtob(text);
  };
  try {
    const changing = core.createRecorder("MAXIMUM-CHANGE-LEDGER", 2);
    changing.ticks = core.MAX_REPLAY_TICKS;
    changing.runs = Array.from({ length: changing.ticks }, (_value, index) => [index % 2 ? 0xfffffffe : 0xffffffff, 1]);
    const maximumCode = core.encodeReplay(changing);
    assert.ok(maximumCode.length <= core.MAX_REPLAY_CODE_LENGTH);
    const maximumReplay = core.decodeReplay(maximumCode);
    assert.equal(maximumReplay.ticks, core.MAX_REPLAY_TICKS);
    assert.equal(maximumReplay.runs.length, core.MAX_REPLAY_TICKS);
    assert.deepEqual(maximumReplay.runs[0], [0xffffffff, 1]);
    assert.deepEqual(maximumReplay.runs.at(-1), [0xfffffffe, 1]);
    assert.equal(encodeCalls, 1);
    assert.equal(decodeCalls, 1);
  } finally {
    globalThis.btoa = nativeBtoa;
    globalThis.atob = nativeAtob;
  }
});

test("the canonical core has no ambient clock, random source, DOM, storage, or network", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "core.js"), "utf8");
  for (const forbidden of ["Math.random", "Date.now", "performance.now", "document.", "window.", "localStorage", "sessionStorage", "fetch("]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must remain outside canonical state`);
  }
});

process.on("exit", () => {
  if (!process.exitCode) process.stdout.write(`# ${passed} VECTOR ZERO deterministic core tests passed\n`);
});
