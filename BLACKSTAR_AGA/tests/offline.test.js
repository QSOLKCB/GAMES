"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const notice = fs.readFileSync(path.join(root, "NOTICE.md"), "utf8");

assert.match(html, /<canvas id="game" width="320" height="200"/);
assert.match(html, /<script src="core\.js"><\/script>\s*<script src="app\.js"><\/script>/);
assert.match(html, /connect-src 'none'/);
assert.doesNotMatch(`${html}\n${css}\n${app}`, /https?:\/\//i);
assert.doesNotMatch(`${html}\n${css}`, /@import\s|url\s*\(\s*['"]?\/\//i);
assert.match(app, /requestAnimationFrame\(frame\)/);
assert.match(app, /core\.tryRecordInput/);
assert.match(app, /core\.encodeReplay/);
assert.match(app, /core\.decodeReplay/);
assert.match(app, /function raycast/);
assert.match(app, /function drawEnemySprite/);
assert.match(app, /projection\.depth/);
assert.doesNotMatch(app, /distance > zBuffer/);
assert.match(app, /function createAudio/);
assert.match(app, /function isInteractiveTarget/);
assert.match(notice, /independently implemented/i);
assert.match(notice, /No source code/i);

for (const relative of ["core.js", "app.js", "style.css", "README.md", "NOTICE.md"]) {
  assert.ok(fs.statSync(path.join(root, relative)).size > 0, `${relative} must exist and be non-empty`);
}

process.stdout.write("ok - BLACKSTAR AGA is a self-contained offline browser game\n");
