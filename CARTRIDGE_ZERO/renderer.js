(function (root) {
  "use strict";
  class CartridgeRenderer {
    constructor(canvas, core) {
      this.core = core;
      this.stage = new root.QsolNative.Stage(canvas, {
        width: 160,
        height: 192,
      });
      this.stage.oblique(0.38, 0.6);
      this.stage.shape("talon", [
        [0, 1],
        [-1, -0.4],
        [-0.35, 0],
        [0, -1],
        [0.35, 0],
        [1, -0.4],
      ]);
      this.stage.shape("invader", [
        [-1, -0.3],
        [-0.55, -0.3],
        [-0.55, -0.85],
        [0.55, -0.85],
        [0.55, -0.3],
        [1, -0.3],
        [1, 0.6],
        [0.5, 0.6],
        [0.5, 1],
        [-0.5, 1],
        [-0.5, 0.6],
        [-1, 0.6],
      ]);
    }
    render(state, ui) {
      const s = this.stage,
        c = this.core,
        p = ui.palette,
        mono = ui.monochrome;
      const col = (key) =>
        mono
          ? { dim: "#263126", secondary: "#91a891", cool: "#6f866f" }[key] ||
            "#c9dcc1"
          : p[key];
      s.begin(mono ? "#070907" : p.bg);
      if (!state) {
        s.text("CARTRIDGE ZERO // SEVEN SIGNALS");
        s.finish();
        return;
      }
      const g = state.game,
        id = state.gameId,
        fp = c.FP,
        L = (n) => n / fp;
      const box = (group, x, y, w, h, color, z = 0, d = 3) =>
        s.flat(group, "bevel", x, y, z, w, h, d, color);
      const ship = (
        group,
        x,
        y,
        color,
        size = 5,
        shape = "dart",
        angle = 0,
      ) => {
        s.flat(group, shape, x, y, 6, size, size, size * 0.8, color, angle);
        s.flat(
          group,
          "diamond",
          x,
          y,
          10,
          size * 0.3,
          size * 0.5,
          size * 0.2,
          col("cool"),
          angle,
        );
      };
      const shots = (list, hostile = false) => {
        for (const e of list || [])
          box(
            "projectiles",
            L(e.x),
            L(e.y),
            hostile ? 1.8 : 1,
            4,
            hostile ? col("secondary") : col("main"),
            12,
            2,
          );
      };
      const tank = (e, hostile) => {
        const x = L(e.x),
          y = L(e.y),
          v = c.DIR16[e.angle],
          a = Math.atan2(v.y, v.x),
          color = col(hostile ? "secondary" : "main");
        box(hostile ? "enemies" : "player", x, y, 9, 9, color, 3, 5);
        for (const dx of [-5, 5])
          box("treads", x + dx, y, 2, 11, col("dim"), 2, 3);
        s.flat(
          hostile ? "enemies" : "player",
          "cylinder",
          x,
          y,
          7,
          3,
          3,
          3,
          color,
        );
        s.line(
          "turrets",
          x,
          y,
          x + (v.x * 8) / 1024,
          y + (v.y * 8) / 1024,
          10,
          color,
          2,
        );
      };
      // Every cartridge keeps its own playfield, coordinate mapping and silhouettes.
      if (id === "prism-break") {
        box("terrain", 4, 96, 2, 178, col("dim"), -2, 8);
        box("terrain", 156, 96, 2, 178, col("dim"), -2, 8);
        for (const b of g.bricks) {
          box(
            "bricks",
            L(b.x),
            L(b.y),
            L(b.w),
            L(b.h),
            mono ? (b.band % 2 ? "#8ca08c" : "#c5d5bd") : p.bands[b.band],
            2,
            5,
          );
          if (b.hp > 1)
            box("indicators", L(b.x), L(b.y), 3, 1, col("dim"), 5, 1);
        }
        box("player", L(g.paddleX), 178, 28, 4, col("main"), 3, 5);
        s.flat(
          "ball",
          "sphere",
          L(g.ball.x),
          L(g.ball.y),
          7,
          1.7,
          1.7,
          1.7,
          col("secondary"),
        );
        s.text(g.ball.stuck ? "FIRE TO SERVE" : ui.paused ? "SIGNAL HELD" : "");
      } else if (id === "gridburn") {
        const lane = (n, y) => 80 + (n - 3) * (7 + Math.max(0, y - 22) * 0.22);
        for (let n = -0.5; n <= 6.5; n++)
          s.line(
            "terrain",
            lane(n, 22),
            22,
            lane(n, 191),
            191,
            -6,
            col("dim"),
            0.5,
          );
        for (let row = 0; row < 11; row++) {
          const phase =
              ((s.reducedMotion ? 0 : state.tick * 0.65) + row * 18) % 180,
            y = 22 + (phase * phase) / 190;
          s.line(
            "terrain",
            lane(-0.5, y),
            y,
            lane(6.5, y),
            y,
            -6,
            col("dim"),
            0.5,
          );
        }
        for (const e of g.enemies) {
          const y = L(e.y),
            size = 2 + y / 55;
          ship(
            "enemies",
            lane(e.lane, y),
            y,
            col(e.kind === 2 ? "secondary" : "cool"),
            size,
            e.kind === 1 ? "talon" : "invader",
          );
        }
        for (const [list, hostile] of [
          [g.shots, false],
          [g.enemyShots, true],
        ])
          for (const e of list)
            box(
              "projectiles",
              lane(e.lane, L(e.y)),
              L(e.y),
              hostile ? 2 : 1,
              5,
              col(hostile ? "secondary" : "main"),
              12,
              2,
            );
        const y = 176 - g.row * 15;
        ship("player", lane(g.lane, y), y, col("main"), 4);
      } else if (id === "orbital-siege" || id === "star-talon") {
        if (id === "orbital-siege")
          box("terrain", 80, 188, 160, 8, col("dim"), -8, 6);
        for (const e of g.enemies)
          ship(
            "enemies",
            L(e.x),
            L(e.y),
            col(e.state === "diving" || e.row < 2 ? "secondary" : "cool"),
            5,
            id === "star-talon" ? "talon" : "invader",
          );
        ship("player", L(g.playerX), 178, col("main"));
        shots(g.playerShots);
        shots(g.enemyShots, true);
      } else if (id === "rift-runner") {
        // Piecewise linear banks use the same row interpolation as the simulation.
        for (let i = 0; i < g.rows.length - 1; i++) {
          const a = g.rows[i],
            b = g.rows[i + 1],
            y = i * 8 + g.offset / fp - 8;
          for (let k = 0; k < 8; k++) {
            const t = (k + 0.5) / 8,
              left =
                (a.center - a.width / 2) * (1 - t) +
                (b.center - b.width / 2) * t,
              right =
                (a.center + a.width / 2) * (1 - t) +
                (b.center + b.width / 2) * t;
            box("terrain", left / 2, y + k + 0.5, left, 1, col("dim"), -4, 9);
            box(
              "terrain",
              (160 + right) / 2,
              y + k + 0.5,
              160 - right,
              1,
              col("dim"),
              -4,
              9,
            );
          }
          s.line(
            "banks",
            a.center - a.width / 2,
            y,
            b.center - b.width / 2,
            y + 8,
            1,
            col("main"),
            0.65,
          );
          s.line(
            "banks",
            a.center + a.width / 2,
            y,
            b.center + b.width / 2,
            y + 8,
            1,
            col("main"),
            0.65,
          );
        }
        for (const e of g.entities) {
          if (e.kind === "fuel")
            s.flat(
              "pickups",
              "diamond",
              L(e.x),
              L(e.y),
              5,
              3.5,
              4.5,
              4,
              col("main"),
            );
          else {
            box(
              "enemies",
              L(e.x),
              L(e.y),
              11,
              6,
              col(e.kind === "tower" ? "secondary" : "cool"),
              3,
              6,
            );
            box("enemies", L(e.x), L(e.y) - 3, 3, 5, col("secondary"), 7, 4);
          }
        }
        ship("player", L(g.playerX), L(g.playerY), col("main"));
        shots(g.shots);
        shots(g.enemyShots, true);
        s.health(30, 187, 16, 50, g.fuel / 1000, col("main"));
        s.text(`FUEL ${Math.ceil(g.fuel / 10)}%`);
      } else if (id === "iron-circuit") {
        for (const wall of g.walls)
          box(
            "terrain",
            L(wall.x),
            L(wall.y),
            L(wall.w),
            L(wall.h),
            col("dim"),
            -1,
            9,
          );
        for (const [x, y, w, h] of [
          [80, 8, 152, 1],
          [80, 186, 152, 1],
          [4, 97, 1, 178],
          [156, 97, 1, 178],
        ])
          box("terrain", x, y, w, h, col("cool"), -2, 5);
        tank(g.player, false);
        for (const b of g.bots) tank(b, true);
        for (const e of g.shells)
          s.flat(
            "projectiles",
            "sphere",
            L(e.x),
            L(e.y),
            12,
            1.5,
            1.5,
            1.5,
            col(e.owner === "player" ? "main" : "secondary"),
          );
      } else if (id === "skywater-command") {
        box("terrain", 80, 171.5, 160, 41, col("dim"), -12, 4);
        for (let x = 0; x < 160; x += 12)
          s.line("water", x, 154, x + 7, 154, -8, col("cool"), 0.6);
        for (const e of g.targets) {
          const x = L(e.x),
            y = L(e.y),
            water = e.kind === "sub" || e.kind === "skimmer";
          if (water) {
            box(
              "enemies",
              x,
              y,
              e.kind === "sub" ? 17 : 15,
              4,
              col("cool"),
              2,
              4,
            );
            box("enemies", x, y - 3, 5, 4, col("secondary"), 5, 3);
          } else {
            ship(
              "enemies",
              x,
              y,
              col("secondary"),
              5,
              e.kind === "glider" ? "talon" : "invader",
              Math.PI / 2,
            );
            if (e.kind === "rotor")
              s.line("rotors", x - 7, y - 4, x + 7, y - 4, 10, col("cool"), 1);
          }
        }
        for (const [x, aim, hostile] of [
          [24, g.playerAim, false],
          [136, g.aiAim, true],
        ]) {
          const v = c.DIR16[aim];
          box(
            hostile ? "enemies" : "player",
            x,
            181,
            11,
            5,
            col(hostile ? "secondary" : "main"),
            3,
            5,
          );
          s.line(
            "turrets",
            x,
            179,
            x + (v.x * 10) / 1024,
            179 + (v.y * 10) / 1024,
            9,
            col(hostile ? "secondary" : "main"),
            2,
          );
        }
        for (const e of g.shells)
          s.flat(
            "projectiles",
            "sphere",
            L(e.x),
            L(e.y),
            12,
            1.3,
            1.3,
            1.3,
            col(e.owner === "player" ? "main" : "secondary"),
          );
        s.text(
          `YOU ${state.score}  AI ${g.aiScore}  ${Math.ceil(g.timeLeft / c.TICK_RATE)}s`,
        );
      }
      if (!["prism-break", "rift-runner", "skywater-command"].includes(id))
        s.text(ui.paused ? "SIGNAL HELD // P TO RESUME" : "");
      s.finish();
    }
  }
  root.CartridgeRenderer = CartridgeRenderer;
})(window);
