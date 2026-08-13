(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PixelWarfrontCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ENGINE_VERSION = 1;
  const REPLAY_PREFIX = "PWR1";
  const WIDTH = 960;
  const HEIGHT = 600;
  const SCALE = 16;
  const TICK_RATE = 20;
  const MAX_REPLAY_TICKS = TICK_RATE * 60 * 60 * 6;
  const MAX_COMMANDS_PER_TICK = 32;
  const PLAYER = 1;
  const ENEMY = 2;
  const GRID_COLUMNS = 30;
  const GRID_ROWS = 18;
  const CELL_SIZE = 32;
  const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  const BIOMES = Object.freeze([
    Object.freeze({ name: "FERROUS BASIN", code: "FER", accent: "#dc6c45" }),
    Object.freeze({ name: "COBALT STEPPE", code: "COB", accent: "#63a1ad" }),
    Object.freeze({ name: "ASHEN RELAY", code: "ASH", accent: "#d3a05f" }),
    Object.freeze({ name: "OXIDE DELTA", code: "OXD", accent: "#c6553c" }),
    Object.freeze({ name: "SILICA FAULT", code: "SIL", accent: "#8da391" }),
  ]);

  const UNIT_TYPES = Object.freeze({
    drone: Object.freeze({
      label: "DRONE", cost: 90, health: 78, radius: 8, speed: 30,
      damage: 4, range: 30, sight: 110, cooldown: 22, projectileSpeed: 170,
      supply: 1, trainTicks: 48, carry: 60, harvest: 3,
    }),
    ranger: Object.freeze({
      label: "RANGER", cost: 150, health: 118, radius: 9, speed: 36,
      damage: 15, range: 118, sight: 170, cooldown: 18, projectileSpeed: 230,
      supply: 2, trainTicks: 70, carry: 0, harvest: 0,
    }),
    tank: Object.freeze({
      label: "SIEGE CRAWLER", cost: 320, health: 310, radius: 15, speed: 23,
      damage: 42, range: 145, sight: 190, cooldown: 35, projectileSpeed: 185,
      supply: 4, trainTicks: 118, carry: 0, harvest: 0,
    }),
  });

  const BUILDING_TYPES = Object.freeze({
    hq: Object.freeze({
      label: "COMMAND NODE", cost: 0, health: 1800, radius: 39,
      power: 12, supply: 12, buildTicks: 0, damage: 0, range: 0, cooldown: 0,
    }),
    relay: Object.freeze({
      label: "GRID RELAY", cost: 190, health: 480, radius: 23,
      power: 10, supply: 8, buildTicks: 90, damage: 0, range: 0, cooldown: 0,
    }),
    refinery: Object.freeze({
      label: "FLUX REFINERY", cost: 240, health: 620, radius: 29,
      power: -2, supply: 0, buildTicks: 110, damage: 0, range: 0, cooldown: 0,
    }),
    factory: Object.freeze({
      label: "FORGE ARRAY", cost: 430, health: 820, radius: 34,
      power: -4, supply: 0, buildTicks: 145, damage: 0, range: 0, cooldown: 0,
    }),
    turret: Object.freeze({
      label: "ARC TURRET", cost: 270, health: 520, radius: 21,
      power: -3, supply: 0, buildTicks: 105, damage: 24, range: 165, cooldown: 20,
    }),
  });

  const BUILDABLE = Object.freeze(["relay", "refinery", "factory", "turret"]);
  const TRAINABLE = Object.freeze(["drone", "ranger", "tank"]);
  const FORMATION_OFFSETS = Object.freeze([
    Object.freeze([0, 0]), Object.freeze([-22, -22]), Object.freeze([22, -22]),
    Object.freeze([-22, 22]), Object.freeze([22, 22]), Object.freeze([-44, 0]),
    Object.freeze([44, 0]), Object.freeze([0, -44]), Object.freeze([0, 44]),
    Object.freeze([-44, -44]), Object.freeze([44, -44]), Object.freeze([-44, 44]),
    Object.freeze([44, 44]), Object.freeze([-66, -22]), Object.freeze([66, -22]),
    Object.freeze([-66, 22]), Object.freeze([66, 22]),
  ]);

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
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
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  }

  function normalizeSeed(input) {
    if (typeof input === "number" && Number.isFinite(input)) return Math.trunc(input) >>> 0;
    const text = String(input == null ? "" : input).trim();
    if (/^0x[0-9a-f]{1,8}$/i.test(text)) return parseInt(text.slice(2), 16) >>> 0;
    if (/^[0-9]{1,10}$/.test(text)) return Number(text) >>> 0;
    return mix32(fnv1a(text || "PIXEL-WARFRONT"));
  }

  function seedHex(seed) {
    return (seed >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function deriveSeed(baseSeed, level, lane) {
    return mix32((baseSeed >>> 0) ^ Math.imul(level >>> 0, 0x9e3779b1) ^ Math.imul((lane || 0) >>> 0, 0x85ebca6b));
  }

  function nextRandom(rng) {
    let value = rng.value >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    rng.value = value >>> 0;
    return rng.value;
  }

  function randomRange(rng, low, highExclusive) {
    return low + nextRandom(rng) % Math.max(1, highExclusive - low);
  }

  function difficultyFor(levelInput) {
    const level = Math.max(1, Math.floor(Number(levelInput) || 1));
    return Object.freeze({
      rank: level,
      enemyHealthPercent: 100 + (level - 1) * 14,
      enemyDamagePercent: 100 + (level - 1) * 9,
      enemyIncomePerTick: 2 + Math.floor((level - 1) / 2),
      waveGap: Math.max(180, 420 - (level - 1) * 14),
      trainGap: Math.max(58, 154 - (level - 1) * 4),
      startingForce: 3 + Math.floor((level - 1) / 2),
      tankUnlock: level >= 2,
    });
  }

  function makeMissionBlueprint(seedInput, levelInput) {
    const seed = normalizeSeed(seedInput);
    const level = Math.max(1, Math.floor(Number(levelInput) || 1));
    const levelSeed = deriveSeed(seed, level, 1);
    const rng = { value: levelSeed || 0x6d2b79f5 };
    const biomeIndex = randomRange(rng, 0, BIOMES.length);
    const terrain = [];
    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let column = 0; column < GRID_COLUMNS; column += 1) {
        const edge = row < 2 || row > GRID_ROWS - 3 || column < 2 || column > GRID_COLUMNS - 3;
        const roll = randomRange(rng, 0, 100);
        terrain.push(edge ? 2 + (roll % 2) : roll < 58 ? 0 : roll < 82 ? 1 : roll < 95 ? 2 : 3);
      }
    }

    const resourceAnchors = [
      [245, 145], [258, 452], [430, 250], [520, 370], [708, 142], [700, 462],
    ];
    const resources = resourceAnchors.map((anchor, index) => Object.freeze({
      x: clamp(anchor[0] + randomRange(rng, -34, 35), 90, WIDTH - 90),
      y: clamp(anchor[1] + randomRange(rng, -30, 31), 80, HEIGHT - 80),
      amount: 720 + level * 70 + randomRange(rng, 0, 440),
      phase: randomRange(rng, 0, 1024),
      cluster: index,
    }));
    const difficulty = difficultyFor(level);
    const signatureSource = JSON.stringify([
      ENGINE_VERSION, seed, level, levelSeed, biomeIndex, terrain, resources,
      difficulty.enemyHealthPercent, difficulty.enemyDamagePercent,
      difficulty.waveGap, difficulty.trainGap,
    ]);
    return Object.freeze({
      seed,
      level,
      levelSeed,
      biomeIndex,
      biome: BIOMES[biomeIndex],
      terrain: Object.freeze(terrain),
      resources: Object.freeze(resources),
      difficulty,
      signature: seedHex(fnv1a(signatureSource)),
    });
  }

  function nextId(state) {
    const id = state.nextEntityId;
    state.nextEntityId += 1;
    return id;
  }

  function scaledHealth(base, team, difficulty) {
    return team === ENEMY
      ? Math.max(1, Math.floor((base * difficulty.enemyHealthPercent + 99) / 100))
      : base;
  }

  function addBuilding(state, team, kind, xPixels, yPixels, construction) {
    const type = BUILDING_TYPES[kind];
    const maxHealth = scaledHealth(type.health, team, state.blueprint.difficulty);
    const remaining = construction == null ? 0 : Math.max(0, Math.floor(construction));
    const building = {
      id: nextId(state),
      team,
      kind,
      x: Math.round(xPixels * SCALE),
      y: Math.round(yPixels * SCALE),
      radius: type.radius * SCALE,
      health: remaining > 0 ? Math.max(1, Math.floor(maxHealth / 5)) : maxHealth,
      maxHealth,
      construction: remaining,
      constructionTotal: remaining,
      cooldown: 0,
      queue: [],
      dead: false,
    };
    state.buildings.push(building);
    return building;
  }

  function addUnit(state, team, kind, xPixels, yPixels) {
    const type = UNIT_TYPES[kind];
    const maxHealth = scaledHealth(type.health, team, state.blueprint.difficulty);
    const unit = {
      id: nextId(state),
      team,
      kind,
      x: Math.round(xPixels * SCALE),
      y: Math.round(yPixels * SCALE),
      radius: type.radius * SCALE,
      health: maxHealth,
      maxHealth,
      cooldown: 0,
      order: "idle",
      targetX: Math.round(xPixels * SCALE),
      targetY: Math.round(yPixels * SCALE),
      targetId: 0,
      resourceId: 0,
      carry: 0,
      dead: false,
    };
    state.units.push(unit);
    return unit;
  }

  function setupMission(state, initial) {
    state.blueprint = makeMissionBlueprint(state.seed, state.level);
    state.levelTick = 0;
    state.missionWon = false;
    state.transitionCountdown = 0;
    state.units = [];
    state.buildings = [];
    state.resources = [];
    state.projectiles = [];
    state.enemyCredits = 650 + state.level * 170;
    state.nextEnemyTrain = 90;
    state.nextEnemyWave = state.blueprint.difficulty.waveGap;
    if (initial) state.credits = 920;

    for (const resource of state.blueprint.resources) {
      state.resources.push({
        id: nextId(state), kind: "flux", x: resource.x * SCALE, y: resource.y * SCALE,
        radius: 22 * SCALE, amount: resource.amount, maxAmount: resource.amount,
        phase: resource.phase, dead: false,
      });
    }

    const playerHq = addBuilding(state, PLAYER, "hq", 108, 300, 0);
    const enemyHq = addBuilding(state, ENEMY, "hq", 852, 300, 0);
    addBuilding(state, ENEMY, "factory", 790, 220, 0);
    addBuilding(state, ENEMY, "turret", 760, 355, 0);
    if (state.level >= 3) addBuilding(state, ENEMY, "turret", 804, 405, 0);

    const playerDrones = [addUnit(state, PLAYER, "drone", 164, 278), addUnit(state, PLAYER, "drone", 164, 322)];
    addUnit(state, PLAYER, "ranger", 202, 270);
    addUnit(state, PLAYER, "ranger", 202, 330);

    const leftResource = state.resources
      .filter((resource) => resource.x < WIDTH * SCALE / 2)
      .sort((a, b) => {
        const ad = squaredDistance(a, playerHq);
        const bd = squaredDistance(b, playerHq);
        return ad - bd || a.id - b.id;
      })[0];
    for (const drone of playerDrones) setGatherOrder(drone, leftResource);

    const enemyDrone = addUnit(state, ENEMY, "drone", 790, 300);
    const rightResource = state.resources
      .filter((resource) => resource.x > WIDTH * SCALE / 2)
      .sort((a, b) => squaredDistance(a, enemyHq) - squaredDistance(b, enemyHq) || a.id - b.id)[0];
    setGatherOrder(enemyDrone, rightResource);

    const force = state.blueprint.difficulty.startingForce;
    for (let index = 0; index < force; index += 1) {
      const kind = state.level >= 2 && index % 4 === 3 ? "tank" : "ranger";
      addUnit(state, ENEMY, kind, 748 + (index % 3) * 24, 260 + Math.floor(index / 3) * 34);
    }
    state.events.push({ type: "mission", id: state.level });
  }

  function createRun(seedInput) {
    const seed = normalizeSeed(seedInput);
    const state = {
      engineVersion: ENGINE_VERSION,
      seed,
      tick: 0,
      level: 1,
      levelTick: 0,
      nextEntityId: 1,
      blueprint: null,
      credits: 920,
      enemyCredits: 0,
      score: 0,
      missionWon: false,
      transitionCountdown: 0,
      gameOver: false,
      nextEnemyTrain: 0,
      nextEnemyWave: 0,
      units: [],
      buildings: [],
      resources: [],
      projectiles: [],
      stats: {
        unitsBuilt: 0,
        structuresBuilt: 0,
        enemyUnitsDestroyed: 0,
        enemyStructuresDestroyed: 0,
        resourcesMined: 0,
        missionsCleared: 0,
      },
      events: [],
    };
    setupMission(state, true);
    state.events = [];
    return state;
  }

  function squaredDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function isNear(a, b, extra) {
    const radius = a.radius + b.radius + (extra || 0);
    return squaredDistance(a, b) <= radius * radius;
  }

  function findEntity(state, id) {
    if (!id) return null;
    for (const unit of state.units) if (unit.id === id && !unit.dead) return unit;
    for (const building of state.buildings) if (building.id === id && !building.dead) return building;
    return null;
  }

  function findResource(state, id) {
    return state.resources.find((resource) => resource.id === id && !resource.dead && resource.amount > 0) || null;
  }

  function findTeamHq(state, team) {
    return state.buildings.find((building) => building.team === team && building.kind === "hq" && !building.dead) || null;
  }

  function findNearestDropoff(state, unit) {
    const candidates = state.buildings.filter((building) =>
      building.team === unit.team && !building.dead && building.construction <= 0 &&
      (building.kind === "hq" || building.kind === "refinery")
    );
    candidates.sort((a, b) => squaredDistance(unit, a) - squaredDistance(unit, b) || a.id - b.id);
    return candidates[0] || null;
  }

  function powerStatus(state, team) {
    let capacity = 0;
    let used = 0;
    for (const building of state.buildings) {
      if (building.dead || building.team !== team || building.construction > 0) continue;
      const power = BUILDING_TYPES[building.kind].power;
      if (power > 0) capacity += power;
      else used -= power;
    }
    return { capacity, used, powered: capacity >= used };
  }

  function supplyStatus(state, team) {
    let capacity = 0;
    let used = 0;
    for (const building of state.buildings) {
      if (building.dead || building.team !== team) continue;
      if (building.construction <= 0) capacity += BUILDING_TYPES[building.kind].supply;
      for (const queued of building.queue) used += UNIT_TYPES[queued.kind].supply;
    }
    for (const unit of state.units) {
      if (!unit.dead && unit.team === team) used += UNIT_TYPES[unit.kind].supply;
    }
    return { capacity, used };
  }

  function setMoveOrder(unit, x, y) {
    unit.order = "move";
    unit.targetX = clamp(Math.round(x), 16 * SCALE, (WIDTH - 16) * SCALE);
    unit.targetY = clamp(Math.round(y), 16 * SCALE, (HEIGHT - 16) * SCALE);
    unit.targetId = 0;
    unit.resourceId = 0;
  }

  function setAttackOrder(unit, targetId) {
    unit.order = "attack";
    unit.targetId = targetId;
    unit.resourceId = 0;
  }

  function setGatherOrder(unit, resource) {
    if (!unit || unit.kind !== "drone" || !resource) return;
    unit.order = unit.carry >= UNIT_TYPES.drone.carry ? "return" : "gather";
    unit.resourceId = resource.id;
    unit.targetId = 0;
  }

  function moveToward(entity, x, y, speed, stopRadius) {
    const dx = x - entity.x;
    const dy = y - entity.y;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    const stop = Math.max(0, stopRadius || 0);
    if (distance <= stop || distance === 0) return true;
    const travel = Math.min(speed, Math.max(0, distance - stop));
    let stepX = Math.trunc(dx * travel / distance);
    let stepY = Math.trunc(dy * travel / distance);
    if (stepX === 0 && dx !== 0) stepX = dx > 0 ? 1 : -1;
    if (stepY === 0 && dy !== 0) stepY = dy > 0 ? 1 : -1;
    entity.x = clamp(entity.x + stepX, entity.radius, WIDTH * SCALE - entity.radius);
    entity.y = clamp(entity.y + stepY, entity.radius, HEIGHT * SCALE - entity.radius);
    return false;
  }

  function enemyOf(team) {
    return team === PLAYER ? ENEMY : PLAYER;
  }

  function findNearestEnemy(state, source, maximumRange) {
    const maximumSquared = maximumRange * maximumRange;
    const candidates = [];
    for (const unit of state.units) {
      if (!unit.dead && unit.team === enemyOf(source.team)) candidates.push(unit);
    }
    for (const building of state.buildings) {
      if (!building.dead && building.team === enemyOf(source.team)) candidates.push(building);
    }
    candidates.sort((a, b) => squaredDistance(source, a) - squaredDistance(source, b) || a.id - b.id);
    return candidates.find((target) => squaredDistance(source, target) <= maximumSquared) || null;
  }

  function eventSnapshot(type, entity, extra) {
    return Object.assign({
      type,
      id: entity.id,
      entityType: Object.prototype.hasOwnProperty.call(entity, "queue") ? "building" : "unit",
      kind: entity.kind,
      team: entity.team,
      x: entity.x,
      y: entity.y,
      radius: entity.radius,
      health: Math.max(0, entity.health),
      maxHealth: entity.maxHealth,
    }, extra || {});
  }

  function fireProjectile(state, source, target, damage, projectileSpeed) {
    state.projectiles.push({
      id: nextId(state),
      team: source.team,
      sourceId: source.id,
      targetId: target.id,
      x: source.x,
      y: source.y,
      radius: (source.kind === "tank" ? 5 : 3) * SCALE,
      damage,
      speed: projectileSpeed,
      dead: false,
    });
    state.events.push(eventSnapshot("fire", source, { targetId: target.id }));
  }

  function damageEntity(state, target, damage, sourceTeam) {
    if (!target || target.dead || damage <= 0) return false;
    const applied = Math.min(target.health, Math.max(0, Math.floor(damage)));
    if (applied <= 0) return false;
    target.health -= applied;
    state.events.push(eventSnapshot("hit", target, { damage: applied, sourceTeam }));
    if (target.health > 0) return true;

    target.health = 0;
    target.dead = true;
    state.events.push(eventSnapshot("destroy", target, { sourceTeam }));
    if (sourceTeam === PLAYER && target.team === ENEMY) {
      const building = Object.prototype.hasOwnProperty.call(target, "queue");
      state.score += building ? 850 : target.kind === "tank" ? 320 : target.kind === "ranger" ? 150 : 80;
      if (building) state.stats.enemyStructuresDestroyed += 1;
      else state.stats.enemyUnitsDestroyed += 1;
    }
    if (target.kind === "hq") {
      if (target.team === ENEMY) {
        state.missionWon = true;
        state.transitionCountdown = 100;
        state.projectiles = state.projectiles.filter((projectile) => projectile.team === PLAYER);
        state.events.push({ type: "victory", id: state.level });
      } else {
        state.gameOver = true;
        state.events.push({ type: "game-over", id: state.tick });
      }
    }
    return true;
  }

  function effectiveDamage(baseDamage, team, difficulty) {
    return team === ENEMY
      ? Math.max(1, Math.floor((baseDamage * difficulty.enemyDamagePercent + 99) / 100))
      : baseDamage;
  }

  function updateCombatant(state, source, type) {
    if (source.cooldown > 0) source.cooldown -= 1;
    if (type.damage <= 0 || source.cooldown > 0) return;
    let target = source.order === "attack" ? findEntity(state, source.targetId) : null;
    if (!target) target = findNearestEnemy(state, source, type.sight * SCALE);
    if (!target) {
      if (source.order === "attack") {
        source.order = "idle";
        source.targetId = 0;
      }
      return;
    }
    const attackRadius = type.range * SCALE + target.radius;
    if (squaredDistance(source, target) <= attackRadius * attackRadius) {
      const damage = effectiveDamage(type.damage, source.team, state.blueprint.difficulty);
      fireProjectile(state, source, target, damage, type.projectileSpeed);
      source.cooldown = type.cooldown;
    } else if (source.order === "attack") {
      moveToward(source, target.x, target.y, type.speed || 0, attackRadius - 2 * SCALE);
    }
  }

  function updateDroneLogistics(state, unit, type) {
    if (unit.order === "gather") {
      const resource = findResource(state, unit.resourceId);
      if (!resource) {
        unit.order = unit.carry > 0 ? "return" : "idle";
        return;
      }
      if (unit.carry >= type.carry) {
        unit.order = "return";
        return;
      }
      if (!moveToward(unit, resource.x, resource.y, type.speed, resource.radius + unit.radius)) {
        return;
      }
      const mined = Math.min(type.harvest, type.carry - unit.carry, resource.amount);
      resource.amount -= mined;
      unit.carry += mined;
      if (resource.amount <= 0) {
        resource.amount = 0;
        resource.dead = true;
        state.events.push({ type: "resource-empty", id: resource.id });
      }
      if (unit.carry >= type.carry || resource.dead) unit.order = "return";
    } else if (unit.order === "return") {
      const dropoff = findNearestDropoff(state, unit);
      if (!dropoff) {
        unit.order = "idle";
        return;
      }
      if (!moveToward(unit, dropoff.x, dropoff.y, type.speed, dropoff.radius + unit.radius)) return;
      if (unit.team === PLAYER) {
        state.credits += unit.carry;
        state.stats.resourcesMined += unit.carry;
      } else {
        state.enemyCredits += unit.carry;
      }
      state.events.push(eventSnapshot("deposit", unit, { amount: unit.carry }));
      unit.carry = 0;
      const resource = findResource(state, unit.resourceId);
      unit.order = resource ? "gather" : "idle";
    }
  }

  function updateUnits(state) {
    for (const unit of state.units) {
      if (unit.dead || (state.missionWon && unit.team === ENEMY)) continue;
      const type = UNIT_TYPES[unit.kind];
      if (unit.kind === "drone" && (unit.order === "gather" || unit.order === "return")) {
        updateDroneLogistics(state, unit, type);
      } else if (unit.order === "move") {
        if (moveToward(unit, unit.targetX, unit.targetY, type.speed, 2 * SCALE)) unit.order = "idle";
      }
      updateCombatant(state, unit, type);
    }
  }

  function buildingPowered(state, building) {
    if (BUILDING_TYPES[building.kind].power >= 0) return true;
    return powerStatus(state, building.team).powered;
  }

  function spawnQueuedUnit(state, building, kind) {
    const direction = building.team === PLAYER ? 1 : -1;
    const x = building.x / SCALE + direction * (BUILDING_TYPES[building.kind].radius + 28);
    const y = building.y / SCALE + ((building.id * 19 + state.tick * 7) % 51) - 25;
    const unit = addUnit(state, building.team, kind, x, y);
    if (building.team === PLAYER) state.stats.unitsBuilt += 1;
    const targetHq = findTeamHq(state, enemyOf(building.team));
    if (building.team === ENEMY && targetHq && kind !== "drone") setAttackOrder(unit, targetHq.id);
    state.events.push(eventSnapshot("unit-ready", unit));
    return unit;
  }

  function updateBuildings(state) {
    for (const building of state.buildings) {
      if (building.dead || (state.missionWon && building.team === ENEMY)) continue;
      if (building.construction > 0) {
        building.construction -= 1;
        const remainingHealth = building.maxHealth - building.health;
        const gain = Math.max(1, Math.ceil(remainingHealth / Math.max(1, building.construction + 1)));
        building.health = Math.min(building.maxHealth, building.health + gain);
        if (building.construction === 0) {
          building.health = building.maxHealth;
          state.events.push(eventSnapshot("construction-complete", building));
        }
        continue;
      }

      if (building.cooldown > 0) building.cooldown -= 1;
      if (building.queue.length && buildingPowered(state, building)) {
        building.queue[0].remaining -= 1;
        if (building.queue[0].remaining <= 0) {
          const finished = building.queue.shift();
          spawnQueuedUnit(state, building, finished.kind);
        }
      }

      const type = BUILDING_TYPES[building.kind];
      if (type.damage > 0 && building.cooldown <= 0 && buildingPowered(state, building)) {
        const target = findNearestEnemy(state, building, type.range * SCALE);
        if (target) {
          const damage = effectiveDamage(type.damage, building.team, state.blueprint.difficulty);
          fireProjectile(state, building, target, damage, 220);
          building.cooldown = type.cooldown;
        }
      }
    }
  }

  function updateProjectiles(state) {
    for (const projectile of state.projectiles) {
      if (projectile.dead) continue;
      const target = findEntity(state, projectile.targetId);
      if (!target) {
        projectile.dead = true;
        continue;
      }
      const stopRadius = target.radius + projectile.radius;
      if (moveToward(projectile, target.x, target.y, projectile.speed, stopRadius)) {
        projectile.dead = true;
        damageEntity(state, target, projectile.damage, projectile.team);
      }
    }
  }

  function cleanIds(idsInput) {
    if (!Array.isArray(idsInput)) return [];
    const unique = new Set();
    for (const value of idsInput) {
      const id = Number(value);
      if (Number.isInteger(id) && id > 0 && id <= 0x7fffffff) unique.add(id);
      if (unique.size >= 128) break;
    }
    return Array.from(unique).sort((a, b) => a - b);
  }

  function sanitizeCommand(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const type = String(input.t || "");
    if (type === "move") {
      const ids = cleanIds(input.ids);
      if (!ids.length || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return null;
      return { t: type, ids, x: clamp(Math.round(input.x), 0, WIDTH), y: clamp(Math.round(input.y), 0, HEIGHT) };
    }
    if (type === "attack" || type === "gather") {
      const ids = cleanIds(input.ids);
      const target = Number(input.target);
      if (!ids.length || !Number.isInteger(target) || target <= 0 || target > 0x7fffffff) return null;
      return { t: type, ids, target };
    }
    if (type === "stop") {
      const ids = cleanIds(input.ids);
      return ids.length ? { t: type, ids } : null;
    }
    if (type === "build") {
      const ids = cleanIds(input.ids);
      const kind = String(input.kind || "");
      if (!ids.length || !BUILDABLE.includes(kind) || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return null;
      return { t: type, ids, kind, x: clamp(Math.round(input.x), 0, WIDTH), y: clamp(Math.round(input.y), 0, HEIGHT) };
    }
    if (type === "train") {
      const kind = String(input.kind || "");
      return TRAINABLE.includes(kind) ? { t: type, kind } : null;
    }
    return null;
  }

  function sanitizeCommands(commandsInput) {
    if (!Array.isArray(commandsInput)) return [];
    const commands = [];
    for (const input of commandsInput) {
      const command = sanitizeCommand(input);
      if (command) commands.push(command);
      if (commands.length >= MAX_COMMANDS_PER_TICK) break;
    }
    return commands;
  }

  function selectedPlayerUnits(state, ids) {
    const wanted = new Set(ids);
    return state.units.filter((unit) => !unit.dead && unit.team === PLAYER && wanted.has(unit.id));
  }

  function applyMoveCommand(state, command) {
    const units = selectedPlayerUnits(state, command.ids);
    for (let index = 0; index < units.length; index += 1) {
      const offset = FORMATION_OFFSETS[index % FORMATION_OFFSETS.length];
      setMoveOrder(units[index], (command.x + offset[0]) * SCALE, (command.y + offset[1]) * SCALE);
    }
  }

  function applyTargetCommand(state, command) {
    const units = selectedPlayerUnits(state, command.ids);
    if (command.t === "attack") {
      const target = findEntity(state, command.target);
      if (!target || target.team !== ENEMY) return;
      for (const unit of units) setAttackOrder(unit, target.id);
    } else {
      const resource = findResource(state, command.target);
      if (!resource) return;
      for (const unit of units) setGatherOrder(unit, resource);
    }
  }

  function buildPlacementValid(state, x, y, radius, builders) {
    if (x < 55 * SCALE || x > (WIDTH - 55) * SCALE || y < 55 * SCALE || y > (HEIGHT - 55) * SCALE) return false;
    const nearBuilder = builders.some((builder) => {
      const dx = builder.x - x;
      const dy = builder.y - y;
      const range = 310 * SCALE;
      return dx * dx + dy * dy <= range * range;
    });
    if (!nearBuilder) return false;
    for (const building of state.buildings) {
      if (building.dead) continue;
      const distance = radius + building.radius + 12 * SCALE;
      const dx = building.x - x;
      const dy = building.y - y;
      if (dx * dx + dy * dy < distance * distance) return false;
    }
    for (const resource of state.resources) {
      if (resource.dead) continue;
      const distance = radius + resource.radius + 10 * SCALE;
      const dx = resource.x - x;
      const dy = resource.y - y;
      if (dx * dx + dy * dy < distance * distance) return false;
    }
    return true;
  }

  function applyBuildCommand(state, command) {
    const builders = selectedPlayerUnits(state, command.ids).filter((unit) => unit.kind === "drone");
    if (!builders.length) return;
    const type = BUILDING_TYPES[command.kind];
    if (state.credits < type.cost) return;
    const x = command.x * SCALE;
    const y = command.y * SCALE;
    if (!buildPlacementValid(state, x, y, type.radius * SCALE, builders)) return;
    state.credits -= type.cost;
    const building = addBuilding(state, PLAYER, command.kind, command.x, command.y, type.buildTicks);
    state.stats.structuresBuilt += 1;
    state.events.push(eventSnapshot("construction-start", building));
    for (let index = 0; index < builders.length; index += 1) {
      const offset = FORMATION_OFFSETS[index % FORMATION_OFFSETS.length];
      setMoveOrder(builders[index], x + offset[0] * SCALE, y + offset[1] * SCALE);
    }
  }

  function producerFor(state, team, kind) {
    const candidates = state.buildings.filter((building) => {
      if (building.dead || building.team !== team || building.construction > 0) return false;
      if (kind === "drone") return building.kind === "hq";
      if (kind === "ranger") return building.kind === "hq" || building.kind === "factory";
      return kind === "tank" && building.kind === "factory";
    });
    candidates.sort((a, b) => a.queue.length - b.queue.length || a.id - b.id);
    return candidates[0] || null;
  }

  function applyTrainCommand(state, command) {
    const type = UNIT_TYPES[command.kind];
    const producer = producerFor(state, PLAYER, command.kind);
    if (!producer || state.credits < type.cost || producer.queue.length >= 5) return;
    const supply = supplyStatus(state, PLAYER);
    if (supply.used + type.supply > supply.capacity) return;
    state.credits -= type.cost;
    producer.queue.push({ kind: command.kind, remaining: type.trainTicks });
    state.events.push({ type: "queue", id: producer.id, kind: command.kind });
  }

  function applyCommands(state, commandsInput) {
    const commands = sanitizeCommands(commandsInput);
    for (const command of commands) {
      if (command.t === "move") applyMoveCommand(state, command);
      else if (command.t === "attack" || command.t === "gather") applyTargetCommand(state, command);
      else if (command.t === "stop") {
        for (const unit of selectedPlayerUnits(state, command.ids)) {
          unit.order = "idle";
          unit.targetId = 0;
          unit.resourceId = 0;
        }
      } else if (command.t === "build") applyBuildCommand(state, command);
      else if (command.t === "train") applyTrainCommand(state, command);
    }
    return commands;
  }

  function updateEnemyAi(state) {
    if (state.missionWon || state.gameOver) return;
    const difficulty = state.blueprint.difficulty;
    state.enemyCredits += difficulty.enemyIncomePerTick;
    if (state.levelTick >= state.nextEnemyTrain) {
      const roll = deriveSeed(state.seed, state.level, Math.floor(state.levelTick / difficulty.trainGap));
      const kind = difficulty.tankUnlock && roll % 4 === 0 ? "tank" : "ranger";
      const type = UNIT_TYPES[kind];
      const hq = findTeamHq(state, ENEMY);
      if (hq && state.enemyCredits >= type.cost) {
        state.enemyCredits -= type.cost;
        const unit = addUnit(state, ENEMY, kind, hq.x / SCALE - 58, hq.y / SCALE + ((roll >>> 8) % 91) - 45);
        const playerHq = findTeamHq(state, PLAYER);
        if (playerHq) setAttackOrder(unit, playerHq.id);
        state.events.push(eventSnapshot("enemy-reinforcement", unit));
      }
      state.nextEnemyTrain += difficulty.trainGap;
    }
    if (state.levelTick >= state.nextEnemyWave) {
      const playerHq = findTeamHq(state, PLAYER);
      if (playerHq) {
        for (const unit of state.units) {
          if (!unit.dead && unit.team === ENEMY && unit.kind !== "drone") setAttackOrder(unit, playerHq.id);
        }
      }
      state.events.push({ type: "wave", id: state.levelTick });
      state.nextEnemyWave += difficulty.waveGap;
    }
  }

  function cleanup(state) {
    state.units = state.units.filter((unit) => !unit.dead);
    state.buildings = state.buildings.filter((building) => !building.dead);
    state.resources = state.resources.filter((resource) => !resource.dead || resource.amount === 0);
    state.projectiles = state.projectiles.filter((projectile) => !projectile.dead);
    if (state.projectiles.length > 500) state.projectiles.splice(0, state.projectiles.length - 500);
  }

  function beginNextMission(state) {
    state.stats.missionsCleared += 1;
    state.score += state.level * 5000 + state.credits;
    state.level += 1;
    state.credits = Math.min(3200, state.credits + 650 + state.level * 90);
    setupMission(state, false);
  }

  function step(state, commandsInput) {
    state.events = [];
    if (state.gameOver) return state;
    state.tick += 1;
    state.levelTick += 1;
    applyCommands(state, commandsInput);
    updateEnemyAi(state);
    updateBuildings(state);
    updateUnits(state);
    updateProjectiles(state);
    cleanup(state);
    if (state.missionWon) {
      state.transitionCountdown -= 1;
      if (state.transitionCountdown <= 0) beginNextMission(state);
    }
    return state;
  }

  function createRecorder(seedInput) {
    return { version: ENGINE_VERSION, seed: normalizeSeed(seedInput), ticks: 0, entries: [] };
  }

  function recordCommands(recorder, commandsInput) {
    if (!recorder || recorder.version !== ENGINE_VERSION || !Array.isArray(recorder.entries)) {
      throw new Error("Invalid replay recorder");
    }
    if (recorder.ticks >= MAX_REPLAY_TICKS) throw new Error("Replay exceeds the six-hour limit");
    const commands = sanitizeCommands(commandsInput);
    if (commands.length) recorder.entries.push([recorder.ticks, commands]);
    recorder.ticks += 1;
    return recorder;
  }

  function tryRecordCommands(recorder, commandsInput) {
    if (!recorder || recorder.version !== ENGINE_VERSION || !Array.isArray(recorder.entries)) {
      throw new Error("Invalid replay recorder");
    }
    if (recorder.ticks >= MAX_REPLAY_TICKS) return false;
    recordCommands(recorder, commandsInput);
    return true;
  }

  function encodeBase64Ascii(text) {
    let output = "";
    for (let index = 0; index < text.length; index += 3) {
      const a = text.charCodeAt(index);
      const hasB = index + 1 < text.length;
      const hasC = index + 2 < text.length;
      const b = hasB ? text.charCodeAt(index + 1) : 0;
      const c = hasC ? text.charCodeAt(index + 2) : 0;
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
    for (let index = 0; index < encoded.length; index += 4) {
      const a = BASE64.indexOf(encoded[index]);
      const b = BASE64.indexOf(encoded[index + 1]);
      const c = encoded[index + 2] === "=" ? 0 : BASE64.indexOf(encoded[index + 2]);
      const d = encoded[index + 3] === "=" ? 0 : BASE64.indexOf(encoded[index + 3]);
      output += String.fromCharCode((a << 2) | (b >>> 4));
      if (encoded[index + 2] !== "=") output += String.fromCharCode(((b & 15) << 4) | (c >>> 2));
      if (encoded[index + 3] !== "=") output += String.fromCharCode(((c & 3) << 6) | d);
    }
    return output;
  }

  function encodeReplay(recorder) {
    if (!recorder || recorder.version !== ENGINE_VERSION || !Array.isArray(recorder.entries)) {
      throw new Error("Invalid replay recorder");
    }
    const payload = JSON.stringify([ENGINE_VERSION, recorder.seed >>> 0, recorder.ticks, recorder.entries]);
    const checksum = seedHex(fnv1a(payload));
    const encoded = encodeBase64Ascii(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return `${REPLAY_PREFIX}.${checksum}.${encoded}`;
  }

  function decodeReplay(codeInput) {
    const code = String(codeInput || "").trim();
    if (code.length > 16_000_000) throw new Error("Replay code is too large");
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
    const entries = parsed[3];
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
        !Number.isInteger(ticks) || ticks < 0 || ticks > MAX_REPLAY_TICKS ||
        !Array.isArray(entries) || entries.length > ticks) {
      throw new Error("Replay metadata is invalid");
    }
    const cleanEntries = [];
    let previousTick = -1;
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) ||
          entry[0] <= previousTick || entry[0] < 0 || entry[0] >= ticks || !Array.isArray(entry[1]) ||
          entry[1].length < 1 || entry[1].length > MAX_COMMANDS_PER_TICK) {
        throw new Error("Replay command entry is invalid");
      }
      const commands = sanitizeCommands(entry[1]);
      if (commands.length !== entry[1].length || JSON.stringify(commands) !== JSON.stringify(entry[1])) {
        throw new Error("Replay command is invalid");
      }
      cleanEntries.push(Object.freeze([entry[0], Object.freeze(commands)]));
      previousTick = entry[0];
    }
    return Object.freeze({
      version: ENGINE_VERSION,
      seed: seed >>> 0,
      ticks,
      entries: Object.freeze(cleanEntries),
    });
  }

  function createReplayCursor(replay) {
    return { replay, tick: 0, entryIndex: 0 };
  }

  function nextReplayCommands(cursor) {
    if (!cursor || cursor.tick >= cursor.replay.ticks) return null;
    let commands = [];
    const entry = cursor.replay.entries[cursor.entryIndex];
    if (entry && entry[0] === cursor.tick) {
      commands = entry[1];
      cursor.entryIndex += 1;
    }
    cursor.tick += 1;
    return commands;
  }

  function stateDigest(state) {
    const compact = {
      version: state.engineVersion,
      seed: state.seed,
      tick: state.tick,
      level: state.level,
      levelTick: state.levelTick,
      blueprint: state.blueprint.signature,
      nextEntityId: state.nextEntityId,
      credits: state.credits,
      enemyCredits: state.enemyCredits,
      score: state.score,
      missionWon: state.missionWon,
      transitionCountdown: state.transitionCountdown,
      gameOver: state.gameOver,
      nextEnemyTrain: state.nextEnemyTrain,
      nextEnemyWave: state.nextEnemyWave,
      units: state.units,
      buildings: state.buildings,
      resources: state.resources,
      projectiles: state.projectiles,
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
    MAX_COMMANDS_PER_TICK,
    PLAYER,
    ENEMY,
    GRID_COLUMNS,
    GRID_ROWS,
    CELL_SIZE,
    BIOMES,
    UNIT_TYPES,
    BUILDING_TYPES,
    normalizeSeed,
    seedHex,
    deriveSeed,
    difficultyFor,
    makeMissionBlueprint,
    createRun,
    step,
    powerStatus,
    supplyStatus,
    sanitizeCommands,
    createRecorder,
    recordCommands,
    tryRecordCommands,
    encodeReplay,
    decodeReplay,
    createReplayCursor,
    nextReplayCommands,
    stateDigest,
  });
});
