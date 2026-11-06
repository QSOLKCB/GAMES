/* SOVEREIGN LATTICE deterministic core.
 *
 * Turn-based 4X rules: galaxy generation, exploration, colonies, economy,
 * research, ship design, fleet movement, combat, invasion and rival AI.
 * Pure and deterministic: no DOM, clock or ambient randomness. The same seed,
 * settings, data files and orders always produce the same game.
 *
 * Adapted from QSOLKCB/VANILLAJS at 93ace342c11e2427ad82920c8965f16e91518fb7
 * (Apache-2.0, see NOTICE.md): the seeded generator (modules/math
 * seededRandom, kept as uint32 output), the binary heap with a total order
 * independent of insertion scheduling (modules/navigation Frontier, here
 * driving Dijkstra over the lane graph) and the checked-integer policy of
 * modules/integer-math (economy values stay safe integers).
 *
 * Optimization records from QSOLKCB/OPT at 7556dd36 are applied where named:
 *   OPT-INV-001  route table reuse under the LANES_IMMUTABLE invariant
 *   OPT-INC-001  design statistics bound to (design id, tech epoch)
 *   OPT-REDUCE-001  cheap colonization filters before route scoring
 * Each has a reference path and conformance tests (tests/core.test.js).
 * OPT-PRUNE-001 was tried for AI colony targeting and rolled back after
 * measurement; see docs/OPTIMIZATION.md.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SovereignCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = 1;
  const FIELDS = Object.freeze(["propulsion", "weapons", "armor", "colonization", "industry", "sensors"]);
  const PLANET_TYPES = Object.freeze(["terran", "ocean", "tundra", "volcanic", "arid", "barren", "gas", "asteroid"]);
  // Habitable climates form a ring; neighbours are one colonization level away.
  const CLIMATE_RING = Object.freeze(["terran", "ocean", "tundra", "volcanic", "arid"]);
  const FACILITY_KEYS = Object.freeze(["mine", "reactor", "lab", "shipyard", "battery", "habitat"]);
  const PERSONALITIES = Object.freeze(["balanced", "aggressive", "expansionist", "technologist", "defensive"]);
  const COMPONENT_KINDS = Object.freeze(["weapon", "armor", "shield", "engine", "colony", "troops", "sensor"]);
  const STAR_CLASSES = Object.freeze([
    { key: "yellow", color: "#ffd98a" }, { key: "orange", color: "#ffb36b" }, { key: "red", color: "#ff7d62" },
    { key: "white", color: "#e9f1ff" }, { key: "blue", color: "#8fb8ff" },
  ]);
  const SIZES = Object.freeze({
    small: { systems: 18, width: 860, height: 560, spacing: 105 },
    medium: { systems: 28, width: 1080, height: 700, spacing: 112 },
    large: { systems: 40, width: 1320, height: 860, spacing: 118 },
  });
  const MAX_SIZE = 5;
  const POP_PER_SIZE = 4;
  const MAX_RICHNESS = 3;
  const COMBAT_ROUNDS = 6;
  const BASE_DEFENSE = 40;
  const CAPITAL_DEFENSE = 150;
  // No AI offensive before this turn: early turns are for exploring and settling.
  const OFFENSIVE_TURN = Object.freeze({ aggressive: 30, balanced: 45, expansionist: 55, technologist: 60, defensive: 70 });
  const HOME_POP = 12;

  // ---------------------------------------------------------------------
  // Checked integers (VANILLAJS integer-math policy): economy values must
  // stay safe integers; anything else is a rules bug and fails loudly.
  // ---------------------------------------------------------------------
  function int(value, name) {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${name || "value"} must be a safe integer, got ${value}`);
    return value === 0 ? 0 : value;
  }
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // ---------------------------------------------------------------------
  // Seeded generator (VANILLAJS modules/math seededRandom), uint32 output.
  // ---------------------------------------------------------------------
  function nextU32(holder) {
    holder.rng = (holder.rng + 0x6d2b79f5) >>> 0;
    let t = Math.imul(holder.rng ^ (holder.rng >>> 15), holder.rng | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  const below = (holder, n) => (n <= 1 ? 0 : nextU32(holder) % n);

  function hashText(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function normalizeSeed(seed) {
    const text = String(seed ?? "").trim();
    if (/^0x[0-9a-f]{1,8}$/i.test(text)) return parseInt(text.slice(2), 16) >>> 0 || 1;
    if (/^\d{1,10}$/.test(text)) return Number(text) >>> 0 || 1;
    return hashText(text.toUpperCase() || "SOVEREIGN") || 1;
  }

  // ---------------------------------------------------------------------
  // Data files: INI-like .TXT blocks, validated into frozen rule tables.
  // ---------------------------------------------------------------------
  function parseBlocks(text, fileName) {
    const blocks = [];
    let current = null;
    String(text).split(/\r?\n/).forEach((raw, index) => {
      const line = raw.trim();
      if (!line || line.startsWith(";")) return;
      const header = /^\[([A-Z]+)\]$/.exec(line);
      if (header) {
        current = { type: header[1], fields: {}, line: index + 1 };
        blocks.push(current);
        return;
      }
      const eq = line.indexOf("=");
      if (!current || eq < 1) throw new SyntaxError(`${fileName} line ${index + 1}: expected [SECTION] or Key = Value`);
      const key = line.slice(0, eq).trim();
      if (Object.prototype.hasOwnProperty.call(current.fields, key)) throw new SyntaxError(`${fileName} line ${index + 1}: duplicate ${key}`);
      current.fields[key] = line.slice(eq + 1).trim();
    });
    return blocks;
  }

  function dataError(file, block, message) {
    return new Error(`${file} (block at line ${block.line}): ${message}`);
  }
  function need(file, block, key) {
    const value = block.fields[key];
    if (value === undefined || value === "") throw dataError(file, block, `missing ${key}`);
    return value;
  }
  function needInt(file, block, key, lo, hi) {
    const text = need(file, block, key);
    if (!/^-?\d+$/.test(text)) throw dataError(file, block, `${key} must be a whole number`);
    const value = Number(text);
    if (value < lo || value > hi) throw dataError(file, block, `${key} must be ${lo}..${hi}`);
    return value;
  }
  function needRequirement(file, block) {
    const text = need(file, block, "Requires").toLowerCase();
    if (text === "none") return null;
    const match = /^([a-z]+)\s+(\d+)$/.exec(text);
    if (!match || !FIELDS.includes(match[1])) throw dataError(file, block, `Requires must be "none" or "<field> <level>"`);
    return Object.freeze({ field: match[1], level: Number(match[2]) });
  }
  const list = (text) => text.split(",").map((s) => s.trim()).filter(Boolean);

  /** Parse and validate the six data files. Throws a readable Error on bad mods. */
  function parseData(texts) {
    const file = (name) => {
      if (typeof texts[name] !== "string") throw new Error(`Missing data file ${name}`);
      return parseBlocks(texts[name], name);
    };
    const only = (name, type) => file(name).map((b) => {
      if (b.type !== type) throw dataError(name, b, `expected [${type}], found [${b.type}]`);
      return b;
    });

    const empires = only("EMPIRES.TXT", "EMPIRE").map((b, index) => {
      const homeworld = need("EMPIRES.TXT", b, "Homeworld").toLowerCase();
      if (!CLIMATE_RING.includes(homeworld)) throw dataError("EMPIRES.TXT", b, `Homeworld must be one of ${CLIMATE_RING.join(", ")}`);
      const personality = need("EMPIRES.TXT", b, "Personality").toLowerCase();
      if (!PERSONALITIES.includes(personality)) throw dataError("EMPIRES.TXT", b, `Personality must be one of ${PERSONALITIES.join(", ")}`);
      const color = need("EMPIRES.TXT", b, "Color");
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw dataError("EMPIRES.TXT", b, "Color must look like #a1b2c3");
      const shipNames = list(need("EMPIRES.TXT", b, "ShipNames"));
      return Object.freeze({
        index, name: need("EMPIRES.TXT", b, "Name"), race: need("EMPIRES.TXT", b, "Race"),
        adjective: need("EMPIRES.TXT", b, "Adjective"), leader: need("EMPIRES.TXT", b, "Leader"),
        color: color.toLowerCase(), homeworld, personality, shipNames: Object.freeze(shipNames),
        description: b.fields.Description || "",
      });
    });
    if (empires.length < 2) throw new Error("EMPIRES.TXT must define at least two empires");

    const techs = only("TECHNOLOGY.TXT", "TECH").map((b) => {
      const key = need("TECHNOLOGY.TXT", b, "Key").toLowerCase();
      if (!FIELDS.includes(key)) throw dataError("TECHNOLOGY.TXT", b, `Key must be one of ${FIELDS.join(", ")}`);
      return Object.freeze({ key, name: need("TECHNOLOGY.TXT", b, "Name"), cost: needInt("TECHNOLOGY.TXT", b, "Cost", 1, 100000),
        maxLevel: needInt("TECHNOLOGY.TXT", b, "MaxLevel", 1, 30), description: b.fields.Description || "" });
    });
    for (const key of FIELDS) if (!techs.some((t) => t.key === key)) throw new Error(`TECHNOLOGY.TXT must define field ${key}`);

    const hulls = only("HULLS.TXT", "HULL").map((b, index) => Object.freeze({
      index, name: need("HULLS.TXT", b, "Name"), skin: need("HULLS.TXT", b, "Skin"),
      slots: needInt("HULLS.TXT", b, "Slots", 1, 40), structure: needInt("HULLS.TXT", b, "Structure", 1, 100000),
      speed: needInt("HULLS.TXT", b, "Speed", 1, 1000), cost: needInt("HULLS.TXT", b, "Cost", 1, 100000),
      requires: needRequirement("HULLS.TXT", b), description: b.fields.Description || "",
    }));
    if (!hulls.some((h) => !h.requires)) throw new Error("HULLS.TXT needs at least one hull with Requires = none");

    const components = only("COMPONENTS.TXT", "COMPONENT").map((b, index) => {
      const kind = need("COMPONENTS.TXT", b, "Kind").toLowerCase();
      if (!COMPONENT_KINDS.includes(kind)) throw dataError("COMPONENTS.TXT", b, `Kind must be one of ${COMPONENT_KINDS.join(", ")}`);
      const scaling = need("COMPONENTS.TXT", b, "Scaling").toLowerCase();
      if (!FIELDS.includes(scaling)) throw dataError("COMPONENTS.TXT", b, `Scaling must be one of ${FIELDS.join(", ")}`);
      return Object.freeze({
        index, name: need("COMPONENTS.TXT", b, "Name"), kind, cost: needInt("COMPONENTS.TXT", b, "Cost", 0, 100000),
        requires: needRequirement("COMPONENTS.TXT", b), base: needInt("COMPONENTS.TXT", b, "Base", 0, 100000),
        perLevel: needInt("COMPONENTS.TXT", b, "PerLevel", 0, 10000), scaling,
        reload: kind === "weapon" ? needInt("COMPONENTS.TXT", b, "Reload", 1, 10) : 1,
        pierce: kind === "weapon" ? needInt("COMPONENTS.TXT", b, "Pierce", 0, 100) : 0,
        description: b.fields.Description || "",
      });
    });
    for (const kind of ["weapon", "armor", "engine", "colony", "troops"]) {
      if (!components.some((c) => c.kind === kind && !c.requires)) throw new Error(`COMPONENTS.TXT needs a starting (Requires = none) ${kind} component`);
    }
    const names = new Set();
    for (const c of components) {
      if (names.has(c.name)) throw new Error(`COMPONENTS.TXT: duplicate component name ${c.name}`);
      names.add(c.name);
    }

    const facilities = only("FACILITIES.TXT", "FACILITY").map((b) => {
      const key = need("FACILITIES.TXT", b, "Key").toLowerCase();
      if (!FACILITY_KEYS.includes(key)) throw dataError("FACILITIES.TXT", b, `Key must be one of ${FACILITY_KEYS.join(", ")}`);
      return Object.freeze({ key, name: need("FACILITIES.TXT", b, "Name"), cost: needInt("FACILITIES.TXT", b, "Cost", 1, 100000),
        requires: needRequirement("FACILITIES.TXT", b), output: needInt("FACILITIES.TXT", b, "Output", 0, 100000), description: b.fields.Description || "" });
    });
    for (const key of FACILITY_KEYS) if (!facilities.some((f) => f.key === key)) throw new Error(`FACILITIES.TXT must define ${key}`);

    const nameBlocks = only("SYSTEMNAMES.TXT", "NAMES");
    if (nameBlocks.length !== 1) throw new Error("SYSTEMNAMES.TXT needs exactly one [NAMES] block");
    const syllables = Object.freeze({
      first: Object.freeze(list(need("SYSTEMNAMES.TXT", nameBlocks[0], "First"))),
      middle: Object.freeze(list(need("SYSTEMNAMES.TXT", nameBlocks[0], "Middle"))),
      last: Object.freeze(list(need("SYSTEMNAMES.TXT", nameBlocks[0], "Last"))),
    });

    return Object.freeze({
      empires: Object.freeze(empires), hulls: Object.freeze(hulls), components: Object.freeze(components),
      facilities: Object.freeze(Object.fromEntries(facilities.map((f) => [f.key, f]))),
      techs: Object.freeze(Object.fromEntries(techs.map((t) => [t.key, t]))), syllables,
      signature: hashText(Object.keys(texts).sort().map((k) => `${k}\n${texts[k]}`).join("\n")),
    });
  }

  const meets = (empire, requirement) => !requirement || (empire.tech[requirement.field] || 0) >= requirement.level;
  const techCost = (data, field, nextLevel) => int(data.techs[field].cost * nextLevel * nextLevel, "tech cost");

  // ---------------------------------------------------------------------
  // Galaxy generation.
  // ---------------------------------------------------------------------
  function systemName(gen, data, used) {
    const s = data.syllables;
    for (let attempt = 0; attempt < 50; attempt++) {
      let name = s.first[below(gen, s.first.length)];
      if (below(gen, 3) === 0) name += s.middle[below(gen, s.middle.length)];
      name += s.last[below(gen, s.last.length)];
      if (!used.has(name)) { used.add(name); return name; }
    }
    const fallback = `Lattice-${used.size + 1}`;
    used.add(fallback);
    return fallback;
  }

  function segmentsCross(a, b, c, d) {
    if (a === c || a === d || b === c || b === d) return false;
    const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  }

  function generateGalaxy(seed, sizeKey, empireCount, data) {
    const preset = SIZES[sizeKey] || SIZES.medium;
    const gen = { rng: seed >>> 0 };
    const margin = 60, systems = [], used = new Set();
    for (let attempt = 0; systems.length < preset.systems && attempt < 20000; attempt++) {
      const x = margin + below(gen, preset.width - margin * 2), y = margin + below(gen, preset.height - margin * 2);
      if (systems.every((s) => Math.hypot(s.x - x, s.y - y) >= preset.spacing)) systems.push({ x, y });
    }
    // Lanes: minimum spanning tree for connectivity, then short non-crossing extras.
    const n = systems.length, lanes = [], degree = new Array(n).fill(0), linked = new Set();
    const length = (a, b) => Math.round(Math.hypot(systems[a].x - systems[b].x, systems[a].y - systems[b].y));
    const add = (a, b) => { lanes.push([Math.min(a, b), Math.max(a, b), length(a, b)]); degree[a]++; degree[b]++; linked.add(`${Math.min(a, b)}:${Math.max(a, b)}`); };
    const inTree = new Array(n).fill(false);
    inTree[0] = true;
    for (let k = 1; k < n; k++) {
      let best = null;
      for (let a = 0; a < n; a++) if (inTree[a]) for (let b = 0; b < n; b++) if (!inTree[b]) {
        const d = length(a, b);
        if (!best || d < best[2] || (d === best[2] && (a < best[0] || (a === best[0] && b < best[1])))) best = [a, b, d];
      }
      inTree[best[1]] = true;
      add(best[0], best[1]);
    }
    const candidates = [];
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) candidates.push([a, b, length(a, b)]);
    candidates.sort((p, q) => p[2] - q[2] || p[0] - q[0] || p[1] - q[1]);
    const maxExtra = preset.spacing * 2.3;
    for (const [a, b, d] of candidates) {
      if (d > maxExtra || linked.has(`${a}:${b}`) || degree[a] >= 4 || degree[b] >= 4) continue;
      if (lanes.some(([c, e]) => segmentsCross(systems[a], systems[b], systems[c], systems[e]))) continue;
      add(a, b);
    }
    lanes.sort((p, q) => p[0] - q[0] || p[1] - q[1]);

    const out = systems.map((s, id) => {
      const star = STAR_CLASSES[below(gen, STAR_CLASSES.length)];
      const planets = [];
      const count = 1 + below(gen, 5);
      for (let i = 0; i < count; i++) {
        const roll = below(gen, 100);
        const type = roll < 12 ? "terran" : roll < 24 ? "ocean" : roll < 36 ? "tundra" : roll < 46 ? "volcanic" : roll < 58 ? "arid" : roll < 74 ? "barren" : roll < 88 ? "gas" : "asteroid";
        planets.push({ type, size: 1 + below(gen, MAX_SIZE), richness: 1 + below(gen, MAX_RICHNESS) });
      }
      return { id, name: systemName(gen, data, used), x: s.x, y: s.y, star: star.key, starColor: star.color, planets, ruins: below(gen, 9) === 0 };
    });

    // Homeworlds: farthest-point sampling over lane distance from a seeded start.
    const routes = computeRouteTable({ systems: out, lanes });
    const homes = [below(gen, n)];
    while (homes.length < empireCount) {
      let best = -1, bestScore = -1;
      for (let s = 0; s < n; s++) {
        if (homes.includes(s)) continue;
        const score = Math.min(...homes.map((h) => routes.dist[h * n + s]));
        if (score > bestScore) { best = s; bestScore = score; }
      }
      homes.push(best);
    }
    return { width: preset.width, height: preset.height, systems: out, lanes, homes, size: sizeKey in SIZES ? sizeKey : "medium" };
  }

  // ---------------------------------------------------------------------
  // Routes. OPT-INV-001: the lane graph never changes after generation
  // (invariant LANES_IMMUTABLE, enforced by deep-freezing and a signature),
  // so all-pairs shortest routes are computed once and reused. The reference
  // path, routeReference, is a fresh single-source search per query.
  // ---------------------------------------------------------------------
  class Frontier { // VANILLAJS navigation heap: total order (cost, node), never insertion order.
    constructor() { this.items = []; }
    before(a, b) { return a.cost < b.cost || (a.cost === b.cost && a.node < b.node); }
    push(item) {
      let i = this.items.length;
      this.items.push(item);
      while (i) { const p = (i - 1) >> 1; if (!this.before(item, this.items[p])) break; this.items[i] = this.items[p]; i = p; }
      this.items[i] = item;
    }
    pop() {
      const first = this.items[0], last = this.items.pop();
      if (this.items.length) {
        let i = 0;
        while (i * 2 + 1 < this.items.length) {
          let c = i * 2 + 1;
          if (c + 1 < this.items.length && this.before(this.items[c + 1], this.items[c])) c++;
          if (!this.before(this.items[c], last)) break;
          this.items[i] = this.items[c];
          i = c;
        }
        this.items[i] = last;
      }
      return first;
    }
  }

  function adjacency(galaxy) {
    const adj = galaxy.systems.map(() => []);
    for (const [a, b, len] of galaxy.lanes) { adj[a].push({ to: b, len }); adj[b].push({ to: a, len }); }
    for (const list of adj) list.sort((p, q) => p.to - q.to);
    return adj;
  }

  // One single-source Dijkstra; with stopAt it exits once that node settles.
  function dijkstra(adj, source, stopAt, dist, pred) {
    dist.fill(Infinity);
    pred.fill(-1);
    const settled = new Uint8Array(adj.length), heap = new Frontier();
    dist[source] = 0;
    heap.push({ cost: 0, node: source });
    while (heap.items.length) {
      const { cost, node } = heap.pop();
      if (settled[node] || cost !== dist[node]) continue;
      settled[node] = 1;
      if (node === stopAt) return;
      for (const { to, len } of adj[node]) {
        const next = cost + len;
        if (next < dist[to]) { dist[to] = next; pred[to] = node; heap.push({ cost: next, node: to }); }
      }
    }
  }

  function laneSignature(galaxy) {
    return hashText(galaxy.lanes.map((l) => l.join(",")).join(";") + `|${galaxy.systems.length}`);
  }

  function computeRouteTable(galaxy) {
    const n = galaxy.systems.length, adj = adjacency(galaxy);
    const dist = new Int32Array(n * n), pred = new Int16Array(n * n);
    const d = new Float64Array(n), p = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      dijkstra(adj, s, -1, d, p);
      for (let t = 0; t < n; t++) { dist[s * n + t] = Number.isFinite(d[t]) ? d[t] : -1; pred[s * n + t] = p[t]; }
    }
    return { n, dist, pred, signature: laneSignature(galaxy), adj };
  }

  const routeTables = new WeakMap();
  /**
   * Route table for a galaxy. Reuse is allowed only under LANES_IMMUTABLE:
   * the lane list is deep-frozen (enforced at creation and load) and is the
   * same list the table was built from. A frozen list cannot change, so this
   * identity check is sufficient; an unfrozen list is never cached (fail
   * closed). A per-query content signature was measured to cost more than a
   * fresh search on these graphs, so it is computed once, at build time.
   */
  function routesFor(galaxy) {
    const table = routeTables.get(galaxy);
    if (table && table.lanes === galaxy.lanes && Object.isFrozen(galaxy.lanes)) return table;
    const fresh = computeRouteTable(galaxy);
    fresh.lanes = galaxy.lanes;
    if (Object.isFrozen(galaxy.lanes)) routeTables.set(galaxy, fresh);
    return fresh;
  }
  function routeFrom(table, a, b) {
    const n = table.n;
    if (table.dist[a * n + b] < 0) return null;
    const path = [];
    for (let at = b; at !== a; at = table.pred[a * n + at]) path.push(at);
    return path.reverse();
  }
  /** Systems to visit after a, ending at b ([] when a === b; null if unreachable). */
  function route(state, a, b) { return routeFrom(routesFor(state.galaxy), a, b); }
  function distance(state, a, b) { const t = routesFor(state.galaxy); return t.dist[a * t.n + b]; }

  /** Reference path for OPT-INV-001 conformance: a fresh search, no reuse. */
  function routeReference(galaxy, a, b) {
    const adj = adjacency(galaxy), n = galaxy.systems.length;
    const d = new Float64Array(n), p = new Int32Array(n);
    dijkstra(adj, a, b, d, p);
    if (!Number.isFinite(d[b])) return null;
    const path = [];
    for (let at = b; at !== a; at = p[at]) path.push(at);
    return { path: path.reverse(), cost: d[b] };
  }

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }

  // ---------------------------------------------------------------------
  // Planets and habitability.
  // ---------------------------------------------------------------------
  function habitability(empire, type) {
    const level = empire.tech.colonization || 0;
    if (type === empire.native) return 100;
    const i = CLIMATE_RING.indexOf(type), home = CLIMATE_RING.indexOf(empire.native);
    if (i >= 0) {
      const steps = Math.min(Math.abs(i - home), CLIMATE_RING.length - Math.abs(i - home));
      if (steps === 1 && level >= 1) return 70;
      if (level >= 3) return 45;
      return 0;
    }
    if (type === "barren" && level >= 4) return 30;
    return 0;
  }
  const isOutpostType = (type) => type === "gas" || type === "asteroid";
  function canSettle(empire, planet) {
    if (isOutpostType(planet.type)) return (empire.tech.colonization || 0) >= 2;
    return habitability(empire, planet.type) > 0;
  }
  function maxPop(empire, planet, habitats = 0, data) {
    if (isOutpostType(planet.type)) return 0;
    const base = Math.floor(planet.size * POP_PER_SIZE * habitability(empire, planet.type) / 100);
    const bonus = data ? data.facilities.habitat.output : 25;
    return base + Math.floor(base * bonus * habitats / 100);
  }
  /** Population limit of a colony: its own species' climate, the owner's technology. */
  function colonyMaxPop(state, colony) {
    const owner = state.empires[colony.owner];
    return maxPop({ native: colony.species || owner.native, tech: owner.tech }, planetOf(state, colony), colony.facilities.habitat, state.data);
  }
  function planetValue(empire, planet) {
    const pop = isOutpostType(planet.type) ? 0 : Math.floor(planet.size * POP_PER_SIZE * habitability(empire, planet.type) / 100);
    return (pop > 0 ? pop * 10 : 40) + planet.richness * 10;
  }

  // ---------------------------------------------------------------------
  // Designs. OPT-INC-001: stats depend only on the immutable design (invariant
  // DESIGNS_IMMUTABLE: designs are frozen, edits create a new id) and the
  // owner's tech levels, whose every change advances empire.techEpoch. The
  // cache key is that complete identity, so a hit equals a fresh evaluation.
  // ---------------------------------------------------------------------
  const statCache = new WeakMap();
  function componentValue(c, empire) { return c.base + c.perLevel * (empire.tech[c.scaling] || 0); }

  function designStatsFresh(data, empire, design) {
    const hull = data.hulls[design.hull];
    const stats = { hp: hull.structure, shield: 0, speed: hull.speed + 12 * (empire.tech.propulsion || 0), weapons: [],
      troops: 0, colony: 0, sensor: 0, cost: hull.cost, firepower: 0 };
    for (const index of design.components) {
      const c = data.components[index];
      stats.cost += c.cost;
      const v = componentValue(c, empire);
      if (c.kind === "weapon") { stats.weapons.push({ damage: v, reload: c.reload, pierce: c.pierce }); stats.firepower += Math.floor(v / c.reload); }
      else if (c.kind === "armor") stats.hp += v;
      else if (c.kind === "shield") stats.shield += v;
      else if (c.kind === "engine") stats.speed += v;
      else if (c.kind === "troops") stats.troops += v;
      else if (c.kind === "colony") stats.colony += v;
      else if (c.kind === "sensor") stats.sensor += v;
    }
    stats.upkeep = Math.max(1, Math.ceil(stats.cost / 40));
    stats.strength = stats.firepower * 3 + Math.floor((stats.hp + stats.shield * 3) / 4);
    return Object.freeze(stats);
  }
  function designStats(state, empire, design) {
    let perEmpire = statCache.get(empire);
    if (!perEmpire || perEmpire.epoch !== empire.techEpoch) {
      perEmpire = { epoch: empire.techEpoch, byDesign: new Map() };
      statCache.set(empire, perEmpire);
    }
    let stats = perEmpire.byDesign.get(design.id);
    if (!stats) { stats = designStatsFresh(state.data, empire, design); perEmpire.byDesign.set(design.id, stats); }
    return stats;
  }
  const designById = (empire, id) => empire.designs.find((d) => d.id === id);
  function shipStats(state, empire, ship) { return designStats(state, empire, designById(empire, ship.design)); }

  function designAvailable(data, empire, hullIndex, components) {
    const hull = data.hulls[hullIndex];
    if (!hull || !meets(empire, hull.requires)) return "hull not yet researched";
    if (!Array.isArray(components) || components.length < 1) return "add at least one component";
    if (components.length > hull.slots) return `the ${hull.name} has only ${hull.slots} slots`;
    for (const i of components) {
      const c = data.components[i];
      if (!c) return "unknown component";
      if (!meets(empire, c.requires)) return `${c.name} not yet researched`;
    }
    return null;
  }

  function addDesign(state, empire, name, hull, components, role) {
    const problem = designAvailable(state.data, empire, hull, components);
    if (problem) throw new Error(problem);
    const design = Object.freeze({ id: state.nextId++, name: String(name).slice(0, 32) || "Design", hull, components: Object.freeze(components.slice()), role: role || "custom" });
    empire.designs.push(design);
    state.version++;
    return design;
  }

  function bestComponent(data, empire, kind) {
    let best = null;
    for (const c of data.components) {
      if (c.kind !== kind || !meets(empire, c.requires)) continue;
      const score = Math.floor(componentValue(c, empire) * (100 - 0) / c.reload) + Math.floor(componentValue(c, empire) * c.pierce / 200);
      if (!best || score > best.score || (score === best.score && c.cost < best.c.cost)) best = { c, score };
    }
    return best ? best.c.index : -1;
  }
  function bestHull(data, empire, minSlots) {
    let best = -1;
    data.hulls.forEach((h, i) => { if (meets(empire, h.requires) && h.slots >= (minSlots || 1) && (best < 0 || h.slots > data.hulls[best].slots)) best = i; });
    return best;
  }
  function hullBySkin(data, skin) { const i = data.hulls.findIndex((h) => h.skin === skin); return i; }

  /** Recommended design for a role using current tech; reuses an identical existing design. */
  function autoDesign(state, empire, role) {
    const data = state.data, weapon = bestComponent(data, empire, "weapon"), armor = bestComponent(data, empire, "armor");
    const shield = bestComponent(data, empire, "shield"), engine = bestComponent(data, empire, "engine");
    const sensor = bestComponent(data, empire, "sensor"), colony = bestComponent(data, empire, "colony"), troops = bestComponent(data, empire, "troops");
    let hull, parts, label;
    const cheapest = data.hulls.findIndex((h) => !h.requires);
    if (role === "scout") {
      hull = hullBySkin(data, "javelin"); if (hull < 0 || !meets(empire, data.hulls[hull].requires)) hull = cheapest;
      parts = [engine, sensor >= 0 ? sensor : engine, armor].slice(0, data.hulls[hull].slots); label = "Pathfinder";
    } else if (role === "colony" || role === "troops") {
      hull = hullBySkin(data, "weasel"); if (hull < 0 || !meets(empire, data.hulls[hull].requires)) hull = cheapest;
      const slots = data.hulls[hull].slots;
      parts = role === "colony" ? [colony, armor] : new Array(Math.max(1, slots - 1)).fill(troops).concat([armor]);
      parts = parts.slice(0, slots); label = role === "colony" ? "Settler Ark" : "Boarding Barge";
    } else {
      hull = bestHull(data, empire, 4); if (hull < 0) hull = cheapest;
      const slots = data.hulls[hull].slots, weapons = Math.max(1, Math.round(slots * 0.5));
      parts = new Array(weapons).fill(weapon);
      if (slots - weapons >= 3 && shield >= 0) parts.push(shield);
      parts.push(engine);
      while (parts.length < slots) parts.push(armor);
      label = data.hulls[hull].name;
    }
    parts = parts.filter((p) => p >= 0);
    const existing = empire.designs.find((d) => d.role === role && d.hull === hull && d.components.length === parts.length && d.components.every((c, i) => c === parts[i]));
    if (existing) return existing;
    const mark = empire.designs.filter((d) => d.role === role).length + 1;
    return addDesign(state, empire, `${label} Mk ${mark}`, hull, parts, role);
  }

  // ---------------------------------------------------------------------
  // Game creation.
  // ---------------------------------------------------------------------
  function createGame(options) {
    const data = options.data;
    if (!data || !data.empires) throw new Error("createGame requires parsed data");
    const seed = normalizeSeed(options.seed);
    const rivals = clamp(Math.trunc(options.rivals ?? 3), 1, Math.min(4, data.empires.length - 1));
    const playerIndex = clamp(Math.trunc(options.empire ?? 0), 0, data.empires.length - 1);
    const roster = [playerIndex, ...data.empires.map((e) => e.index).filter((i) => i !== playerIndex).slice(0, rivals)];
    const galaxy = generateGalaxy(seed, options.size || "medium", roster.length, data);
    const state = {
      version: 0, format: VERSION, seed, settings: { size: galaxy.size, rivals, empire: playerIndex, maxTurns: clamp(Math.trunc(options.maxTurns ?? 250), 30, 1000) },
      dataSignature: data.signature, turn: 1, rng: (seed ^ 0x9e3779b9) >>> 0, nextId: 1,
      galaxy: null, empires: [], colonies: [], fleets: [], events: [], history: [], over: false, winner: null,
      ruinsClaimed: [],
    };
    Object.defineProperty(state, "data", { value: data, enumerable: false, writable: true });
    galaxy.systems.forEach((system) => {
      system.planets.forEach((p) => { if (p.size < 1) p.size = 1; });
    });
    roster.forEach((dataIndex, slot) => {
      const def = data.empires[dataIndex], home = galaxy.homes[slot], sys = galaxy.systems[home];
      // Guarantee a large native homeworld and a second planet.
      sys.planets[0] = { type: def.homeworld, size: MAX_SIZE, richness: 2 };
      if (sys.planets.length < 2) sys.planets.push({ type: "barren", size: 2, richness: 2 });
      sys.ruins = false;
    });
    state.galaxy = deepFreeze(galaxy); // LANES_IMMUTABLE (and systems/planets) from here on.

    roster.forEach((dataIndex, slot) => {
      const def = data.empires[dataIndex];
      const empire = {
        id: slot, dataIndex, name: def.name, race: def.race, adjective: def.adjective, leader: def.leader, color: def.color,
        native: def.homeworld, personality: def.personality, ai: slot !== 0, alive: true,
        minerals: 260, energy: 120, researchPoints: 0, researchField: slot === 0 ? "colonization" : null,
        tech: Object.fromEntries(FIELDS.map((f) => [f, 0])), techEpoch: 0, designs: [],
        known: new Array(galaxy.systems.length).fill(0), lastSeen: {}, intel: {}, shipNameIndex: 0, deficit: false, capital: galaxy.homes[slot],
      };
      state.empires.push(empire);
      const colony = foundColony(state, empire, galaxy.homes[slot], 0, HOME_POP);
      Object.assign(colony.facilities, { mine: 2, reactor: 1, lab: 1, shipyard: 1, battery: 1 });
      colony.defense = maxDefense(state, colony);
      for (const role of ["scout", "colony", "warship", "troops"]) autoDesign(state, empire, role);
      for (const role of ["scout", "colony", "warship"]) spawnShip(state, empire, galaxy.homes[slot], findRoleDesign(empire, role));
    });
    updateVisibility(state);
    state.version++;
    return state;
  }

  const findRoleDesign = (empire, role) => {
    const list = empire.designs.filter((d) => d.role === role);
    return list[list.length - 1];
  };

  function foundColony(state, empire, system, planet, pop) {
    // species: the founders' native climate. Captured worlds keep their people.
    const colony = { id: state.nextId++, owner: empire.id, species: empire.native, system, planet, pop: int(pop, "pop"),
      facilities: Object.fromEntries(FACILITY_KEYS.map((k) => [k, 0])), queue: [], defense: 0, blockaded: false, founded: state.turn };
    state.colonies.push(colony);
    explore(state, empire, system);
    state.version++;
    return colony;
  }

  function nextShipName(empire, data) {
    const names = data.empires[empire.dataIndex].shipNames, i = empire.shipNameIndex++;
    const base = names[i % names.length], round = Math.floor(i / names.length);
    return round ? `${base} ${["", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][round] || round + 1}` : base;
  }

  function spawnShip(state, empire, system, design) {
    const ship = { id: state.nextId++, name: nextShipName(empire, state.data), design: design.id, damage: 0 };
    const fleet = { id: state.nextId++, owner: empire.id, name: ship.name, system, path: [], progress: 0, ships: [ship], order: { type: "idle" } };
    state.fleets.push(fleet);
    state.version++;
    return fleet;
  }

  // ---------------------------------------------------------------------
  // Queries.
  // ---------------------------------------------------------------------
  const empireOf = (state, id) => state.empires[id];
  const systemOf = (state, id) => state.galaxy.systems[id];
  const coloniesOf = (state, empireId) => state.colonies.filter((c) => c.owner === empireId);
  const fleetsAt = (state, system) => state.fleets.filter((f) => f.system === system && f.progress === 0);
  const colonyAt = (state, system, planet) => state.colonies.find((c) => c.system === system && c.planet === planet) || null;
  const planetOf = (state, colony) => state.galaxy.systems[colony.system].planets[colony.planet];
  function facilitySlots(state, colony) {
    const planet = planetOf(state, colony);
    return isOutpostType(planet.type) ? 2 : planet.size * 2;
  }
  const facilitiesUsed = (colony) => FACILITY_KEYS.reduce((n, k) => n + colony.facilities[k], 0);
  const isCapital = (state, colony) => state.empires[colony.owner].capital === colony.system && colony.planet === 0;
  const garrison = (state, colony) => (5 + colony.pop * 2) * (isCapital(state, colony) ? 2 : 1);
  function maxDefense(state, colony) {
    return BASE_DEFENSE + (isCapital(state, colony) ? CAPITAL_DEFENSE : 0) + colony.facilities.battery * state.data.facilities.battery.output + 10 * (state.empires[colony.owner].tech.armor || 0);
  }
  function fleetStats(state, fleet) {
    const empire = state.empires[fleet.owner];
    let speed = Infinity, strength = 0, troops = 0, colony = 0, armed = false, sensor = 0, hp = 0;
    for (const ship of fleet.ships) {
      const s = shipStats(state, empire, ship);
      speed = Math.min(speed, s.speed); strength += s.strength; troops += s.troops; colony += s.colony; sensor = Math.max(sensor, s.sensor); hp += s.hp - ship.damage;
      if (s.weapons.length) armed = true;
    }
    return { speed: Number.isFinite(speed) ? speed : 0, strength, troops, colony, armed, sensor, hp };
  }

  function colonyOutput(state, colony) {
    const empire = state.empires[colony.owner], f = state.data.facilities, planet = planetOf(state, colony);
    const industry = 100 + 10 * (empire.tech.industry || 0);
    let minerals = colony.pop + colony.facilities.mine * f.mine.output + (planet.type === "asteroid" ? 15 : 0) + (planet.richness - 1) * 4;
    let energy = colony.pop * 2 + colony.facilities.reactor * f.reactor.output + (planet.type === "gas" ? 15 : 0);
    let research = colony.pop + colony.facilities.lab * f.lab.output;
    minerals = Math.floor(minerals * industry / 100);
    energy = Math.floor(energy * industry / 100);
    if (colony.blockaded) { minerals = 0; energy = 0; research = 0; }
    const construction = colony.blockaded ? 0 : Math.floor((25 + colony.pop * 3) * industry / 100);
    return { minerals: int(minerals), energy: int(energy), research: int(research), construction: int(construction) };
  }

  /**
   * This turn's income. `deficit` is whether this turn's upkeep cannot be paid
   * from the stockpile plus income; when it is, research is halved this same
   * turn (and construction, in runEconomy). The interface shows the same
   * projection the economy then applies.
   */
  function empireIncome(state, empire) {
    let minerals = 0, energy = 0, research = 0, upkeep = 0;
    for (const c of state.colonies) {
      if (c.owner !== empire.id) continue;
      const o = colonyOutput(state, c);
      minerals += o.minerals; energy += o.energy; research += o.research; upkeep += facilitiesUsed(c);
    }
    for (const f of state.fleets) if (f.owner === empire.id) for (const s of f.ships) upkeep += shipStats(state, empire, s).upkeep;
    const net = energy - upkeep, deficit = empire.energy + net < 0;
    return { minerals, energy: net, grossEnergy: energy, upkeep, research: deficit ? Math.floor(research / 2) : research, rawResearch: research, deficit };
  }

  // ---------------------------------------------------------------------
  // Visibility: explored systems are remembered; sensor coverage is current.
  // ---------------------------------------------------------------------
  function sensorHops(empire, extra) {
    const level = empire.tech.sensors || 0;
    return (level >= 2 ? 1 : 0) + (level >= 5 ? 1 : 0) + (extra || 0);
  }
  /** Pure: current sensor coverage per empire (derived, never saved). */
  function computeVisible(state) {
    const adj = routesFor(state.galaxy).adj;
    state.visible = state.empires.map(() => new Array(state.galaxy.systems.length).fill(0));
    for (const empire of state.empires) {
      const seen = state.visible[empire.id], sources = [];
      for (const c of state.colonies) if (c.owner === empire.id) sources.push([c.system, sensorHops(empire, 0)]);
      for (const f of state.fleets) if (f.owner === empire.id) {
        sources.push([f.system, sensorHops(empire, fleetStats(state, f).sensor)]);
        if (f.progress > 0 && f.path.length) sources.push([f.path[0], 0]);
      }
      for (const [start, hops] of sources) {
        const frontier = [[start, hops]];
        while (frontier.length) {
          const [s, left] = frontier.pop();
          if (seen[s] && seen[s] > left) continue;
          seen[s] = left + 1;
          if (left > 0) for (const { to } of adj[s]) frontier.push([to, left - 1]);
        }
      }
      for (let s = 0; s < seen.length; s++) if (seen[s]) seen[s] = 1;
    }
  }

  /** Turn step: refresh coverage, then explore, claim ruins and record sightings. */
  /**
   * An empire surveys a system: it becomes known, its colonies are recorded
   * as this empire's sighting, and an unclaimed beacon pays the first empire
   * to reach it. Every path that reveals a system goes through here, so a
   * fleet arriving mid-turn claims the beacon exactly as sensors would.
   */
  function explore(state, empire, s) {
    const sys = state.galaxy.systems[s];
    empire.known[s] = 1;
    if (sys.ruins && !state.ruinsClaimed.includes(s)) {
      state.ruinsClaimed.push(s);
      empire.researchPoints += 120;
      event(state, { type: "ruins", empire: empire.id, system: s, text: `${empire.adjective} surveyors decode an ancient beacon at ${sys.name}: +120 research.` });
    }
    // Intelligence: what this empire last saw here. Interfaces show this for
    // systems out of sensor range instead of the live simulation.
    const colonies = [];
    for (const c of state.colonies) if (c.system === s) {
      colonies.push({ id: c.id, planet: c.planet, owner: c.owner, species: c.species, pop: c.pop, defense: c.defense });
      // Remember enemy colonies for honest AI estimates.
      if (c.owner !== empire.id) empire.lastSeen[c.id] = { owner: c.owner, system: s, defense: c.defense, pop: c.pop, turn: state.turn };
    }
    empire.intel[s] = { turn: state.turn, colonies };
  }

  function updateVisibility(state) {
    computeVisible(state);
    for (const empire of state.empires) {
      const seen = state.visible[empire.id];
      for (let s = 0; s < seen.length; s++) if (seen[s]) explore(state, empire, s);
    }
  }

  /**
   * Colonies of a system as an empire knows them: live while in sensor range
   * (or where it has its own colony), otherwise its last recorded sighting.
   * Returns null for systems it has never surveyed.
   */
  function knownColonies(state, empireId, s) {
    const empire = state.empires[empireId];
    if (state.visible?.[empireId]?.[s] || state.colonies.some((c) => c.system === s && c.owner === empireId)) {
      return { live: true, turn: state.turn, colonies: state.colonies.filter((c) => c.system === s) };
    }
    const intel = empire.intel[s];
    return intel ? { live: false, turn: intel.turn, colonies: intel.colonies } : null;
  }

  function event(state, e) { state.events.push(Object.assign({ turn: state.turn }, e)); }

  // ---------------------------------------------------------------------
  // Player and AI orders. Every mutation advances state.version, a monotonic
  // epoch used by OPT-INC-001 consumers (the interface redraws panels only
  // when it changes; an A->B->A edit still advances it twice).
  // ---------------------------------------------------------------------
  function ownFleet(state, empireId, fleetId) {
    const fleet = state.fleets.find((f) => f.id === fleetId);
    if (!fleet || fleet.owner !== empireId) throw new Error("not your fleet");
    return fleet;
  }

  function orderMove(state, empireId, fleetId, destination) {
    const fleet = ownFleet(state, empireId, fleetId);
    if (!Number.isInteger(destination) || destination < 0 || destination >= state.galaxy.systems.length) throw new Error("no such system");
    const origin = fleet.progress > 0 ? fleet.path[0] : fleet.system;
    if (fleet.progress > 0) {
      // Mid-lane: finish the current lane first, then route onward.
      const onward = route(state, origin, destination) || [];
      fleet.path = [origin, ...onward];
    } else {
      const path = route(state, fleet.system, destination);
      if (!path) throw new Error("no lane route");
      fleet.path = path;
    }
    fleet.order = { type: fleet.path.length ? "move" : "idle", destination };
    state.version++;
  }

  function orderColonize(state, empireId, fleetId, planet) {
    const fleet = ownFleet(state, empireId, fleetId), empire = state.empires[empireId];
    const sys = state.galaxy.systems[fleet.system];
    if (fleet.progress > 0) throw new Error("the fleet is between systems");
    if (!fleetStats(state, fleet).colony) throw new Error("no colony pod in this fleet");
    if (!sys.planets[planet]) throw new Error("no such planet");
    if (colonyAt(state, fleet.system, planet)) throw new Error("planet already settled");
    if (!canSettle(empire, sys.planets[planet])) throw new Error("our people cannot live there yet");
    fleet.order = { type: "colonize", planet };
    fleet.path = [];
    state.version++;
  }

  function orderStop(state, empireId, fleetId) {
    const fleet = ownFleet(state, empireId, fleetId);
    fleet.path = fleet.progress > 0 ? fleet.path.slice(0, 1) : [];
    fleet.order = { type: fleet.path.length ? "move" : "idle" };
    state.version++;
  }

  function mergeFleets(state, empireId, targetId, otherIds) {
    const target = ownFleet(state, empireId, targetId);
    if (target.progress > 0) throw new Error("fleets must be in orbit to merge");
    for (const id of otherIds) {
      const other = ownFleet(state, empireId, id);
      if (other === target || other.system !== target.system || other.progress > 0) continue;
      target.ships.push(...other.ships);
      state.fleets.splice(state.fleets.indexOf(other), 1);
    }
    target.order = { type: "idle" }; target.path = [];
    state.version++;
    return target;
  }

  function detachShip(state, empireId, fleetId, shipId) {
    const fleet = ownFleet(state, empireId, fleetId);
    if (fleet.progress > 0 || fleet.ships.length < 2) throw new Error("cannot detach");
    const i = fleet.ships.findIndex((s) => s.id === shipId);
    if (i < 0) throw new Error("no such ship");
    const [ship] = fleet.ships.splice(i, 1);
    const fresh = { id: state.nextId++, owner: empireId, name: ship.name, system: fleet.system, path: [], progress: 0, ships: [ship], order: { type: "idle" } };
    state.fleets.push(fresh);
    state.version++;
    return fresh;
  }

  function renameFleet(state, empireId, fleetId, name) {
    const fleet = ownFleet(state, empireId, fleetId);
    fleet.name = String(name || "").trim().slice(0, 32) || fleet.name;
    state.version++;
  }

  function ownColony(state, empireId, colonyId) {
    const colony = state.colonies.find((c) => c.id === colonyId);
    if (!colony || colony.owner !== empireId) throw new Error("not your colony");
    return colony;
  }

  function buildCost(state, empire, item) {
    if (item.kind === "facility") return state.data.facilities[item.key].cost;
    return designStats(state, empire, designById(empire, item.design)).cost;
  }

  function canQueue(state, colony, item) {
    const empire = state.empires[colony.owner];
    if (item.kind === "facility") {
      const f = state.data.facilities[item.key];
      if (!f) return "unknown facility";
      if (!meets(empire, f.requires)) return `${f.name} not yet researched`;
      const queued = colony.queue.filter((q) => q.kind === "facility").length;
      if (facilitiesUsed(colony) + queued >= facilitySlots(state, colony)) return "no free facility slots";
      if (item.key === "shipyard" && (colony.facilities.shipyard || colony.queue.some((q) => q.key === "shipyard"))) return "one shipyard per colony";
      if (item.key === "shipyard" && isOutpostType(planetOf(state, colony).type)) return "outposts cannot host shipyards";
      return null;
    }
    if (item.kind === "ship") {
      if (!colony.facilities.shipyard) return "needs an Orbital Shipyard";
      const design = designById(empire, item.design);
      if (!design) return "unknown design";
      const problem = designAvailable(state.data, empire, design.hull, design.components);
      return problem;
    }
    return "unknown item";
  }

  function queueBuild(state, empireId, colonyId, item) {
    const colony = ownColony(state, empireId, colonyId);
    const problem = canQueue(state, colony, item);
    if (problem) throw new Error(problem);
    if (colony.queue.length >= 8) throw new Error("queue is full");
    const empire = state.empires[empireId];
    colony.queue.push({ kind: item.kind, key: item.key || null, design: item.design || null, progress: 0, cost: int(buildCost(state, empire, item)) });
    state.version++;
  }

  function dequeue(state, empireId, colonyId, index) {
    const colony = ownColony(state, empireId, colonyId);
    const [item] = colony.queue.splice(index, 1);
    if (item) state.empires[empireId].minerals += Math.floor(item.progress / 2); // half refund
    state.version++;
  }

  function setResearch(state, empireId, field) {
    if (!FIELDS.includes(field)) throw new Error("unknown field");
    const empire = state.empires[empireId];
    if ((empire.tech[field] || 0) >= state.data.techs[field].maxLevel) throw new Error("field complete");
    empire.researchField = field;
    state.version++;
  }

  function createDesign(state, empireId, name, hull, components) {
    return addDesign(state, state.empires[empireId], name, hull, components, "custom");
  }

  // ---------------------------------------------------------------------
  // AI. Honest: it reasons only from its own explored systems and last-seen
  // reports. OPT-REDUCE-001 filters candidates by cheap predicates first.
  // ---------------------------------------------------------------------
  const RESEARCH_WEIGHTS = {
    balanced: { propulsion: 2, weapons: 3, armor: 3, colonization: 3, industry: 3, sensors: 1 },
    aggressive: { propulsion: 2, weapons: 5, armor: 4, colonization: 2, industry: 2, sensors: 1 },
    expansionist: { propulsion: 3, weapons: 2, armor: 2, colonization: 5, industry: 3, sensors: 1 },
    technologist: { propulsion: 2, weapons: 3, armor: 3, colonization: 3, industry: 4, sensors: 2 },
    defensive: { propulsion: 1, weapons: 3, armor: 5, colonization: 3, industry: 3, sensors: 2 },
  };
  function chooseResearch(state, empire) {
    const weights = RESEARCH_WEIGHTS[empire.personality] || RESEARCH_WEIGHTS.balanced;
    let best = null, bestScore = Infinity;
    for (const field of FIELDS) {
      if ((empire.tech[field] || 0) >= state.data.techs[field].maxLevel) continue;
      const score = Math.floor(((empire.tech[field] || 0) + 1) * 1000 / weights[field]);
      if (score < bestScore) { best = field; bestScore = score; }
    }
    return best;
  }

  /** Candidate colony targets for an empire: cheap filters first (OPT-REDUCE-001). */
  function colonyCandidates(state, empire, reserved) {
    const out = [];
    const taken = new Set(state.colonies.map((c) => c.system * 64 + c.planet));
    state.galaxy.systems.forEach((sys, s) => {
      if (!empire.known[s]) return;
      sys.planets.forEach((planet, p) => {
        if (taken.has(s * 64 + p) || reserved.has(s * 64 + p) || !canSettle(empire, planet)) return;
        out.push({ system: s, planet: p, value: planetValue(empire, planet) });
      });
    });
    return out;
  }
  const targetScore = (value, dist) => Math.floor(value * 1000 / (dist + 120));
  function better(a, b) { // deterministic total order: score, then distance, system, planet
    if (!b) return true;
    if (a.score !== b.score) return a.score > b.score;
    if (a.dist !== b.dist) return a.dist < b.dist;
    if (a.system !== b.system) return a.system < b.system;
    return a.planet < b.planet;
  }

  /**
   * Best colony target: exhaustive argmax over the reduced candidate list.
   * OPT-PRUNE-001 (a distance-ordered scan with an analytic value bound) was
   * implemented, proven sound and conformance-tested, then rolled back: it
   * skipped about two thirds of candidates but the sort it needs cost more
   * than the cheap scoring it saved (docs/OPTIMIZATION.md).
   */
  function bestColonyTarget(state, empire, from, reserved) {
    const table = routesFor(state.galaxy);
    let best = null;
    for (const c of colonyCandidates(state, empire, reserved || new Set())) {
      const dist = table.dist[from * table.n + c.system];
      if (dist < 0) continue;
      const cand = { system: c.system, planet: c.planet, dist, score: targetScore(c.value, dist) };
      if (better(cand, best)) best = cand;
    }
    return best;
  }

  function planAI(state, empire) {
    const table = routesFor(state.galaxy), n = table.n;
    const dist = (a, b) => table.dist[a * n + b];
    if (!empire.researchField || (empire.tech[empire.researchField] || 0) >= state.data.techs[empire.researchField].maxLevel) empire.researchField = chooseResearch(state, empire);
    else if (state.turn % 5 === 0) empire.researchField = chooseResearch(state, empire);

    const designs = { scout: autoDesign(state, empire, "scout"), colony: autoDesign(state, empire, "colony"),
      warship: autoDesign(state, empire, "warship"), troops: autoDesign(state, empire, "troops") };
    const mine = state.fleets.filter((f) => f.owner === empire.id);
    const roleOf = (f) => {
      const s = fleetStats(state, f);
      if (s.colony) return "colony";
      if (s.troops && !s.armed) return "troops";
      if (s.armed) return "warship";
      return "scout";
    };
    const byRole = { scout: [], colony: [], troops: [], warship: [] };
    for (const f of mine) byRole[roleOf(f)].push(f);
    const colonies = coloniesOf(state, empire.id);
    const queued = (role) => colonies.reduce((n, c) => n + c.queue.filter((q) => q.kind === "ship" && designById(empire, q.design)?.role === role).length, 0);

    // Scouts: nearest unexplored system, no two scouts to the same target.
    const claimed = new Set();
    for (const f of byRole.scout) if (f.order.type === "move") claimed.add(f.order.destination);
    for (const f of byRole.scout) {
      if (f.order.type === "move" || f.progress > 0) continue;
      let best = -1, bestDist = Infinity;
      for (let s = 0; s < n; s++) {
        if (empire.known[s] || claimed.has(s)) continue;
        const d = dist(f.system, s);
        if (d >= 0 && d < bestDist) { best = s; bestDist = d; }
      }
      if (best >= 0) { claimed.add(best); orderMove(state, empire.id, f.id, best); }
    }

    // Colony ships: OPT-PRUNE-001 target search; settle on arrival.
    const reserved = new Set();
    for (const f of byRole.colony) if (f.order.type === "move" && f.order.planet !== undefined) reserved.add(f.order.destination * 64 + f.order.planet);
    for (const f of byRole.colony) {
      if (f.progress > 0) continue;
      if (f.order.type === "move" && f.order.planet !== undefined) continue;
      const target = bestColonyTarget(state, empire, f.system, reserved);
      if (!target) continue;
      reserved.add(target.system * 64 + target.planet);
      if (target.system === f.system) orderColonize(state, empire.id, f.id, target.planet);
      else { orderMove(state, empire.id, f.id, target.system); f.order.planet = target.planet; }
    }
    for (const f of byRole.colony) {
      if (f.progress === 0 && f.order.type === "idle" && f.arrivedPlanet !== undefined) delete f.arrivedPlanet;
    }

    // War. The strongest idle armed fleet besieges the nearest known enemy
    // colony it can beat; troop barges sail to any siege; strays rally home.
    const capital = colonies.find((c) => c.system === empire.capital) ? empire.capital : colonies[0]?.system;
    const aggression = { aggressive: 1.2, balanced: 1.6, expansionist: 1.8, technologist: 2, defensive: 2.6 }[empire.personality] || 1.6;
    const idle = (f) => f.progress === 0 && f.order.type !== "move";
    const enemyColonyAt = (system) => state.colonies.some((c) => c.system === system && c.owner !== empire.id);
    const sieges = [];
    if (capital !== undefined) {
      const atHome = state.fleets.filter((f) => f.owner === empire.id && f.system === capital && idle(f) && (fleetStats(state, f).armed || (fleetStats(state, f).troops && !fleetStats(state, f).colony)));
      if (atHome.length > 1) mergeFleets(state, empire.id, atHome[0].id, atHome.slice(1).map((f) => f.id));
      // Defend: visible hostile armed fleets at our colonies.
      let threat = null;
      for (const c of colonies) for (const f of state.fleets) {
        if (f.owner !== empire.id && f.system === c.system && f.progress === 0 && state.visible[empire.id][c.system] && fleetStats(state, f).armed) {
          if (threat === null || dist(capital, c.system) < dist(capital, threat)) threat = c.system;
        }
      }
      const armedIdle = state.fleets.filter((f) => f.owner === empire.id && idle(f) && fleetStats(state, f).armed)
        .sort((a, b) => fleetStats(state, b).strength - fleetStats(state, a).strength || a.id - b.id);
      const main = armedIdle[0];
      for (const f of state.fleets) if (f.owner === empire.id && f.progress === 0 && fleetStats(state, f).armed && enemyColonyAt(f.system)) sieges.push(f.system);
      if (main && threat !== null && threat !== main.system) orderMove(state, empire.id, main.id, threat);
      else if (main && !(enemyColonyAt(main.system) && state.colonies.some((c) => c.system === main.system && c.owner !== empire.id && c.defense <= 0) && sieges.length)) {
        const own = fleetStats(state, main);
        let target = null;
        for (const [id, seen] of Object.entries(empire.lastSeen)) {
          const colony = state.colonies.find((c) => c.id === Number(id));
          if (!colony || colony.owner === empire.id) { delete empire.lastSeen[id]; continue; }
          const d = dist(main.system, seen.system);
          if (d < 0) continue;
          const guard = state.fleets.filter((f) => f.owner !== empire.id && f.system === seen.system && state.visible[empire.id][seen.system])
            .reduce((n, f) => n + fleetStats(state, f).strength, 0);
          const estimate = seen.defense + guard * 3;
          if (state.turn >= (OFFENSIVE_TURN[empire.personality] || 45) && own.strength >= Math.max(150, estimate * aggression)) {
            if (!target || d < target.d || (d === target.d && seen.system < target.system)) target = { system: seen.system, d };
          }
        }
        if (target && target.system !== main.system) orderMove(state, empire.id, main.id, target.system);
      }
      for (const f of armedIdle.slice(1)) if (f.system !== capital && !enemyColonyAt(f.system) && f !== main) orderMove(state, empire.id, f.id, capital);
      // Troop barges: join the nearest siege, otherwise wait at the capital.
      for (const f of state.fleets.filter((x) => x.owner === empire.id && idle(x))) {
        const s = fleetStats(state, f);
        if (!s.troops || s.armed || s.colony) continue;
        let best = null;
        for (const sys of sieges) { const d = dist(f.system, sys); if (d >= 0 && (best === null || d < dist(f.system, best))) best = sys; }
        if (best !== null && best !== f.system) orderMove(state, empire.id, f.id, best);
        else if (best === null && f.system !== capital) orderMove(state, empire.id, f.id, capital);
      }
    }

    // Production.
    const scoutsWanted = empire.known.some((k) => !k) ? 2 : 0;
    const targets = colonyCandidates(state, empire, reserved).length;
    for (const colony of colonies) {
      if (colony.queue.length) continue;
      const slotsFree = facilitySlots(state, colony) - facilitiesUsed(colony);
      if (colony.facilities.shipyard) {
        const income = empireIncome(state, empire);
        const warUpkeep = designStats(state, empire, designs.warship).upkeep;
        if (byRole.scout.length + queued("scout") < scoutsWanted) queueBuild(state, empire.id, colony.id, { kind: "ship", design: designs.scout.id });
        else if (targets > 0 && byRole.colony.length + queued("colony") < Math.min(2, targets) && empire.minerals > 80) queueBuild(state, empire.id, colony.id, { kind: "ship", design: designs.colony.id });
        else if (slotsFree > 0 && !colony.facilities.lab) queueBuild(state, empire.id, colony.id, { kind: "facility", key: "lab" });
        else if (slotsFree > 0 && income.energy < 5) queueBuild(state, empire.id, colony.id, { kind: "facility", key: "reactor" });
        else if (slotsFree > 0 && empire.minerals < 150 && state.turn % 2 === 0) queueBuild(state, empire.id, colony.id, { kind: "facility", key: "mine" });
        else if (sieges.length && byRole.troops.length + queued("troops") < 2) queueBuild(state, empire.id, colony.id, { kind: "ship", design: designs.troops.id });
        else if (slotsFree > 0 && colony.facilities.battery < 2 && (empire.personality === "defensive" || state.turn > 30) && state.turn % 3 === 0) queueBuild(state, empire.id, colony.id, { kind: "facility", key: "battery" });
        else if (income.energy - warUpkeep >= 0) queueBuild(state, empire.id, colony.id, { kind: "ship", design: designs.warship.id });
        else if (slotsFree > 0) queueBuild(state, empire.id, colony.id, { kind: "facility", key: "reactor" });
      } else if (slotsFree > 0) {
        const key = colony.pop >= 6 && !isOutpostType(planetOf(state, colony).type) && colonies.filter((c) => c.facilities.shipyard).length < 1 + Math.floor(colonies.length / 3)
          ? "shipyard" : colony.facilities.mine <= colony.facilities.lab ? "mine" : "lab";
        if (!canQueue(state, colony, { kind: "facility", key })) queueBuild(state, empire.id, colony.id, { kind: "facility", key });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Turn resolution.
  // ---------------------------------------------------------------------
  function hostileArmedAt(state, system, owner) {
    for (const f of state.fleets) if (f.system === system && f.progress === 0 && f.owner !== owner && fleetStats(state, f).armed) return true;
    for (const c of state.colonies) if (c.system === system && c.owner !== owner && c.defense > 0) return true;
    return false;
  }

  function moveFleets(state) {
    const table = routesFor(state.galaxy);
    for (const fleet of state.fleets.slice().sort((a, b) => a.id - b.id)) {
      if (!fleet.path.length) continue;
      let budget = fleetStats(state, fleet).speed;
      while (budget > 0 && fleet.path.length) {
        const next = fleet.path[0], len = table.dist[fleet.system * table.n + next];
        const remaining = len - fleet.progress;
        if (budget < remaining) { fleet.progress += budget; budget = 0; break; }
        budget -= remaining;
        fleet.system = next; fleet.progress = 0; fleet.path.shift();
        explore(state, state.empires[fleet.owner], next);
        // Interdiction: armed hostiles stop movement at their system.
        if (fleet.path.length && hostileArmedAt(state, next, fleet.owner)) {
          event(state, { type: "interdict", empire: fleet.owner, system: next, text: `${fleet.name} is intercepted at ${state.galaxy.systems[next].name}.` });
          fleet.path = [];
        }
      }
      if (!fleet.path.length && fleet.progress === 0 && fleet.order.type === "move") {
        if (fleet.order.planet !== undefined && fleet.system === fleet.order.destination) fleet.order = { type: "colonize", planet: fleet.order.planet };
        else fleet.order = { type: "idle" };
      }
    }
    state.version++;
  }

  function combatAt(state, system) {
    const units = [];
    for (const fleet of state.fleets) {
      if (fleet.system !== system || fleet.progress !== 0) continue;
      const empire = state.empires[fleet.owner];
      for (const ship of fleet.ships) {
        const s = shipStats(state, empire, ship);
        units.push({ kind: "ship", owner: fleet.owner, id: ship.id, ship, fleet, hp: s.hp - ship.damage, maxShield: s.shield, weapons: s.weapons });
      }
    }
    for (const colony of state.colonies) {
      if (colony.system !== system || colony.defense <= 0) continue;
      const empire = state.empires[colony.owner], guns = Math.min(8, 1 + colony.facilities.battery * 2);
      const damage = 12 + 4 * (empire.tech.weapons || 0);
      units.push({ kind: "colony", owner: colony.owner, id: colony.id, colony, hp: colony.defense, maxShield: 0,
        weapons: new Array(guns).fill({ damage, reload: 1, pierce: 0 }) });
    }
    const owners = [...new Set(units.map((u) => u.owner))].sort((a, b) => a - b);
    const armedOwners = owners.filter((o) => units.some((u) => u.owner === o && u.weapons.length));
    if (owners.length < 2 || !armedOwners.length) return null;
    const before = Object.fromEntries(owners.map((o) => [o, units.filter((u) => u.owner === o && u.kind === "ship").length]));
    let rounds = 0;
    for (let round = 1; round <= COMBAT_ROUNDS; round++) {
      const alive = units.filter((u) => u.hp > 0);
      const liveArmed = new Set(alive.filter((u) => u.weapons.length).map((u) => u.owner));
      const liveOwners = new Set(alive.map((u) => u.owner));
      if (liveOwners.size < 2 || ![...liveArmed].some((o) => alive.some((u) => u.owner !== o))) break;
      rounds = round;
      for (const u of alive) u.shield = u.maxShield;
      const order = alive.slice().sort((a, b) => {
        const ra = (owners.indexOf(a.owner) + round) % owners.length, rb = (owners.indexOf(b.owner) + round) % owners.length;
        return ra - rb || a.id - b.id;
      });
      for (const attacker of order) {
        if (attacker.hp <= 0) continue;
        for (const w of attacker.weapons) {
          if (round % w.reload !== 0) continue;
          const targets = units.filter((t) => t.hp > 0 && t.owner !== attacker.owner);
          if (!targets.length) break;
          const target = targets[below(state, targets.length)];
          let damage = w.damage;
          const pierced = Math.floor(damage * w.pierce / 100);
          let rest = damage - pierced;
          const absorbed = Math.min(target.shield || 0, rest);
          target.shield = (target.shield || 0) - absorbed;
          rest -= absorbed;
          target.hp -= pierced + rest;
        }
      }
    }
    // Apply results.
    const lost = {};
    for (const u of units) {
      if (u.kind === "colony") { u.colony.defense = Math.max(0, u.hp); continue; }
      const stats = shipStats(state, state.empires[u.owner], u.ship);
      if (u.hp <= 0) {
        u.fleet.ships.splice(u.fleet.ships.indexOf(u.ship), 1);
        lost[u.owner] = (lost[u.owner] || 0) + 1;
      } else u.ship.damage = stats.hp - u.hp;
    }
    state.fleets = state.fleets.filter((f) => f.ships.length);
    const sys = state.galaxy.systems[system];
    const parts = owners.map((o) => {
      const adj = state.empires[o].adjective, bits = [];
      if (before[o]) bits.push(`${before[o] - (lost[o] || 0)} of ${before[o]} ships left`);
      const guns = units.filter((u) => u.kind === "colony" && u.owner === o);
      if (guns.length) bits.push(guns.every((u) => u.hp > 0) ? "colony defences hold" : "colony defences broken");
      return `${adj}: ${bits.join(", ")}`;
    });
    event(state, { type: "battle", empire: owners[0], system, involves: owners, text: `Battle at ${sys.name} (${rounds} round${rounds === 1 ? "" : "s"}). ${parts.join("; ")}.` });
    state.version++;
    return { system, owners, lost, rounds };
  }

  function resolveCombat(state) {
    const systems = [...new Set(state.fleets.filter((f) => f.progress === 0).map((f) => f.system))].sort((a, b) => a - b);
    const battles = [];
    for (const s of systems) { const r = combatAt(state, s); if (r) battles.push(r); }
    return battles;
  }

  function controlsSpace(state, system, owner) {
    return !state.fleets.some((f) => f.system === system && f.progress === 0 && f.owner !== owner && fleetStats(state, f).armed);
  }

  function resolveLandings(state) {
    // Invasions: troops land on enemy colonies with no defence left.
    for (const fleet of state.fleets.slice().sort((a, b) => a.id - b.id)) {
      if (fleet.progress || !state.fleets.includes(fleet)) continue;
      const empire = state.empires[fleet.owner];
      const troops = fleetStats(state, fleet).troops;
      if (!troops || !controlsSpace(state, fleet.system, fleet.owner)) continue;
      for (const colony of state.colonies.filter((c) => c.system === fleet.system && c.owner !== fleet.owner && c.defense <= 0)) {
        const needed = garrison(state, colony);
        if (troops < needed) {
          event(state, { type: "invasion", empire: fleet.owner, system: fleet.system, involves: [fleet.owner, colony.owner], text: `${empire.adjective} troops wait at ${state.galaxy.systems[fleet.system].name}: ${troops} marines cannot take a garrison of ${needed}.` });
          break;
        }
        const previous = colony.owner;
        colony.owner = fleet.owner; colony.pop = Math.max(1, Math.floor(colony.pop * 3 / 4)); colony.queue = []; colony.defense = 0;
        fleet.ships = fleet.ships.filter((s) => !shipStats(state, empire, s).troops);
        event(state, { type: "capture", empire: fleet.owner, system: fleet.system, involves: [fleet.owner, previous], text: `${empire.name} captures ${state.galaxy.systems[fleet.system].name} ${roman(colony.planet + 1)} from the ${state.empires[previous].name}.` });
        break;
      }
    }
    state.fleets = state.fleets.filter((f) => f.ships.length);
    // Colonization.
    for (const fleet of state.fleets.slice().sort((a, b) => a.id - b.id)) {
      if (fleet.order.type !== "colonize" || fleet.progress) continue;
      const empire = state.empires[fleet.owner], planetIndex = fleet.order.planet, sys = state.galaxy.systems[fleet.system];
      const planet = sys.planets[planetIndex];
      fleet.order = { type: "idle" };
      if (!planet || colonyAt(state, fleet.system, planetIndex) || !canSettle(empire, planet) || !controlsSpace(state, fleet.system, fleet.owner)) {
        event(state, { type: "colonize-failed", empire: fleet.owner, system: fleet.system, text: `${fleet.name} could not settle at ${sys.name}.` });
        continue;
      }
      const shipIndex = fleet.ships.findIndex((s) => shipStats(state, empire, s).colony > 0);
      if (shipIndex < 0) continue;
      fleet.ships.splice(shipIndex, 1);
      const outpost = isOutpostType(planet.type);
      foundColony(state, empire, fleet.system, planetIndex, outpost ? 0 : 1);
      event(state, { type: "colonized", empire: fleet.owner, system: fleet.system, text: `${empire.adjective} settlers found ${outpost ? "an outpost" : "a colony"} at ${sys.name} ${roman(planetIndex + 1)}.` });
    }
    state.fleets = state.fleets.filter((f) => f.ships.length);
    state.version++;
  }

  function roman(n) { return ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][n - 1] || String(n); }

  function runEconomy(state) {
    for (const colony of state.colonies) {
      // Blockade: hostile armed ships in orbit and we have none.
      colony.blockaded = !controlsSpace(state, colony.system, colony.owner);
    }
    for (const empire of state.empires) {
      if (!empire.alive) continue;
      const income = empireIncome(state, empire);
      empire.minerals = int(empire.minerals + income.minerals);
      // Unpaid upkeep cannot be borrowed: the stockpile stops at zero and the
      // shortfall halves research and construction until it is fixed.
      const energy = int(empire.energy + income.energy);
      empire.deficit = income.deficit; // same test: energy < 0
      empire.energy = Math.max(0, energy);
      // Research.
      if (!empire.researchField || (empire.tech[empire.researchField] || 0) >= state.data.techs[empire.researchField].maxLevel) empire.researchField = chooseResearch(state, empire);
      empire.researchPoints = int(empire.researchPoints + income.research);
      while (empire.researchField) {
        const field = empire.researchField, next = (empire.tech[field] || 0) + 1, cost = techCost(state.data, field, next);
        if (empire.researchPoints < cost) break;
        empire.researchPoints -= cost;
        empire.tech[field] = next;
        empire.techEpoch++;
        event(state, { type: "research", empire: empire.id, text: `${empire.adjective} scientists complete ${state.data.techs[field].name} ${next}.` });
        if (next >= state.data.techs[field].maxLevel) empire.researchField = chooseResearch(state, empire);
      }
    }
    // Construction, growth, defence regeneration and repairs.
    for (const colony of state.colonies.slice().sort((a, b) => a.id - b.id)) {
      const empire = state.empires[colony.owner], planet = planetOf(state, colony);
      const cap = colonyMaxPop(state, colony);
      if (colony.pop < cap && !colony.blockaded) colony.pop = Math.min(cap, colony.pop + Math.max(1, Math.floor(cap / 10)));
      if (colony.pop > cap) colony.pop = cap;
      colony.defense = Math.min(maxDefense(state, colony), colony.defense + Math.ceil(maxDefense(state, colony) / 5));
      let rate = colonyOutput(state, colony).construction;
      if (empire.deficit) rate = Math.floor(rate / 2);
      while (rate > 0 && colony.queue.length) {
        const item = colony.queue[0];
        const spend = Math.min(rate, item.cost - item.progress, Math.max(0, empire.minerals));
        if (spend <= 0) break;
        item.progress += spend; empire.minerals -= spend; rate -= spend;
        if (item.progress < item.cost) break;
        colony.queue.shift();
        const sys = state.galaxy.systems[colony.system];
        if (item.kind === "facility") {
          colony.facilities[item.key]++;
          if (item.key === "battery") colony.defense = maxDefense(state, colony);
          event(state, { type: "built", empire: empire.id, system: colony.system, text: `${state.data.facilities[item.key].name} completed at ${sys.name} ${roman(colony.planet + 1)}.` });
        } else {
          const design = designById(empire, item.design);
          const fleet = spawnShip(state, empire, colony.system, design);
          event(state, { type: "built", empire: empire.id, system: colony.system, text: `${fleet.name} (${design.name}) launched at ${sys.name}.` });
        }
      }
    }
    for (const fleet of state.fleets) {
      if (fleet.progress) continue;
      const empire = state.empires[fleet.owner];
      const yard = state.colonies.some((c) => c.system === fleet.system && c.owner === fleet.owner && c.facilities.shipyard);
      const friendly = yard || state.colonies.some((c) => c.system === fleet.system && c.owner === fleet.owner);
      for (const ship of fleet.ships) {
        if (!ship.damage) continue;
        const hp = shipStats(state, empire, ship).hp;
        ship.damage = yard ? 0 : Math.max(0, ship.damage - Math.ceil(hp * (friendly ? 20 : 5) / 100));
      }
    }
    state.version++;
  }

  function score(state, empire) {
    let s = 0;
    for (const c of state.colonies) if (c.owner === empire.id) s += 40 + c.pop * 10 + facilitiesUsed(c) * 5;
    for (const f of FIELDS) s += (empire.tech[f] || 0) * 25;
    for (const f of state.fleets) if (f.owner === empire.id) for (const ship of f.ships) s += Math.floor(shipStats(state, empire, ship).cost / 10);
    return s;
  }

  function checkVictory(state) {
    for (const empire of state.empires) {
      const alive = state.colonies.some((c) => c.owner === empire.id);
      if (empire.alive && !alive) {
        empire.alive = false;
        state.fleets = state.fleets.filter((f) => f.owner !== empire.id);
        event(state, { type: "eliminated", empire: empire.id, text: `The ${empire.name} has fallen.` });
      }
    }
    const living = state.empires.filter((e) => e.alive);
    if (!state.empires[0].alive) { state.over = true; state.winner = living.length ? living.sort((a, b) => score(state, b) - score(state, a))[0].id : null; }
    else if (living.length === 1) { state.over = true; state.winner = 0; }
    else if (state.turn >= state.settings.maxTurns) {
      state.over = true;
      state.winner = living.slice().sort((a, b) => score(state, b) - score(state, a) || a.id - b.id)[0].id;
    }
  }

  /** Resolve one turn. Player orders must already be applied. Returns this turn's events. */
  function endTurn(state) {
    if (state.over) return [];
    state.events = [];
    for (const empire of state.empires) if (empire.alive && empire.ai) planAI(state, empire);
    moveFleets(state);
    resolveCombat(state);
    resolveLandings(state);
    runEconomy(state);
    updateVisibility(state);
    checkVictory(state);
    const events = state.events;
    state.history.push(...events);
    if (state.history.length > 400) state.history.splice(0, state.history.length - 400);
    state.turn++;
    state.version++;
    return events;
  }

  // ---------------------------------------------------------------------
  // Save / load / digest.
  // ---------------------------------------------------------------------
  /**
   * Saves from before per-system sightings kept only lastSeen colony reports
   * (owner, pop, defence, turn). Rebuild each reported system's sighting from
   * them. A colony's planet and founding species never change, so reading
   * those from the colony reveals nothing new; owner, population and defence
   * come only from the report. Systems with no report stay without one.
   */
  function legacyIntel(raw, empire) {
    const intel = {};
    for (const [id, report] of Object.entries(empire.lastSeen || {})) {
      const colony = raw.colonies.find((c) => c.id === Number(id));
      if (!colony || colony.system !== report.system) continue;
      const entry = intel[report.system] || (intel[report.system] = { turn: report.turn, colonies: [] });
      entry.turn = Math.max(entry.turn, report.turn);
      entry.colonies.push({ id: colony.id, planet: colony.planet, owner: report.owner, species: colony.species, pop: report.pop, defense: report.defense });
    }
    for (const entry of Object.values(intel)) entry.colonies.sort((a, b) => a.planet - b.planet || a.id - b.id);
    return intel;
  }

  function serialize(state) {
    const plain = JSON.parse(JSON.stringify(state, (key, value) => (key === "visible" ? undefined : value)));
    return JSON.stringify({ kind: "sovereign-lattice-save", ...plain });
  }
  function deserialize(text, data) {
    const raw = JSON.parse(text);
    if (raw.kind !== "sovereign-lattice-save" || raw.format !== VERSION) throw new Error("not a SOVEREIGN LATTICE save");
    if (raw.dataSignature !== data.signature) throw new Error("this save was made with different data files");
    delete raw.kind;
    raw.galaxy = deepFreeze(raw.galaxy);
    for (const empire of raw.empires) if (!empire.intel) empire.intel = legacyIntel(raw, empire);
    for (const empire of raw.empires) empire.designs = empire.designs.map((d) => Object.freeze({ ...d, components: Object.freeze(d.components.slice()) }));
    Object.defineProperty(raw, "data", { value: data, enumerable: false, writable: true });
    computeVisible(raw); // derived only: loading must not change the game
    return raw;
  }
  function digest(state) { return hashText(serialize(state)).toString(16).toUpperCase().padStart(8, "0"); }

  return Object.freeze({
    VERSION, FIELDS, PLANET_TYPES, CLIMATE_RING, FACILITY_KEYS, SIZES, STAR_CLASSES,
    parseData, parseBlocks, normalizeSeed, hashText, createGame, endTurn, planAI,
    route, distance, routeReference, routesFor, computeRouteTable, laneSignature,
    habitability, canSettle, maxPop, colonyMaxPop, planetValue, isOutpostType,
    designStats, designStatsFresh, designById, autoDesign, designAvailable, createDesign, bestComponent,
    fleetStats, shipStats, garrison, isCapital, OFFENSIVE_TURN, colonyOutput, empireIncome, facilitySlots, facilitiesUsed, maxDefense, canQueue, buildCost, techCost,
    coloniesOf, fleetsAt, knownColonies, colonyAt, planetOf, empireOf, systemOf,
    orderMove, orderColonize, orderStop, mergeFleets, detachShip, renameFleet, queueBuild, dequeue, setResearch,
    colonyCandidates, bestColonyTarget, targetScore,
    score, serialize, deserialize, digest, roman,
  });
});
