"use strict";
// LATTICE CORSAIR universe and flight tests, including OPT conformance gates.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const U = require("../universe.js");
const F = require("../flight.js");
const { FILES, packedSource } = require("../scripts/pack-data.js");

const root = path.join(__dirname, "..");
const warDir = path.join(root, "..", "SOVEREIGN_LATTICE", "data");
const warTexts = Object.fromEntries(fs.readdirSync(warDir).filter((f) => f.endsWith(".TXT")).map((f) => [f, fs.readFileSync(path.join(warDir, f), "utf8")]));
const texts = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(root, "data", f), "utf8")]));
const warData = U.War.parseData(warTexts);
const data = U.parseData(texts, warData);
let passed = 0;
function test(name, body) { body(); passed++; process.stdout.write(`ok ${passed} - ${name}\n`); }
const career = (seed, extra) => U.createCareer({ seed, faction: 1, pilot: "Test", data, ...extra });
function fly(world, c, seconds, input = {}) {
  for (let i = 0; i < seconds * 60; i++) { F.step(world, c, { assist: true, ...input }); world.events.length = 0; if (world.playerDead) break; }
}

test("data files parse, and packed.js matches the .TXT sources", () => {
  assert.equal(data.ships[0].cost, 0, "the loaner comes first");
  assert.ok(data.ships.length >= 6 && data.equipment.length >= 10 && data.commodities.length >= 8 && data.outlaws.length >= 2);
  assert.ok(data.commodities.some((c) => c.illegal));
  assert.equal(fs.readFileSync(path.join(root, "data", "packed.js"), "utf8"), packedSource(), "run node scripts/pack-data.js");
});

test("bad mods fail with a readable message", () => {
  const broken = (file, from, to) => () => U.parseData({ ...texts, [file]: texts[file].replace(from, to) }, warData);
  assert.throws(broken("SHIPS.TXT", "Hull        = 90", "Hull        = lots"), /SHIPS\.TXT .*Hull must be a number/);
  assert.throws(broken("EQUIPMENT.TXT", "Kind        = laser", "Kind        = banana"), /Kind must be one of/);
  assert.throws(broken("COMMODITIES.TXT", "Produced    = gas", "Produced    = lava"), /unknown planet type lava/);
  assert.throws(broken("COMMODITIES.TXT", "Illegal     = yes", "Illegal     = maybe"), /Illegal must be yes or no/);
  assert.throws(broken("OUTLAWS.TXT", "Color       = #c98b4a", "Color       = rust"), /Color must look like/);
  assert.throws(() => U.parseData({ ...texts, "MISSIONS.TXT": undefined }, warData), /Missing data file MISSIONS\.TXT/);
});

test("a career is deterministic and starts docked at the home capital with a loaner", () => {
  const a = career("SAME"), b = career("SAME");
  assert.equal(U.digest(a), U.digest(b));
  assert.notEqual(U.digest(a), U.digest(career("OTHER")));
  const st = U.station(a, a.docked);
  assert.ok(st && st.capital && st.faction === 0, "docked at the player's capital");
  assert.equal(a.war.empires[0].name, data.war.empires[1].name, "slot 0 is the chosen flag");
  assert.ok(a.war.turn > 20, "the war has a prelude");
  assert.equal(a.ship.hull, 0);
  assert.ok(a.dens.length >= 1, "outlaw havens exist");
});

test("OPT-INC-001: cached market tables equal fresh ones across every mutation", () => {
  const c = career("MARKET");
  const st = U.station(c, c.docked);
  for (let i = 0; i < 12; i++) {
    for (const s of c.war.colonies.slice(0, 6)) {
      const x = U.station(c, `c${s.id}`);
      assert.deepEqual(U.market(c, x), U.marketFresh(c, x));
    }
    // Mutate: trade (career.version), pass days (drift, glut decay, war turns).
    if (i % 3 === 0) { c.docked = st.id; try { U.buy(c, 0, 1); } catch (_e) { /* not sold here */ } }
    if (i % 3 === 1) { c.docked = st.id; const name = data.commodities[0].name; if (c.cargo[name]) U.sell(c, 0, 1); }
    if (i % 3 === 2) U.passDays(c, 1);
  }
  // Selling raises a glut that lowers the next sale price at that station, and it decays.
  const d = career("GLUT"), s2 = U.station(d, d.docked);
  const good = U.market(d, s2).find((r) => r.sells && r.buys);
  d.credits = 1e6; U.buy(d, good.index, 8);
  const before = U.market(d, s2)[good.index].sell;
  U.sell(d, good.index, 8);
  assert.ok(U.market(d, s2)[good.index].sell < before);
  U.passDays(d, 6);
  assert.ok(!d.glut[`${s2.id}|${good.index}`] || d.glut[`${s2.id}|${good.index}`] < 4);
});

