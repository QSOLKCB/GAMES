(function (root) {
  "use strict";
  const T = root.THREE;
  class BlackstarRenderer {
    constructor(canvas, core) {
      this.core = core;
      this.stage = new root.QsolNative.Stage(canvas, {
        width: 320,
        height: 200,
        perspective: true,
        fov: 43,
        background: "#101719",
      });
      this.stage.scene.fog = new T.Fog("#101719", 7, 24);
      this.lastTick = -1;
      this.lastState = null;
      this.bursts = [];
      this.map = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.map.classList.add("native-map");
      this.map.hidden = true;
      canvas.parentElement.appendChild(this.map);
      this.stage.ownedNodes.push(this.map);
      const reticle = document.createElement("span");
      reticle.className = "native-reticle";
      reticle.textContent = "+";
      canvas.parentElement.appendChild(reticle);
      this.stage.ownedNodes.push(reticle);
    }
    render(state, ui = {}) {
      const s = this.stage,
        c = this.core;
      s.begin();
      this.map.style.display = ui.automap && state ? "block" : "none";
      if (!state) {
        s.text("BLACKSTAR RECOVERY MONITOR // READY");
        s.finish();
        return;
      }
      if (this.lastState !== state) {
        this.lastState = state;
        this.lastTick = -1;
        this.bursts = [];
      }
      if (this.lastTick !== state.tick) {
        this.bursts = this.bursts.filter((e) => state.tick - e.tick < 24);
        for (const e of state.events)
          if (e.type === "enemy-down")
            this.bursts.push({
              x: e.x / c.FP,
              z: e.y / c.FP,
              tick: state.tick,
            });
        this.lastTick = state.tick;
      }
      const palette = ui.palette,
        p = state.player,
        angle = (p.angle / c.ANGLE_MAX) * Math.PI * 2;
      s.scene.background.set(palette.sky);
      s.scene.fog.color.set(palette.sky);
      s.camera.position.set(p.x / c.FP, 0.5, p.y / c.FP);
      s.camera.lookAt(
        p.x / c.FP + Math.cos(angle),
        0.5,
        p.y / c.FP + Math.sin(angle),
      );
      // The collision grid is authoritative, including opened doors and breached secrets.
      for (let y = 0; y < state.blueprint.height; y++)
        for (let x = 0; x < state.blueprint.width; x++) {
          const cell = c.cellAt(state, x, y);
          s.item(
            "terrain",
            "box",
            x + 0.5,
            -0.045,
            y + 0.5,
            1,
            0.08,
            1,
            palette.floor,
          );
          if (c.isBlockingCell(state, x, y)) {
            const door = cell === "D" || cell === "K",
              metal = cell === "P",
              barrier = cell === "B";
            const color = door
              ? palette.wall[2]
              : metal
                ? palette.wall[1]
                : barrier
                  ? palette.wall[3]
                  : palette.wall[0];
            s.item(
              door ? "doors" : "terrain",
              "box",
              x + 0.5,
              0.5,
              y + 0.5,
              1,
              1,
              1,
              color,
            );
            s.item(
              "wall-trim",
              "box",
              x + 0.5,
              0.12,
              y + 0.5,
              1.008,
              0.035,
              1.008,
              palette.accent,
            );
            s.item(
              "wall-trim",
              "box",
              x + 0.5,
              0.9,
              y + 0.5,
              1.008,
              0.025,
              1.008,
              palette.wall[3],
            );
          } else {
            // Ceiling ribs give real perspective and depth without obscuring the playfield.
            s.item(
              "ceiling",
              "box",
              x + 0.5,
              1.08,
              y + 0.5,
              1,
              0.06,
              0.06,
              palette.wall[3],
            );
          }
        }
      for (const e of state.enemies) {
        const x = e.x / c.FP,
          z = e.y / c.FP;
        const heavy =
          e.kind === "warden" ? 1.4 : e.kind === "bulwark" ? 1.15 : 1;
        const colors = {
          warden: "#893c38",
          bulwark: "#80604b",
          specter: "#567e78",
          drone: "#5b978c",
          trooper: "#9b6542",
        };
        const color = e.pain > 0 ? "#f4d8a1" : colors[e.kind] || "#677c6e";
        if (e.kind === "drone") {
          s.item("enemies", "sphere", x, 0.55, z, 0.21, 0.12, 0.21, color);
          s.item("enemies", "box", x, 0.55, z, 0.62, 0.05, 0.06, "#344c49");
        } else {
          s.item(
            "enemies",
            "box",
            x,
            0.39,
            z,
            0.32 * heavy,
            0.36 * heavy,
            0.22,
            color,
          );
          s.item(
            "enemies",
            "sphere",
            x,
            0.65,
            z,
            0.14 * heavy,
            0.16,
            0.13,
            "#47554b",
          );
          for (const side of [-1, 1]) {
            s.item(
              "enemies",
              "box",
              x + side * 0.12 * heavy,
              0.12,
              z,
              0.1,
              0.24,
              0.13,
              "#29352f",
            );
            s.item(
              "enemies",
              "cylinder",
              x + side * 0.25 * heavy,
              0.4,
              z,
              0.065,
              0.31,
              0.065,
              color,
            );
          }
        }
        // Red eye and muzzle are actual world objects with wall depth occlusion.
        s.item(
          "enemies",
          "sphere",
          x,
          0.62,
          z,
          0.06,
          0.035,
          0.15,
          "#db7151",
          0,
          0,
          0,
          "glow",
        );
        if (e.muzzle > 0)
          s.item(
            "effects",
            "diamond",
            x,
            0.47,
            z,
            0.12,
            0.12,
            0.12,
            "#ffcc78",
            0,
            0,
            0,
            "glow",
          );
        if (e.kind === "specter")
          s.item(
            "enemies",
            "box",
            x + 0.23,
            0.58,
            z,
            0.035,
            0.48,
            0.06,
            "#a6c8b4",
          );
        if (e.kind === "bulwark" || e.kind === "warden")
          for (const side of [-1, 1])
            s.item(
              "enemies",
              "bevel",
              x + side * 0.28 * heavy,
              0.48,
              z,
              0.18,
              0.45,
              0.3,
              "#553e32",
            );
        if (e.kind === "warden")
          s.item(
            "indicators",
            "box",
            x,
            0.93,
            z,
            0.6 * Math.max(0, e.health / e.maxHealth),
            0.04,
            0.04,
            "#e6a353",
            0,
            0,
            0,
            "glow",
          );
      }
      const colors = {
        medkit: "#d7d1ad",
        armor: "#4f9b8d",
        cells: "#dd9b4f",
        shells: "#b05942",
        breach: "#8d5b3c",
        vulcan: "#7b897d",
        key: "#f0c764",
        archive: "#d7be83",
      };
      for (const e of state.pickups) {
        const x = e.x / c.FP,
          z = e.y / c.FP,
          a = s.reducedMotion ? 0 : state.tick * 0.015;
        s.item(
          "pickups",
          e.kind === "key" ? "ring" : "diamond",
          x,
          0.24,
          z,
          0.13,
          0.13,
          0.13,
          colors[e.kind] || "#cfba8f",
          0,
          a,
          0,
        );
        if (e.kind === "medkit") {
          s.item("pickups", "box", x, 0.24, z, 0.035, 0.16, 0.15, "#a84d3f");
          s.item("pickups", "box", x, 0.24, z, 0.12, 0.035, 0.15, "#a84d3f");
        }
      }
      const exit = state.blueprint.exit,
        open = !c.missionObjectiveDenial(state);
      s.item(
        "exit",
        "box",
        exit.x + 0.5,
        0.4,
        exit.y + 0.5,
        0.55,
        0.75,
        0.12,
        "#293b35",
      );
      s.item(
        "exit",
        "box",
        exit.x + 0.5,
        0.5,
        exit.y + 0.5,
        0.4,
        0.35,
        0.14,
        open ? "#93d3ac" : "#b85840",
        0,
        0,
        0,
        "glow",
      );
      // Camera-relative weapon is still geometry in the same Three.js scene.
      s.camera.updateMatrixWorld();
      const right = new T.Vector3().setFromMatrixColumn(
        s.camera.matrixWorld,
        0,
      );
      const forward = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const gun = s.camera.position
        .clone()
        .addScaledVector(forward, 0.34)
        .addScaledVector(right, 0.1);
      gun.y -= 0.15;
      s.item(
        "player",
        "bevel",
        gun.x,
        gun.y,
        gun.z,
        0.09,
        0.09,
        0.19,
        p.weapon === 1 ? "#74523a" : "#52685c",
        0,
        Math.PI / 2 - angle,
      );
      const barrels = p.weapon === 2 ? 3 : p.weapon === 1 ? 2 : 1;
      for (let i = 0; i < barrels; i++) {
        const offset = (i - (barrels - 1) / 2) * 0.029,
          bx = gun.x + right.x * offset + forward.x * 0.075,
          bz = gun.z + right.z * offset + forward.z * 0.075;
        s.item(
          "player",
          "cylinder",
          bx,
          gun.y + 0.02,
          bz,
          0.013,
          0.17,
          0.013,
          "#263d34",
          Math.PI / 2,
          0,
          Math.PI / 2 - angle,
        );
      }
      for (const e of this.bursts) {
        const age = state.tick - e.tick,
          life = 1 - age / 24;
        for (let i = 0; i < (s.reducedMotion ? 1 : 9); i++) {
          const a = i * 2.399,
            r = age * 0.013;
          s.item(
            "effects",
            "diamond",
            e.x + Math.cos(a) * r,
            0.3 + Math.sin(i) * r,
            e.z + Math.sin(a) * r,
            0.06 * life,
            0.06 * life,
            0.06 * life,
            i % 2 ? "#b3a07b" : "#d9864d",
            0,
            age * 0.1,
            a,
          );
        }
      }
      if (state.tick - state.lastShotTick < 3)
        s.item(
          "effects",
          "diamond",
          gun.x + forward.x * 0.13,
          gun.y,
          gun.z + forward.z * 0.13,
          0.035,
          0.035,
          0.035,
          "#ffe8a2",
          0,
          0,
          0,
          "glow",
        );
      const weapon = c.WEAPONS[p.weapon];
      s.text(
        `VITAL ${p.health}  ARMOR ${p.armor}  ${weapon.name} ${weapon.ammo ? p[weapon.ammo] : "∞"}  SCORE ${state.score}\nKEYS ${p.keys}  ARCHIVES ${state.stats.archives}${ui.notice ? " // " + ui.notice : ""}`,
      );
      if (ui.automap) {
        const w = state.blueprint.width,
          h = state.blueprint.height;
        this.map.setAttribute("viewBox", `0 0 ${w} ${h}`);
        let markup = "";
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++)
            if (c.isBlockingCell(state, x, y))
              markup += `<rect x="${x}" y="${y}" width=".9" height=".9" fill="#687c6c"/>`;
        for (const e of state.enemies)
          markup += `<circle cx="${e.x / c.FP}" cy="${e.y / c.FP}" r=".18" fill="#d96f52"/>`;
        markup += `<circle cx="${p.x / c.FP}" cy="${p.y / c.FP}" r=".23" fill="#f2d286"/>`;
        this.map.innerHTML = markup;
      }
      s.finish();
    }
  }
  root.BlackstarRenderer = BlackstarRenderer;
})(window);
