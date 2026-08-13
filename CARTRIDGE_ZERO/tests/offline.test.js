"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const html = read("index.html");
const app = read("app.js");
const core = read("core.js");
const css = read("style.css");
const notice = read("NOTICE.md");
const manual = read("docs/MANUAL.md");

assert.match(html, /default-src 'self'/);
assert.match(html, /connect-src 'none'/);
assert.match(html, /script src="core\.js"/);
assert.match(html, /script src="app\.js"/);
assert.match(html, /link rel="stylesheet" href="style\.css"/);
assert.match(html, /CARTRIDGE ZERO/);
assert.match(app, /core\.encodeReplay/);
assert.match(app, /core\.decodeReplay/);
assert.match(core, /REPLAY_PREFIX = "CZ01"/);
assert.match(notice, /fictional/i);
assert.match(manual, /original modern implementation/i);

for (const program of ["PRISM BREAK", "GRIDBURN", "ORBITAL SIEGE", "STAR TALON", "RIFT RUNNER", "IRON CIRCUIT", "SKYWATER COMMAND"]) {
  assert.match(core, new RegExp(program));
}

for (const [name, source] of [["index.html", html], ["app.js", app], ["core.js", core], ["style.css", css]]) {
  assert.equal(/https?:\/\//i.test(source), false, `${name} must not reference a remote URL`);
}

for (const forbidden of ["breakout", "beamrider", "space invaders", "galaxian", "river raid", "air-sea battle"]) {
  for (const [name, source] of [["index.html", html], ["app.js", app], ["core.js", core], ["style.css", css], ["README.md", read("README.md")], ["manual", manual]]) {
    assert.equal(source.toLowerCase().includes(forbidden), false, `${name} must not use third-party title ${forbidden}`);
  }
}

const localReferences = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]).filter((reference) => !reference.startsWith("#"));
for (const reference of localReferences) assert.equal(fs.existsSync(path.join(root, reference)), true, `missing local asset ${reference}`);

const files = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
assert.deepEqual(files.filter((file) => /\.(png|jpe?g|gif|webp|mp3|ogg|wav|woff2?|ttf)$/i.test(file)), []);

process.stdout.write("ok - CARTRIDGE ZERO is a self-contained original offline seven-game browser cartridge\n");
