(function runSignalBreach() {
  "use strict";
  const core = window.SignalBreachCore;
  const THREE = window.THREE;
  const canvas = document.querySelector("#game");
  const shell = document.querySelector("#arenaShell");
  const bootLayer = document.querySelector("#bootLayer");
  const resultLayer = document.querySelector("#resultLayer");
  const seedInput = document.querySelector("#seedInput");
  const startButton = document.querySelector("#startButton");
  const againButton = document.querySelector("#againButton");
  const restartButton = document.querySelector("#restartButton");
  const audioButton = document.querySelector("#audioButton");
  const flash = document.querySelector("#eventFlash");
  const relayReadout = document.querySelector("#relayReadout");
  const ui = Object.fromEntries(["runtime", "health", "armor", "dash", "weapon", "score", "enemy", "digest", "objectiveTitle", "objectiveDetail", "resultKicker", "resultTitle", "resultBody"].map((name) => [name, document.querySelector(`#${name}Readout`) || document.querySelector(`#${name}`)]));
  const meters = { health: document.querySelector("#healthMeter"), armor: document.querySelector("#armorMeter"), dash: document.querySelector("#dashMeter"), heat: document.querySelector("#heatMeter") };
  const STEP = 1 / core.TICK_HZ;
  let state = null;
  let held = 0;
  let tapped = 0;
  let aim = 0;
  let lastTime = performance.now();
  let accumulator = 0;
  let flashTicks = 0;
  let gamepadLatch = 0;
  let audio = null;

  function createView() {
    if (!THREE) return null;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020406); scene.fog = new THREE.FogExp2(0x020406, .0017);
    const camera = new THREE.OrthographicCamera(-600, 600, 350, -350, 1, 1800); camera.position.set(0, 700, 0); camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0x9cebe0, 0x081012, 1.6));
    const key = new THREE.DirectionalLight(0xf0b65f, 2.7); key.position.set(-260, 540, 180); scene.add(key);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1050), new THREE.MeshStandardMaterial({ color: 0x071013, roughness: .88, metalness: .38 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -4; scene.add(floor);
    const grid = new THREE.GridHelper(1500, 50, 0x24454a, 0x10262a); grid.position.y = -2; scene.add(grid);
    const arenaGroup = new THREE.Group(); scene.add(arenaGroup);
    const dynamicGroup = new THREE.Group(); scene.add(dynamicGroup);
    const player = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(12, 17, 11, 8), new THREE.MeshStandardMaterial({ color: 0x7ffff0, emissive: 0x1a7068, emissiveIntensity: .8, roughness: .38, metalness: .55 })); player.add(body);
    const facing = new THREE.Mesh(new THREE.ConeGeometry(5, 19, 5), new THREE.MeshBasicMaterial({ color: 0xffffff })); facing.rotation.z = -Math.PI / 2; facing.position.x = 19; player.add(facing);
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(27, 4, 4), new THREE.MeshBasicMaterial({ color: 0xc8f06a })); weapon.position.x = 20; player.add(weapon);
    const ring = new THREE.Mesh(new THREE.RingGeometry(21, 24, 32), new THREE.MeshBasicMaterial({ color: 0x7ffff0, transparent: true, opacity: .72, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = -1; player.add(ring);
    dynamicGroup.add(player);
    const cursor = new THREE.Mesh(new THREE.RingGeometry(8, 10, 24), new THREE.MeshBasicMaterial({ color: 0xc8f06a, transparent: true, opacity: .75, side: THREE.DoubleSide })); cursor.rotation.x = -Math.PI / 2; cursor.position.y = 2; scene.add(cursor);
    return { renderer, scene, camera, arenaGroup, dynamicGroup, player, playerBody: body, cursor, enemies: new Map(), bullets: new Map(), relays: new Map(), extraction: null, viewHeight: 700 };
  }
  const view = createView();

  function resize() {
    if (!view) return;
    const rect = shell.getBoundingClientRect(); const width = Math.max(320, rect.width); const height = Math.max(400, rect.height);
    if (view.width === width && view.height === height) return;
    view.width = width; view.height = height;
    view.renderer.setSize(width, height, false); const aspect = width / height; const half = view.viewHeight / 2;
    view.camera.left = -half * aspect; view.camera.right = half * aspect; view.camera.top = half; view.camera.bottom = -half; view.camera.updateProjectionMatrix();
  }
  function place(object, body, elevation) { object.position.set(body.x / core.FP, elevation || 0, body.y / core.FP); }
  function clearGroup(group) { while (group.children.length) group.remove(group.children[group.children.length - 1]); }

  function buildArena() {
    clearGroup(view.arenaGroup); view.relays.clear();
    for (const block of state.arena.cover) {
      const material = new THREE.MeshStandardMaterial({ color: [0x17282b, 0x233035, 0x263028][block.variant], emissive: block.variant === 2 ? 0x111b0d : 0x071013, emissiveIntensity: .5, roughness: .62, metalness: .66 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(block.w, 24 + block.variant * 6, block.h), material); mesh.position.set(block.x, 9 + block.variant * 3, block.y); view.arenaGroup.add(mesh);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(Math.max(12, block.w - 12), 1, 3), new THREE.MeshBasicMaterial({ color: block.variant === 2 ? 0xc8f06a : 0x355c61 })); stripe.position.set(block.x, 23 + block.variant * 6, block.y - block.h / 2 + 5); view.arenaGroup.add(stripe);
    }
    for (const relay of state.arena.relays) {
      const group = new THREE.Group(); group.position.set(relay.x, 0, relay.y);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(30, 34, 9, 10), new THREE.MeshStandardMaterial({ color: 0x17282c, metalness: .7, roughness: .4 })); group.add(base);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(5, 8, 46, 8), new THREE.MeshStandardMaterial({ color: 0x7ffff0, emissive: 0x1f7169, emissiveIntensity: 1.15 })); tower.position.y = 24; group.add(tower);
      const capture = new THREE.Mesh(new THREE.RingGeometry(42, 46, 48), new THREE.MeshBasicMaterial({ color: 0xc8f06a, transparent: true, opacity: .5, side: THREE.DoubleSide })); capture.rotation.x = -Math.PI / 2; capture.position.y = 1; capture.name = "capture"; group.add(capture);
      const pulse = new THREE.Mesh(new THREE.TorusGeometry(12, 1.4, 5, 22), new THREE.MeshBasicMaterial({ color: 0x7ffff0 })); pulse.rotation.x = Math.PI / 2; pulse.position.y = 41; pulse.name = "pulse"; group.add(pulse);
      view.relays.set(relay.id, group); view.arenaGroup.add(group);
    }
    const exit = new THREE.Group(); exit.position.set(state.arena.extraction.x, 2, state.arena.extraction.y);
    const exitRing = new THREE.Mesh(new THREE.TorusGeometry(31, 4, 7, 36), new THREE.MeshBasicMaterial({ color: 0x52636a, transparent: true, opacity: .42 })); exitRing.rotation.x = Math.PI / 2; exitRing.name = "ring"; exit.add(exitRing);
    const exitCore = new THREE.Mesh(new THREE.CircleGeometry(26, 36), new THREE.MeshBasicMaterial({ color: 0x182125, transparent: true, opacity: .4, side: THREE.DoubleSide })); exitCore.rotation.x = -Math.PI / 2; exit.add(exitCore); view.extraction = exit; view.arenaGroup.add(exit);
  }

  function enemyMesh(enemy) {
    const group = new THREE.Group(); const color = enemy.kind === "bulwark" ? 0xff5e65 : enemy.kind === "lancer" ? 0xe879ff : 0xf0b65f;
    let body;
    if (enemy.kind === "bulwark") body = new THREE.Mesh(new THREE.BoxGeometry(33, 22, 33), new THREE.MeshStandardMaterial({ color, emissive: 0x5f1116, emissiveIntensity: .8, metalness: .7, roughness: .4 }));
    else if (enemy.kind === "lancer") body = new THREE.Mesh(new THREE.ConeGeometry(17, 29, 5), new THREE.MeshStandardMaterial({ color, emissive: 0x58155d, emissiveIntensity: .85, metalness: .4 }));
    else body = new THREE.Mesh(new THREE.OctahedronGeometry(17, 0), new THREE.MeshStandardMaterial({ color, emissive: 0x6b4512, emissiveIntensity: .72, metalness: .45 }));
    body.position.y = enemy.kind === "bulwark" ? 10 : 13; group.add(body);
    const ring = new THREE.Mesh(new THREE.RingGeometry(enemy.kind === "bulwark" ? 28 : 22, enemy.kind === "bulwark" ? 31 : 25, 28), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .75 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 1; group.add(ring);
    const health = new THREE.Mesh(new THREE.PlaneGeometry(35, 3), new THREE.MeshBasicMaterial({ color: 0x7a161b, side: THREE.DoubleSide })); health.rotation.x = -Math.PI / 2; health.position.set(0, 3, -28); health.name = "health"; group.add(health);
    return group;
  }

  function sync(map, items, create, update) {
    const active = new Set();
    for (const item of items) { active.add(item.id); let object = map.get(item.id); if (!object) { object = create(item); map.set(item.id, object); view.dynamicGroup.add(object); } update(object, item); }
    for (const [id, object] of map) if (!active.has(id)) { view.dynamicGroup.remove(object); map.delete(id); }
  }

  function renderWorld(time) {
    if (!view) return;
    resize();
    if (!state) { view.renderer.render(view.scene, view.camera); return; }
    const player = state.player; place(view.player, player, 8); view.player.rotation.y = -player.aim * Math.PI * 2 / 64;
    view.playerBody.material.emissiveIntensity = player.invulnerable ? 2.2 : .8;
    view.cursor.position.set(player.x / core.FP + core.DIRECTIONS[player.aim][0] / core.FP * 92, 2, player.y / core.FP + core.DIRECTIONS[player.aim][1] / core.FP * 92);
    view.cursor.rotation.z = time * .0015;
    sync(view.enemies, state.enemies, enemyMesh, (object, enemy) => {
      place(object, enemy, 0); object.rotation.y = -Math.atan2(state.player.y - enemy.y, state.player.x - enemy.x);
      const health = object.getObjectByName("health"); health.scale.x = Math.max(.03, enemy.health / enemy.maxHealth); health.position.x = -(1 - health.scale.x) * 17.5;
      object.children[1].material.opacity = .62 + Math.sin((time + enemy.phase * 33) * .006) * .18;
    });
    sync(view.bullets, state.bullets,
      (bullet) => { const group = new THREE.Group(); const glow = new THREE.Mesh(new THREE.SphereGeometry(bullet.lance ? 3.4 : 2.5, 6, 5), new THREE.MeshBasicMaterial({ color: bullet.color })); group.add(glow); const trail = new THREE.Mesh(new THREE.BoxGeometry(bullet.lance ? 24 : 12, 1.4, 2), new THREE.MeshBasicMaterial({ color: bullet.color, transparent: true, opacity: .65 })); trail.position.x = -8; group.add(trail); return group; },
      (object, bullet) => { place(object, bullet, 9); object.rotation.y = -Math.atan2(bullet.vy, bullet.vx); });
    for (const relay of state.arena.relays) {
      const object = view.relays.get(relay.id); if (!object) continue;
      const capture = object.getObjectByName("capture"); const pulse = object.getObjectByName("pulse");
      capture.material.color.setHex(relay.captured ? 0xc8f06a : 0x7ffff0); capture.material.opacity = relay.captured ? .82 : .28 + relay.progress / 400;
      pulse.scale.setScalar(1 + Math.sin(time * .004 + relay.id) * .12); pulse.material.color.setHex(relay.captured ? 0xc8f06a : 0x7ffff0); object.rotation.y = time * .0003 * relay.id;
    }
    if (view.extraction) { const ring = view.extraction.getObjectByName("ring"); ring.material.color.setHex(state.arena.extraction.open ? 0xc8f06a : 0x52636a); ring.material.opacity = state.arena.extraction.open ? .9 : .3; view.extraction.rotation.y = time * .001; }
    const px = player.x / core.FP; const py = player.y / core.FP;
    view.camera.position.x += (px - view.camera.position.x) * .09; view.camera.position.z += (py - view.camera.position.z) * .09; view.camera.lookAt(view.camera.position.x, 0, view.camera.position.z);
    view.renderer.render(view.scene, view.camera);
  }

  function makeAudio() {
    const Context = window.AudioContext || window.webkitAudioContext; if (!Context) return null;
    const context = new Context(); const master = context.createGain(); master.gain.value = 0; master.connect(context.destination);
    const noiseBuffer = context.createBuffer(1, context.sampleRate * .4, context.sampleRate); const data = noiseBuffer.getChannelData(0); let random = 0x71ca92;
    for (let i = 0; i < data.length; i += 1) { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; data[i] = ((random >>> 0) / 2147483648 - 1) * (1 - i / data.length); }
    function tone(frequency, duration, wave, gainValue, endFrequency) { const now = context.currentTime; const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = wave; oscillator.frequency.setValueAtTime(frequency, now); if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration); gain.gain.setValueAtTime(gainValue, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration); oscillator.connect(gain); gain.connect(master); oscillator.start(); oscillator.stop(now + duration); }
    function noise(duration, gainValue, frequency) { const now = context.currentTime; const source = context.createBufferSource(); const filter = context.createBiquadFilter(); const gain = context.createGain(); source.buffer = noiseBuffer; filter.type = "lowpass"; filter.frequency.value = frequency || 900; gain.gain.setValueAtTime(gainValue, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration); source.connect(filter); filter.connect(gain); gain.connect(master); source.start(); source.stop(now + duration); }
    return { context, master, tone, noise };
  }
  function sound(event) {
    if (!audio) return;
    if (event.type === core.EVENTS.SHOT) { const w = event.weapon; audio.tone(w === 2 ? 115 : w === 1 ? 78 : 170, w === 2 ? .22 : .09, w === 2 ? "sawtooth" : "square", .08, w === 2 ? 42 : 74); if (w === 1) audio.noise(.12, .08, 760); }
    else if (event.type === core.EVENTS.HIT) { audio.noise(.1, .1, event.target === "player" ? 350 : 1100); }
    else if (event.type === core.EVENTS.ENEMY_DOWN) { audio.noise(.25, .14, 500); audio.tone(90, .2, "sawtooth", .08, 34); }
    else if (event.type === core.EVENTS.DASH) audio.tone(130, .18, "triangle", .1, 720);
    else if (event.type === core.EVENTS.CAPTURE) { audio.tone(220, .45, "sine", .1, 880); audio.tone(330, .55, "triangle", .07, 990); }
    else if (event.type === core.EVENTS.VICTORY) audio.tone(180, .9, "sawtooth", .11, 900);
    else if (event.type === core.EVENTS.DEFEAT) audio.tone(100, .7, "sawtooth", .12, 28);
  }
  function handleEvents() {
    for (const event of state.events) {
      sound(event);
      if ([core.EVENTS.HIT, core.EVENTS.ENEMY_DOWN, core.EVENTS.DASH, core.EVENTS.CAPTURE].includes(event.type)) { flash.className = `event-flash show${event.target === "player" ? " danger" : ""}`; flashTicks = 8; }
      if (event.type === core.EVENTS.VICTORY || event.type === core.EVENTS.DEFEAT) showResult(event.type === core.EVENTS.VICTORY);
    }
  }
  function showResult(victory) {
    resultLayer.hidden = false; ui.resultKicker.textContent = victory ? "OPERATION COMPLETE" : "OPERATOR SIGNAL LOST";
    ui.resultTitle.textContent = victory ? "SIGNAL BROKEN" : "BREACH FAILED";
    ui.resultBody.textContent = `${victory ? "All relays secured and extraction confirmed." : "The response force held the yard."} Score ${state.score.toLocaleString("en-US")} · state ${core.stateDigest(state)}.`;
  }

  function renderHud() {
    if (!state) return; const p = state.player;
    for (const name of ["health", "armor", "dash"]) { ui[name].textContent = Math.round(p[name]); meters[name].style.width = `${p[name] / p[`max${name[0].toUpperCase()}${name.slice(1)}`] * 100}%`; }
    meters.heat.style.width = `${p.heat}%`; ui.weapon.textContent = core.WEAPONS[p.weapon].name; ui.score.textContent = String(state.score).padStart(6, "0"); ui.enemy.textContent = String(state.enemies.length).padStart(2, "0");
    if (state.tick % 15 === 0) ui.digest.textContent = core.stateDigest(state);
    relayReadout.textContent = "";
    for (const relay of state.arena.relays) { const row = document.createElement("div"); row.className = `relay${relay.captured ? " done" : ""}`; row.innerHTML = `<span>R${relay.id}</span><i><b style="width:${relay.captured ? 100 : relay.progress / 1.8}%"></b></i><strong>${relay.captured ? "OK" : Math.round(relay.progress / 1.8)}</strong>`; relayReadout.append(row); }
    const remaining = state.arena.relays.filter((relay) => !relay.captured).length;
    ui.objectiveTitle.textContent = remaining ? `CAPTURE ${remaining} RELAY${remaining === 1 ? "" : "S"}` : "EXTRACT EAST";
    ui.objectiveDetail.textContent = remaining ? "Hold each uplink when its perimeter is clear." : "Extraction aperture online at the east marker.";
  }

  function gamepadInput() {
    const pad = navigator.getGamepads ? Array.from(navigator.getGamepads()).find(Boolean) : null; if (!pad) return 0;
    let input = 0; const dead = .28;
    if (pad.axes[1] < -dead) input |= core.INPUT.UP; if (pad.axes[1] > dead) input |= core.INPUT.DOWN;
    if (pad.axes[0] < -dead) input |= core.INPUT.LEFT; if (pad.axes[0] > dead) input |= core.INPUT.RIGHT;
    const ax = pad.axes[2] || 0; const ay = pad.axes[3] || 0; if (Math.hypot(ax, ay) > dead) aim = (Math.round(Math.atan2(ay, ax) / (Math.PI * 2) * 64) + 64) & 63;
    if ((pad.buttons[7] && pad.buttons[7].pressed) || (pad.buttons[0] && pad.buttons[0].pressed)) input |= core.INPUT.FIRE;
    let buttons = 0; if (pad.buttons[1] && pad.buttons[1].pressed) buttons |= core.INPUT.DASH; if (pad.buttons[4] && pad.buttons[4].pressed) buttons |= core.INPUT.PREV; if (pad.buttons[5] && pad.buttons[5].pressed) buttons |= core.INPUT.NEXT;
    tapped |= buttons & ~gamepadLatch; gamepadLatch = buttons; return input;
  }

  async function start() {
    startButton.disabled = true; startButton.textContent = "SAMPLING ARENA…";
    const seed = core.textSeed(seedInput.value); const sample = await window.SignalBreachSampler.load(seed, 96);
    state = core.createGame(seed, sample.samples); aim = 0; held = 0; tapped = 0; accumulator = 0; resultLayer.hidden = true; bootLayer.hidden = true;
    ui.runtime.textContent = `${sample.runtime} / THREE.JS`; restartButton.disabled = false; buildArena(); renderHud(); canvas.focus();
    startButton.disabled = false; startButton.textContent = "DEPLOY OPERATOR";
  }
  function resetToBoot() { state = null; held = 0; tapped = 0; resultLayer.hidden = true; bootLayer.hidden = false; restartButton.disabled = true; }
  const keyBits = { KeyW: core.INPUT.UP, ArrowUp: core.INPUT.UP, KeyS: core.INPUT.DOWN, ArrowDown: core.INPUT.DOWN, KeyA: core.INPUT.LEFT, KeyD: core.INPUT.RIGHT };
  window.addEventListener("keydown", (event) => {
    if (!state) return; const bit = keyBits[event.code]; if (bit) held |= bit;
    if (event.code === "KeyQ" && !event.repeat) tapped |= core.INPUT.PREV; if (event.code === "KeyE" && !event.repeat) tapped |= core.INPUT.NEXT; if (event.code === "Space" && !event.repeat) tapped |= core.INPUT.DASH;
    if (bit || event.code === "Space" || event.code === "KeyQ" || event.code === "KeyE") event.preventDefault();
  });
  window.addEventListener("keyup", (event) => { const bit = keyBits[event.code]; if (bit) { held &= ~bit; event.preventDefault(); } });
  window.addEventListener("blur", () => { held = 0; });
  canvas.addEventListener("pointermove", (event) => {
    if (!state || !view) return; const rect = canvas.getBoundingClientRect(); const mouse = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1)); const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, view.camera); const point = new THREE.Vector3(); ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point); aim = (Math.round(Math.atan2(point.z - state.player.y / core.FP, point.x - state.player.x / core.FP) / (Math.PI * 2) * 64) + 64) & 63;
  });
  canvas.addEventListener("pointerdown", (event) => { if (event.button === 0) { held |= core.INPUT.FIRE; canvas.setPointerCapture(event.pointerId); } else if (event.button === 2) tapped |= core.INPUT.DASH; });
  function releaseCanvasFire() { held &= ~core.INPUT.FIRE; }
  canvas.addEventListener("pointerup", (event) => { if (event.button === 0) releaseCanvasFire(); });
  canvas.addEventListener("pointercancel", releaseCanvasFire);
  canvas.addEventListener("lostpointercapture", releaseCanvasFire);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  document.querySelectorAll("[data-hold]").forEach((button) => { const bit = core.INPUT[button.dataset.hold]; const down = (event) => { event.preventDefault(); held |= bit; }; const up = (event) => { event.preventDefault(); held &= ~bit; }; button.addEventListener("pointerdown", down); button.addEventListener("pointerup", up); button.addEventListener("pointercancel", up); });
  document.querySelectorAll("[data-tap]").forEach((button) => button.addEventListener("click", () => { tapped |= core.INPUT[button.dataset.tap]; }));
  startButton.addEventListener("click", start); againButton.addEventListener("click", resetToBoot); restartButton.addEventListener("click", resetToBoot);
  document.querySelector("#fullscreenButton").addEventListener("click", () => { if (shell.requestFullscreen) shell.requestFullscreen(); });
  audioButton.addEventListener("click", async () => { if (!audio) audio = makeAudio(); if (!audio) { audioButton.textContent = "AUDIO UNAVAILABLE"; return; } await audio.context.resume(); const enabled = audio.master.gain.value > 0; audio.master.gain.value = enabled ? 0 : .18; audioButton.textContent = enabled ? "AUDIO OFF" : "AUDIO ON"; audioButton.setAttribute("aria-pressed", String(!enabled)); });

  function frame(time) {
    accumulator += Math.min(.1, (time - lastTime) / 1000); lastTime = time;
    if (state) {
      const pad = gamepadInput();
      while (accumulator >= STEP) { core.step(state, held | pad | tapped, aim); tapped = 0; handleEvents(); accumulator -= STEP; if (flashTicks > 0 && --flashTicks === 0) flash.className = "event-flash"; }
      renderHud();
    }
    renderWorld(time); requestAnimationFrame(frame);
  }
  window.addEventListener("resize", resize); resize(); requestAnimationFrame(frame);
})();
