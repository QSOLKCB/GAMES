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

function playerUnits(state, kind) {
  return state.units.filter((unit) => unit.team === core.PLAYER && (!kind || unit.kind === kind));
}

function scriptedCommands(state, tick) {
  const drones = playerUnits(state, "drone").map((unit) => unit.id);
  const combat = playerUnits(state).filter((unit) => unit.kind !== "drone").map((unit) => unit.id);
  if (tick === 4) return [{ t: "build", kind: "relay", ids: drones, x: 170, y: 200 }];
  if (tick === 10) return [{ t: "train", kind: "drone" }];
  if (tick === 40) return [{ t: "move", ids: combat, x: 430, y: 300 }];
  if (tick === 120) return [{ t: "train", kind: "ranger" }];
  if (tick === 220) return [{ t: "build", kind: "factory", ids: drones, x: 200, y: 395 }];
  if (tick === 430) return [{ t: "train", kind: "tank" }];
  if (tick > 0 && tick % 360 === 0) {
    const target = state.buildings.find((building) => building.team === core.ENEMY && building.kind === "hq");
    const army = playerUnits(state).filter((unit) => unit.kind !== "drone").map((unit) => unit.id);
    return target && army.length ? [{ t: "attack", ids: army, target: target.id }] : [];
  }
  return [];
}

test("seed parsing produces stable canonical uint32 identities", () => {
  assert.equal(core.normalizeSeed(0x1234abcd), 0x1234abcd);
  assert.equal(core.normalizeSeed("0x1234ABCD"), 0x1234abcd);
  assert.equal(core.normalizeSeed("305441741"), 0x1234abcd);
  assert.equal(core.seedHex(core.normalizeSeed("PIXEL-WARFRONT")), "8D566E6E");
});

test("mission blueprints repeat for one seed and diverge across seed or level", () => {
  const first = core.makeMissionBlueprint("REPEATABLE-FRONT", 3);
  const second = core.makeMissionBlueprint("REPEATABLE-FRONT", 3);
  assert.equal(first.signature, second.signature);
  assert.deepEqual(first.terrain, second.terrain);
  assert.deepEqual(first.resources, second.resources);
  assert.notEqual(first.signature, core.makeMissionBlueprint("OTHER-FRONT", 3).signature);
  assert.notEqual(first.signature, core.makeMissionBlueprint("REPEATABLE-FRONT", 4).signature);
});

test("enemy pressure rises monotonically with every procedural mission", () => {
  let previous = core.difficultyFor(1);
  for (let level = 2; level <= 80; level += 1) {
    const current = core.difficultyFor(level);
    assert.ok(current.rank > previous.rank);
    assert.ok(current.enemyHealthPercent > previous.enemyHealthPercent);
    assert.ok(current.enemyDamagePercent > previous.enemyDamagePercent);
    assert.ok(current.enemyIncomePerTick >= previous.enemyIncomePerTick);
    assert.ok(current.waveGap <= previous.waveGap);
    assert.ok(current.trainGap <= previous.trainGap);
    assert.ok(current.startingForce >= previous.startingForce);
    previous = current;
  }
});

test("the fixed-tick command simulation matches its checked golden digest", () => {
  const state = core.createRun("GOLDEN-WARFRONT");
  for (let tick = 0; tick < 900 && !state.gameOver; tick += 1) {
    core.step(state, scriptedCommands(state, tick));
  }
  assert.equal(state.tick, 900);
  assert.equal(state.gameOver, false);
  assert.equal(core.stateDigest(state), "0F2C2ECB");
});

test("sparse command replay reconstructs the exact authoritative state", () => {
  const original = core.createRun("COMMAND-ROUNDTRIP");
  const recorder = core.createRecorder(original.seed);
  for (let tick = 0; tick < 1400 && !original.gameOver; tick += 1) {
    const commands = scriptedCommands(original, tick);
    core.recordCommands(recorder, commands);
    core.step(original, commands);
  }

  const code = core.encodeReplay(recorder);
  const decoded = core.decodeReplay(code);
  const replayed = core.createRun(decoded.seed);
  const cursor = core.createReplayCursor(decoded);
  let commands;
  while ((commands = core.nextReplayCommands(cursor)) !== null) core.step(replayed, commands);

  assert.equal(decoded.ticks, recorder.ticks);
  assert.ok(decoded.entries.length < decoded.ticks / 20, "command log should remain sparse");
  assert.equal(core.stateDigest(replayed), core.stateDigest(original));
  assert.deepEqual(replayed.stats, original.stats);
});

