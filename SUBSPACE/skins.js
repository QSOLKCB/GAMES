/* INERTIA ZERO hull skins and liveries.
 *
 * Presentation data only: nothing here changes collision, physics or AI. Hull
 * outlines are original INERTIA ZERO designs drawn in hull-radius units with
 * +x forward and +y to starboard. Collision remains the configured radius.
 *
 * One source drives the WebGL flight renderer (renderer.js) and the SVG hangar
 * cards (app.js), so the ship you pick is the ship you fly.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.InertiaSkins = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // hull/deck: polygons. canopy: [x, y, halfLength, halfWidth].
  // stripes: trim segments [x1, y1, x2, y2]. engines: nozzles [x, y, size].
  // lights: navigation lights [x, y]; negative y is port (red).
  const HULLS = Object.freeze({
    warbird: {
      hull: [[1.15, 0], [0.35, -0.22], [0.1, -0.6], [-0.55, -0.95], [-0.78, -0.8], [-0.6, -0.28], [-0.8, 0], [-0.6, 0.28], [-0.78, 0.8], [-0.55, 0.95], [0.1, 0.6], [0.35, 0.22]],
      deck: [[0.86, 0], [0.22, -0.15], [-0.48, -0.2], [-0.6, 0], [-0.48, 0.2], [0.22, 0.15]],
      canopy: [0.4, 0, 0.3, 0.11],
      stripes: [[0.08, -0.52, -0.5, -0.86], [0.08, 0.52, -0.5, 0.86]],
      engines: [[-0.72, -0.17, 0.13], [-0.72, 0.17, 0.13]],
      lights: [[-0.62, -0.88], [-0.62, 0.88]],
    },
    javelin: {
      hull: [[1.35, 0], [0.55, -0.14], [-0.2, -0.2], [-0.55, -0.62], [-0.84, -0.6], [-0.7, -0.16], [-0.86, 0], [-0.7, 0.16], [-0.84, 0.6], [-0.55, 0.62], [-0.2, 0.2], [0.55, 0.14]],
      deck: [[1.04, 0], [0.3, -0.09], [-0.62, -0.1], [-0.62, 0.1], [0.3, 0.09]],
      canopy: [0.52, 0, 0.26, 0.075],
      stripes: [[-0.28, -0.3, -0.7, -0.52], [-0.28, 0.3, -0.7, 0.52], [1.0, 0, 0.82, 0]],
      engines: [[-0.84, 0, 0.16]],
      lights: [[-0.78, -0.58], [-0.78, 0.58]],
    },
    spider: {
      hull: [[0.95, -0.16], [1.1, -0.5], [0.62, -0.46], [0.2, -0.86], [-0.35, -0.96], [-0.8, -0.56], [-0.6, -0.2], [-0.8, 0], [-0.6, 0.2], [-0.8, 0.56], [-0.35, 0.96], [0.2, 0.86], [0.62, 0.46], [1.1, 0.5], [0.95, 0.16], [0.52, 0]],
      deck: [[0.38, 0], [0.04, -0.36], [-0.46, -0.3], [-0.56, 0], [-0.46, 0.3], [0.04, 0.36]],
      canopy: [0.1, 0, 0.2, 0.13],
      stripes: [[0.62, -0.46, 0.98, -0.42], [0.62, 0.46, 0.98, 0.42], [-0.2, -0.72, -0.6, -0.52], [-0.2, 0.72, -0.6, 0.52]],
      engines: [[-0.7, -0.33, 0.1], [-0.7, 0.33, 0.1]],
      lights: [[1.02, -0.46], [1.02, 0.46]],
    },
    leviathan: {
      hull: [[1.05, 0], [0.8, -0.3], [0.45, -0.42], [0.35, -0.9], [-0.55, -0.96], [-0.86, -0.7], [-0.75, -0.35], [-0.95, -0.18], [-0.95, 0.18], [-0.75, 0.35], [-0.86, 0.7], [-0.55, 0.96], [0.35, 0.9], [0.45, 0.42], [0.8, 0.3]],
      deck: [[0.76, 0], [0.4, -0.28], [-0.62, -0.3], [-0.72, 0], [-0.62, 0.3], [0.4, 0.28]],
      canopy: [0.56, 0, 0.17, 0.14],
      stripes: [[0.25, -0.68, -0.6, -0.68], [0.25, 0.68, -0.6, 0.68]],
      engines: [[-0.86, -0.66, 0.14], [-0.92, 0, 0.17], [-0.86, 0.66, 0.14]],
      lights: [[0.3, -0.9], [0.3, 0.9]],
    },
    terrier: {
      hull: [[1.12, -0.48], [1.12, -0.3], [0.5, -0.18], [0.62, 0], [0.5, 0.18], [1.12, 0.3], [1.12, 0.48], [0.3, 0.76], [-0.45, 0.86], [-0.76, 0.5], [-0.6, 0.2], [-0.78, 0], [-0.6, -0.2], [-0.76, -0.5], [-0.45, -0.86], [0.3, -0.76]],
      deck: [[0.44, 0], [0.2, -0.3], [-0.5, -0.32], [-0.6, 0], [-0.5, 0.32], [0.2, 0.3]],
      canopy: [0.17, 0, 0.2, 0.12],
      stripes: [[1.02, -0.39, 0.34, -0.52], [1.02, 0.39, 0.34, 0.52]],
      engines: [[-0.68, -0.43, 0.12], [-0.68, 0.43, 0.12]],
      lights: [[-0.42, -0.84], [-0.42, 0.84]],
    },
    weasel: {
      hull: [[1.2, 0], [0.45, -0.3], [0.2, -0.7], [-0.1, -0.45], [-0.7, -0.5], [-0.5, -0.15], [-0.66, 0], [-0.5, 0.15], [-0.7, 0.5], [-0.1, 0.45], [0.2, 0.7], [0.45, 0.3]],
      deck: [[0.86, 0], [0.3, -0.18], [-0.4, -0.16], [-0.4, 0.16], [0.3, 0.18]],
      canopy: [0.45, 0, 0.22, 0.1],
      // Emitter spikes reach past the hull outline: the EW signature.
      stripes: [[0.2, -0.68, -0.02, -0.98], [0.2, 0.68, -0.02, 0.98], [0.8, 0, 0.62, 0]],
      engines: [[-0.6, 0, 0.13]],
      lights: [[-0.02, -0.98], [-0.02, 0.98]],
    },
    lancaster: {
      hull: [[1.1, 0], [0.7, -0.35], [0.55, -0.72], [0, -0.82], [-0.55, -0.74], [-0.86, -0.36], [-0.7, 0], [-0.86, 0.36], [-0.55, 0.74], [0, 0.82], [0.55, 0.72], [0.7, 0.35]],
      deck: [[0.6, 0], [0.3, -0.42], [-0.3, -0.42], [-0.55, 0], [-0.3, 0.42], [0.3, 0.42]],
      canopy: [0.36, 0, 0.2, 0.14],
      stripes: [[0.5, -0.6, -0.45, -0.63], [0.5, 0.6, -0.45, 0.63]],
      engines: [[-0.78, -0.4, 0.12], [-0.78, 0.4, 0.12]],
      lights: [[0, -0.82], [0, 0.82]],
    },
    shark: {
      hull: [[1.2, 0], [0.6, -0.2], [0.15, -0.32], [-0.3, -0.92], [-0.56, -0.88], [-0.45, -0.3], [-0.86, -0.12], [-0.86, 0.12], [-0.45, 0.3], [-0.56, 0.88], [-0.3, 0.92], [0.15, 0.32], [0.6, 0.2]],
      deck: [[0.95, 0], [0.35, -0.12], [-0.62, -0.14], [-0.62, 0.14], [0.35, 0.12]],
      canopy: [0.5, 0, 0.25, 0.1],
      stripes: [[0.05, -0.4, -0.36, -0.82], [0.05, 0.4, -0.36, 0.82]],
      engines: [[-0.84, 0, 0.14]],
      lights: [[-0.43, -0.9], [-0.43, 0.9]],
    },
  });

  // Player-selectable paint schemes. "factory" follows each hull's accent.
  const LIVERIES = Object.freeze({
    factory: Object.freeze({ id: "factory", name: "Factory", hull: null, deck: null, trim: "#edca78", canopy: "#bff1e6", flame: "#ffb35c", core: "#fff1c9" }),
    midnight: Object.freeze({ id: "midnight", name: "Midnight", hull: "#1a2430", deck: "#3b536d", trim: "#6fd6ff", canopy: "#c4f4ff", flame: "#58b8ff", core: "#e4f7ff" }),
    ember: Object.freeze({ id: "ember", name: "Ember", hull: "#3a1c13", deck: "#c4552b", trim: "#ffb347", canopy: "#ffe0a3", flame: "#ff7a2f", core: "#ffe7b8" }),
    ivory: Object.freeze({ id: "ivory", name: "Ivory", hull: "#a7a294", deck: "#ece6d6", trim: "#c8902f", canopy: "#4a6f78", flame: "#ffc46b", core: "#fff4d6" }),
    verdant: Object.freeze({ id: "verdant", name: "Verdant", hull: "#1d3224", deck: "#4e8a5a", trim: "#c9f27a", canopy: "#e2ffd0", flame: "#9cff6a", core: "#f1ffe0" }),
  });

  // Every hostile flies one readable scheme regardless of hull.
  const HOSTILE = Object.freeze({ id: "hostile", name: "Hostile", hull: "#40201f", deck: "#a8473f", trim: "#ff7a66", canopy: "#ffb3a3", flame: "#ff6a4a", core: "#ffd6c4" });
  const BOOST_FLAME = "#8fe3ff";
  const BOOST_CORE = "#f2fcff";

  function shade(hex, factor) {
    const value = parseInt(String(hex).slice(1), 16);
    const channel = (shift) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * factor)));
    return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
  }

  /** Resolved colours for one hull in one scheme. */
  function paint(liveryId, accent) {
    const livery = liveryId === "hostile" ? HOSTILE : LIVERIES[liveryId] || LIVERIES.factory;
    return {
      id: livery.id,
      hull: livery.hull || shade(accent || "#edca78", 0.42),
      deck: livery.deck || accent || "#edca78",
      trim: livery.trim,
      canopy: livery.canopy,
      flame: livery.flame,
      core: livery.core,
    };
  }

  function hull(type) {
    return HULLS[type] || HULLS.warbird;
  }

  /** Nose-up SVG markup for the hangar and HUD (original vector art). */
  function svg(type, liveryId, accent, className) {
    const h = hull(type);
    const c = paint(liveryId, accent);
    // Rotate +x forward to point up: (x, y) -> (y, -x).
    const point = ([x, y]) => `${(y * 20).toFixed(2)},${(-x * 20).toFixed(2)}`;
    const polygon = (points) => points.map(point).join(" ");
    const [cx, cy, cl, cw] = h.canopy;
    const parts = [
      `<polygon points="${polygon(h.hull)}" fill="${c.hull}" stroke="${c.trim}" stroke-width="1.1" stroke-linejoin="round"/>`,
      `<polygon points="${polygon(h.deck)}" fill="${c.deck}" opacity=".92"/>`,
      ...h.stripes.map(([x1, y1, x2, y2]) => `<line x1="${(y1 * 20).toFixed(2)}" y1="${(-x1 * 20).toFixed(2)}" x2="${(y2 * 20).toFixed(2)}" y2="${(-x2 * 20).toFixed(2)}" stroke="${c.trim}" stroke-width="1.5" stroke-linecap="round"/>`),
      ...h.engines.map(([x, y, size]) => `<circle cx="${(y * 20).toFixed(2)}" cy="${(-x * 20).toFixed(2)}" r="${(size * 20).toFixed(2)}" fill="${c.flame}"/>`),
      `<ellipse cx="${(cy * 20).toFixed(2)}" cy="${(-cx * 20).toFixed(2)}" rx="${(cw * 20).toFixed(2)}" ry="${(cl * 20).toFixed(2)}" fill="${c.canopy}"/>`,
    ];
    return `<svg class="${className || "mini-ship"}" viewBox="-24 -28 48 48" aria-hidden="true">${parts.join("")}</svg>`;
  }

  return Object.freeze({ HULLS, LIVERIES, HOSTILE, BOOST_FLAME, BOOST_CORE, paint, hull, svg, shade });
});
