/* SOVEREIGN LATTICE galaxy renderer.
 *
 * One WebGL canvas through the shared QsolNative.Stage (orthographic,
 * instanced). The simulation state is read-only here. Fleet glyphs reuse the
 * original INERTIA ZERO hull outlines from ../SUBSPACE/skins.js.
 */
(function (root) {
  "use strict";

  const UNKNOWN_STAR = "#3a4a4c";

  function shade(hex, factor) {
    const v = parseInt(hex.slice(1), 16);
    const c = (s) => Math.max(0, Math.min(255, Math.round(((v >> s) & 255) * factor)));
    return `#${[16, 8, 0].map((s) => c(s).toString(16).padStart(2, "0")).join("")}`;
  }

  class LatticeRenderer {
    constructor(canvas, core, skins) {
      this.core = core;
      this.skins = skins;
      this.stage = new root.QsolNative.Stage(canvas, { width: 1280, height: 720, background: "#04080b" });
      for (const [key, hull] of Object.entries(skins.HULLS)) {
        this.stage.shape(`hull-${key}`, hull.hull);
        this.stage.shape(`deck-${key}`, hull.deck);
      }
      this.backdrop = null;
      this.backdropKey = null;
    }

    /** Seeded backdrop dust, materialized once per galaxy (OPT-FAN-001 style reuse). */
    dust(galaxy, seed) {
      const key = `${seed}:${galaxy.width}x${galaxy.height}`;
      if (this.backdropKey === key) return this.backdrop;
      const holder = { rng: seed ^ 0x51ed270b };
      const next = () => {
        holder.rng = (holder.rng + 0x6d2b79f5) >>> 0;
        let t = Math.imul(holder.rng ^ (holder.rng >>> 15), holder.rng | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const dots = [];
      for (let i = 0; i < 520; i++) dots.push({ x: (next() * 1.6 - 0.3) * galaxy.width, y: (next() * 1.6 - 0.3) * galaxy.height, r: 0.6 + next() * 1.4, c: next() < 0.15 ? "#6f6450" : "#2c3c3f" });
      this.backdrop = dots;
      this.backdropKey = key;
      return dots;
    }

    fleetGlyph(group, skin, x, y, size, angle, color) {
      const s = this.stage;
      s.flat(group, `hull-${skin}`, x, y, 14, size, size, size * 0.6, shade(color, 0.45), angle);
      s.flat(group, `deck-${skin}`, x, y, 14 + size * 0.3, size, size, size * 0.3, color, angle);
    }

    render(view) {
      const s = this.stage, core = this.core, state = view.state;
      const cam = view.camera, width = view.width / cam.zoom, height = view.height / cam.zoom;
      const left = cam.x - width / 2, top = cam.y - height / 2;
      s.begin("#04080b");
      s.view(width, height, left, top);
      if (!state) { s.finish(); return; }
      const g = state.galaxy, me = view.player, known = state.empires[me].known, visible = state.visible[me];
      const t = view.reducedMotion ? 0 : view.time;

      for (const d of this.dust(g, state.seed)) s.flat("dust", "sphere", d.x, d.y, -60, d.r / cam.zoom, d.r / cam.zoom, 1, d.c, 0, "glow");

      // Territory halos under owned systems.
      // Territory from the player's own knowledge: live in sensor range,
      // otherwise the last sighting (never the hidden simulation).
      const owners = new Map();
      for (let s = 0; s < g.systems.length; s++) {
        if (!known[s]) continue;
        const intel = core.knownColonies(state, me, s);
        if (intel && intel.colonies.length) owners.set(s, intel.colonies[0].owner);
      }
      for (const [system, owner] of owners) {
        const sys = g.systems[system];
        s.flat("territory", "sphere", sys.x, sys.y, -40, 46, 46, 1, shade(state.empires[owner].color, 0.16), 0, "glow");
      }

      // Lanes.
      const pathSet = new Set();
      const selectedFleet = view.selection?.fleet != null ? state.fleets.find((f) => f.id === view.selection.fleet) : null;
      for (const [a, b] of g.lanes) {
        const A = g.systems[a], B = g.systems[b], explored = known[a] || known[b];
        s.line("lanes", A.x, A.y, B.x, B.y, -20, explored ? "#24484a" : "#152628", 1.6 / cam.zoom + 0.6);
      }
      const drawPath = (fleet, color) => {
        let from = fleet.system;
        for (const step of fleet.path) {
          const A = g.systems[from], B = g.systems[step];
          s.line("routes", A.x, A.y, B.x, B.y, -10, color, 2.2 / cam.zoom + 1);
          pathSet.add(step);
          from = step;
        }
      };
      for (const fleet of state.fleets) if (fleet.owner === me && fleet.path.length) drawPath(fleet, "#3c5d55");
      if (selectedFleet && selectedFleet.owner === me) drawPath(selectedFleet, "#e8bd68");
      if (view.preview && view.preview.length > 1 && view.preview.every((id) => g.systems[id])) {
        for (let i = 1; i < view.preview.length; i++) {
          const A = g.systems[view.preview[i - 1]], B = g.systems[view.preview[i]];
          const segments = 6;
          for (let k = 0; k < segments; k += 2) {
            const p = k / segments, q = (k + 1) / segments;
            s.line("routes", A.x + (B.x - A.x) * p, A.y + (B.y - A.y) * p, A.x + (B.x - A.x) * q, A.y + (B.y - A.y) * q, -8, "#9bddd1", 2 / cam.zoom + 1);
          }
        }
      }

      // Stars and system markers.
      for (const sys of g.systems) {
        const k = known[sys.id];
        const pulse = view.reducedMotion ? 1 : 1 + Math.sin(t * 2 + sys.id) * 0.08;
        s.flat("stars", "sphere", sys.x, sys.y, 0, (k ? 7 : 4.5) * pulse, (k ? 7 : 4.5) * pulse, 4, k ? sys.starColor : UNKNOWN_STAR, 0, "glow");
        if (k) s.flat("stars", "sphere", sys.x, sys.y, 1, 13, 13, 1, shade(sys.starColor, 0.22), 0, "glow");
        if (owners.has(sys.id)) s.ring("owners", sys.x, sys.y, 2, 15, state.empires[owners.get(sys.id)].color);
        if (k && sys.ruins && !state.ruinsClaimed.includes(sys.id)) s.flat("markers", "diamond", sys.x + 13, sys.y - 12, 3, 3.5, 3.5, 3.5, "#c9a0ff", t, "glow");
        if (pathSet.has(sys.id)) s.ring("markers", sys.x, sys.y, 3, 10, "#3c5d55");
      }

      // Fleets: in orbit (fanned around the star) and in transit (on the lane).
      const orbit = new Map();
      for (const fleet of state.fleets) {
        const mine = fleet.owner === me;
        const color = state.empires[fleet.owner].color;
        const stats = core.fleetStats(state, fleet);
        const lead = fleet.ships[0], design = core.designById(state.empires[fleet.owner], lead.design);
        const skin = state.data.hulls[design.hull].skin;
        const size = 8 + Math.min(5, fleet.ships.length);
        if (fleet.progress > 0 && fleet.path.length) {
          const A = g.systems[fleet.system], B = g.systems[fleet.path[0]];
          if (!mine && !(visible[A.id] || visible[B.id])) continue;
          const len = Math.hypot(B.x - A.x, B.y - A.y), p = Math.min(1, fleet.progress / Math.max(1, core.distance(state, A.id, B.id)));
          const x = A.x + (B.x - A.x) * p, y = A.y + (B.y - A.y) * p;
          this.fleetGlyph("fleets", skin, x, y, size, Math.atan2(B.y - A.y, B.x - A.x), color);
          if (len && stats.armed && !mine) s.ring("fleets", x, y, 15, size + 4, "#d36f62");
          continue;
        }
        if (!mine && !visible[fleet.system]) continue;
        const list = orbit.get(fleet.system) || [];
        list.push({ fleet, skin, size, color, armed: stats.armed, mine });
        orbit.set(fleet.system, list);
      }
      for (const [system, list] of orbit) {
        const sys = g.systems[system];
        list.forEach((f, i) => {
          const angle = -Math.PI / 2 + (i - (list.length - 1) / 2) * 0.62;
          const radius = 24;
          const x = sys.x + Math.cos(angle) * radius, y = sys.y + Math.sin(angle) * radius;
          const facing = view.reducedMotion ? -Math.PI / 2 : -Math.PI / 2 + Math.sin(t * 0.8 + f.fleet.id) * 0.18;
          this.fleetGlyph("fleets", f.skin, x, y, f.size, facing, f.color);
          if (selectedFleet && f.fleet.id === selectedFleet.id) s.ring("selection", x, y, 18, f.size + 6, "#e8bd68");
        });
      }

      // Selection, hover, battle pulses and the gamepad cursor.
      if (view.selection?.system != null && g.systems[view.selection.system]) {
        const sys = g.systems[view.selection.system];
        s.ring("selection", sys.x, sys.y, 20, 20 + (view.reducedMotion ? 0 : Math.sin(t * 4) * 1.5), "#e8bd68");
      }
      if (view.hover != null && g.systems[view.hover] && view.hover !== view.selection?.system) {
        const sys = g.systems[view.hover];
        s.ring("selection", sys.x, sys.y, 20, 18, view.moveMode ? "#9bddd1" : "#5d7a74");
      }
      for (const p of view.pulses || []) {
        const sys = g.systems[p.system], life = Math.max(0, Math.min(1, p.life));
        s.ring("effects", sys.x, sys.y, 22, 16 + (1 - life) * 30, p.color);
      }
      if (view.cursor) {
        const c = view.cursor, r = 9 / cam.zoom;
        s.line("cursor", c.x - r, c.y, c.x + r, c.y, 40, "#e8bd68", 1.5 / cam.zoom);
        s.line("cursor", c.x, c.y - r, c.x, c.y + r, 40, "#e8bd68", 1.5 / cam.zoom);
      }
      s.finish();
    }
  }

  root.LatticeRenderer = LatticeRenderer;
  root.LatticeShade = shade;
})(window);
