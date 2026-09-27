(function () {
  "use strict";

  const core = globalThis.SeedStormCore;
  if (!core) throw new Error("SEEDSTORM deterministic core failed to load");

  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const presentation = new window.SeedstormRenderer(canvas, core);
  const STEP_MS = 1000 / core.TICK_RATE;
  const palettes = [
    { sky: "#091015", deep: "#111a20", grid: "#293943", ground: "#7d573f", accent: "#d46a43" },
    { sky: "#10120f", deep: "#191c18", grid: "#3a4037", ground: "#97886c", accent: "#df7148" },
    { sky: "#100e0d", deep: "#1b1715", grid: "#3f332e", ground: "#725247", accent: "#e56f48" },
    { sky: "#080a0e", deep: "#121720", grid: "#293342", ground: "#4c5b68", accent: "#dd653f" },
    { sky: "#081116", deep: "#102028", grid: "#244552", ground: "#567b87", accent: "#e06c43" },
  ];

  const ui = {
    intro: $("introLayer"),
    seedInput: $("seedInput"),
    randomSeed: $("randomSeed"),
    start: $("startButton"),
    introReplay: $("introReplayButton"),
    message: $("messageLayer"),
    messageKicker: $("messageKicker"),
    messageTitle: $("messageTitle"),
    messageText: $("messageText"),
    seed: $("seedReadout"),
    mode: $("runMode"),
    score: $("scoreReadout"),
    level: $("levelReadout"),
    chain: $("chainReadout"),
    rank: $("rankReadout"),
    lives: $("livesReadout"),
    bombs: $("bombsReadout"),
    biome: $("biomeReadout"),
    progress: $("levelProgress"),
    signature: $("signatureReadout"),
    pause: $("pauseButton"),
    restart: $("restartButton"),
    replay: $("replayButton"),
    loadReplay: $("loadReplayButton"),
    sound: $("soundButton"),
    status: $("statusLine"),
    dialog: $("replayDialog"),
    replayText: $("replayText"),
    replayMeta: $("replayMeta"),
    copyReplay: $("copyReplayButton"),
    watchReplay: $("watchReplayButton"),
    touchBomb: $("touchBomb"),
    touchFocus: $("touchFocus"),
  };

  let state = null;
  let recorder = null;
  let recordingStopped = false;
  let recordingTerminalDigest = null;
  let replay = null;
  let replayCursor = null;
  let mode = "standby";
  let paused = false;
  let heldInput = 0;
  let bombQueued = false;
  let pointerActive = false;
  let pointerTarget = null;
  let lastTime = performance.now();
  let accumulator = 0;
  let visualFlash = 0;
  let shake = 0;
  let visualEffects = [];
  let enemyHitUntil = new Map();
  let lastRenderedLevel = 0;

  function visualHash(a, b, c) {
    let x = (a ^ Math.imul(b, 0x9e3779b1) ^ Math.imul(c, 0x85ebca6b)) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  }

  class AudioSystem {
    constructor() {
      this.enabled = true;
      this.context = null;
      this.master = null;
      this.resetRun();
    }

    resetRun() {
      this.lastShotTick = -100;
      this.lastHitTick = -100;
    }

    ensure() {
      if (!this.enabled) return null;
      if (!this.context) {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return null;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.22;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") this.context.resume();
      return this.context;
    }

    tone(frequency, duration, type, gain, slide) {
      const audio = this.ensure();
      if (!audio) return;
      const now = audio.currentTime;
      const oscillator = audio.createOscillator();
      const envelope = audio.createGain();
      oscillator.type = type || "square";
      oscillator.frequency.setValueAtTime(Math.max(30, frequency), now);
      if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, slide), now + duration);
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain || 0.05), now + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(envelope);
      envelope.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    }

    event(event, gameState) {
      if (!this.enabled) return;
      if (event.type === "shot" && gameState.tick - this.lastShotTick >= 4) {
        this.lastShotTick = gameState.tick;
        this.tone(340 + gameState.player.power * 32, 0.055, "square", 0.035, 170);
      } else if (event.type === "enemy-hit" && gameState.tick - this.lastHitTick >= 3) {
        this.lastHitTick = gameState.tick;
        this.tone(760, 0.035, "square", 0.018, 420);
      } else if (event.type === "enemy-down") {
        this.tone(105, 0.13, "sawtooth", 0.055, 45);
      } else if (event.type === "pickup") {
        this.tone(440, 0.15, "triangle", 0.045, 880);
      } else if (event.type === "bomb") {
        this.tone(78, 0.55, "sawtooth", 0.12, 32);
      } else if (event.type === "player-hit") {
        this.tone(170, 0.45, "square", 0.1, 42);
      } else if (event.type === "boss") {
        this.tone(55, 0.8, "sawtooth", 0.08, 41);
      } else if (event.type === "boss-down" || event.type === "level") {
        this.tone(110, 0.6, "triangle", 0.1, 660);
      }
    }

    musicTick(gameState) {
      if (!this.enabled || gameState.tick % 30 !== 0 || paused) return;
      const minor = [0, 3, 5, 7, 10, 12, 15, 17];
      const index = visualHash(gameState.seed, gameState.level, Math.floor(gameState.tick / 30)) % minor.length;
      const root = 55 * Math.pow(2, (gameState.level % 3) / 12);
      this.tone(root * Math.pow(2, minor[index] / 12), 0.22, "triangle", 0.018, 0);
    }

    toggle() {
      this.enabled = !this.enabled;
      if (!this.enabled && this.context) this.context.suspend();
      else this.ensure();
      return this.enabled;
    }
  }

  const audio = new AudioSystem();

  function setStatus(text) {
    ui.status.textContent = text;
  }

  function showMessage(kicker, title, text) {
    ui.messageKicker.textContent = kicker;
    ui.messageTitle.textContent = title;
    ui.messageText.textContent = text;
    ui.message.classList.remove("is-hidden");
  }

  function hideMessage() {
    ui.message.classList.add("is-hidden");
  }

  function startLive(seedInput) {
    const seed = core.normalizeSeed(seedInput);
    state = core.createRun(seed);
    recorder = core.createRecorder(seed);
    recordingStopped = false;
    recordingTerminalDigest = null;
    replay = null;
    replayCursor = null;
    mode = "live";
    paused = false;
    heldInput = 0;
    bombQueued = false;
    pointerActive = false;
    accumulator = 0;
    visualFlash = 0;
    shake = 0;
    visualEffects = [];
    enemyHitUntil = new Map();
    audio.resetRun();
    lastRenderedLevel = 0;
    ui.pause.textContent = "PAUSE";
    ui.seedInput.value = `0x${core.seedHex(seed)}`;
    ui.intro.classList.add("is-hidden");
    hideMessage();
    enableRunControls();
    updateHud();
    audio.ensure();
    canvas.focus({ preventScroll: true });
    setStatus(`Live flight launched from seed ${core.seedHex(seed)}.`);
  }

  function startReplay(replayData) {
    state = core.createRun(replayData.seed);
    recorder = null;
    recordingStopped = false;
    recordingTerminalDigest = null;
    replay = replayData;
    replayCursor = core.createReplayCursor(replayData);
    mode = "replay";
    paused = false;
    heldInput = 0;
    bombQueued = false;
    pointerActive = false;
    accumulator = 0;
    visualFlash = 0;
    shake = 0;
    visualEffects = [];
    enemyHitUntil = new Map();
    audio.resetRun();
    lastRenderedLevel = 0;
    ui.pause.textContent = "PAUSE";
    ui.seedInput.value = `0x${core.seedHex(replayData.seed)}`;
    ui.intro.classList.add("is-hidden");
    hideMessage();
    enableRunControls();
    ui.pause.disabled = false;
    ui.replay.disabled = true;
    updateHud();
    ui.dialog.close();
    audio.ensure();
    canvas.focus({ preventScroll: true });
    setStatus(`Replaying ${replayData.ticks.toLocaleString()} deterministic ticks from the beginning.`);
  }

  function enableRunControls() {
    ui.pause.disabled = false;
    ui.restart.disabled = false;
    ui.replay.disabled = mode !== "live";
  }

  function restartCurrentSeed() {
    if (!state) return;
    if (mode === "replay" && replay) startReplay(replay);
    else startLive(state.seed);
  }

  function togglePause() {
    if (!state || state.gameOver) return;
    paused = !paused;
    accumulator = 0;
    ui.pause.textContent = paused ? "RESUME" : "PAUSE";
    if (paused) showMessage(mode === "replay" ? "FLIGHT RECORDER" : "SYSTEM", "PAUSED", "Press P or Resume to continue");
    else {
      hideMessage();
      canvas.focus({ preventScroll: true });
    }
  }

  function randomSeedText() {
    const words = ["IRON", "CIPHER", "DELTA", "FAULT", "VECTOR", "ASH", "COBALT", "RELAY", "STORM", "VOID"];
    let value;
    if (globalThis.crypto && globalThis.crypto.getRandomValues) {
      const array = new Uint32Array(2);
      globalThis.crypto.getRandomValues(array);
      value = `${words[array[0] % words.length]}-${(array[1] >>> 0).toString(36).toUpperCase()}`;
    } else {
      value = `FLIGHT-${Date.now().toString(36).toUpperCase()}`;
    }
    ui.seedInput.value = value;
    ui.seedInput.select();
  }

  function readLiveInput() {
    let mask = heldInput;
    if (pointerActive && pointerTarget && state) {
      mask |= core.INPUT.FIRE;
      const px = state.player.x / core.SCALE;
      const py = state.player.y / core.SCALE;
      if (pointerTarget.x < px - 5) mask |= core.INPUT.LEFT;
      if (pointerTarget.x > px + 5) mask |= core.INPUT.RIGHT;
      if (pointerTarget.y < py - 5) mask |= core.INPUT.UP;
      if (pointerTarget.y > py + 5) mask |= core.INPUT.DOWN;
    }
    if (bombQueued) {
      mask |= core.INPUT.BOMB;
      bombQueued = false;
    }
    return mask & 0x7f;
  }

  function addVisualEffect(type, event) {
    const boss = event.kind === "boss";
    visualEffects.push({
      type,
      x: event.x / core.SCALE,
      y: event.y / core.SCALE,
      radius: event.radius / core.SCALE,
      startTick: state.tick,
      duration: type === "impact" ? 12 : boss ? 96 : 38,
      seed: visualHash(state.seed, event.id, state.tick ^ (type === "impact" ? 0x51f15e : 0xe7a10de)),
      boss,
    });
    if (visualEffects.length > 128) visualEffects.splice(0, visualEffects.length - 128);
  }

  function pruneVisualEffects() {
    visualEffects = visualEffects.filter((effect) => state.tick - effect.startTick <= effect.duration);
    for (const [id, until] of enemyHitUntil) {
      if (until < state.tick) enemyHitUntil.delete(id);
    }
  }

  function processCoreEvents() {
    for (const event of state.events) {
      audio.event(event, state);
      if (event.type === "enemy-hit") {
        enemyHitUntil.set(event.id, state.tick + 4);
        addVisualEffect("impact", event);
      } else if (event.type === "enemy-down") {
        addVisualEffect("explosion", event);
        visualFlash = Math.max(visualFlash, 2);
        shake = Math.max(shake, 2);
      } else if (event.type === "boss-down") {
        addVisualEffect("explosion", event);
        visualFlash = Math.max(visualFlash, 14);
        shake = Math.max(shake, 18);
      } else if (event.type === "bomb") {
        visualFlash = Math.max(visualFlash, 18);
        shake = Math.max(shake, 12);
      } else if (event.type === "player-hit") {
        visualFlash = 12;
        shake = 16;
      } else if (event.type === "boss") {
        setStatus(`Level ${state.level} command craft has entered the sector.`);
      } else if (event.type === "level") {
        setStatus(`Sector cleared. Level ${state.level} rank escalation is active.`);
      } else if (event.type === "game-over") {
        showMessage("FLIGHT TERMINATED", "GAME OVER", mode === "live" ? "Export the replay or restart this seed" : "Recorded flight reached its end state");
        ui.pause.disabled = true;
        if (mode === "live") ui.replay.disabled = false;
      }
    }
    pruneVisualEffects();
    audio.musicTick(state);
  }

  function simulationStep() {
    if (!state || paused || state.gameOver) return false;
    let input;
    if (mode === "replay") {
      input = core.nextReplayInput(replayCursor);
      if (input === null) {
        paused = true;
        ui.pause.disabled = true;
        showMessage("FLIGHT RECORDER", "REPLAY COMPLETE", `Verified ${core.stateDigest(state)} after ${state.tick.toLocaleString()} ticks`);
        setStatus(`Replay complete. Final deterministic digest ${core.stateDigest(state)}.`);
        return false;
      }
    } else {
      input = readLiveInput();
      if (!recordingStopped && !core.tryRecordInput(recorder, input)) {
        recordingStopped = true;
        recordingTerminalDigest = core.stateDigest(state);
        setStatus("Replay recorder sealed at its six-hour limit; live play continues.");
      }
    }
    core.step(state, input);
    processCoreEvents();
    return true;
  }

  function updateHud() {
    if (!state) {
      ui.seed.textContent = "--------";
      return;
    }
    ui.seed.textContent = core.seedHex(state.seed);
    ui.score.textContent = String(state.score).padStart(8, "0");
    ui.level.textContent = String(state.level).padStart(2, "0");
    ui.chain.textContent = String(state.chain).padStart(3, "0");
    ui.rank.textContent = `${(state.multiplierBasis / 100).toFixed(2)}×`;
    ui.lives.textContent = String(state.lives);
    ui.bombs.textContent = String(state.bombs);
    ui.biome.textContent = state.blueprint.biome.name;
    ui.signature.textContent = `SIG ${state.blueprint.signature}`;
    const progress = Math.min(100, state.levelTick / state.blueprint.bossTick * 100);
    ui.progress.style.width = `${progress.toFixed(2)}%`;
    if (mode === "replay") {
      const percent = replay.ticks ? Math.min(100, replayCursor.tick / replay.ticks * 100) : 100;
      ui.mode.textContent = `REPLAY // ${percent.toFixed(1)}%`;
    } else {
      ui.mode.textContent = state.gameOver
        ? "FLIGHT ENDED"
        : recordingStopped ? "LIVE // RECORDER SEALED" : "LIVE INPUT";
    }
  }

  function render() {
    presentation.render(state, {
      palette: state ? palettes[state.blueprint.biomeIndex % palettes.length] : palettes[0],
      heldInput,
      effects: visualEffects,
      enemyHitUntil,
      paused,
      flash: visualFlash,
      shake,
    });
    if (visualFlash > 0) visualFlash -= 1;
    if (shake > 0) shake -= 1;
  }

  function frame(time) {
    const elapsed = Math.min(100, Math.max(0, time - lastTime));
    lastTime = time;
    if (state && !paused && !state.gameOver) {
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= STEP_MS && steps < 8) {
        if (!simulationStep()) break;
        accumulator -= STEP_MS;
        steps += 1;
      }
      if (steps >= 8) accumulator = 0;
    } else {
      accumulator = 0;
    }
    updateHud();
    render(time);
    requestAnimationFrame(frame);
  }

  function codeToInput(code) {
    const map = {
      ArrowLeft: core.INPUT.LEFT,
      KeyA: core.INPUT.LEFT,
      ArrowRight: core.INPUT.RIGHT,
      KeyD: core.INPUT.RIGHT,
      ArrowUp: core.INPUT.UP,
      KeyW: core.INPUT.UP,
      ArrowDown: core.INPUT.DOWN,
      KeyS: core.INPUT.DOWN,
      Space: core.INPUT.FIRE,
      KeyZ: core.INPUT.FIRE,
      ShiftLeft: core.INPUT.FOCUS,
      ShiftRight: core.INPUT.FOCUS,
      KeyX: core.INPUT.BOMB,
      KeyB: core.INPUT.BOMB,
    };
    return map[code] || 0;
  }

  function isInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest(
      "button, input, textarea, select, a[href], summary, [contenteditable='true'], [role='button'], [role='link']"
    ));
  }

  document.addEventListener("keydown", (event) => {
    if (isInteractiveTarget(event.target)) return;
    if (event.code === "KeyP" || event.code === "Escape") {
      if (ui.dialog.open) return;
      event.preventDefault();
      togglePause();
      return;
    }
    if (mode === "replay") return;
    const bit = codeToInput(event.code);
    if (bit) {
      event.preventDefault();
      heldInput |= bit;
    }
  });

  document.addEventListener("keyup", (event) => {
    const bit = codeToInput(event.code);
    if (!bit || mode === "replay") return;
    heldInput &= ~bit;
    if (!isInteractiveTarget(event.target)) event.preventDefault();
  });

  globalThis.addEventListener("blur", () => {
    heldInput = 0;
    pointerActive = false;
    if (state && !paused && !state.gameOver && mode === "live") togglePause();
  });

  function setPointerTarget(event) {
    const bounds = canvas.getBoundingClientRect();
    pointerTarget = {
      x: (event.clientX - bounds.left) * core.WIDTH / bounds.width,
      y: (event.clientY - bounds.top) * core.HEIGHT / bounds.height,
    };
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!state || mode === "replay") return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    pointerActive = true;
    setPointerTarget(event);
    audio.ensure();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointerActive) return;
    event.preventDefault();
    setPointerTarget(event);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!pointerActive) return;
    event.preventDefault();
    pointerActive = false;
    pointerTarget = null;
  });
  canvas.addEventListener("pointercancel", () => {
    pointerActive = false;
    pointerTarget = null;
  });

  ui.touchBomb.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    bombQueued = true;
  });
  ui.touchFocus.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    heldInput |= core.INPUT.FOCUS;
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    ui.touchFocus.addEventListener(type, () => { heldInput &= ~core.INPUT.FOCUS; });
  }

  function openReplayDialog(withCurrent) {
    if (withCurrent && recorder) {
      try {
        ui.replayText.value = core.encodeReplay(recorder);
        const digest = recordingTerminalDigest || (state ? core.stateDigest(state) : "--------");
        const boundary = recordingStopped ? " · recorder sealed" : "";
        ui.replayMeta.textContent = `${recorder.ticks.toLocaleString()} ticks · seed ${core.seedHex(recorder.seed)} · digest ${digest}${boundary}`;
      } catch (error) {
        ui.replayMeta.textContent = error.message;
      }
    } else if (!withCurrent) {
      ui.replayText.value = "";
      ui.replayMeta.textContent = "Paste a replay code to inspect it.";
    }
    if (!ui.dialog.open) ui.dialog.showModal();
    ui.replayText.focus();
  }

  function inspectReplayText() {
    const value = ui.replayText.value.trim();
    if (!value) {
      ui.replayMeta.textContent = "No replay loaded.";
      return null;
    }
    try {
      const parsed = core.decodeReplay(value);
      ui.replayMeta.textContent = `VALID · ${parsed.ticks.toLocaleString()} ticks · seed ${core.seedHex(parsed.seed)} · engine v${parsed.version}`;
      return parsed;
    } catch (error) {
      ui.replayMeta.textContent = `INVALID · ${error.message}`;
      return null;
    }
  }

  async function copyCurrentReplay() {
    if (!recorder) {
      ui.replayMeta.textContent = "Only a live flight can be exported.";
      return;
    }
    const code = core.encodeReplay(recorder);
    ui.replayText.value = code;
    let copied = false;
    if (navigator.clipboard && globalThis.isSecureContext) {
      try {
        await navigator.clipboard.writeText(code);
        copied = true;
      } catch (_error) {
        copied = false;
      }
    }
    if (!copied) {
      ui.replayText.select();
      copied = document.execCommand("copy");
    }
    ui.replayMeta.textContent = copied
      ? `COPIED · ${recorder.ticks.toLocaleString()} ticks · no state snapshot${recordingStopped ? " · recorder sealed" : ""}`
      : "Replay generated. Select the code and copy it manually.";
    setStatus(`Replay code generated at tick ${recorder.ticks.toLocaleString()}.`);
  }

  ui.start.addEventListener("click", () => startLive(ui.seedInput.value));
  ui.seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") startLive(ui.seedInput.value);
  });
  ui.randomSeed.addEventListener("click", randomSeedText);
  ui.pause.addEventListener("click", togglePause);
  ui.restart.addEventListener("click", restartCurrentSeed);
  ui.replay.addEventListener("click", () => openReplayDialog(true));
  ui.loadReplay.addEventListener("click", () => openReplayDialog(false));
  ui.introReplay.addEventListener("click", () => openReplayDialog(false));
  ui.copyReplay.addEventListener("click", copyCurrentReplay);
  ui.watchReplay.addEventListener("click", () => {
    const parsed = inspectReplayText();
    if (parsed) startReplay(parsed);
  });
  ui.replayText.addEventListener("input", inspectReplayText);
  ui.sound.addEventListener("click", () => {
    const enabled = audio.toggle();
    ui.sound.textContent = `SOUND: ${enabled ? "ON" : "OFF"}`;
    ui.sound.setAttribute("aria-pressed", String(enabled));
  });
  ui.message.addEventListener("click", () => {
    if (paused && !state?.gameOver && mode !== "replay") togglePause();
  });

  const seedFromHash = location.hash.match(/^#seed=([0-9a-f]{8})$/i);
  if (seedFromHash) ui.seedInput.value = `0x${seedFromHash[1].toUpperCase()}`;
  updateHud();
  render(performance.now());
  requestAnimationFrame(frame);
})();
