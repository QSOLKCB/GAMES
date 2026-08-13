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
  if (tick % 420 < 230) actions |= core.INPUT.FORWARD;
  else if (tick % 420 < 310) actions |= core.INPUT.TURN_RIGHT;
  else actions |= core.INPUT.STRAFE_LEFT;
  if (tick % 90 < 24) actions |= core.INPUT.FIRE;
  if (tick % 700 === 280) actions |= core.INPUT.USE;
  if (tick % 600 < 180) actions |= core.INPUT.RUN;
  return core.packInput(actions, tick % 17 === 0 ? 2 : 0);
}

test("seed parsing and fixed-point trigonometry are stable", () => {
  assert.equal(core.normalizeSeed(0x1234abcd), 0x1234abcd);
  assert.equal(core.normalizeSeed("0x1234ABCD"), 0x1234abcd);
  assert.equal(core.normalizeSeed("305441741"), 0x1234abcd);
  assert.equal(core.seedHex(core.normalizeSeed("DISK-FOUR-1996")), "A7BE8F0A");
  assert.equal(core.sinAngle(0), 0);
  assert.equal(core.cosAngle(0), core.TRIG_SCALE);
  assert.equal(core.sinAngle(core.ANGLE_MAX / 4), core.TRIG_SCALE);
  assert.equal(core.cosAngle(core.ANGLE_MAX / 2), -core.TRIG_SCALE);
});

test("input words round-trip actions and signed mouse turn", () => {
  const actions = core.INPUT.FORWARD | core.INPUT.FIRE | core.INPUT.WEAPON_3;
  const word = core.packInput(actions, -37);
  assert.equal(core.inputActions(word), actions);
  assert.equal(core.inputTurn(word), -37);
  assert.equal(core.inputTurn(core.packInput(0, 400)), 63);
  assert.equal(core.inputTurn(core.packInput(0, -400)), -64);
});

test("difficulty input is bounded and invalid values use the veteran contract", () => {
  assert.equal(core.normalizeDifficulty(-100), 0);
  assert.equal(core.normalizeDifficulty(100), 2);
  assert.equal(core.normalizeDifficulty("2"), 2);
  assert.equal(core.normalizeDifficulty("not-a-rank"), 1);
  assert.equal(core.createRun("RANK", undefined).difficulty, 1);
});

test("all recovered mission blueprints are rectangular, bounded and repeatable", () => {
  for (let index = 0; index < core.MISSIONS.length; index += 1) {
    const first = core.makeLevelBlueprint("MAP-RECEIPT", index, 1);
    const second = core.makeLevelBlueprint("MAP-RECEIPT", index, 1);
    assert.equal(first.width, 18);
    assert.equal(first.height, 18);
    assert.equal(first.signature, second.signature);
    assert.deepEqual(first.enemies, second.enemies);
    assert.ok(first.enemies.length >= 3);
    assert.ok(first.pickups.length >= 3);
    assert.ok(first.doors.length >= 1);
    assert.ok(first.secrets.length >= 1);
    for (let x = 0; x < first.width; x += 1) {
      assert.notEqual(first.tiles[0][x], ".");
      assert.notEqual(first.tiles[first.height - 1][x], ".");
    }
  }
  assert.notEqual(core.makeLevelBlueprint("MAP-RECEIPT", 0, 1).signature, core.makeLevelBlueprint("OTHER-SEED", 0, 1).signature);
});

test("every campaign objective is reachable and each cipher precedes its lock", () => {
  function reachable(blueprint, blockLockedDoor) {
    const origin = [Math.floor(blueprint.start.x / core.FP), Math.floor(blueprint.start.y / core.FP)];
    const queue = [origin];
    const seen = new Set([origin.join(",")]);
    while (queue.length) {
      const [x, y] = queue.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextX = x + dx;
        const nextY = y + dy;
        const key = `${nextX},${nextY}`;
        const cell = blueprint.tiles[nextY] && blueprint.tiles[nextY][nextX];
        if (!cell || seen.has(key) || "#PBS".includes(cell) || (blockLockedDoor && cell === "K")) continue;
        seen.add(key);
        queue.push([nextX, nextY]);
      }
    }
    return seen;
  }

  for (let index = 0; index < core.MISSIONS.length; index += 1) {
    const blueprint = core.makeLevelBlueprint("ROUTE-AUDIT", index, 1);
    const beforeUnlock = reachable(blueprint, true);
    const afterUnlock = reachable(blueprint, false);
    assert.equal(afterUnlock.has(`${blueprint.exit.x},${blueprint.exit.y}`), true, `${blueprint.code} exit must be reachable`);
    for (const pickup of blueprint.pickups.filter((item) => item.kind === "key")) {
      assert.equal(beforeUnlock.has(`${Math.floor(pickup.x / core.FP)},${Math.floor(pickup.y / core.FP)}`), true, `${blueprint.code} key must precede lock`);
    }
    for (const enemy of blueprint.enemies) {
      assert.equal(afterUnlock.has(`${Math.floor(enemy.x / core.FP)},${Math.floor(enemy.y / core.FP)}`), true, `${blueprint.code} enemy must be reachable`);
    }
  }
});

test("the fixed-tick simulation matches its checked golden digest", () => {
  const state = core.createRun("GOLDEN-BLACKSTAR", 1);
  for (let tick = 0; tick < 1800 && !state.gameOver; tick += 1) core.step(state, scriptedInput(tick));
  assert.ok(state.tick > 200);
  assert.equal(core.stateDigest(state), "DC794A9A");
});

