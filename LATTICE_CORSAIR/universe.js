/* LATTICE CORSAIR universe and career layer.
 *
 * The galaxy, its five empires, their colonies and their war are a live
 * SOVEREIGN LATTICE game (../SOVEREIGN_LATTICE/core.js) played entirely by its
 * AI in the background. Every colony is a station you can dock at; outlaw dens
 * hide in a few systems. This layer owns the captain's career: days, credits,
 * ship and loadout, cargo, markets, missions, reputation, travel, news, death
 * and saves. Pure and deterministic: no DOM, clock or ambient randomness.
 *
 * OPT (QSOLKCB/OPT at 7556dd36): market price tables are signature-bound
 * (OPT-INC-001) to the station, the career's monotonic version and the war's
 * monotonic version; tests compare every cached table with a fresh one.
 */
(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CorsairUniverse = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const War = (typeof module === "object" && module.exports) ? require("../SOVEREIGN_LATTICE/core.js") : root.SovereignCore;
  const FORMAT = 1;
  const DAYS_PER_WAR_TURN = 2;
  const PRELUDE_TURNS = 24;
  const MAX_MISSIONS = 4;
  const HOSTILE_REP = -25;
  const BARRED_REP = -50;
  const DIFFICULTIES = Object.freeze({
    relaxed: { credits: 4000, insurance: 10, reward: 120, enemy: 80 },
    standard: { credits: 2500, insurance: 15, reward: 100, enemy: 100 },
    ironclad: { credits: 1500, insurance: 25, reward: 90, enemy: 125 },
  });
  const KINDS = Object.freeze(["laser", "cannon", "missile", "shield", "armor", "engine", "cargo", "scanner", "repair", "capacitor"]);
  const WEAPON_KINDS = Object.freeze(["laser", "cannon", "missile"]);
  const PLANET_TYPES = Object.freeze(["terran", "ocean", "tundra", "volcanic", "arid", "barren", "gas", "asteroid"]);
  const SUFFIX = Object.freeze({ terran: "Port", ocean: "Harbour", tundra: "Hold", volcanic: "Forge", arid: "Exchange", barren: "Depot", gas: "Skimworks", asteroid: "Rockyard" });

  const hashText = War.hashText;
  const hash = (...parts) => hashText(parts.join("|"));
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  function int(value, name) {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${name || "value"} must be a safe integer, got ${value}`);
    return value === 0 ? 0 : value;
  }

  // ---------------------------------------------------------------------
  // Data files.
  // ---------------------------------------------------------------------
  function dataError(file, block, message) { return new Error(`${file} (block at line ${block.line}): ${message}`); }
  function need(file, b, key) { const v = b.fields[key]; if (v === undefined || v === "") throw dataError(file, b, `missing ${key}`); return v; }
  function num(file, b, key, lo, hi, optional) {
    const text = b.fields[key];
    if ((text === undefined || text === "") && optional !== undefined) return optional;
    if (!/^-?\d+(\.\d+)?$/.test(need(file, b, key))) throw dataError(file, b, `${key} must be a number`);
    const v = Number(text);
    if (v < lo || v > hi) throw dataError(file, b, `${key} must be ${lo}..${hi}`);
    return v;
  }
  const list = (text, sep = ",") => String(text || "").split(sep).map((s) => s.trim()).filter(Boolean);
  const yes = (file, b, key) => {
    const v = need(file, b, key).toLowerCase();
    if (v !== "yes" && v !== "no") throw dataError(file, b, `${key} must be yes or no`);
    return v === "yes";
  };
  function requirement(file, b) {
    const text = need(file, b, "Requires").toLowerCase();
    if (text === "none") return null;
    const m = /^([a-z]+)\s+(\d+)$/.exec(text);
    if (!m || !War.FIELDS.includes(m[1])) throw dataError(file, b, `Requires must be "none" or "<field> <level>"`);
    return Object.freeze({ field: m[1], level: Number(m[2]) });
  }
  function planetList(file, b, key) {
    const text = need(file, b, key).toLowerCase();
    if (text === "none") return Object.freeze([]);
    const types = list(text);
    for (const t of types) if (!PLANET_TYPES.includes(t)) throw dataError(file, b, `${key}: unknown planet type ${t}`);
    return Object.freeze(types);
  }

  /** Parse and validate LATTICE CORSAIR's own data files. */
  function parseData(texts, warData) {
    const blocks = (name, type) => {
      if (typeof texts[name] !== "string") throw new Error(`Missing data file ${name}`);
      return War.parseBlocks(texts[name], name).map((b) => { if (b.type !== type) throw dataError(name, b, `expected [${type}], found [${b.type}]`); return b; });
    };
    const ships = blocks("SHIPS.TXT", "SHIP").map((b, index) => Object.freeze({
      index, name: need("SHIPS.TXT", b, "Name"), skin: need("SHIPS.TXT", b, "Skin"), hull: num("SHIPS.TXT", b, "Hull", 1, 100000),
      speed: num("SHIPS.TXT", b, "Speed", 10, 5000), thrust: num("SHIPS.TXT", b, "Thrust", 10, 20000), turn: num("SHIPS.TXT", b, "Turn", 0.1, 20),
      radius: num("SHIPS.TXT", b, "Radius", 4, 200), weapons: num("SHIPS.TXT", b, "Weapons", 0, 8), utility: num("SHIPS.TXT", b, "Utility", 0, 10),
      cargo: num("SHIPS.TXT", b, "Cargo", 0, 10000), cost: num("SHIPS.TXT", b, "Cost", 0, 1e9), description: b.fields.Description || "",
    }));
    if (!ships.length || ships[0].cost !== 0) throw new Error("SHIPS.TXT: the first ship must be the Cost = 0 insurer's loaner");
    const equipment = blocks("EQUIPMENT.TXT", "EQUIPMENT").map((b, index) => {
      const kind = need("EQUIPMENT.TXT", b, "Kind").toLowerCase();
      if (!KINDS.includes(kind)) throw dataError("EQUIPMENT.TXT", b, `Kind must be one of ${KINDS.join(", ")}`);
      const weapon = WEAPON_KINDS.includes(kind);
      return Object.freeze({
        index, name: need("EQUIPMENT.TXT", b, "Name"), kind, weapon, cost: num("EQUIPMENT.TXT", b, "Cost", 0, 1e9), requires: requirement("EQUIPMENT.TXT", b),
        damage: weapon ? num("EQUIPMENT.TXT", b, "Damage", 0, 100000) : 0, rate: weapon ? num("EQUIPMENT.TXT", b, "Rate", 0.05, 60) : 0,
        speed: weapon ? num("EQUIPMENT.TXT", b, "Speed", 10, 100000) : 0, range: weapon ? num("EQUIPMENT.TXT", b, "Range", 10, 100000) : 0,
        energy: weapon ? num("EQUIPMENT.TXT", b, "Energy", 0, 10000) : 0, pierce: weapon ? num("EQUIPMENT.TXT", b, "Pierce", 0, 100) : 0,
        ammo: kind === "missile" ? num("EQUIPMENT.TXT", b, "Ammo", 1, 1000) : 0,
        value: weapon ? 0 : num("EQUIPMENT.TXT", b, "Value", 0, 100000), regen: kind === "shield" ? num("EQUIPMENT.TXT", b, "Regen", 0, 10000) : 0,
        description: b.fields.Description || "",
      });
    });
    const starterWeapon = equipment.find((e) => e.weapon && e.cost === 0), starterShield = equipment.find((e) => e.kind === "shield" && e.cost === 0);
    if (!starterWeapon || !starterShield) throw new Error("EQUIPMENT.TXT needs a Cost = 0 weapon and shield for the loaner");
    const commodities = blocks("COMMODITIES.TXT", "COMMODITY").map((b, index) => Object.freeze({
      index, name: need("COMMODITIES.TXT", b, "Name"), base: num("COMMODITIES.TXT", b, "Base", 1, 1e6),
      produced: planetList("COMMODITIES.TXT", b, "Produced"), consumed: planetList("COMMODITIES.TXT", b, "Consumed"),
      war: yes("COMMODITIES.TXT", b, "War"), illegal: yes("COMMODITIES.TXT", b, "Illegal"), description: b.fields.Description || "",
    }));
    const outlaws = blocks("OUTLAWS.TXT", "OUTLAW").map((b, index) => {
      const color = need("OUTLAWS.TXT", b, "Color");
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw dataError("OUTLAWS.TXT", b, "Color must look like #a1b2c3");
      return Object.freeze({ index, name: need("OUTLAWS.TXT", b, "Name"), color: color.toLowerCase(),
        shipNames: Object.freeze(list(need("OUTLAWS.TXT", b, "ShipNames"))), taunts: Object.freeze(list(need("OUTLAWS.TXT", b, "Taunts"), "|")) });
    });
    if (!outlaws.length) throw new Error("OUTLAWS.TXT needs at least one clan");
    const missions = blocks("MISSIONS.TXT", "MISSION").map((b) => {
      const type = need("MISSIONS.TXT", b, "Type").toLowerCase();
      if (!["bounty", "courier", "patrol", "war"].includes(type)) throw dataError("MISSIONS.TXT", b, "Type must be bounty, courier, patrol or war");
      return Object.freeze({ type, title: need("MISSIONS.TXT", b, "Title"), brief: need("MISSIONS.TXT", b, "Brief") });
    });
    for (const type of ["bounty", "courier", "patrol", "war"]) if (!missions.some((m) => m.type === type)) throw new Error(`MISSIONS.TXT needs a ${type} mission`);
    const nameBlocks = blocks("PILOTNAMES.TXT", "NAMES");
    if (nameBlocks.length !== 1) throw new Error("PILOTNAMES.TXT needs exactly one [NAMES] block");
    const pilotNames = Object.freeze({ given: Object.freeze(list(need("PILOTNAMES.TXT", nameBlocks[0], "Given"))), family: Object.freeze(list(need("PILOTNAMES.TXT", nameBlocks[0], "Family"))) });
    return Object.freeze({
      ships: Object.freeze(ships), equipment: Object.freeze(equipment), commodities: Object.freeze(commodities), outlaws: Object.freeze(outlaws),
      missions: Object.freeze(missions), pilotNames, war: warData,
      signature: hashText(Object.keys(texts).sort().map((k) => `${k}\n${texts[k]}`).join("\n") + `|${warData.signature}`),
    });
  }

  // ---------------------------------------------------------------------
  // Career creation.
  // ---------------------------------------------------------------------
  function attach(career, war, data) {
    Object.defineProperty(career, "war", { value: war, enumerable: false, writable: true, configurable: true });
    Object.defineProperty(career, "data", { value: data, enumerable: false, writable: true, configurable: true });
    return career;
  }

  function createCareer(options) {
    const data = options.data;
    const difficulty = DIFFICULTIES[options.difficulty] ? options.difficulty : "standard";
    const seed = War.normalizeSeed(options.seed);
    const faction = clamp(Math.trunc(options.faction ?? 0), 0, data.war.empires.length - 1);
    const war = War.createGame({ seed, size: "medium", rivals: 4, empire: faction, maxTurns: 1000, data: data.war });
    for (const e of war.empires) e.ai = true;
    for (let i = 0; i < PRELUDE_TURNS; i++) War.endTurn(war);
    // Outlaw dens: a few seeded systems away from every capital.
    const n = war.galaxy.systems.length, capitals = war.empires.map((e) => e.capital);
    const candidates = [];
    for (let s = 0; s < n; s++) {
      const far = Math.min(...capitals.map((c) => War.distance(war, c, s)));
      if (far > 260) candidates.push({ s, key: hash(seed, "den", s) });
    }
    candidates.sort((a, b) => a.key - b.key || a.s - b.s);
    const dens = candidates.slice(0, 3).map((c) => c.s).sort((a, b) => a - b);
    const home = War.coloniesOf(war, 0).find((c) => War.isCapital(war, c)) || War.coloniesOf(war, 0)[0];
    const loaner = loanerShip(data);
    const career = {
      kind: "lattice-corsair-save", format: FORMAT, dataSignature: data.signature, seed, difficulty,
      pilot: String(options.pilot || "Captain").trim().slice(0, 24) || "Captain", faction,
      day: 1, credits: DIFFICULTIES[difficulty].credits, version: 0, ship: loaner, cargo: {}, dens, glut: {},
      rep: war.empires.map((e) => (e.id === 0 ? 30 : 0)), outlawRep: -40,
      system: home.system, docked: stationIdOf(home), home: stationIdOf(home),
      missions: [], missionSeq: 1, completedMissions: [], news: [], stats: { kills: 0, jumps: 0, earned: 0, trades: 0, deaths: 0, missions: 0 },
      warTurnDay: 1,
    };
    attach(career, war, data);
    news(career, `${career.pilot} signs on as a freelance captain out of ${stationName(career, career.home)}.`);
    return career;
  }

  function loanerShip(data) {
    const weapon = data.equipment.find((e) => e.weapon && e.cost === 0), shield = data.equipment.find((e) => e.kind === "shield" && e.cost === 0);
    return { hull: 0, weapons: [weapon.index], utility: [shield.index], damage: 0, ammo: 0, name: "Loaner" };
  }

  // ---------------------------------------------------------------------
  // Stations.
  // ---------------------------------------------------------------------
  const stationIdOf = (colony) => `c${colony.id}`;
  function stationsIn(career, system) {
    const war = career.war, out = [];
    for (const c of war.colonies) {
      if (c.system !== system) continue;
      out.push(stationFromColony(career, c));
    }
    if (career.dens.includes(system)) out.push(denStation(career, system));
    return out;
  }
  function stationFromColony(career, c) {
    const war = career.war, sys = war.galaxy.systems[c.system], planet = sys.planets[c.planet];
    return { id: stationIdOf(c), kind: "colony", colony: c.id, system: c.system, planet: c.planet, type: planet.type, faction: c.owner,
      name: `${sys.name} ${War.roman(c.planet + 1)} ${SUFFIX[planet.type] || "Port"}`, capital: War.isCapital(war, c) };
  }
  function denStation(career, system) {
    const clan = career.data.outlaws[hash(career.seed, "clan", system) % career.data.outlaws.length];
    const sys = career.war.galaxy.systems[system];
    return { id: `d${system}`, kind: "den", system, planet: -1, type: "asteroid", faction: -1, clan: clan.index, name: `${clan.name} haven at ${sys.name}`, capital: false };
  }
  function station(career, id) {
    if (!id) return null;
    if (id[0] === "d") {
      const system = Number(id.slice(1));
      return career.dens.includes(system) ? denStation(career, system) : null;
    }
    const colony = career.war.colonies.find((c) => `c${c.id}` === id);
    return colony ? stationFromColony(career, colony) : null;
  }
  const stationName = (career, id) => station(career, id)?.name || "a lost station";

  // ---------------------------------------------------------------------
  // Reputation and hostility.
  // ---------------------------------------------------------------------
  function standing(career, faction) {
    return faction < 0 ? career.outlawRep : career.rep[faction];
  }
  const hostileToPlayer = (career, faction) => standing(career, faction) <= HOSTILE_REP;
  const barred = (career, st) => st.kind === "den" ? career.outlawRep <= -90 : career.rep[st.faction] <= BARRED_REP;
  function adjust(career, faction, delta) {
    if (faction < 0) career.outlawRep = clamp(career.outlawRep + delta, -100, 100);
    else career.rep[faction] = clamp(career.rep[faction] + delta, -100, 100);
    career.version++;
  }
  function standingLabel(value) {
    return value >= 60 ? "honoured" : value >= 25 ? "trusted" : value > HOSTILE_REP ? "neutral" : value > BARRED_REP ? "hostile" : "kill on sight";
  }

  /** Record a kill by the player. victim: { faction (-1 outlaws), system, missionId?, name }. */
  function recordKill(career, victim) {
    career.stats.kills++;
    const war = career.war;
    if (victim.faction < 0) {
      const owner = systemOwner(career, victim.system);
      if (owner >= 0) adjust(career, owner, 3);
      for (let e = 0; e < career.rep.length; e++) if (war.empires[e].alive && e !== owner) adjust(career, e, 1);
      adjust(career, -1, -2);
    } else {
      adjust(career, victim.faction, -12);
      for (let e = 0; e < career.rep.length; e++) if (e !== victim.faction && war.empires[e].alive) adjust(career, e, 2);
      adjust(career, -1, 2);
    }
    const paid = [];
    for (const m of career.missions) {
      if (m.status !== "active" || m.targetSystem !== victim.system) continue;
      if (m.type === "bounty" && victim.missionId === m.id) { m.progress = m.count; }
      else if (m.type === "patrol" && victim.faction < 0) m.progress++;
      else if (m.type === "war" && victim.faction === m.targetFaction) m.progress++;
      else continue;
      if (m.progress >= m.count) paid.push(completeMission(career, m));
    }
    career.version++;
    return paid;
  }
  function recordAggression(career, faction) {
    adjust(career, faction, faction < 0 ? -1 : -4);
  }

  function systemOwner(career, system) {
    const colonies = career.war.colonies.filter((c) => c.system === system);
    if (!colonies.length) return -1;
    const counts = new Map();
    for (const c of colonies) counts.set(c.owner, (counts.get(c.owner) || 0) + c.pop + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  }
  /** A system is a war front when a different empire holds a neighbouring system. */
  function isFront(career, system) {
    const owner = systemOwner(career, system);
    if (owner < 0) return false;
    const table = War.routesFor(career.war.galaxy);
    return table.adj[system].some(({ to }) => { const o = systemOwner(career, to); return o >= 0 && o !== owner; });
  }

  // ---------------------------------------------------------------------
  // Ship statistics.
  // ---------------------------------------------------------------------
  function shipStats(data, ship) {
    const hull = data.ships[ship.hull];
    const s = { hull: hull.hull, speed: hull.speed, thrust: hull.thrust, turn: hull.turn, radius: hull.radius, cargo: hull.cargo,
      shield: 0, regen: 0, energy: 100, energyRegen: 30, repair: 0, scanner: 1, weapons: [], ammo: 0, skin: hull.skin, name: hull.name };
    for (const i of ship.weapons) {
      const e = data.equipment[i];
      s.weapons.push({ index: i, kind: e.kind, damage: e.damage, rate: e.rate, speed: e.speed, range: e.range, energy: e.energy, pierce: e.pierce });
      if (e.kind === "missile") s.ammo += e.ammo;
    }
    for (const i of ship.utility) {
      const e = data.equipment[i];
      if (e.kind === "shield") { s.shield += e.value; s.regen += e.regen; }
      else if (e.kind === "armor") s.hull += e.value;
      else if (e.kind === "engine") { s.thrust = Math.round(s.thrust * (100 + e.value) / 100); s.speed = Math.round(s.speed * (100 + e.value / 2) / 100); }
      else if (e.kind === "cargo") s.cargo += e.value;
      else if (e.kind === "scanner") s.scanner += e.value / 100;
      else if (e.kind === "repair") s.repair += e.value;
      else if (e.kind === "capacitor") { s.energy = Math.round(s.energy * (100 + e.value) / 100); s.energyRegen = Math.round(s.energyRegen * (100 + e.value * 0.6) / 100); }
    }
    return Object.freeze(s);
  }
  const cargoUsed = (career) => Object.values(career.cargo).reduce((n, q) => n + q, 0);
  function shipValue(data, ship) {
    let v = data.ships[ship.hull].cost;
    for (const i of [...ship.weapons, ...ship.utility]) v += data.equipment[i].cost;
    return v;
  }

  // ---------------------------------------------------------------------
  // Markets. OPT-INC-001: a price table depends only on (station, career
  // state, war state). Both advance monotonic versions on every mutation, so
  // a table cached under (station id, career.version, war.version) equals a
  // fresh evaluation. marketFresh is the reference path.
  // ---------------------------------------------------------------------
  function marketFresh(career, st) {
    const data = career.data, front = st.kind === "colony" && isFront(career, st.system);
    return data.commodities.map((c) => {
      let factor = 100;
      if (st.kind === "den") factor = 115;
      else {
        if (c.produced.includes(st.type)) factor = 62;
        else if (c.consumed.includes(st.type)) factor = 148;
        if (c.war && front) factor = Math.round(factor * 1.55);
      }
      const drift = 88 + (hash(career.seed, st.id, c.index, Math.floor(career.day / 3)) % 25); // 88..112 %, changes every 3 days
      const glut = career.glut[`${st.id}|${c.index}`] || 0;
      const mid = Math.max(1, Math.round(c.base * factor / 100 * drift / 100));
      const legal = !c.illegal || st.kind === "den";
      const sells = legal && (st.kind === "den" ? true : !c.consumed.includes(st.type) || c.produced.includes(st.type)) && !(c.illegal && st.kind !== "den");
      return { index: c.index, name: c.name, buy: Math.round(mid * 1.06), sell: Math.max(1, Math.round(mid * 0.94 * (100 - glut) / 100)),
        sells: sells && !(c.illegal && st.kind !== "den"), buys: legal, glut };
    });
  }
  const marketCache = new Map();
  function market(career, st) {
    const key = `${st.id}|${career.version}|${career.war.version}|${career.seed}|${career.day}`;
    let table = marketCache.get(key);
    if (!table) {
      if (marketCache.size > 256) marketCache.clear();
      table = Object.freeze(marketFresh(career, st).map(Object.freeze));
      marketCache.set(key, table);
    }
    return table;
  }

  function dockedStation(career) {
    const st = station(career, career.docked);
    if (!st) throw new Error("you are not docked");
    return st;
  }
  function buy(career, commodity, qty) {
    const st = dockedStation(career), row = market(career, st)[commodity];
    qty = Math.trunc(qty);
    if (!row || !row.sells || qty < 1) throw new Error("not for sale here");
    const stats = shipStats(career.data, career.ship), space = stats.cargo - cargoUsed(career);
    if (qty > space) throw new Error(`only ${space} cargo space free`);
    const cost = int(row.buy * qty);
    if (cost > career.credits) throw new Error("not enough credits");
    career.credits -= cost;
    const name = career.data.commodities[commodity].name;
    career.cargo[name] = (career.cargo[name] || 0) + qty;
    career.stats.trades++;
    career.version++;
    return cost;
  }
  function sell(career, commodity, qty) {
    const st = dockedStation(career), row = market(career, st)[commodity];
    const name = career.data.commodities[commodity].name;
    qty = Math.trunc(qty);
    if (!row || !row.buys || qty < 1) throw new Error("this station will not buy that");
    if ((career.cargo[name] || 0) < qty) throw new Error("you do not carry that much");
    const income = int(row.sell * qty);
    career.credits += income;
    career.stats.earned += income;
    career.cargo[name] -= qty;
    if (!career.cargo[name]) delete career.cargo[name];
    const key = `${st.id}|${commodity}`;
    career.glut[key] = Math.min(45, (career.glut[key] || 0) + Math.ceil(qty / 2));
    career.stats.trades++;
    career.version++;
    return income;
  }

  // ---------------------------------------------------------------------
  // Shipyard.
  // ---------------------------------------------------------------------
  function techOf(career, st) {
    if (st.kind === "den") return { propulsion: 3, weapons: 3, armor: 3, colonization: 0, industry: 2, sensors: 2 };
    return career.war.empires[st.faction].tech;
  }
  const available = (career, st, item) => !item.requires || (techOf(career, st)[item.requires.field] || 0) >= item.requires.level;
  function shipsForSale(career, st) {
    const tech = techOf(career, st);
    return career.data.ships.filter((s) => s.cost > 0 && (tech.armor || 0) + (st.capital ? 2 : 1) >= Math.floor(s.cost / 25000));
  }
  function equipmentForSale(career, st) { return career.data.equipment.filter((e) => e.cost > 0 && available(career, st, e)); }

  function buyEquipment(career, index) {
    const st = dockedStation(career), item = career.data.equipment[index];
    if (!item || !equipmentForSale(career, st).includes(item)) throw new Error("not sold here");
    if (item.cost > career.credits) throw new Error("not enough credits");
    const hull = career.data.ships[career.ship.hull];
    const list = item.weapon ? career.ship.weapons : career.ship.utility, cap = item.weapon ? hull.weapons : hull.utility;
    if (list.length >= cap) throw new Error(`no free ${item.weapon ? "hardpoint" : "utility bay"}`);
    career.credits -= item.cost;
    list.push(index);
    if (item.kind === "missile") career.ship.ammo += item.ammo;
    career.version++;
  }
  function sellEquipment(career, slot, position) {
    dockedStation(career);
    const list = slot === "weapons" ? career.ship.weapons : career.ship.utility;
    const [index] = list.splice(position, 1);
    if (index === undefined) throw new Error("nothing fitted there");
    const item = career.data.equipment[index];
    if (item.kind === "cargo" && cargoUsed(career) > shipStats(career.data, career.ship).cargo) { list.splice(position, 0, index); throw new Error("empty the extra cargo first"); }
    career.credits += Math.floor(item.cost / 2);
    if (item.kind === "missile") career.ship.ammo = Math.min(career.ship.ammo, shipStats(career.data, career.ship).ammo);
    career.version++;
  }
  function buyShip(career, index) {
    const st = dockedStation(career), hull = career.data.ships[index];
    if (!hull || !shipsForSale(career, st).includes(hull)) throw new Error("not sold here");
    const tradeIn = Math.floor(shipValue(career.data, career.ship) / 2);
    const keepW = career.ship.weapons.slice(0, hull.weapons), keepU = career.ship.utility.slice(0, hull.utility);
    const sold = [...career.ship.weapons.slice(hull.weapons), ...career.ship.utility.slice(hull.utility)];
    const soldValue = sold.reduce((n, i) => n + Math.floor(career.data.equipment[i].cost / 2), 0);
    const keptValue = [...keepW, ...keepU].reduce((n, i) => n + career.data.equipment[i].cost, 0);
    const price = hull.cost - (tradeIn - Math.floor(keptValue / 2)) - soldValue;
    if (price > career.credits) throw new Error("not enough credits, even with the trade-in");
    const fresh = { hull: index, weapons: keepW, utility: keepU, damage: 0, ammo: 0, name: career.ship.name };
    const capacity = shipStats(career.data, fresh).cargo;
    if (cargoUsed(career) > capacity) throw new Error("your cargo will not fit in that hold");
    fresh.ammo = Math.min(career.ship.ammo, shipStats(career.data, fresh).ammo);
    career.credits -= price;
    career.ship = fresh;
    career.version++;
    return price;
  }
  function repairCost(career) { return Math.ceil(career.ship.damage * 6); }
  function repair(career) {
    dockedStation(career);
    const cost = repairCost(career);
    if (!cost) return 0;
    const paid = Math.min(cost, career.credits);
    const fixed = Math.floor(paid / 6);
    career.credits -= paid;
    career.ship.damage = Math.max(0, career.ship.damage - fixed);
    if (paid === cost) career.ship.damage = 0;
    career.version++;
    return paid;
  }
  function restockMissiles(career) {
    dockedStation(career);
    const want = shipStats(career.data, career.ship).ammo - career.ship.ammo;
    if (want <= 0) return 0;
    const unit = 120, n = Math.min(want, Math.floor(career.credits / unit));
    career.credits -= n * unit;
    career.ship.ammo += n;
    career.version++;
    return n;
  }
  /** Scooped loot: credits always; cargo only as far as the hold allows. Returns units stored. */
  function addLoot(career, loot) {
    if (loot.credits) { career.credits += loot.credits; career.stats.earned += loot.credits; }
    let stored = 0;
    if (loot.commodity != null && loot.qty > 0) {
      const space = shipStats(career.data, career.ship).cargo - cargoUsed(career);
      stored = Math.max(0, Math.min(space, loot.qty));
      if (stored) { const name = career.data.commodities[loot.commodity].name; career.cargo[name] = (career.cargo[name] || 0) + stored; }
    }
    career.version++;
    return stored;
  }
  function renameShip(career, name) { career.ship.name = String(name || "").trim().slice(0, 24) || career.ship.name; career.version++; }

  // ---------------------------------------------------------------------
  // Missions: three offers per station, regenerated every two days.
  // ---------------------------------------------------------------------
  function fill(text, values) { return text.replace(/\{(\w+)\}/g, (m, k) => (values[k] !== undefined ? String(values[k]) : m)); }
  function offers(career, stationId) {
    const st = station(career, stationId);
    if (!st) return [];
    const war = career.war, data = career.data, n = war.galaxy.systems.length, table = War.routesFor(war.galaxy);
    const window = Math.floor(career.day / 2), out = [];
    const reward = DIFFICULTIES[career.difficulty].reward;
    const within = (lo, hi) => { const r = []; for (let s = 0; s < n; s++) { const h = hops(table, st.system, s); if (h >= lo && h <= hi) r.push({ s, h }); } return r; };
    for (let k = 0; k < 3; k++) {
      const h = hash(career.seed, "offer", st.id, window, k);
      const types = st.kind === "den" ? ["courier", "war"] : ["bounty", "courier", "patrol", "war"];
      const type = types[h % types.length];
      const templates = data.missions.filter((m) => m.type === type), tpl = templates[(h >>> 8) % templates.length];
      const id = `m${hash(st.id, window, k, type).toString(36)}`;
      let m = null;
      if (type === "courier") {
        const dests = war.colonies.filter((c) => c.system !== st.system && hops(table, st.system, c.system) <= 4 && hops(table, st.system, c.system) >= 1);
        if (!dests.length) continue;
        const dest = dests[(h >>> 4) % dests.length], jumps = hops(table, st.system, dest.system);
        m = { type, targetStation: stationIdOf(dest), targetSystem: dest.system, count: 1, days: jumps * 2 + 3, pay: 450 + jumps * 380 };
      } else if (type === "bounty" || type === "patrol") {
        const places = within(0, 3);
        const place = places[(h >>> 4) % places.length];
        const clan = data.outlaws[(h >>> 12) % data.outlaws.length];
        const pilot = pilotName(career, h);
        m = type === "bounty"
          ? { type, targetSystem: place.s, targetName: `${pilot} of the ${clan.name}`, targetClan: clan.index, count: 1, days: place.h * 2 + 5, pay: 1400 + place.h * 500 }
          : { type, targetSystem: place.s, targetName: clan.name, targetClan: clan.index, count: 3 + ((h >>> 20) % 3), days: place.h * 2 + 6, pay: 1100 + place.h * 450 };
      } else {
        const poster = st.kind === "den" ? -1 : st.faction;
        const fronts = within(1, 3).filter(({ s }) => { const o = systemOwner(career, s); return o >= 0 && o !== poster && war.empires[o].alive; });
        if (!fronts.length) continue;
        const place = fronts[(h >>> 4) % fronts.length], enemy = systemOwner(career, place.s);
        m = { type, targetSystem: place.s, targetFaction: enemy, targetName: war.empires[enemy].name, count: 2 + ((h >>> 20) % 3), days: place.h * 2 + 6, pay: 1800 + place.h * 600 };
      }
      m.id = id;
      m.faction = st.kind === "den" ? -1 : st.faction;
      m.from = st.id;
      m.reward = Math.round(m.pay * reward / 100 / 10) * 10;
      const values = { faction: m.faction < 0 ? "outlaw broker" : war.empires[m.faction].name, target: m.targetName || "", system: war.galaxy.systems[m.targetSystem].name,
        station: m.targetStation ? stationName(career, m.targetStation) : "", count: m.count, days: m.days, reward: m.reward };
      m.title = fill(tpl.title, values);
      m.brief = fill(tpl.brief, values);
      if (career.missions.some((x) => x.id === id) || career.completedMissions.includes(id)) continue;
      out.push(m);
    }
    return out;
  }
  function hops(table, a, b) {
    if (a === b) return 0;
    let n = 0;
    for (let at = b; at !== a && at >= 0; at = table.pred[a * table.n + at]) n++;
    return n;
  }
  function pilotName(career, h) {
    const p = career.data.pilotNames;
    return `${p.given[h % p.given.length]} ${p.family[(h >>> 7) % p.family.length]}`;
  }
  function accept(career, offer) {
    if (career.missions.filter((m) => m.status === "active").length >= MAX_MISSIONS) throw new Error(`at most ${MAX_MISSIONS} active contracts`);
    if (offer.faction >= 0 && standing(career, offer.faction) <= HOSTILE_REP) throw new Error("they will not hire you");
    if (offer.type === "courier") {
      if (cargoUsed(career) >= shipStats(career.data, career.ship).cargo) throw new Error("no cargo space for the parcel");
      career.cargo[`Parcel ${offer.id}`] = 1;
    }
    career.missions.push({ ...offer, status: "active", progress: 0, accepted: career.day, deadline: career.day + offer.days });
    career.version++;
  }
  function completeMission(career, m) {
    m.status = "complete";
    career.credits += m.reward;
    career.stats.earned += m.reward;
    career.stats.missions++;
    career.completedMissions.push(m.id);
    if (m.faction >= 0) adjust(career, m.faction, 6);
    else adjust(career, -1, 6);
    news(career, `Contract complete: ${m.title} (+${m.reward} credits).`);
    career.version++;
    return m;
  }
  function failMission(career, m, why) {
    m.status = "failed";
    if (m.type === "courier") delete career.cargo[`Parcel ${m.id}`];
    adjust(career, m.faction, -5);
    news(career, `Contract failed: ${m.title} (${why}).`);
  }
  function abandon(career, id) {
    const m = career.missions.find((x) => x.id === id && x.status === "active");
    if (!m) throw new Error("no such contract");
    failMission(career, m, "abandoned");
    career.version++;
  }

  // ---------------------------------------------------------------------
  // Docking, travel, time and the background war.
  // ---------------------------------------------------------------------
  function dock(career, stationId) {
    const st = station(career, stationId);
    if (!st || st.system !== career.system) throw new Error("no such station here");
    if (barred(career, st)) throw new Error(`${st.name} refuses you docking clearance`);
    career.docked = st.id;
    career.home = st.kind === "colony" ? st.id : career.home;
    const done = [];
    for (const m of career.missions) {
      if (m.status === "active" && m.type === "courier" && m.targetStation === st.id) {
        delete career.cargo[`Parcel ${m.id}`];
        done.push(completeMission(career, m));
      }
    }
    // Patrols confiscate contraband at legal stations.
    if (st.kind === "colony") for (const c of career.data.commodities) {
      if (c.illegal && career.cargo[c.name]) {
        const fine = c.base * career.cargo[c.name];
        delete career.cargo[c.name];
        career.credits = Math.max(0, career.credits - fine);
        adjust(career, st.faction, -8);
        news(career, `Customs at ${st.name} seize your ${c.name} and fine you ${fine} credits.`);
      }
    }
    career.version++;
    return done;
  }
  function undock(career) { career.docked = null; career.version++; }

  /** Jump through a gate to a neighbouring system: one day passes. */
  function jump(career, to) {
    const table = War.routesFor(career.war.galaxy);
    if (!table.adj[career.system].some((l) => l.to === to)) throw new Error("no gate to that system");
    career.system = to;
    career.docked = null;
    career.stats.jumps++;
    passDays(career, 1);
    career.version++;
  }
  function passDays(career, days) {
    for (let d = 0; d < days; d++) {
      career.day++;
      for (const key of Object.keys(career.glut)) { career.glut[key] = Math.floor(career.glut[key] * 3 / 4); if (!career.glut[key]) delete career.glut[key]; }
      for (const m of career.missions) if (m.status === "active" && career.day > m.deadline) failMission(career, m, "deadline passed");
      if (career.day - career.warTurnDay >= DAYS_PER_WAR_TURN) {
        career.warTurnDay = career.day;
        advanceWar(career);
      }
    }
    career.version++;
  }
  function advanceWar(career) {
    const war = career.war;
    if (war.over) return;
    const events = War.endTurn(war);
    for (const e of events) {
      if (e.type === "capture" || e.type === "eliminated" || (e.type === "colonized" && career.rep[e.empire] >= 0 && e.empire === 0)) news(career, e.text);
    }
    if (career.docked && !station(career, career.docked)) career.docked = null;
    if (!station(career, career.home)) {
      const fallback = War.coloniesOf(war, career.faction)[0] || war.colonies[0];
      if (fallback) career.home = stationIdOf(fallback);
    }
  }
  function news(career, text) {
    career.news.push({ day: career.day, text });
    if (career.news.length > 80) career.news.splice(0, career.news.length - 80);
  }

  /** The player's ship was destroyed: insurance replaces it at the home station. */
  function destroyed(career) {
    const pct = DIFFICULTIES[career.difficulty].insurance;
    const lost = Math.floor(career.credits * pct / 100);
    career.credits -= lost;
    career.cargo = {};
    career.ship = { ...loanerShip(career.data), name: career.ship.name };
    for (const m of career.missions) if (m.status === "active" && m.type === "courier") failMission(career, m, "parcel lost with your ship");
    const home = station(career, career.home);
    career.system = home ? home.system : career.war.colonies[0].system;
    career.docked = home ? home.id : null;
    career.stats.deaths++;
    passDays(career, 2);
    news(career, `Your ship is lost. The insurer tows you to ${home ? home.name : "safety"}, keeps ${lost} credits and hands you a loaner.`);
    career.version++;
    return lost;
  }

  // ---------------------------------------------------------------------
  // Saves.
  // ---------------------------------------------------------------------
  function serialize(career) {
    return JSON.stringify({ career, war: JSON.parse(War.serialize(career.war)) });
  }
  function deserialize(text, data) {
    const raw = JSON.parse(text);
    if (!raw.career || raw.career.kind !== "lattice-corsair-save" || raw.career.format !== FORMAT) throw new Error("not a LATTICE CORSAIR save");
    if (raw.career.dataSignature !== data.signature) throw new Error("this save was made with different data files");
    const war = War.deserialize(JSON.stringify(raw.war), data.war);
    return attach(raw.career, war, data);
  }
  const digest = (career) => hashText(serialize(career)).toString(16).toUpperCase().padStart(8, "0");

  return Object.freeze({
    FORMAT, DIFFICULTIES, KINDS, HOSTILE_REP, BARRED_REP, DAYS_PER_WAR_TURN, War,
    parseData, createCareer, stationsIn, station, stationName, standing, standingLabel, hostileToPlayer, barred, systemOwner, isFront,
    recordKill, recordAggression, adjust, shipStats, cargoUsed, shipValue, market, marketFresh, buy, sell,
    shipsForSale, equipmentForSale, buyEquipment, sellEquipment, buyShip, repairCost, repair, restockMissiles, renameShip, addLoot,
    offers, accept, abandon, dock, undock, jump, passDays, destroyed, news, pilotName, hash,
    serialize, deserialize, digest,
  });
});
