/* LATTICE CORSAIR real-time flight.
 *
 * One star system at a time: star, planets, stations, jump gates and the ships
 * that live there. Fixed 60 Hz steps, seeded randomness and id-ordered
 * iteration make every flight deterministic for a given career and input
 * sequence. No DOM, clock or ambient randomness.
 *
 * NPC brains run at a 10 Hz control rate and hold their outputs between
 * decisions (the "slow control state out of the hot loop" idea of OPT-DSP-001,
 * adopted as the design rather than as an equivalence claim).
 *
 * OPT-REDUCE-001: in large crowds, shots are tested only against ships in the
 * uniform-grid cells their swept segment touches; small crowds test every ship
 * (cheaper there, measured). collideBrute is the all-pairs reference; tests and
 * the benchmark require identical hits.
 */
(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CorsairFlight = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const U = (typeof module === "object" && module.exports) ? require("./universe.js") : root.CorsairUniverse;
  const War = U.War;
  const DT = 1 / 60;
  const THINK_EVERY = 6; // 10 Hz brains
  const SYSTEM_RADIUS = 2600;
  const CELL = 256;
  const MAX_SHIP_RADIUS = 30;
  const NPC_CAP = 16;
  // Crowds at or above this size use the grid broad-phase; smaller ones test
  // every ship. Both are exact (tests require identical hits). Measured on the
  // development host (docs/OPTIMIZATION.md): rebuilding the grid each tick cost
  // more than it saved at 14-26 ships and paid off at about 58; the crossover
  // is host-specific, so this is a conservative, documented choice.
  const GRID_MIN_SHIPS = 32;
  const DOCK_RANGE = 120, DOCK_SPEED = 110, GATE_RANGE = 150, GATE_SPEED = 220, SCOOP_RANGE = 46;
  const PLANET_COLORS = Object.freeze({ terran: "#5f9d6e", ocean: "#3f78b4", tundra: "#b9d3df", volcanic: "#c4553a", arid: "#d0a463", barren: "#8c8478", gas: "#c9a27c", asteroid: "#6f6a63" });

  // VANILLAJS modules/math seededRandom, uint32 output.
  function rand(world) {
    world.rng = (world.rng + 0x6d2b79f5) >>> 0;
    let t = Math.imul(world.rng ^ (world.rng >>> 15), world.rng | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  const below = (world, n) => (n <= 1 ? 0 : rand(world) % n);
  const unit = (world) => rand(world) / 4294967296;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

  // ---------------------------------------------------------------------
  // Layout.
  // ---------------------------------------------------------------------
  function layout(career, system) {
    const war = career.war, sys = war.galaxy.systems[system];
    const planets = sys.planets.map((p, i) => {
      const a = (U.hash(career.seed, "orbit", system, i) % 6283) / 1000, r = 560 + i * 380;
      return { index: i, type: p.type, size: p.size, x: Math.cos(a) * r, y: Math.sin(a) * r, radius: 26 + p.size * 9, color: PLANET_COLORS[p.type] };
    });
    const stations = U.stationsIn(career, system).map((st) => {
      let x, y;
      if (st.kind === "den") {
        const a = (U.hash(career.seed, "den", system) % 6283) / 1000;
        x = Math.cos(a) * 1900; y = Math.sin(a) * 1900;
      } else {
        const p = planets[st.planet], a = Math.atan2(p.y, p.x) + 0.35;
        x = p.x + Math.cos(a) * (p.radius + 90); y = p.y + Math.sin(a) * (p.radius + 90);
      }
      return { ...st, x, y };
    });
    const adj = War.routesFor(war.galaxy).adj[system];
    const gates = adj.map(({ to }) => {
      const other = war.galaxy.systems[to], a = Math.atan2(other.y - sys.y, other.x - sys.x);
      return { to, name: other.name, x: Math.cos(a) * SYSTEM_RADIUS, y: Math.sin(a) * SYSTEM_RADIUS, angle: a };
    });
    return { name: sys.name, star: { color: sys.starColor, radius: 150 }, planets, stations, gates };
  }

  // ---------------------------------------------------------------------
  // Ships.
  // ---------------------------------------------------------------------
  function factionColor(career, faction, clan) {
    return faction < 0 ? career.data.outlaws[clan || 0].color : career.war.empires[faction].color;
  }
  function factionName(career, faction, clan) {
    return faction < 0 ? career.data.outlaws[clan || 0].name : career.war.empires[faction].name;
  }

  function makeShip(world, career, spec) {
    const stats = U.shipStats(career.data, spec.loadout);
    const ship = {
      id: world.nextId++, name: spec.name, faction: spec.faction, clan: spec.clan || 0, role: spec.role, loadout: spec.loadout, stats,
      x: spec.x, y: spec.y, vx: 0, vy: 0, angle: spec.angle || 0, hull: stats.hull - (spec.damage || 0), shield: stats.shield, energy: stats.energy,
      cooldowns: stats.weapons.map(() => 0), ammo: spec.ammo ?? stats.ammo, target: null, aggro: [], lastHit: -999, isPlayer: Boolean(spec.isPlayer),
      ctl: { turn: 0, thrust: 0, reverse: 0, boost: false, fire: false, missile: false }, home: spec.home || { x: spec.x, y: spec.y },
      waypoint: spec.waypoint || null, mode: spec.mode || "idle", missionId: spec.missionId || null, loot: spec.loot || null, taunted: false,
      damageScale: spec.damageScale || 100, thinkPhase: 0, boosting: false, thrusting: false, alive: true,
    };
    ship.thinkPhase = ship.id % THINK_EVERY;
    world.ships.push(ship);
    return ship;
  }

  function bestEquipment(career, tech, kind, extra) {
    let best = null;
    for (const e of career.data.equipment) {
      if (e.kind !== kind || (e.requires && (tech[e.requires.field] || 0) < e.requires.level)) continue;
      if (extra && !extra(e)) continue;
      const score = e.weapon ? e.damage * e.rate : e.value;
      if (!best || score > best.score) best = { e, score };
    }
    return best ? best.e.index : -1;
  }
  function npcLoadout(career, hullIndex, tech, missiles) {
    const hull = career.data.ships[hullIndex];
    const laser = bestEquipment(career, tech, "laser"), cannon = bestEquipment(career, tech, "cannon"), missile = bestEquipment(career, tech, "missile");
    const weapons = [];
    for (let i = 0; i < hull.weapons; i++) weapons.push(i === 1 && cannon >= 0 ? cannon : i === 2 && missiles && missile >= 0 ? missile : laser);
    const utility = [];
    const shield = bestEquipment(career, tech, "shield"), armor = bestEquipment(career, tech, "armor"), engine = bestEquipment(career, tech, "engine");
    for (const u of [shield, armor, engine]) if (u >= 0 && utility.length < hull.utility) utility.push(u);
    return { hull: hullIndex, weapons: weapons.filter((w) => w >= 0), utility, damage: 0, ammo: 0 };
  }
  const hullByName = (career, name) => Math.max(0, career.data.ships.findIndex((s) => s.name === name));
  const OUTLAW_TECH = Object.freeze({ propulsion: 2, weapons: 2, armor: 2, colonization: 0, industry: 1, sensors: 1 });

  function npcName(world, career, faction, clan) {
    if (faction < 0) { const names = career.data.outlaws[clan].shipNames; return names[below(world, names.length)]; }
    const empire = career.war.empires[faction], names = career.war.data.empires[empire.dataIndex].shipNames;
    return `${empire.adjective} ${names[below(world, names.length)]}`;
  }

  function spawnNpc(world, career, opts) {
    const tech = opts.faction < 0 ? OUTLAW_TECH : career.war.empires[opts.faction].tech;
    const hull = hullByName(career, opts.hull);
    const loadout = npcLoadout(career, hull, tech, opts.missiles);
    const enemyScale = opts.faction < 0 || U.hostileToPlayer(career, opts.faction) ? U.DIFFICULTIES[career.difficulty].enemy : 100;
    return makeShip(world, career, { ...opts, loadout, name: opts.name || npcName(world, career, opts.faction, opts.clan || 0), damageScale: enemyScale });
  }

  // ---------------------------------------------------------------------
  // World creation and spawning.
  // ---------------------------------------------------------------------
  function createFlight(career, arrival) {
    const system = career.system;
    const world = {
      system, layout: layout(career, system), tick: 0, rng: U.hash(career.seed, "flight", system, career.day, career.stats.jumps, career.stats.deaths) || 1,
      nextId: 1, ships: [], shots: [], missiles: [], pickups: [], effects: [], events: [], player: null, playerDead: false, spawnClock: 0, turretClock: 0,
      grid: new Map(),
    };
    // The player.
    let x = 0, y = 0, angle = 0;
    const L = world.layout;
    if (arrival && arrival.fromSystem != null) {
      const gate = L.gates.find((g) => g.to === arrival.fromSystem) || L.gates[0];
      angle = gate.angle + Math.PI;
      x = gate.x + Math.cos(angle) * 220; y = gate.y + Math.sin(angle) * 220;
    } else {
      const st = L.stations.find((s) => s.id === (arrival?.station || career.docked)) || L.stations[0];
      if (st) { angle = Math.atan2(st.y, st.x); x = st.x + Math.cos(angle) * 90; y = st.y + Math.sin(angle) * 90; }
      else { x = 0; y = -900; }
    }
    world.player = makeShip(world, career, { name: career.ship.name, faction: career.faction, role: "player", loadout: career.ship, x, y, angle,
      isPlayer: true, damage: career.ship.damage, ammo: career.ship.ammo });
    populate(world, career);
    return world;
  }

  function populate(world, career) {
    const L = world.layout, war = career.war;
    const owners = [...new Set(L.stations.filter((s) => s.kind === "colony").map((s) => s.faction))].sort((a, b) => a - b);
    const den = L.stations.find((s) => s.kind === "den");
    const front = U.isFront(career, world.system);
    // Patrols guard their stations.
    for (const faction of owners) {
      const posts = L.stations.filter((s) => s.faction === faction);
      const tech = war.empires[faction].tech, count = Math.min(3, posts.length + (posts.some((s) => s.capital) ? 1 : 0));
      for (let i = 0; i < count; i++) {
        const post = posts[i % posts.length], a = unit(world) * Math.PI * 2;
        spawnNpc(world, career, { faction, role: "patrol", hull: tech.armor >= 4 ? "Marauder" : tech.armor >= 2 ? "Gunboat" : "Kestrel",
          x: post.x + Math.cos(a) * 260, y: post.y + Math.sin(a) * 260, angle: a, home: { x: post.x, y: post.y }, mode: "guard", missiles: tech.weapons >= 2 });
      }
    }
    // Traders shuttle between gates and stations.
    const civil = L.stations.filter((s) => s.kind === "colony");
    if (civil.length && L.gates.length) for (let i = 0, n = 1 + below(world, 3); i < n; i++) spawnTrader(world, career, true);
    // Outlaws: dens swarm, empty space is risky, fronts and cores less so.
    let outlaws = den ? 3 : !owners.length ? 1 + below(world, 2) : front ? (below(world, 3) === 0 ? 1 : 0) : (below(world, 5) === 0 ? 1 : 0);
    // War raiders on the fronts.
    if (front && owners.length) {
      const table = War.routesFor(war.galaxy);
      const enemies = [...new Set(table.adj[world.system].map(({ to }) => U.systemOwner(career, to)).filter((o) => o >= 0 && !owners.includes(o)))].sort((a, b) => a - b);
      if (enemies.length && below(world, 2) === 0) {
        const enemy = enemies[below(world, enemies.length)], gate = L.gates[below(world, L.gates.length)];
        for (let i = 0, n = 1 + below(world, 2); i < n; i++) spawnNpc(world, career, { faction: enemy, role: "raider", hull: "Gunboat", x: gate.x * 0.85 + i * 60, y: gate.y * 0.85, angle: gate.angle + Math.PI, mode: "hunt" });
      }
    }
    // Missions targeting this system.
    for (const m of career.missions) {
      if (m.status !== "active" || m.targetSystem !== world.system) continue;
      const spot = randomSpot(world, 1400);
      if (m.type === "bounty") {
        spawnNpc(world, career, { faction: -1, clan: m.targetClan, role: "pirate", hull: "Shade", name: m.targetName, missionId: m.id, x: spot.x, y: spot.y, mode: "hunt", missiles: true, loot: { credits: 600 } });
        spawnNpc(world, career, { faction: -1, clan: m.targetClan, role: "pirate", hull: "Kestrel", x: spot.x + 80, y: spot.y + 60, mode: "hunt" });
      } else if (m.type === "patrol") outlaws = Math.max(outlaws, m.count - m.progress + 1);
      else if (m.type === "war") {
        for (let i = 0; i < m.count - m.progress + 1; i++) spawnNpc(world, career, { faction: m.targetFaction, role: "raider", hull: i ? "Kestrel" : "Gunboat", x: spot.x + i * 90, y: spot.y, mode: "hunt" });
      }
    }
    for (let i = 0; i < outlaws; i++) {
      const clan = den ? den.clan : below(world, career.data.outlaws.length), spot = den ? { x: den.x + (unit(world) - 0.5) * 500, y: den.y + (unit(world) - 0.5) * 500 } : randomSpot(world, 1700);
      spawnNpc(world, career, { faction: -1, clan, role: "pirate", hull: ["Skiff", "Kestrel", "Shade"][below(world, 3)], x: spot.x, y: spot.y, mode: "hunt",
        home: den ? { x: den.x, y: den.y } : spot, loot: { credits: 80 + below(world, 220) } });
    }
  }
  function randomSpot(world, radius) {
    const a = unit(world) * Math.PI * 2, r = radius * (0.5 + unit(world) * 0.5);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  function spawnTrader(world, career, anywhere) {
    const L = world.layout, civil = L.stations.filter((s) => s.kind === "colony");
    if (!civil.length || !L.gates.length) return null;
    const dest = civil[below(world, civil.length)], gate = L.gates[below(world, L.gates.length)];
    const start = anywhere ? randomSpot(world, 1800) : { x: gate.x * 0.93, y: gate.y * 0.93 };
    const goods = career.data.commodities.filter((c) => !c.illegal);
    const loot = { commodity: goods[below(world, goods.length)].index, qty: 2 + below(world, 5) };
    return spawnNpc(world, career, { faction: dest.faction, role: "trader", hull: below(world, 3) === 0 ? "Bulk Hauler" : "Wayfarer", x: start.x, y: start.y,
      angle: Math.atan2(dest.y - start.y, dest.x - start.x), waypoint: { kind: "station", id: dest.id, x: dest.x, y: dest.y }, mode: "travel", loot });
  }

  // ---------------------------------------------------------------------
  // Hostility.
  // ---------------------------------------------------------------------
  function hostile(world, career, a, b) {
    if (a === b || !a.alive || !b.alive) return false;
    if (a.aggro.includes(b.id) || b.aggro.includes(a.id)) return true;
    if (a.isPlayer || b.isPlayer) {
      const other = a.isPlayer ? b : a;
      if (other.faction < 0) return career.outlawRep < 25;
      return U.hostileToPlayer(career, other.faction);
    }
    if (a.faction === b.faction) return false;
    if (a.role === "trader" && b.role === "trader") return false;
    return true; // outlaws prey on everyone; every empire is at war with every other
  }

  // ---------------------------------------------------------------------
  // Brains (10 Hz).
  // ---------------------------------------------------------------------
  function steer(ship, tx, ty, arrive) {
    const dx = tx - ship.x, dy = ty - ship.y, dist = Math.hypot(dx, dy);
    const delta = wrap(Math.atan2(dy, dx) - ship.angle);
    ship.ctl.turn = clamp(delta * 2.5, -1, 1);
    let thrust = Math.abs(delta) < 0.7 ? 1 : 0.25;
    if (arrive && dist < 260) {
      const speed = Math.hypot(ship.vx, ship.vy);
      thrust = speed > dist * 0.7 ? 0 : thrust * 0.6;
      ship.ctl.reverse = speed > dist * 0.9 ? 1 : 0;
    } else ship.ctl.reverse = 0;
    ship.ctl.thrust = thrust;
    return dist;
  }

  function think(world, career, ship) {
    const c = ship.ctl;
    c.fire = false; c.missile = false; c.boost = false;
    const sensor = 1300 * (ship.stats.scanner || 1);
    // Target selection: keep a living, in-range hostile target, else the nearest.
    let target = ship.target != null ? world.ships.find((s) => s.id === ship.target && s.alive) : null;
    if (target && (!hostile(world, career, ship, target) || dist2(ship, target) > sensor * sensor * 1.4)) target = null;
    if (!target && ship.role !== "trader") {
      let best = null, bestD = sensor * sensor;
      for (const s of world.ships) {
        if (s === ship || !hostile(world, career, ship, s)) continue;
        if (ship.role === "patrol" && s.faction >= 0 && s.role === "trader" && !s.aggro.length) continue;
        const d = dist2(ship, s);
        if (d < bestD || (d === bestD && best && s.id < best.id)) { best = s; bestD = d; }
      }
      target = best;
    }
    ship.target = target ? target.id : null;
    // Taunts: an outlaw announces itself the first time it goes after the player.
    if (target && target.isPlayer && ship.faction < 0 && !ship.taunted) {
      ship.taunted = true;
      const taunts = career.data.outlaws[ship.clan].taunts;
      world.events.push({ type: "comms", from: ship.name, faction: ship.faction, clan: ship.clan, text: taunts[below(world, taunts.length)] });
    }
    const hullFrac = ship.hull / ship.stats.hull;
    if (ship.role === "trader") {
      const threat = world.ships.find((s) => s.alive && s !== ship && s.target === ship.id && dist2(s, ship) < 700 * 700);
      if (threat) {
        c.boost = ship.energy > 30;
        steer(ship, ship.x + (ship.x - threat.x), ship.y + (ship.y - threat.y), false);
        return;
      }
      return travel(world, career, ship);
    }
    if (target) {
      if (ship.faction < 0 && hullFrac < 0.3) { // outlaws break off when beaten
        const gate = nearestGate(world, ship);
        c.boost = ship.energy > 20;
        steer(ship, gate.x, gate.y, false);
        ship.waypoint = { kind: "gate", x: gate.x, y: gate.y };
        ship.mode = "flee";
        return;
      }
      const weapon = ship.stats.weapons.find((w) => w.kind !== "missile") || ship.stats.weapons[0];
      const speed = weapon ? weapon.speed : 900, range = weapon ? weapon.range : 600;
      const dist = Math.sqrt(dist2(ship, target));
      const lead = dist / speed;
      const aimX = target.x + (target.vx - ship.vx) * lead, aimY = target.y + (target.vy - ship.vy) * lead;
      const desired = Math.atan2(aimY - ship.y, aimX - ship.x), delta = wrap(desired - ship.angle);
      c.turn = clamp(delta * 3, -1, 1);
      c.thrust = dist > range * 0.55 ? 1 : dist < range * 0.25 ? 0 : 0.35;
      c.reverse = dist < range * 0.18 ? 1 : 0;
      c.fire = Math.abs(delta) < 0.16 && dist < range * 0.95;
      c.missile = ship.ammo > 0 && dist < 1100 && Math.abs(delta) < 0.5 && below(world, 30) === 0;
      c.boost = dist > range * 1.6 && ship.energy > 60;
      return;
    }
    if (ship.mode === "flee" && ship.waypoint) {
      const d = steer(ship, ship.waypoint.x, ship.waypoint.y, false);
      if (d < GATE_RANGE) ship.alive = false; // jumped out
      return;
    }
    if (ship.role === "patrol" || ship.role === "pirate") {
      // Loiter around home in a slow circle.
      const t = world.tick / 60 * 0.15 + ship.id;
      steer(ship, ship.home.x + Math.cos(t) * 320, ship.home.y + Math.sin(t) * 320, false);
      c.thrust *= 0.5;
      return;
    }
    // Raiders without targets drift toward the system's stations.
    const st = world.layout.stations.find((s) => s.faction !== ship.faction);
    if (st) steer(ship, st.x, st.y, true); else { c.thrust = 0; c.turn = 0; }
  }

  function travel(world, career, ship) {
    const wp = ship.waypoint;
    if (!wp) { ship.ctl.thrust = 0; return; }
    const d = steer(ship, wp.x, wp.y, wp.kind === "station");
    if (wp.kind === "station" && d < 90) {
      // Trade done: leave through a gate.
      const gate = world.layout.gates[below(world, Math.max(1, world.layout.gates.length))];
      ship.waypoint = gate ? { kind: "gate", x: gate.x, y: gate.y } : null;
    } else if (wp.kind === "gate" && d < GATE_RANGE) ship.alive = false;
  }

  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  function nearestGate(world, ship) {
    let best = world.layout.gates[0], bestD = Infinity;
    for (const g of world.layout.gates) { const d = (g.x - ship.x) ** 2 + (g.y - ship.y) ** 2; if (d < bestD) { best = g; bestD = d; } }
    return best || { x: ship.x * 2, y: ship.y * 2 };
  }

  // ---------------------------------------------------------------------
  // Physics and weapons.
  // ---------------------------------------------------------------------
  function integrate(world, ship, assist) {
    const s = ship.stats, c = ship.ctl;
    ship.boosting = Boolean(c.boost) && ship.energy > 5 && (c.thrust > 0);
    if (ship.boosting) ship.energy = Math.max(0, ship.energy - 28 * DT);
    ship.angle = wrap(ship.angle + clamp(c.turn, -1, 1) * s.turn * DT);
    const fx = Math.cos(ship.angle), fy = Math.sin(ship.angle);
    const accel = s.thrust * (ship.boosting ? 1.7 : 1);
    ship.thrusting = c.thrust > 0.05;
    ship.vx += fx * accel * clamp(c.thrust, 0, 1) * DT - fx * accel * 0.55 * clamp(c.reverse, 0, 1) * DT;
    ship.vy += fy * accel * clamp(c.thrust, 0, 1) * DT - fy * accel * 0.55 * clamp(c.reverse, 0, 1) * DT;
    if (assist) {
      // Flight assist: bleed sideways slip, keep forward momentum.
      const forward = ship.vx * fx + ship.vy * fy, lateral = -ship.vx * fy + ship.vy * fx;
      const keepLat = Math.exp(-3.2 * DT), keepFwd = c.thrust > 0.05 ? 1 : Math.exp(-0.4 * DT);
      const f = forward * keepFwd, l = lateral * keepLat;
      ship.vx = f * fx - l * fy; ship.vy = f * fy + l * fx;
    }
    const max = s.speed * (ship.boosting ? 1.5 : 1), speed = Math.hypot(ship.vx, ship.vy);
    if (speed > max) { ship.vx *= max / speed; ship.vy *= max / speed; }
    ship.x += ship.vx * DT; ship.y += ship.vy * DT;
    // Soft system boundary.
    const r = Math.hypot(ship.x, ship.y), edge = SYSTEM_RADIUS * 1.18;
    if (r > edge) { ship.vx -= ship.x / r * 600 * DT; ship.vy -= ship.y / r * 600 * DT; }
    ship.energy = Math.min(s.energy, ship.energy + s.energyRegen * DT * (ship.boosting ? 0 : 1));
    if (world.tick - ship.lastHit > 120) ship.shield = Math.min(s.shield, ship.shield + s.regen * DT);
    if (s.repair) ship.hull = Math.min(s.hull, ship.hull + s.repair * DT);
  }

  function fireWeapons(world, ship) {
    const c = ship.ctl, fx = Math.cos(ship.angle), fy = Math.sin(ship.angle);
    ship.stats.weapons.forEach((w, i) => {
      ship.cooldowns[i] = Math.max(0, ship.cooldowns[i] - DT);
      if (ship.cooldowns[i] > 0) return;
      if (w.kind === "missile") {
        if (!c.missile || ship.ammo <= 0 || ship.target == null) return;
        ship.ammo--;
        ship.cooldowns[i] = 1 / w.rate;
        world.missiles.push({ id: world.nextId++, owner: ship.id, faction: ship.faction, target: ship.target, x: ship.x + fx * ship.stats.radius, y: ship.y + fy * ship.stats.radius,
          px: ship.x, py: ship.y, angle: ship.angle, speed: w.speed, life: w.range / w.speed + 0.6, damage: Math.round(w.damage * ship.damageScale / 100), pierce: 0 });
        world.events.push({ type: "missile", owner: ship.id });
        return;
      }
      if (!c.fire || ship.energy < w.energy) return;
      ship.energy -= w.energy;
      ship.cooldowns[i] = 1 / w.rate;
      const side = ship.stats.weapons.length > 1 ? (i % 2 ? 1 : -1) * ship.stats.radius * 0.35 : 0;
      const x = ship.x + fx * ship.stats.radius - fy * side, y = ship.y + fy * ship.stats.radius + fx * side;
      world.shots.push({ id: world.nextId++, owner: ship.id, faction: ship.faction, kind: w.kind, x, y, px: x, py: y,
        vx: ship.vx + fx * w.speed, vy: ship.vy + fy * w.speed, life: w.range / w.speed, damage: Math.round(w.damage * ship.damageScale / 100), pierce: w.pierce });
      if (ship.isPlayer) world.events.push({ type: "fire", kind: w.kind });
    });
  }

  // ---------------------------------------------------------------------
  // Collisions. OPT-REDUCE-001 broad-phase with an all-pairs reference.
  // A shot hits the ship whose circle its swept segment enters first (lowest
  // parameter t, then lowest id), never its owner or the owner's faction.
  // ---------------------------------------------------------------------
  function segmentHit(px, py, x, y, ship) {
    const dx = x - px, dy = y - py, fx = px - ship.x, fy = py - ship.y, r = ship.stats.radius;
    const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
    if (c <= 0) return 0;
    if (a === 0) return null;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : null;
  }
  function eligible(world, shot, ship) {
    if (!ship.alive || ship.id === shot.owner) return false;
    const owner = shot.ownerShip;
    // No friendly fire inside a faction; the player can hit anyone (and pays for it).
    if (owner && owner.isPlayer) return true;
    if (ship.isPlayer) return true;
    return ship.faction !== shot.faction;
  }
  function buildGrid(world) {
    const grid = world.grid;
    grid.clear();
    for (const s of world.ships) {
      if (!s.alive) continue;
      const key = `${Math.floor(s.x / CELL)},${Math.floor(s.y / CELL)}`;
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(s);
    }
  }
  function collideGrid(world, shot) {
    const pad = MAX_SHIP_RADIUS;
    const x0 = Math.floor((Math.min(shot.px, shot.x) - pad) / CELL), x1 = Math.floor((Math.max(shot.px, shot.x) + pad) / CELL);
    const y0 = Math.floor((Math.min(shot.py, shot.y) - pad) / CELL), y1 = Math.floor((Math.max(shot.py, shot.y) + pad) / CELL);
    let best = null, bestT = Infinity, tested = 0;
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const list = world.grid.get(`${cx},${cy}`);
      if (!list) continue;
      for (const ship of list) {
        if (!eligible(world, shot, ship)) continue;
        tested++;
        const t = segmentHit(shot.px, shot.py, shot.x, shot.y, ship);
        if (t !== null && (t < bestT || (t === bestT && ship.id < best.id))) { best = ship; bestT = t; }
      }
    }
    world.tested = (world.tested || 0) + tested;
    return best;
  }
  /** Reference path: every ship, no grid. */
  function collideBrute(world, shot) {
    let best = null, bestT = Infinity;
    for (const ship of world.ships) {
      if (!eligible(world, shot, ship)) continue;
      const t = segmentHit(shot.px, shot.py, shot.x, shot.y, ship);
      if (t !== null && (t < bestT || (t === bestT && ship.id < best.id))) { best = ship; bestT = t; }
    }
    return best;
  }

  function damage(world, career, ship, amount, pierce, attacker) {
    const through = Math.floor(amount * pierce / 100), rest = amount - through;
    const absorbed = Math.min(ship.shield, rest);
    ship.shield -= absorbed;
    ship.hull -= through + rest - absorbed;
    ship.lastHit = world.tick;
    if (attacker && attacker !== ship) {
      if (!ship.aggro.includes(attacker.id)) {
        ship.aggro.push(attacker.id);
        // The player's first hit on a non-hostile ship is an act of aggression.
        if (attacker.isPlayer && !hostile(world, career, ship, attacker)) world.events.push({ type: "aggression", faction: ship.faction, name: ship.name });
        // Everyone in the victim's faction now treats the attacker as hostile.
        for (const s of world.ships) if (s.faction === ship.faction && !s.isPlayer && !s.aggro.includes(attacker.id) && s.role !== "trader") s.aggro.push(attacker.id);
      }
      if (!ship.isPlayer && ship.role !== "trader") ship.target = attacker.id;
    }
    world.events.push({ type: "hit", target: ship.id, shield: absorbed > 0, player: ship.isPlayer, by: attacker ? attacker.id : null });
    if (ship.hull <= 0 && ship.alive) destroy(world, career, ship, attacker);
  }

  function destroy(world, career, ship, killer) {
    ship.alive = false;
    world.effects.push({ type: "explosion", x: ship.x, y: ship.y, radius: ship.stats.radius * 3, life: 1, color: "#ffb35c" });
    if (ship.isPlayer) { world.playerDead = true; world.events.push({ type: "destroyed" }); return; }
    world.events.push({ type: "kill", victim: { id: ship.id, name: ship.name, faction: ship.faction, clan: ship.clan, role: ship.role, missionId: ship.missionId }, byPlayer: Boolean(killer && killer.isPlayer) });
    // Loot canisters.
    if (ship.loot) {
      const drop = { id: world.nextId++, x: ship.x, y: ship.y, vx: ship.vx * 0.3, vy: ship.vy * 0.3, life: 75, ...ship.loot };
      world.pickups.push(drop);
    }
  }

  function updateShots(world, career) {
    let alive = 0;
    for (const s of world.ships) if (s.alive) alive++;
    const useGrid = alive >= GRID_MIN_SHIPS && (world.shots.length + world.missiles.length) > 0;
    if (useGrid) buildGrid(world);
    const collide = useGrid ? collideGrid : collideBrute;
    const byId = new Map(world.ships.map((s) => [s.id, s]));
    for (const shot of world.shots) {
      shot.px = shot.x; shot.py = shot.y;
      shot.x += shot.vx * DT; shot.y += shot.vy * DT;
      shot.life -= DT;
      shot.ownerShip = byId.get(shot.owner) || null;
      const hit = collide(world, shot);
      if (hit) { damage(world, career, hit, shot.damage, shot.pierce, shot.ownerShip); shot.life = 0; world.effects.push({ type: "spark", x: shot.x, y: shot.y, life: 0.25, color: hit.shield > 0 ? "#8fe3ff" : "#ffd27a" }); }
    }
    world.shots = world.shots.filter((s) => s.life > 0);
    for (const m of world.missiles) {
      const target = byId.get(m.target);
      if (target && target.alive) {
        const desired = Math.atan2(target.y - m.y, target.x - m.x);
        m.angle = wrap(m.angle + clamp(wrap(desired - m.angle), -3.4 * DT, 3.4 * DT));
      }
      m.px = m.x; m.py = m.y;
      m.x += Math.cos(m.angle) * m.speed * DT; m.y += Math.sin(m.angle) * m.speed * DT;
      m.life -= DT;
      m.ownerShip = byId.get(m.owner) || null;
      const hit = collide(world, m);
      if (hit) { damage(world, career, hit, m.damage, 0, m.ownerShip); m.life = 0; world.effects.push({ type: "explosion", x: m.x, y: m.y, radius: 40, life: 0.6, color: "#ff8a4c" }); }
    }
    world.missiles = world.missiles.filter((m) => m.life > 0);
  }

  function stationTurrets(world, career) {
    world.turretClock += DT;
    if (world.turretClock < 0.5) return;
    world.turretClock = 0;
    for (const st of world.layout.stations) {
      let target = null, bestD = 720 * 720;
      for (const s of world.ships) {
        if (!s.alive) continue;
        let foe;
        if (st.kind === "den") foe = s.isPlayer ? career.outlawRep <= -90 : s.faction >= 0 && s.role !== "trader" && s.aggro.length > 0;
        else foe = s.isPlayer ? U.hostileToPlayer(career, st.faction) || s.aggro.length > 0 && world.ships.some((o) => o.faction === st.faction && o.aggro.includes(s.id))
          : s.faction < 0 || (s.faction !== st.faction && s.role !== "trader");
        if (!foe) continue;
        const d = (s.x - st.x) ** 2 + (s.y - st.y) ** 2;
        if (d < bestD) { target = s; bestD = d; }
      }
      if (!target) continue;
      const a = Math.atan2(target.y - st.y, target.x - st.x), speed = 1100;
      world.shots.push({ id: world.nextId++, owner: -1, faction: st.faction, kind: "turret", x: st.x, y: st.y, px: st.x, py: st.y,
        vx: Math.cos(a) * speed + target.vx * 0.6, vy: Math.sin(a) * speed + target.vy * 0.6, life: 0.8, damage: 14, pierce: 0 });
    }
  }

  function updatePickups(world) {
    const p = world.player;
    for (const k of world.pickups) {
      k.x += k.vx * DT; k.y += k.vy * DT; k.vx *= 0.995; k.vy *= 0.995; k.life -= DT;
      if (p.alive && (k.x - p.x) ** 2 + (k.y - p.y) ** 2 < SCOOP_RANGE * SCOOP_RANGE) {
        k.life = 0;
        world.events.push({ type: "loot", credits: k.credits || 0, commodity: k.commodity ?? null, qty: k.qty || 0 });
      }
    }
    world.pickups = world.pickups.filter((k) => k.life > 0);
  }

  function spawnArrivals(world, career) {
    world.spawnClock += DT;
    if (world.spawnClock < 35) return;
    world.spawnClock = 0;
    const npcs = world.ships.filter((s) => s.alive && !s.isPlayer).length;
    if (npcs >= NPC_CAP) return;
    if (below(world, 3) === 0 && world.layout.gates.length) {
      const gate = world.layout.gates[below(world, world.layout.gates.length)];
      const clan = below(world, career.data.outlaws.length);
      spawnNpc(world, career, { faction: -1, clan, role: "pirate", hull: ["Skiff", "Kestrel", "Shade"][below(world, 3)], x: gate.x * 0.92, y: gate.y * 0.92,
        angle: gate.angle + Math.PI, mode: "hunt", home: { x: gate.x * 0.6, y: gate.y * 0.6 }, loot: { credits: 80 + below(world, 220) } });
    } else spawnTrader(world, career, false);
  }

  /** Advance one fixed step. input applies to the player's ship. */
  function step(world, career, input) {
    world.tick++;
    const p = world.player;
    if (p.alive) {
      Object.assign(p.ctl, { turn: input.turn || 0, thrust: input.thrust || 0, reverse: input.reverse || 0, boost: Boolean(input.boost), fire: Boolean(input.fire), missile: Boolean(input.missile) });
      if (input.target !== undefined) p.target = input.target;
    }
    for (const s of world.ships) {
      if (!s.alive || s.isPlayer) continue;
      if ((world.tick + s.thinkPhase) % THINK_EVERY === 0) think(world, career, s);
    }
    for (const s of world.ships) {
      if (!s.alive) continue;
      integrate(world, s, s.isPlayer ? input.assist !== false : true);
      fireWeapons(world, s);
    }
    stationTurrets(world, career);
    updateShots(world, career);
    updatePickups(world);
    spawnArrivals(world, career);
    for (const e of world.effects) e.life -= DT;
    world.effects = world.effects.filter((e) => e.life > 0);
    world.ships = world.ships.filter((s) => s.alive || s.isPlayer);
  }

  // ---------------------------------------------------------------------
  // Player helpers.
  // ---------------------------------------------------------------------
  function dockable(world) {
    const p = world.player, speed = Math.hypot(p.vx, p.vy);
    for (const st of world.layout.stations) if ((st.x - p.x) ** 2 + (st.y - p.y) ** 2 < DOCK_RANGE * DOCK_RANGE) return { station: st, slow: speed < DOCK_SPEED };
    return null;
  }
  function jumpable(world) {
    const p = world.player, speed = Math.hypot(p.vx, p.vy);
    for (const g of world.layout.gates) if ((g.x - p.x) ** 2 + (g.y - p.y) ** 2 < GATE_RANGE * GATE_RANGE) return { gate: g, slow: speed < GATE_SPEED };
    return null;
  }
  function hostilesNear(world, career, radius) {
    const p = world.player;
    return world.ships.filter((s) => s.alive && !s.isPlayer && hostile(world, career, p, s) && dist2(p, s) < radius * radius);
  }
  function nextTarget(world, career, direction, hostileOnly) {
    const p = world.player;
    const list = world.ships.filter((s) => s.alive && !s.isPlayer && (!hostileOnly || hostile(world, career, p, s))).sort((a, b) => dist2(p, a) - dist2(p, b) || a.id - b.id);
    if (!list.length) return null;
    if (hostileOnly) return list[0].id;
    const i = list.findIndex((s) => s.id === p.target);
    return list[(i + (direction || 1) + list.length) % list.length].id;
  }
  /** Copy the player's persistent ship state back to the career. */
  function persist(world, career) {
    const p = world.player;
    career.ship.damage = Math.max(0, Math.round(p.stats.hull - Math.max(0, p.hull)));
    career.ship.ammo = p.ammo;
  }
  /** Autopilot: steering for the player toward a point (used by the J key). */
  function autopilot(world, x, y) {
    const p = world.player, save = { ...p.ctl };
    steer(p, x, y, true);
    const out = { turn: p.ctl.turn, thrust: p.ctl.thrust, reverse: p.ctl.reverse };
    Object.assign(p.ctl, save);
    return out;
  }

  return Object.freeze({
    DT, SYSTEM_RADIUS, CELL, NPC_CAP, GRID_MIN_SHIPS, PLANET_COLORS, DOCK_RANGE, GATE_RANGE,
    createFlight, step, layout, hostile, dockable, jumpable, hostilesNear, nextTarget, persist, autopilot,
    collideGrid, collideBrute, buildGrid, segmentHit, factionColor, factionName, spawnNpc, makeShip,
  });
});