test("prices follow production, consumption and war fronts", () => {
  const c = career("PRICES");
  let checked = 0;
  for (const col of c.war.colonies) {
    const st = U.station(c, `c${col.id}`), rows = U.market(c, st);
    for (const com of data.commodities) {
      if (com.illegal) { assert.ok(!rows[com.index].sells && !rows[com.index].buys, "legal stations never trade contraband"); continue; }
      if (com.produced.includes(st.type) && !com.consumed.includes(st.type)) {
        assert.ok(rows[com.index].buy < com.base * 0.8 * (com.war && U.isFront(c, st.system) ? 1.55 : 1) + 1, `${com.name} is cheap where it is made`);
        checked++;
      }
    }
  }
  assert.ok(checked > 3);
  const den = U.station(c, `d${c.dens[0]}`), contraband = data.commodities.find((x) => x.illegal);
  assert.ok(U.market(c, den)[contraband.index].sells, "havens sell contraband");
});

test("trading, outfitting and shipyard rules hold", () => {
  const c = career("TRADE");
  c.credits = 200000;
  const st = U.station(c, c.docked);
  const good = U.market(c, st).find((r) => r.sells);
  assert.throws(() => U.buy(c, good.index, 999), /cargo space/);
  U.buy(c, good.index, 5);
  assert.equal(U.cargoUsed(c), 5);
  const forSale = U.equipmentForSale(c, st);
  assert.ok(forSale.every((e) => !e.requires || c.war.empires[0].tech[e.requires.field] >= e.requires.level), "only researched gear is sold");
  const pod = forSale.find((e) => e.kind === "cargo");
  U.buyEquipment(c, pod.index);
  assert.equal(U.shipStats(data, c.ship).cargo, data.ships[0].cargo + pod.value);
  assert.throws(() => U.buyEquipment(c, pod.index), /no free utility bay/);
  const hull = U.shipsForSale(c, st)[0];
  const credits = c.credits;
  U.buyShip(c, hull.index);
  assert.equal(c.ship.hull, hull.index);
  // Fitted equipment moves across; only the old hull is traded in (the loaner is worth nothing).
  assert.equal(c.credits, credits - (hull.cost - Math.floor(data.ships[0].cost / 2)));
  assert.ok(c.ship.utility.includes(pod.index), "equipment moved to the new hull");
  c.ship.damage = 40;
  U.repair(c);
  assert.equal(c.ship.damage, 0);
  U.undock(c);
  assert.throws(() => U.buy(c, good.index, 1), /not docked/);
});

test("missions: offers are deterministic, couriers deliver, deadlines fail", () => {
  const c = career("MISSIONS");
  const offers = U.offers(c, c.docked);
  assert.ok(offers.length >= 1);
  assert.deepEqual(offers, U.offers(career("MISSIONS"), c.docked));
  for (const o of offers) assert.ok(!/\{\w+\}/.test(o.title + o.brief), "every placeholder filled");
  // Find a courier across stations and days.
  let courier = null;
  for (let day = 0; day < 10 && !courier; day++) {
    for (const col of c.war.colonies) { courier = U.offers(c, `c${col.id}`).find((o) => o.type === "courier"); if (courier) { c.docked = `c${col.id}`; c.system = col.system; break; } }
    if (!courier) U.passDays(c, 2);
  }
  assert.ok(courier, "a courier contract was posted");
  U.accept(c, courier);
  assert.equal(c.cargo[`Parcel ${courier.id}`], 1);
  const credits = c.credits;
  c.system = courier.targetSystem;
  U.dock(c, courier.targetStation);
  assert.equal(c.credits, credits + courier.reward);
  assert.ok(!c.cargo[`Parcel ${courier.id}`]);
  // Deadlines.
  const d = career("DEADLINE"), offer = U.offers(d, d.docked)[0];
  U.accept(d, offer);
  U.passDays(d, offer.days + 1);
  assert.equal(d.missions[0].status, "failed");
});

