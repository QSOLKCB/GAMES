(function (root) {
  "use strict";
  const throttle = (value) =>
    value === true ? 1 : Math.max(0, Math.min(1, Number(value) || 0));
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
      this.skins = root.InertiaSkins;
      for (const [type, hull] of Object.entries(this.skins.HULLS)) {
        this.stage.shape(`skin-${type}`, hull.hull);
        this.stage.shape(`skin-${type}-deck`, hull.deck);
      }
      // Engine flame: blunt at the nozzle (x = 0), tapering aft to x = -1.
      this.stage.shape("flame", [
        [0.12, 0],
        [-0.15, -0.5],
        [-1, 0],
        [-0.15, 0.5],
      ]);
    }
    render(game, interpolation) {
      const s = this.stage,
        c = this.core,
        arena = game.arena || game.menuArena,
        menu = game.mode === "menu" || !game.arena;
      s.begin("#03090b");
      // The camera moves on simulation ticks; interpolate it like the ships
      // so high-refresh displays do not see the whole view step at 60 Hz.
      const camX = menu
          ? 0
          : c.lerp(game.camera.previousX ?? game.camera.x, game.camera.x, interpolation),
        camY = menu
          ? 0
          : c.lerp(game.camera.previousY ?? game.camera.y, game.camera.y, interpolation),
        left = menu ? 0 : camX - game.width / 2,
        top = menu ? 0 : camY - game.height / 2,
        shakeX =
          menu || s.reducedMotion
            ? 0
            : Math.sin(game.attractTime * 47.3) * game.camera.shake,
        shakeY =
          menu || s.reducedMotion
            ? 0
            : Math.cos(game.attractTime * 39.7) * game.camera.shake * 0.72;
      s.view(game.width, game.height, left, top);
      s.shakeView(shakeX, shakeY);
      for (const star of arena.stars) {
        const parallax = s.reducedMotion ? 0 : star.layer;
        const x =
          left +
          (((((star.x - camX * parallax) % arena.width) +
            arena.width) %
            arena.width) /
            arena.width) *
            game.width;
        const y =
          top +
          (((((star.y - camY * parallax) % arena.height) +
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
        const type = game.settings?.ship || "warbird";
        const t = s.reducedMotion ? 0 : game.attractTime;
        this.drawHull("menu-hull", {
          type,
          x: game.width * 0.78,
          y: game.height * 0.55,
          angle: -Math.PI / 2 + 0.35 + Math.sin(t * 0.4) * 0.12,
          r: 70,
          // Muted: this hull sits behind the hangar's briefing text.
          paint: this.mutedPaint(game.settings?.livery, c.SHIPS[type]?.accent),
          thrust: 0.4,
          boost: false,
          reverse: 0,
          turn: 0,
          time: t,
          id: 0,
        });
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
        const x = c.lerp(e.previousX, e.x, interpolation),
          y = c.lerp(e.previousY, e.y, interpolation),
          previousAngle = e.previousAngle ?? e.angle,
          angle = previousAngle + c.angleDelta(previousAngle, e.angle) * interpolation,
          r = e.config.radius,
          control = e.control || {};
        let paint = this.skins.paint(
          e.team === 1 ? game.settings?.livery : "hostile",
          e.config.accent,
        );
        if (e.flash > 0)
          paint = { ...paint, hull: "#efd6aa", deck: "#fff0d0" };
        const energyRatio = e.energy / e.config.maxEnergy;
        if (
          energyRatio < 0.22 &&
          !s.reducedMotion &&
          Math.sin(game.simulationTime * 14 + e.id) > 0.2
        )
          paint = { ...paint, deck: "#6a231c" };
        this.drawHull(e.isPlayer ? "player" : "enemies", {
          type: e.type,
          x,
          y,
          angle,
          r,
          paint,
          cloaked: e.cloak > 0,
          thrust: throttle(control.thrust),
          reverse: throttle(control.reverse),
          boost: Boolean(control.boost) && e.boostHeat > 0.05,
          turn: control.turn || 0,
          time: game.simulationTime,
          id: e.id,
        });
        if (e.isPlayer) this.drawDrift(e, x, y, r);
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
    // One skinned hull: plated base, raised deck, canopy, trim, nozzles,
    // throttle-scaled flames, reverse and rotation thrusters, nav lights.
    drawHull(group, o) {
      const s = this.stage,
        hull = this.skins.hull(o.type),
        { x, y, r, angle, paint } = o,
        cos = Math.cos(angle),
        sin = Math.sin(angle),
        local = (px, py) => [x + (px * cos - py * sin) * r, y + (px * sin + py * cos) * r],
        steady = s.reducedMotion,
        flicker = (seed) =>
          steady ? 1 : 0.84 + 0.16 * Math.sin(o.time * 61 + seed * 2.3 + o.id * 1.7);
      if (o.cloaked) {
        // Cloaked: a faint hull ghost only, no lights or exhaust.
        s.flat(group, `skin-${o.type}`, x, y, 9, r, r, r * 0.6, "#2a3f3c", angle);
        return;
      }
      s.flat(group, `skin-${o.type}`, x, y, 9, r, r, r * 1.3, paint.hull, angle);
      s.flat(group, `skin-${o.type}-deck`, x, y, 9 + r * 0.32, r, r, r * 0.55, paint.deck, angle);
      const detail = `${group}-detail`;
      for (const [x1, y1, x2, y2] of hull.stripes) {
        const [ax, ay] = local(x1, y1),
          [bx, by] = local(x2, y2);
        s.line(detail, ax, ay, bx, by, 9 + r * 0.62, paint.trim, Math.max(1.5, r * 0.09));
      }
      const [cx, cy, cl, cw] = hull.canopy,
        [canopyX, canopyY] = local(cx, cy);
      s.flat(detail, "sphere", canopyX, canopyY, 9 + r * 0.6, cl * r, cw * r, r * 0.12, paint.canopy, angle, "glow");
      const thrust = Math.max(o.thrust, o.boost ? 1 : 0);
      for (const [index, [ex, ey, size]] of hull.engines.entries()) {
        const [nx, ny] = local(ex, ey),
          nozzle = size * r;
        s.flat(detail, "sphere", nx, ny, 9 + r * 0.3, nozzle, nozzle, nozzle * 0.5, thrust > 0 ? paint.core : "#3a3328", 0, "glow");
        if (thrust <= 0) continue;
        const length = r * (o.boost ? 2.3 : 0.55 + 1.1 * thrust) * flicker(index),
          width = nozzle * (o.boost ? 1.9 : 1.55);
        s.flat("exhaust", "flame", nx, ny, 9, length, width, 2, o.boost ? this.skins.BOOST_FLAME : paint.flame, angle, "glow");
        s.flat("exhaust", "flame", nx, ny, 10, length * 0.5, width * 0.5, 2, o.boost ? this.skins.BOOST_CORE : paint.core, angle, "glow");
      }
      if (o.reverse > 0) {
        // Paired retro jets near the nose fire forward.
        for (const side of [-1, 1]) {
          const [jx, jy] = local(0.62, side * 0.26);
          s.flat("exhaust", "flame", jx, jy, 10, r * 0.55 * o.reverse * flicker(side + 5), r * 0.16, 2, paint.flame, angle + Math.PI, "glow");
        }
      }
      if (Math.abs(o.turn) > 0.05) {
        // Rotation thrusters: nose kicks one way, tail the other.
        const side = Math.sign(o.turn),
          puff = r * (0.25 + 0.3 * Math.abs(o.turn)) * flicker(9);
        const [nx, ny] = local(0.72, -side * 0.18),
          [tx, ty] = local(-0.6, side * 0.3);
        // A flame trails aft of its heading, so heading = exhaust direction + pi.
        s.flat("exhaust", "flame", nx, ny, 10, puff, r * 0.12, 2, paint.core, angle + side * Math.PI / 2, "glow");
        s.flat("exhaust", "flame", tx, ty, 10, puff, r * 0.12, 2, paint.core, angle - side * Math.PI / 2, "glow");
      }
      const blink = steady || Math.sin(o.time * 6.3 + o.id) > -0.3;
      if (blink)
        for (const [lx, ly] of hull.lights) {
          const [px, py] = local(lx, ly);
          s.flat(detail, "sphere", px, py, 9 + r * 0.7, r * 0.07, r * 0.07, r * 0.07, ly < 0 ? "#ff5a4f" : "#62ff9a", 0, "glow");
        }
    }
    mutedPaint(livery, accent) {
      const paint = this.skins.paint(livery, accent),
        dim = (hex) => this.skins.shade(hex, 0.5);
      return Object.fromEntries(
        Object.entries(paint).map(([key, value]) => [key, key === "id" ? value : dim(value)]),
      );
    }
    // Drift vector: where momentum is carrying the hull, independent of the
    // nose. Makes Newtonian coasting and counter-thrust readable at a glance.
    drawDrift(ship, x, y, r) {
      const speed = Math.hypot(ship.vx, ship.vy);
      if (speed < 24) return;
      const dx = ship.vx / speed,
        dy = ship.vy / speed,
        start = r * 1.55,
        end = start + Math.min(110, speed * 0.2);
      this.stage.line("drift", x + dx * start, y + dy * start, x + dx * end, y + dy * end, 6, "#2f6c64", 1.25);
      this.stage.flat("drift", "dart", x + dx * end, y + dy * end, 6, 5, 6, 2, "#6fc7b8", Math.atan2(dy, dx) + Math.PI / 2, "glow");
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
