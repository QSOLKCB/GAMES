(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VectorZeroCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ENGINE_VERSION = 1;
  const REPLAY_PREFIX = "VZ01";
  const TICK_RATE = 60;
  const FP = 1024;
  const CELL_SIZE = 6 * FP;
  const ANGLE_MAX = 65536;
  const TRIG_SCALE = 16384;
  const PLAYER_RADIUS = 250;
  const ENEMY_RADIUS = 210;
  const MAX_REPLAY_TICKS = TICK_RATE * 60 * 60 * 2;
  const MAX_REPLAY_PAYLOAD_LENGTH = 96 + MAX_REPLAY_TICKS * 15;
  const MAX_REPLAY_CODE_LENGTH = REPLAY_PREFIX.length + 10 + Math.ceil(MAX_REPLAY_PAYLOAD_LENGTH / 3) * 4;

  const INPUT = Object.freeze({
    FORWARD: 1,
    BACK: 2,
    STRAFE_LEFT: 4,
    STRAFE_RIGHT: 8,
    RISE: 16,
    FALL: 32,
    ROLL_LEFT: 64,
    ROLL_RIGHT: 128,
    FIRE: 256,
    MISSILE: 512,
    BOOST: 1024,
  });
  const ACTION_MASK = 0x07ff;

  const DIFFICULTIES = Object.freeze([
    Object.freeze({ id: 0, name: "Survey Pilot", shield: 130, enemyHealth: 80, enemyDamage: 75, enemySpeed: 85, score: 80 }),
    Object.freeze({ id: 1, name: "Vector Marine", shield: 110, enemyHealth: 100, enemyDamage: 100, enemySpeed: 100, score: 100 }),
    Object.freeze({ id: 2, name: "Null-Space Ace", shield: 90, enemyHealth: 125, enemyDamage: 130, enemySpeed: 115, score: 145 }),
  ]);

  const ENEMY_TYPES = Object.freeze({
    drone: Object.freeze({ name: "DRONE", health: 42, speed: 14, damage: 8, cooldown: 72, range: 6, score: 180 }),
    hunter: Object.freeze({ name: "HUNTER", health: 70, speed: 18, damage: 12, cooldown: 58, range: 7, score: 320 }),
    sentinel: Object.freeze({ name: "SENTINEL", health: 105, speed: 9, damage: 17, cooldown: 88, range: 8, score: 520 }),
    custodian: Object.freeze({ name: "ZERO CUSTODIAN", health: 320, speed: 11, damage: 20, cooldown: 50, range: 9, score: 3600 }),
  });

  const DIRECTIONS = Object.freeze([
    Object.freeze({ x: 1, y: 0, z: 0 }),
    Object.freeze({ x: -1, y: 0, z: 0 }),
    Object.freeze({ x: 0, y: 1, z: 0 }),
    Object.freeze({ x: 0, y: -1, z: 0 }),
    Object.freeze({ x: 0, y: 0, z: 1 }),
    Object.freeze({ x: 0, y: 0, z: -1 }),
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
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function mix32(value) {
    let mixed = value >>> 0;
    mixed ^= mixed >>> 16;
    mixed = Math.imul(mixed, 0x7feb352d);
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x846ca68b);
    mixed ^= mixed >>> 16;
    return (mixed >>> 0) || 0x6d2b79f5;
  }

  function normalizeSeed(value) {
    if (typeof value === "number" && Number.isFinite(value)) return (value >>> 0) || 0x6d2b79f5;
    const text = String(value == null ? "" : value).trim();
    if (/^0x[0-9a-f]{1,8}$/i.test(text)) return (parseInt(text.slice(2), 16) >>> 0) || 0x6d2b79f5;
    if (/^[0-9]{1,10}$/.test(text)) return (Number(text) >>> 0) || 0x6d2b79f5;
    return mix32(fnv1a(text || "VECTOR-ZERO"));
  }

  function seedHex(seed) {
    return (seed >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function deriveSeed(seed, sector) {
    return mix32((seed >>> 0) ^ Math.imul((sector + 1) >>> 0, 0x9e3779b1));
  }

  function nextValue(value) {
    let state = value >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) || 0x6d2b79f5;
  }

  function nextRandom(state) {
    state.rng = nextValue(state.rng);
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

  function mulTrig(a, b) {
    return Math.trunc(a * b / TRIG_SCALE);
  }

  function getBasis(yaw, pitch, roll) {
    const cy = cosAngle(yaw);
    const sy = sinAngle(yaw);
    const cp = cosAngle(pitch);
    const sp = sinAngle(pitch);
    const cr = cosAngle(roll);
    const sr = sinAngle(roll);
    const forward = {
      x: mulTrig(cp, cy),
      y: sp,
      z: mulTrig(cp, sy),
    };
    const right0 = { x: -sy, y: 0, z: cy };
    const up0 = {
      x: -mulTrig(sp, cy),
      y: cp,
      z: -mulTrig(sp, sy),
    };
    const right = {
      x: mulTrig(right0.x, cr) + mulTrig(up0.x, sr),
      y: mulTrig(right0.y, cr) + mulTrig(up0.y, sr),
      z: mulTrig(right0.z, cr) + mulTrig(up0.z, sr),
    };
    const up = {
      x: mulTrig(up0.x, cr) - mulTrig(right0.x, sr),
      y: mulTrig(up0.y, cr) - mulTrig(right0.y, sr),
      z: mulTrig(up0.z, cr) - mulTrig(right0.z, sr),
    };
    return { forward, right, up };
  }

  function packInput(actionMask, yawInput, pitchInput) {
    const yaw = clamp(Math.trunc(Number(yawInput) || 0), -64, 63) & 0xff;
    const pitch = clamp(Math.trunc(Number(pitchInput) || 0), -64, 63) & 0xff;
    return ((((pitch << 20) >>> 0) | ((yaw << 12) >>> 0) | ((Number(actionMask) || 0) & ACTION_MASK)) >>> 0);
  }

  function inputActions(inputWord) {
    return (Number(inputWord) >>> 0) & ACTION_MASK;
  }

  function signedByte(value) {
    return value >= 128 ? value - 256 : value;
  }

  function inputYaw(inputWord) {
    return signedByte(((Number(inputWord) >>> 0) >>> 12) & 0xff);
  }

  function inputPitch(inputWord) {
    return signedByte(((Number(inputWord) >>> 0) >>> 20) & 0xff);
  }

  function cellKey(x, y, z) {
    return `${x},${y},${z}`;
  }

  function cellCenter(cell) {
    return {
      x: cell.x * CELL_SIZE + CELL_SIZE / 2,
      y: cell.y * CELL_SIZE + CELL_SIZE / 2,
      z: cell.z * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  function shuffleDirections(seedValue) {
    let seed = seedValue;
    const result = DIRECTIONS.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      seed = nextValue(seed);
      const other = seed % (index + 1);
      [result[index], result[other]] = [result[other], result[index]];
    }
    return { seed, directions: result };
  }

  function makeMineBlueprint(seedInput, sectorInput, difficultyInput) {
    const seed = normalizeSeed(seedInput);
    const sector = clamp(Math.trunc(Number(sectorInput) || 1), 1, 3);
    const difficulty = normalizeDifficulty(difficultyInput);
    const width = 7 + (sector >= 3 ? 1 : 0);
    const height = 5;
    const depth = 7 + (sector >= 2 ? 1 : 0);
    const targetCells = 46 + sector * 8;
    let localSeed = deriveSeed(seed, sector);
    const startCell = { x: Math.floor(width / 2), y: Math.floor(height / 2), z: Math.floor(depth / 2) };
    const cells = [startCell];
    const openLookup = Object.create(null);
    openLookup[cellKey(startCell.x, startCell.y, startCell.z)] = true;
    let attempts = 0;

    while (cells.length < targetCells && attempts < targetCells * 200) {
      attempts += 1;
      localSeed = nextValue(localSeed);
      const base = cells[localSeed % cells.length];
      const shuffled = shuffleDirections(localSeed);
      localSeed = shuffled.seed;
      for (const direction of shuffled.directions) {
        const x = base.x + direction.x;
        const y = base.y + direction.y;
        const z = base.z + direction.z;
        const key = cellKey(x, y, z);
        if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth || openLookup[key]) continue;
        const adjacentOpen = DIRECTIONS.reduce((count, offset) => count + (openLookup[cellKey(x + offset.x, y + offset.y, z + offset.z)] ? 1 : 0), 0);
        if (adjacentOpen > 1 && (localSeed & 3) !== 0) continue;
        const cell = { x, y, z };
        cells.push(cell);
        openLookup[key] = true;
        break;
      }
    }

    const queue = [startCell];
    const distances = Object.create(null);
    distances[cellKey(startCell.x, startCell.y, startCell.z)] = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const cell = queue[cursor];
      const distance = distances[cellKey(cell.x, cell.y, cell.z)];
      for (const direction of DIRECTIONS) {
        const next = { x: cell.x + direction.x, y: cell.y + direction.y, z: cell.z + direction.z };
        const key = cellKey(next.x, next.y, next.z);
        if (!openLookup[key] || distances[key] != null) continue;
        distances[key] = distance + 1;
        queue.push(next);
      }
    }

    const farCells = cells.slice().sort((first, second) => {
      const distanceDelta = distances[cellKey(second.x, second.y, second.z)] - distances[cellKey(first.x, first.y, first.z)];
      if (distanceDelta) return distanceDelta;
      return first.y - second.y || first.z - second.z || first.x - second.x;
    });
    const exitCell = farCells[0];
    const reserved = new Set([cellKey(startCell.x, startCell.y, startCell.z), cellKey(exitCell.x, exitCell.y, exitCell.z)]);
    const candidates = farCells.filter((cell) => distances[cellKey(cell.x, cell.y, cell.z)] >= 4 && !reserved.has(cellKey(cell.x, cell.y, cell.z)));
    const coreCells = [];
    for (const fraction of [0.16, 0.43, 0.7]) {
      let index = Math.min(candidates.length - 1, Math.floor(candidates.length * fraction));
      while (index < candidates.length && reserved.has(cellKey(candidates[index].x, candidates[index].y, candidates[index].z))) index += 1;
      const cell = candidates[index] || candidates.find((candidate) => !reserved.has(cellKey(candidate.x, candidate.y, candidate.z)));
      if (cell) {
        coreCells.push(cell);
        reserved.add(cellKey(cell.x, cell.y, cell.z));
      }
    }

    const difficultyContract = DIFFICULTIES[difficulty];
    const enemyCount = 4 + sector * 2 + difficulty;
    const enemies = [];
    const enemyKinds = sector === 1 ? ["drone", "hunter"] : sector === 2 ? ["drone", "hunter", "sentinel"] : ["hunter", "sentinel", "drone"];
    const enemyCandidates = candidates.filter((cell) => !reserved.has(cellKey(cell.x, cell.y, cell.z)));
    for (let index = enemyCandidates.length - 1; index > 0; index -= 1) {
      localSeed = nextValue(localSeed);
      const other = localSeed % (index + 1);
      [enemyCandidates[index], enemyCandidates[other]] = [enemyCandidates[other], enemyCandidates[index]];
    }
    for (let index = 0; index < enemyCount && index < enemyCandidates.length; index += 1) {
      localSeed = nextValue(localSeed);
      const cell = enemyCandidates[index];
      reserved.add(cellKey(cell.x, cell.y, cell.z));
      const kind = sector === 3 && index === 0 ? "custodian" : enemyKinds[(index + (localSeed & 3)) % enemyKinds.length];
      const type = ENEMY_TYPES[kind];
      enemies.push({
        kind,
        ...cellCenter(cell),
        health: Math.max(1, Math.floor(type.health * difficultyContract.enemyHealth / 100)),
        phase: localSeed & 255,
      });
    }

    const pickups = coreCells.map((cell, index) => ({ kind: "core", index, ...cellCenter(cell) }));
    const supplyKinds = ["energy", "shield", "missiles", "energy", "shield"];
    let supplyCursor = 0;
    for (const cell of cells) {
      const key = cellKey(cell.x, cell.y, cell.z);
      if (reserved.has(key) || distances[key] < 2 || (fnv1a(`${key}:${localSeed}`) % 7) !== 0) continue;
      pickups.push({ kind: supplyKinds[supplyCursor % supplyKinds.length], index: supplyCursor, ...cellCenter(cell) });
      supplyCursor += 1;
      if (supplyCursor >= 4 + sector) break;
    }

    const sortedCells = cells.slice().sort((first, second) => first.y - second.y || first.z - second.z || first.x - second.x);
    const firstRouteCell = queue[1] || startCell;
    const routeDx = firstRouteCell.x - startCell.x;
    const routeDy = firstRouteCell.y - startCell.y;
    const routeDz = firstRouteCell.z - startCell.z;
    let yaw = routeDx < 0 ? ANGLE_MAX / 2 : routeDz > 0 ? ANGLE_MAX / 4 : routeDz < 0 ? ANGLE_MAX * 3 / 4 : 0;
    let pitch = routeDy > 0 ? ANGLE_MAX / 8 : routeDy < 0 ? -ANGLE_MAX / 8 : 0;
    if (!routeDx && !routeDz) yaw = 0;
    const signature = seedHex(fnv1a(JSON.stringify([
      ENGINE_VERSION,
      seed,
      sector,
      difficulty,
      sortedCells,
      exitCell,
      enemies,
      pickups,
    ])));

    return Object.freeze({
      seed,
      sector,
      difficulty,
      width,
      height,
      depth,
      cellSize: CELL_SIZE,
      cells: Object.freeze(sortedCells.map((cell) => Object.freeze({ ...cell }))),
      openLookup: Object.freeze({ ...openLookup }),
      start: Object.freeze({ ...cellCenter(startCell), yaw, pitch, roll: 0, cell: Object.freeze({ ...startCell }) }),
      exit: Object.freeze({ ...cellCenter(exitCell), cell: Object.freeze({ ...exitCell }) }),
      enemies: Object.freeze(enemies.map((enemy) => Object.freeze({ ...enemy }))),
      pickups: Object.freeze(pickups.map((pickup) => Object.freeze({ ...pickup }))),
      distances: Object.freeze({ ...distances }),
      signature,
    });
  }

  function worldCell(position) {
    return {
      x: Math.floor(position.x / CELL_SIZE),
      y: Math.floor(position.y / CELL_SIZE),
      z: Math.floor(position.z / CELL_SIZE),
    };
  }

  function isOpenCell(blueprint, x, y, z) {
    return Boolean(blueprint && blueprint.openLookup[cellKey(x, y, z)]);
  }

  function isOpenPosition(blueprint, x, y, z) {
    return isOpenCell(blueprint, Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE), Math.floor(z / CELL_SIZE));
  }

  function canOccupy(blueprint, x, y, z, radius) {
    const edge = Math.trunc(radius * 181 / 256);
    const corner = Math.trunc(radius * 148 / 256);
    const samples = [
      [0, 0, 0], [radius, 0, 0], [-radius, 0, 0], [0, radius, 0], [0, -radius, 0], [0, 0, radius], [0, 0, -radius],
      [edge, edge, 0], [edge, -edge, 0], [-edge, edge, 0], [-edge, -edge, 0],
      [edge, 0, edge], [edge, 0, -edge], [-edge, 0, edge], [-edge, 0, -edge],
      [0, edge, edge], [0, edge, -edge], [0, -edge, edge], [0, -edge, -edge],
      [corner, corner, corner], [corner, corner, -corner], [corner, -corner, corner], [corner, -corner, -corner],
      [-corner, corner, corner], [-corner, corner, -corner], [-corner, -corner, corner], [-corner, -corner, -corner],
    ];
    return samples.every((sample) => isOpenPosition(blueprint, x + sample[0], y + sample[1], z + sample[2]));
  }

  function distanceApprox(dx, dy, dz) {
    const values = [Math.abs(dx), Math.abs(dy), Math.abs(dz)].sort((first, second) => first - second);
    return values[2] + Math.floor(values[1] * 3 / 8) + Math.floor(values[0] * 3 / 16);
  }

  function hasLineOfSight(blueprint, fromX, fromY, fromZ, toX, toY, toZ) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dz = toZ - fromZ;
    const steps = Math.max(1, Math.ceil(distanceApprox(dx, dy, dz) / 180));
    for (let index = 1; index < steps; index += 1) {
      const x = fromX + Math.trunc(dx * index / steps);
      const y = fromY + Math.trunc(dy * index / steps);
      const z = fromZ + Math.trunc(dz * index / steps);
      if (!isOpenPosition(blueprint, x, y, z)) return false;
    }
    return true;
  }

  function moveBody(state, body, dx, dy, dz, radius) {
    const blueprint = state.blueprint;
    if (canOccupy(blueprint, body.x + dx, body.y, body.z, radius)) body.x += dx;
    else if (body.vx != null) body.vx = -Math.trunc(body.vx / 4);
    if (canOccupy(blueprint, body.x, body.y + dy, body.z, radius)) body.y += dy;
    else if (body.vy != null) body.vy = -Math.trunc(body.vy / 4);
    if (canOccupy(blueprint, body.x, body.y, body.z + dz, radius)) body.z += dz;
    else if (body.vz != null) body.vz = -Math.trunc(body.vz / 4);
  }

  function createRun(seedInput, difficultyInput) {
    const seed = normalizeSeed(seedInput);
    const difficulty = normalizeDifficulty(difficultyInput);
    const state = {
      engineVersion: ENGINE_VERSION,
      seed,
      difficulty,
      sector: 1,
      rng: mix32(seed ^ 0x51a7c0de),
      tick: 0,
      levelTick: 0,
      blueprint: null,
      player: null,
      enemies: [],
      pickups: [],
      projectiles: [],
      nextEntityId: 1,
      score: 0,
      coresCollected: 0,
      coresRequired: 3,
      previousActions: 0,
      exitContact: false,
      sectorComplete: false,
      transition: 0,
      gameOver: false,
      victory: false,
      events: [],
      stats: {
        shots: 0,
        hits: 0,
        missiles: 0,
        kills: 0,
        damageTaken: 0,
        pickups: 0,
        sectors: 0,
      },
    };
    loadSector(state, 1, false);
    return state;
  }

  function loadSector(state, sector, preservePlayer) {
    const blueprint = makeMineBlueprint(state.seed, sector, state.difficulty);
    const oldPlayer = state.player;
    const contract = DIFFICULTIES[state.difficulty];
    state.sector = sector;
    state.blueprint = blueprint;
    state.levelTick = 0;
    state.coresCollected = 0;
    state.coresRequired = blueprint.pickups.filter((pickup) => pickup.kind === "core").length;
    state.exitContact = false;
    state.sectorComplete = false;
    state.transition = 0;
    state.player = {
      x: blueprint.start.x,
      y: blueprint.start.y,
      z: blueprint.start.z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: blueprint.start.yaw,
      pitch: blueprint.start.pitch,
      roll: blueprint.start.roll,
      shield: preservePlayer && oldPlayer ? Math.min(contract.shield, oldPlayer.shield + 28) : contract.shield,
      maxShield: contract.shield,
      energy: preservePlayer && oldPlayer ? Math.min(1000, oldPlayer.energy + 240) : 1000,
      missiles: preservePlayer && oldPlayer ? Math.min(12, oldPlayer.missiles + 2) : 5,
      weaponCooldown: 0,
      missileCooldown: 0,
      hurt: 0,
    };
    state.enemies = blueprint.enemies.map((enemy) => ({
      id: state.nextEntityId++,
      kind: enemy.kind,
      x: enemy.x,
      y: enemy.y,
      z: enemy.z,
      vx: 0,
      vy: 0,
      vz: 0,
      health: enemy.health,
      maxHealth: enemy.health,
      phase: enemy.phase,
      cooldown: 18 + enemy.phase % 70,
      pain: 0,
    }));
    state.pickups = blueprint.pickups.map((pickup) => ({ id: state.nextEntityId++, ...pickup }));
    state.projectiles = [];
    state.events.push({ type: "sector", sector, signature: blueprint.signature });
  }

  function spawnProjectile(state, owner, kind, source, direction, speed, damage, lifetime) {
    state.projectiles.push({
      id: state.nextEntityId++,
      owner,
      kind,
      x: source.x + Math.trunc(direction.x * 380 / TRIG_SCALE),
      y: source.y + Math.trunc(direction.y * 380 / TRIG_SCALE),
      z: source.z + Math.trunc(direction.z * 380 / TRIG_SCALE),
      vx: Math.trunc(direction.x * speed / TRIG_SCALE) + Math.trunc((source.vx || 0) / 3),
      vy: Math.trunc(direction.y * speed / TRIG_SCALE) + Math.trunc((source.vy || 0) / 3),
      vz: Math.trunc(direction.z * speed / TRIG_SCALE) + Math.trunc((source.vz || 0) / 3),
      damage,
      lifetime,
      radius: kind === "missile" ? 165 : 90,
    });
  }

  function fireWeapons(state, actions, basis) {
    const player = state.player;
    if ((actions & INPUT.FIRE) && player.weaponCooldown <= 0 && player.energy >= 14) {
      player.energy -= 14;
      player.weaponCooldown = 8;
      state.stats.shots += 1;
      spawnProjectile(state, "player", "laser", player, basis.forward, 155, 24, 240);
      state.events.push({ type: "shot", kind: "laser" });
    }
    if ((actions & INPUT.MISSILE) && !(state.previousActions & INPUT.MISSILE) && player.missileCooldown <= 0 && player.missiles > 0) {
      player.missiles -= 1;
      player.missileCooldown = 42;
      state.stats.missiles += 1;
      spawnProjectile(state, "player", "missile", player, basis.forward, 105, 82, 360);
      state.events.push({ type: "shot", kind: "missile" });
    }
  }

  function updatePlayer(state, inputWord) {
    const actions = inputActions(inputWord);
    const player = state.player;
    player.yaw = (player.yaw + inputYaw(inputWord) * 74 + ANGLE_MAX) % ANGLE_MAX;
    player.pitch = clamp(player.pitch - inputPitch(inputWord) * 66, -ANGLE_MAX / 4, ANGLE_MAX / 4);
    if (actions & INPUT.ROLL_LEFT) player.roll = (player.roll - 430 + ANGLE_MAX) % ANGLE_MAX;
    if (actions & INPUT.ROLL_RIGHT) player.roll = (player.roll + 430) % ANGLE_MAX;
    const basis = getBasis(player.yaw, player.pitch, player.roll);
    const boosting = Boolean(actions & INPUT.BOOST) && player.energy >= 3;
    const acceleration = boosting ? 12 : 7;
    if (boosting) player.energy -= 3;
    let forward = 0;
    let strafe = 0;
    let rise = 0;
    if (actions & INPUT.FORWARD) forward += acceleration;
    if (actions & INPUT.BACK) forward -= acceleration;
    if (actions & INPUT.STRAFE_RIGHT) strafe += acceleration;
    if (actions & INPUT.STRAFE_LEFT) strafe -= acceleration;
    if (actions & INPUT.RISE) rise += acceleration;
    if (actions & INPUT.FALL) rise -= acceleration;
    player.vx += Math.trunc((basis.forward.x * forward + basis.right.x * strafe + basis.up.x * rise) / TRIG_SCALE);
    player.vy += Math.trunc((basis.forward.y * forward + basis.right.y * strafe + basis.up.y * rise) / TRIG_SCALE);
    player.vz += Math.trunc((basis.forward.z * forward + basis.right.z * strafe + basis.up.z * rise) / TRIG_SCALE);
    player.vx = Math.trunc(player.vx * 1000 / 1024);
    player.vy = Math.trunc(player.vy * 1000 / 1024);
    player.vz = Math.trunc(player.vz * 1000 / 1024);
    const speed = distanceApprox(player.vx, player.vy, player.vz);
    const maxSpeed = boosting ? 155 : 112;
    if (speed > maxSpeed) {
      player.vx = Math.trunc(player.vx * maxSpeed / speed);
      player.vy = Math.trunc(player.vy * maxSpeed / speed);
      player.vz = Math.trunc(player.vz * maxSpeed / speed);
    }
    moveBody(state, player, player.vx, player.vy, player.vz, PLAYER_RADIUS);
    if (player.weaponCooldown > 0) player.weaponCooldown -= 1;
    if (player.missileCooldown > 0) player.missileCooldown -= 1;
    if (player.hurt > 0) player.hurt -= 1;
    if (!boosting) player.energy = Math.min(1000, player.energy + 3);
    fireWeapons(state, actions, basis);
  }

  function damagePlayer(state, amount, sourceId) {
    const player = state.player;
    player.shield = Math.max(0, player.shield - amount);
    player.hurt = 18;
    state.stats.damageTaken += amount;
    state.events.push({ type: "player-hit", amount, sourceId, shield: player.shield });
    if (player.shield <= 0) {
      state.gameOver = true;
      state.events.push({ type: "game-over", score: state.score });
    }
  }

  function hitEnemy(state, enemy, projectile) {
    enemy.health -= projectile.damage;
    enemy.pain = 8;
    state.stats.hits += 1;
    state.events.push({ type: "enemy-hit", id: enemy.id, kind: enemy.kind, health: Math.max(0, enemy.health) });
    if (enemy.health <= 0) {
      const type = ENEMY_TYPES[enemy.kind];
      state.score += Math.floor(type.score * DIFFICULTIES[state.difficulty].score / 100);
      state.stats.kills += 1;
      state.events.push({ type: "enemy-down", id: enemy.id, kind: enemy.kind });
    }
  }

  function updateProjectiles(state) {
    const remaining = [];
    for (const projectile of state.projectiles) {
      projectile.lifetime -= 1;
      const nextX = projectile.x + projectile.vx;
      const nextY = projectile.y + projectile.vy;
      const nextZ = projectile.z + projectile.vz;
      if (projectile.lifetime <= 0 || !isOpenPosition(state.blueprint, nextX, nextY, nextZ)) {
        state.events.push({ type: "impact", kind: projectile.kind, x: projectile.x, y: projectile.y, z: projectile.z });
        continue;
      }
      projectile.x = nextX;
      projectile.y = nextY;
      projectile.z = nextZ;
      let consumed = false;
      if (projectile.owner === "player") {
        for (const enemy of state.enemies) {
          if (enemy.health <= 0) continue;
          if (distanceApprox(projectile.x - enemy.x, projectile.y - enemy.y, projectile.z - enemy.z) <= projectile.radius + ENEMY_RADIUS) {
            hitEnemy(state, enemy, projectile);
            consumed = true;
            break;
          }
        }
      } else if (distanceApprox(projectile.x - state.player.x, projectile.y - state.player.y, projectile.z - state.player.z) <= projectile.radius + PLAYER_RADIUS) {
        damagePlayer(state, projectile.damage, projectile.owner);
        consumed = true;
      }
      if (!consumed) remaining.push(projectile);
    }
    state.projectiles = remaining;
    state.enemies = state.enemies.filter((enemy) => enemy.health > 0);
  }

  function directionTo(dx, dy, dz) {
    const distance = Math.max(1, distanceApprox(dx, dy, dz));
    return {
      x: Math.trunc(dx * TRIG_SCALE / distance),
      y: Math.trunc(dy * TRIG_SCALE / distance),
      z: Math.trunc(dz * TRIG_SCALE / distance),
    };
  }

  function moveEnemy(state, enemy, direction, speed) {
    const dx = Math.trunc(direction.x * speed / TRIG_SCALE);
    const dy = Math.trunc(direction.y * speed / TRIG_SCALE);
    const dz = Math.trunc(direction.z * speed / TRIG_SCALE);
    const before = { x: enemy.x, y: enemy.y, z: enemy.z };
    moveBody(state, enemy, dx, dy, dz, ENEMY_RADIUS);
    if (enemy.x === before.x && enemy.y === before.y && enemy.z === before.z) {
      const phase = (state.tick + enemy.phase) % 3;
      if (phase === 0) moveBody(state, enemy, dx, 0, 0, ENEMY_RADIUS);
      else if (phase === 1) moveBody(state, enemy, 0, dy || speed, 0, ENEMY_RADIUS);
      else moveBody(state, enemy, 0, 0, dz, ENEMY_RADIUS);
    }
  }

  function updateEnemies(state) {
    const player = state.player;
    const difficulty = DIFFICULTIES[state.difficulty];
    for (const enemy of state.enemies) {
      if (enemy.cooldown > 0) enemy.cooldown -= 1;
      if (enemy.pain > 0) enemy.pain -= 1;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const dz = player.z - enemy.z;
      const distance = distanceApprox(dx, dy, dz);
      if (distance > 10 * CELL_SIZE) continue;
      const visible = hasLineOfSight(state.blueprint, enemy.x, enemy.y, enemy.z, player.x, player.y, player.z);
      const type = ENEMY_TYPES[enemy.kind];
      const direction = directionTo(dx, dy, dz);
      if (visible && distance <= type.range * CELL_SIZE / 2 && enemy.cooldown <= 0) {
        const damage = Math.max(1, Math.floor((type.damage + (nextRandom(state) & 3)) * difficulty.enemyDamage / 100));
        spawnProjectile(state, enemy.id, "plasma", enemy, direction, 92, damage, 360);
        enemy.cooldown = type.cooldown + enemy.phase % 17;
        state.events.push({ type: "enemy-fire", id: enemy.id, kind: enemy.kind });
      }
      if (distance > CELL_SIZE * 3 / 2 && enemy.pain <= 0) {
        const speed = Math.max(4, Math.floor(type.speed * difficulty.enemySpeed / 100));
        moveEnemy(state, enemy, direction, speed);
      }
      if (distance < PLAYER_RADIUS + ENEMY_RADIUS + 80 && (state.tick + enemy.phase) % 30 === 0) {
        damagePlayer(state, Math.max(2, Math.floor(type.damage * difficulty.enemyDamage / 180)), enemy.id);
      }
      if (state.gameOver) break;
    }
  }

  function collectPickup(state, pickup) {
    const player = state.player;
    if (pickup.kind === "core") {
      state.coresCollected += 1;
      state.score += 900;
    } else if (pickup.kind === "energy") {
      if (player.energy >= 1000) return false;
      player.energy = Math.min(1000, player.energy + 260);
    } else if (pickup.kind === "shield") {
      if (player.shield >= player.maxShield) return false;
      player.shield = Math.min(player.maxShield, player.shield + 32);
    } else if (pickup.kind === "missiles") {
      if (player.missiles >= 12) return false;
      player.missiles = Math.min(12, player.missiles + 3);
    }
    state.stats.pickups += 1;
    state.events.push({ type: "pickup", id: pickup.id, kind: pickup.kind, cores: state.coresCollected });
    return true;
  }

  function updatePickups(state) {
    const remaining = [];
    for (const pickup of state.pickups) {
      if (distanceApprox(state.player.x - pickup.x, state.player.y - pickup.y, state.player.z - pickup.z) < 460 && collectPickup(state, pickup)) continue;
      remaining.push(pickup);
    }
    state.pickups = remaining;
  }

  function completeSector(state) {
    if (state.sectorComplete || state.gameOver || state.victory) return false;
    state.sectorComplete = true;
    state.transition = 120;
    state.stats.sectors += 1;
    state.score += 2200 + state.player.shield * 12 + state.player.energy;
    state.events.push({ type: "sector-complete", sector: state.sector, score: state.score });
    return true;
  }

  function checkExit(state) {
    const exit = state.blueprint.exit;
    if (distanceApprox(state.player.x - exit.x, state.player.y - exit.y, state.player.z - exit.z) >= 540) {
      state.exitContact = false;
      return;
    }
    if (state.coresCollected < state.coresRequired) {
      if (!state.exitContact) {
        state.events.push({ type: "denied", reason: `${state.coresRequired - state.coresCollected} VECTOR CORE${state.coresRequired - state.coresCollected === 1 ? "" : "S"} MISSING` });
      }
      state.exitContact = true;
      return;
    }
    state.exitContact = true;
    completeSector(state);
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
    if (state.sectorComplete) {
      state.transition -= 1;
      if (state.transition <= 0) {
        if (state.sector >= 3) {
          state.victory = true;
          state.events.push({ type: "victory", score: state.score });
        } else {
          loadSector(state, state.sector + 1, true);
        }
      }
      state.previousActions = actions;
      return state;
    }
    state.levelTick += 1;
    updatePlayer(state, inputWord);
    updateProjectiles(state);
    if (!state.gameOver) updateEnemies(state);
    if (!state.gameOver) updatePickups(state);
    if (!state.gameOver) checkExit(state);
    state.previousActions = actions;
    return state;
  }

  function createRecorder(seedInput, difficultyInput) {
    return { version: ENGINE_VERSION, seed: normalizeSeed(seedInput), difficulty: normalizeDifficulty(difficultyInput), ticks: 0, runs: [] };
  }

  function recordInput(recorder, inputWordInput) {
    if (!recorder || recorder.version !== ENGINE_VERSION || !Array.isArray(recorder.runs)) throw new Error("Invalid replay recorder");
    if (recorder.ticks >= MAX_REPLAY_TICKS) throw new Error("Replay exceeds the two-hour limit");
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
    if (typeof btoa !== "function") throw new Error("ASCII base64 encoding is unavailable");
    return btoa(text);
  }

  function decodeBase64Ascii(encoded) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error("Replay payload is not valid base64");
    if (typeof atob !== "function") throw new Error("ASCII base64 decoding is unavailable");
    try {
      return atob(encoded);
    } catch (_error) {
      throw new Error("Replay payload is not valid base64");
    }
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
      cleanRuns.push(Object.freeze([run[0] >>> 0, run[1]]));
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
      sector: state.sector,
      rng: state.rng,
      tick: state.tick,
      levelTick: state.levelTick,
      blueprint: state.blueprint.signature,
      player: state.player,
      enemies: state.enemies,
      pickups: state.pickups,
      projectiles: state.projectiles,
      nextEntityId: state.nextEntityId,
      score: state.score,
      coresCollected: state.coresCollected,
      coresRequired: state.coresRequired,
      previousActions: state.previousActions,
      exitContact: state.exitContact,
      sectorComplete: state.sectorComplete,
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
    CELL_SIZE,
    ANGLE_MAX,
    TRIG_SCALE,
    PLAYER_RADIUS,
    ENEMY_RADIUS,
    MAX_REPLAY_TICKS,
    MAX_REPLAY_CODE_LENGTH,
    INPUT,
    ACTION_MASK,
    DIFFICULTIES,
    ENEMY_TYPES,
    DIRECTIONS,
    clamp,
    normalizeDifficulty,
    normalizeSeed,
    seedHex,
    deriveSeed,
    sinAngle,
    cosAngle,
    getBasis,
    packInput,
    inputActions,
    inputYaw,
    inputPitch,
    cellKey,
    cellCenter,
    worldCell,
    makeMineBlueprint,
    isOpenCell,
    isOpenPosition,
    canOccupy,
    distanceApprox,
    hasLineOfSight,
    createRun,
    completeSector,
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
