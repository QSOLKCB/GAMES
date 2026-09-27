(function (root) {
  "use strict";
  class WarfrontRenderer {
    constructor(canvas, core) {
      this.core = core;
      this.stage = new root.QsolNative.Stage(canvas, {
        width: core.WIDTH,
        height: core.HEIGHT,
      });
      this.stage.oblique(0.35, 0.5);
    }
    render(state, ui) {
      const s = this.stage,
        c = this.core;
      s.begin(ui.palette?.ground || "#11181b");
      if (!state) {
        s.text("PIXEL WARFRONT // COMMAND THEATRE READY");
        s.finish();
        return;
      }
      const p = ui.palette,
        scale = c.SCALE;
      for (let row = 0; row < c.GRID_ROWS; row++)
        for (let col = 0; col < c.GRID_COLUMNS; col++) {
          const tile = state.blueprint.terrain[row * c.GRID_COLUMNS + col],
            size = c.CELL_SIZE;
          s.flat(
            "terrain",
            "box",
            (col + 0.5) * size,
            (row + 0.5) * size + 12,
            -12,
            size - 1,
            size - 1,
            tile === 1 ? 10 : 3,
            tile === 1
              ? p.high
              : tile === 2
                ? p.low
                : tile === 3
                  ? "#241e19"
                  : p.ground,
          );
        }
      for (const e of state.resources)
        if (e.amount > 0) {
          const ratio = e.amount / e.maxAmount;
          for (let i = 0; i < 6; i++) {
            const a = i * 2.399 + e.phase,
              r = 5 + i * 2;
            s.item(
              "resources",
              "diamond",
              e.x / scale + Math.cos(a) * r,
              -e.y / scale - Math.sin(a) * r,
              -1,
              4 + ratio * 3,
              5 + ratio * 4,
              8 + ratio * 8,
              p.mineral,
              0.4,
              0.3,
              a,
            );
          }
        }
      const colors = (e) =>
        e.team === c.PLAYER
          ? {
              body: "#526f77",
              edge: "#a4c2c7",
              glow: "#65a3af",
              dark: "#142127",
            }
          : {
              body: "#7d3c31",
              edge: "#e58a69",
              glow: "#e06844",
              dark: "#271411",
            };
      for (const e of state.buildings) {
        const x = e.x / scale,
          y = e.y / scale,
          r = e.radius / scale,
          color = colors(e),
          progress =
            e.construction > 0
              ? 1 - e.construction / Math.max(1, e.constructionTotal)
              : 1;
        s.flat("buildings", "bevel", x, y, 0, r * 1.8, r * 1.8, 5, color.dark);
        const h = 8 + progress * 22;
        s.flat(
          "shadows",
          "box",
          x + 7,
          y + 10,
          -3,
          r * 1.8,
          r * 1.7,
          1,
          "#080d0e",
          0,
          "glow",
        );
        if (e.kind === "relay") {
          s.item(
            "buildings",
            "cylinder",
            x,
            -y,
            h / 2,
            r * 0.5,
            h,
            r * 0.5,
            color.body,
            Math.PI / 2,
          );
          s.item(
            "buildings",
            "ring",
            x,
            -y,
            h + 4,
            r * 0.75,
            r * 0.75,
            2,
            color.glow,
            0.65,
            0,
            s.reducedMotion ? 0 : state.tick * 0.01,
            "glow",
          );
        } else if (e.kind === "refinery") {
          for (const dx of [-r * 0.4, r * 0.4])
            s.item(
              "buildings",
              "cylinder",
              x + dx,
              -y,
              h / 2,
              r * 0.35,
              h,
              r * 0.35,
              color.body,
              Math.PI / 2,
            );
          s.flat("buildings", "bevel", x, y, h, r * 1.4, 4, 3, color.glow);
        } else if (e.kind === "turret") {
          s.flat("buildings", "bevel", x, y, 8, r, r, 12, color.body);
          const target = [...state.units, ...state.buildings].find(
              (t) => t.id === e.targetId,
            ),
            angle = target ? Math.atan2(target.y - e.y, target.x - e.x) : 0;
          s.line(
            "turrets",
            x,
            y,
            x + Math.cos(angle) * r * 1.7,
            y + Math.sin(angle) * r * 1.7,
            18,
            color.glow,
            5,
          );
        } else {
          s.flat(
            "buildings",
            "bevel",
            x,
            y,
            h / 2,
            r * 1.5,
            r * 1.3,
            h,
            color.body,
          );
          s.flat(
            "buildings",
            "bevel",
            x,
            y - r * 0.45,
            h / 2 + 5,
            r * 1.1,
            r * 0.35,
            h,
            color.edge,
          );
          s.flat(
            "buildings",
            "bevel",
            x,
            y + r * 0.3,
            h / 2 + 2,
            r * 0.6,
            r * 0.65,
            h + 1,
            color.dark,
          );
          if (e.kind === "hq")
            s.item("buildings", "diamond", x, -y, h + 6, 9, 9, 12, color.glow);
        }
        if (e.construction > 0)
          s.health(x, y + r + 7, 45, r * 2, progress, "#d6a261");
        if (e.queue.length) {
          const q = e.queue[0];
          s.health(
            x,
            y + r + 13,
            45,
            48,
            1 - q.remaining / c.UNIT_TYPES[q.kind].trainTicks,
            "#d6a261",
          );
        }
        if (e.health < e.maxHealth)
          s.health(x, y - r - 9, 45, r * 2, e.health / e.maxHealth, color.glow);
        if (ui.selectedIds.has(e.id))
          s.ring("selection", x, y, 1, r + 7, "#e6ddc9");
        if ((ui.hitUntil.get(e.id) || -1) >= state.tick)
          s.ring("impacts", x, y, 30, r + 2, "#fff1cf");
      }
      for (const e of state.units) {
        const x = e.x / scale,
          y = e.y / scale,
          r = e.radius / scale,
          color = colors(e);
        const target = [...state.units, ...state.buildings].find(
          (t) => t.id === e.targetId,
        );
        const a = target
          ? Math.atan2(target.y - e.y, target.x - e.x) + Math.PI / 2
          : e.order === "move"
            ? Math.atan2(e.targetY - e.y, e.targetX - e.x) + Math.PI / 2
            : 0;
        s.flat(
          "shadows",
          "sphere",
          x + 5,
          y + 7,
          -3,
          r * 1.15,
          r * 0.7,
          1,
          "#080d0e",
          0,
          "glow",
        );
        if (e.kind === "ranger") {
          s.flat("units", "dart", x, y, 7, 9, 12, 14, color.body, a);
          s.flat("units", "diamond", x, y, 13, 2, 6, 3, color.glow, a);
        } else if (e.kind === "drone") {
          s.item("units", "rock", x, -y, 8, 9, 9, 6, color.body, 0.3, 0.3, -a);
          s.flat(
            "units",
            "bevel",
            x,
            y,
            15,
            5,
            5,
            3,
            e.carry > 0 ? p.mineral : color.glow,
          );
        } else {
          s.flat("units", "bevel", x, y, 4, 27, 22, 8, color.dark, a);
          s.flat("units", "bevel", x, y, 10, 18, 17, 8, color.body, a);
          s.line(
            "turrets",
            x,
            y,
            x + Math.sin(a) * 23,
            y - Math.cos(a) * 23,
            17,
            color.glow,
            5,
          );
        }
        if (ui.selectedIds.has(e.id)) {
          s.ring("selection", x, y, 0, r + 7, "#e6ddc9");
          if (e.order === "move") {
            s.line(
              "orders",
              x,
              y,
              e.targetX / scale,
              e.targetY / scale,
              0,
              "#80978e",
              1,
            );
            s.ring(
              "orders",
              e.targetX / scale,
              e.targetY / scale,
              0,
              5,
              "#b3cabf",
            );
          }
        }
        if (e.health < e.maxHealth)
          s.health(x, y - r - 7, 35, 24, e.health / e.maxHealth, color.glow);
        if ((ui.hitUntil.get(e.id) || -1) >= state.tick)
          s.ring("impacts", x, y, 24, r + 3, "#fff1cf");
      }
      for (const e of state.projectiles) {
        const x = e.x / scale,
          y = e.y / scale,
          v = Math.max(1, Math.hypot(e.vx, e.vy)),
          color = e.team === c.PLAYER ? "#bfe7ea" : "#f07b50";
        s.line(
          "projectiles",
          x,
          y,
          x - (e.vx / v) * 10,
          y - (e.vy / v) * 10,
          18,
          color,
          2,
        );
        s.flat(
          "projectiles",
          "sphere",
          x,
          y,
          18,
          Math.max(2, e.radius / scale),
          2,
          2,
          color,
          0,
          "glow",
        );
      }
      s.effects(ui.effects, state.tick);
      if (ui.pointerDown && ui.dragStart && ui.dragCurrent) {
        const a = ui.dragStart,
          b = ui.dragCurrent;
        for (const [x1, y1, x2, y2] of [
          [a.x, a.y, b.x, a.y],
          [b.x, a.y, b.x, b.y],
          [b.x, b.y, a.x, b.y],
          [a.x, b.y, a.x, a.y],
        ])
          s.line("selection", x1, y1, x2, y2, 55, "#9fc4c9", 1);
      }
      s.text(
        `MISSION ${state.level} // ${state.blueprint.biome.name} // ${state.blueprint.signature}`,
      );
      s.finish();
    }
  }
  root.WarfrontRenderer = WarfrontRenderer;
})(window);