test("replay receipt reproduces the exact final state", () => {
  const original = core.createRun("REPLAY-BLACKSTAR", 0);
  const recorder = core.createRecorder(original.seed, original.difficulty);
  for (let tick = 0; tick < 900 && !original.gameOver; tick += 1) {
    const word = scriptedInput(tick);
    core.recordInput(recorder, word);
    core.step(original, word);
  }
  const code = core.encodeReplay(recorder);
  assert.match(code, /^BSA1\.[0-9A-F]{8}\.[A-Za-z0-9_-]+$/);
  const decoded = core.decodeReplay(code);
  const replayed = core.createRun(decoded.seed, decoded.difficulty);
  const cursor = core.createReplayCursor(decoded);
  let word;
  while ((word = core.nextReplayInput(cursor)) !== null) core.step(replayed, word);
  assert.equal(decoded.ticks, recorder.ticks);
  assert.equal(core.stateDigest(replayed), core.stateDigest(original));
  assert.deepEqual(replayed.stats, original.stats);
});

test("replay receipt rejects checksum tampering and malicious metadata", () => {
  const recorder = core.createRecorder("TAMPER", 1);
  for (let tick = 0; tick < 50; tick += 1) core.recordInput(recorder, scriptedInput(tick));
  const code = core.encodeReplay(recorder);
  const last = code.at(-1);
  assert.throws(() => core.decodeReplay(`${code.slice(0, -1)}${last === "A" ? "B" : "A"}`), /checksum|base64|JSON/i);
  assert.throws(() => core.decodeReplay("BSA1.00000000.e30"), /checksum|metadata|JSON/i);
});

test("bounded replay recording stops without throwing into a frame loop", () => {
  const recorder = core.createRecorder("LIMIT", 1);
  recorder.ticks = core.MAX_REPLAY_TICKS;
  assert.equal(core.tryRecordInput(recorder, 0), false);
  assert.deepEqual(recorder.runs, []);
  assert.throws(() => core.recordInput(recorder, 0), /six-hour limit/);
});

test("walls block movement and open doors become traversable", () => {
  const state = core.createRun("COLLISION", 1);
  assert.equal(core.canOccupy(state, state.player.x, state.player.y, core.PLAYER_RADIUS), true);
  assert.equal(core.canOccupy(state, core.FP + 10, 10, core.PLAYER_RADIUS), false);
  const door = state.doors[0];
  assert.equal(core.isBlockingCell(state, door.x, door.y), true);
  door.open = core.FP;
  assert.equal(core.isBlockingCell(state, door.x, door.y), false);
});

test("hitscan combat damages and defeats a visible hostile deterministically", () => {
  const state = core.createRun("COMBAT", 0);
  const enemy = state.enemies[0];
  assert.ok(enemy);
  assert.equal(core.hasLineOfSight(state, state.player.x, state.player.y, enemy.x, enemy.y), true);
  for (let tick = 0; tick < 20; tick += 1) core.step(state, core.packInput(core.INPUT.FIRE, 0));
  assert.equal(state.stats.shots, 2);
  assert.equal(state.stats.hits, 2);
  assert.equal(state.stats.kills, 1);
  assert.equal(state.enemies.some((item) => item.id === enemy.id), false);
  assert.ok(state.score > 0);
});

test("use is edge-triggered and consumes a key exactly once", () => {
  const state = core.createRun("DOOR-EDGE", 1);
  const door = state.doors.find((item) => item.locked);
  assert.ok(door);
  state.player.x = door.x * core.FP + core.FP / 2;
  state.player.y = (door.y - 1) * core.FP + core.FP / 2;
  state.player.angle = core.ANGLE_MAX / 4;
  state.player.keys = 1;
  const use = core.packInput(core.INPUT.USE, 0);
  core.step(state, use);
  core.step(state, use);
  assert.equal(door.locked, false);
  assert.equal(state.player.keys, 0);
  assert.equal(door.target, core.FP);
});

test("mission transitions preserve the marine and terminate in canonical victory", () => {
  const state = core.createRun("CAMPAIGN", 1);
  state.player.health = 60;
  state.player.owned = 7;
  core.completeMission(state);
  for (let tick = 0; tick < 120; tick += 1) core.step(state, 0);
  assert.equal(state.missionIndex, 1);
  assert.equal(state.player.health, 80);
  assert.equal(state.player.owned, 7);
  core.completeMission(state);
  for (let tick = 0; tick < 120; tick += 1) core.step(state, 0);
  assert.equal(state.missionIndex, 2);
  state.enemies.length = 0;
  core.completeMission(state);
  for (let tick = 0; tick < 120; tick += 1) core.step(state, 0);
  assert.equal(state.victory, true);
  assert.equal(state.stats.missions, 3);
});

test("the simulation core has no ambient randomness, clock or browser state", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "core.js"), "utf8");
  assert.equal(source.includes("Math.random"), false);
  assert.equal(source.includes("Date.now"), false);
  assert.equal(source.includes("performance.now"), false);
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("sessionStorage"), false);
  assert.equal(source.includes("fetch("), false);
});

process.on("exit", () => {
  if (!process.exitCode) process.stdout.write(`# ${passed} deterministic core tests passed\n`);
});
