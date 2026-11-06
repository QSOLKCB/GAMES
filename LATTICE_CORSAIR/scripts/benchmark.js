// Bounded, repeatable measurements for the OPT records LATTICE CORSAIR applies.
// Optimized and reference paths run on identical inputs with parity checked.
// Writes docs/PERFORMANCE.json with environment and source hashes. Local
// observations only, not portable speedup claims. Usage: node scripts/benchmark.js
"use strict";
const crypto = require("node:crypto"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const U = require("../universe.js"), F = require("../flight.js");
const { FILES } = require("./pack-data.js");
const root = path.join(__dirname, ".."), warDir = path.join(root, "..", "SOVEREIGN_LATTICE", "data");
const warTexts = Object.fromEntries(fs.readdirSync(warDir).filter((f) => f.endsWith(".TXT")).map((f) => [f, fs.readFileSync(path.join(warDir, f), "utf8")]));
const data = U.parseData(Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(root, "data", f), "utf8")])), U.War.parseData(warTexts));
const REPEATS = 7, now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
function measure(fn) { fn(); const s = []; for (let i = 0; i < REPEATS; i++) { const t = now(); fn(); s.push(now() - t); } return { medianMs: +median(s).toFixed(3), samplesMs: s.map((x) => +x.toFixed(3)) }; }
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex");
const out = { generatedBy: "scripts/benchmark.js", repeats: REPEATS, records: {} };

// OPT-REDUCE-001: collision broad-phase. Snapshot a crowded fight, then test
// every live projectile against the ships, grid vs all-pairs.
for (const crowd of [12, 40, 90]) {
  const c = U.createCareer({ seed: `BENCH-${crowd}`, faction: 0, pilot: "Bench", data });
  U.undock(c);
  const w = F.createFlight(c, null);
  for (let i = 0; i < crowd; i++) { const a = i * 2.399, r = 100 + (i * 53) % 1400; F.spawnNpc(w, c, { faction: i % 3 ? i % 5 : -1, clan: 0, role: "pirate", hull: "Kestrel", x: Math.cos(a) * r, y: Math.sin(a) * r }); }
  for (let k = 0; k < 240; k++) { F.step(w, c, { fire: true, turn: 1, thrust: 0.3, assist: true }); w.events.length = 0; }
  const probes = [...w.shots, ...w.missiles].map((s) => ({ ...s, px: s.x - (s.vx || 0) * F.DT, py: s.y - (s.vy || 0) * F.DT, ownerShip: w.ships.find((x) => x.id === s.owner) || null }));
  F.buildGrid(w);
  for (const p of probes) { const a = F.collideGrid(w, p), b = F.collideBrute(w, p); if ((a && a.id) !== (b && b.id)) throw new Error("broad-phase parity failure"); }
  const passes = 50;
  out.records[`OPT-REDUCE-001 broad-phase, ${w.ships.length} ships`] = {
    ships: w.ships.length, projectiles: probes.length, passes,
    grid: measure(() => { for (let k = 0; k < passes; k++) { F.buildGrid(w); for (const p of probes) F.collideGrid(w, p); } }),
    bruteForce: measure(() => { for (let k = 0; k < passes; k++) for (const p of probes) F.collideBrute(w, p); }),
  };
}

// OPT-INC-001: market tables. Reads of every station's table between mutations.
{
  const c = U.createCareer({ seed: "BENCH-MARKET", faction: 0, pilot: "Bench", data });
  const stations = c.war.colonies.map((col) => U.station(c, `c${col.id}`));
  for (const st of stations) if (JSON.stringify(U.market(c, st)) !== JSON.stringify(U.marketFresh(c, st))) throw new Error("market parity failure");
  const reads = 60;
  out.records["OPT-INC-001 market tables"] = {
    stations: stations.length, readsPerStation: reads,
    cached: measure(() => { for (let k = 0; k < reads; k++) for (const st of stations) U.market(c, st); }),
    fresh: measure(() => { for (let k = 0; k < reads; k++) for (const st of stations) U.marketFresh(c, st); }),
  };
}

// Context: a full minute of flight in a busy system.
{
  const c = U.createCareer({ seed: "BENCH-FLIGHT", faction: 0, pilot: "Bench", data });
  U.undock(c);
  out.flightMinute = measure(() => { const w = F.createFlight(c, null); for (let i = 0; i < 3600; i++) { F.step(w, c, { fire: i % 60 < 20, turn: 0.3, thrust: 0.5, assist: true }); w.events.length = 0; } });
}
out.environment = { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model || "unknown", cpus: os.cpus().length };
out.sources = Object.fromEntries(["universe.js", "flight.js", "scripts/benchmark.js", "../SOVEREIGN_LATTICE/core.js", ...FILES.map((f) => `data/${f}`)].map((f) => [f, sha(f)]));
out.note = "Local observations on one host. Medians after one warm-up. Parity checked on every workload. Not a portable speedup claim.";
fs.mkdirSync(path.join(root, "docs"), { recursive: true });
fs.writeFileSync(path.join(root, "docs", "PERFORMANCE.json"), `${JSON.stringify(out, null, 2)}\n`);
for (const [k, v] of Object.entries(out.records)) console.log(k, JSON.stringify(Object.fromEntries(Object.entries(v).map(([a, b]) => [a, b.medianMs ?? b]))));
console.log("one minute of flight:", out.flightMinute.medianMs, "ms");
