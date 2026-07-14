(function bootstrapInertiaZeroCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InertiaZeroCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createInertiaZeroCore() {
  "use strict";

  const TAU = Math.PI * 2;
  const EPSILON = 1e-9;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function distanceSquared(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function angleDelta(from, to) {
    let delta = (to - from) % TAU;
    if (delta > Math.PI) delta -= TAU;
    if (delta < -Math.PI) delta += TAU;
    return delta;
  }

  function rotateToward(current, target, maxStep) {
    return current + clamp(angleDelta(current, target), -maxStep, maxStep);
  }

  function hashSeed(value) {
    const text = String(value || "inertia-zero");
    let hash = 2166136261 >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash += hash << 13;
    hash ^= hash >>> 7;
    hash += hash << 3;
    hash ^= hash >>> 17;
    hash += hash << 5;
    return hash >>> 0;
  }

  class RNG {
    constructor(seed) {
      this.state = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
      if (this.state === 0) this.state = 0x6d2b79f5;
    }

    next() {
      let value = this.state += 0x6d2b79f5;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      const output = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      this.state >>>= 0;
      return output;
    }

    range(min, max) {
      return min + (max - min) * this.next();
    }

    int(min, maxInclusive) {
      return Math.floor(this.range(min, maxInclusive + 1));
    }

    chance(probability) {
      return this.next() < probability;
    }

    pick(values) {
      return values[Math.floor(this.next() * values.length)];
    }

    shuffle(values) {
      const result = values.slice();
      for (let index = result.length - 1; index > 0; index -= 1) {
        const other = this.int(0, index);
        [result[index], result[other]] = [result[other], result[index]];
      }
      return result;
    }

    fork(label) {
      return new RNG(`${this.state}:${label}`);
    }
  }

  const SHIPS = Object.freeze({
    warbird: Object.freeze({
      id: "warbird",
      name: "Warbird",
      role: "Precision duelist",
      description: "Balanced interceptor with the cleanest gun line and a short overdrive window.",
      accent: "#f0c978",
      radius: 16,
      mass: 1,
      thrust: 620,
      reverse: 0.46,
      turnRate: 3.55,
      maxSpeed: 390,
      drag: 0.994,
      maxEnergy: 1100,
      recharge: 86,
      gunCost: 26,
      gunCooldown: 0.19,
      gunSpeed: 920,
      gunDamage: 132,
      gunSpread: 0.012,
      secondary: "bomb",
      secondaryCost: 150,
      secondaryCooldown: 1.5,
      preferredRange: 470,
      special: "overdrive",
      specialCost: 260,
      specialCooldown: 9
    }),
    javelin: Object.freeze({
      id: "javelin",
      name: "Javelin",
      role: "High-speed interceptor",
      description: "The fastest straight-line frame, built for long attack passes and sudden vector dashes.",
      accent: "#dc9671",
      radius: 15,
      mass: 0.88,
      thrust: 760,
      reverse: 0.4,
      turnRate: 3.85,
      maxSpeed: 440,
      drag: 0.993,
      maxEnergy: 900,
      recharge: 78,
      gunCost: 23,
      gunCooldown: 0.2,
      gunSpeed: 880,
      gunDamage: 102,
      gunSpread: 0.02,
      secondary: "bomb",
      secondaryCost: 125,
      secondaryCooldown: 1.15,
      preferredRange: 410,
      special: "dash",
      specialCost: 230,
      specialCooldown: 7
    }),
    spider: Object.freeze({
      id: "spider",
      name: "Spider",
      role: "Covert skirmisher",
      description: "A stealth-capable hunter that disappears from sensors, then attacks from a new angle.",
      accent: "#b7c77b",
      radius: 16,
      mass: 0.96,
      thrust: 670,
      reverse: 0.5,
      turnRate: 4.15,
      maxSpeed: 355,
      drag: 0.993,
      maxEnergy: 1050,
      recharge: 98,
      gunCost: 15,
      gunCooldown: 0.16,
      gunSpeed: 850,
      gunDamage: 88,
      gunSpread: 0.026,
      secondary: "mine",
      secondaryCost: 125,
      secondaryCooldown: 1.55,
      preferredRange: 330,
      special: "cloak",
      specialCost: 190,
      specialCooldown: 8.5
    }),
    leviathan: Object.freeze({
      id: "leviathan",
      name: "Leviathan",
      role: "Heavy bomber",
      description: "Slow fortress frame whose heavy ordnance controls entire corridors.",
      accent: "#d7836d",
      radius: 22,
      mass: 1.65,
      thrust: 430,
      reverse: 0.36,
      turnRate: 2.35,
      maxSpeed: 295,
      drag: 0.995,
      maxEnergy: 1680,
      recharge: 72,
      gunCost: 34,
      gunCooldown: 0.27,
      gunSpeed: 790,
      gunDamage: 155,
      gunSpread: 0.025,
      secondary: "heavyBomb",
      secondaryCost: 245,
      secondaryCooldown: 2.35,
      preferredRange: 610,
      special: "siege",
      specialCost: 420,
      specialCooldown: 12
    }),
    terrier: Object.freeze({
      id: "terrier",
      name: "Terrier",
      role: "Twin-gun interceptor",
      description: "An agile sustained-pressure frame whose paired gun ports widen its firing lane.",
      accent: "#75c3ae",
      radius: 18,
      mass: 1.15,
      thrust: 600,
      reverse: 0.58,
      turnRate: 3.3,
      maxSpeed: 365,
      drag: 0.994,
      maxEnergy: 1320,
      recharge: 112,
      gunCost: 36,
      gunCooldown: 0.2,
      gunSpeed: 850,
      gunDamage: 92,
      gunSpread: 0.025,
      secondary: "bomb",
      secondaryCost: 145,
      secondaryCooldown: 1.45,
      preferredRange: 430,
      special: "multifire",
      specialCost: 290,
      specialCooldown: 10
    }),
    weasel: Object.freeze({
      id: "weasel",
      name: "Weasel",
      role: "Electronic-warfare bomber",
      description: "A compact disruption craft whose EMP ordnance freezes hostile energy recovery.",
      accent: "#a9a6d1",
      radius: 13,
      mass: 0.72,
      thrust: 610,
      reverse: 0.48,
      turnRate: 3.45,
      maxSpeed: 350,
      drag: 0.992,
      maxEnergy: 760,
      recharge: 82,
      gunCost: 20,
      gunCooldown: 0.155,
      gunSpeed: 940,
      gunDamage: 86,
      gunSpread: 0.018,
      secondary: "empBomb",
      secondaryCost: 155,
      secondaryCooldown: 1.75,
      preferredRange: 430,
      special: "emp",
      specialCost: 250,
      specialCooldown: 9
    }),
    lancaster: Object.freeze({
      id: "lancaster",
      name: "Lancaster",
      role: "Ricochet gunship",
      description: "A high-energy cruiser whose bouncing bombs turn walls into bank-shot weapons.",
      accent: "#7ca7c7",
      radius: 21,
      mass: 1.55,
      thrust: 455,
      reverse: 0.52,
      turnRate: 2.55,
      maxSpeed: 305,
      drag: 0.995,
      maxEnergy: 1820,
      recharge: 92,
      gunCost: 31,
      gunCooldown: 0.22,
      gunSpeed: 820,
      gunDamage: 122,
      gunSpread: 0.018,
      secondary: "bounceBomb",
      secondaryCost: 185,
      secondaryCooldown: 1.8,
      preferredRange: 520,
      special: "barrier",
      specialCost: 350,
      specialCooldown: 11
    }),
    shark: Object.freeze({
      id: "shark",
      name: "Shark",
      role: "Rapid-fire controller",
      description: "A fast-firing late-generation frame with repulsors for breaking close pressure.",
      accent: "#6eb7bd",
      radius: 19,
      mass: 1.3,
      thrust: 550,
      reverse: 0.64,
      turnRate: 3.05,
      maxSpeed: 335,
      drag: 0.994,
      maxEnergy: 1420,
      recharge: 104,
      gunCost: 16,
      gunCooldown: 0.105,
      gunSpeed: 825,
      gunDamage: 98,
      gunSpread: 0.028,
      secondary: "cluster",
      secondaryCost: 165,
      secondaryCooldown: 1.65,
      preferredRange: 390,
      special: "repulse",
      specialCost: 260,
      specialCooldown: 7.5
    })
  });

  const DIFFICULTIES = Object.freeze({
    cadet: Object.freeze({
      id: "cadet",
      name: "Cadet",
      summary: "Forgiving reactions and visible aiming errors.",
      reaction: 0.34,
      aimError: 0.17,
      prediction: 0.48,
      dodge: 0.18,
      pathInterval: 1.1,
      aggression: 0.58,
      reserve: 0.2,
      spacing: 0,
      speedScale: 1,
      damageScale: 1,
      scoreScale: 0.8
    }),
    veteran: Object.freeze({
      id: "veteran",
      name: "Veteran",
      summary: "Competent pilots with predictive fire and basic energy discipline.",
      reaction: 0.23,
      aimError: 0.095,
      prediction: 0.72,
      dodge: 0.44,
      pathInterval: 0.78,
      aggression: 0.7,
      reserve: 0.27,
      spacing: 0.25,
      speedScale: 1,
      damageScale: 1,
      scoreScale: 1
    }),
    ace: Object.freeze({
      id: "ace",
      name: "Ace",
      summary: "Fast interception, projectile evasion, flanking, and range control.",
      reaction: 0.14,
      aimError: 0.048,
      prediction: 0.91,
      dodge: 0.72,
      pathInterval: 0.5,
      aggression: 0.82,
      reserve: 0.32,
      spacing: 0.58,
      speedScale: 1,
      damageScale: 1,
      scoreScale: 1.35
    }),
    elite: Object.freeze({
      id: "elite",
      name: "Elite",
      summary: "Staggered flanking pressure that punishes straight lines and exhausted energy banks.",
      reaction: 0.082,
      aimError: 0.021,
      prediction: 1,
      dodge: 0.92,
      pathInterval: 0.34,
      aggression: 0.9,
      reserve: 0.38,
      spacing: 0.86,
      speedScale: 1,
      damageScale: 1,
      scoreScale: 1.7
    }),
    sovereign: Object.freeze({
      id: "sovereign",
      name: "Sovereign",
      summary: "Near-instant tactical AI with precise leading, aggressive orbit spacing, and no mercy.",
      reaction: 0.042,
      aimError: 0.006,
      prediction: 1,
      dodge: 1,
      pathInterval: 0.2,
      aggression: 0.97,
      reserve: 0.43,
      spacing: 1,
      speedScale: 1,
      damageScale: 1,
      scoreScale: 2.2
    })
  });

  const ARENA_STYLES = Object.freeze({
    mixed: Object.freeze({ id: "mixed", name: "Procedural rotation" }),
    open: Object.freeze({ id: "open", name: "Open frontier" }),
    asteroids: Object.freeze({ id: "asteroids", name: "Asteroid graveyard" }),
    rings: Object.freeze({ id: "rings", name: "Orbital rings" }),
    fortress: Object.freeze({ id: "fortress", name: "Broken citadel" }),
    channels: Object.freeze({ id: "channels", name: "Plasma channels" })
  });

  const OBJECTIVE_TYPES = Object.freeze(["elimination", "control", "core", "survival"]);

  function solveIntercept(shooter, target, projectileSpeed) {
    const relativeX = target.x - shooter.x;
    const relativeY = target.y - shooter.y;
    const velocityX = (target.vx || 0) - (shooter.vx || 0);
    const velocityY = (target.vy || 0) - (shooter.vy || 0);
    const a = velocityX * velocityX + velocityY * velocityY - projectileSpeed * projectileSpeed;
    const b = 2 * (relativeX * velocityX + relativeY * velocityY);
    const c = relativeX * relativeX + relativeY * relativeY;
    let time = 0;

    if (Math.abs(a) < EPSILON) {
      if (Math.abs(b) > EPSILON) time = -c / b;
    } else {
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        const first = (-b - root) / (2 * a);
        const second = (-b + root) / (2 * a);
        const valid = [first, second].filter((value) => value > 0);
        if (valid.length) time = Math.min(...valid);
      }
    }

    time = clamp(time, 0, 2.5);
    return {
      x: target.x + (target.vx || 0) * time,
      y: target.y + (target.vy || 0) * time,
      time
    };
  }

  function pointInRect(point, rect, padding) {
    const margin = padding || 0;
    return point.x >= rect.x - margin
      && point.x <= rect.x + rect.w + margin
      && point.y >= rect.y - margin
      && point.y <= rect.y + rect.h + margin;
  }

  function pointBlocked(point, obstacles, padding) {
    const margin = padding || 0;
    for (const obstacle of obstacles) {
      if (obstacle.type === "circle") {
        const radius = obstacle.r + margin;
        const dx = point.x - obstacle.x;
        const dy = point.y - obstacle.y;
        if (dx * dx + dy * dy <= radius * radius) return true;
      } else if (pointInRect(point, obstacle, margin)) {
        return true;
      }
    }
    return false;
  }

  function segmentCircleIntersects(start, end, circle, padding) {
    const radius = circle.r + (padding || 0);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < EPSILON) {
      const ox = start.x - circle.x;
      const oy = start.y - circle.y;
      return ox * ox + oy * oy <= radius * radius;
    }
    const t = clamp(((circle.x - start.x) * dx + (circle.y - start.y) * dy) / lengthSquared, 0, 1);
    const px = start.x + dx * t - circle.x;
    const py = start.y + dy * t - circle.y;
    return px * px + py * py <= radius * radius;
  }

  function segmentRectIntersects(start, end, rect, padding) {
    const margin = padding || 0;
    const left = rect.x - margin;
    const right = rect.x + rect.w + margin;
    const top = rect.y - margin;
    const bottom = rect.y + rect.h + margin;
    let tMin = 0;
    let tMax = 1;
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    for (const [origin, direction, min, max] of [
      [start.x, dx, left, right],
      [start.y, dy, top, bottom]
    ]) {
      if (Math.abs(direction) < EPSILON) {
        if (origin < min || origin > max) return false;
      } else {
        const inverse = 1 / direction;
        let near = (min - origin) * inverse;
        let far = (max - origin) * inverse;
        if (near > far) [near, far] = [far, near];
        tMin = Math.max(tMin, near);
        tMax = Math.min(tMax, far);
        if (tMin > tMax) return false;
      }
    }
    return true;
  }

  function lineOfSight(start, end, obstacles, padding) {
    for (const obstacle of obstacles) {
      if (obstacle.type === "circle") {
        if (segmentCircleIntersects(start, end, obstacle, padding)) return false;
      } else if (segmentRectIntersects(start, end, obstacle, padding)) {
        return false;
      }
    }
    return true;
  }

  function findPath(start, goal, arena, cellSize) {
    const gridSize = cellSize || 120;
    const clearance = 30;
    const columns = Math.max(2, Math.ceil(arena.width / gridSize));
    const rows = Math.max(2, Math.ceil(arena.height / gridSize));
    const toCell = (point) => ({
      x: clamp(Math.floor(point.x / gridSize), 0, columns - 1),
      y: clamp(Math.floor(point.y / gridSize), 0, rows - 1)
    });
    const toPoint = (cell) => ({
      x: (cell.x + 0.5) * gridSize,
      y: (cell.y + 0.5) * gridSize
    });
    const cellKey = (cell) => `${cell.x},${cell.y}`;
    const startCell = toCell(start);
    const goalCell = toCell(goal);
    const startKey = cellKey(startCell);
    const goalKey = cellKey(goalCell);
    const blockedCache = new Map();
    const isBlocked = (cell) => {
      const key = cellKey(cell);
      if (key === startKey || key === goalKey) return false;
      if (!blockedCache.has(key)) blockedCache.set(key, pointBlocked(toPoint(cell), arena.obstacles, clearance));
      return blockedCache.get(key);
    };
    const heuristic = (cell) => Math.hypot(goalCell.x - cell.x, goalCell.y - cell.y);
    const open = [{ ...startCell, f: heuristic(startCell) }];
    const openKeys = new Set([startKey]);
    const closed = new Set();
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    const directions = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
    ];
    let iterations = 0;

    while (open.length && iterations < columns * rows * 4) {
      iterations += 1;
      open.sort((a, b) => a.f - b.f);
      const current = open.shift();
      const currentKey = cellKey(current);
      openKeys.delete(currentKey);
      if (currentKey === goalKey) {
        const path = [goal];
        let cursor = currentKey;
        while (cameFrom.has(cursor)) {
          cursor = cameFrom.get(cursor);
          if (cursor !== startKey) {
            const [x, y] = cursor.split(",").map(Number);
            path.push(toPoint({ x, y }));
          }
        }
        path.reverse();
        const smoothed = [];
        let anchor = start;
        let pathIndex = 0;
        while (pathIndex < path.length) {
          let furthest = pathIndex;
          for (let candidate = pathIndex; candidate < path.length; candidate += 1) {
            if (lineOfSight(anchor, path[candidate], arena.obstacles, clearance)) furthest = candidate;
          }
          const waypoint = path[furthest];
          smoothed.push(waypoint);
          anchor = waypoint;
          pathIndex = furthest + 1;
        }
        return smoothed;
      }
      closed.add(currentKey);

      for (const [dx, dy, movementCost] of directions) {
        const neighbour = { x: current.x + dx, y: current.y + dy };
        if (neighbour.x < 0 || neighbour.x >= columns || neighbour.y < 0 || neighbour.y >= rows) continue;
        const neighbourKey = cellKey(neighbour);
        if (closed.has(neighbourKey) || isBlocked(neighbour)) continue;
        if (dx !== 0 && dy !== 0) {
          if (isBlocked({ x: current.x + dx, y: current.y }) || isBlocked({ x: current.x, y: current.y + dy })) continue;
        }
        const currentPoint = currentKey === startKey ? start : toPoint(current);
        const neighbourPoint = neighbourKey === goalKey ? goal : toPoint(neighbour);
        if (!lineOfSight(currentPoint, neighbourPoint, arena.obstacles, clearance)) continue;
        const tentative = (gScore.get(currentKey) || 0) + movementCost;
        if (tentative >= (gScore.get(neighbourKey) ?? Infinity)) continue;
        cameFrom.set(neighbourKey, currentKey);
        gScore.set(neighbourKey, tentative);
        const f = tentative + heuristic(neighbour);
        if (!openKeys.has(neighbourKey)) {
          open.push({ ...neighbour, f });
          openKeys.add(neighbourKey);
        } else {
          const entry = open.find((item) => item.x === neighbour.x && item.y === neighbour.y);
          if (entry) entry.f = f;
        }
      }
    }
    return [];
  }

  function overlapsReserved(obstacle, reserved, margin) {
    const padding = margin || 0;
    return reserved.some((point) => {
      if (obstacle.type === "circle") {
        const radius = obstacle.r + (point.r || 0) + padding;
        const dx = point.x - obstacle.x;
        const dy = point.y - obstacle.y;
        return dx * dx + dy * dy < radius * radius;
      }
      return pointInRect(point, obstacle, (point.r || 0) + padding);
    });
  }

  function generateArena(seed, level, requestedStyle) {
    const width = 3200;
    const height = 2200;
    const rng = new RNG(`${seed}:${level}:arena`);
    const availableStyles = ["open", "asteroids", "rings", "fortress", "channels"];
    const style = requestedStyle && requestedStyle !== "mixed" ? requestedStyle : availableStyles[(level - 1) % availableStyles.length];
    const playerSpawn = { x: 420, y: height * 0.5, r: 220 };
    const enemySpawns = [
      { x: width - 420, y: height * 0.5 },
      { x: width - 560, y: 420 },
      { x: width - 560, y: height - 420 },
      { x: width * 0.67, y: 320 },
      { x: width * 0.67, y: height - 320 },
      { x: width * 0.52, y: 300 },
      { x: width * 0.52, y: height - 300 },
      { x: width - 300, y: height * 0.28 },
      { x: width - 300, y: height * 0.72 },
      { x: width * 0.78, y: height * 0.5 }
    ];
    const centre = { x: width * 0.5, y: height * 0.5, r: 260 };
    const reserved = [playerSpawn, centre, ...enemySpawns.map((point) => ({ ...point, r: 105 }))];
    const obstacles = [];
    const addCircle = (x, y, radius, kind) => {
      const obstacle = { type: "circle", x, y, r: radius, kind: kind || "asteroid", spin: rng.range(-0.3, 0.3), phase: rng.range(0, TAU) };
      if (x - radius < 90 || x + radius > width - 90 || y - radius < 90 || y + radius > height - 90) return false;
      if (overlapsReserved(obstacle, reserved, 45)) return false;
      obstacles.push(obstacle);
      return true;
    };
    const addRect = (x, y, w, h, kind) => {
      const obstacle = { type: "rect", x, y, w, h, kind: kind || "station", phase: rng.range(0, TAU) };
      if (x < 90 || x + w > width - 90 || y < 90 || y + h > height - 90) return false;
      if (overlapsReserved(obstacle, reserved, 55)) return false;
      obstacles.push(obstacle);
      return true;
    };

    if (style === "open") {
      for (let index = 0; index < 12; index += 1) {
        addCircle(rng.range(500, width - 400), rng.range(260, height - 260), rng.range(28, 66), "debris");
      }
    } else if (style === "asteroids") {
      let attempts = 0;
      while (obstacles.length < 34 && attempts < 160) {
        attempts += 1;
        addCircle(rng.range(300, width - 260), rng.range(180, height - 180), rng.range(34, 92), rng.chance(0.2) ? "crystal" : "asteroid");
      }
    } else if (style === "rings") {
      for (const ring of [430, 690]) {
        const count = ring < 500 ? 12 : 18;
        const offset = rng.range(0, TAU);
        for (let index = 0; index < count; index += 1) {
          const angle = offset + index / count * TAU;
          addCircle(centre.x + Math.cos(angle) * ring, centre.y + Math.sin(angle) * ring * 0.72, rng.range(34, 62), "orbital");
        }
      }
    } else if (style === "fortress") {
      const structures = [
        [centre.x - 570, centre.y - 420, 330, 58],
        [centre.x + 240, centre.y - 420, 330, 58],
        [centre.x - 570, centre.y + 362, 330, 58],
        [centre.x + 240, centre.y + 362, 330, 58],
        [centre.x - 610, centre.y - 210, 58, 240],
        [centre.x - 610, centre.y + 100, 58, 240],
        [centre.x + 552, centre.y - 210, 58, 240],
        [centre.x + 552, centre.y + 100, 58, 240]
      ];
      structures.forEach((entry) => addRect(...entry, "citadel"));
      for (let index = 0; index < 14; index += 1) {
        addCircle(rng.range(500, width - 420), rng.range(240, height - 240), rng.range(26, 58), "debris");
      }
    } else if (style === "channels") {
      const gapY = rng.range(760, 1280);
      addRect(820, 120, 72, gapY - 270, "conduit");
      addRect(820, gapY + 150, 72, height - gapY - 270, "conduit");
      addRect(1400, 500, 72, 220, "conduit");
      addRect(1400, 1480, 72, 220, "conduit");
      addRect(2220, 600, 72, 260, "conduit");
      addRect(2220, 1340, 72, 260, "conduit");
      for (let index = 0; index < 16; index += 1) {
        addCircle(rng.range(350, width - 300), rng.range(170, height - 170), rng.range(26, 48), "crystal");
      }
    }

    const stars = [];
    for (let index = 0; index < 260; index += 1) {
      stars.push({
        x: rng.range(0, width),
        y: rng.range(0, height),
        size: rng.range(0.5, 2.1),
        alpha: rng.range(0.18, 0.78),
        layer: rng.range(0.18, 0.72)
      });
    }
    const nebulae = [];
    for (let index = 0; index < 5; index += 1) {
      nebulae.push({
        x: rng.range(300, width - 300),
        y: rng.range(200, height - 200),
        radius: rng.range(300, 720),
        alpha: rng.range(0.025, 0.075),
        hue: rng.pick([185, 197, 36, 215])
      });
    }
    const objectiveType = OBJECTIVE_TYPES[(Math.max(1, level) - 1) % OBJECTIVE_TYPES.length];
    return {
      id: `${hashSeed(`${seed}:${level}:${style}`).toString(16).padStart(8, "0")}`,
      seed: String(seed),
      level,
      style,
      styleName: ARENA_STYLES[style].name,
      width,
      height,
      obstacles,
      playerSpawn: { x: playerSpawn.x, y: playerSpawn.y },
      enemySpawns,
      objective: {
        type: objectiveType,
        x: centre.x,
        y: centre.y,
        radius: objectiveType === "control" ? 220 : 145
      },
      stars,
      nebulae
    };
  }

  function arenaFingerprint(arena) {
    const summary = {
      id: arena.id,
      style: arena.style,
      level: arena.level,
      objective: arena.objective,
      obstacles: arena.obstacles.map((item) => item.type === "circle"
        ? [item.type, Math.round(item.x), Math.round(item.y), Math.round(item.r), item.kind]
        : [item.type, Math.round(item.x), Math.round(item.y), Math.round(item.w), Math.round(item.h), item.kind])
    };
    return hashSeed(JSON.stringify(summary)).toString(16).padStart(8, "0");
  }

  return Object.freeze({
    TAU,
    clamp,
    lerp,
    distanceSquared,
    angleDelta,
    rotateToward,
    hashSeed,
    RNG,
    SHIPS,
    DIFFICULTIES,
    ARENA_STYLES,
    OBJECTIVE_TYPES,
    solveIntercept,
    pointInRect,
    pointBlocked,
    segmentCircleIntersects,
    segmentRectIntersects,
    lineOfSight,
    findPath,
    generateArena,
    arenaFingerprint
  });
}));
