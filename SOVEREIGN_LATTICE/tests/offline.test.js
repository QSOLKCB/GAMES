"use strict";
// Offline boundary and packaging checks for the browser shell.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const html = read("index.html"), css = read("style.css"), app = read("app.js"), renderer = read("renderer.js");

assert.match(html, /<canvas id="game"/);
assert.equal((html.match(/<canvas\b/g) || []).length, 1, "one gameplay canvas");
assert.match(html, /default-src 'self'/);
assert.doesNotMatch(`${html}\n${css}\n${app}\n${renderer}`, /https?:\/\//i, "no remote URLs in the shell");
assert.doesNotMatch(`${html}\n${css}`, /@import\s|url\s*\(\s*['"]?\/\//i);
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
assert.deepEqual(scripts, ["../vendor/three/three.min.js", "../shared/qsol-native.js", "../shared/qsol-input.js", "../SUBSPACE/skins.js", "data/packed.js", "renderer.js", "core.js", "app.js"]);
for (const src of scripts) assert.ok(fs.existsSync(path.join(root, src)), `missing ${src}`);
assert.doesNotMatch(app + renderer, /getContext\s*\(\s*["']2d["']/, "no Canvas 2D gameplay");
assert.match(renderer, /QsolNative\.Stage/);
assert.match(app, /presentation|renderer\.render\(/);
for (const file of ["EMPIRES.TXT", "HULLS.TXT", "COMPONENTS.TXT", "FACILITIES.TXT", "TECHNOLOGY.TXT", "SYSTEMNAMES.TXT"]) {
  const text = read(`data/${file}`);
  assert.match(text, /^; SOVEREIGN LATTICE -- /, `${file} starts with its modding header`);
}
// Originality guard: none of the genre's well-known commercial names appear in game text.
const corpus = [html, app, ...fs.readdirSync(path.join(root, "data")).filter((f) => f.endsWith(".TXT")).map((f) => read(`data/${f}`))].join("\n").toLowerCase();
for (const name of ["space empires", "malfador", "abbidon", "drushocka", "eee", "jraenar", "phong", "terran empire"]) {
  assert.ok(!corpus.includes(name), `game text must stay original (found "${name}")`);
}
process.stdout.write("ok - SOVEREIGN LATTICE is a self-contained offline browser game with original, moddable data\n");
