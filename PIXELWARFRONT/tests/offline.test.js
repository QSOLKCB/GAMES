"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

assert.match(html, /<canvas id="game" width="960" height="600"/);
assert.match(html, /<script src="core\.js"><\/script>\s*<script src="app\.js"><\/script>/);
assert.match(html, /connect-src 'none'/);
assert.match(html, /PIXEL <span>WARFRONT<\/span>/);
assert.doesNotMatch(`${html}\n${css}\n${app}`, /https?:\/\//i);
assert.doesNotMatch(`${html}\n${css}`, /@import\s|url\s*\(\s*['"]?\/\//i);
assert.match(app, /requestAnimationFrame\(frame\)/);
assert.match(app, /core\.encodeReplay/);
assert.match(app, /core\.decodeReplay/);
assert.match(app, /core\.tryRecordCommands/);
assert.match(app, /paused \|\| state\.missionWon \|\| state\.gameOver/);
assert.match(app, /const commandLocked = mode !== "live" \|\| state\.missionWon \|\| state\.gameOver/);
assert.match(app, /function drawBuilding/);
assert.match(app, /function drawUnit/);
assert.match(app, /function drawExplosion/);
assert.match(app, /function isInteractiveTarget/);

for (const relative of ["core.js", "app.js", "style.css"]) {
  assert.ok(fs.statSync(path.join(root, relative)).size > 0, `${relative} must exist and be non-empty`);
}

process.stdout.write("ok - offline RTS shell has no remote runtime dependency\n");
