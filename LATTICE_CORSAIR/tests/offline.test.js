"use strict";
// Offline boundary, script graph, data headers and originality checks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (n) => fs.readFileSync(path.join(root, n), "utf8");
const html = read("index.html"), css = read("style.css"), app = read("app.js"), renderer = read("renderer.js");

assert.equal((html.match(/<canvas\b/g) || []).length, 1, "one gameplay canvas");
assert.match(html, /default-src 'self'/);
assert.doesNotMatch(`${html}\n${css}\n${app}\n${renderer}`, /https?:\/\//i, "no remote URLs");
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
assert.deepEqual(scripts, ["../vendor/three/three.min.js", "../shared/qsol-native.js", "../shared/qsol-input.js", "../SUBSPACE/skins.js",
  "../SOVEREIGN_LATTICE/data/packed.js", "../SOVEREIGN_LATTICE/core.js", "data/packed.js", "universe.js", "flight.js", "renderer.js", "app.js"]);
for (const src of scripts) assert.ok(fs.existsSync(path.join(root, src)), `missing ${src}`);
assert.doesNotMatch(app + renderer, /getContext\s*\(\s*["']2d["']/, "no Canvas 2D gameplay");
assert.match(renderer, /QsolNative\.Stage/);
for (const f of ["SHIPS.TXT", "EQUIPMENT.TXT", "COMMODITIES.TXT", "OUTLAWS.TXT", "MISSIONS.TXT", "PILOTNAMES.TXT"]) assert.match(read(`data/${f}`), /^; LATTICE CORSAIR -- /, `${f} header`);
// Originality: no well-known commercial space-game names in game text.
const corpus = [html, app, ...fs.readdirSync(path.join(root, "data")).filter((f) => f.endsWith(".TXT")).map((f) => read(`data/${f}`))].join("\n").toLowerCase();
for (const name of ["starfury", "space empires", "malfador", "jraenar", "drushocka", "abbidon", "phong", "terran empire", "freelancer", "privateer", "elite dangerous", "eve online"]) {
  assert.ok(!corpus.includes(name), `game text must stay original (found "${name}")`);
}
process.stdout.write("ok - LATTICE CORSAIR is a self-contained offline browser game with original, moddable data\n");
