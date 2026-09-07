"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.match(html, /Content-Security-Policy/);
assert.match(html, /connect-src 'none'/);
assert.match(html, /\.\.\/\.\.\/vendor\/three\/three\.min\.js/);
assert.match(html, /<script src="core\.js"><\/script>\s*<script src="app\.js"><\/script>/);
assert.doesNotMatch(html, /https?:\/\//i);

for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const reference = match[1];
  if (reference.startsWith("#")) continue;
  assert.ok(fs.existsSync(path.resolve(root, reference)), `missing local dependency: ${reference}`);
}
for (const file of ["app.js", "core.js", "style.css"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.doesNotMatch(source, /https?:\/\//i, `${file} must stay network-free`);
}
console.log("TERNARY DRIFT offline boundary OK");
