"use strict";
// Deterministic-core tests, including conformance gates for every OPT record
// the core applies (see docs/OPTIMIZATION.md).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../core.js");
const { FILES, packedSource } = require("../scripts/pack-data.js");

const root = path.join(__dirname, "..");
const texts = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(root, "data", f), "utf8")]));
const data = Core.parseData(texts);
let passed = 0;
function test(name, body) {
  body();
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
}
const game = (seed, extra) => Core.createGame({ seed, size: "medium", rivals: 3, data, ...extra });
function selfPlay(state, turns) {
  state.empires[0].ai = true;
  for (let i = 0; i < turns && !state.over; i++) Core.endTurn(state);
  return state;
}

test("data files parse, and packed.js matches the .TXT sources", () => {
  assert.equal(data.empires.length, 5);
  assert.deepEqual(data.empires.map((e) => e.race), ["Meridians", "Cindervox", "Velk", "Lumari", "Thren"]);
  assert.ok(data.empires.every((e) => e.shipNames.length >= 8));
  assert.equal(data.hulls.length, 7);
  assert.equal(fs.readFileSync(path.join(root, "data", "packed.js"), "utf8"), packedSource(), "run node scripts/pack-data.js");
});

test("bad mods fail with a readable message", () => {
  const broken = (file, from, to) => () => Core.parseData({ ...texts, [file]: texts[file].replace(from, to) });
  assert.throws(broken("EMPIRES.TXT", "Homeworld   = terran", "Homeworld   = lava"), /EMPIRES\.TXT .*Homeworld must be one of/);
  assert.throws(broken("HULLS.TXT", "Slots       = 3", "Slots       = three"), /HULLS\.TXT .*Slots must be a whole number/);
  assert.throws(broken("COMPONENTS.TXT", "Kind        = weapon", "Kind        = banana"), /Kind must be one of/);
  assert.throws(broken("TECHNOLOGY.TXT", "Key         = sensors", "Key         = psionics"), /Key must be one of/);
  assert.throws(() => Core.parseData({ ...texts, "EMPIRES.TXT": undefined }), /Missing data file EMPIRES\.TXT/);
  assert.throws(broken("EMPIRES.TXT", "Race        = Velk\n", "Race        = Velk\nRace        = Again\n"), /duplicate Race/);
});

test("same seed and orders give the same game; different seeds differ", () => {
  const a = selfPlay(game("REPLAY"), 60), b = selfPlay(game("REPLAY"), 60);
  assert.equal(Core.digest(a), Core.digest(b));
  assert.notEqual(Core.digest(game("REPLAY")), Core.digest(game("OTHER")));
  assert.equal(Core.normalizeSeed("0x00ABCDEF"), 0xabcdef);
  assert.equal(Core.normalizeSeed("replay"), Core.normalizeSeed("REPLAY"));
});

test("galaxies are connected, planar, frozen and fair at the start", () => {
  for (const size of Object.keys(Core.SIZES)) for (const seed of ["A", "B", "C", "D"]) {
    const g = Core.createGame({ seed, size, rivals: 3, data });
    const sys = g.galaxy.systems, n = sys.length;
    assert.equal(n, Core.SIZES[size].systems, `${size}/${seed} placed every system`);
    for (let t = 0; t < n; t++) assert.ok(Core.distance(g, 0, t) >= 0, "every system is reachable");
    const cross = (a, b, c, d) => {
      if (a === c || a === d || b === c || b === d) return false;
      const o = (p, q, r) => Math.sign((sys[q].x - sys[p].x) * (sys[r].y - sys[p].y) - (sys[q].y - sys[p].y) * (sys[r].x - sys[p].x));
      return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
    };
    for (let i = 0; i < g.galaxy.lanes.length; i++) for (let j = i + 1; j < g.galaxy.lanes.length; j++) {
      assert.ok(!cross(g.galaxy.lanes[i][0], g.galaxy.lanes[i][1], g.galaxy.lanes[j][0], g.galaxy.lanes[j][1]), "lanes never cross");
    }
    assert.ok(Object.isFrozen(g.galaxy.lanes) && Object.isFrozen(g.galaxy.lanes[0]) && Object.isFrozen(sys[0].planets[0]), "LANES_IMMUTABLE");
    assert.equal(new Set(g.galaxy.homes).size, g.empires.length);
    for (const e of g.empires) {
      const home = sys[e.capital].planets[0];
      assert.equal(home.type, e.native); assert.equal(home.size, 5);
      assert.equal(Core.coloniesOf(g, e.id).length, 1);
      assert.equal(g.fleets.filter((f) => f.owner === e.id).length, 3);
    }
  }
});

