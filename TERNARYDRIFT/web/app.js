(function runTernaryDriftWeb() {
  "use strict";
  const core = window.TernaryDriftWebCore;
  const THREE = window.THREE;
  const canvas = document.querySelector("#game");
  const viewport = document.querySelector("#viewport");
  const bootLayer = document.querySelector("#bootLayer");
  const dockLayer = document.querySelector("#dockLayer");
  const seedInput = document.querySelector("#seedInput");
  const startButton = document.querySelector("#startButton");
  const restartButton = document.querySelector("#restartButton");
  const audioButton = document.querySelector("#audioButton");
  const fullscreenButton = document.querySelector("#fullscreenButton");
  const toast = document.querySelector("#toast");
  const reads = Object.fromEntries([
    "runtime", "system", "credits", "cargo", "score", "digest", "hull", "shield", "energy",
    "assist", "mission", "dockFaction", "dockTitle",
  ].map((name) => [name, document.querySelector(`#${name}Readout`) || document.querySelector(`#${name}`)]));
  const meters = {
    hull: document.querySelector("#hullMeter"), shield: document.querySelector("#shieldMeter"), energy: document.querySelector("#energyMeter"),
  };
  const marketRows = document.querySelector("#marketRows");
  const qutrits = document.querySelector("#qutrits");
  const STEP = 1 / core.TICK_HZ;
  let state = null;
  let held = 0;
  let tapped = 0;
  let lastTime = performance.now();
  let accumulator = 0;
  let toastTicks = 0;
  let audio = null;
  let lastMarketSnapshot = null;

  function makeShip(color, scale) {
    const group = new THREE.Group();
    const shape = new THREE.BufferGeometry();
    shape.setAttribute("position", new THREE.Float32BufferAttribute([
      17, 1, 0, -11, 1, -10, -5, 1, 0,
      17, 1, 0, -5, 1, 0, -11, 1, 10,
      -4, 1, -4, -15, 1, 0, -4, 1, 4,
    ], 3));
    shape.computeVertexNormals();
    group.add(new THREE.Mesh(shape, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .3, roughness: .55, metalness: .35, side: THREE.DoubleSide })));
    const engine = new THREE.Mesh(new THREE.ConeGeometry(4.5, 15, 5), new THREE.MeshBasicMaterial({ color: 0x62e9dd, transparent: true, opacity: .74 }));
    engine.rotation.z = Math.PI / 2; engine.position.x = -17; engine.name = "engine"; group.add(engine);
    group.scale.setScalar(scale);
    return group;
  }

  function createRenderer() {
    if (!THREE) return null;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010305);
    scene.fog = new THREE.FogExp2(0x010305, .00145);
    const camera = new THREE.PerspectiveCamera(48, 16 / 9, 1, 2200);
    camera.position.set(0, 325, 250);
    scene.add(new THREE.HemisphereLight(0x82e9df, 0x071013, 1.75));
    const key = new THREE.DirectionalLight(0xf0b563, 2.1); key.position.set(-100, 220, 80); scene.add(key);
    const grid = new THREE.GridHelper(2200, 44, 0x15535a, 0x0b252b); grid.position.y = -4; scene.add(grid);

    const starsGeometry = new THREE.BufferGeometry();
    const stars = [];
    let random = 0x7419ab3d;
    for (let index = 0; index < 720; index += 1) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      const x = ((random >>> 0) / 4294967296 - .5) * 2600;
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      const z = ((random >>> 0) / 4294967296 - .5) * 2200;
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      stars.push(x, -9 - ((random >>> 0) % 20), z);
    }
    starsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(stars, 3));
    scene.add(new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0x4d8e91, size: 2.2, sizeAttenuation: true, transparent: true, opacity: .58 })));

    const station = new THREE.Group();
    const stationRing = new THREE.Mesh(new THREE.TorusGeometry(32, 5, 8, 28), new THREE.MeshStandardMaterial({ color: 0x599a91, emissive: 0x164844, emissiveIntensity: .7, metalness: .65, roughness: .4 }));
    stationRing.rotation.x = Math.PI / 2; station.add(stationRing);
    const stationCore = new THREE.Mesh(new THREE.OctahedronGeometry(14, 0), new THREE.MeshStandardMaterial({ color: 0xf0b563, emissive: 0x6b3d13, emissiveIntensity: .55 }));
    station.add(stationCore); scene.add(station);
    const gate = new THREE.Group();
    const gateRing = new THREE.Mesh(new THREE.TorusGeometry(36, 3.2, 7, 34), new THREE.MeshBasicMaterial({ color: 0x6f78f5, transparent: true, opacity: .9 }));
    gateRing.rotation.x = Math.PI / 2; gate.add(gateRing);
    const gateInner = new THREE.Mesh(new THREE.RingGeometry(7, 31, 38), new THREE.MeshBasicMaterial({ color: 0x293077, side: THREE.DoubleSide, transparent: true, opacity: .28 }));
    gateInner.rotation.x = -Math.PI / 2; gate.add(gateInner); scene.add(gate);
    const player = makeShip(0x62e9dd, 1); scene.add(player);
    return { renderer, scene, camera, station, stationCore, gate, gateRing, player, enemies: new Map(), shots: new Map(), salvage: new Map() };
  }

  const view = createRenderer();

  function resize() {
    if (!view) return;
    const rect = viewport.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(240, Math.floor(rect.height));
    if (view.width === width && view.height === height) return;
    view.width = width; view.height = height;
    view.renderer.setSize(width, height, false);
    view.camera.aspect = width / height;
    view.camera.updateProjectionMatrix();
  }

  function worldPosition(object, source, elevation) {
    object.position.set(source.x / core.FP, elevation || 0, source.y / core.FP);
  }

  function syncCollection(map, items, create, update) {
    const active = new Set();
    for (const item of items) {
      active.add(item.id);
      let object = map.get(item.id);
      if (!object) { object = create(item); map.set(item.id, object); view.scene.add(object); }
      update(object, item);
    }
    for (const [id, object] of map) {
      if (active.has(id)) continue;
      view.scene.remove(object); map.delete(id);
    }
  }

  function renderWorld(time) {
    if (!view) return;
    resize();
    if (!state) {
      view.station.rotation.y = time * .0002; view.gateRing.rotation.z = time * .0004;
      view.renderer.render(view.scene, view.camera); return;
    }
    const player = state.player;
    const system = state.systems[player.system];
    worldPosition(view.player, player, 2);
    view.player.rotation.y = -player.heading * Math.PI * 2 / 32;
    const engine = view.player.getObjectByName("engine");
    if (engine) engine.scale.y = 1 + Math.min(2.2, Math.hypot(player.vx, player.vy) / 1200) + Math.sin(time * .016) * .12;
    view.player.visible = !player.docked;
    worldPosition(view.station, system.station, 2); view.station.rotation.y = time * .00038; view.stationCore.rotation.y = -time * .00055;
    worldPosition(view.gate, system.gate, 1); view.gate.rotation.y = Math.sin(time * .00035) * .18; view.gateRing.rotation.z = time * .00052;
    syncCollection(view.enemies, state.enemies,
      (enemy) => makeShip(enemy.kind === "corsair" ? 0xf06a58 : enemy.kind === "raider" ? 0xf0b563 : 0xd45a79, enemy.kind === "corsair" ? 1.22 : .92),
      (object, enemy) => { worldPosition(object, enemy, 3); object.rotation.y = -enemy.heading * Math.PI * 2 / 32; object.children[0].material.emissiveIntensity = .3 + .18 * Math.sin((time + enemy.phase) * .008); });
    syncCollection(view.shots, state.projectiles,
      (shot) => new THREE.Mesh(new THREE.SphereGeometry(shot.hostile ? 3.6 : 2.8, 6, 5), new THREE.MeshBasicMaterial({ color: shot.hostile ? 0xf06a58 : 0x9afff4 })),
      (object, shot) => worldPosition(object, shot, 4));
    syncCollection(view.salvage, state.salvage,
      () => new THREE.Mesh(new THREE.OctahedronGeometry(7, 0), new THREE.MeshStandardMaterial({ color: 0xf0b563, emissive: 0x71440f, emissiveIntensity: .8 })),
      (object, item) => { worldPosition(object, item, 4 + Math.sin((time + item.id * 71) * .003) * 2); object.rotation.y = time * .001 + item.id; });
    const px = player.x / core.FP; const pz = player.y / core.FP;
    view.camera.position.x += (px - view.camera.position.x) * .075;
    view.camera.position.z += (pz + 260 - view.camera.position.z) * .075;
    view.camera.lookAt(px, 0, pz - 22);
    view.renderer.render(view.scene, view.camera);
  }

  function makeAudio() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    const context = new Context();
    const master = context.createGain(); master.gain.value = 0; master.connect(context.destination);
    const noiseBuffer = context.createBuffer(1, context.sampleRate * .35, context.sampleRate);
    let random = 0x594d31;
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; data[i] = ((random >>> 0) / 2147483648 - 1) * (1 - i / data.length); }
    function tone(frequency, duration, wave, volume, slide) {
      const now = context.currentTime; const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.type = wave || "square"; oscillator.frequency.setValueAtTime(frequency, now);
      if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, slide), now + duration);
      gain.gain.setValueAtTime(volume || .12, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      oscillator.connect(gain); gain.connect(master); oscillator.start(now); oscillator.stop(now + duration);
    }
    function noise(duration, volume) {
      const source = context.createBufferSource(); const gain = context.createGain(); const filter = context.createBiquadFilter(); const now = context.currentTime;
      source.buffer = noiseBuffer; filter.type = "bandpass"; filter.frequency.value = 620; gain.gain.setValueAtTime(volume || .08, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      source.connect(filter); filter.connect(gain); gain.connect(master); source.start(); source.stop(now + duration);
    }
    return { context, tone, noise, master };
  }

  function soundFor(event) {
    if (!audio) return;
    if (event.type === core.EVENTS.SHOT) audio.tone(event.owner === "player" ? 220 : 105, .1, "square", .09, event.owner === "player" ? 90 : 58);
    else if (event.type === core.EVENTS.HIT) { audio.noise(.16, .12); audio.tone(event.target === "player" ? 60 : 105, .14, "sawtooth", .08, 38); }
    else if (event.type === core.EVENTS.ENEMY_DESTROYED || event.type === core.EVENTS.PLAYER_DESTROYED) { audio.noise(.3, .2); audio.tone(80, .32, "sawtooth", .13, 25); }
    else if (event.type === core.EVENTS.JUMPED) audio.tone(90, .65, "sine", .13, 760);
    else if (event.type === core.EVENTS.TRADE || event.type === core.EVENTS.MISSION_ACCEPTED || event.type === core.EVENTS.UPGRADED) audio.tone(440, .12, "triangle", .08, 700);
    else if (event.type === core.EVENTS.DOCKED) audio.tone(260, .28, "sine", .09, 130);
  }

  function eventMessage(event) {
    const commodity = event.commodity == null ? "" : core.COMMODITIES[event.commodity];
    if (event.type === core.EVENTS.TRADE) return `${event.side.toUpperCase()} ${commodity} / ${event.price} CR`;
    return {
      [core.EVENTS.DOCKED]: "STATION LINK ESTABLISHED", [core.EVENTS.LAUNCHED]: "LAUNCH CLEAR",
      [core.EVENTS.NO_CREDITS]: "TRANSACTION DENIED", [core.EVENTS.CARGO_FULL]: "CARGO HOLD FULL",
      [core.EVENTS.MISSION_ACCEPTED]: "DELIVERY CONTRACT ACCEPTED", [core.EVENTS.MISSION_COMPLETED]: `CONTRACT PAID / ${event.reward} CR`,
      [core.EVENTS.UPGRADED]: "SHIP SYSTEM UPGRADED", [core.EVENTS.REPAIRED]: `HULL RESTORED / ${event.cost} CR`,
      [core.EVENTS.SALVAGED]: `TRACTORED ${event.quantity} ${commodity}`, [core.EVENTS.JUMPED]: "TERNARY GATE TRANSIT",
      [core.EVENTS.ENEMY_DESTROYED]: "HOSTILE SIGNAL COLLAPSED", [core.EVENTS.PLAYER_DESTROYED]: "ESCAPE POD RECOVERED",
    }[event.type] || "";
  }

  function handleEvents() {
    for (const event of state.events) {
      soundFor(event);
      const message = eventMessage(event);
      if (message) { toast.textContent = message; toast.classList.add("show"); toastTicks = 120; }
    }
  }

  function renderMarket() {
    if (!state || !state.player.docked) return;
    const player = state.player;
    const system = state.systems[player.system];
    const market = system.market;
    const prices = core.COMMODITIES.map((_, index) => core.marketPrice(state, player.system, index, true));
    // The dock is a live region. Keep its DOM stable between visible changes,
    // including production and reputation-driven prices that change without input.
    const snapshot = JSON.stringify([player.system, system.name, market.faction,
      state.selectedCommodity, market.inventory, prices, player.cargo]);
    if (snapshot === lastMarketSnapshot) return;
    lastMarketSnapshot = snapshot;
    const faction = core.FACTIONS[market.faction];
    const title = `DOCKED AT ${system.name}`;
    if (reads.dockFaction.textContent !== faction) reads.dockFaction.textContent = faction;
    if (reads.dockTitle.textContent !== title) reads.dockTitle.textContent = title;
    marketRows.textContent = "";
    core.COMMODITIES.forEach((name, index) => {
      const row = document.createElement("div"); row.className = `market-row${index === state.selectedCommodity ? " selected" : ""}`;
      row.innerHTML = `<span>${index === state.selectedCommodity ? "›" : ""}</span><strong>${name}</strong><span>${market.inventory[index]} stk</span><b>${prices[index]}</b><span>${player.cargo[index]} hold</span>`;
      marketRows.append(row);
    });
  }

  function renderHud() {
    if (!state) return;
    const player = state.player; const system = state.systems[player.system];
    reads.system.textContent = `${system.name} / ${core.FACTIONS[system.market.faction]}`;
    reads.credits.textContent = String(player.credits).padStart(4, "0");
    reads.cargo.textContent = `${core.cargoUsed(player)} / ${player.cargoCapacity}`;
    reads.score.textContent = String(state.score).padStart(6, "0");
    reads.digest.textContent = core.stateDigest(state);
    for (const name of ["hull", "shield", "energy"]) {
      reads[name].textContent = player[name];
      meters[name].style.width = `${player[name] / player[`${name}Max`] * 100}%`;
    }
    reads.assist.textContent = `FLIGHT ASSIST / ${player.engineKill ? "OFF" : "ON"}`;
    if (dockLayer.hidden !== !player.docked) dockLayer.hidden = !player.docked;
    if (player.docked) renderMarket();
    qutrits.textContent = "";
    for (const [key, value] of Object.entries(state.qutrits)) {
      const row = document.createElement("div"); row.className = "qutrit"; row.dataset.value = value;
      row.innerHTML = `<span>${key.toUpperCase()}</span><b>${["−", "0", "+"][value]}</b>`; qutrits.append(row);
    }
    if (state.mission) {
      const mission = state.mission;
      reads.mission.textContent = `Deliver ${mission.quantity} ${core.COMMODITIES[mission.commodity]} to ${state.systems[mission.destination].name}. Reward ${mission.reward} credits.`;
    } else reads.mission.textContent = "No contract. Dock and press M.";
  }

  function start() {
    state = core.createGame(seedInput.value);
    bootLayer.hidden = true; restartButton.disabled = false; held = 0; tapped = 0; accumulator = 0;
    reads.runtime.textContent = "OFFLINE / THREE.JS ACTIVE"; renderHud(); canvas.focus();
  }

  function tap(bit) { if (state) tapped |= bit; }
  const keys = {
    KeyW: core.INPUT.THRUST, KeyA: core.INPUT.STRAFE_LEFT, KeyD: core.INPUT.STRAFE_RIGHT,
    ArrowLeft: core.INPUT.TURN_LEFT, ArrowRight: core.INPUT.TURN_RIGHT, Space: core.INPUT.FIRE,
  };
  const dockKeys = {
    ArrowUp: core.INPUT.SELECT_PREV, ArrowDown: core.INPUT.SELECT_NEXT, KeyB: core.INPUT.BUY,
    KeyS: core.INPUT.SELL, KeyM: core.INPUT.MISSION, KeyU: core.INPUT.UPGRADE, KeyR: core.INPUT.REPAIR, KeyL: core.INPUT.LAUNCH,
  };
  const flightTapKeys = { KeyE: core.INPUT.INTERACT, KeyJ: core.INPUT.JUMP, KeyK: core.INPUT.ENGINE_KILL };
  window.addEventListener("keydown", (event) => {
    if (!state || event.repeat && (dockKeys[event.code] || flightTapKeys[event.code])) return;
    let bit = keys[event.code];
    if (event.code === "KeyS" && !state.player.docked) bit = core.INPUT.REVERSE;
    if (state.player.docked && dockKeys[event.code]) { tap(dockKeys[event.code]); event.preventDefault(); return; }
    if (!state.player.docked && flightTapKeys[event.code]) { tap(flightTapKeys[event.code]); event.preventDefault(); return; }
    if (bit) { held |= bit; event.preventDefault(); }
  });
  window.addEventListener("keyup", (event) => {
    let bit = keys[event.code]; if (event.code === "KeyS") bit = core.INPUT.REVERSE;
    if (bit) { held &= ~bit; event.preventDefault(); }
  });
  window.addEventListener("blur", () => { held = 0; });

  startButton.addEventListener("click", start);
  restartButton.addEventListener("click", () => { bootLayer.hidden = false; dockLayer.hidden = true; state = null; held = 0; tapped = 0; });
  audioButton.addEventListener("click", async () => {
    if (!audio) audio = makeAudio();
    if (!audio) { audioButton.textContent = "AUDIO UNAVAILABLE"; return; }
    await audio.context.resume();
    const enabled = audio.master.gain.value > 0;
    audio.master.gain.value = enabled ? 0 : .16;
    audioButton.textContent = enabled ? "AUDIO OFF" : "AUDIO ON"; audioButton.setAttribute("aria-pressed", String(!enabled));
  });
  fullscreenButton.addEventListener("click", () => { if (viewport.requestFullscreen) viewport.requestFullscreen(); });
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => tap(core.INPUT[button.dataset.action])));

  function frame(time) {
    const elapsed = Math.min(.1, (time - lastTime) / 1000); lastTime = time; accumulator += elapsed;
    if (state) {
      while (accumulator >= STEP) {
        core.step(state, held | tapped); tapped = 0; handleEvents(); accumulator -= STEP;
        if (toastTicks > 0) { toastTicks -= 1; if (!toastTicks) toast.classList.remove("show"); }
      }
      renderHud();
    }
    renderWorld(time); requestAnimationFrame(frame);
  }
  window.addEventListener("resize", resize); resize(); requestAnimationFrame(frame);
})();
