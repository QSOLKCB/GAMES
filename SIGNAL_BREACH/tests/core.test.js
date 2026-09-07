"use strict";
const assert = require("node:assert/strict");
const core = require("../core.js");

assert.equal(core.TICK_HZ, 60);
assert.equal(core.WEAPONS.length, 3);
assert.equal(core.DIRECTIONS.length, 64);
const seed = core.textSeed("NIGHT-CIRCUIT-7");
const sample = core.fallbackSamples(seed, 96);
const first = core.createGame(seed, sample);
const second = core.createGame(seed, sample);
assert.deepEqual(first.arena, second.arena);
assert.ok(first.arena.cover.length >= 10 && first.arena.cover.length <= 22);

for (let tick = 0; tick < 1800; tick += 1) {
  let input = tick % 480 < 240 ? core.INPUT.RIGHT : core.INPUT.DOWN;
  if (tick % 11 < 5) input |= core.INPUT.FIRE;
  if (tick === 300 || tick === 900) input |= core.INPUT.DASH;
  if (tick === 620) input |= core.INPUT.NEXT;
  const aim = (tick >> 4) & 63;
  core.step(first, input, aim); core.step(second, input, aim);
}
assert.deepEqual(first, second, "same seed, Rust-compatible samples, and inputs must reproduce");
assert.equal(core.stateDigest(first), core.stateDigest(second));
assert.match(core.stateDigest(first), /^[0-9A-F]{8}$/);

const motion = core.createGame("MOVE"); motion.enemies.length = 0;
const startX = motion.player.x;
for (let tick = 0; tick < 60; tick += 1) core.step(motion, core.INPUT.RIGHT, 0);
assert.ok(motion.player.x > startX + 40 * core.FP, "movement should feel immediate and cover useful ground");

const weapons = core.createGame("WEAPONS"); weapons.enemies.length = 0;
core.step(weapons, core.INPUT.NEXT, 0); core.step(weapons, 0, 0);
assert.equal(weapons.player.weapon, 1);
core.step(weapons, core.INPUT.FIRE, 0);
assert.equal(weapons.bullets.length, 7, "scatter platform should emit a readable seven-shot fan");

const objective = core.createGame("OBJECTIVE"); objective.enemies.length = 0;
for (const relay of objective.arena.relays) {
  objective.enemies.length = 0; objective.player.x = relay.x * core.FP; objective.player.y = relay.y * core.FP;
  for (let tick = 0; tick < 181; tick += 1) core.step(objective, 0, 0);
  assert.equal(relay.captured, true);
}
assert.equal(objective.arena.extraction.open, true);
objective.enemies.length = 0; objective.player.x = objective.arena.extraction.x * core.FP; objective.player.y = objective.arena.extraction.y * core.FP;
core.step(objective, 0, 0);
assert.equal(objective.status, "victory");
console.log(`SIGNAL BREACH core OK / ${core.stateDigest(first)}`);
