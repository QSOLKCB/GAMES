(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BlackstarCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ENGINE_VERSION = 1;
  const REPLAY_PREFIX = "BSA1";
  const TICK_RATE = 60;
  const FP = 1024;
  const ANGLE_MAX = 65536;
  const TRIG_SCALE = 16384;
  const PLAYER_RADIUS = 218;
  const DOOR_PASS = 820;
  const MAX_REPLAY_TICKS = TICK_RATE * 60 * 60 * 6;
  // One changing uint32 input per tick is the largest legal ledger: each
  // serialized run costs at most 15 characters, including its separator.
  const MAX_REPLAY_PAYLOAD_LENGTH = 96 + MAX_REPLAY_TICKS * 15;
  const MAX_REPLAY_CODE_LENGTH = REPLAY_PREFIX.length + 10 + Math.ceil(MAX_REPLAY_PAYLOAD_LENGTH / 3) * 4;
  const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  const INPUT = Object.freeze({
    FORWARD: 1,
    BACK: 2,
    TURN_LEFT: 4,
    TURN_RIGHT: 8,
    STRAFE_LEFT: 16,
    STRAFE_RIGHT: 32,
    FIRE: 64,
    USE: 128,
    RUN: 256,
    WEAPON_1: 512,
    WEAPON_2: 1024,
    WEAPON_3: 2048,
  });
  const ACTION_MASK = 0x0fff;

  const DIFFICULTIES = Object.freeze([
    Object.freeze({ id: 0, name: "Tourist Marine", health: 120, enemyHealth: 80, enemyDamage: 70, score: 80 }),
    Object.freeze({ id: 1, name: "AGA Veteran", health: 100, enemyHealth: 100, enemyDamage: 100, score: 100 }),
    Object.freeze({ id: 2, name: "No-Copy Nightmare", health: 85, enemyHealth: 125, enemyDamage: 135, score: 140 }),
  ]);

  const WEAPONS = Object.freeze([
    Object.freeze({ id: 0, name: "PULSE PISTOL", ammo: null, gap: 16, damage: 20, pellets: 1, spread: Object.freeze([0]) }),
    Object.freeze({ id: 1, name: "BREACH GUN", ammo: "shells", gap: 38, damage: 9, pellets: 7, spread: Object.freeze([-1050, -700, -350, 0, 350, 700, 1050]) }),
    Object.freeze({ id: 2, name: "VULCAN 68", ammo: "cells", gap: 5, damage: 12, pellets: 1, spread: Object.freeze([0]) }),
  ]);

  const ENEMY_TYPES = Object.freeze({
    sentry: Object.freeze({ name: "SENTRY", health: 34, speed: 15, damage: 7, cooldown: 76, range: 6, radius: 230, score: 120 }),
    trooper: Object.freeze({ name: "TROOPER", health: 54, speed: 12, damage: 11, cooldown: 92, range: 7, radius: 250, score: 220 }),
    drone: Object.freeze({ name: "CUTTER", health: 24, speed: 26, damage: 8, cooldown: 44, range: 1, radius: 190, score: 160 }),
    warden: Object.freeze({ name: "BLACK WARDEN", health: 330, speed: 10, damage: 16, cooldown: 52, range: 8, radius: 340, score: 4000 }),
  });

  const MISSIONS = Object.freeze([
    Object.freeze({
      name: "DOCK NINE",
      code: "D9-LOST",
      directive: "Recover the amber cipher and reach the uplink lift.",
      palette: "copper",
      layout: Object.freeze([
        "##################",
        "#>..g.S..........#",
        "#.##..#.#######..#",
        "#..g..D.....c....#",
        "#.###.#.###.####.#",
        "#.....#...#......#",
        "#####.###.#.##.#.#",
        "#...#.....#..g.#.#",
        "#.#.#####.####.#.#",
        "#.#.....D......#.#",
        "#.#####.######.#.#",
        "#....2#....h...#.#",
        "###.#.####.#####.#",
        "#...#....#.......#",
        "#.######.#.#####K#",
        "#...$..#....k....#",
        "#......#.......E.#",
        "##################",
      ]),
    }),
    Object.freeze({
      name: "CRYO ARCHIVE",
      code: "CA-68020",
      directive: "Purge the archive guards. Find the sealed research stair.",
      palette: "ice",
      layout: Object.freeze([
        "PPPPPPPPPPPPPPPPPP",
        "P>..g.S..........P",
        "P.PP.PP.PPPPP.PP.P",
        "P..c....D....P...P",
        "PPP.PPP.P.PP.P.P.P",
        "P...P...P..P...P.P",
        "P.t.P.PPPP.PPP.P.P",
        "P...P......P...P.P",
        "P.PPP.PPPP.P.PPP.P",
        "P.....P..P.P.....P",
        "P.PPPPP..P.PPPPP.P",
        "P.P..r...P....3P.P",
        "P.P.PPPPPPP.PP.P.P",
        "P...P....a..P..P.P",
        "PPP.P.PPPPPPPK.P.P",
        "P...$......k..g..P",
        "P.PPPPPPPPPPPP.E.P",
        "PPPPPPPPPPPPPPPPPP",
      ]),
    }),
    Object.freeze({
      name: "REACTOR CROWN",
      code: "RC-AGA",
      directive: "Destroy the Black Warden and transmit the recovered master.",
      palette: "reactor",
      layout: Object.freeze([
        "BBBBBBBBBBBBBBBBBB",
        "B>..t.S..........B",
        "B.BB.BB.BBBBB.BB.B",
        "B..c...D.....B...B",
        "BBB.BBB.B.BB.B.B.B",
        "B...B...B..B...B.B",
        "B.r.B.BBBB.BBB.B.B",
        "B...B......B...B.B",
        "B.BBB.BBBB.B.BBB.B",
        "B.....B..B.B.....B",
        "B.BBBBB..B.BBBBB.B",
        "B.B..g...B..c..B.B",
        "B.B.BBBBBBB.BB.B.B",
        "B...B...h...B..B.B",
        "BBB.B.BBBBBBBD.B.B",
        "B..$......w......B",
        "B.BBBBBBBBBBBB.E.B",
        "BBBBBBBBBBBBBBBBBB",
      ]),
    }),
  ]);

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function normalizeDifficulty(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? clamp(Math.trunc(numeric), 0, DIFFICULTIES.length - 1) : 1;
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
    return mix32(fnv1a(text || "BLACKSTAR-AGA"));
  }

  function seedHex(seed) {
    return (seed >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function deriveSeed(seed, missionIndex) {
    return mix32((seed >>> 0) ^ Math.imul((missionIndex + 1) >>> 0, 0x9e3779b1));
  }

  function nextRandom(state) {
    let x = state.rng >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    state.rng = (x >>> 0) || 0x6d2b79f5;
    return state.rng;
  }

  function sinAngle(angleInput) {
    let angle = ((angleInput % ANGLE_MAX) + ANGLE_MAX) % ANGLE_MAX;
    let sign = 1;
    if (angle >= ANGLE_MAX / 2) {
      angle -= ANGLE_MAX / 2;
      sign = -1;
    }
    const x = angle <= ANGLE_MAX / 4 ? angle : ANGLE_MAX / 2 - angle;
    const pi = ANGLE_MAX / 2;
    const product = x * (pi - x);
    const numerator = 16 * product * TRIG_SCALE;
    const denominator = 5 * pi * pi - 4 * product;
    return sign * Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
  }

  function cosAngle(angle) {
    return sinAngle(angle + ANGLE_MAX / 4);
  }

  function packInput(actionMask, mouseTurn) {
    const turn = clamp(Math.trunc(Number(mouseTurn) || 0), -64, 63) & 0xff;
    return (((turn << 16) >>> 0) | ((Number(actionMask) || 0) & ACTION_MASK)) >>> 0;
  }

  function inputActions(inputWord) {
    return (Number(inputWord) >>> 0) & ACTION_MASK;
  }

  function inputTurn(inputWord) {
    const raw = ((Number(inputWord) >>> 0) >>> 16) & 0xff;
    return raw >= 128 ? raw - 256 : raw;
  }

  function parseMission(mission, levelSeed, difficultyId) {
    const tiles = mission.layout.map((row) => row.split(""));
    const enemies = [];
    const pickups = [];
    const doors = [];
    const secrets = [];
    let start = null;
    let exit = null;
    let rng = levelSeed;

    function roll() {
      let x = rng >>> 0;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      rng = (x >>> 0) || 0x6d2b79f5;
      return rng;
    }

    for (let y = 0; y < tiles.length; y += 1) {
      for (let x = 0; x < tiles[y].length; x += 1) {
        const cell = tiles[y][x];
        if (">^<v".includes(cell)) {
          const facing = { ">": 0, "v": 16384, "<": 32768, "^": 49152 }[cell];
          start = { x: x * FP + FP / 2, y: y * FP + FP / 2, angle: facing };
          tiles[y][x] = ".";
        } else if (cell === "g" || cell === "t" || cell === "r" || cell === "w") {
          const kind = { g: "sentry", t: "trooper", r: "drone", w: "warden" }[cell];
          const type = ENEMY_TYPES[kind];
          const difficulty = DIFFICULTIES[difficultyId];
          enemies.push({
            x: x * FP + FP / 2,
            y: y * FP + FP / 2,
            kind,
            health: Math.max(1, Math.floor(type.health * difficulty.enemyHealth / 100)),
            phase: roll(),
            drop: (roll() % 100) < 18 ? ((roll() & 1) ? "cells" : "medkit") : null,
          });
          tiles[y][x] = ".";
        } else if ("hacz23k$".includes(cell)) {
          const pickupKind = {
            h: "medkit",
            a: "armor",
            c: "cells",
            z: "shells",
            "2": "breach",
            "3": "vulcan",
            k: "key",
            $: "archive",
          }[cell];
          pickups.push({ x: x * FP + FP / 2, y: y * FP + FP / 2, kind: pickupKind, phase: roll() & 255 });
          tiles[y][x] = ".";
        } else if (cell === "D" || cell === "K") {
          doors.push({ x, y, locked: cell === "K" });
        } else if (cell === "S") {
          secrets.push({ x, y });
        } else if (cell === "E") {
          exit = { x, y };
          tiles[y][x] = ".";
        }
      }
    }

    if (!start || !exit) throw new Error(`Mission ${mission.code} has no start or exit`);
    const signature = seedHex(fnv1a(JSON.stringify([
      mission.code,
      levelSeed,
      difficultyId,
      tiles.map((row) => row.join("")),
      enemies,
      pickups,
      doors,
      secrets,
      start,
      exit,
    ])));

    return Object.freeze({
      name: mission.name,
      code: mission.code,
      directive: mission.directive,
      palette: mission.palette,
      width: tiles[0].length,
      height: tiles.length,
      tiles: Object.freeze(tiles.map((row) => Object.freeze(row.slice()))),
      start: Object.freeze(start),
      exit: Object.freeze(exit),
      enemies: Object.freeze(enemies.map(Object.freeze)),
      pickups: Object.freeze(pickups.map(Object.freeze)),
      doors: Object.freeze(doors.map(Object.freeze)),
      secrets: Object.freeze(secrets.map(Object.freeze)),
      signature,
    });
  }

  function makeLevelBlueprint(seedInput, missionIndexInput, difficultyInput) {
    const seed = normalizeSeed(seedInput);
    const missionNumeric = Number(missionIndexInput);
    const missionIndex = Number.isFinite(missionNumeric) ? clamp(Math.trunc(missionNumeric), 0, MISSIONS.length - 1) : 0;
    const difficulty = normalizeDifficulty(difficultyInput);
    return parseMission(MISSIONS[missionIndex], deriveSeed(seed, missionIndex), difficulty);
  }

  function createRun(seedInput, difficultyInput) {
    const seed = normalizeSeed(seedInput);
    const difficulty = normalizeDifficulty(difficultyInput);
    const state = {
      engineVersion: ENGINE_VERSION,
      seed,
      difficulty,
      rng: mix32(seed ^ 0xa5a5f00d),
      tick: 0,
      levelTick: 0,
      missionIndex: 0,
      blueprint: null,
      player: null,
      doors: [],
      secrets: [],
      enemies: [],
      pickups: [],
      nextEntityId: 1,
      score: 0,
      levelKills: 0,
      totalLevelEnemies: 0,
      previousActions: 0,
      lastShotTick: -1000,
      levelComplete: false,
      transition: 0,
      gameOver: false,
      victory: false,
      events: [],
      stats: {
        shots: 0,
        hits: 0,
        kills: 0,
        damageTaken: 0,
        pickups: 0,
        secrets: 0,
        archives: 0,
        missions: 0,
      },
    };
    loadMission(state, 0, false);
    return state;
  }

  function loadMission(state, missionIndex, preservePlayer) {
    const blueprint = makeLevelBlueprint(state.seed, missionIndex, state.difficulty);
    const old = state.player;
    const baseHealth = DIFFICULTIES[state.difficulty].health;
    state.missionIndex = missionIndex;
    state.blueprint = blueprint;
    state.levelTick = 0;
    state.levelKills = 0;
    state.totalLevelEnemies = blueprint.enemies.length;
    state.levelComplete = false;
    state.transition = 0;
    state.player = {
      x: blueprint.start.x,
      y: blueprint.start.y,
      angle: blueprint.start.angle,
      health: preservePlayer && old ? Math.min(baseHealth, Math.max(35, old.health + 20)) : baseHealth,
      maxHealth: baseHealth,
      armor: preservePlayer && old ? old.armor : 0,
      shells: preservePlayer && old ? old.shells : 12,
      cells: preservePlayer && old ? old.cells : 36,
      weapon: preservePlayer && old ? old.weapon : 0,
      owned: preservePlayer && old ? old.owned : 1,
      keys: 0,
      cooldown: 0,
      hurt: 0,
      bob: 0,
    };
    state.doors = blueprint.doors.map((door, index) => ({
      id: index + 1,
      x: door.x,
      y: door.y,
      open: 0,
      target: 0,
      locked: door.locked,
    }));
    state.secrets = blueprint.secrets.map((secret, index) => ({ id: index + 1, x: secret.x, y: secret.y, open: 0, target: 0 }));
    state.enemies = blueprint.enemies.map((enemy) => ({
      id: state.nextEntityId++,
      kind: enemy.kind,
      x: enemy.x,
      y: enemy.y,
      health: enemy.health,
      maxHealth: enemy.health,
      phase: enemy.phase,
      drop: enemy.drop,
      active: false,
      cooldown: 20 + enemy.phase % 80,
      pain: 0,
    }));
    state.pickups = blueprint.pickups.map((pickup) => ({
      id: state.nextEntityId++,
      x: pickup.x,
      y: pickup.y,
      kind: pickup.kind,
      phase: pickup.phase,
    }));
    state.events.push({ type: "mission", index: missionIndex, code: blueprint.code });
  }

  function cellAt(state, tileX, tileY) {
    if (!state || !state.blueprint || tileY < 0 || tileY >= state.blueprint.height || tileX < 0 || tileX >= state.blueprint.width) return "#";
    return state.blueprint.tiles[tileY][tileX];
  }

  function doorAt(state, tileX, tileY) {
    return state.doors.find((door) => door.x === tileX && door.y === tileY) || null;
  }

  function secretAt(state, tileX, tileY) {
    return state.secrets.find((secret) => secret.x === tileX && secret.y === tileY) || null;
  }

  function isBlockingCell(state, tileX, tileY) {
    const cell = cellAt(state, tileX, tileY);
    if (cell === "#" || cell === "B" || cell === "P") return true;
    if (cell === "D" || cell === "K") {
      const door = doorAt(state, tileX, tileY);
      return !door || door.open < DOOR_PASS;
    }
    if (cell === "S") {
      const secret = secretAt(state, tileX, tileY);
      return !secret || secret.open < DOOR_PASS;
    }
    return false;
  }

  function canOccupy(state, x, y, radius) {
    return !isBlockingCell(state, Math.floor((x - radius) / FP), Math.floor((y - radius) / FP)) &&
      !isBlockingCell(state, Math.floor((x + radius) / FP), Math.floor((y - radius) / FP)) &&
      !isBlockingCell(state, Math.floor((x - radius) / FP), Math.floor((y + radius) / FP)) &&
      !isBlockingCell(state, Math.floor((x + radius) / FP), Math.floor((y + radius) / FP));
  }

  function moveBody(state, body, dx, dy, radius) {
    if (dx && canOccupy(state, body.x + dx, body.y, radius)) body.x += dx;
    if (dy && canOccupy(state, body.x, body.y + dy, radius)) body.y += dy;
  }

  function distanceApprox(dx, dy) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const high = Math.max(ax, ay);
    const low = Math.min(ax, ay);
    return high + Math.floor(low * 3 / 8);
  }

  function hasLineOfSight(state, fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 180));
    for (let i = 1; i < steps; i += 1) {
      const x = fromX + Math.trunc(dx * i / steps);
      const y = fromY + Math.trunc(dy * i / steps);
      if (isBlockingCell(state, Math.floor(x / FP), Math.floor(y / FP))) return false;
    }
    return true;
  }

  function missionObjectiveDenial(state) {
    if (state.missionIndex === 0 && state.pickups.some((pickup) => pickup.kind === "key")) {
      return "AMBER CIPHER NOT RECOVERED";
    }
    if (state.missionIndex === 1 && state.enemies.length > 0) {
      const suffix = state.enemies.length === 1 ? "" : "S";
      return `${state.enemies.length} ARCHIVE GUARD${suffix} REMAIN`;
    }
    if (state.missionIndex === MISSIONS.length - 1 && state.enemies.some((enemy) => enemy.kind === "warden")) {
      return "WARDEN SIGNAL STILL ACTIVE";
    }
    return null;
  }

  function useAhead(state) {
    const p = state.player;
    const dirX = cosAngle(p.angle);
    const dirY = sinAngle(p.angle);
    for (let distance = 280; distance <= 1350; distance += 140) {
      const x = p.x + Math.trunc(dirX * distance / TRIG_SCALE);
      const y = p.y + Math.trunc(dirY * distance / TRIG_SCALE);
      const tileX = Math.floor(x / FP);
      const tileY = Math.floor(y / FP);
      const cell = cellAt(state, tileX, tileY);
      if (cell === "D" || cell === "K") {
        const door = doorAt(state, tileX, tileY);
        if (!door) return;
        if (door.locked && p.keys <= 0) {
          state.events.push({ type: "denied", reason: "AMBER CIPHER REQUIRED" });
          return;
        }
        if (door.locked) {
          door.locked = false;
          p.keys -= 1;
          state.events.push({ type: "unlock", id: door.id });
        }
        door.target = door.target ? 0 : FP;
        state.events.push({ type: "door", id: door.id, open: Boolean(door.target) });
        return;
      }
      if (cell === "S") {
        const secret = secretAt(state, tileX, tileY);
        if (secret && secret.target === 0) {
          secret.target = FP;
          state.stats.secrets += 1;
          state.score += 750;
          state.events.push({ type: "secret", id: secret.id });
        }
        return;
      }
      if (tileX === state.blueprint.exit.x && tileY === state.blueprint.exit.y) {
        const denial = missionObjectiveDenial(state);
        if (denial) {
          state.events.push({ type: "denied", reason: denial });
          return;
        }
        completeMission(state);
        return;
      }
      if (isBlockingCell(state, tileX, tileY)) return;
    }
  }

  function updateDoors(state) {
    for (const door of state.doors) {
      if (door.open < door.target) door.open = Math.min(door.target, door.open + 64);
      else if (door.open > door.target) {
        const playerTileX = Math.floor(state.player.x / FP);
        const playerTileY = Math.floor(state.player.y / FP);
        if (playerTileX === door.x && playerTileY === door.y) door.target = FP;
        else door.open = Math.max(door.target, door.open - 64);
      }
    }
    for (const secret of state.secrets) {
      if (secret.open < secret.target) secret.open = Math.min(secret.target, secret.open + 32);
    }
  }

  function switchWeapon(state, actions) {
    let wanted = -1;
    if (actions & INPUT.WEAPON_1) wanted = 0;
    else if (actions & INPUT.WEAPON_2) wanted = 1;
    else if (actions & INPUT.WEAPON_3) wanted = 2;
    if (wanted >= 0 && (state.player.owned & (1 << wanted))) {
      state.player.weapon = wanted;
    }
  }

  function findHitscanTarget(state, angle, extraRadius) {
    const dirX = cosAngle(angle);
    const dirY = sinAngle(angle);
    let best = null;
    let bestForward = 10 * FP;
    for (const enemy of state.enemies) {
      if (enemy.health <= 0) continue;
      const dx = enemy.x - state.player.x;
      const dy = enemy.y - state.player.y;
      const forward = Math.trunc((dx * dirX + dy * dirY) / TRIG_SCALE);
      if (forward <= 0 || forward >= bestForward) continue;
      const side = Math.abs(Math.trunc((dx * dirY - dy * dirX) / TRIG_SCALE));
      const radius = ENEMY_TYPES[enemy.kind].radius + extraRadius + Math.floor(forward / 48);
      if (side > radius || !hasLineOfSight(state, state.player.x, state.player.y, enemy.x, enemy.y)) continue;
      best = enemy;
      bestForward = forward;
    }
    return best;
  }

  function damageEnemy(state, enemy, amount) {
    enemy.health = Math.max(0, enemy.health - amount);
    enemy.pain = 8;
    state.stats.hits += 1;
    state.events.push({ type: "enemy-hit", id: enemy.id, kind: enemy.kind, health: enemy.health, maxHealth: enemy.maxHealth });
    if (enemy.health > 0) return;
    state.stats.kills += 1;
    state.levelKills += 1;
    const type = ENEMY_TYPES[enemy.kind];
    state.score += Math.floor(type.score * DIFFICULTIES[state.difficulty].score / 100);
    state.events.push({ type: "enemy-down", id: enemy.id, kind: enemy.kind, x: enemy.x, y: enemy.y });
    if (enemy.drop) {
      state.pickups.push({ id: state.nextEntityId++, x: enemy.x, y: enemy.y, kind: enemy.drop, phase: enemy.phase & 255 });
    }
  }

  function fireWeapon(state) {
    const p = state.player;
    const weapon = WEAPONS[p.weapon];
    if (p.cooldown > 0) return;
    if (weapon.ammo && p[weapon.ammo] <= 0) {
      p.cooldown = 12;
      state.events.push({ type: "dry", weapon: p.weapon });
      return;
    }
    if (weapon.ammo) p[weapon.ammo] -= 1;
    p.cooldown = weapon.gap;
    state.stats.shots += 1;
    state.lastShotTick = state.tick;
    state.events.push({ type: "shot", weapon: p.weapon });

    for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
      let offset = weapon.spread[pellet];
      if (p.weapon === 2) offset = [-130, 65, -65, 130, 0][state.stats.shots % 5];
      const target = findHitscanTarget(state, p.angle + offset, p.weapon === 1 ? 85 : 40);
      if (target) damageEnemy(state, target, weapon.damage);
    }
  }

  function damagePlayer(state, amount, sourceId) {
    const p = state.player;
    let remaining = Math.max(1, Math.floor(amount * DIFFICULTIES[state.difficulty].enemyDamage / 100));
    const absorbed = Math.min(p.armor, Math.floor((remaining + 1) / 2));
    p.armor -= absorbed;
    remaining -= absorbed;
    p.health = Math.max(0, p.health - remaining);
    p.hurt = 14;
    state.stats.damageTaken += remaining;
    state.events.push({ type: "player-hit", amount: remaining, sourceId, health: p.health });
    if (p.health <= 0) {
      state.gameOver = true;
      state.events.push({ type: "game-over", score: state.score });
    }
  }

  function updateEnemies(state) {
    const p = state.player;
    for (const enemy of state.enemies) {
      if (enemy.health <= 0) continue;
      if (enemy.pain > 0) enemy.pain -= 1;
      if (enemy.cooldown > 0) enemy.cooldown -= 1;
      const type = ENEMY_TYPES[enemy.kind];
      const dx = p.x - enemy.x;
      const dy = p.y - enemy.y;
      const distance = distanceApprox(dx, dy);
      const visible = distance < 9 * FP && hasLineOfSight(state, enemy.x, enemy.y, p.x, p.y);
      if (!enemy.active && (visible || state.tick - state.lastShotTick < 50)) enemy.active = true;
      if (!enemy.active || !visible) continue;

      const attackDistance = type.range * FP;
      if (distance <= attackDistance) {
        if (enemy.cooldown <= 0) {
          damagePlayer(state, type.damage + (nextRandom(state) % 4), enemy.id);
          enemy.cooldown = type.cooldown + (enemy.phase % 23);
          state.events.push({ type: "enemy-fire", id: enemy.id, kind: enemy.kind });
          if (state.gameOver) break;
        }
      } else if (enemy.pain <= 0) {
        const norm = Math.max(1, distance);
        const moveX = Math.trunc(dx * type.speed / norm);
        const moveY = Math.trunc(dy * type.speed / norm);
        moveBody(state, enemy, moveX, moveY, type.radius);
      }
    }
    state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
  }

  function collectPickup(state, pickup) {
    const p = state.player;
    if (pickup.kind === "medkit") {
      if (p.health >= p.maxHealth) return false;
      p.health = Math.min(p.maxHealth, p.health + 28);
    } else if (pickup.kind === "armor") {
      if (p.armor >= 100) return false;
      p.armor = Math.min(100, p.armor + 50);
    } else if (pickup.kind === "cells") {
      p.cells = Math.min(240, p.cells + 30);
    } else if (pickup.kind === "shells") {
      p.shells = Math.min(80, p.shells + 10);
    } else if (pickup.kind === "breach") {
      p.owned |= 1 << 1;
      p.weapon = 1;
      p.shells = Math.min(80, p.shells + 16);
    } else if (pickup.kind === "vulcan") {
      p.owned |= 1 << 2;
      p.weapon = 2;
      p.cells = Math.min(240, p.cells + 60);
    } else if (pickup.kind === "key") {
      p.keys += 1;
    } else if (pickup.kind === "archive") {
      state.stats.archives += 1;
      state.score += 1250;
    }
    state.stats.pickups += 1;
    state.events.push({ type: "pickup", id: pickup.id, kind: pickup.kind });
    return true;
  }

  function updatePickups(state) {
    const remaining = [];
    for (const pickup of state.pickups) {
      const distance = distanceApprox(state.player.x - pickup.x, state.player.y - pickup.y);
      if (distance < 470 && collectPickup(state, pickup)) continue;
      remaining.push(pickup);
    }
    state.pickups = remaining;
  }

  function updatePlayer(state, inputWord) {
    const actions = inputActions(inputWord);
    const p = state.player;
    switchWeapon(state, actions);
    let rotation = inputTurn(inputWord) * 72;
    if (actions & INPUT.TURN_LEFT) rotation -= 520;
    if (actions & INPUT.TURN_RIGHT) rotation += 520;
    p.angle = (p.angle + rotation + ANGLE_MAX) % ANGLE_MAX;

    const dirX = cosAngle(p.angle);
    const dirY = sinAngle(p.angle);
    const rightX = -dirY;
    const rightY = dirX;
    const speed = actions & INPUT.RUN ? 78 : 52;
    let forward = 0;
    let strafe = 0;
    if (actions & INPUT.FORWARD) forward += speed;
    if (actions & INPUT.BACK) forward -= speed;
    if (actions & INPUT.STRAFE_RIGHT) strafe += speed;
    if (actions & INPUT.STRAFE_LEFT) strafe -= speed;
    if (forward && strafe) {
      forward = Math.trunc(forward * 181 / 256);
      strafe = Math.trunc(strafe * 181 / 256);
    }
    const moveX = Math.trunc((dirX * forward + rightX * strafe) / TRIG_SCALE);
    const moveY = Math.trunc((dirY * forward + rightY * strafe) / TRIG_SCALE);
    moveBody(state, p, moveX, moveY, PLAYER_RADIUS);
    if (moveX || moveY) p.bob = (p.bob + (actions & INPUT.RUN ? 3 : 2)) & 63;

    if (p.cooldown > 0) p.cooldown -= 1;
    if (p.hurt > 0) p.hurt -= 1;
    if ((actions & INPUT.USE) && !(state.previousActions & INPUT.USE)) useAhead(state);
    if ((actions & INPUT.FIRE) && !state.levelComplete) fireWeapon(state);
  }

  function completeMission(state) {
    if (state.levelComplete || state.gameOver || state.victory) return;
    state.levelComplete = true;
    state.transition = 120;
    state.stats.missions += 1;
    state.score += 2500 + state.player.health * 10 + state.levelKills * 100;
    state.events.push({ type: "mission-complete", index: state.missionIndex });
  }

  function step(state, inputWordInput) {
    const inputWord = Number(inputWordInput) >>> 0;
    const actions = inputActions(inputWord);
    state.events = [];
    if (state.gameOver || state.victory) {
      state.previousActions = actions;
      return state;
    }
    state.tick += 1;
    if (state.levelComplete) {
      state.transition -= 1;
      if (state.transition <= 0) {
        if (state.missionIndex + 1 >= MISSIONS.length) {
          state.victory = true;
          state.events.push({ type: "victory", score: state.score });
        } else {
          loadMission(state, state.missionIndex + 1, true);
        }
      }
      state.previousActions = actions;
      return state;
    }

    state.levelTick += 1;
    updateDoors(state);
    updatePlayer(state, inputWord);
    if (!state.levelComplete) {
      updateEnemies(state);
      if (!state.gameOver) updatePickups(state);
    }
    state.previousActions = actions;
    return state;
  }

  function createRecorder(seedInput, difficultyInput) {
    return {
      version: ENGINE_VERSION,
      seed: normalizeSeed(seedInput),
      difficulty: normalizeDifficulty(difficultyInput),
      ticks: 0,
      runs: [],
    };
  }

  function recordInput(recorder, inputWordInput) {
    if (!recorder || recorder.version !== ENGINE_VERSION || !Array.isArray(recorder.runs)) throw new Error("Invalid replay recorder");
    if (recorder.ticks >= MAX_REPLAY_TICKS) throw new Error("Replay exceeds the six-hour limit");
    const inputWord = Number(inputWordInput) >>> 0;
    const last = recorder.runs[recorder.runs.length - 1];
    if (last && last[0] === inputWord && last[1] < 65535) last[1] += 1;
    else recorder.runs.push([inputWord, 1]);
    recorder.ticks += 1;
    return recorder;
  }

  function tryRecordInput(recorder, inputWordInput) {
    if (!recorder || recorder.version !== ENGINE_VERSION || !Array.isArray(recorder.runs)) throw new Error("Invalid replay recorder");
    if (recorder.ticks >= MAX_REPLAY_TICKS) return false;
    recordInput(recorder, inputWordInput);
    return true;
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
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error("Replay payload is not valid base64");
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
    if (!recorder || recorder.version !== ENGINE_VERSION || !Array.isArray(recorder.runs)) throw new Error("Invalid replay recorder");
    const payload = JSON.stringify([ENGINE_VERSION, recorder.seed >>> 0, recorder.difficulty, recorder.ticks, recorder.runs]);
    const checksum = seedHex(fnv1a(payload));
    const encoded = encodeBase64Ascii(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const code = `${REPLAY_PREFIX}.${checksum}.${encoded}`;
    if (code.length > MAX_REPLAY_CODE_LENGTH) throw new Error("Replay code is too large");
    return code;
  }

  function decodeReplay(codeInput) {
    const code = String(codeInput || "").trim();
    if (code.length > MAX_REPLAY_CODE_LENGTH) throw new Error("Replay code is too large");
    const parts = code.split(".");
    if (parts.length !== 3 || parts[0] !== REPLAY_PREFIX || !/^[0-9A-F]{8}$/.test(parts[1])) throw new Error("Replay code header is invalid");
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
    if (!Array.isArray(parsed) || parsed.length !== 5 || parsed[0] !== ENGINE_VERSION) throw new Error("Replay engine version is unsupported");
    const seed = parsed[1];
    const difficulty = parsed[2];
    const ticks = parsed[3];
    const runs = parsed[4];
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
        !Number.isInteger(difficulty) || difficulty < 0 || difficulty >= DIFFICULTIES.length ||
        !Number.isInteger(ticks) || ticks < 0 || ticks > MAX_REPLAY_TICKS ||
        !Array.isArray(runs) || runs.length > ticks + 1) throw new Error("Replay metadata is invalid");
    let total = 0;
    const cleanRuns = [];
    for (const run of runs) {
      if (!Array.isArray(run) || run.length !== 2 || !Number.isInteger(run[0]) || run[0] < 0 || run[0] > 0xffffffff ||
          !Number.isInteger(run[1]) || run[1] < 1 || run[1] > 65535) throw new Error("Replay input run is invalid");
      total += run[1];
      if (total > MAX_REPLAY_TICKS) throw new Error("Replay tick count is invalid");
      cleanRuns.push([run[0] >>> 0, run[1]]);
    }
    if (total !== ticks) throw new Error("Replay tick count does not match its input stream");
    return Object.freeze({ version: ENGINE_VERSION, seed: seed >>> 0, difficulty, ticks, runs: Object.freeze(cleanRuns) });
  }

  function createReplayCursor(replay) {
    return { replay, runIndex: 0, runOffset: 0, tick: 0 };
  }

  function nextReplayInput(cursor) {
    if (!cursor || cursor.tick >= cursor.replay.ticks) return null;
    const run = cursor.replay.runs[cursor.runIndex];
    const inputWord = run[0] >>> 0;
    cursor.runOffset += 1;
    cursor.tick += 1;
    if (cursor.runOffset >= run[1]) {
      cursor.runIndex += 1;
      cursor.runOffset = 0;
    }
    return inputWord;
  }

  function stateDigest(state) {
    const compact = {
      version: state.engineVersion,
      seed: state.seed,
      difficulty: state.difficulty,
      rng: state.rng,
      tick: state.tick,
      levelTick: state.levelTick,
      missionIndex: state.missionIndex,
      blueprint: state.blueprint.signature,
      player: state.player,
      doors: state.doors,
      secrets: state.secrets,
      enemies: state.enemies,
      pickups: state.pickups,
      nextEntityId: state.nextEntityId,
      score: state.score,
      levelKills: state.levelKills,
      totalLevelEnemies: state.totalLevelEnemies,
      previousActions: state.previousActions,
      lastShotTick: state.lastShotTick,
      levelComplete: state.levelComplete,
      transition: state.transition,
      gameOver: state.gameOver,
      victory: state.victory,
      stats: state.stats,
    };
    return seedHex(fnv1a(JSON.stringify(compact)));
  }

  return Object.freeze({
    ENGINE_VERSION,
    REPLAY_PREFIX,
    TICK_RATE,
    FP,
    ANGLE_MAX,
    TRIG_SCALE,
    PLAYER_RADIUS,
    DOOR_PASS,
    MAX_REPLAY_TICKS,
    MAX_REPLAY_CODE_LENGTH,
    INPUT,
    ACTION_MASK,
    DIFFICULTIES,
    WEAPONS,
    ENEMY_TYPES,
    MISSIONS,
    normalizeDifficulty,
    normalizeSeed,
    seedHex,
    deriveSeed,
    sinAngle,
    cosAngle,
    packInput,
    inputActions,
    inputTurn,
    makeLevelBlueprint,
    createRun,
    cellAt,
    doorAt,
    secretAt,
    isBlockingCell,
    canOccupy,
    hasLineOfSight,
    missionObjectiveDenial,
    completeMission,
    step,
    createRecorder,
    recordInput,
    tryRecordInput,
    encodeReplay,
    decodeReplay,
    createReplayCursor,
    nextReplayInput,
    stateDigest,
  });
});
