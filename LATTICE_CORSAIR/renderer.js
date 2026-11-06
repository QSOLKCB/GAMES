/* LATTICE CORSAIR flight renderer: one WebGL canvas through the shared
 * QsolNative.Stage. Reads the flight world; never changes it. Ships use the
 * original INERTIA ZERO hull outlines from ../SUBSPACE/skins.js.
 */
(function (root) {
  "use strict";

  function shade(hex, factor) {
    const v = parseInt(hex.slice(1), 16);
    const c = (s) => Math.max(0, Math.min(255, Math.round(((v >> s) & 255) * factor)));
    return `#${[16, 8, 0].map((s) => c(s).toString(16).padStart(2, "0")).join("")}`;
  }
  const SHOT_COLORS = { laser: "#8fe3ff", cannon: "#ffd27a", turret: "#ff7a66" };

  class CorsairRenderer {
    constructor(canvas, skins) {
      this.skins = skins;
      this.stage = new root.QsolNative.Stage(canvas, { width: 1280, height: 720, background: "#03070a" });
      for (const [key, hull] of Object.entries(skins.HULLS)) {
        this.stage.shape(`hull-${key}`, hull.hull);
        this.stage.shape(`deck-${key}`, hull.deck);
      }
      this.stage.shape("flame", [[0.12, 0], [-0.15, -0.5], [-1, 0], [-0.15, 0.5]]);
      this.dustKey = null;
      this.dust = [];
    }

    starfield(seed) {
      if (this.dustKey === seed) return this.dust;
      let s = seed >>> 0 || 1;
      const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      this.dust = Array.from({ length: 420 }, () => ({ x: next(), y: next(), depth: 0.08 + next() * 0.5, r: 0.6 + next() * 1.5, c: next() < 0.12 ? "#6f6450" : "#2e3e42" }));
      this.dustKey = seed;
      return this.dust;
    }

    ship(group, ship, color, time, reduced) {
      const s = this.stage, hull = this.skins.hull(ship.stats.skin), r = ship.stats.radius, a = ship.angle;
      const cos = Math.cos(a), sin = Math.sin(a), local = (px, py) => [ship.x + (px * cos - py * sin) * r, ship.y + (px * sin + py * cos) * r];
      s.flat(group, `hull-${ship.stats.skin}`, ship.x, ship.y, 10, r, r, r * 1.2, shade(color, 0.42), a);
      s.flat(group, `deck-${ship.stats.skin}`, ship.x, ship.y, 10 + r * 0.32, r, r, r * 0.5, color, a);
      const [cx, cy, cl, cw] = hull.canopy, [kx, ky] = local(cx, cy);
      s.flat(group, "sphere", kx, ky, 10 + r * 0.6, cl * r, cw * r, r * 0.1, "#c8f2ea", a, "glow");
      if (ship.thrusting || ship.boosting) {
        const flicker = reduced ? 1 : 0.85 + 0.15 * Math.sin(time * 57 + ship.id);
        for (const [ex, ey, size] of hull.engines) {
          const [nx, ny] = local(ex, ey), len = r * (ship.boosting ? 2.4 : 1.1) * flicker;
          s.flat("exhaust", "flame", nx, ny, 9, len, size * r * 1.6, 2, ship.boosting ? "#8fe3ff" : "#ffb35c", a, "glow");
        }
      }
      if (ship.shield > 0 && ship.lastHitAge < 0.25) s.ring("shields", ship.x, ship.y, 24, r + 7, "#8fe3ff");
    }

    render(view) {
      const s = this.stage, w = view.world;
      s.begin("#03070a");
      if (!w) { s.view(view.width, view.height, -view.width / 2, -view.height / 2); s.finish(); return; }
      const cam = view.camera, width = view.width / cam.zoom, height = view.height / cam.zoom;
      const left = cam.x - width / 2, top = cam.y - height / 2, time = view.time, reduced = view.reduced;
      s.view(width, height, left, top);
      // Parallax starfield.
      for (const d of this.starfield(view.seed)) {
        const x = left + ((((d.x * 4000 - cam.x * d.depth) % width) + width) % width);
        const y = top + ((((d.y * 4000 - cam.y * d.depth) % height) + height) % height);
        s.flat("dust", "sphere", x, y, -80, d.r / cam.zoom, d.r / cam.zoom, 1, d.c, 0, "glow");
      }
      const L = w.layout;
      // Star and planets.
      s.flat("bodies", "sphere", 0, 0, -30, L.star.radius, L.star.radius, 20, L.star.color, 0, "glow");
      s.flat("bodies", "sphere", 0, 0, -31, L.star.radius * 1.8, L.star.radius * 1.8, 1, shade(L.star.color, 0.22), 0, "glow");
      for (const p of L.planets) {
        // Thin orbit: line segments (the shared torus thickens with radius).
        const r = Math.hypot(p.x, p.y), n = 72;
        for (let i = 0; i < n; i += 2) {
          const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
          s.line("orbits", Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r, -40, "#14302e", 1.4 / cam.zoom);
        }
        s.item("bodies", "sphere", p.x, -p.y, -20, p.radius, p.radius, p.radius, p.color, reduced ? 0 : time * 0.05, 0.3, 0);
      }
      // Stations: rotating ring, hub and faction beacon.
      for (const st of L.stations) {
        const color = view.factionColor(st);
        const spin = reduced ? 0 : time * 0.4;
        s.flat("stations", "ring", st.x, st.y, 4, 38, 38, 6, color, spin, "glow");
        s.flat("stations", "box", st.x, st.y, 6, 26, 26, 18, shade(color, 0.5), spin);
        s.flat("stations", "box", st.x, st.y, 8, 50, 6, 6, shade(color, 0.7), -spin * 0.7);
        if (view.highlight === st.id) s.ring("stations", st.x, st.y, 9, 58, "#e8bd68");
      }
      // Jump gates.
      for (const g of L.gates) {
        const pulse = reduced ? 1 : 1 + Math.sin(time * 2 + g.to) * 0.06;
        s.ring("gates", g.x, g.y, 4, 64 * pulse, view.routeGate === g.to ? "#e8bd68" : "#5fb8a8");
        s.ring("gates", g.x, g.y, 5, 50, "#2c5a54");
        s.flat("gates", "sphere", g.x, g.y, 3, 36, 36, 1, view.routeGate === g.to ? "#3c321a" : "#0f2a28", 0, "glow");
      }
      // Pickups.
      for (const k of w.pickups) s.flat("pickups", "diamond", k.x, k.y, 12, 7, 7, 7, k.credits ? "#e8bd68" : "#9bddd1", reduced ? 0 : time * 2, "glow");
      // Ships.
      for (const ship of w.ships) {
        if (!ship.alive) continue;
        ship.lastHitAge = (w.tick - ship.lastHit) / 60;
        this.ship(ship.isPlayer ? "player" : "ships", ship, view.shipColor(ship), time, reduced);
      }
      // Shots and missiles.
      for (const shot of w.shots) {
        const dx = shot.x - shot.px, dy = shot.y - shot.py, len = Math.hypot(dx, dy) || 1;
        const tail = Math.min(26, len * 2.2);
        s.line("shots", shot.x - dx / len * tail, shot.y - dy / len * tail, shot.x, shot.y, 20, SHOT_COLORS[shot.kind] || "#ffffff", shot.kind === "cannon" ? 3 : 2);
      }
      for (const m of w.missiles) {
        s.flat("shots", "dart", m.x, m.y, 21, 5, 7, 3, "#ffcf8a", m.angle + Math.PI / 2, "glow");
        s.line("shots", m.px - Math.cos(m.angle) * 14, m.py - Math.sin(m.angle) * 14, m.x, m.y, 19, "#ff8a4c", 1.5);
      }
      // Effects.
      for (const e of w.effects) {
        const life = Math.max(0, Math.min(1, e.life));
        if (e.type === "explosion") {
          s.ring("effects", e.x, e.y, 30, e.radius * (1.2 - life), e.color);
          s.flat("effects", "sphere", e.x, e.y, 29, e.radius * life * 0.6, e.radius * life * 0.6, 2, "#fff0c8", 0, "glow");
        } else s.flat("effects", "sphere", e.x, e.y, 30, 4 * life + 1, 4 * life + 1, 1, e.color, 0, "glow");
      }
      // Target bracket and off-screen indicators.
      const p = w.player, target = p.target != null ? w.ships.find((x) => x.id === p.target && x.alive) : null;
      if (target) s.ring("ui", target.x, target.y, 40, target.stats.radius + 12 + (reduced ? 0 : Math.sin(time * 6) * 2), view.hostile(target) ? "#ff7a66" : "#9bddd1");
      const margin = 40 / cam.zoom;
      for (const ship of w.ships) {
        if (!ship.alive || ship.isPlayer || !view.hostile(ship)) continue;
        if (ship.x > left && ship.x < left + width && ship.y > top && ship.y < top + height) continue;
        const a = Math.atan2(ship.y - cam.y, ship.x - cam.x);
        const ex = Math.max(left + margin, Math.min(left + width - margin, cam.x + Math.cos(a) * width));
        const ey = Math.max(top + margin, Math.min(top + height - margin, cam.y + Math.sin(a) * height));
        s.flat("ui", "dart", ex, ey, 60, 7 / cam.zoom, 9 / cam.zoom, 2, "#ff7a66", a + Math.PI / 2, "glow");
      }
      if (view.waypoint) {
        const wp = view.waypoint, inside = wp.x > left && wp.x < left + width && wp.y > top && wp.y < top + height;
        if (!inside) {
          const a = Math.atan2(wp.y - cam.y, wp.x - cam.x);
          const ex = Math.max(left + margin, Math.min(left + width - margin, cam.x + Math.cos(a) * width));
          const ey = Math.max(top + margin, Math.min(top + height - margin, cam.y + Math.sin(a) * height));
          s.flat("ui", "dart", ex, ey, 60, 9 / cam.zoom, 12 / cam.zoom, 2, "#e8bd68", a + Math.PI / 2, "glow");
        }
      }
      // Velocity marker ahead of the player.
      if (p.alive) {
        const v = Math.hypot(p.vx, p.vy);
        if (v > 30) s.flat("ui", "sphere", p.x + p.vx * 0.6, p.y + p.vy * 0.6, 50, 3, 3, 1, "#3f8c82", 0, "glow");
      }
      s.finish();
    }
  }
  root.CorsairRenderer = CorsairRenderer;
  root.CorsairShade = shade;
})(window);
