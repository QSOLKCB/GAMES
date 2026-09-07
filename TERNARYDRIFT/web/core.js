(function installTernaryDriftCore(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TernaryDriftWebCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  const VERSION = 1;
  const TICK_HZ = 60;
  const FP = 1024;
  const WORLD_X = 1100 * FP;
  const WORLD_Y = 800 * FP;
  const INPUT = Object.freeze({
    THRUST: 1 << 0, REVERSE: 1 << 1, TURN_LEFT: 1 << 2, TURN_RIGHT: 1 << 3,
    STRAFE_LEFT: 1 << 4, STRAFE_RIGHT: 1 << 5, FIRE: 1 << 6, INTERACT: 1 << 7,
    CRUISE: 1 << 8, ENGINE_KILL: 1 << 9, JUMP: 1 << 10, SELECT_PREV: 1 << 11,
    SELECT_NEXT: 1 << 12, BUY: 1 << 13, SELL: 1 << 14, LAUNCH: 1 << 15,
    MISSION: 1 << 16, UPGRADE: 1 << 17, REPAIR: 1 << 18,
  });
  const ACTION_MASK = 0x7ffff;
  const COMMODITIES = Object.freeze(["RATIONS", "ORE", "FUEL", "MEDICINE"]);
  const BASE_PRICES = Object.freeze([18, 42, 55, 88]);
  const FACTIONS = Object.freeze(["MERIDIAN", "HELIX", "ORISON", "ASHWAKE", "PILGRIM"]);
  const EVENTS = Object.freeze({
    DOCKED: "docked", LAUNCHED: "launched", TRADE: "trade", NO_CREDITS: "no-credits",
    CARGO_FULL: "cargo-full", MISSION_ACCEPTED: "mission-accepted", MISSION_COMPLETED: "mission-completed",
    UPGRADED: "upgraded", REPAIRED: "repaired", SALVAGED: "salvaged", JUMPED: "jumped",
    ENEMY_DESTROYED: "enemy-destroyed", PLAYER_DESTROYED: "player-destroyed", SHOT: "shot", HIT: "hit",
  });
  const DIRECTIONS = Object.freeze([
    [1024, 0], [1004, 200], [946, 392], [851, 569], [724, 724], [569, 851], [392, 946], [200, 1004],
    [0, 1024], [-200, 1004], [-392, 946], [-569, 851], [-724, 724], [-851, 569], [-946, 392], [-1004, 200],
    [-1024, 0], [-1004, -200], [-946, -392], [-851, -569], [-724, -724], [-569, -851], [-392, -946], [-200, -1004],
    [0, -1024], [200, -1004], [392, -946], [569, -851], [724, -724], [851, -569], [946, -392], [1004, -200],
  ].map(Object.freeze));

  function clamp(value, low, high) { return value < low ? low : value > high ? high : value; }

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
    return (mixed ^ (mixed >>> 16)) >>> 0 || 0x6d2b79f5;
  }

  function normalizeSeed(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value >>> 0 || 0x6d2b79f5;
    const text = String(value == null ? "" : value).trim();
    if (/^0x[0-9a-f]{1,8}$/i.test(text)) return parseInt(text.slice(2), 16) >>> 0 || 0x6d2b79f5;
    return mix32(fnv1a(text || "TERNARY-DRIFT-WEB"));
  }

  function seedHex(seed) { return (seed >>> 0).toString(16).toUpperCase().padStart(8, "0"); }
  function nextRandom(state) {
    let value = state.rng >>> 0;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    state.rng = value >>> 0 || 0x6d2b79f5;
    return state.rng;
  }
  function randomRange(state, low, high) { return low + nextRandom(state) % (high - low + 1); }
  function distanceSquared(a, b) {
    const dx = Math.trunc((a.x - b.x) / FP);
    const dy = Math.trunc((a.y - b.y) / FP);
    return dx * dx + dy * dy;
  }
  function cargoUsed(player) { return player.cargo.reduce((sum, value) => sum + value, 0); }

  function systemName(seed, index) {
    const first = ["VEL", "OR", "KAI", "MER", "SEN", "TAR", "HEL", "AR"];
    const second = ["ION", "AX", "UNE", "IS", "ARA", "OS", "ETH", "UM"];
    const value = mix32(seed ^ Math.imul(index + 1, 0x9e3779b1));
    return `${first[value & 7]}${second[(value >>> 7) & 7]}`;
  }

  function makeSystem(seed, index) {
    const value = mix32(seed ^ Math.imul(index + 11, 0x85ebca6b));
    const station = { x: (-460 + ((value >>> 3) % 460)) * FP, y: (-220 + ((value >>> 12) % 440)) * FP };
    const gate = { x: (620 + ((value >>> 19) % 181)) * FP, y: (-250 + ((value >>> 23) % 501)) * FP };
    const inventory = BASE_PRICES.map((_, lane) => 12 + ((value >>> (lane * 5)) & 15));
    const target = BASE_PRICES.map((_, lane) => 18 + ((value >>> (lane * 4 + 2)) & 15));
    const production = BASE_PRICES.map((_, lane) => ((value >>> (lane * 3 + 1)) % 5) - 2);
    return {
      name: systemName(seed, index), identity: value >>> 0, station, gate,
      market: { inventory, target, production, security: 25 + value % 70, faction: value % FACTIONS.length },
      music: { root: 35 + value % 18, tempo: 82 + (value >>> 5) % 50, groove: (value >>> 11) % 3 },
    };
  }

  function createGame(seedInput) {
    const seed = normalizeSeed(seedInput);
    const systems = [0, 1, 2].map((index) => makeSystem(seed, index));
    const player = {
      x: systems[0].station.x + 90 * FP, y: systems[0].station.y, vx: 0, vy: 0, heading: 0,
      system: 0, docked: true, engineKill: false, hull: 100, hullMax: 100, shield: 60, shieldMax: 60,
      energy: 100, energyMax: 100, heat: 0, fireCooldown: 0, credits: 750, cargo: [0, 0, 0, 0],
      cargoCapacity: 12, engineLevel: 0, weaponLevel: 0, shieldLevel: 0, reputation: [0, 0, 0, 0, 0],
    };
    const state = {
      version: VERSION, seed, rng: mix32(seed ^ 0xa5a5f00d), tick: 0, systems, player,
      enemies: [], projectiles: [], salvage: [], mission: null, selectedCommodity: 0, upgradeCursor: 0,
      previousInput: 0, nextId: 1, score: 0, marketTicks: 0, respawnTicks: 0,
      qutrits: { navigation: 0, threat: 0, economy: 0, faction: 0, hull: 0 }, events: [],
    };
    spawnEnemy(state);
    return state;
  }

  function marketPrice(state, systemIndex, commodity, buying) {
    const market = state.systems[systemIndex].market;
    const scarcity = market.target[commodity] - market.inventory[commodity];
    const reputation = state.player.reputation[market.faction];
    const base = BASE_PRICES[commodity] + Math.trunc(scarcity * BASE_PRICES[commodity] / 28);
    const margin = buying ? 6 : -5;
    return clamp(base + margin - Math.trunc(reputation / 180), 4, 240);
  }

  function spawnEnemy(state) {
    if (state.enemies.length >= 3 || state.player.docked) return;
    const lane = nextRandom(state) & 31;
    const direction = DIRECTIONS[lane];
    const distance = randomRange(state, 380, 620) * FP;
    state.enemies.push({
      id: state.nextId++, kind: state.tick > 4800 ? "corsair" : state.tick > 1800 ? "raider" : "skiff",
      x: clamp(state.player.x + Math.trunc(direction[0] * distance / 1024), -WORLD_X, WORLD_X),
      y: clamp(state.player.y + Math.trunc(direction[1] * distance / 1024), -WORLD_Y, WORLD_Y),
      vx: 0, vy: 0, heading: (lane + 16) & 31, hull: state.tick > 4800 ? 82 : state.tick > 1800 ? 58 : 38,
      maxHull: state.tick > 4800 ? 82 : state.tick > 1800 ? 58 : 38, shield: 22, cooldown: 45 + nextRandom(state) % 70,
      phase: nextRandom(state),
    });
  }

  function accelerate(body, heading, magnitude) {
    const direction = DIRECTIONS[heading & 31];
    body.vx += Math.trunc(direction[0] * magnitude / 1024);
    body.vy += Math.trunc(direction[1] * magnitude / 1024);
  }

  function clampVelocity(body, maximum) {
    const speed = Math.max(1, Math.hypot(body.vx, body.vy));
    if (speed <= maximum) return;
    body.vx = Math.trunc(body.vx * maximum / speed);
    body.vy = Math.trunc(body.vy * maximum / speed);
  }

  function closestDirection(dx, dy) {
    let best = 0;
    let score = -Infinity;
    for (let index = 0; index < DIRECTIONS.length; index += 1) {
      const value = dx * DIRECTIONS[index][0] + dy * DIRECTIONS[index][1];
      if (value > score) { score = value; best = index; }
    }
    return best;
  }

  function spawnProjectile(state, owner, source, heading, damage) {
    const direction = DIRECTIONS[heading & 31];
    const hostile = owner !== "player";
    state.projectiles.push({
      id: state.nextId++, owner, hostile, x: source.x, y: source.y,
      vx: Math.trunc((source.vx || 0) / 3) + direction[0] * (hostile ? 7 : 10),
      vy: Math.trunc((source.vy || 0) / 3) + direction[1] * (hostile ? 7 : 10),
      damage, life: hostile ? 100 : 82,
    });
  }

  function applyDamage(target, amount) {
    const absorbed = Math.min(target.shield || 0, amount);
    target.shield = Math.max(0, (target.shield || 0) - amount);
    target.hull = Math.max(0, target.hull - (amount - absorbed));
  }

  function dockOrCollect(state) {
    const player = state.player;
    for (const item of state.salvage) {
      if (!item.active || distanceSquared(player, item) > 42 * 42 || cargoUsed(player) >= player.cargoCapacity) continue;
      const room = player.cargoCapacity - cargoUsed(player);
      const taken = Math.min(room, item.quantity);
      player.cargo[item.commodity] += taken;
      item.quantity -= taken;
      item.active = item.quantity > 0;
      state.events.push({ type: EVENTS.SALVAGED, commodity: item.commodity, quantity: taken });
    }
    state.salvage = state.salvage.filter((item) => item.active);
    const station = state.systems[player.system].station;
    if (distanceSquared(player, station) <= 58 * 58) {
      player.docked = true; player.vx = 0; player.vy = 0;
      state.events.push({ type: EVENTS.DOCKED });
      completeMission(state);
    }
  }

  function acceptMission(state) {
    if (state.mission) return;
    const destination = (state.player.system + 1 + (nextRandom(state) & 1)) % state.systems.length;
    const commodity = state.selectedCommodity;
    state.mission = { type: "delivery", origin: state.player.system, destination, commodity, quantity: 2, reward: 380 + nextRandom(state) % 420, expiry: state.tick + 60 * 60 * 8 };
    state.events.push({ type: EVENTS.MISSION_ACCEPTED, destination, commodity });
  }

  function completeMission(state) {
    const mission = state.mission;
    if (!mission || state.player.system !== mission.destination || state.player.cargo[mission.commodity] < mission.quantity) return;
    state.player.cargo[mission.commodity] -= mission.quantity;
    state.player.credits += mission.reward;
    state.score += mission.reward * 2;
    state.player.reputation[state.systems[state.player.system].market.faction] += 65;
    state.mission = null;
    state.events.push({ type: EVENTS.MISSION_COMPLETED, reward: mission.reward });
  }

  function stepDocked(state, pressed) {
    const player = state.player;
    const market = state.systems[player.system].market;
    if (pressed & INPUT.SELECT_PREV) state.selectedCommodity = (state.selectedCommodity + COMMODITIES.length - 1) % COMMODITIES.length;
    if (pressed & INPUT.SELECT_NEXT) state.selectedCommodity = (state.selectedCommodity + 1) % COMMODITIES.length;
    if (pressed & INPUT.BUY) {
      const commodity = state.selectedCommodity;
      const price = marketPrice(state, player.system, commodity, true);
      if (cargoUsed(player) >= player.cargoCapacity) state.events.push({ type: EVENTS.CARGO_FULL });
      else if (player.credits < price || market.inventory[commodity] <= 0) state.events.push({ type: EVENTS.NO_CREDITS });
      else {
        player.credits -= price; player.cargo[commodity] += 1; market.inventory[commodity] -= 1;
        state.events.push({ type: EVENTS.TRADE, side: "buy", commodity, price });
      }
    }
    if (pressed & INPUT.SELL) {
      const commodity = state.selectedCommodity;
      if (player.cargo[commodity] > 0) {
        const price = marketPrice(state, player.system, commodity, false);
        player.cargo[commodity] -= 1; player.credits += price; market.inventory[commodity] += 1;
        state.events.push({ type: EVENTS.TRADE, side: "sell", commodity, price });
      }
    }
    if (pressed & INPUT.MISSION) acceptMission(state);
    if (pressed & INPUT.UPGRADE) {
      const levels = ["engineLevel", "weaponLevel", "shieldLevel"];
      const key = levels[state.upgradeCursor];
      const cost = 450 + player[key] * 600;
      if (player.credits >= cost && player[key] < 3) {
        player.credits -= cost; player[key] += 1;
        if (key === "shieldLevel") { player.shieldMax += 20; player.shield = player.shieldMax; }
        else if (key === "engineLevel") player.cargoCapacity += 2;
        state.events.push({ type: EVENTS.UPGRADED, system: key });
      }
      state.upgradeCursor = (state.upgradeCursor + 1) % 3;
    }
    if (pressed & INPUT.REPAIR) {
      const missing = player.hullMax - player.hull;
      const cost = missing * 3;
      if (missing > 0 && player.credits >= cost) {
        player.credits -= cost; player.hull = player.hullMax; player.shield = player.shieldMax;
        state.events.push({ type: EVENTS.REPAIRED, cost });
      }
    }
    if (pressed & INPUT.LAUNCH) {
      player.docked = false;
      const station = state.systems[player.system].station;
      player.x = station.x + 72 * FP; player.y = station.y; player.vx = 0; player.vy = 0;
      state.events.push({ type: EVENTS.LAUNCHED });
      spawnEnemy(state);
    }
  }

  function stepPlayer(state, input, pressed) {
    const player = state.player;
    if (pressed & INPUT.ENGINE_KILL) player.engineKill = !player.engineKill;
    if (input & INPUT.TURN_LEFT) player.heading = (player.heading + 31) & 31;
    if (input & INPUT.TURN_RIGHT) player.heading = (player.heading + 1) & 31;
    // Velocities share the same 10-bit fixed-point scale as positions. These
    // values preserve the native game's smooth acceleration while keeping the
    // browser edition's larger system map practical to cross.
    const thrust = 72 + player.engineLevel * 18;
    if (input & INPUT.THRUST) accelerate(player, player.heading, thrust);
    if (input & INPUT.REVERSE) accelerate(player, player.heading + 16, Math.trunc(thrust / 2));
    if (input & INPUT.STRAFE_LEFT) accelerate(player, player.heading + 24, Math.trunc(thrust / 2));
    if (input & INPUT.STRAFE_RIGHT) accelerate(player, player.heading + 8, Math.trunc(thrust / 2));
    if (!player.engineKill) { player.vx = Math.trunc(player.vx * 1016 / 1024); player.vy = Math.trunc(player.vy * 1016 / 1024); }
    clampVelocity(player, 2550 + player.engineLevel * 460);
    player.x = clamp(player.x + player.vx, -WORLD_X, WORLD_X);
    player.y = clamp(player.y + player.vy, -WORLD_Y, WORLD_Y);
    if (player.fireCooldown > 0) player.fireCooldown -= 1;
    if (player.energy < player.energyMax && (state.tick & 1) === 0) player.energy += 1;
    if ((input & INPUT.FIRE) && player.fireCooldown <= 0 && player.energy >= 5) {
      spawnProjectile(state, "player", player, player.heading, 12 + player.weaponLevel * 5);
      player.energy -= 5; player.fireCooldown = Math.max(5, 11 - player.weaponLevel * 2);
      state.events.push({ type: EVENTS.SHOT, owner: "player" });
    }
    if (pressed & INPUT.INTERACT) dockOrCollect(state);
    if (pressed & INPUT.JUMP) {
      const gate = state.systems[player.system].gate;
      if (distanceSquared(player, gate) <= 72 * 72) {
        player.system = (player.system + 1) % state.systems.length;
        const destination = state.systems[player.system].gate;
        player.x = destination.x - 95 * FP; player.y = destination.y; player.vx = 0; player.vy = 0;
        state.enemies.length = 0; state.projectiles.length = 0;
        state.events.push({ type: EVENTS.JUMPED, system: player.system });
        completeMission(state); spawnEnemy(state);
      }
    }
  }

  function stepEnemies(state) {
    const player = state.player;
    for (const enemy of state.enemies) {
      if (enemy.cooldown > 0) enemy.cooldown -= 1;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.sqrt(distanceSquared(player, enemy));
      const desired = closestDirection(dx, dy);
      let turn = (desired - enemy.heading + 32) & 31;
      if (turn > 16) enemy.heading = (enemy.heading + 31) & 31;
      else if (turn > 0) enemy.heading = (enemy.heading + 1) & 31;
      if (distance > 190) accelerate(enemy, enemy.heading, enemy.kind === "corsair" ? 54 : 42);
      else if (distance < 110) accelerate(enemy, enemy.heading + 16, 34);
      clampVelocity(enemy, enemy.kind === "corsair" ? 1880 : 1530);
      enemy.vx = Math.trunc(enemy.vx * 1012 / 1024); enemy.vy = Math.trunc(enemy.vy * 1012 / 1024);
      enemy.x = clamp(enemy.x + enemy.vx, -WORLD_X, WORLD_X); enemy.y = clamp(enemy.y + enemy.vy, -WORLD_Y, WORLD_Y);
      if (distance < 390 && enemy.cooldown <= 0) {
        spawnProjectile(state, enemy.id, enemy, desired, enemy.kind === "corsair" ? 14 : 9);
        enemy.cooldown = enemy.kind === "corsair" ? 40 : 58;
        state.events.push({ type: EVENTS.SHOT, owner: "enemy" });
      }
    }
  }

  function dropSalvage(state, source) {
    state.salvage.push({ id: state.nextId++, active: true, commodity: nextRandom(state) % COMMODITIES.length, quantity: 1 + nextRandom(state) % 3, x: source.x, y: source.y });
    if (state.salvage.length > 12) state.salvage.shift();
  }

  function stepProjectiles(state) {
    for (const projectile of state.projectiles) {
      projectile.life -= 1; projectile.x += projectile.vx; projectile.y += projectile.vy;
      if (projectile.hostile) {
        if (!state.player.docked && distanceSquared(projectile, state.player) <= 18 * 18) {
          applyDamage(state.player, projectile.damage); projectile.life = 0;
          state.events.push({ type: EVENTS.HIT, target: "player", damage: projectile.damage });
        }
      } else {
        for (const enemy of state.enemies) {
          if (enemy.hull <= 0 || distanceSquared(projectile, enemy) > 16 * 16) continue;
          applyDamage(enemy, projectile.damage); projectile.life = 0;
          state.events.push({ type: EVENTS.HIT, target: enemy.id, damage: projectile.damage });
          if (enemy.hull <= 0) {
            state.score += 450 + enemy.maxHull * 8; state.player.credits += 90;
            dropSalvage(state, enemy);
            state.events.push({ type: EVENTS.ENEMY_DESTROYED, id: enemy.id });
          }
          break;
        }
      }
    }
    state.projectiles = state.projectiles.filter((projectile) => projectile.life > 0 && Math.abs(projectile.x) < WORLD_X * 2 && Math.abs(projectile.y) < WORLD_Y * 2);
    state.enemies = state.enemies.filter((enemy) => enemy.hull > 0);
    if (state.player.hull <= 0) {
      const station = state.systems[state.player.system].station;
      state.player.credits = Math.max(0, state.player.credits - 150);
      state.player.hull = state.player.hullMax; state.player.shield = state.player.shieldMax; state.player.energy = state.player.energyMax;
      state.player.x = station.x; state.player.y = station.y; state.player.vx = 0; state.player.vy = 0; state.player.docked = true;
      state.enemies.length = 0; state.projectiles.length = 0;
      state.events.push({ type: EVENTS.PLAYER_DESTROYED });
    }
  }

  function updateMarket(state) {
    state.marketTicks += 1;
    if (state.marketTicks < 900) return;
    state.marketTicks = 0;
    for (const system of state.systems) {
      for (let index = 0; index < COMMODITIES.length; index += 1) {
        system.market.inventory[index] = clamp(system.market.inventory[index] + system.market.production[index], 0, 99);
      }
    }
  }

  function updateQutrits(state) {
    const player = state.player;
    const nearestThreat = state.enemies.reduce((best, enemy) => Math.min(best, distanceSquared(player, enemy)), Infinity);
    const station = state.systems[player.system].station;
    const gate = state.systems[player.system].gate;
    state.qutrits.navigation = player.docked ? 0 : distanceSquared(player, station) < 160 * 160 || distanceSquared(player, gate) < 180 * 180 ? 1 : 2;
    state.qutrits.threat = nearestThreat < 180 * 180 ? 2 : nearestThreat < 420 * 420 ? 1 : 0;
    const market = state.systems[player.system].market;
    state.qutrits.economy = market.inventory[state.selectedCommodity] < market.target[state.selectedCommodity] ? 2 : market.inventory[state.selectedCommodity] > market.target[state.selectedCommodity] ? 0 : 1;
    const reputation = player.reputation[market.faction];
    state.qutrits.faction = reputation < -120 ? 2 : reputation > 120 ? 0 : 1;
    state.qutrits.hull = player.hull * 4 < player.hullMax ? 2 : player.hull * 3 < player.hullMax * 2 ? 1 : 0;
  }

  function step(state, inputValue) {
    const input = Number(inputValue) & ACTION_MASK;
    const pressed = input & ~state.previousInput;
    state.events = [];
    state.tick += 1;
    updateMarket(state);
    if (state.mission && state.tick > state.mission.expiry) state.mission = null;
    if (state.player.docked) stepDocked(state, pressed);
    else {
      stepPlayer(state, input, pressed);
      stepEnemies(state);
      stepProjectiles(state);
      if (!state.enemies.length) {
        state.respawnTicks += 1;
        if (state.respawnTicks > 300) { state.respawnTicks = 0; spawnEnemy(state); }
      } else state.respawnTicks = 0;
    }
    if ((state.tick % 15) === 0) updateQutrits(state);
    state.previousInput = input;
    return state;
  }

  function stateDigest(state) {
    const canonical = { ...state };
    delete canonical.events;
    return seedHex(fnv1a(JSON.stringify(canonical)));
  }

  return Object.freeze({
    VERSION, TICK_HZ, FP, INPUT, ACTION_MASK, COMMODITIES, BASE_PRICES, FACTIONS, EVENTS, DIRECTIONS,
    clamp, normalizeSeed, seedHex, cargoUsed, marketPrice, createGame, step, stateDigest,
  });
});
