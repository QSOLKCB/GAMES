(function (root) {
  "use strict";
  class InertiaRenderer {
    constructor(canvas, core, radar) {
      this.core = core;
      this.radar = radar;
      this.stage = new root.QsolNative.Stage(canvas, {
        width: 1280,
        height: 720,
      });
      this.stage.hud.style.bottom = "17%";
      this.stage.hud.style.left = "35%";
      this.stage.hud.style.right = "35%";
    }
    render(game, interpolation) {
      const s = this.stage,
        c = this.core,
        arena = game.arena || game.menuArena,
        menu = game.mode === "menu" || !game.arena;
      s.begin("#03090b");
      const left = menu ? 0 : game.camera.x - game.width / 2,
        top = menu ? 0 : game.camera.y - game.height / 2;
      s.view(game.width, game.height, left, top);
      for (const star of arena.stars) {
        const parallax = s.reducedMotion ? 0 : star.layer;
        const x =
          left +
          (((((star.x - (menu ? 0 : game.camera.x) * parallax) % arena.width) +
            arena.width) %
            arena.width) /
            arena.width) *
            game.width;
        const y =
          top +
          (((((star.y - (menu ? 0 : game.camera.y) * parallax) % arena.height) +
            arena.height) %
            arena.height) /
            arena.height) *
            game.height;
        s.flat(
          "stars",
          "sphere",
          x,
          y,
          -200 * star.layer,
          star.size,
          star.size,
          star.size,
          star.size > 1.5 ? "#8d8160" : "#435b59",
          0,
          "glow",
        );
      }
      if (menu) {
        s.flat(
          "menu-hull",
          "dart",
          game.width * 0.78,
          game.height * 0.55,
          0,
          85,
          85,
          75,
          "#86724d",
          0.4,
        );
        s.text("");
        s.finish();
        this.radar.innerHTML = "";
        return;
      }
      for (let x = 0; x <= arena.width; x += 320)
        s.line("grid", x, 0, x, arena.height, -90, "#132b2c", 1);
      for (let y = 0; y <= arena.height; y += 275)
        s.line("grid", 0, y, arena.width, y, -90, "#132b2c", 1);
      for (const [x1, y1, x2, y2] of [
        [0, 0, arena.width, 0],
        [arena.width, 0, arena.width, arena.height],
        [arena.width, arena.height, 0, arena.height],
        [0, arena.height, 0, 0],
      ])
        s.line("boundary", x1, y1, x2, y2, -5, "#a18753", 3);
      for (const e of arena.obstacles) {
        if (e.type === "circle") {
          const crystal = e.kind === "crystal";
          s.item(
            "obstacles",
            crystal ? "diamond" : "rock",
            e.x,
            -e.y,
            -5,
            e.r,
            e.r,
            e.r * 0.65,
            crystal ? "#355e5f" : "#394644",
            0.25,
            0.3,
            s.reducedMotion
              ? e.phase
              : e.phase + game.simulationTime * e.spin * 0.07,
          );
          // The ring is the exact collision radius; relief does not change physics.
          s.ring(
            "collision-rims",
            e.x,
            e.y,
            1,
            e.r,
            crystal ? "#638f87" : "#5c6c62",
          );
        } else {
          s.flat(
            "obstacles",
            "box",
            e.x + e.w / 2,
            e.y + e.h / 2,
            -12,
            e.w,
            e.h,
            30,
            e.kind === "citadel" ? "#344c49" : "#253f42",
          );
          s.line("obstacle-seams", e.x, e.y, e.x + e.w, e.y, 4, "#a18c59", 2);
        }
      }
      const objective = arena.objective,
        status = game.objectiveState;
      if (status) {
        const color =
          status.contested || status.flash > 0 ? "#d36f62" : "#b5a473";
        s.ring(
          "objective",
          objective.x,
          objective.y,
          -1,
          objective.radius,
          color,
        );
        if (status.type === "core")
          s.item(
            "objective",
            "diamond",
            objective.x,
            -objective.y,
            0,
            objective.radius * 0.7,
            objective.radius * 0.7,
            35,
            "#487572",
            0.3,
            0.2,
            s.reducedMotion ? 0 : game.simulationTime * 0.08,
          );
        else
          s.flat(
            "objective",
            "diamond",
            objective.x,
            objective.y,
            0,
            8,
            8,
            14,
            color,
          );
        s.health(
          objective.x,
          objective.y + objective.radius + 14,
          30,
          100,
          status.progress || 0,
          color,
        );
      }
      for (const e of game.pickups)
        s.item(
          "pickups",
          "diamond",
          e.x,
          -e.y,
          7,
          7,
          9,
          7,
          e.type === "energy" ? "#8fc5a6" : "#e8bd68",
          0.2,
          0.3,
          s.reducedMotion ? 0 : e.phase,
        );
      for (const e of game.projectiles) {
        const x = c.lerp(e.previousX, e.x, interpolation),
          y = c.lerp(e.previousY, e.y, interpolation),
          v = Math.max(1, Math.hypot(e.vx, e.vy));
        s.line(
          "projectiles",
          x,
          y,
          x - (e.vx / v) * (e.kind === "gun" ? 16 : 9),
          y - (e.vy / v) * (e.kind === "gun" ? 16 : 9),
          18,
          e.color,
          e.kind === "gun" ? 2 : 3,
        );
        if (e.kind !== "gun" && e.kind !== "shard")
          s.flat(
            "projectiles",
            "sphere",
            x,
            y,
            19,
            e.radius || 5,
            e.radius || 5,
            4,
            e.color,
          );
      }
      for (const e of game.ships) {
        if (!e.alive) continue;
        if (
          !e.isPlayer &&
          e.cloak > 0 &&
          game.player?.alive &&
          c.distanceSquared(e, game.player) > 250 * 250
        )
          continue;
        if (!s.geometries.has(e.type))
          s.shape(e.type, game.shipVertices(e.type));
        const x = c.lerp(e.previousX, e.x, interpolation),
          y = c.lerp(e.previousY, e.y, interpolation),
          r = e.config.radius,
          color = e.team === 1 ? "#edca78" : "#d97668";
        s.flat(
          e.isPlayer ? "player" : "enemies",
          e.type,
          x,
          y,
          9,
          r,
          r,
          r * 1.4,
          e.flash > 0 ? "#efd6aa" : e.cloak > 0 ? "#334c48" : color,
          e.angle,
        );
        s.line(
          "hull-detail",
          x - Math.cos(e.angle) * r * 0.4,
          y - Math.sin(e.angle) * r * 0.4,
          x + Math.cos(e.angle) * r * 0.7,
          y + Math.sin(e.angle) * r * 0.7,
          20,
          e.config.accent,
          2,
        );
        if ((e.control.thrust || e.control.boost) && !s.reducedMotion) {
          const length = e.control.boost ? r * 1.8 : r * 0.9;
          s.line(
            "exhaust",
            x - Math.cos(e.angle) * r * 0.7,
            y - Math.sin(e.angle) * r * 0.7,
            x - Math.cos(e.angle) * (r + length),
            y - Math.sin(e.angle) * (r + length),
            5,
            "#c9a56a",
            5,
          );
        }
        if (e.invulnerable > 0 || e.barrier > 0)
          s.ring(
            "shields",
            x,
            y,
            25,
            r + 8,
            e.barrier > 0 ? "#72b9ad" : "#e8bd68",
          );
        if (
          !e.isPlayer &&
          e.cloak <= 0 &&
          game.player &&
          c.distanceSquared(e, game.player) < 720 * 720
        )
          s.health(
            x,
            y + r + 8,
            30,
            34,
            e.energy / e.config.maxEnergy,
            "#d97668",
          );
        if (!e.isPlayer && e.cloak <= 0 && game.player?.alive) {
          const px = x - left,
            py = y - top;
          if (
            px < 38 ||
            px > game.width - 38 ||
            py < 160 ||
            py > game.height - 100
          ) {
            const angle = Math.atan2(py - game.height / 2, px - game.width / 2);
            s.flat(
              "indicators",
              "dart",
              left + c.clamp(px, 38, game.width - 38),
              top + c.clamp(py, 160, Math.max(160, game.height - 100)),
              80,
              6,
              8,
              3,
              "#d97668",
              angle + Math.PI / 2,
              "glow",
            );
          }
        }
      }
      for (const e of game.particles) {
        const life = c.clamp(e.life / e.maxLife, 0, 1);
        if (e.type === "spark") {
          if (!s.reducedMotion)
            s.line(
              "effects",
              e.previousX,
              e.previousY,
              e.x,
              e.y,
              22,
              e.color,
              Math.max(0.3, e.size * life),
            );
        } else
          s.ring(
            "effects",
            e.x,
            e.y,
            25,
            e.radius * (1 - life * 0.82),
            e.color,
          );
      }
      s.text(
        !game.player?.alive && game.mode === "playing"
          ? game.lives > 0
            ? `RECONSTRUCTING PILOT HULL\n${Math.max(0, game.player.respawnTimer).toFixed(1)} SECONDS`
            : "SIGNAL TERMINATED"
          : "",
      );
      this.drawRadar(game);
      s.finish();
    }
    drawRadar(game) {
      const a = game.arena,
        c = this.core;
      if (!a) return;
      this.radar.setAttribute("viewBox", `0 0 ${a.width} ${a.height}`);
      let html = `<rect width="${a.width}" height="${a.height}" fill="#030a0c"/>`;
      for (const o of a.obstacles)
        html +=
          o.type === "circle"
            ? `<circle cx="${o.x}" cy="${o.y}" r="${o.r}" fill="#30423f"/>`
            : `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="#30423f"/>`;
      const o = a.objective;
      html += `<circle cx="${o.x}" cy="${o.y}" r="${o.radius}" fill="none" stroke="#bca261" stroke-width="10"/>`;
      for (const e of game.pickups)
        html += `<circle cx="${e.x}" cy="${e.y}" r="15" fill="${e.type === "energy" ? "#7fc19e" : "#e8bd68"}"/>`;
      for (const e of game.ships) {
        if (!e.alive) continue;
        if (
          !e.isPlayer &&
          e.cloak > 0 &&
          (!game.player.alive || c.distanceSquared(e, game.player) > 220 * 220)
        )
          continue;
        html += `<circle cx="${e.x}" cy="${e.y}" r="${e.isPlayer ? 30 : 22}" fill="${e.isPlayer ? "#edca78" : "#d97668"}"/>`;
      }
      html += `<rect x="${game.camera.x - game.width / 2}" y="${game.camera.y - game.height / 2}" width="${game.width}" height="${game.height}" fill="none" stroke="#9aaea7" stroke-width="8"/>`;
      this.radar.innerHTML = html;
    }
  }
  root.InertiaRenderer = InertiaRenderer;
})(window);
