(function (root) {
  "use strict";
  const T = root.THREE;

  function visualHash(a, b, c) {
    let x = (a ^ Math.imul(b, 0x9e3779b1) ^ Math.imul(c, 0x85ebca6b)) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  }

  class SeedstormRenderer {
    constructor(canvas, core) {
      this.core = core;
      this.stage = new root.QsolNative.Stage(canvas, {
        width: core.WIDTH,
        height: core.HEIGHT,
      });
      const shapes = {
        player: [
          [0, -18],
          [7, -5],
          [18, 7],
          [7, 8],
          [4, 17],
          [0, 12],
          [-4, 17],
          [-7, 8],
          [-18, 7],
          [-7, -5],
        ],
        scout: [
          [0, 14],
          [12, -9],
          [4, -6],
          [0, -15],
          [-4, -6],
          [-12, -9],
        ],
        wing: [
          [0, 14],
          [18, -4],
          [8, -8],
          [0, -14],
          [-8, -8],
          [-18, -4],
        ],
        bomber: [
          [0, 20],
          [22, 8],
          [18, -11],
          [7, -8],
          [0, -20],
          [-7, -8],
          [-18, -11],
          [-22, 8],
        ],
        boss: [
          [0, 1],
          [0.65, 0.4],
          [1, -0.08],
          [0.6, -0.3],
          [0.34, -0.67],
          [0, -1],
          [-0.34, -0.67],
          [-0.6, -0.3],
          [-1, -0.08],
          [-0.65, 0.4],
        ],
      };
      for (const [name, points] of Object.entries(shapes))
        this.stage.shape(name, points);
      this.flash = new T.Mesh(
        new T.PlaneGeometry(core.WIDTH, core.HEIGHT),
        new T.MeshBasicMaterial({
          color: 0xefe0c8,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      this.flash.name = "combat-flash";
      this.flash.frustumCulled = false;
      this.flash.renderOrder = 10000;
      this.flash.visible = false;
      this.flash.userData.ownedGeometry = true;
      this.stage.scene.add(this.flash);
    }
    render(state, ui) {
      const s = this.stage,
        c = this.core,
        shake = Math.max(0, Number(ui.shake) || 0),
        flash = Math.max(0, Number(ui.flash) || 0);
      let shakeX = 0,
        shakeY = 0;
      if (state && shake > 0 && !s.reducedMotion) {
        const amount = Math.min(1, shake / 8);
        shakeX = ((visualHash(state.tick, shake, 1) % 7) - 3) * amount;
        shakeY = ((visualHash(state.tick, shake, 2) % 7) - 3) * amount;
      }
      s.camera.position.set(-shakeX, shakeY, 2000);
      this.flash.material.opacity = Math.min(0.28, flash / 70);
      this.flash.visible = this.flash.material.opacity > 0;
      this.flash.position.set(
        s.camera.position.x + c.WIDTH / 2,
        s.camera.position.y - c.HEIGHT / 2,
        s.camera.position.z - 1,
      );
      s.begin("#0c1519");
      if (!state) {
        s.text("SEEDSTORM // STRIKE SYSTEM READY");
        s.finish();
        return;
      }
      const scale = c.SCALE,
        tick = state.tick,
        p = state.player;
      const palette = ui.palette || { ground: "#152329", detail: "#34505a" };
      // Industrial canyon: segmented embankments and buried pipework sit well
      // beneath the aircraft. Leave the central fire lane quiet and readable.
      const scroll = s.reducedMotion
        ? 0
        : state.levelTick * (1.1 + Math.min(state.level, 12) * 0.06);
      for (let row = -2; row < 13; row++) {
        const y = row * 72 + (scroll % 72);
        const phase = Math.floor(scroll / 72) + row,
          hash = Math.imul(phase + state.seed, 2654435761) >>> 0;
        for (const side of [-1, 1]) {
          const width = 28 + (hash % 47),
            x = side < 0 ? width / 2 - 8 : c.WIDTH - width / 2 + 8;
          s.flat("terrain", "bevel", x, y, -35, width, 69, 28, palette.deep);
          s.flat(
            "terrain",
            "bevel",
            x - side * 9,
            y,
            -17,
            width * 0.55,
            54,
            15,
            palette.grid,
          );
          s.line(
            "pipework",
            x + side * width * 0.3,
            y - 34,
            x + side * width * 0.3,
            y + 34,
            -6,
            palette.grid,
            4,
          );
          if ((hash & 3) === 0)
            s.flat(
              "terrain",
              "box",
              x,
              y,
              -5,
              7,
              4,
              2,
              palette.accent,
              0,
              "glow",
            );
        }
        s.line("substructure", 50, y, c.WIDTH - 50, y, -70, "#16242a", 1);
      }
      for (const x of [120, c.WIDTH - 120])
        s.line("substructure", x, 0, x, c.HEIGHT, -80, palette.grid, 1);
      for (const e of state.pickups) {
        const x = e.x / scale,
          y = e.y / scale,
          color = e.kind === "power" ? "#6fa4b2" : "#df6c45";
        s.item(
          "pickups",
          "diamond",
          x,
          -y,
          12,
          10,
          10,
          9,
          color,
          0.2,
          0.3,
          s.reducedMotion ? 0 : tick * 0.035,
        );
        if (e.kind === "power") {
          s.line(
            "pickup-symbols",
            x - 4,
            y + 4,
            x - 4,
            y - 4,
            24,
            "#e5e7cd",
            2,
          );
          s.line(
            "pickup-symbols",
            x - 4,
            y - 4,
            x + 3,
            y - 4,
            24,
            "#e5e7cd",
            2,
          );
          s.line("pickup-symbols", x + 3, y - 4, x + 3, y, 24, "#e5e7cd", 2);
          s.line("pickup-symbols", x - 4, y, x + 3, y, 24, "#e5e7cd", 2);
        } else
          s.flat(
            "pickup-symbols",
            "sphere",
            x,
            y,
            24,
            3,
            3,
            3,
            "#e5e7cd",
            0,
            "glow",
          );
      }
      for (const e of state.enemies) {
        const x = e.x / scale,
          y = e.y / scale,
          r = e.radius / scale,
          hit = (ui.enemyHitUntil.get(e.id) || -1) >= tick;
        s.flat(
          "shadows",
          s.geometries.has(e.kind) ? e.kind : "sphere",
          x + 10,
          y + 14,
          -5,
          e.kind === "boss" ? r : s.geometries.has(e.kind) ? 1 : r,
          e.kind === "boss" ? r : s.geometries.has(e.kind) ? 1 : r,
          0.1,
          "#050b0f",
          0,
          "glow",
        );
        const color = hit
          ? "#fff4dc"
          : {
              scout: "#ad5339",
              wing: "#8f9aa0",
              turret: "#4f5e64",
              bomber: "#6b5146",
              spinner: "#ce6040",
              boss: "#343f45",
            }[e.kind];
        if (e.kind === "turret") {
          s.item(
            "enemies",
            "cylinder",
            x,
            -y,
            6,
            16,
            9,
            16,
            color,
            Math.PI / 2,
          );
          s.flat(
            "enemies",
            "box",
            x,
            y + 4,
            13,
            7,
            18,
            7,
            "#d86642",
            ((e.pathSeed % 8) * Math.PI) / 4,
          );
        } else if (e.kind === "spinner") {
          const a = s.reducedMotion ? 0 : (tick + e.id * 7) * 0.025;
          s.flat("enemies", "box", x, y, 9, 38, 5, 6, "#b4bebc", a);
          s.flat("enemies", "box", x, y, 9, 5, 38, 6, "#b4bebc", a);
          s.flat("enemies", "sphere", x, y, 14, 8, 8, 7, color);
        } else {
          const size = e.kind === "boss" ? r : 1;
          s.flat(
            "enemies",
            e.kind,
            x,
            y,
            8,
            size,
            size,
            e.kind === "boss" ? 30 : 22,
            color,
          );
          s.flat(
            "enemies",
            "diamond",
            x,
            y,
            19,
            e.kind === "boss" ? 15 : 4,
            e.kind === "boss" ? 27 : 8,
            6,
            "#d96a47",
          );
        }
        if (e.health < e.maxHealth || e.kind === "boss")
          s.health(
            x,
            y - r - 9,
            42,
            Math.min(110, r * 2),
            e.health / e.maxHealth,
            "#df7b50",
          );
      }
      for (const e of state.playerBullets)
        s.line(
          "projectiles",
          e.x / scale,
          e.y / scale + 8,
          e.x / scale - e.vx / 64,
          e.y / scale - 8,
          23,
          "#d8edf0",
          3,
        );
      for (const e of state.enemyBullets) {
        const r = Math.max(2.5, (e.radius / scale) * 0.72);
        s.flat(
          "enemy-projectiles",
          "sphere",
          e.x / scale,
          e.y / scale,
          23,
          r,
          r,
          r,
          e.grazed ? "#d8cbb5" : "#e25f3b",
          0,
          "glow",
        );
      }
      const x = p.x / scale,
        y = p.y / scale;
      s.flat(
        "shadows",
        "player",
        x + 12,
        y + 18,
        -6,
        1,
        1,
        0.1,
        "#050b0f",
        0,
        "glow",
      );
      s.flat(
        "player",
        "player",
        x,
        y,
        10,
        1,
        1,
        24,
        p.invulnerable > 0 ? "#b7d6ce" : "#d9e0dc",
      );
      s.flat("player", "diamond", x, y, 24, 4, 10, 4, "#527b88");
      if (!s.reducedMotion) {
        s.flat(
          "exhaust",
          "dart",
          x,
          y + 28,
          5,
          5,
          14,
          3,
          "#df8950",
          Math.PI,
          "glow",
        );
      }
      if (p.invulnerable > 0) s.ring("indicators", x, y, 20, 22, "#9ec5be");
      if (ui.heldInput & c.INPUT.FOCUS)
        s.ring("indicators", x, y, 29, 10, "#e9e3d5");
      if (state.bombPulse > 0)
        s.ring(
          "effects",
          x,
          y,
          32,
          (1 - state.bombPulse / 45) * 520 + 1,
          "#efe0c8",
        );
      s.effects(ui.effects, tick);
      const warning =
        !state.bossDefeated &&
        state.levelTick >= state.blueprint.bossTick - 180 &&
        state.levelTick < state.blueprint.bossTick;
      s.text(
        `LV ${state.level} // ${state.blueprint.biome.name}${warning ? "\nCOMMAND SIGNATURE DETECTED" : ""}`,
      );
      s.finish();
    }
  }
  root.SeedstormRenderer = SeedstormRenderer;
})(window);
