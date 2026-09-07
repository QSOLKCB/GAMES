"use strict";
const assert = require("node:assert/strict");
const core = require("../core.js");

function pulse(state, input) { core.step(state, input); core.step(state, 0); }

assert.equal(core.TICK_HZ, 60);
assert.equal(core.DIRECTIONS.length, 32);
assert.equal(core.normalizeSeed("0x1234ABCD"), 0x1234abcd);

const first = core.createGame("WEB-DRIFT-TEST");
const second = core.createGame("WEB-DRIFT-TEST");
const script = [];
pulse(first, core.INPUT.LAUNCH); pulse(second, core.INPUT.LAUNCH);
for (let tick = 0; tick < 2400; tick += 1) {
  let input = tick < 620 ? core.INPUT.THRUST : 0;
  if (tick % 170 < 34) input |= core.INPUT.TURN_RIGHT;
  if (tick % 23 < 7) input |= core.INPUT.FIRE;
  if (tick === 860) input |= core.INPUT.ENGINE_KILL;
  script.push(input);
  core.step(first, input); core.step(second, input);
}
assert.equal(core.stateDigest(first), core.stateDigest(second), "same seed and input must reproduce exactly");
assert.deepEqual(first, second);
assert.notEqual(core.stateDigest(first), core.stateDigest(core.createGame("OTHER-SEED")));

const inertial = core.createGame(991);
pulse(inertial, core.INPUT.LAUNCH);
for (let tick = 0; tick < 90; tick += 1) core.step(inertial, core.INPUT.THRUST);
pulse(inertial, core.INPUT.ENGINE_KILL);
const beforeTurn = [inertial.player.vx, inertial.player.vy];
for (let tick = 0; tick < 12; tick += 1) core.step(inertial, core.INPUT.TURN_RIGHT);
assert.deepEqual([inertial.player.vx, inertial.player.vy], beforeTurn, "engine-kill turning must not rotate travel velocity");
assert.ok(Math.hypot(...beforeTurn) > 500, "thrust should produce useful system-crossing speed");

const trader = core.createGame("MARKET");
const credits = trader.player.credits;
pulse(trader, core.INPUT.BUY);
assert.equal(trader.player.cargo[0], 1);
assert.ok(trader.player.credits < credits);
pulse(trader, core.INPUT.SELL);
assert.equal(trader.player.cargo[0], 0);
pulse(trader, core.INPUT.MISSION);
assert.ok(trader.mission, "station contract should be generated");
trader.player.cargo[trader.mission.commodity] = trader.mission.quantity;
trader.player.system = trader.mission.destination;
trader.player.docked = false;
trader.player.x = trader.systems[trader.player.system].station.x;
trader.player.y = trader.systems[trader.player.system].station.y;
const scoreBefore = trader.score;
pulse(trader, core.INPUT.INTERACT);
assert.equal(trader.mission, null);
assert.ok(trader.score > scoreBefore, "delivered contract should score");

const invalidInput = core.createGame("MASK");
core.step(invalidInput, 0xffffffff);
assert.equal(invalidInput.previousInput, core.ACTION_MASK);
assert.match(core.stateDigest(first), /^[0-9A-F]{8}$/);
console.log(`TERNARY DRIFT web core OK / ${core.stateDigest(first)}`);
