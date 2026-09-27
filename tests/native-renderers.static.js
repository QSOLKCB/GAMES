"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
const games = [
  "BLACKSTAR_AGA",
  "CARTRIDGE_ZERO",
  "PIXELWARFRONT",
  "VECTOR_ZERO",
  "SEEDSTORM",
  "SUBSPACE",
];
for (const game of games) {
  const html = fs.readFileSync(path.join(root, game, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) =>
    path.resolve(root, game, m[1]),
  );
  assert.ok(scripts.includes(path.join(root, "shared/qsol-native.js")));
  assert.ok(scripts.includes(path.join(root, game, "renderer.js")));
  assert.equal(
    (html.match(/<canvas\b/g) || []).length,
    1,
    `${game} must have one gameplay canvas`,
  );
  for (const script of scripts) {
    if (script.includes("/vendor/")) continue;
    const source = fs.readFileSync(script, "utf8");
    // These games do not need even offscreen texture-generation Canvas calls.
    assert.doesNotMatch(
      source,
      /getContext\s*\(|CanvasTexture|CanvasRenderingContext2D|OffscreenCanvas|QsolThree|qsol-three-layer/,
      `${game}: forbidden secondary drawing surface in ${script}`,
    );
  }
  const app = fs.readFileSync(path.join(root, game, "app.js"), "utf8");
  assert.match(
    app,
    /presentation\.render\(/,
    `${game}: simulation must drive its scene adapter`,
  );
}
assert.equal(
  fs.existsSync(path.join(root, "shared/qsol-three-stage.js")),
  false,
);
console.log(
  "PASS native renderer dependency graph: one canvas, no Canvas gameplay, no overlay or canvas textures",
);
