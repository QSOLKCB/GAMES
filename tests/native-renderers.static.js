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
const feedbackContracts = {
  BLACKSTAR_AGA: [/flash,/, /shakeX,/, /shakeY,/, /hurt:/],
  VECTOR_ZERO: [/flash,/, /shakeX,/, /shakeY,/, /hurt:/],
  PIXELWARFRONT: [
    /screenFlash,/,
    /shakeX,/,
    /shakeY,/,
    /if \(shake > 0\) shake -= 1;/,
    /if \(screenFlash > 0\) screenFlash -= 1;/,
  ],
};
for (const [game, patterns] of Object.entries(feedbackContracts)) {
  const app = fs.readFileSync(path.join(root, game, "app.js"), "utf8");
  for (const pattern of patterns)
    assert.match(app, pattern, `${game}: native combat feedback contract`);
}
const sharedNative = fs.readFileSync(
  path.join(root, "shared/qsol-native.js"),
  "utf8",
);
assert.match(sharedNative, /screenFlash\(color, opacity\)/);
assert.match(sharedNative, /shakeView\(x = 0, y = 0\)/);
const blackstarRenderer = fs.readFileSync(
  path.join(root, "BLACKSTAR_AGA", "renderer.js"),
  "utf8",
);
assert.match(blackstarRenderer, /data-marker="exit"/);
assert.match(blackstarRenderer, /data-marker="heading"/);
const vectorRenderer = fs.readFileSync(
  path.join(root, "VECTOR_ZERO", "renderer.js"),
  "utf8",
);
assert.match(vectorRenderer, /data-contact="pickup-\$\{e\.kind\}"/);
assert.match(vectorRenderer, /data-contact="enemy"/);
const inertiaRenderer = fs.readFileSync(
  path.join(root, "SUBSPACE", "renderer.js"),
  "utf8",
);
assert.match(inertiaRenderer, /game\.camera\.shake/);
assert.match(inertiaRenderer, /s\.shakeView\(shakeX, shakeY\)/);

assert.equal(
  fs.existsSync(path.join(root, "shared/qsol-three-stage.js")),
  false,
);
console.log(
  "PASS native renderer dependency graph: one canvas, no Canvas gameplay, no overlay or canvas textures",
);
