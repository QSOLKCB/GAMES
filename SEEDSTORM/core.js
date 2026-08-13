(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SeedStormCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ENGINE_VERSION = 1;
  const REPLAY_PREFIX = "SSR1";
  const WIDTH = 480;
  const HEIGHT = 720;
  const SCALE = 64;
  const TICK_RATE = 60;
  const MAX_REPLAY_TICKS = TICK_RATE * 60 * 60 * 6;

  const INPUT = Object.freeze({
    LEFT: 1,
    RIGHT: 2,
    UP: 4,
    DOWN: 8,
    FIRE: 16,
    FOCUS: 32,
    BOMB: 64,
  });

  const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const BIOMES = Object.freeze([
    Object.freeze({ name: "Iron Delta", code: "IRON" }),
    Object.freeze({ name: "Salt Circuit", code: "SALT" }),
    Object.freeze({ name: "Ash Meridian", code: "ASH" }),
    Object.freeze({ name: "Obsidian Relay", code: "OBSIDIAN" }),
    Object.freeze({ name: "Cobalt Fault", code: "COBALT" }),
  ]);

  const ENEMY_BASE = Object.freeze({
    scout: Object.freeze({ health: 2, radius: 11, score: 120 }),
    wing: Object.freeze({ health: 3, radius: 13, score: 180 }),
    turret: Object.freeze({ health: 7, radius: 16, score: 340 }),
    bomber: Object.freeze({ health: 12, radius: 21, score: 620 }),
    spinner: Object.freeze({ health: 9, radius: 17, score: 480 }),
    boss: Object.freeze({ health: 260, radius: 58, score: 12000 }),
  });

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function mix32(value) {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return (x >>> 0) || 0x6d2b79f5;
  }

  function normalizeSeed(value) {
    if (typeof value === "number" && Number.isFinite(value)) return (value >>> 0) || 0x6d2b79f5;
    const text = String(value == null ? "" : value).trim();
    if (/^0x[0-9a-f]{1,8}$/i.test(text)) return (parseInt(text.slice(2), 16) >>> 0) || 0x6d2b79f5;
    if (/^[0-9]{1,10}$/.test(text)) return (Number(text) >>> 0) || 0x6d2b79f5;
    return mix32(fnv1a(text || "SEEDSTORM"));
  }

  function seedHex(seed) {
    return (seed >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function deriveSeed(baseSeed, level) {
    return mix32((baseSeed >>> 0) ^ Math.imul(level >>> 0, 0x9e3779b1));
  }

  function rngObject(seed) {
    return { value: mix32(seed) };
  }

  function nextRandom(rng) {
    let x = rng.value >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    rng.value = x >>> 0;
    return rng.value;
  }

  function randomInt(rng, maxExclusive) {
    return maxExclusive <= 1 ? 0 : nextRandom(rng) % maxExclusive;
  }

  function triangleWave(tick, period) {
    const p = ((tick % period) + period) % period;
    const half = Math.floor(period / 2);
    if (p <= half) return -1024 + Math.floor((p * 2048) / Math.max(1, half));
    return 1024 - Math.floor(((p - half) * 2048) / Math.max(1, period - half));
  }

  function difficultyFor(level) {
    const rank = Math.max(1, Math.floor(level));
    return Object.freeze({
      rank,
      spawnGap: Math.max(18, 70 - Math.min(rank, 18) * 3),
      enemySpeed: 76 + Math.min(rank, 30) * 5,
      bulletSpeed: 118 + Math.min(rank, 32) * 4,
      healthPercent: 100 + (rank - 1) * 15,
      fireGap: Math.max(28, 108 - Math.min(rank, 20) * 4),
      formationSize: Math.min(7, 2 + Math.floor(rank / 2)),
      bossHealth: 260 + (rank - 1) * 95,
      bossPatterns: Math.min(5, 1 + Math.floor(rank / 2)),
    });
  }

  function pickEnemyKind(rng, level) {
    const unlocked = level < 2 ? 2 : level < 3 ? 3 : level < 5 ? 4 : 5;
    const roll = randomInt(rng, unlocked);
    return ["scout", "wing", "turret", "bomber", "spinner"][roll];
  }

  function makeLevelBlueprint(seedInput, levelInput) {
    const seed = normalizeSeed(seedInput);
    const level = Math.max(1, Math.floor(levelInput || 1));
    const levelSeed = deriveSeed(seed, level);
    const rng = rngObject(levelSeed);
    const difficulty = difficultyFor(level);
    const biomeIndex = randomInt(rng, BIOMES.length);
    const bossTick = 2340 + Math.min(level, 12) * 30;
    const events = [];
    let id = 1;
    let tick = 100;

    while (tick < bossTick - 180) {
      const kind = pickEnemyKind(rng, level);
      const groupCap = kind === "bomber" || kind === "turret" ? 2 : difficulty.formationSize;
      const count = 1 + randomInt(rng, Math.max(1, groupCap));
      const formation = randomInt(rng, 4);
      const anchorLane = randomInt(rng, 7);
      for (let slot = 0; slot < count; slot += 1) {
        let lane = anchorLane;
        if (formation === 0) lane = (anchorLane + slot) % 7;
        if (formation === 1) lane = (anchorLane - slot + 14) % 7;
        if (formation === 2) lane = (anchorLane + (slot % 2 === 0 ? slot : -slot) + 14) % 7;
        if (formation === 3) lane = (anchorLane + Math.floor(slot / 2) * (slot % 2 ? -1 : 1) + 14) % 7;
        const dropRoll = randomInt(rng, 100);
        events.push(Object.freeze({
          id,
          tick: tick + slot * 9,
          kind,
          x: (52 + lane * 63) * SCALE,
          pathSeed: nextRandom(rng),
          drop: dropRoll < 7 ? "power" : dropRoll < 10 ? "bomb" : null,
        }));
        id += 1;
      }
      const jitter = randomInt(rng, Math.max(2, difficulty.spawnGap));
      tick += difficulty.spawnGap + Math.floor(jitter / 2) + count * 7;
    }

    events.push(Object.freeze({
      id,
      tick: bossTick,
      kind: "boss",
      x: WIDTH * SCALE / 2,
      pathSeed: nextRandom(rng),
      drop: null,
    }));

    const signatureSource = events.map((event) =>
      [event.id, event.tick, event.kind, event.x, event.pathSeed, event.drop]
    );

    return Object.freeze({
      seed,
      level,
      levelSeed,
      biomeIndex,
      biome: BIOMES[biomeIndex],
      bossTick,
      difficulty,
      events: Object.freeze(events),
      signature: seedHex(fnv1a(JSON.stringify(signatureSource))),
    });
  }

  function createPlayer() {
    return {
      x: WIDTH * SCALE / 2,
      y: 620 * SCALE,
      radius: 7 * SCALE,
      power: 1,
      cooldown: 0,
      invulnerable: 120,
    };
  }

  function createRun(seedInput) {
    const seed = normalizeSeed(seedInput);
    return {
      engineVersion: ENGINE_VERSION,
      seed,
      tick: 0,
      level: 1,
      levelTick: 0,
      blueprint: makeLevelBlueprint(seed, 1),
      nextEvent: 0,
      nextEntityId: 1,
      player: createPlayer(),
      lives: 3,
      bombs: 3,
      score: 0,
      chain: 0,
      multiplierBasis: 100,
      bossDefeated: false,
      clearCountdown: 0,
      bombPulse: 0,
      previousInput: 0,
      gameOver: false,
      enemies: [],
      playerBullets: [],
      enemyBullets: [],
      pickups: [],
      stats: {
        shots: 0,
        hits: 0,
        kills: 0,
        grazes: 0,
        levelsCleared: 0,
      },
      events: [],
    };
  }

  function spawnEnemy(state, event) {
    const base = ENEMY_BASE[event.kind];
    const difficulty = state.blueprint.difficulty;
    const health = event.kind === "boss"
      ? difficulty.bossHealth
      : Math.max(1, Math.floor((base.health * difficulty.healthPercent + 99) / 100));
    state.enemies.push({
      id: state.nextEntityId,
      eventId: event.id,
      kind: event.kind,
      x: event.x,
      y: event.kind === "boss" ? -90 * SCALE : -28 * SCALE,
      baseX: event.x,
      age: 0,
      health,
      maxHealth: health,
      radius: base.radius * SCALE,
      fireTimer: difficulty.fireGap + (event.pathSeed % 60),
      pathSeed: event.pathSeed,
      drop: event.drop,
      dead: false,
    });
    state.nextEntityId += 1;
    state.events.push({ type: event.kind === "boss" ? "boss" : "spawn", id: event.id });
  }

  function spawnScheduledEnemies(state) {
    const events = state.blueprint.events;
    while (state.nextEvent < events.length && events[state.nextEvent].tick <= state.levelTick) {
      spawnEnemy(state, events[state.nextEvent]);
      state.nextEvent += 1;
    }
  }

  function addPlayerBullet(state, x, y, vx, vy, damage) {
    state.playerBullets.push({
      id: state.nextEntityId,
      x,
      y,
      vx,
      vy,
      radius: 3 * SCALE,
      damage,
      dead: false,
    });
    state.nextEntityId += 1;
  }

  function firePlayer(state) {
    const p = state.player;
    const patterns = [
      [[0, 0]],
      [[-5, -12], [5, 12]],
      [[0, 0], [-10, -46], [10, 46]],
      [[-4, -12], [4, 12], [-13, -58], [13, 58]],
      [[0, 0], [-7, -30], [7, 30], [-15, -72], [15, 72]],
    ];
    const pattern = patterns[clamp(p.power, 1, 5) - 1];
    for (const shot of pattern) {
      addPlayerBullet(state, p.x + shot[0] * SCALE, p.y - 15 * SCALE, shot[1], -650, 1);
    }
    p.cooldown = 5;
    state.stats.shots += pattern.length;
    state.events.push({ type: "shot", id: state.tick });
  }

  function addEnemyBullet(state, enemy, vx, vy, radius) {
    state.enemyBullets.push({
      id: state.nextEntityId,
      x: enemy.x,
      y: enemy.y + Math.floor(enemy.radius / 2),
      vx,
      vy,
      radius: (radius || 5) * SCALE,
      grazed: false,
      dead: false,
    });
    state.nextEntityId += 1;
  }

  function aimedVelocity(enemy, player, speed) {
    const dx = player.x - enemy.x;
    const dy = Math.max(SCALE, player.y - enemy.y);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const sx = dx < 0 ? -1 : 1;
    if (ax * 4 < ay) return [0, speed];
    if (ax * 2 < ay * 3) return [sx * Math.floor(speed * 29 / 64), Math.floor(speed * 57 / 64)];
    if (ax < ay * 3) return [sx * Math.floor(speed * 45 / 64), Math.floor(speed * 45 / 64)];
    return [sx * Math.floor(speed * 57 / 64), Math.floor(speed * 29 / 64)];
  }

  function fireEnemy(state, enemy) {
    const difficulty = state.blueprint.difficulty;
    const speed = difficulty.bulletSpeed;
    if (enemy.kind === "scout" || enemy.kind === "wing" || enemy.kind === "turret") {
      const velocity = aimedVelocity(enemy, state.player, speed);
      addEnemyBullet(state, enemy, velocity[0], velocity[1], enemy.kind === "turret" ? 6 : 4);
    } else if (enemy.kind === "bomber") {
      addEnemyBullet(state, enemy, -Math.floor(speed / 2), speed, 6);
      addEnemyBullet(state, enemy, 0, Math.floor(speed * 9 / 8), 6);
      addEnemyBullet(state, enemy, Math.floor(speed / 2), speed, 6);
    } else if (enemy.kind === "spinner") {
      const phase = Math.floor(enemy.age / 20) % 4;
      const vectors = [[-45, 45], [0, 64], [45, 45], [0, 64]];
      const v = vectors[phase];
      addEnemyBullet(state, enemy, Math.floor(speed * v[0] / 64), Math.floor(speed * v[1] / 64), 5);
      addEnemyBullet(state, enemy, -Math.floor(speed * v[0] / 64), Math.floor(speed * v[1] / 64), 5);
    } else if (enemy.kind === "boss") {
      const patterns = difficulty.bossPatterns;
      const aim = aimedVelocity(enemy, state.player, speed + 12);
      addEnemyBullet(state, enemy, aim[0], aim[1], 7);
      if (patterns >= 2) {
        addEnemyBullet(state, enemy, -Math.floor(speed * 3 / 4), Math.floor(speed * 3 / 4), 6);
        addEnemyBullet(state, enemy, Math.floor(speed * 3 / 4), Math.floor(speed * 3 / 4), 6);
      }
      if (patterns >= 3) {
        addEnemyBullet(state, enemy, -Math.floor(speed / 3), speed, 5);
        addEnemyBullet(state, enemy, Math.floor(speed / 3), speed, 5);
      }
      if (patterns >= 4) addEnemyBullet(state, enemy, 0, Math.floor(speed * 5 / 4), 8);
      if (patterns >= 5) {
        addEnemyBullet(state, enemy, -speed, Math.floor(speed / 3), 5);
        addEnemyBullet(state, enemy, speed, Math.floor(speed / 3), 5);
      }
    }
    state.events.push({ type: "enemy-shot", id: enemy.id });
  }

  function updateEnemyPosition(state, enemy) {
    const speed = state.blueprint.difficulty.enemySpeed;
    enemy.age += 1;
    const phase = enemy.pathSeed % 211;
    if (enemy.kind === "scout") {
      enemy.y += speed + 24;
      enemy.x = enemy.baseX + Math.floor(triangleWave(enemy.age + phase, 140) * 34 * SCALE / 1024);
    } else if (enemy.kind === "wing") {
      enemy.y += speed + 10;
      enemy.x = enemy.baseX + Math.floor(triangleWave(enemy.age + phase, 96) * 58 * SCALE / 1024);
    } else if (enemy.kind === "turret") {
      if (enemy.y < (110 + (enemy.pathSeed % 150)) * SCALE) enemy.y += speed;
      enemy.x = enemy.baseX + Math.floor(triangleWave(enemy.age + phase, 220) * 18 * SCALE / 1024);
    } else if (enemy.kind === "bomber") {
      enemy.y += Math.floor(speed * 3 / 4);
      enemy.x = enemy.baseX + Math.floor(triangleWave(enemy.age + phase, 260) * 74 * SCALE / 1024);
    } else if (enemy.kind === "spinner") {
      enemy.y += speed;
      enemy.x = enemy.baseX + Math.floor(triangleWave(enemy.age + phase, 72) * 82 * SCALE / 1024);
    } else if (enemy.kind === "boss") {
      if (enemy.y < 118 * SCALE) enemy.y += speed + 20;
      else enemy.x = WIDTH * SCALE / 2 + Math.floor(triangleWave(enemy.age + phase, 300) * 145 * SCALE / 1024);
    }
    enemy.x = clamp(enemy.x, enemy.radius, WIDTH * SCALE - enemy.radius);
  }

  function updateEnemies(state) {
    for (const enemy of state.enemies) {
      if (enemy.dead) continue;
      updateEnemyPosition(state, enemy);
      enemy.fireTimer -= 1;
      const canFire = enemy.y > 10 * SCALE && enemy.y < 610 * SCALE;
      if (canFire && enemy.fireTimer <= 0) {
        fireEnemy(state, enemy);
        const baseGap = state.blueprint.difficulty.fireGap;
        enemy.fireTimer = enemy.kind === "boss"
          ? Math.max(18, Math.floor(baseGap / 2))
          : baseGap + (enemy.pathSeed % 35);
      }
      if (enemy.y > (HEIGHT + 100) * SCALE) enemy.dead = true;
    }
  }

  function updateBullets(state) {
    for (const bullet of state.playerBullets) {
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      if (bullet.y < -20 * SCALE || bullet.x < -20 * SCALE || bullet.x > (WIDTH + 20) * SCALE) bullet.dead = true;
    }
    for (const bullet of state.enemyBullets) {
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      if (bullet.y > (HEIGHT + 30) * SCALE || bullet.y < -30 * SCALE ||
          bullet.x < -30 * SCALE || bullet.x > (WIDTH + 30) * SCALE) bullet.dead = true;
    }
  }

  function overlap(a, b, extraRadius) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const radius = a.radius + b.radius + (extraRadius || 0);
    return dx * dx + dy * dy <= radius * radius;
  }

  function spawnPickup(state, enemy) {
    if (!enemy.drop) return;
    state.pickups.push({
      id: state.nextEntityId,
      kind: enemy.drop,
      x: enemy.x,
      y: enemy.y,
      radius: 10 * SCALE,
      age: 0,
      dead: false,
    });
    state.nextEntityId += 1;
  }

  function killEnemy(state, enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    const base = ENEMY_BASE[enemy.kind];
    state.chain += 1;
    state.multiplierBasis = Math.min(500, 100 + Math.floor(state.chain / 6) * 25);
    state.score += Math.floor(base.score * state.multiplierBasis / 100);
    state.stats.kills += 1;
    spawnPickup(state, enemy);
    state.events.push({ type: enemy.kind === "boss" ? "boss-down" : "enemy-down", id: enemy.id });
    if (enemy.kind === "boss") {
      state.bossDefeated = true;
      state.clearCountdown = 150;
      state.enemyBullets.length = 0;
    }
  }

  function hitPlayer(state) {
    if (state.player.invulnerable > 0 || state.gameOver) return;
    state.lives -= 1;
    state.chain = 0;
    state.multiplierBasis = 100;
    state.player.power = Math.max(1, state.player.power - 1);
    state.player.invulnerable = 150;
    state.bombs = Math.max(state.bombs, 2);
    state.enemyBullets.length = 0;
    state.events.push({ type: "player-hit", id: state.tick });
    if (state.lives <= 0) {
      state.gameOver = true;
      state.events.push({ type: "game-over", id: state.tick });
    }
  }

  function resolveCollisions(state) {
    for (const bullet of state.playerBullets) {
      if (bullet.dead) continue;
      for (const enemy of state.enemies) {
        if (enemy.dead || !overlap(bullet, enemy)) continue;
        bullet.dead = true;
        enemy.health -= bullet.damage;
        state.stats.hits += 1;
        if (enemy.health <= 0) killEnemy(state, enemy);
        break;
      }
    }

    if (state.player.invulnerable <= 0) {
      for (const bullet of state.enemyBullets) {
        if (bullet.dead) continue;
        if (overlap(bullet, state.player)) {
          bullet.dead = true;
          hitPlayer(state);
          break;
        }
        if (!bullet.grazed && overlap(bullet, state.player, 16 * SCALE)) {
          bullet.grazed = true;
          state.stats.grazes += 1;
          state.score += 25;
        }
      }
      for (const enemy of state.enemies) {
        if (!enemy.dead && overlap(enemy, state.player)) {
          if (enemy.kind !== "boss") killEnemy(state, enemy);
          hitPlayer(state);
          break;
        }
      }
    }
  }

  function updatePickups(state) {
    for (const pickup of state.pickups) {
      pickup.age += 1;
      pickup.y += 82;
      pickup.x += Math.floor(triangleWave(pickup.age + pickup.id, 110) * 22 / 1024);
      if (overlap(pickup, state.player, 4 * SCALE)) {
        pickup.dead = true;
        if (pickup.kind === "power") state.player.power = Math.min(5, state.player.power + 1);
        if (pickup.kind === "bomb") state.bombs = Math.min(9, state.bombs + 1);
        state.score += 500;
        state.events.push({ type: "pickup", id: pickup.id });
      }
      if (pickup.y > (HEIGHT + 20) * SCALE) pickup.dead = true;
    }
  }

  function useBomb(state) {
    if (state.bombs <= 0 || state.gameOver) return;
    state.bombs -= 1;
    state.bombPulse = 45;
    state.player.invulnerable = Math.max(state.player.invulnerable, 90);
    state.enemyBullets.length = 0;
    for (const enemy of state.enemies) {
      if (enemy.dead) continue;
      enemy.health -= enemy.kind === "boss" ? 35 : 60;
      if (enemy.health <= 0) killEnemy(state, enemy);
    }
    state.events.push({ type: "bomb", id: state.tick });
  }

  function updatePlayer(state, input) {
    const p = state.player;
    const focus = (input & INPUT.FOCUS) !== 0;
    const speed = focus ? 170 : 300;
    let dx = 0;
    let dy = 0;
    if (input & INPUT.LEFT) dx -= speed;
    if (input & INPUT.RIGHT) dx += speed;
    if (input & INPUT.UP) dy -= speed;
    if (input & INPUT.DOWN) dy += speed;
    if (dx && dy) {
      dx = Math.trunc(dx * 181 / 256);
      dy = Math.trunc(dy * 181 / 256);
    }
    p.x = clamp(p.x + dx, 16 * SCALE, (WIDTH - 16) * SCALE);
    p.y = clamp(p.y + dy, 70 * SCALE, (HEIGHT - 28) * SCALE);
    if (p.cooldown > 0) p.cooldown -= 1;
    if (p.invulnerable > 0) p.invulnerable -= 1;
    if ((input & INPUT.FIRE) && p.cooldown <= 0) firePlayer(state);
    if ((input & INPUT.BOMB) && !(state.previousInput & INPUT.BOMB)) useBomb(state);
  }

  function cleanup(state) {
    state.playerBullets = state.playerBullets.filter((item) => !item.dead);
    state.enemyBullets = state.enemyBullets.filter((item) => !item.dead);
    state.enemies = state.enemies.filter((item) => !item.dead);
    state.pickups = state.pickups.filter((item) => !item.dead);
    if (state.playerBullets.length > 450) state.playerBullets.splice(0, state.playerBullets.length - 450);
    if (state.enemyBullets.length > 900) state.enemyBullets.splice(0, state.enemyBullets.length - 900);
  }

  function beginNextLevel(state) {
    state.stats.levelsCleared += 1;
    state.score += state.level * 5000 + state.lives * 1000 + state.bombs * 500;
    state.level += 1;
    state.levelTick = 0;
    state.blueprint = makeLevelBlueprint(state.seed, state.level);
    state.nextEvent = 0;
    state.bossDefeated = false;
    state.clearCountdown = 0;
    state.enemyBullets.length = 0;
    state.playerBullets.length = 0;
    state.pickups.length = 0;
    state.player.x = WIDTH * SCALE / 2;
    state.player.y = 620 * SCALE;
    state.player.invulnerable = 150;
    state.bombs = Math.min(9, state.bombs + 1);
    state.events.push({ type: "level", id: state.level });
  }

  function step(state, inputMask) {
    const input = (Number(inputMask) || 0) & 0x7f;
    state.events = [];
    if (state.gameOver) {
      state.previousInput = input;
      return state;
    }

    state.tick += 1;
    state.levelTick += 1;
    if (state.bombPulse > 0) state.bombPulse -= 1;
    updatePlayer(state, input);
    spawnScheduledEnemies(state);
    updateEnemies(state);
    updateBullets(state);
    resolveCollisions(state);
    updatePickups(state);
    cleanup(state);

    if (state.bossDefeated) {
      state.clearCountdown -= 1;
      if (state.clearCountdown <= 0) beginNextLevel(state);
    }
    state.previousInput = input;
    return state;
  }

  function createRecorder(seedInput) {
    return { version: ENGINE_VERSION, seed: normalizeSeed(seedInput), ticks: 0, runs: [] };
  }

  function recordInput(recorder, inputMask) {
    if (!recorder || recorder.version !== ENGINE_VERSION) throw new Error("Invalid replay recorder");
    if (recorder.ticks >= MAX_REPLAY_TICKS) throw new Error("Replay exceeds the six-hour limit");
    const mask = (Number(inputMask) || 0) & 0x7f;
    const last = recorder.runs[recorder.runs.length - 1];
    if (last && last[0] === mask && last[1] < 65535) last[1] += 1;
    else recorder.runs.push([mask, 1]);
    recorder.ticks += 1;
    return recorder;
  }

  function encodeBase64Ascii(text) {
    let output = "";
    for (let i = 0; i < text.length; i += 3) {
      const a = text.charCodeAt(i);
      const hasB = i + 1 < text.length;
      const hasC = i + 2 < text.length;
      const b = hasB ? text.charCodeAt(i + 1) : 0;
      const c = hasC ? text.charCodeAt(i + 2) : 0;
      output += BASE64[a >>> 2];
      output += BASE64[((a & 3) << 4) | (b >>> 4)];
      output += hasB ? BASE64[((b & 15) << 2) | (c >>> 6)] : "=";
      output += hasC ? BASE64[c & 63] : "=";
    }
    return output;
  }

  function decodeBase64Ascii(encoded) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
      throw new Error("Replay payload is not valid base64");
    }
    let output = "";
    for (let i = 0; i < encoded.length; i += 4) {
      const a = BASE64.indexOf(encoded[i]);
      const b = BASE64.indexOf(encoded[i + 1]);
      const c = encoded[i + 2] === "=" ? 0 : BASE64.indexOf(encoded[i + 2]);
      const d = encoded[i + 3] === "=" ? 0 : BASE64.indexOf(encoded[i + 3]);
      output += String.fromCharCode((a << 2) | (b >>> 4));
      if (encoded[i + 2] !== "=") output += String.fromCharCode(((b & 15) << 4) | (c >>> 2));
      if (encoded[i + 3] !== "=") output += String.fromCharCode(((c & 3) << 6) | d);
    }
    return output;
  }

  function encodeReplay(recorder) {
    if (!recorder || recorder.version !== ENGINE_VERSION || !Array.isArray(recorder.runs)) {
      throw new Error("Invalid replay recorder");
    }
    const payload = JSON.stringify([ENGINE_VERSION, recorder.seed >>> 0, recorder.ticks, recorder.runs]);
    const checksum = seedHex(fnv1a(payload));
    const encoded = encodeBase64Ascii(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return `${REPLAY_PREFIX}.${checksum}.${encoded}`;
  }

  function decodeReplay(codeInput) {
    const code = String(codeInput || "").trim();
    if (code.length > 12_000_000) throw new Error("Replay code is too large");
    const parts = code.split(".");
    if (parts.length !== 3 || parts[0] !== REPLAY_PREFIX || !/^[0-9A-F]{8}$/.test(parts[1])) {
      throw new Error("Replay code header is invalid");
    }
    let encoded = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    while (encoded.length % 4) encoded += "=";
    const payload = decodeBase64Ascii(encoded);
    if (seedHex(fnv1a(payload)) !== parts[1]) throw new Error("Replay checksum mismatch");

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (_error) {
      throw new Error("Replay payload is not valid JSON");
    }
    if (!Array.isArray(parsed) || parsed.length !== 4 || parsed[0] !== ENGINE_VERSION) {
      throw new Error("Replay engine version is unsupported");
    }
    const seed = parsed[1];
    const ticks = parsed[2];
    const runs = parsed[3];
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
        !Number.isInteger(ticks) || ticks < 0 || ticks > MAX_REPLAY_TICKS ||
        !Array.isArray(runs) || runs.length > ticks + 1) {
      throw new Error("Replay metadata is invalid");
    }
    let total = 0;
    const cleanRuns = [];
    for (const run of runs) {
      if (!Array.isArray(run) || run.length !== 2 || !Number.isInteger(run[0]) ||
          run[0] < 0 || run[0] > 0x7f || !Number.isInteger(run[1]) ||
          run[1] < 1 || run[1] > 65535) {
        throw new Error("Replay input run is invalid");
      }
      total += run[1];
      if (total > MAX_REPLAY_TICKS) throw new Error("Replay tick count is invalid");
      cleanRuns.push([run[0], run[1]]);
    }
    if (total !== ticks) throw new Error("Replay tick count does not match its input stream");
    return Object.freeze({ version: ENGINE_VERSION, seed: seed >>> 0, ticks, runs: Object.freeze(cleanRuns) });
  }

  function createReplayCursor(replay) {
    return { replay, runIndex: 0, runOffset: 0, tick: 0 };
  }

  function nextReplayInput(cursor) {
    if (!cursor || cursor.tick >= cursor.replay.ticks) return null;
    const run = cursor.replay.runs[cursor.runIndex];
    const mask = run[0];
    cursor.runOffset += 1;
    cursor.tick += 1;
    if (cursor.runOffset >= run[1]) {
      cursor.runIndex += 1;
      cursor.runOffset = 0;
    }
    return mask;
  }

  function stateDigest(state) {
    const compact = {
      version: state.engineVersion,
      seed: state.seed,
      tick: state.tick,
      level: state.level,
      levelTick: state.levelTick,
      blueprint: state.blueprint.signature,
      nextEvent: state.nextEvent,
      nextEntityId: state.nextEntityId,
      player: state.player,
      lives: state.lives,
      bombs: state.bombs,
      score: state.score,
      chain: state.chain,
      multiplierBasis: state.multiplierBasis,
      bossDefeated: state.bossDefeated,
      clearCountdown: state.clearCountdown,
      bombPulse: state.bombPulse,
      previousInput: state.previousInput,
      gameOver: state.gameOver,
      enemies: state.enemies,
      playerBullets: state.playerBullets,
      enemyBullets: state.enemyBullets,
      pickups: state.pickups,
      stats: state.stats,
    };
    return seedHex(fnv1a(JSON.stringify(compact)));
  }

  return Object.freeze({
    ENGINE_VERSION,
    REPLAY_PREFIX,
    WIDTH,
    HEIGHT,
    SCALE,
    TICK_RATE,
    MAX_REPLAY_TICKS,
    INPUT,
    BIOMES,
    normalizeSeed,
    seedHex,
    deriveSeed,
    difficultyFor,
    makeLevelBlueprint,
    createRun,
    step,
    createRecorder,
    recordInput,
    encodeReplay,
    decodeReplay,
    createReplayCursor,
    nextReplayInput,
    stateDigest,
  });
});