test("replay checksums and non-canonical commands reject tampering", () => {
  const recorder = core.createRecorder("TAMPERED-FRONT");
  core.recordCommands(recorder, [{ t: "move", ids: [11], x: 300, y: 300 }]);
  const code = core.encodeReplay(recorder);
  const last = code.at(-1);
  const tampered = `${code.slice(0, -1)}${last === "A" ? "B" : "A"}`;
  assert.throws(() => core.decodeReplay(tampered), /checksum|base64|JSON/i);
  assert.deepEqual(core.sanitizeCommands([{ t: "launch-nuke", ids: [11] }]), []);
});

test("drones harvest deterministic flux and return it to the economy", () => {
  const state = core.createRun("HARVEST-LOOP");
  const initialCredits = state.credits;
  for (let tick = 0; tick < 520; tick += 1) core.step(state, []);
  assert.ok(state.stats.resourcesMined >= core.UNIT_TYPES.drone.carry);
  assert.ok(state.credits > initialCredits);
});

test("construction and production consume credits and complete on fixed ticks", () => {
  const state = core.createRun("BUILD-TEST");
  const drones = playerUnits(state, "drone").map((unit) => unit.id);
  core.step(state, [{ t: "build", kind: "relay", ids: drones, x: 170, y: 200 }]);
  assert.equal(state.stats.structuresBuilt, 1);
  const relay = state.buildings.find((building) => building.team === core.PLAYER && building.kind === "relay");
  assert.ok(relay && relay.construction > 0);
  for (let tick = 0; tick < core.BUILDING_TYPES.relay.buildTicks; tick += 1) core.step(state, []);
  assert.equal(relay.construction, 0);

  const beforeUnits = playerUnits(state, "drone").length;
  core.step(state, [{ t: "train", kind: "drone" }]);
  for (let tick = 0; tick < core.UNIT_TYPES.drone.trainTicks; tick += 1) core.step(state, []);
  assert.equal(playerUnits(state, "drone").length, beforeUnits + 1);
  assert.equal(state.stats.unitsBuilt, 1);
});

test("destroying the enemy command node advances to a harder fresh battlefield", () => {
  const state = core.createRun("MISSION-ADVANCE");
  const ranger = playerUnits(state, "ranger")[0];
  const enemyHq = state.buildings.find((building) => building.team === core.ENEMY && building.kind === "hq");
  const firstSignature = state.blueprint.signature;
  enemyHq.x = ranger.x + 70 * core.SCALE;
  enemyHq.y = ranger.y;
  enemyHq.health = 1;
  let sawVictory = false;
  for (let tick = 0; tick < 60 && !state.missionWon; tick += 1) {
    core.step(state, tick === 0 ? [{ t: "attack", ids: [ranger.id], target: enemyHq.id }] : []);
    if (state.events.some((event) => event.type === "victory")) sawVictory = true;
  }
  assert.equal(sawVictory, true);
  assert.equal(state.missionWon, true);
  while (state.level === 1) core.step(state, []);
  assert.equal(state.level, 2);
  assert.equal(state.stats.missionsCleared, 1);
  assert.notEqual(state.blueprint.signature, firstSignature);
  assert.ok(state.blueprint.difficulty.enemyHealthPercent > 100);
});

test("the simulation core has no ambient clock, storage, DOM, or random source", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "core.js"), "utf8");
  for (const forbidden of ["Math.random", "Date.now", "performance.now", "localStorage", "sessionStorage", "document.", "fetch("]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must stay outside the deterministic core`);
  }
});

process.on("exit", () => {
  if (!process.exitCode) process.stdout.write(`# ${passed} deterministic RTS tests passed\n`);
});
