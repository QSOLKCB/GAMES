"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../core.js");

function assertClear(arena, label) {
  for (const relay of arena.relays) {
    assert.ok(Number.isInteger(relay.x) && Number.isInteger(relay.y), `${label}: integer relay coordinates`);
    assert.ok(Math.abs(relay.x) + 46 <= core.WORLD.width / 2, `${label}: marker fits horizontally`);
    assert.ok(Math.abs(relay.y) + 46 <= core.WORLD.height / 2, `${label}: marker fits vertically`);
    for (const block of arena.cover) {
      assert.ok(Math.abs(relay.x - block.x) >= block.w / 2 + 75 ||
        Math.abs(relay.y - block.y) >= block.h / 2 + 75,
      `${label}: relay ${relay.id} needs 75-unit clearance from cover ${block.id}`);
    }
  }
}

test("SEED-34473 relays clear every block and can be captured at their centers", () => {
  for (const count of [64, 96]) {
    const seed = core.textSeed("SEED-34473");
    const state = core.createGame(seed, core.fallbackSamples(seed, count));
    assertClear(state.arena, `SEED-34473/${count}`);
    for (const relay of state.arena.relays) {
      state.enemies.length = 0;
      state.player.x = relay.x * core.FP; state.player.y = relay.y * core.FP;
      for (let tick = 0; tick < 180; tick += 1) core.step(state, 0, 0);
      assert.equal(relay.captured, true);
      assert.equal(state.player.x, relay.x * core.FP, "cover must not displace the operator");
      assert.equal(state.player.y, relay.y * core.FP, "cover must not displace the operator");
    }
    assert.equal(state.arena.extraction.open, true);
  }
});

test("seeded relays retain clear initial positions and relocate deterministically", () => {
  let unchanged = 0; let relocated = 0;
  for (const count of [32, 64, 96, 512]) for (let index = 0; index < 256; index += 1) {
    const seed = core.textSeed(`ARENA-CLEARANCE-${index}`);
    const samples = core.fallbackSamples(seed, count);
    const arena = core.createGame(seed, samples).arena;
    assertClear(arena, `${seed}/${count}`);
    assert.deepEqual(core.createGame(seed, samples).arena, arena);
    const lane = (sample, field) => samples[(sample % count) * 8 + field];
    const initial = [
      [-235 + Math.round(lane(30, 0) * 80), -220 + Math.round(lane(30, 1) * 80)],
      [35 + Math.round(lane(31, 0) * 100), 170 + Math.round(lane(31, 1) * 80)],
      [360 + Math.round(lane(32, 0) * 90), -150 + Math.round(lane(32, 1) * 90)],
    ];
    initial.forEach(([x, y], i) => {
      const blocked = arena.cover.some(block => Math.abs(x - block.x) < block.w / 2 + 75 && Math.abs(y - block.y) < block.h / 2 + 75);
      if (blocked) relocated += 1;
      else { assert.deepEqual([arena.relays[i].x, arena.relays[i].y], [x, y]); unchanged += 1; }
    });
  }
  assert.ok(unchanged > 100 && relocated > 100, "sweep must exercise both clear and obstructed placements");
});

test("dense valid cover still leaves a bounded, clear relay placement", () => {
  const samples = new Float32Array(96 * 8).fill(0.5);
  let index = 0;
  for (const y of [-300, -100, 100, 300]) for (const x of [-500, -250, 0, 250, 500]) {
    samples[index * 8] = (x + 500) / 1000;
    // Keep the western blocks outside the protected player spawn corridor.
    const coverY = x === -500 && Math.abs(y) === 100 ? Math.sign(y) * 130 : y;
    samples[index * 8 + 1] = (coverY + 320) / 640;
    samples[index * 8 + 2] = 0.999;
    samples[index * 8 + 3] = 0.999;
    index += 1;
  }
  const arena = core.createGame("DENSE-CLEARANCE", samples).arena;
  assert.equal(arena.cover.length, 20, "fixture must retain the complete cover grid");
  assertClear(arena, "dense arena");
  assert.ok(arena.relays.every(relay => Math.abs(relay.x) > 625),
    "the fully obstructed interior must still allow clear placements near the side walls");
});
