"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const titles = [
  ["BLACKSTAR_AGA", "BlackstarRenderer", "terrain", "enemies"],
  ["CARTRIDGE_ZERO", "CartridgeRenderer", "bricks", "ball"],
  ["PIXELWARFRONT", "WarfrontRenderer", "terrain", "units"],
  ["VECTOR_ZERO", "VectorRenderer", "terrain", "enemies"],
  ["SEEDSTORM", "SeedstormRenderer", "terrain", "enemies"],
  ["SUBSPACE", "InertiaRenderer", "obstacles", "enemies"],
];
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.GAMES_CHROMIUM || chromium.executablePath(),
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  try {
    for (const [game, rendererName, worldGroup, actorGroup] of titles) {
      const page = await browser.newPage({
          viewport: { width: 1280, height: 900 },
        }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (e) => {
        if (e.type() === "error") errors.push(e.text());
      });
      await page.addInitScript(
        ({ rendererName }) => {
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            if (type === "2d")
              throw new Error("Canvas 2D is forbidden in native gameplay");
            return getContext.call(this, type, ...args);
          };
          // Observe the real adapter boundary without changing or advancing the simulation.
          Object.defineProperty(window, rendererName, {
            configurable: true,
            set(Renderer) {
              Object.defineProperty(window, rendererName, {
                value: class extends Renderer {
                  render(state, ...args) {
                    window.__renderState = state;
                    window.__renderArgs = args;
                    window.__presentation = this;
                    return super.render(state, ...args);
                  }
                },
                writable: true,
                configurable: true,
              });
            },
          });
        },
        { rendererName },
      );
      const url = process.env.GAMES_TEST_ORIGIN
        ? `${process.env.GAMES_TEST_ORIGIN}/${game}/index.html`
        : pathToFileURL(path.join(root, game, "index.html")).href;
      await page.goto(url);
      if (game === "SUBSPACE") await page.click("#launch-button");
      else await page.click("#startButton");
      await page.waitForFunction(
        () =>
          window.__renderState &&
          (window.__renderState.tick > 15 ||
            window.__renderState.simulationTime > 0.4),
      );
      if (game === "SEEDSTORM")
        await page.waitForFunction(
          () => window.__renderState.enemies.length > 0,
        );
      const report = await page.evaluate(
        ({ game, worldGroup, actorGroup }) => {
          const s = document.querySelector("canvas").nativeStage,
            state = window.__renderState;
          const count = (name) => {
            let n = 0;
            const group = s.scene.getObjectByName(name);
            if (group)
              group.traverse((o) => {
                if (o.isMesh || o.isLineSegments)
                  n += o.isInstancedMesh ? o.count : 1;
              });
            return n;
          };
          const capture = () => {
            s.renderer.render(s.scene, s.camera);
            const gl = s.renderer.getContext(),
              data = new Uint8Array(
                gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
              );
            gl.readPixels(
              0,
              0,
              gl.drawingBufferWidth,
              gl.drawingBufferHeight,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              data,
            );
            return data;
          };
          const pixels = capture(),
            colors = new Set();
          for (let i = 0; i < pixels.length; i += 4)
            colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
          // Remove actual gameplay meshes, leaving atmosphere intact: the image must change.
          const keep = new Set(["stars", "grid", "menu-hull"]);
          const hidden = [];
          for (const [name, group] of s.groups)
            if (!keep.has(name)) {
              hidden.push(group);
              group.visible = false;
            }
          const absent = capture();
          let changed = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (
              pixels[i] !== absent[i] ||
              pixels[i + 1] !== absent[i + 1] ||
              pixels[i + 2] !== absent[i + 2]
            )
              changed++;
          hidden.forEach((g) => (g.visible = true));
          s.renderer.render(s.scene, s.camera);
          const instances = [...s.batches.values()];
          const finite = instances.every((b) =>
            Array.from(b.mesh.instanceMatrix.array.slice(0, b.used * 16)).every(
              Number.isFinite,
            ),
          );
          return {
            renderer: s.renderer instanceof THREE.WebGLRenderer,
            scene: s.scene instanceof THREE.Scene,
            camera: s.camera.isCamera,
            canvases: document.querySelectorAll("canvas").length,
            world: count(worldGroup),
            actors: count(actorGroup),
            player: count(game === "PIXELWARFRONT" ? "units" : "player"),
            colors: colors.size,
            changed,
            finite,
            geometries: s.renderer.info.memory.geometries,
            triangles: s.renderer.info.render.triangles,
          };
        },
        { game, worldGroup, actorGroup },
      );
      console.log(`FRAME ${game}: ${JSON.stringify(report)}`);
      assert.ok(
        report.renderer && report.scene && report.camera,
        `${game}: real Three.js runtime`,
      );
      assert.equal(report.canvases, 1, `${game}: one sole gameplay canvas`);
      assert.ok(
        report.world > 0 && report.actors > 0 && report.player > 0,
        `${game}: scene population ${JSON.stringify(report)}`,
      );
      assert.ok(
        report.colors > 20 &&
          report.changed > 100 &&
          report.triangles > 0 &&
          report.finite,
        `${game}: nonblank gameplay framebuffer ${JSON.stringify(report)}`,
      );
      // Validate actual state coordinates against uploaded instance transforms.
      const aligned = await page.evaluate((game) => {
        const s = __presentation.stage,
          state = __renderState,
          m = new THREE.Matrix4();
        let group, point;
        if (game === "BLACKSTAR_AGA") {
          group = "enemies";
          point = [
            state.enemies[0].x / BlackstarCore.FP,
            state.enemies[0].y / BlackstarCore.FP,
          ];
        } else if (game === "VECTOR_ZERO") {
          group = "enemies";
          point = [
            state.enemies[0].x / VectorZeroCore.FP,
            state.enemies[0].y / VectorZeroCore.FP,
            state.enemies[0].z / VectorZeroCore.FP,
          ];
        } else if (game === "CARTRIDGE_ZERO") {
          group = "ball";
          point = [
            state.game.ball.x / CartridgeZeroCore.FP,
            -state.game.ball.y / CartridgeZeroCore.FP,
          ];
        } else if (game === "PIXELWARFRONT") {
          group = "units";
          point = [
            state.units[0].x / PixelWarfrontCore.SCALE,
            -state.units[0].y / PixelWarfrontCore.SCALE,
          ];
        } else if (game === "SEEDSTORM") {
          group = "player";
          point = [
            state.player.x / SeedStormCore.SCALE,
            -state.player.y / SeedStormCore.SCALE,
          ];
        } else {
          group = "player";
          point = null;
        }
        if (!point) return true;
        for (const [key, b] of s.batches)
          if (key.startsWith(group + "/"))
            for (let i = 0; i < b.used; i++) {
              b.mesh.getMatrixAt(i, m);
              const e = m.elements;
              if (game === "BLACKSTAR_AGA") {
                if (
                  Math.abs(e[12] - point[0]) < 0.001 &&
                  Math.abs(e[14] - point[1]) < 0.001
                )
                  return true;
              } else if (
                Math.abs(e[12] - point[0]) < 0.001 &&
                Math.abs(e[13] - point[1]) < 0.001 &&
                (!point[2] || Math.abs(e[14] - point[2]) < 0.001)
              )
                return true;
            }
        return false;
      }, game);
      assert.ok(aligned, `${game}: simulation-to-instance coordinates`);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(() => __presentation.stage.reducedMotion);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForFunction(() => !__presentation.stage.reducedMotion);
      await page.setViewportSize({ width: 820, height: 720 });
      await page.waitForFunction(() => {
        const s = __presentation.stage,
          r = s.canvas.getBoundingClientRect();
        return (
          Math.abs(s.renderer.domElement.width - Math.round(r.width) * s.dpr) <=
          2
        );
      });
      const tickBefore = await page.evaluate(
        () => __renderState.tick || __renderState.simulationTime,
      );
      await page.keyboard.down(game === "SEEDSTORM" ? "KeyZ" : "Space");
      await page.waitForTimeout(160);
      await page.keyboard.up(game === "SEEDSTORM" ? "KeyZ" : "Space");
      assert.ok(
        await page.evaluate(
          (before) =>
            (__renderState.tick || __renderState.simulationTime) > before,
          tickBefore,
        ),
        `${game}: simulation continues after resize`,
      );
      // Re-render a frozen state repeatedly: no GPU geometry growth, no state mutation.
      const stable = await page.evaluate(() => {
        const p = __presentation,
          s = p.stage,
          was = JSON.stringify(__renderState, (k, v) =>
            k === "presentation" || k === "input" || k === "audio"
              ? undefined
              : v,
          );
        const n = s.renderer.info.memory.geometries;
        for (let i = 0; i < 120; i++) p.render(__renderState, ...__renderArgs);
        return {
          n,
          after: s.renderer.info.memory.geometries,
          unchanged:
            was ===
            JSON.stringify(__renderState, (k, v) =>
              k === "presentation" || k === "input" || k === "audio"
                ? undefined
                : v,
            ),
        };
      });
      assert.equal(stable.n, stable.after);
      assert.ok(stable.unchanged);
      fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
      await page.screenshot({
        path: path.join(root, "test-results", `${game}.png`),
        fullPage: true,
      });
      // Context loss and restoration must retain the only gameplay renderer.
      await page.evaluate(() =>
        __presentation.stage.renderer.forceContextLoss(),
      );
      await page.waitForFunction(() => __presentation.stage.lost);
      await page.evaluate(() =>
        __presentation.stage.renderer.forceContextRestore(),
      );
      await page.waitForFunction(() => !__presentation.stage.lost);
      await page.waitForFunction(
        () => __presentation.stage.renderer.info.render.triangles > 0,
      );
      await page.evaluate(() => __presentation.stage.dispose());
      assert.equal(
        await page.evaluate(() => __presentation.stage.disposed),
        true,
      );
      assert.deepEqual(errors, [], `${game}: console/startup errors`);
      console.log(`PASS ${game}: ${JSON.stringify(report)}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
