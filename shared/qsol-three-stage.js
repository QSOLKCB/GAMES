(function installQsolThree(root) {
  "use strict";

  const PRESETS = Object.freeze({
    blackstar: Object.freeze({ ink: 0xd69a58, signal: 0x84b8aa, danger: 0xb7503d, stars: 150, speed: 0.75, opacity: 0.42 }),
    cartridge: Object.freeze({ ink: 0xd8b66e, signal: 0x668f88, danger: 0xb95f43, stars: 90, speed: 0.28, opacity: 0.34 }),
    warfront: Object.freeze({ ink: 0xd0b36d, signal: 0x6f9b8c, danger: 0xc45d40, stars: 75, speed: 0.18, opacity: 0.38 }),
    seedstorm: Object.freeze({ ink: 0xe1b868, signal: 0x6c9890, danger: 0xd15d42, stars: 210, speed: 1.35, opacity: 0.5 }),
    inertia: Object.freeze({ ink: 0xcab77e, signal: 0x72aaa0, danger: 0xc96348, stars: 260, speed: 0.62, opacity: 0.4 }),
    vector: Object.freeze({ ink: 0xcdb777, signal: 0x6b9d93, danger: 0xd06045, stars: 230, speed: 1.05, opacity: 0.48 }),
    ternary: Object.freeze({ ink: 0xd5b56c, signal: 0x6ca294, danger: 0xcb5c43, stars: 360, speed: 0.7, opacity: 0.56 }),
  });

  const NOOP = Object.freeze({
    supported: false,
    render() {},
    pulse() {},
    dispose() {},
  });

  function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, low, high) {
    return value < low ? low : value > high ? high : value;
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function makeRng(seedText) {
    let state = hashText(seedText) || 0x9e3779b9;
    return function random() {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  function createStars(THREE, config, random) {
    const positions = new Float32Array(config.stars * 3);
    const origins = new Float32Array(config.stars * 3);
    for (let index = 0; index < config.stars; index += 1) {
      const offset = index * 3;
      const radius = 3 + random() * 13;
      const angle = random() * Math.PI * 2;
      positions[offset] = Math.cos(angle) * radius * (0.5 + random());
      positions[offset + 1] = Math.sin(angle) * radius * (0.35 + random() * 0.7);
      positions[offset + 2] = -2 - random() * 22;
      origins.set(positions.subarray(offset, offset + 3), offset);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: config.signal,
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return { points, positions, origins, geometry, material };
  }

  function decodeBase64(text) {
    const binary = root.atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function applyGalaxySample(stars, config, preset, layer) {
    if (!root.GALAXY_WASM_BASE64 || !root.WebAssembly || !root.atob) return;
    try {
      const result = await root.WebAssembly.instantiate(decodeBase64(root.GALAXY_WASM_BASE64), {});
      const wasm = result.instance.exports;
      if (!wasm.generate || wasm.abi_version() < 2 || wasm.generate(65536, config.stars, hashText(`QSOL-${preset}`)) !== config.stars) return;
      const sample = new Float32Array(wasm.memory.buffer, wasm.buffer_ptr(), wasm.buffer_len());
      for (let index = 0; index < config.stars; index += 1) {
        const target = index * 3;
        const source = index * 8;
        const radius = 3 + sample[source] * 13;
        const angle = sample[source + 1] * Math.PI * 2;
        stars.positions[target] = Math.cos(angle) * radius * (0.5 + sample[source + 2]);
        stars.positions[target + 1] = Math.sin(angle) * radius * (0.35 + sample[source + 3] * 0.7);
        stars.positions[target + 2] = -2 - sample[source + 4] * 22;
      }
      stars.origins.set(stars.positions);
      stars.geometry.attributes.position.needsUpdate = true;
      layer.dataset.sampler = "galaxy-rust-wasm";
    } catch (_error) {
      layer.dataset.sampler = "javascript-fallback";
    }
  }

  function wireMaterial(THREE, color, opacity) {
    return new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  function lineMaterial(THREE, color, opacity) {
    return new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  function addRing(THREE, group, material, radius, z, tilt) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.018, 4, 64), material.clone());
    mesh.position.z = z;
    mesh.rotation.x = tilt || 0;
    group.add(mesh);
    return mesh;
  }

  function addWireMesh(THREE, group, geometry, material, x, y, z, scale) {
    const mesh = new THREE.Mesh(geometry, material.clone());
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(scale || 1);
    group.add(mesh);
    return mesh;
  }

  function buildMotif(THREE, preset, config) {
    const group = new THREE.Group();
    const primary = wireMaterial(THREE, config.ink, 0.26);
    const signal = wireMaterial(THREE, config.signal, 0.22);
    const meshes = [];

    if (preset === "blackstar") {
      for (let index = 0; index < 6; index += 1) {
        const mesh = addWireMesh(THREE, group, new THREE.BoxGeometry(7.8, 4.5, 2.6), index & 1 ? signal : primary, 0, 0.1, -3.5 - index * 3.6, 1);
        meshes.push(mesh);
      }
    } else if (preset === "cartridge") {
      const shapes = [
        new THREE.TetrahedronGeometry(0.8), new THREE.OctahedronGeometry(0.72), new THREE.IcosahedronGeometry(0.67),
        new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.ConeGeometry(0.72, 1.3, 5), new THREE.TorusGeometry(0.62, 0.16, 5, 16),
        new THREE.CylinderGeometry(0.55, 0.75, 1.1, 6),
      ];
      shapes.forEach((shape, index) => {
        const angle = index / shapes.length * Math.PI * 2;
        meshes.push(addWireMesh(THREE, group, shape, index & 1 ? signal : primary, Math.cos(angle) * 4.1, Math.sin(angle) * 2.2, -2 - (index % 3), 1));
      });
      meshes.push(addRing(THREE, group, primary, 3.1, -4.5, 0.55));
    } else if (preset === "warfront") {
      const grid = new THREE.GridHelper(18, 18, config.ink, config.signal);
      grid.rotation.x = Math.PI / 2;
      grid.position.set(0, -0.8, -7);
      grid.material.transparent = true;
      grid.material.opacity = 0.17;
      grid.material.depthWrite = false;
      group.add(grid);
      for (let index = 0; index < 8; index += 1) {
        const x = (index % 4 - 1.5) * 2.2;
        const y = (Math.floor(index / 4) - 0.5) * 2.4;
        meshes.push(addWireMesh(THREE, group, new THREE.CylinderGeometry(0.34, 0.56, 1.2, 6), index % 3 ? signal : primary, x, y, -4.5, 1));
      }
    } else if (preset === "seedstorm") {
      for (let index = 0; index < 9; index += 1) meshes.push(addRing(THREE, group, index % 3 ? signal : primary, 2.2 + index * 0.65, -5 - index * 2.2, index * 0.11));
      meshes.push(addWireMesh(THREE, group, new THREE.ConeGeometry(0.75, 2, 5), primary, 0, -2.3, -2.8, 1));
    } else if (preset === "inertia") {
      meshes.push(addWireMesh(THREE, group, new THREE.TorusKnotGeometry(2.8, 0.12, 96, 8, 2, 3), signal, 3.8, -1.6, -7, 1));
      meshes.push(addWireMesh(THREE, group, new THREE.IcosahedronGeometry(1.4, 1), primary, -4.2, 2.1, -5, 1));
      meshes.push(addRing(THREE, group, primary, 5.8, -10, 0.9));
    } else if (preset === "vector") {
      for (let index = 0; index < 11; index += 1) meshes.push(addRing(THREE, group, index % 2 ? signal : primary, 2.5 + index * 0.42, -3 - index * 2.15, index * 0.16));
      meshes.push(addWireMesh(THREE, group, new THREE.IcosahedronGeometry(1.1, 1), primary, 0, 0, -5, 1));
    } else {
      meshes.push(addRing(THREE, group, primary, 5.2, -9, 0.95));
      meshes.push(addRing(THREE, group, signal, 3.6, -6, -0.6));
      meshes.push(addWireMesh(THREE, group, new THREE.OctahedronGeometry(1.35, 1), signal, -3.7, 1.8, -5.5, 1));
      meshes.push(addWireMesh(THREE, group, new THREE.TorusKnotGeometry(1.4, 0.12, 64, 6, 2, 3), primary, 4.2, -1.8, -7, 1));
    }

    primary.dispose();
    signal.dispose();
    return { group, meshes };
  }

  function createBurst(THREE, config, random) {
    const count = 48;
    const positions = new Float32Array(count * 3);
    const vectors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      const angle = random() * Math.PI * 2;
      const elevation = (random() - 0.5) * 1.5;
      const speed = 0.5 + random() * 1.5;
      vectors[offset] = Math.cos(angle) * speed;
      vectors[offset + 1] = Math.sin(angle) * speed;
      vectors[offset + 2] = elevation * speed;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: config.danger,
      size: 0.075,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.position.z = -1;
    return { points, positions, vectors, geometry, material };
  }

  function create(options) {
    const THREE = root.THREE;
    const host = options && options.host;
    const source = options && options.source;
    const preset = options && PRESETS[options.preset] ? options.preset : "ternary";
    if (!THREE || !host || !source || !root.document) return NOOP;
    // Headless automation is normally backed by a software renderer. Keep the
    // deterministic Canvas simulation authoritative instead of spending its
    // frame budget compiling a decorative WebGL scene.
    if (root.navigator && root.navigator.webdriver) return NOOP;

    const layer = root.document.createElement("canvas");
    layer.className = "qsol-three-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.tabIndex = -1;
    const attributes = { alpha: true, antialias: false, depth: true, stencil: false, premultipliedAlpha: true };
    const context = layer.getContext("webgl2", attributes) || layer.getContext("webgl", attributes);
    if (!context) return NOOP;
    // SwiftShader/llvmpipe can make a decorative layer starve the authoritative
    // fixed-step Canvas simulation. Prefer the existing 2D game on software GL.
    const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
    const rendererName = debugInfo ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "") : "";
    if (/swiftshader|llvmpipe|software raster/i.test(rendererName)) return NOOP;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: layer, context, alpha: true, antialias: false, powerPreference: "high-performance" });
    } catch (_error) {
      return NOOP;
    }

    const config = PRESETS[preset];
    const random = makeRng(`QSOL-THREE-${preset}`);
    host.classList.add("qsol-three-host");
    layer.style.setProperty("--qsol-three-opacity", String(config.opacity));
    source.insertAdjacentElement("afterend", layer);

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(1, root.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 80);
    camera.position.z = 8;
    const stars = createStars(THREE, config, random);
    scene.add(stars.points);
    applyGalaxySample(stars, config, preset, layer);
    const motif = buildMotif(THREE, preset, config);
    scene.add(motif.group);
    const burst = createBurst(THREE, config, random);
    scene.add(burst.points);

    let width = 0;
    let height = 0;
    let pulse = 0;
    let burstAge = 2;
    let disposed = false;
    let lastTime = root.performance && root.performance.now ? root.performance.now() : 0;

    function resize() {
      const bounds = host.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(bounds.width));
      const nextHeight = Math.max(1, Math.round(bounds.height));
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    function render(telemetry) {
      if (disposed) return;
      resize();
      const now = root.performance && root.performance.now ? root.performance.now() : lastTime + 16.67;
      const delta = clamp((now - lastTime) / 1000, 0, 0.08);
      lastTime = now;
      const data = telemetry || {};
      const tick = finite(data.tick, 0);
      const speed = clamp(Math.abs(finite(data.speed, 0)), 0, 4);
      const danger = clamp(finite(data.danger, 0), 0, 1);
      const activity = clamp(finite(data.activity, 0), 0, 1);
      const heading = finite(data.heading, 0);
      const travel = delta * config.speed * (1 + speed * 1.7 + activity * 0.8);
      const positions = stars.positions;
      for (let index = 0; index < positions.length; index += 3) {
        positions[index + 2] += travel;
        if (positions[index + 2] > 3) positions[index + 2] = -24;
      }
      stars.geometry.attributes.position.needsUpdate = true;
      stars.material.opacity = 0.38 + activity * 0.26 + danger * 0.18;
      stars.material.size = 0.045 + speed * 0.018;

      const visualTime = now * 0.001;
      motif.group.rotation.z = heading * 0.08 + Math.sin(visualTime * 0.19) * 0.035;
      motif.group.rotation.x = Math.sin(visualTime * 0.13 + tick * 0.0007) * 0.045;
      motif.meshes.forEach((mesh, index) => {
        mesh.rotation.x += delta * (0.035 + (index % 3) * 0.012);
        mesh.rotation.y += delta * (0.045 + (index % 4) * 0.013);
        if (mesh.material && "opacity" in mesh.material) mesh.material.opacity = 0.13 + activity * 0.12 + danger * (index % 2 ? 0.08 : 0.16);
      });

      pulse = Math.max(0, pulse - delta * 2.4);
      burstAge += delta;
      if (burstAge < 1) {
        for (let index = 0; index < burst.positions.length; index += 3) {
          const distance = burstAge * 2.7;
          burst.positions[index] = burst.vectors[index] * distance;
          burst.positions[index + 1] = burst.vectors[index + 1] * distance;
          burst.positions[index + 2] = burst.vectors[index + 2] * distance;
        }
        burst.geometry.attributes.position.needsUpdate = true;
        burst.material.opacity = (1 - burstAge) * 0.9;
      } else burst.material.opacity = 0;

      camera.position.x = Math.sin(visualTime * 0.31) * 0.08 + Math.sin(tick * 0.17) * pulse * 0.06;
      camera.position.y = Math.cos(visualTime * 0.27) * 0.06 + Math.cos(tick * 0.13) * pulse * 0.05;
      camera.position.z = 8 - pulse * 0.2;
      layer.style.setProperty("--qsol-three-opacity", String(config.opacity * (0.72 + activity * 0.23 + danger * 0.16)));
      renderer.render(scene, camera);
    }

    function trigger(kind, strength) {
      const value = clamp(finite(strength, 0.65), 0, 1);
      pulse = Math.max(pulse, value);
      if (kind === "impact" || kind === "blast" || kind === "jump") burstAge = 0;
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      stars.geometry.dispose();
      stars.material.dispose();
      burst.geometry.dispose();
      burst.material.dispose();
      motif.group.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material && object.material.dispose) object.material.dispose();
      });
      renderer.dispose();
      layer.remove();
      host.classList.remove("qsol-three-host");
    }

    return Object.freeze({ supported: true, render, pulse: trigger, dispose });
  }

  root.QsolThree = Object.freeze({ version: "1.0.0", presets: Object.keys(PRESETS), create });
})(typeof window !== "undefined" ? window : globalThis);