test("kills move standing and pay patrol, war and bounty contracts", () => {
  const c = career("REP");
  const owner = U.systemOwner(c, c.system);
  const before = c.rep[owner];
  U.recordKill(c, { faction: -1, system: c.system });
  assert.ok(c.rep[owner] > before, "killing outlaws pleases the local empire");
  const enemy = 2, beforeEnemy = c.rep[enemy], beforeOther = c.rep[3];
  U.recordKill(c, { faction: enemy, system: c.system });
  assert.ok(c.rep[enemy] < beforeEnemy && c.rep[3] > beforeOther, "an empire's enemies approve");
  // Patrol contract paid on the last kill.
  const patrol = { id: "mtest", type: "patrol", faction: 0, targetSystem: c.system, count: 2, days: 5, reward: 777, title: "Test", brief: "Test" };
  U.accept(c, patrol);
  const credits = c.credits;
  U.recordKill(c, { faction: -1, system: c.system });
  assert.equal(c.credits, credits);
  const paid = U.recordKill(c, { faction: -1, system: c.system });
  assert.equal(paid.length, 1);
  assert.equal(c.credits, credits + 777);
  // Hostility and docking bans.
  c.rep[enemy] = -60;
  assert.ok(U.hostileToPlayer(c, enemy));
  const enemyStation = c.war.colonies.find((x) => x.owner === enemy);
  if (enemyStation) { c.system = enemyStation.system; assert.throws(() => U.dock(c, `c${enemyStation.id}`), /refuses you docking/); }
});

test("travel passes days and advances the background war", () => {
  const c = career("TRAVEL");
  const turn = c.war.turn, table = U.War.routesFor(c.war.galaxy);
  for (let i = 0; i < 6; i++) U.jump(c, table.adj[c.system][0].to);
  assert.equal(c.day, 7);
  assert.equal(c.war.turn, turn + 3, "one war turn every two days");
  assert.throws(() => U.jump(c, -5), /no gate/);
});

test("losing the ship costs credits and cargo, keeps standing, returns home", () => {
  const c = career("DEATH");
  c.credits = 10000; c.cargo = { "Raw Ore": 4 };
  const rep = c.rep.slice();
  U.undock(c);
  const lost = U.destroyed(c);
  assert.equal(lost, 1500);
  assert.equal(c.credits, 8500);
  assert.deepEqual(c.cargo, {});
  assert.deepEqual(c.rep, rep);
  assert.equal(c.docked, c.home);
  assert.equal(c.ship.hull, 0);
});

test("saves round-trip exactly, refuse other data, and keep playing deterministically", () => {
  const c = career("SAVE");
  U.jump(c, U.War.routesFor(c.war.galaxy).adj[c.system][0].to);
  const text = U.serialize(c), back = U.deserialize(text, data);
  assert.equal(U.digest(back), U.digest(c));
  U.passDays(c, 5); U.passDays(back, 5);
  assert.equal(U.digest(back), U.digest(c));
  const other = U.parseData({ ...texts, "SHIPS.TXT": texts["SHIPS.TXT"].replace("Cost        = 9000", "Cost        = 9001") }, warData);
  assert.throws(() => U.deserialize(text, other), /different data files/);
});

test("flight is deterministic for the same career and inputs", () => {
  const run = () => {
    const c = career("FLIGHT");
    U.undock(c);
    const w = F.createFlight(c, { station: U.War.coloniesOf(c.war, 0)[0] ? `c${U.War.coloniesOf(c.war, 0)[0].id}` : null });
    const log = [];
    for (let i = 0; i < 1800; i++) {
      F.step(w, c, { thrust: i % 300 < 120 ? 1 : 0, turn: i % 200 < 50 ? 1 : 0, fire: i % 90 < 20, assist: true });
      for (const e of w.events) log.push(`${w.tick}:${e.type}`);
      w.events.length = 0;
    }
    return { log: log.join(","), ships: w.ships.map((s) => [s.id, s.x.toFixed(6), s.y.toFixed(6), s.hull.toFixed(6)].join(":")).join("|") };
  };
  assert.deepEqual(run(), run());
});

