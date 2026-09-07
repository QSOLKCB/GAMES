(function installSignalBreachCore(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SignalBreachCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSignalBreachCore() {
  "use strict";
  const VERSION = 1;
  const TICK_HZ = 60;
  const FP = 1024;
  const WORLD = Object.freeze({ width: 1400, height: 900 });
  const INPUT = Object.freeze({ UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, FIRE: 16, DASH: 32, PREV: 64, NEXT: 128 });
  const WEAPONS = Object.freeze([
    Object.freeze({ name: "VECTOR CARBINE", cooldown: 7, speed: 13, damage: 16, shots: 1, spread: 0, heat: 8, color: 0x7ffff0 }),
    Object.freeze({ name: "ARC SCATTER", cooldown: 24, speed: 10, damage: 9, shots: 7, spread: 2, heat: 19, color: 0xf0b65f }),
    Object.freeze({ name: "NULL LANCE", cooldown: 38, speed: 18, damage: 54, shots: 1, spread: 0, heat: 27, color: 0xe879ff }),
  ]);
  const EVENTS = Object.freeze({ SHOT: "shot", HIT: "hit", DASH: "dash", CAPTURE: "capture", ENEMY_DOWN: "enemy-down", WEAPON: "weapon", VICTORY: "victory", DEFEAT: "defeat", WAVE: "wave" });
  const DIRECTIONS = Object.freeze(Array.from({ length: 64 }, (_, index) => Object.freeze([
    Math.round(Math.cos(index * Math.PI * 2 / 64) * FP), Math.round(Math.sin(index * Math.PI * 2 / 64) * FP),
  ])));

  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function hash32(value) {
    let mixed = value >>> 0; mixed ^= mixed >>> 16; mixed = Math.imul(mixed, 0x7feb352d);
    mixed ^= mixed >>> 15; mixed = Math.imul(mixed, 0x846ca68b); return (mixed ^ mixed >>> 16) >>> 0;
  }
  function textSeed(value) {
    let hash = 0x811c9dc5; const text = String(value == null ? "" : value) || "SIGNAL-BREACH";
    for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
    return hash32(hash) || 1;
  }
  function seedHex(seed) { return (seed >>> 0).toString(16).toUpperCase().padStart(8, "0"); }
  function fallbackSamples(seed, count) {
    const output = new Float32Array(count * 8);
    for (let index = 0; index < count; index += 1) {
      const id = Math.trunc(index * 65536 / count) >>> 0;
      for (let lane = 0; lane < 8; lane += 1) output[index * 8 + lane] = (hash32(id ^ seed ^ Math.imul(lane + 1, 0x9e3779b9)) >>> 8) / 16777216;
    }
    return output;
  }
  function value(samples, index, lane) { return samples[(index % Math.trunc(samples.length / 8)) * 8 + lane]; }
  function distanceSq(a, b) { const dx = (a.x - b.x) / FP; const dy = (a.y - b.y) / FP; return dx * dx + dy * dy; }
  function nextRandom(state) { let v = state.rng; v ^= v << 13; v ^= v >>> 17; v ^= v << 5; state.rng = v >>> 0 || 1; return state.rng; }
  function pointBlocked(cover, x, y, margin) {
    return cover.some((block) => Math.abs(x - block.x) < block.w / 2 + margin && Math.abs(y - block.y) < block.h / 2 + margin);
  }

  function clearRelay(cover, relay) {
    const margin = 75;
    if (!pointBlocked(cover, relay.x, relay.y, margin)) return;
    // Keep the 46-unit marker inside the arena. The x boundaries are also
    // guaranteed clear: generated cover plus its margin never reaches +/-650.
    const limitX = WORLD.width / 2 - 50; const limitY = WORLD.height / 2 - 50;
    const xs = [relay.x, -limitX, limitX]; const ys = [relay.y, -limitY, limitY];
    for (const block of cover) {
      xs.push(Math.floor(block.x - block.w / 2 - margin), Math.ceil(block.x + block.w / 2 + margin));
      ys.push(Math.floor(block.y - block.h / 2 - margin), Math.ceil(block.y + block.h / 2 + margin));
    }
    // A nearest clear point lies on an expanded cover edge or keeps an original
    // coordinate. Check every candidate against all blocks, with stable ties.
    let best = null; let bestDistance = Infinity;
    for (const x of xs) for (const y of ys) {
      if (Math.abs(x) > limitX || Math.abs(y) > limitY) continue;
      const distance = (x - relay.x) ** 2 + (y - relay.y) ** 2;
      if (distance >= bestDistance || pointBlocked(cover, x, y, margin)) continue;
      best = { x, y }; bestDistance = distance;
    }
    relay.x = best.x; relay.y = best.y;
  }

  function buildArena(seed, supplied) {
    const samples = supplied && supplied.length >= 256 ? supplied : fallbackSamples(seed, 64);
    const cover = [];
    for (let index = 0; index < 22; index += 1) {
      let x = -500 + value(samples, index, 0) * 1000;
      let y = -320 + value(samples, index, 1) * 640;
      const w = 58 + Math.floor(value(samples, index, 2) * 86);
      const h = 40 + Math.floor(value(samples, index, 3) * 74);
      if (x < -390 && Math.abs(y) < 130) x += 230;
      if (cover.some((block) => Math.abs(x - block.x) < (w + block.w) / 2 + 34 && Math.abs(y - block.y) < (h + block.h) / 2 + 34)) continue;
      cover.push({ id: index + 1, x: Math.round(x), y: Math.round(y), w, h, variant: Math.floor(value(samples, index, 4) * 3) });
    }
    const relays = [
      { id: 1, x: -235 + Math.round(value(samples, 30, 0) * 80), y: -220 + Math.round(value(samples, 30, 1) * 80), progress: 0, captured: false },
      { id: 2, x: 35 + Math.round(value(samples, 31, 0) * 100), y: 170 + Math.round(value(samples, 31, 1) * 80), progress: 0, captured: false },
      { id: 3, x: 360 + Math.round(value(samples, 32, 0) * 90), y: -150 + Math.round(value(samples, 32, 1) * 90), progress: 0, captured: false },
    ];
    for (const relay of relays) clearRelay(cover, relay);
    return { cover, relays, extraction: { x: 602, y: 315, open: false }, sampleCount: samples.length / 8 };
  }

  function makeEnemy(state, kind, x, y) {
    const stats = kind === "bulwark" ? [130, 8, 1000] : kind === "lancer" ? [70, 17, 1420] : [48, 12, 1820];
    state.enemies.push({ id: state.nextId++, kind, x: Math.round(x * FP), y: Math.round(y * FP), vx: 0, vy: 0, health: stats[0], maxHealth: stats[0], damage: stats[1], speed: stats[2], cooldown: 40 + nextRandom(state) % 60, phase: nextRandom(state) & 63 });
  }
  function spawnWave(state, wave) {
    const count = 4 + wave * 2;
    for (let index = 0; index < count; index += 1) {
      const edge = (index + wave) % 4;
      const t = (nextRandom(state) % 700) - 350;
      const x = edge < 2 ? (edge ? 650 : -650) : t;
      const y = edge >= 2 ? (edge === 2 ? -400 : 400) : t;
      const kind = wave > 1 && index % 5 === 0 ? "bulwark" : wave > 0 && index % 3 === 0 ? "lancer" : "wraith";
      makeEnemy(state, kind, x, y);
    }
    state.events.push({ type: EVENTS.WAVE, wave });
  }
  function createGame(seedInput, samples) {
    const seed = typeof seedInput === "number" ? seedInput >>> 0 || 1 : textSeed(seedInput);
    const state = {
      version: VERSION, seed, rng: hash32(seed ^ 0xa17c9e31), tick: 0, nextId: 100, status: "active", score: 0, wave: 0,
      arena: buildArena(seed, samples), enemies: [], bullets: [], particles: [], events: [], previousInput: 0,
      player: { x: -590 * FP, y: 0, vx: 0, vy: 0, aim: 0, radius: 17, health: 100, maxHealth: 100, armor: 50, maxArmor: 50, dash: 100, maxDash: 100, heat: 0, cooldown: 0, weapon: 0, invulnerable: 0 },
    };
    spawnWave(state, 0); return state;
  }

  function collideArena(state, body, radius) {
    const limitX = WORLD.width / 2 - radius; const limitY = WORLD.height / 2 - radius;
    body.x = clamp(body.x, -limitX * FP, limitX * FP); body.y = clamp(body.y, -limitY * FP, limitY * FP);
    for (const block of state.arena.cover) {
      const left = (block.x - block.w / 2 - radius) * FP; const right = (block.x + block.w / 2 + radius) * FP;
      const top = (block.y - block.h / 2 - radius) * FP; const bottom = (block.y + block.h / 2 + radius) * FP;
      if (body.x <= left || body.x >= right || body.y <= top || body.y >= bottom) continue;
      const distances = [Math.abs(body.x - left), Math.abs(body.x - right), Math.abs(body.y - top), Math.abs(body.y - bottom)];
      const side = distances.indexOf(Math.min(...distances));
      if (side === 0) { body.x = left; body.vx = Math.min(0, body.vx); }
      else if (side === 1) { body.x = right; body.vx = Math.max(0, body.vx); }
      else if (side === 2) { body.y = top; body.vy = Math.min(0, body.vy); }
      else { body.y = bottom; body.vy = Math.max(0, body.vy); }
    }
  }
  function directionTo(dx, dy) {
    let best = 0; let score = -Infinity;
    for (let i = 0; i < 64; i += 1) { const dot = dx * DIRECTIONS[i][0] + dy * DIRECTIONS[i][1]; if (dot > score) { score = dot; best = i; } }
    return best;
  }
  function addVelocity(body, direction, amount) { const vector = DIRECTIONS[direction & 63]; body.vx += Math.trunc(vector[0] * amount / FP); body.vy += Math.trunc(vector[1] * amount / FP); }
  function capVelocity(body, maximum) { const speed = Math.hypot(body.vx, body.vy); if (speed > maximum) { body.vx = Math.trunc(body.vx * maximum / speed); body.vy = Math.trunc(body.vy * maximum / speed); } }
  function fire(state, owner, source, aim, weaponIndex, damageScale) {
    const weapon = WEAPONS[weaponIndex];
    for (let shot = 0; shot < weapon.shots; shot += 1) {
      const offset = weapon.shots === 1 ? 0 : (shot - (weapon.shots - 1) / 2) * weapon.spread;
      const direction = (aim + Math.round(offset) + 64) & 63; const vector = DIRECTIONS[direction];
      state.bullets.push({ id: state.nextId++, owner, hostile: owner !== "player", x: source.x + vector[0] * 21, y: source.y + vector[1] * 21, vx: vector[0] * weapon.speed, vy: vector[1] * weapon.speed, damage: Math.round(weapon.damage * (damageScale || 1)), life: weaponIndex === 2 ? 72 : 58, color: weapon.color, lance: weaponIndex === 2, hitTargets: [] });
    }
    state.events.push({ type: EVENTS.SHOT, owner, weapon: weaponIndex });
  }
  function damagePlayer(state, amount) {
    const p = state.player; if (p.invulnerable > 0) return;
    const absorbed = Math.min(p.armor, amount); p.armor -= absorbed; p.health -= amount - absorbed; p.invulnerable = 9;
    state.events.push({ type: EVENTS.HIT, target: "player", amount });
    if (p.health <= 0) { p.health = 0; state.status = "defeat"; state.events.push({ type: EVENTS.DEFEAT }); }
  }
  function pointInCover(arena, x, y) { return arena.cover.some((b) => Math.abs(x / FP - b.x) < b.w / 2 && Math.abs(y / FP - b.y) < b.h / 2); }

  function stepPlayer(state, input, pressed, aim) {
    const p = state.player; p.aim = Number.isFinite(aim) ? aim & 63 : p.aim;
    const mx = ((input & INPUT.RIGHT) ? 1 : 0) - ((input & INPUT.LEFT) ? 1 : 0);
    const my = ((input & INPUT.DOWN) ? 1 : 0) - ((input & INPUT.UP) ? 1 : 0);
    const diagonalScale = mx && my ? 724 : FP;
    p.vx += Math.trunc(mx * 170 * diagonalScale / FP); p.vy += Math.trunc(my * 170 * diagonalScale / FP);
    p.vx = Math.trunc(p.vx * 850 / FP); p.vy = Math.trunc(p.vy * 850 / FP); capVelocity(p, 2600);
    if ((pressed & INPUT.DASH) && p.dash >= 100 && (mx || my)) { const d = directionTo(mx, my); addVelocity(p, d, 7200); p.dash = 0; p.invulnerable = 14; state.events.push({ type: EVENTS.DASH }); }
    const oldX = p.x; p.x += p.vx; collideArena(state, p, p.radius); if (pointInCover(state.arena, p.x, p.y)) p.x = oldX;
    const oldY = p.y; p.y += p.vy; collideArena(state, p, p.radius); if (pointInCover(state.arena, p.x, p.y)) p.y = oldY;
    if (p.cooldown > 0) p.cooldown -= 1; if (p.invulnerable > 0) p.invulnerable -= 1;
    p.heat = Math.max(0, p.heat - 1); p.dash = Math.min(100, p.dash + .32); p.armor = Math.min(p.maxArmor, p.armor + (state.tick % 20 === 0 ? 1 : 0));
    if (pressed & INPUT.PREV) { p.weapon = (p.weapon + WEAPONS.length - 1) % WEAPONS.length; state.events.push({ type: EVENTS.WEAPON, weapon: p.weapon }); }
    if (pressed & INPUT.NEXT) { p.weapon = (p.weapon + 1) % WEAPONS.length; state.events.push({ type: EVENTS.WEAPON, weapon: p.weapon }); }
    const weapon = WEAPONS[p.weapon];
    if ((input & INPUT.FIRE) && p.cooldown <= 0 && p.heat + weapon.heat <= 100) { fire(state, "player", p, p.aim, p.weapon, 1); p.cooldown = weapon.cooldown; p.heat += weapon.heat; }
  }

  function stepEnemies(state) {
    const p = state.player;
    for (const enemy of state.enemies) {
      if (enemy.cooldown > 0) enemy.cooldown -= 1;
      const dx = p.x - enemy.x; const dy = p.y - enemy.y; const distance = Math.sqrt(distanceSq(p, enemy));
      let heading = directionTo(dx, dy);
      if (enemy.kind === "wraith") heading = (heading + (enemy.phase & 1 ? 12 : 52)) & 63;
      if (distance > (enemy.kind === "bulwark" ? 150 : 220)) addVelocity(enemy, heading, enemy.kind === "wraith" ? 95 : 64);
      if (distance < 120) addVelocity(enemy, heading + 32, 92);
      enemy.vx = Math.trunc(enemy.vx * 920 / FP); enemy.vy = Math.trunc(enemy.vy * 920 / FP); capVelocity(enemy, enemy.speed);
      enemy.x += enemy.vx; enemy.y += enemy.vy; collideArena(state, enemy, enemy.kind === "bulwark" ? 25 : 18);
      if (distance < 430 && enemy.cooldown <= 0) { fire(state, enemy.id, enemy, directionTo(dx, dy), enemy.kind === "bulwark" ? 1 : 0, enemy.damage / WEAPONS[enemy.kind === "bulwark" ? 1 : 0].damage); enemy.cooldown = enemy.kind === "lancer" ? 42 : enemy.kind === "bulwark" ? 78 : 62; }
      if (distance < 26) damagePlayer(state, enemy.kind === "bulwark" ? 12 : 6);
    }
  }

  function stepBullets(state) {
    for (const bullet of state.bullets) {
      bullet.life -= 1; bullet.x += bullet.vx; bullet.y += bullet.vy;
      if (pointInCover(state.arena, bullet.x, bullet.y)) { bullet.life = 0; continue; }
      if (bullet.hostile) {
        if (distanceSq(bullet, state.player) < 18 * 18) { damagePlayer(state, bullet.damage); bullet.life = 0; }
      } else {
        for (const enemy of state.enemies) {
          const radius = enemy.kind === "bulwark" ? 27 : 20;
          if (enemy.health <= 0 || distanceSq(bullet, enemy) > radius * radius) continue;
          // A lance remains live after impact, but cannot damage the same body
          // again while crossing its collision radius on subsequent ticks.
          if (bullet.lance && bullet.hitTargets.includes(enemy.id)) continue;
          enemy.health -= bullet.damage;
          if (bullet.lance) bullet.hitTargets.push(enemy.id);
          else bullet.life = 0;
          state.events.push({ type: EVENTS.HIT, target: enemy.id, amount: bullet.damage });
          if (enemy.health <= 0) { state.score += enemy.maxHealth * 12; state.events.push({ type: EVENTS.ENEMY_DOWN, id: enemy.id, kind: enemy.kind }); }
          if (!bullet.lance) break;
        }
      }
    }
    state.bullets = state.bullets.filter((bullet) => bullet.life > 0 && Math.abs(bullet.x) < WORLD.width * FP && Math.abs(bullet.y) < WORLD.height * FP);
    state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
  }

  function stepObjectives(state) {
    // Combat resolves first: lethal damage cannot be superseded by extraction
    // or award a relay capture during the same tick.
    if (state.status !== "active" || state.player.health <= 0) return;
    for (const relay of state.arena.relays) {
      if (relay.captured) continue;
      const playerNear = distanceSq(state.player, { x: relay.x * FP, y: relay.y * FP }) < 76 * 76;
      const contested = state.enemies.some((enemy) => distanceSq(enemy, { x: relay.x * FP, y: relay.y * FP }) < 145 * 145);
      relay.progress = clamp(relay.progress + (playerNear && !contested ? 1 : -.35), 0, 180);
      if (relay.progress >= 180) {
        relay.captured = true; state.score += 3500; state.wave += 1; state.events.push({ type: EVENTS.CAPTURE, relay: relay.id });
        if (state.arena.relays.every((item) => item.captured)) state.arena.extraction.open = true;
        else spawnWave(state, state.wave);
      }
    }
    const exit = state.arena.extraction;
    if (exit.open && distanceSq(state.player, { x: exit.x * FP, y: exit.y * FP }) < 64 * 64) { state.status = "victory"; state.score += Math.max(0, 30000 - state.tick); state.events.push({ type: EVENTS.VICTORY }); }
  }

  function step(state, inputValue, aim) {
    if (state.status !== "active") { state.events = []; return state; }
    const input = Number(inputValue) & 255; const pressed = input & ~state.previousInput; state.events = []; state.tick += 1;
    stepPlayer(state, input, pressed, aim); stepEnemies(state); stepBullets(state); stepObjectives(state);
    state.previousInput = input; return state;
  }
  function stateDigest(state) { const snapshot = { ...state }; delete snapshot.events; let h = 0x811c9dc5; const text = JSON.stringify(snapshot); for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return seedHex(h); }
  return Object.freeze({ VERSION, TICK_HZ, FP, WORLD, INPUT, WEAPONS, EVENTS, DIRECTIONS, hash32, textSeed, seedHex, fallbackSamples, buildArena, createGame, step, stateDigest, distanceSq });
});