test("OPT-INV-001: the reused route table equals a fresh search for every pair", () => {
  for (const seed of ["R1", "R2", "R3"]) for (const size of ["small", "large"]) {
    const g = Core.createGame({ seed, size, rivals: 2, data }), n = g.galaxy.systems.length;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const reference = Core.routeReference(g.galaxy, a, b);
      assert.deepEqual(Core.route(g, a, b), reference.path, `${seed} ${a}->${b} path`);
      assert.equal(Core.distance(g, a, b), reference.cost, `${seed} ${a}->${b} cost`);
    }
  }
  // Reuse only under LANES_IMMUTABLE; anything else fails closed to a fresh table.
  const g = game("R1"), table = Core.routesFor(g.galaxy);
  assert.equal(Core.routesFor(g.galaxy), table, "same frozen galaxy reuses its table");
  assert.ok(Object.isFrozen(g.galaxy) && Object.isFrozen(g.galaxy.lanes) && g.galaxy.lanes.every(Object.isFrozen));
  assert.throws(() => { "use strict"; g.galaxy.lanes.push([0, 1, 5]); }, TypeError);
  const altered = { systems: g.galaxy.systems, lanes: g.galaxy.lanes.slice(1) };
  assert.notEqual(Core.laneSignature(altered), table.signature);
  const first = Core.routesFor(altered), second = Core.routesFor(altered);
  assert.notEqual(first, table);
  assert.notEqual(first, second, "unfrozen lanes are never cached");
});

test("OPT-INC-001: cached design stats equal fresh stats for every design and tech epoch", () => {
  const g = game("STATS");
  for (const e of g.empires) for (const role of ["scout", "colony", "warship", "troops"]) Core.autoDesign(g, e, role);
  for (let step = 0; step < 12; step++) {
    for (const e of g.empires) for (const d of e.designs) {
      assert.ok(Object.isFrozen(d) && Object.isFrozen(d.components), "DESIGNS_IMMUTABLE");
      assert.deepEqual(Core.designStats(g, e, d), Core.designStatsFresh(data, e, d));
    }
    const e = g.empires[step % g.empires.length], field = Core.FIELDS[step % Core.FIELDS.length];
    e.tech[field] += 1; e.techEpoch += 1; // every tech change advances the epoch
  }
  // A cached result is never served across a tech change.
  const e = g.empires[0], d = e.designs.find((x) => x.role === "warship");
  const before = Core.designStats(g, e, d).firepower;
  e.tech.weapons += 3; e.techEpoch += 1;
  assert.ok(Core.designStats(g, e, d).firepower > before);
});

test("OPT-REDUCE-001: colony candidates are exactly the settleable, unclaimed, explored planets", () => {
  for (const seed of ["P1", "P2", "P3"]) {
    const g = selfPlay(game(seed), 50);
    for (const e of g.empires) {
      if (!e.alive) continue;
      const reserved = new Set(Core.colonyCandidates(g, e, new Set()).slice(0, 2).map((c) => c.system * 64 + c.planet));
      // Reference: every planet in the galaxy, filtered afterwards.
      const expected = [];
      g.galaxy.systems.forEach((sys, s) => sys.planets.forEach((planet, p) => {
        if (e.known[s] && !Core.colonyAt(g, s, p) && !reserved.has(s * 64 + p) && Core.canSettle(e, planet)) expected.push({ system: s, planet: p, value: Core.planetValue(e, planet) });
      }));
      assert.deepEqual(Core.colonyCandidates(g, e, reserved), expected);
      const best = Core.bestColonyTarget(g, e, e.capital, reserved);
      if (best) assert.ok(expected.some((c) => c.system === best.system && c.planet === best.planet));
    }
  }
});

test("state.version advances on every mutation, including A -> B -> A", () => {
  const g = game("EPOCH"), fleet = g.fleets.find((f) => f.owner === 0);
  const target = g.galaxy.lanes.find((l) => l[0] === fleet.system || l[1] === fleet.system);
  const next = target[0] === fleet.system ? target[1] : target[0];
  const v0 = g.version;
  Core.orderMove(g, 0, fleet.id, next);
  const v1 = g.version;
  Core.orderStop(g, 0, fleet.id);
  const v2 = g.version;
  assert.ok(v0 < v1 && v1 < v2, "move then stop restores the order but not the epoch");
  assert.deepEqual(fleet.path, []);
  const colony = Core.coloniesOf(g, 0)[0];
  Core.queueBuild(g, 0, colony.id, { kind: "facility", key: "lab" });
  const v3 = g.version;
  Core.dequeue(g, 0, colony.id, 0);
  assert.ok(g.version > v3);
  const v4 = g.version;
  Core.endTurn(g);
  assert.ok(g.version > v4);
});

