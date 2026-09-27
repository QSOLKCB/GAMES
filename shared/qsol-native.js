/* Native gameplay infrastructure. One existing canvas, no secondary renderer or 2D surface. */
(function (root) {
  "use strict";
  const T = root.THREE;
  class Stage {
    constructor(
      canvas,
      {
        width = canvas.width,
        height = canvas.height,
        perspective = false,
        fov = 55,
        background = "#080d10",
      } = {},
    ) {
      this.canvas = canvas;
      this.width = width;
      this.height = height;
      this.scene = new T.Scene();
      this.scene.background = new T.Color(background);
      this.camera = perspective
        ? new T.PerspectiveCamera(fov, width / height, 0.03, 200)
        : new T.OrthographicCamera(0, width, 0, -height, 0.1, 6000);
      if (!perspective) this.camera.position.z = 2000;
      try {
        this.renderer = new T.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: false,
        });
      } catch (error) {
        const message = document.createElement("p");
        message.className = "native-error";
        message.textContent =
          "This game requires WebGL. Enable hardware acceleration and reload.";
        canvas.parentElement.appendChild(message);
        throw error;
      }
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.scene.add(new T.HemisphereLight(0xdce9e5, 0x25303a, 1.5));
      const light = new T.DirectionalLight(0xffdcb2, 2.2);
      light.position.set(-300, 500, 800);
      this.scene.add(light);
      this.groups = new Map();
      this.geometries = new Map();
      this.batches = new Map();
      this.scratch = new T.Object3D();
      this.color = new T.Color();
      this.geometries.set("box", new T.BoxGeometry(1, 1, 1));
      const slab = new T.Shape();
      slab.moveTo(-0.46, -0.46);
      slab.lineTo(0.46, -0.46);
      slab.lineTo(0.46, 0.46);
      slab.lineTo(-0.46, 0.46);
      slab.closePath();
      const bevel = new T.ExtrudeGeometry(slab, {
        depth: 0.86,
        bevelEnabled: true,
        bevelThickness: 0.07,
        bevelSize: 0.04,
        bevelSegments: 1,
        steps: 1,
      });
      bevel.translate(0, 0, -0.43);
      this.geometries.set("bevel", bevel);
      this.geometries.set("sphere", new T.IcosahedronGeometry(1, 1));
      this.geometries.set("rock", new T.IcosahedronGeometry(1, 0));
      this.geometries.set("diamond", new T.OctahedronGeometry(1));
      this.geometries.set("ring", new T.TorusGeometry(1, 0.045, 4, 40));
      this.geometries.set("cylinder", new T.CylinderGeometry(1, 1, 1, 10));
      this.shape("dart", [
        [0, -1],
        [-0.9, 0.75],
        [0, 0.35],
        [0.9, 0.75],
      ]);
      this.material = new T.MeshStandardMaterial({
        roughness: 0.7,
        metalness: 0.25,
        flatShading: true,
      });
      this.glow = new T.MeshBasicMaterial({ toneMapped: false });
      this.wire = new T.MeshBasicMaterial({ wireframe: true });
      this.ownedNodes = [];
      this.hud = document.createElement("div");
      this.hud.className = "native-hud";
      canvas.parentElement.appendChild(this.hud);
      this.media = root.matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion = this.media.matches;
      this.onMotion = (event) => {
        this.reducedMotion = event.matches;
      };
      this.media.addEventListener("change", this.onMotion);
      this.lost = false;
      this.disposed = false;
      this.onLost = (event) => {
        event.preventDefault();
        this.lost = true;
        this.hud.textContent = "WebGL context lost — waiting for recovery";
      };
      this.onRestored = () => {
        this.lost = false;
      };
      canvas.addEventListener("webglcontextlost", this.onLost);
      canvas.addEventListener("webglcontextrestored", this.onRestored);
      this.onPageHide = (event) => {
        if (!event.persisted) this.dispose();
      };
      root.addEventListener("pagehide", this.onPageHide);
      // Read-only diagnostic entry point also used by the actual-WebGL regression suite.
      canvas.nativeStage = this;
    }
    shape(name, points) {
      if (this.geometries.has(name)) return;
      const shape = new T.Shape();
      points.forEach(([x, y], i) =>
        i ? shape.lineTo(x, -y) : shape.moveTo(x, -y),
      );
      shape.closePath();
      const geometry = new T.ExtrudeGeometry(shape, {
        depth: 0.35,
        bevelEnabled: true,
        bevelThickness: 0.08,
        bevelSize: 0.06,
        bevelSegments: 1,
        steps: 1,
      });
      geometry.translate(0, 0, -0.175);
      this.geometries.set(name, geometry);
    }
    group(name) {
      if (!this.groups.has(name)) {
        const group = new T.Group();
        group.name = name;
        this.groups.set(name, group);
        this.scene.add(group);
      }
      return this.groups.get(name);
    }
    begin(background) {
      if (background) this.scene.background.set(background);
      for (const batch of this.batches.values()) batch.used = 0;
    }
    item(
      group,
      shape,
      x,
      y,
      z,
      sx,
      sy,
      sz,
      color,
      rx = 0,
      ry = 0,
      rz = 0,
      style = "solid",
    ) {
      const key = `${group}/${shape}/${style}`;
      let batch = this.batches.get(key);
      if (!batch) {
        const material =
          style === "glow"
            ? this.glow
            : style === "wire"
              ? this.wire
              : this.material;
        const mesh = new T.InstancedMesh(
          this.geometries.get(shape),
          material,
          32,
        );
        mesh.name = key;
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        this.group(group).add(mesh);
        batch = { mesh, used: 0, capacity: 32 };
        this.batches.set(key, batch);
      }
      if (batch.used === batch.capacity) {
        const old = batch.mesh,
          mesh = new T.InstancedMesh(
            old.geometry,
            old.material,
            batch.capacity * 2,
          );
        mesh.name = key;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        mesh.instanceMatrix.array.set(old.instanceMatrix.array);
        if (old.instanceColor) {
          mesh.setColorAt(0, this.color);
          mesh.instanceColor.array.set(old.instanceColor.array);
        }
        old.parent.add(mesh);
        old.parent.remove(old);
        old.dispose();
        batch.mesh = mesh;
        batch.capacity *= 2;
      }
      const object = this.scratch;
      object.position.set(x, y, z);
      object.scale.set(
        Math.max(0.00001, sx),
        Math.max(0.00001, sy),
        Math.max(0.00001, sz),
      );
      object.rotation.set(rx, ry, rz);
      object.updateMatrix();
      batch.mesh.setMatrixAt(batch.used, object.matrix);
      batch.mesh.setColorAt(batch.used, this.color.set(color));
      batch.used++;
      return batch.mesh;
    }
    flat(group, shape, x, y, z, sx, sy, sz, color, angle = 0, style = "solid") {
      return this.item(
        group,
        shape,
        x,
        -y,
        z,
        sx,
        sy,
        sz,
        color,
        0,
        0,
        -angle,
        style,
      );
    }
    line(group, x1, y1, x2, y2, z, color, width = 1) {
      this.flat(
        group,
        "box",
        (x1 + x2) / 2,
        (y1 + y2) / 2,
        z,
        Math.hypot(x2 - x1, y2 - y1),
        width,
        width,
        color,
        Math.atan2(y2 - y1, x2 - x1),
        "glow",
      );
    }
    ring(group, x, y, z, r, color) {
      this.flat(group, "ring", x, y, z, r, r, 1, color, 0, "glow");
    }
    health(x, y, z, width, ratio, color) {
      this.flat("indicators", "box", x, y, z, width, 3, 1, "#10191b");
      const w = width * Math.max(0, Math.min(1, ratio));
      this.flat(
        "indicators",
        "box",
        x - width / 2 + w / 2,
        y,
        z + 1,
        w,
        2,
        1,
        color,
        0,
        "glow",
      );
    }
    effects(effects, tick) {
      for (const e of effects) {
        const age = tick - e.startTick,
          life = 1 - age / e.duration;
        if (life <= 0 || age < 0) continue;
        const r = (e.major ? 65 : 24) * (1 - life) + 3;
        this.ring("effects", e.x, e.y, 25, r, "#d89459");
        if (!this.reducedMotion)
          for (let i = 0; i < 10; i++) {
            const a = i * 2.399 + ((e.seed || 0) % 17),
              d = r * (0.5 + i / 10);
            this.flat(
              "effects",
              "diamond",
              e.x + Math.cos(a) * d,
              e.y + Math.sin(a) * d,
              20 + i * 2,
              2 * life,
              2 * life,
              4 * life,
              i % 2 ? "#bbc8c1" : "#db7649",
              a,
            );
          }
      }
    }
    text(value) {
      if (!this.lost && this.hud.textContent !== value)
        this.hud.textContent = value;
    }
    resize() {
      if (this.disposed) return;
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width || this.width)),
        h = Math.max(1, Math.round(rect.height || this.height));
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      if (this.cssWidth !== w || this.cssHeight !== h || this.dpr !== dpr) {
        this.cssWidth = w;
        this.cssHeight = h;
        this.dpr = dpr;
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(w, h, false);
        if (this.camera.isPerspectiveCamera) {
          this.camera.aspect = w / h;
          this.camera.updateProjectionMatrix();
        }
      }
    }
    oblique(x, y) {
      // Cabinet projection: z=0 retains exact simulation/input coordinates.
      // Only raised geometry shifts, revealing thickness in the retro playfields.
      this.skew = { x, y };
      this.projectCamera();
    }
    projectCamera() {
      this.camera.updateProjectionMatrix();
      if (this.skew && this.camera.isOrthographicCamera) {
        const x = (2 * this.skew.x) / (this.camera.right - this.camera.left);
        const y = (2 * this.skew.y) / (this.camera.top - this.camera.bottom);
        const m = this.camera.projectionMatrix.elements;
        m[8] += x;
        m[9] += y;
        m[12] += x * this.camera.position.z;
        m[13] += y * this.camera.position.z;
        this.camera.projectionMatrixInverse
          .copy(this.camera.projectionMatrix)
          .invert();
      }
    }
    view(width, height, x = 0, y = 0) {
      this.width = width;
      this.height = height;
      Object.assign(this.camera, {
        left: x,
        right: x + width,
        top: -y,
        bottom: -y - height,
      });
      this.projectCamera();
    }
    finish() {
      if (this.disposed || this.lost) return;
      for (const b of this.batches.values()) {
        b.mesh.count = b.used;
        b.mesh.instanceMatrix.needsUpdate = true;
        if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      }
      this.resize();
      this.renderer.render(this.scene, this.camera);
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.media.removeEventListener("change", this.onMotion);
      root.removeEventListener("pagehide", this.onPageHide);
      this.canvas.removeEventListener("webglcontextlost", this.onLost);
      this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
      for (const b of this.batches.values()) b.mesh.dispose();
      for (const g of this.geometries.values()) g.dispose();
      this.material.dispose();
      this.glow.dispose();
      this.wire.dispose();
      this.scene.traverse((o) => {
        if (o.userData.ownedGeometry) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
      this.renderer.dispose();
      this.hud.remove();
      this.ownedNodes.forEach((node) => node.remove());
    }
  }
  root.QsolNative = { Stage };
})(window);
