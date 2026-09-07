(function () {
  "use strict";

  const core = globalThis.SeedStormCore;
  if (!core) throw new Error("SEEDSTORM deterministic core failed to load");

  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const threeStage = globalThis.QsolThree
    ? globalThis.QsolThree.create({ host: $("canvasWrap"), source: canvas, preset: "seedstorm" })
    : { render() {}, pulse() {} };
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
        threeStage.pulse("impact", 0.22);
      } else if (event.type === "enemy-down") {
        addVisualEffect("explosion", event);
        visualFlash = Math.max(visualFlash, 2);
        shake = Math.max(shake, 2);
        threeStage.pulse("blast", 0.42);
      } else if (event.type === "boss-down") {
        addVisualEffect("explosion", event);
        visualFlash = Math.max(visualFlash, 14);
        shake = Math.max(shake, 18);
        threeStage.pulse("blast", 1);
      } else if (event.type === "bomb") {
        visualFlash = Math.max(visualFlash, 18);
        shake = Math.max(shake, 12);
        threeStage.pulse("blast", 0.9);
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

  function drawBackground(gameState, time) {
    const level = gameState ? gameState.level : 1;
    const seed = gameState ? gameState.seed : core.normalizeSeed("SEEDSTORM-ATTRACT");
    const levelTick = gameState ? gameState.levelTick : Math.floor(time / 16);
    const blueprint = gameState ? gameState.blueprint : core.makeLevelBlueprint(seed, 1);
    const palette = palettes[blueprint.biomeIndex % palettes.length];
    const gradient = ctx.createLinearGradient(0, 0, 0, core.HEIGHT);
    gradient.addColorStop(0, palette.sky);
    gradient.addColorStop(1, palette.deep);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, core.WIDTH, core.HEIGHT);

    const scroll = Math.floor(levelTick * (1.1 + Math.min(level, 12) * 0.06));
    const cell = 72;
    const firstRow = Math.floor(scroll / cell) - 1;
    const offset = scroll % cell;

    ctx.lineWidth = 1;
    for (let row = firstRow; row < firstRow + 13; row += 1) {
      const y = (row - firstRow) * cell + offset - cell * 2;
      const hash = visualHash(seed, blueprint.levelSeed, row);
      ctx.strokeStyle = palette.grid;
      ctx.globalAlpha = 0.4 + ((hash >>> 4) % 30) / 100;
      ctx.beginPath();
      ctx.moveTo(36, y);
      ctx.lineTo(core.WIDTH - 36, y);
      ctx.stroke();

      const side = hash & 1 ? 1 : -1;
      const structureWidth = 20 + ((hash >>> 8) % 72);
      const structureX = side > 0 ? core.WIDTH - structureWidth - 12 : 12;
      ctx.fillStyle = palette.ground;
      ctx.globalAlpha = 0.11 + ((hash >>> 16) % 14) / 100;
      ctx.fillRect(structureX, y + 9, structureWidth, 34 + ((hash >>> 20) % 26));

      if ((hash >>> 3) % 4 === 0) {
        ctx.strokeStyle = palette.accent;
        ctx.globalAlpha = 0.22;
        ctx.strokeRect(structureX + 4, y + 14, Math.max(5, structureWidth - 8), 8);
      }
    }

    ctx.globalAlpha = 0.24;
    ctx.strokeStyle = palette.grid;
    ctx.setLineDash([14, 18]);
    ctx.beginPath();
    ctx.moveTo(120, 0);
    ctx.lineTo(120, core.HEIGHT);
    ctx.moveTo(core.WIDTH - 120, 0);
    ctx.lineTo(core.WIDTH - 120, core.HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const vignette = ctx.createRadialGradient(core.WIDTH / 2, core.HEIGHT / 2, 120, core.WIDTH / 2, core.HEIGHT / 2, 430);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, core.WIDTH, core.HEIGHT);
  }

  function pathPolygon(points, fill, stroke, lineWidth) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
  }

  function drawPlayer(player, tick) {
    if (player.invulnerable > 0 && Math.floor(tick / 4) % 2 === 0) ctx.globalAlpha = 0.34;
    const x = player.x / core.SCALE;
    const y = player.y / core.SCALE;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const trail = 22 + (tick % 5) * 2;
    const engineGradient = ctx.createLinearGradient(x, y + 8, x, y + trail + 22);
    engineGradient.addColorStop(0, "rgba(232,159,78,0.52)");
    engineGradient.addColorStop(1, "rgba(82,135,137,0)");
    ctx.fillStyle = engineGradient;
    ctx.beginPath();
    ctx.moveTo(x - 8, y + 8); ctx.lineTo(x + 8, y + 8); ctx.lineTo(x, y + trail + 22); ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    pathPolygon([[0, -18], [7, -5], [18, 7], [7, 8], [4, 17], [0, 12], [-4, 17], [-7, 8], [-18, 7], [-7, -5]], "#d9e0dc", "#10171b", 2);
    pathPolygon([[0, -12], [5, 4], [0, 10], [-5, 4]], "#527b88", "#99b7bd", 1);
    ctx.fillStyle = "#ef7047";
    ctx.fillRect(-7, 12, 4, 9 + (tick % 4));
    ctx.fillRect(3, 12, 4, 9 + ((tick + 2) % 4));
    if (heldInput & core.INPUT.FOCUS) {
      ctx.strokeStyle = "rgba(233,227,213,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawEnemy(enemy, tick) {
    const x = enemy.x / core.SCALE;
    const y = enemy.y / core.SCALE;
    const radius = enemy.radius / core.SCALE;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.beginPath();
    ctx.ellipse(x + 5, y + radius * 0.35, radius * 0.82, radius * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    if (enemy.kind === "scout") {
      pathPolygon([[0, 14], [12, -9], [4, -6], [0, -15], [-4, -6], [-12, -9]], "#ad5339", "#ef916e", 1);
    } else if (enemy.kind === "wing") {
      pathPolygon([[0, 14], [18, -4], [8, -8], [0, -14], [-8, -8], [-18, -4]], "#8f9aa0", "#d7d1c4", 1);
      ctx.fillStyle = "#d05d3b";
      ctx.fillRect(-3, -3, 6, 9);
    } else if (enemy.kind === "turret") {
      ctx.rotate((enemy.pathSeed % 8) * Math.PI / 4);
      pathPolygon([[0, -16], [12, -12], [16, 0], [12, 12], [0, 16], [-12, 12], [-16, 0], [-12, -12]], "#4f5e64", "#9ca9ad", 2);
      ctx.fillStyle = "#d86642";
      ctx.fillRect(-4, -4, 8, 12);
    } else if (enemy.kind === "bomber") {
      pathPolygon([[0, 20], [22, 8], [18, -11], [7, -8], [0, -20], [-7, -8], [-18, -11], [-22, 8]], "#6b5146", "#c18b72", 2);
      ctx.fillStyle = "#d9d1c2";
      ctx.fillRect(-5, -6, 10, 15);
    } else if (enemy.kind === "spinner") {
      ctx.rotate((tick + enemy.id * 7) * 0.025);
      ctx.strokeStyle = "#d8d3c7";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(18, 0);
      ctx.moveTo(0, -18);
      ctx.lineTo(0, 18);
      ctx.stroke();
      ctx.fillStyle = "#ce6040";
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
    } else if (enemy.kind === "boss") {
      ctx.rotate(Math.sin(tick * 0.015) * 0.04);
      pathPolygon([[0, radius], [48, 30], [radius, -6], [44, -22], [25, -50], [0, -radius], [-25, -50], [-44, -22], [-radius, -6], [-48, 30]], "#343f45", "#a5b0b2", 3);
      pathPolygon([[0, 38], [24, 8], [13, -28], [0, -42], [-13, -28], [-24, 8]], "#8e3f30", "#ef7b54", 2);
      ctx.fillStyle = "#e7dfcf";
      ctx.fillRect(-7, -7, 14, 25);
    }
    ctx.restore();

    if (enemy.kind === "boss" || radius >= 19) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin((tick + enemy.id) * 0.08) * 0.12;
      ctx.strokeStyle = enemy.kind === "boss" ? "#e58a62" : "#b9c7c2";
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if ((enemyHitUntil.get(enemy.id) || -1) >= tick) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = "#fff4dc";
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawEnemyHealth(enemy, x, y, radius);
  }

  function drawEnemyHealth(enemy, x, y, radius) {
    if (enemy.kind === "boss" || enemy.health >= enemy.maxHealth || enemy.maxHealth <= 0) return;
    const width = Math.max(24, Math.min(52, radius * 2.25));
    const ratio = Math.max(0, Math.min(1, enemy.health / enemy.maxHealth));
    const left = x - width / 2;
    const top = y - radius - 10;
    ctx.fillStyle = "rgba(3,5,6,0.88)";
    ctx.fillRect(left - 1, top - 1, width + 2, 5);
    ctx.fillStyle = ratio > 0.5 ? "#8fb18a" : ratio > 0.25 ? "#d9a25b" : "#e36543";
    ctx.fillRect(left, top, width * ratio, 3);
    ctx.strokeStyle = "rgba(225,224,214,0.45)";
    ctx.lineWidth = 1;
    ctx.strokeRect(left - 0.5, top - 0.5, width + 1, 4);
  }

  function drawImpact(effect, age) {
    const progress = age / effect.duration;
    const alpha = Math.max(0, 1 - progress);
    const count = 6;
    ctx.save();
    ctx.translate(effect.x, effect.y);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#fff1cc";
    ctx.lineWidth = 1.5;
    for (let index = 0; index < count; index += 1) {
      const hash = visualHash(effect.seed, index, 0x1a2b3c);
      const angle = (hash % 6283) / 1000;
      const speed = 0.7 + ((hash >>> 12) % 90) / 100;
      const distance = 2 + age * speed;
      const length = 3 + ((hash >>> 22) % 5);
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      ctx.stroke();
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1, 4 * alpha), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawExplosion(effect, age) {
    const progress = age / effect.duration;
    const alpha = Math.max(0, 1 - progress);
    const scale = effect.boss ? 2.35 : Math.max(0.8, effect.radius / 16);
    const particleCount = effect.boss ? 30 : 14;
    ctx.save();
    ctx.translate(effect.x, effect.y);
    ctx.globalCompositeOperation = "screen";

    const ringRadius = (5 + progress * (effect.boss ? 92 : 34)) * scale;
    ctx.globalAlpha = alpha * 0.82;
    ctx.strokeStyle = "#ff8254";
    ctx.lineWidth = Math.max(1, (1 - progress) * 6 * scale);
    ctx.beginPath();
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = Math.max(0, 0.72 - progress * 1.2);
    ctx.fillStyle = "#fff2cf";
    ctx.beginPath();
    ctx.arc(0, 0, (1 - progress) * 15 * scale, 0, Math.PI * 2);
    ctx.fill();

    for (let index = 0; index < particleCount; index += 1) {
      const hash = visualHash(effect.seed, index, 0xe710de);
      const angle = (hash % 6283) / 1000;
      const speed = (0.65 + ((hash >>> 11) % 130) / 100) * scale;
      const distance = age * speed;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance + age * age * 0.008;
      const size = (2 + ((hash >>> 24) % 5)) * Math.max(0.45, alpha);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + age * (((hash >>> 8) & 1) ? 0.08 : -0.08));
      ctx.globalAlpha = alpha * (0.45 + ((hash >>> 20) % 50) / 100);
      ctx.fillStyle = index % 3 === 0 ? "#e8dfc9" : index % 3 === 1 ? "#ff7548" : "#7da7ad";
      ctx.fillRect(-size / 2, -size / 2, size * 1.8, size);
      ctx.restore();
    }

    if (effect.boss) {
      for (let ring = 0; ring < 3; ring += 1) {
        const delayed = Math.max(0, Math.min(1, progress * 1.7 - ring * 0.2));
        if (delayed <= 0) continue;
        ctx.globalAlpha = (1 - delayed) * 0.42;
        ctx.strokeStyle = ring % 2 ? "#dce6df" : "#df6843";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, delayed * (50 + ring * 28), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawVisualEffects(gameState) {
    for (const effect of visualEffects) {
      const age = gameState.tick - effect.startTick;
      if (age < 0 || age > effect.duration) continue;
      if (effect.type === "impact") drawImpact(effect, age);
      else drawExplosion(effect, age);
    }
  }

  function drawEntities(gameState) {
    for (const pickup of gameState.pickups) {
      const x = pickup.x / core.SCALE;
      const y = pickup.y / core.SCALE;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((gameState.tick + pickup.id) * 0.035);
      ctx.fillStyle = pickup.kind === "power" ? "#6fa4b2" : "#df6c45";
      ctx.fillRect(-9, -9, 18, 18);
      ctx.fillStyle = "#0a0d0f";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pickup.kind === "power" ? "P" : "B", 0, 1);
      ctx.restore();
    }

    ctx.lineCap = "round";
    for (const bullet of gameState.playerBullets) {
      const x = bullet.x / core.SCALE;
      const y = bullet.y / core.SCALE;
      ctx.strokeStyle = "#d8edf0";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y + 8);
      ctx.lineTo(x - bullet.vx / 64, y - 8);
      ctx.stroke();
    }

    for (const enemy of gameState.enemies) drawEnemy(enemy, gameState.tick);

    for (const bullet of gameState.enemyBullets) {
      const x = bullet.x / core.SCALE;
      const y = bullet.y / core.SCALE;
      const r = bullet.radius / core.SCALE;
      ctx.fillStyle = bullet.grazed ? "#d8cbb5" : "#e25f3b";
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2.5, r * 0.72), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,180,132,0.65)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    drawVisualEffects(gameState);
    drawPlayer(gameState.player, gameState.tick);
  }

  function drawGameOverlay(gameState) {
    ctx.fillStyle = "rgba(5,7,9,0.72)";
    ctx.fillRect(0, 0, core.WIDTH, 42);
    ctx.fillStyle = "#d9d4c7";
    ctx.font = "700 12px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`LV ${String(gameState.level).padStart(2, "0")}  ${gameState.blueprint.biome.code}`, 12, 17);
    ctx.fillStyle = "#87949b";
    ctx.font = "10px monospace";
    ctx.fillText(`SEED ${core.seedHex(gameState.seed)}  SIG ${gameState.blueprint.signature}`, 12, 33);
    ctx.textAlign = "right";
    ctx.fillStyle = "#f07950";
    ctx.font = "700 14px monospace";
    ctx.fillText(String(gameState.score).padStart(8, "0"), core.WIDTH - 12, 20);

    const boss = gameState.enemies.find((enemy) => enemy.kind === "boss" && !enemy.dead);
    if (boss) {
      const width = 300;
      const ratio = Math.max(0, boss.health / boss.maxHealth);
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect((core.WIDTH - width) / 2, 52, width, 10);
      ctx.fillStyle = "#dc603d";
      ctx.fillRect((core.WIDTH - width) / 2 + 2, 54, (width - 4) * ratio, 6);
      ctx.fillStyle = "#c8c0b2";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`COMMAND CORE // ${Math.ceil(ratio * 100)}%`, core.WIDTH / 2, 75);
    }

    if (gameState.levelTick < 150) {
      const alpha = Math.min(1, gameState.levelTick / 20, (150 - gameState.levelTick) / 25);
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = "rgba(8,11,13,0.82)";
      ctx.fillRect(58, 285, core.WIDTH - 116, 105);
      ctx.strokeStyle = "#df6b44";
      ctx.strokeRect(58.5, 285.5, core.WIDTH - 117, 104);
      ctx.fillStyle = "#8e9aa0";
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`PROCEDURAL SECTOR ${String(gameState.level).padStart(2, "0")}`, core.WIDTH / 2, 317);
      ctx.fillStyle = "#e8e1d4";
      ctx.font = "700 25px monospace";
      ctx.fillText(gameState.blueprint.biome.name.toUpperCase(), core.WIDTH / 2, 351);
      ctx.fillStyle = "#df6b44";
      ctx.font = "10px monospace";
      ctx.fillText(`RANK ${gameState.blueprint.difficulty.rank} // ${gameState.blueprint.signature}`, core.WIDTH / 2, 374);
      ctx.globalAlpha = 1;
    }

    const warningStart = gameState.blueprint.bossTick - 180;
    if (!gameState.bossDefeated && gameState.levelTick >= warningStart && gameState.levelTick < gameState.blueprint.bossTick) {
      ctx.globalAlpha = Math.floor(gameState.tick / 10) % 2 ? 0.95 : 0.35;
      ctx.fillStyle = "#df5f3b";
      ctx.fillRect(0, 94, core.WIDTH, 36);
      ctx.fillStyle = "#080a0c";
      ctx.font = "900 19px monospace";
      ctx.textAlign = "center";
      ctx.fillText("COMMAND SIGNATURE DETECTED", core.WIDTH / 2, 119);
      ctx.globalAlpha = 1;
    }

    if (gameState.bombPulse > 0) {
      const ratio = gameState.bombPulse / 45;
      ctx.strokeStyle = `rgba(239,224,200,${ratio})`;
      ctx.lineWidth = 8 * ratio + 1;
      ctx.beginPath();
      ctx.arc(gameState.player.x / core.SCALE, gameState.player.y / core.SCALE, (1 - ratio) * 520, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function render(time) {
    ctx.save();
    if (shake > 0) {
      const x = ((visualHash(state ? state.tick : 0, shake, 1) % 7) - 3) * Math.min(1, shake / 8);
      const y = ((visualHash(state ? state.tick : 0, shake, 2) % 7) - 3) * Math.min(1, shake / 8);
      ctx.translate(x, y);
      shake -= 1;
    }
    drawBackground(state, time);
    if (state) {
      drawEntities(state);
      drawGameOverlay(state);
    } else {
      ctx.fillStyle = "rgba(233,227,213,0.025)";
      ctx.font = "900 84px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("S", core.WIDTH / 2, core.HEIGHT / 2 + 25);
    }
    if (visualFlash > 0) {
      ctx.fillStyle = `rgba(239,224,200,${Math.min(0.28, visualFlash / 70)})`;
      ctx.fillRect(0, 0, core.WIDTH, core.HEIGHT);
      visualFlash -= 1;
    }
    ctx.restore();
    threeStage.render({
      tick: state ? state.tick : 0,
      speed: state ? 1 + state.level * 0.08 : 0.25,
      danger: state ? Math.max(0, 1 - state.player.health / state.player.maxHealth) : 0,
      activity: state ? Math.min(1, 0.24 + (state.playerBullets.length + state.enemyBullets.length) / 24) : 0.08,
      heading: 0,
    });
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