test("orders validate ownership and rules", () => {
  const g = game("ORDERS");
  const enemyFleet = g.fleets.find((f) => f.owner === 1);
  assert.throws(() => Core.orderMove(g, 0, enemyFleet.id, 0), /not your fleet/);
  const colony = Core.coloniesOf(g, 0)[0];
  assert.throws(() => Core.queueBuild(g, 0, colony.id, { kind: "facility", key: "shipyard" }), /one shipyard per colony/);
  assert.throws(() => Core.queueBuild(g, 0, colony.id, { kind: "facility", key: "habitat" }), /not yet researched/);
  assert.throws(() => Core.createDesign(g, 0, "Too big", 6, [0]), /hull not yet researched/);
  assert.throws(() => Core.createDesign(g, 0, "Overfull", 0, [0, 0, 0, 0]), /only 3 slots/);
  const d = Core.createDesign(g, 0, "Picket", 1, [0, 0, 5]);
  assert.equal(Core.designStats(g, g.empires[0], d).weapons.length, 2);
});

test("colonization consumes the pod ship and founds a colony", () => {
  const g = game("SETTLE"), e = g.empires[0];
  const ship = g.fleets.find((f) => f.owner === 0 && Core.fleetStats(g, f).colony);
  const sys = g.galaxy.systems[ship.system];
  const index = sys.planets.findIndex((p, i) => !Core.colonyAt(g, ship.system, i) && Core.canSettle(e, p));
  if (index < 0) { e.tech.colonization = 4; e.techEpoch++; }
  const planet = sys.planets.findIndex((p, i) => !Core.colonyAt(g, ship.system, i) && Core.canSettle(e, p));
  assert.ok(planet >= 0, "home system has a settleable planet once colonization is advanced");
  Core.orderColonize(g, 0, ship.id, planet);
  const before = Core.coloniesOf(g, 0).length;
  Core.endTurn(g);
  assert.equal(Core.coloniesOf(g, 0).length, before + 1);
  assert.ok(!g.fleets.includes(ship) || !Core.fleetStats(g, ship).colony);
});

test("combat destroys the weaker side and troops capture a defenceless colony", () => {
  const g = game("WAR"), attacker = g.empires[0], defender = g.empires[1];
  for (const e of [attacker, defender]) e.ai = false;
  const target = Core.coloniesOf(g, 1)[0];
  attacker.tech.weapons = 8; attacker.tech.armor = 8; attacker.techEpoch++;
  const war = Core.autoDesign(g, attacker, "warship"), troops = Core.autoDesign(g, attacker, "troops");
  const fleet = g.fleets.find((f) => f.owner === 0 && Core.fleetStats(g, f).armed);
  fleet.system = target.system;
  for (let i = 0; i < 6; i++) fleet.ships.push({ id: g.nextId++, name: `Test ${i}`, design: war.id, damage: 0 });
  for (let i = 0; i < 4; i++) fleet.ships.push({ id: g.nextId++, name: `Marines ${i}`, design: troops.id, damage: 0 });
  for (let turn = 0; turn < 8 && target.owner === 1; turn++) Core.endTurn(g);
  assert.equal(target.owner, 0, "the colony changed hands");
  assert.ok(g.history.some((e) => e.type === "battle"));
  assert.ok(g.history.some((e) => e.type === "capture"));
  assert.ok(target.pop >= 1, "captured people keep living on their own world");
  assert.equal(target.species, defender.native);
});

test("save and load round-trip exactly and keep playing deterministically", () => {
  const g = selfPlay(game("SAVE"), 40);
  const text = Core.serialize(g), loaded = Core.deserialize(text, data);
  assert.equal(Core.digest(loaded), Core.digest(g));
  const a = selfPlay(g, 20), b = selfPlay(loaded, 20);
  assert.equal(Core.digest(a), Core.digest(b));
  const otherData = Core.parseData({ ...texts, "HULLS.TXT": texts["HULLS.TXT"].replace("Cost        = 30", "Cost        = 31") });
  assert.throws(() => Core.deserialize(text, otherData), /different data files/);
});

test("full self-play games finish with finite, valid state", () => {
  for (const seed of ["SOAK-1", "SOAK-2"]) {
    const g = selfPlay(game(seed), 400);
    assert.ok(g.over, "the game ends by elimination or the turn limit");
    assert.ok(g.winner === null || g.empires[g.winner].alive);
    for (const e of g.empires) for (const key of ["minerals", "energy", "researchPoints"]) assert.ok(Number.isSafeInteger(e[key]) && e[key] >= 0, `${key}`);
    for (const c of g.colonies) assert.ok(c.pop >= 0 && c.pop <= Core.colonyMaxPop(g, c));
    assert.ok(g.fleets.every((f) => f.ships.length > 0));
  }
});

