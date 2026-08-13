(function () {
  "use strict";

  const core = globalThis.SeedStormCore;
  if (!core) throw new Error("SEEDSTORM deterministic core failed to load");

  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d", { alpha: false });
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
      this.lastShotTick = -100;
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
    lastRenderedLevel = 0;
    ui.seedInput.value = `0x${core.seedHex(seed)}`;
    ui.intro.classList.add("is-hidden");
    hideMessage();
    enableRunControls();
    audio.ensure();
    canvas.focus({ preventScroll: true });
    setStatus(`Live flight launched from seed ${core.seedHex(seed)}.`);
  }

  function startReplay(replayData) {
    state = core.createRun(replayData.seed);
    recorder = null;
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
    lastRenderedLevel = 0;
    ui.seedInput.value = `0x${core.seedHex(replayData.seed)}`;
    ui.intro.classList.add("is-hidden");
    hideMessage();
    enableRunControls();
    ui.pause.disabled = false;
    ui.replay.disabled = true;
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

  function processCoreEvents() {
    for (const event of state.events) {
      audio.event(event, state);
      if (event.type === "enemy-down") {
        visualFlash = Math.max(visualFlash, 2);
        shake = Math.max(shake, 2);
      } else if (event.type === "bomb") {
        visualFlash = 18;
        shake = 12;
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
      core.recordInput(recorder, input);
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
      ui.mode.textContent = state.gameOver ? "FLIGHT ENDED" : "LIVE INPUT";
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
      ctx.fillText("COMMAND CORE", core.WIDTH / 2, 75);
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

  function isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  }

  document.addEventListener("keydown", (event) => {
    if (isTypingTarget(event.target)) return;
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
    if (isTypingTarget(event.target) || mode === "replay") return;
    const bit = codeToInput(event.code);
    if (bit) {
      event.preventDefault();
      heldInput &= ~bit;
    }
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
        ui.replayMeta.textContent = `${recorder.ticks.toLocaleString()} ticks · seed ${core.seedHex(recorder.seed)} · digest ${state ? core.stateDigest(state) : "--------"}`;
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
      ? `COPIED · ${recorder.ticks.toLocaleString()} ticks · no state snapshot`
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
