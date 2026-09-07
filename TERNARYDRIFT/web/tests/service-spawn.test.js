"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../core.js");

for (const [label, hullMissing, shieldMissing] of [
  ["shield only", 0, 23], ["hull only", 17, 0], ["mixed damage", 17, 23],
]) {
  test(`station repairs restore ${label} for the full combined price`, () => {
    const state = core.createGame("SERVICE");
    const player = state.player;
    player.hull -= hullMissing;
    player.shield -= shieldMissing;
    const cost = hullMissing * 3 + shieldMissing;
    player.credits = cost;
    core.step(state, core.INPUT.REPAIR);
    assert.equal(player.hull, player.hullMax);
    assert.equal(player.shield, player.shieldMax);
    assert.equal(player.credits, 0);
    assert.deepEqual(state.events, [{ type: core.EVENTS.REPAIRED, cost }]);
    core.step(state, core.INPUT.REPAIR);
    assert.deepEqual(state.events, [], "holding repair must not charge again");
  });
}

test("insufficient repair credits leave both meters and the balance unchanged", () => {
  for (const [hullMissing, shieldMissing] of [[0, 60], [10, 20]]) {
    const state = core.createGame("CANNOT-AFFORD");
    const player = state.player;
    player.hull -= hullMissing;
    player.shield -= shieldMissing;
    player.credits = hullMissing * 3 + shieldMissing - 1;
    const before = [player.hull, player.shield, player.credits];
    core.step(state, core.INPUT.REPAIR);
    assert.deepEqual([player.hull, player.shield, player.credits], before);
    assert.equal(state.events.some(e => e.type === core.EVENTS.REPAIRED), false);
  }
});

test("a fully restored ship needs no repair and incurs no charge", () => {
  const state = core.createGame("FULL-SERVICE");
  const credits = state.player.credits;
  core.step(state, core.INPUT.REPAIR);
  assert.equal(state.player.credits, credits);
  assert.deepEqual(state.events, []);
});

function nextRandom(value) {
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return value >>> 0 || 0x6d2b79f5;
}

test("edge, corner and interior spawns preserve sampled separation and RNG consumption", () => {
  const points = [[0, 0], [1100, 0], [-1100, 0], [0, 800], [0, -800],
    [1100, 800], [1100, -800], [-1100, 800], [-1100, -800],
    [1090, 790], [-1090, 790], [1090, -790], [-1090, -790]];
  const lanes = new Set();
  let reflected = 0;
  for (const [x, y] of points) {
    for (let seed = 1; seed <= 128; seed += 1) {
      const state = core.createGame(seed);
      state.player.docked = false;
      state.player.x = x * core.FP;
      state.player.y = y * core.FP;
      state.respawnTicks = 300; // Exercise the real public-step respawn path.
      const laneRandom = nextRandom(state.rng);
      const lane = laneRandom & 31;
      const distanceRandom = nextRandom(laneRandom);
      const requested = 380 + distanceRandom % 241;
      const direction = core.DIRECTIONS[lane];
      const dx = direction[0] * requested;
      const dy = direction[1] * requested;
      lanes.add(lane);
      const outside = Math.abs(state.player.x + dx) > 1100 * core.FP || Math.abs(state.player.y + dy) > 800 * core.FP;
      if (outside) reflected += 1;
      const expectedRng = nextRandom(nextRandom(distanceRandom));
      core.step(state, 0);
      assert.equal(state.enemies.length, 1);
      const enemy = state.enemies[0];
      assert.ok(Number.isInteger(enemy.x) && Number.isInteger(enemy.y));
      assert.ok(Math.abs(enemy.x) <= 1100 * core.FP && Math.abs(enemy.y) <= 800 * core.FP);
      const actualX = enemy.x - state.player.x;
      const actualY = enemy.y - state.player.y;
      // Reflection may change signs, but cannot shorten either sampled component.
      assert.equal(Math.abs(actualX), Math.abs(dx), `x separation at ${x},${y}, seed ${seed}`);
      assert.equal(Math.abs(actualY), Math.abs(dy), `y separation at ${x},${y}, seed ${seed}`);
      assert.ok(Math.abs(Math.hypot(actualX, actualY) / core.FP - requested) < .5,
        "radius must match the requested distance within fixed-point direction rounding");
      const facing = core.DIRECTIONS[enemy.heading];
      assert.ok(facing[0] * actualX + facing[1] * actualY < 0, "hostile faces inward toward the player");
      assert.equal(state.rng, expectedRng, "edge correction consumes no extra randomness");
      if (!outside) assert.deepEqual([actualX, actualY], [dx, dy], "valid interior placements stay unchanged");
    }
  }
  assert.equal(lanes.size, 32, "exercise every sampled direction");
  assert.ok(reflected > 500, "exercise outward spawns at all boundaries");
});