test("review: a fleet arriving at an unexplored beacon claims it (seed 5, small galaxy)", () => {
  const g = Core.createGame({ seed: "5", size: "small", rivals: 3, data });
  const sys = g.galaxy.systems[4];
  assert.ok(sys.ruins && !g.empires[0].known[4] && !g.ruinsClaimed.includes(4), "fixture: system 4 is an unexplored beacon");
  const scout = g.fleets.find((f) => f.owner === 0 && !Core.fleetStats(g, f).armed && !Core.fleetStats(g, f).colony);
  Core.orderMove(g, 0, scout.id, 4);
  const before = g.empires[0].researchPoints;
  const events = Core.endTurn(g);
  assert.ok(g.ruinsClaimed.includes(4), "beacon claimed on arrival");
  assert.ok(events.some((e) => e.type === "ruins" && e.empire === 0 && e.system === 4));
  assert.ok(!events.some((e) => e.type === "ruins" && e.empire !== 0), "no one else is credited");
  // Research ledger: the beacon's 120 points arrived on top of normal income.
  const spent = Core.FIELDS.reduce((n, f) => { let t = 0; for (let l = 1; l <= g.empires[0].tech[f]; l++) t += Core.techCost(data, f, l); return n + t; }, 0);
  assert.ok(g.empires[0].researchPoints + spent >= before + 120);
});

test("review: out-of-range systems show the last sighting, not the live simulation", () => {
  const g = game("INTEL");
  const me = g.empires[0];
  // A system we surveyed but no longer see.
  const target = me.known.findIndex((k, s) => k && !g.visible[0][s] && !g.colonies.some((c) => c.system === s));
  const surveyed = target >= 0 ? target : (() => {
    const s = g.visible[0].findIndex((v, i) => !v && !g.colonies.some((c) => c.system === i));
    me.known[s] = 1; me.intel[s] = { turn: 1, colonies: [] };
    return s;
  })();
  const before = Core.knownColonies(g, 0, surveyed);
  assert.equal(before.live, false);
  // A rival settles there while we are not looking.
  g.colonies.push({ id: g.nextId++, owner: 1, species: g.empires[1].native, system: surveyed, planet: 0, pop: 3,
    facilities: Object.fromEntries(Core.FACILITY_KEYS.map((k) => [k, 0])), queue: [], defense: 40, blockaded: false, founded: g.turn });
  const after = Core.knownColonies(g, 0, surveyed);
  assert.equal(after.live, false);
  assert.ok(!after.colonies.some((c) => c.owner === 1), "the new rival colony is not revealed without sensors");
  // Sending a ship there reveals it and updates the record.
  const scout = g.fleets.find((f) => f.owner === 0);
  scout.system = surveyed; scout.path = []; scout.progress = 0;
  Core.endTurn(g);
  const seen = Core.knownColonies(g, 0, surveyed);
  assert.ok(seen.colonies.some((c) => c.owner === 1), "a fresh survey shows the rival colony");
  assert.ok(g.empires[0].intel[surveyed].colonies.some((c) => c.owner === 1));
});

test("review: an energy shortfall halves research the same turn it happens, and recovery restores it at once", () => {
  const g = game("DEFICIT"), me = g.empires[0];
  for (const e of g.empires) e.ai = e.id !== 0;
  const warship = me.designs.find((d) => d.role === "warship");
  const fleet = g.fleets.find((f) => f.owner === 0);
  for (let i = 0; i < 12; i++) fleet.ships.push({ id: g.nextId++, name: `Upkeep ${i}`, design: warship.id, damage: 0 });
  me.energy = 0; me.deficit = false; me.researchField = "weapons"; me.researchPoints = 0;
  const income = Core.empireIncome(g, me);
  assert.ok(income.deficit && income.energy < 0, "fixture: this turn's upkeep cannot be paid");
  assert.equal(income.research, Math.floor(income.rawResearch / 2));
  Core.endTurn(g);
  assert.equal(me.deficit, true);
  assert.equal(me.researchPoints, Math.floor(income.rawResearch / 2), "first unpaid turn already halves research");
  // Recovery: plenty of energy again, full research that same turn.
  me.energy = 100000; me.researchPoints = 0;
  const recovered = Core.empireIncome(g, me);
  assert.equal(recovered.deficit, false);
  Core.endTurn(g);
  assert.equal(me.deficit, false);
  assert.equal(me.researchPoints, recovered.rawResearch, "first recovered turn earns full research");
});

test("the core has no ambient clock, randomness, storage or DOM", () => {
  const source = fs.readFileSync(path.join(root, "core.js"), "utf8");
  assert.doesNotMatch(source, /Math\.random|Date\.|performance\.|localStorage|document\.|window\.|fetch\(/);
});

process.stdout.write(`# ${passed} SOVEREIGN LATTICE core tests passed\n`);
