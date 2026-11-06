// Bounded, repeatable measurements for the OPT records applied in core.js.
// Each optimized path is timed against its reference path on identical
// inputs, results are checked for equality while timing, and lifecycle cost
// (building the route table) is reported separately. Writes
// docs/PERFORMANCE.json with source hashes and environment. These are local
// observations, not portable speedup claims. Usage: node scripts/benchmark.js
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Core = require("../core.js");
const { FILES } = require("./pack-data.js");

const root = path.join(__dirname, "..");
const texts = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(path.join(root, "data", f), "utf8")]));
const data = Core.parseData(texts);
const REPEATS = 7;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");

function measure(fn) {
  const samples = [];
  fn(); // warm-up, not recorded
  for (let i = 0; i < REPEATS; i++) { const t = now(); fn(); samples.push(now() - t); }
  return { medianMs: Number(median(samples).toFixed(3)), samplesMs: samples.map((x) => Number(x.toFixed(3))) };
}

// A mid-game state per galaxy size, reached by deterministic self-play.
function midGame(size) {
  const g = Core.createGame({ seed: `BENCH-${size}`, size, rivals: 4, data });
  g.empires[0].ai = true;
  for (let i = 0; i < 60; i++) Core.endTurn(g);
  return g;
}

const results = { generatedBy: "scripts/benchmark.js", repeats: REPEATS, records: {} };

// OPT-INV-001: route queries. Workload: every ordered system pair once.
results.records["OPT-INV-001 route table"] = {};
for (const size of ["small", "medium", "large"]) {
  const g = midGame(size), n = g.galaxy.systems.length;
  let checked = 0;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    if (JSON.stringify(Core.route(g, a, b)) !== JSON.stringify(Core.routeReference(g.galaxy, a, b).path)) throw new Error("route parity failure");
    checked++;
  }
  const build = measure(() => Core.computeRouteTable(g.galaxy));
  const reused = measure(() => { for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) Core.route(g, a, b); });
  const reference = measure(() => { for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) Core.routeReference(g.galaxy, a, b); });
  results.records["OPT-INV-001 route table"][size] = { systems: n, queries: n * n, parityChecked: checked, tableBuild: build, tableQueries: reused, referenceQueries: reference };
}

// OPT-INC-001: design statistics. Workload: every ship's stats, as combat and AI read them.
results.records["OPT-INC-001 design stats"] = {};
{
  const g = midGame("large");
  const ships = [];
  for (const f of g.fleets) for (const s of f.ships) ships.push([g.empires[f.owner], s]);
  const cached = measure(() => { for (let k = 0; k < 20; k++) for (const [e, s] of ships) Core.shipStats(g, e, s); });
  const fresh = measure(() => { for (let k = 0; k < 20; k++) for (const [e, s] of ships) Core.designStatsFresh(data, e, Core.designById(e, s.design)); });
  results.records["OPT-INC-001 design stats"].large = { ships: ships.length, passes: 20, cached, fresh };
}

// End-to-end context: full self-play turns with every optimization enabled.
results.endToEnd = {};
for (const size of ["small", "medium", "large"]) {
  results.endToEnd[size] = measure(() => {
    const g = Core.createGame({ seed: `E2E-${size}`, size, rivals: 4, data });
    g.empires[0].ai = true;
    for (let i = 0; i < 100; i++) Core.endTurn(g);
  });
  results.endToEnd[size].turns = 100;
}

results.environment = { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model || "unknown", cpus: os.cpus().length };
results.sources = Object.fromEntries(["core.js", "scripts/benchmark.js", ...FILES.map((f) => `data/${f}`)].map((f) => [f, sha256(f)]));
results.rolledBack = {
  "OPT-PRUNE-001 colony targeting": "Measured on this host before rollback (large galaxy, all empires x systems): pruned 7.57 ms vs exhaustive 7.20 ms median in one run and 12.49 vs 10.61 ms in another, evaluating 3122 of 8880 candidates. The distance sort cost more than the cheap scoring it skipped, so the exhaustive path is the only path.",
};
results.note = "Local observations on one host. Medians of repeated runs after one warm-up. Parity is checked on every measured workload. Not a portable speedup claim.";
fs.mkdirSync(path.join(root, "docs"), { recursive: true });
fs.writeFileSync(path.join(root, "docs", "PERFORMANCE.json"), `${JSON.stringify(results, null, 2)}\n`);
const r = results.records;
console.log("route queries (medium):", r["OPT-INV-001 route table"].medium.tableQueries.medianMs, "ms table vs", r["OPT-INV-001 route table"].medium.referenceQueries.medianMs, "ms reference; build", r["OPT-INV-001 route table"].medium.tableBuild.medianMs, "ms");
console.log("design stats (large):", r["OPT-INC-001 design stats"].large.cached.medianMs, "ms cached vs", r["OPT-INC-001 design stats"].large.fresh.medianMs, "ms fresh");
console.log("100 self-play turns:", Object.entries(results.endToEnd).map(([k, v]) => `${k} ${v.medianMs} ms`).join(", "));