test("OPT-REDUCE-001: grid broad-phase finds exactly the brute-force hits", () => {
  let compared = 0, hits = 0;
  for (const seed of ["G1", "G2", "G3"]) {
    const c = career(seed);
    U.undock(c);
    const w = F.createFlight(c, null);
    // Crowd the system and spray shots in every direction.
    for (let i = 0; i < 40; i++) {
      const a = (i * 2.399) % (Math.PI * 2), r = 80 + (i * 37) % 900;
      F.spawnNpc(w, c, { faction: i % 3 === 0 ? -1 : i % 5, clan: 0, role: "pirate", hull: "Kestrel", x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    for (let k = 0; k < 600; k++) {
      F.step(w, c, { fire: true, turn: 1, thrust: 0.4, assist: true });
      w.events.length = 0;
      F.buildGrid(w);
      for (const shot of [...w.shots, ...w.missiles]) {
        const probe = { ...shot, px: shot.x - (shot.vx || 0) * F.DT * 3, py: shot.y - (shot.vy || 0) * F.DT * 3, ownerShip: w.ships.find((s) => s.id === shot.owner) || null };
        const fast = F.collideGrid(w, probe), slow = F.collideBrute(w, probe);
        assert.equal(fast && fast.id, slow && slow.id);
        compared++; if (slow) hits++;
      }
    }
  }
  assert.ok(compared > 2000 && hits > 20, `compared ${compared}, hits ${hits}`);
});

test("docking and jumping are only offered close and slow", () => {
  const c = career("DOCK");
  const stationId = c.docked;
  U.undock(c);
  const w = F.createFlight(c, { station: stationId });
  assert.ok(F.dockable(w), "launch spot is inside docking range");
  w.player.vx = 400;
  assert.equal(F.dockable(w).slow, false);
  const gate = w.layout.gates[0];
  Object.assign(w.player, { x: gate.x, y: gate.y, vx: 0, vy: 0 });
  assert.equal(F.jumpable(w).gate.to, gate.to);
  assert.ok(F.jumpable(w).slow);
});

test("combat: the player can destroy an outlaw, earning a kill event and loot", () => {
  const c = career("FIGHT");
  U.undock(c);
  const w = F.createFlight(c, null);
  w.ships = w.ships.filter((s) => s.isPlayer);
  const p = w.player;
  Object.assign(p, { x: 0, y: -2000, vx: 0, vy: 0, angle: 0 });
  const pirate = F.spawnNpc(w, c, { faction: -1, clan: 0, role: "pirate", hull: "Skiff", x: 260, y: -2000, loot: { credits: 300 } });
  pirate.stats = Object.freeze({ ...pirate.stats, speed: 0, thrust: 0, turn: 0, weapons: [] });
  pirate.cooldowns = [];
  let kill = null, loot = null;
  for (let i = 0; i < 60 * 20 && !kill; i++) {
    F.step(w, c, { fire: true, assist: true });
    for (const e of w.events) if (e.type === "kill") kill = e;
    w.events.length = 0;
  }
  assert.ok(kill && kill.byPlayer && kill.victim.faction === -1, "player killed the outlaw");
  Object.assign(p, { x: pirate.x, y: pirate.y, vx: 0, vy: 0 });
  for (let i = 0; i < 30 && !loot; i++) { F.step(w, c, { assist: true }); for (const e of w.events) if (e.type === "loot") loot = e; w.events.length = 0; }
  assert.ok(loot && loot.credits === 300, "scooped the canister");
  const credits = c.credits;
  U.addLoot(c, loot);
  assert.equal(c.credits, credits + 300);
});

test("soak: flying through several systems stays finite and bounded", () => {
  const c = career("SOAK");
  const table = U.War.routesFor(c.war.galaxy);
  for (let hop = 0; hop < 5; hop++) {
    const from = c.system;
    U.undock(c); U.jump(c, table.adj[c.system][hop % table.adj[c.system].length].to);
    const w = F.createFlight(c, { fromSystem: from });
    fly(w, c, 40, { thrust: 0.3, turn: 0.2, fire: true });
    assert.ok(w.ships.every((s) => [s.x, s.y, s.vx, s.vy, s.hull, s.shield, s.energy].every(Number.isFinite)));
    assert.ok(w.ships.length <= F.NPC_CAP + 30);
    if (w.playerDead) U.destroyed(c); else F.persist(w, c);
  }
});

test("pure layers: no ambient clock, randomness, storage or DOM", () => {
  for (const file of ["universe.js", "flight.js"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /Math\.random|Date\.|performance\.|localStorage|document\.|window\.|fetch\(/, file);
  }
});

process.stdout.write(`# ${passed} LATTICE CORSAIR core tests passed\n`);
