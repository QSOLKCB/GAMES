(function (root) {
  "use strict";
  const T = root.THREE;
  class VectorRenderer {
    constructor(canvas, core) {
      this.core = core;
      this.stage = new root.QsolNative.Stage(canvas, {
        width: 480,
        height: 270,
        perspective: true,
        fov: (2 * Math.atan(135 / 310) * 180) / Math.PI,
      });
      this.stage.scene.fog = new T.Fog("#071310", 18, 65);
      this.signature = "";
      this.mine = null;
      this.edges = null;
      this.target = new T.Vector3();
      this.projected = new T.Vector3();
      this.cockpitPoint = new T.Vector3();
      this.map = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.map.classList.add("native-map");
      canvas.parentElement.appendChild(this.map);
      this.stage.ownedNodes.push(this.map);
      const reticle = document.createElement("span");
      reticle.className = "native-reticle";
      reticle.textContent = "+";
      canvas.parentElement.appendChild(reticle);
      this.stage.ownedNodes.push(reticle);
    }
    build(state, faces, palette) {
      if (this.signature === state.blueprint.signature) return;
      this.signature = state.blueprint.signature;
      for (const mesh of [this.mine, this.edges])
        if (mesh) {
          mesh.removeFromParent();
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
      const vertices = [],
        colors = [],
        color = new T.Color(palette.wall),
        fp = this.core.FP;
      for (const face of faces)
        for (const i of [0, 1, 2, 0, 2, 3]) {
          const v = face.vertices[i];
          vertices.push(v.x / fp, v.y / fp, v.z / fp);
          colors.push(
            color.r * face.light,
            color.g * face.light,
            color.b * face.light,
          );
        }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute(
        "position",
        new T.Float32BufferAttribute(vertices, 3),
      );
      geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      this.mine = new T.Mesh(
        geometry,
        new T.MeshStandardMaterial({
          vertexColors: true,
          side: T.DoubleSide,
          roughness: 0.85,
        }),
      );
      this.mine.name = "mine-surfaces";
      this.mine.userData.ownedGeometry = true;
      this.edges = new T.LineSegments(
        new T.EdgesGeometry(geometry),
        new T.LineBasicMaterial({ color: palette.edge }),
      );
      this.edges.name = "mine-seams";
      this.edges.userData.ownedGeometry = true;
      this.stage.group("terrain").add(this.mine, this.edges);
    }
    render(state, faces, ui = {}) {
      const s = this.stage,
        c = this.core;
      s.begin();
      this.map.style.display = ui.automap && state ? "block" : "none";
      if (!state) {
        s.shakeView(0, 0);
        s.screenFlash("#972d21", 0);
        s.text("VECTOR ZERO FLIGHT COMPUTER // READY");
        s.finish();
        return;
      }
      this.build(state, faces, ui.palette);
      const p = state.player,
        b = c.getBasis(p.yaw, p.pitch, p.roll),
        fp = c.FP,
        hurt = Math.max(0, Number(ui.hurt) || 0),
        flash = Math.max(0, Number(ui.flash) || 0);
      s.shakeView(ui.shakeX, ui.shakeY);
      s.screenFlash("#972d21", Math.max(hurt / 50, flash / 30));
      s.camera.position.set(p.x / fp, p.y / fp, p.z / fp);
      s.camera.up.set(b.up.x, b.up.y, b.up.z).normalize();
      this.target
        .set(b.forward.x, b.forward.y, b.forward.z)
        .normalize()
        .add(s.camera.position);
      s.camera.lookAt(this.target);
      s.camera.updateMatrixWorld();
      let targetLock = null;
      s.scene.background.set(ui.palette.fog);
      s.scene.fog.color.set(ui.palette.fog);
      for (const e of state.enemies) {
        const r =
            (e.kind === "custodian" ? 560 : e.kind === "sentinel" ? 430 : 360) /
            fp,
          x = e.x / fp,
          y = e.y / fp,
          z = e.z / fp;
        this.projected.set(x, y, z).project(s.camera);
        if (
          this.projected.z > -1 &&
          this.projected.z < 1 &&
          Math.hypot(this.projected.x, this.projected.y) < 0.11
        )
          targetLock = e;
        const color = e.pain
          ? "#ffe0a2"
          : {
              drone: "#8aa698",
              hunter: "#b98252",
              sentinel: "#9c6255",
              custodian: "#d28c55",
            }[e.kind];
        s.item(
          "enemies",
          "diamond",
          x,
          y,
          z,
          r,
          r * 0.7,
          r,
          color,
          0,
          s.reducedMotion ? 0 : state.tick * 0.013,
          e.phase || 0,
        );
        s.item(
          "enemy-cages",
          e.kind === "custodian" ? "sphere" : "box",
          x,
          y,
          z,
          r * 2,
          r * 1.5,
          r * 2,
          color,
          0,
          s.reducedMotion ? 0 : -state.tick * 0.009,
          0,
          "wire",
        );
        s.item(
          "enemies",
          "sphere",
          x,
          y,
          z,
          r * 0.35,
          r * 0.35,
          r * 0.35,
          "#d96a4a",
          0,
          0,
          0,
          "glow",
        );
      }
      const colors = {
        core: "#e7ad62",
        energy: "#74b9ad",
        shield: "#aec39b",
        missiles: "#c87955",
      };
      for (const e of state.pickups) {
        const r = (e.kind === "core" ? 235 : 170) / fp;
        s.item(
          "pickups",
          e.kind === "core" ? "diamond" : "ring",
          e.x / fp,
          e.y / fp,
          e.z / fp,
          r,
          r,
          r,
          colors[e.kind],
          0,
          s.reducedMotion ? 0 : state.tick * 0.018,
        );
      }
      const exit = state.blueprint.exit,
        open = state.coresCollected >= state.coresRequired;
      for (let i = 0; i < 3; i++)
        s.item(
          "exit",
          "ring",
          exit.x / fp,
          exit.y / fp,
          exit.z / fp,
          (510 + i * 90) / fp,
          (510 + i * 90) / fp,
          1,
          open ? "#83c8b3" : "#b25a45",
          i * 0.65,
          i * 0.5,
          0,
          "glow",
        );
      for (const e of state.projectiles)
        s.item(
          "projectiles",
          "sphere",
          e.x / fp,
          e.y / fp,
          e.z / fp,
          e.kind === "missile" ? 0.13 : 0.07,
          0.07,
          0.07,
          e.kind === "laser"
            ? "#f4d477"
            : e.kind === "missile"
              ? "#e77a52"
              : "#73b8a8",
          0,
          0,
          0,
          "glow",
        );
      // A real cockpit frame moves with all six camera axes.
      s.camera.updateMatrixWorld();
      for (const side of [-1, 1]) {
        const point = this.cockpitPoint
          .set(side * 0.12, -0.08, -0.3)
          .applyMatrix4(s.camera.matrixWorld);
        const mesh = s.item(
          "player",
          "box",
          point.x,
          point.y,
          point.z,
          0.025,
          0.02,
          0.18,
          "#425e54",
        );
        const batch = [...s.batches.values()].find((b) => b.mesh === mesh);
        this.stage.scratch.quaternion.copy(s.camera.quaternion);
        this.stage.scratch.updateMatrix();
        mesh.setMatrixAt(batch.used - 1, this.stage.scratch.matrix);
      }
      s.text(
        `${targetLock ? "FIRE SOLUTION // " + c.ENEMY_TYPES[targetLock.kind].name + " " + targetLock.health + "\n" : ""}MINE ${state.sector} // CORES ${state.coresCollected}/${state.coresRequired} // SCORE ${state.score}\nSHIELD ${p.shield}  ENERGY ${p.energy}  MISSILES ${p.missiles}  HOSTILES ${state.enemies.length}${ui.notice ? "\n" + ui.notice : ""}`,
      );
      if (ui.automap) {
        const current = c.worldCell(p),
          bp = state.blueprint;
        this.map.setAttribute("viewBox", `0 0 ${bp.width} ${bp.depth}`);
        let html = "";
        for (const cell of bp.cells)
          if (cell.y === current.y)
            html += `<rect x="${cell.x}" y="${cell.z}" width=".9" height=".9" fill="#34574b"/>`;
        const pickupColors = {
          core: "#e7ad62",
          energy: "#74b9ad",
          shield: "#aec39b",
          missiles: "#c87955",
        };
        for (const e of state.pickups) {
          const cell = c.worldCell(e);
          if (cell.y === current.y)
            html += `<circle data-contact="pickup-${e.kind}" cx="${cell.x + 0.5}" cy="${cell.z + 0.5}" r=".15" fill="${pickupColors[e.kind] || "#9fbca9"}"/>`;
        }
        for (const e of state.enemies) {
          const cell = c.worldCell(e);
          if (cell.y === current.y)
            html += `<circle data-contact="enemy" cx="${cell.x + 0.5}" cy="${cell.z + 0.5}" r=".15" fill="#be7153"/>`;
        }
        html += `<circle cx="${current.x + 0.5}" cy="${current.z + 0.5}" r=".22" fill="#e7ead2"/>`;
        this.map.innerHTML = html;
      }
      s.finish();
    }
  }
  root.VectorRenderer = VectorRenderer;
})(window);
