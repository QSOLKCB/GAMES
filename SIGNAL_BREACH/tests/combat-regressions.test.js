"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../core.js");

function emptyArena() {
  const state = core.createGame("COMBAT-REGRESSIONS");
  state.enemies.length = 0;
  state.arena.cover.length = 0;
  state.arena.relays.length = 0;
  state.player.x = 0;
  state.player.y = 0;
  return state;
}

function target(id, x, kind = "lancer") {
  return { id, kind, x: x * core.FP, y: 0, vx: 0, vy: 0, health: 130,
    maxHealth: 130, damage: 17, speed: 0, cooldown: 1000, phase: 0 };
}

for (const source of ["contact", "projectile"]) {
  test(`lethal ${source} damage wins over open extraction on the same tick`, () => {
    const state = emptyArena();
    state.arena.extraction = { x: 0, y: 0, open: true };
    state.player.armor = 0;
    state.player.health = 1;
    state.score = 100;
    if (source === "contact") state.enemies.push(target(1, -20));
    else state.bullets.push({ id: 2, hostile: true, x: -core.FP, y: 0,
      vx: core.FP, vy: 0, life: 10, damage: 20 });
    core.step(state, 0, 0);
    assert.equal(state.player.health, 0);
    assert.equal(state.status, "defeat");
    assert.equal(state.score, 100, "a dead operator must not receive the extraction bonus");
    assert.deepEqual(state.events.filter(e => [core.EVENTS.DEFEAT, core.EVENTS.VICTORY].includes(e.type)),
      [{ type: core.EVENTS.DEFEAT }]);
    const digest = core.stateDigest(state);
    core.step(state, core.INPUT.FIRE, 0);
    assert.equal(core.stateDigest(state), digest, "defeat remains terminal on later ticks");
  });
}

test("lethal damage also prevents a last-tick relay capture and its rewards", () => {
  const state = emptyArena();
  state.arena.relays.push({ id: 1, x: 0, y: 0, progress: 179, captured: false });
  state.player.armor = 0;
  state.player.health = 1;
  state.bullets.push({ id: 2, hostile: true, x: 0, y: 0, vx: 0, vy: 0, life: 10, damage: 20 });
  core.step(state, 0, 0);
  assert.equal(state.arena.relays[0].captured, false);
  assert.equal(state.score, 0);
  assert.equal(state.wave, 0);
  assert.equal(state.events.some(e => e.type === core.EVENTS.CAPTURE), false);
});

test("a living operator still extracts exactly once", () => {
  const state = emptyArena();
  state.arena.extraction = { x: 0, y: 0, open: true };
  core.step(state, 0, 0);
  assert.equal(state.status, "victory");
  assert.equal(state.score, 29999);
  assert.deepEqual(state.events, [{ type: core.EVENTS.VICTORY }]);
  core.step(state, 0, 0);
  assert.equal(state.score, 29999);
  assert.deepEqual(state.events, []);
});

test("close-range enemy retreat wraps every direction-table index", () => {
  for (const kind of ["wraith", "lancer", "bulwark"]) {
    for (let lane = 0; lane < 64; lane += 1) {
      const state = emptyArena();
      const enemy = target(1, 0, kind);
      enemy.x = core.DIRECTIONS[lane][0] * 40;
      enemy.y = core.DIRECTIONS[lane][1] * 40;
      enemy.speed = 1000;
      enemy.phase = lane;
      state.enemies.push(enemy);
      core.step(state, 0, 0);
      assert.ok([enemy.x, enemy.y, enemy.vx, enemy.vy].every(Number.isFinite));
    }
  }
});

test("Null Lance penetrates separated targets across ticks without repeat damage", () => {
  const state = emptyArena();
  state.player.weapon = 2;
  const first = target(1, 80);
  const second = target(2, 200);
  state.enemies.push(first, second);
  const hits = [];
  for (let tick = 0; tick < 14; tick += 1) {
    core.step(state, tick === 0 ? core.INPUT.FIRE : 0, 0);
    for (const event of state.events) if (event.type === core.EVENTS.HIT) hits.push({ tick, target: event.target });
    if (hits.length === 1) assert.equal(state.bullets.length, 1, "lance survives its first target");
  }
  assert.deepEqual(hits.map(hit => hit.target), [1, 2], "one damage application per target per lance");
  assert.ok(hits[1].tick > hits[0].tick, "targets must be hit on different ticks");
  assert.equal(first.health, first.maxHealth - core.WEAPONS[2].damage);
  assert.equal(second.health, second.maxHealth - core.WEAPONS[2].damage);
});

test("carbine rounds still expire at the first target", () => {
  const state = emptyArena();
  const first = target(1, 80);
  const second = target(2, 200);
  state.enemies.push(first, second);
  for (let tick = 0; tick < 18; tick += 1) core.step(state, tick === 0 ? core.INPUT.FIRE : 0, 0);
  assert.equal(first.health, first.maxHealth - core.WEAPONS[0].damage);
  assert.equal(second.health, second.maxHealth);
  assert.equal(state.bullets.length, 0);
});

test("penetrating rounds still stop at cover and their lifetime limit", () => {
  const state = emptyArena();
  state.player.weapon = 2;
  state.enemies.push(target(1, 80), target(2, 200));
  state.arena.cover.push({ x: 140, y: 0, w: 20, h: 80 });
  for (let tick = 0; tick < 14; tick += 1) core.step(state, tick === 0 ? core.INPUT.FIRE : 0, 0);
  assert.equal(state.enemies[0].health, 76);
  assert.equal(state.enemies[1].health, 130);
  assert.equal(state.bullets.length, 0);

  const expiry = emptyArena();
  expiry.player.weapon = 2;
  core.step(expiry, core.INPUT.FIRE, 0);
  const bullet = expiry.bullets[0];
  bullet.vx = 0;
  const ticksLeft = bullet.life;
  for (let tick = 0; tick < ticksLeft; tick += 1) core.step(expiry, 0, 0);
  assert.equal(expiry.bullets.length, 0);
});
