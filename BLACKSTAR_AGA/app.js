(function () {
  "use strict";

  const core = window.BlackstarCore;
  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const threeStage = window.QsolThree
    ? window.QsolThree.create({ host: document.querySelector("#viewport"), source: canvas, preset: "blackstar" })
    : { render() {}, pulse() {} };
  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const VIEW_HEIGHT = 160;
  const HUD_TOP = 160;
  const TICK_MS = 1000 / core.TICK_RATE;
  const MAX_FRAME_STEPS = 8;
  const FOV = 11264;
  const RAY_STEP = 38;
  const MAX_RAY_DISTANCE = 24 * core.FP;
  const TAU = Math.PI * 2;
  const zBuffer = new Int32Array(WIDTH);

  const bootLayer = document.querySelector("#bootLayer");
  const startButton = document.querySelector("#startButton");
  const seedInput = document.querySelector("#seedInput");
  const difficultySelect = document.querySelector("#difficultySelect");
  const pauseButton = document.querySelector("#pauseButton");
  const restartButton = document.querySelector("#restartButton");
  const soundButton = document.querySelector("#soundButton");
  const replayButton = document.querySelector("#replayButton");
  const fullscreenButton = document.querySelector("#fullscreenButton");
  const messageLayer = document.querySelector("#messageLayer");
  const messageKicker = document.querySelector("#messageKicker");
  const messageTitle = document.querySelector("#messageTitle");
  const messageBody = document.querySelector("#messageBody");
  const messageButton = document.querySelector("#messageButton");
  const pointerHint = document.querySelector("#pointerHint");
  const replayDialog = document.querySelector("#replayDialog");
  const replayText = document.querySelector("#replayText");
  const replayMeta = document.querySelector("#replayMeta");
  const copyReplayButton = document.querySelector("#copyReplayButton");
  const watchReplayButton = document.querySelector("#watchReplayButton");
  const missionReadout = document.querySelector("#missionReadout");
  const directiveReadout = document.querySelector("#directiveReadout");
  const enemyReadout = document.querySelector("#enemyReadout");
  const killMeter = document.querySelector("#killMeter");
  const modeReadout = document.querySelector("#modeReadout");
  const seedReadout = document.querySelector("#seedReadout");
  const tickReadout = document.querySelector("#tickReadout");
  const digestReadout = document.querySelector("#digestReadout");

  const keys = new Set();
  const touchActions = new Set();
  let tapActions = 0;
  let mouseTurn = 0;
  let mouseFire = false;
  let state = null;
  let recorder = null;
  let replay = null;
  let replayCursor = null;
  let mode = "standby";
  let paused = false;
  let accumulator = 0;
  let previousTime = 0;
  let lastTelemetryTick = -1;
  let automap = false;
  let flash = 0;
  let shake = 0;
  let notice = "";
  let noticeTicks = 0;
  let audio = null;

  const PALETTES = Object.freeze({
    copper: Object.freeze({ sky: "#161b1c", floor: "#262019", fog: "#090b0b", wall: ["#75543a", "#a06a3f", "#d09756", "#4d382b"], accent: "#e2a15c" }),
    ice: Object.freeze({ sky: "#121a20", floor: "#1b2529", fog: "#070a0c", wall: ["#41616b", "#61909a", "#93bdbe", "#273d46"], accent: "#b6e4d8" }),
    reactor: Object.freeze({ sky: "#190f12", floor: "#231a18", fog: "#090606", wall: ["#69352f", "#985442", "#ca8450", "#422324"], accent: "#f0b35d" }),
  });

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function isInteractiveTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement;
  }

  function shade(hex, factor) {
    const color = parseInt(hex.slice(1), 16);
    const r = clamp(Math.floor(((color >> 16) & 255) * factor), 0, 255);
    const g = clamp(Math.floor(((color >> 8) & 255) * factor), 0, 255);
    const b = clamp(Math.floor((color & 255) * factor), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  function createAudio() {
    let context = null;
    let enabled = false;
    let hum = null;
    let humGain = null;

    function ensure() {
      if (!context) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        context = new AudioContextClass();
      }
      if (context.state === "suspended") context.resume();
      return context;
    }

    function tone(frequency, duration, type, volume, slide) {
      if (!enabled) return;
      const ac = ensure();
      if (!ac) return;
      const now = ac.currentTime;
      const oscillator = ac.createOscillator();
      const gain = ac.createGain();
      oscillator.type = type || "square";
      oscillator.frequency.setValueAtTime(frequency, now);
      if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + slide), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(ac.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    }

    function noise(duration, volume, cutoff) {
      if (!enabled) return;
      const ac = ensure();
      if (!ac) return;
      const length = Math.floor(ac.sampleRate * duration);
      const buffer = ac.createBuffer(1, length, ac.sampleRate);
      const data = buffer.getChannelData(0);
      let value = 0x6d2b79f5;
      for (let i = 0; i < length; i += 1) {
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        data[i] = ((value >>> 0) / 0x80000000 - 1) * (1 - i / length);
      }
      const source = ac.createBufferSource();
      const gain = ac.createGain();
      const filter = ac.createBiquadFilter();
      source.buffer = buffer;
      gain.gain.value = volume;
      filter.type = "lowpass";
      filter.frequency.value = cutoff || 1400;
      filter.Q.value = 1.8;
      source.connect(filter).connect(gain).connect(ac.destination);
      source.start();
    }

    function startHum() {
      if (!enabled || hum) return;
      const ac = ensure();
      if (!ac) return;
      hum = ac.createOscillator();
      humGain = ac.createGain();
      hum.type = "sawtooth";
      hum.frequency.value = 54;
      humGain.gain.value = 0.012;
      hum.connect(humGain).connect(ac.destination);
      hum.start();
    }

    function stopHum() {
      if (hum) hum.stop();
      hum = null;
      humGain = null;
    }

    return {
      get enabled() { return enabled; },
      toggle() {
        enabled = !enabled;
        if (enabled) startHum();
        else stopHum();
        return enabled;
      },
      events(events) {
        for (const event of events) {
          if (event.type === "shot") {
            if (event.weapon === 0) {
              tone(178, 0.065, "square", 0.032, -96);
              tone(356, 0.045, "sine", 0.012, -160);
            } else if (event.weapon === 1) {
              noise(0.17, 0.13, 780);
              tone(52, 0.21, "sawtooth", 0.045, -22);
            } else {
              tone(88, 0.035, "sawtooth", 0.024, 95);
              noise(0.025, 0.018, 2400);
            }
          } else if (event.type === "enemy-fire") {
            const heavy = event.kind === "bulwark" || event.kind === "warden";
            tone(heavy ? 62 : 118, heavy ? 0.16 : 0.08, "sawtooth", heavy ? 0.035 : 0.018, heavy ? -18 : 45);
          } else if (event.type === "enemy-hit") tone(92, 0.04, "square", 0.018, 20);
          else if (event.type === "enemy-down") { noise(0.22, 0.11, 920); tone(64, 0.24, "sawtooth", 0.04, -25); }
          else if (event.type === "player-hit") { noise(0.14, 0.075, 680); tone(48, 0.2, "square", 0.04, -16); }
          else if (event.type === "pickup") tone(event.kind === "key" ? 880 : 620, 0.11, "square", 0.03, 180);
          else if (event.type === "door" || event.type === "unlock") tone(72, 0.24, "square", 0.025, 35);
          else if (event.type === "denied") tone(110, 0.12, "square", 0.03, -25);
          else if (event.type === "mission-complete" || event.type === "victory") {
            tone(220, 0.28, "square", 0.03, 220);
            window.setTimeout(() => tone(440, 0.35, "square", 0.03, 220), 170);
          }
        }
      },
      resetRun() {},
    };
  }

  function inputWord() {
    let actions = tapActions;
    tapActions = 0;
    const down = (code) => keys.has(code);
    if (down("KeyW") || down("ArrowUp")) actions |= core.INPUT.FORWARD;
    if (down("KeyS") || down("ArrowDown")) actions |= core.INPUT.BACK;
    if (down("KeyA") || down("ArrowLeft")) actions |= core.INPUT.TURN_LEFT;
    if (down("KeyD") || down("ArrowRight")) actions |= core.INPUT.TURN_RIGHT;
    if (down("KeyQ")) actions |= core.INPUT.STRAFE_LEFT;
    if (down("KeyE")) actions |= core.INPUT.STRAFE_RIGHT;
    if (down("Space") || mouseFire) actions |= core.INPUT.FIRE;
    if (down("KeyF") || down("Enter")) actions |= core.INPUT.USE;
    if (down("ShiftLeft") || down("ShiftRight")) actions |= core.INPUT.RUN;
    if (down("Digit1")) actions |= core.INPUT.WEAPON_1;
    if (down("Digit2")) actions |= core.INPUT.WEAPON_2;
    if (down("Digit3")) actions |= core.INPUT.WEAPON_3;
    for (const name of touchActions) actions |= core.INPUT[name] || 0;
    const turn = clamp(Math.trunc(mouseTurn), -64, 63);
    mouseTurn -= turn;
    return core.packInput(actions, turn);
  }

  function releaseInput() {
    keys.clear();
    touchActions.clear();
    tapActions = 0;
    mouseTurn = 0;
    mouseFire = false;
  }

  function startRun(seed, difficulty, runMode, decodedReplay) {
    state = core.createRun(seed, difficulty);
    mode = runMode || "live";
    recorder = mode === "live" ? core.createRecorder(state.seed, state.difficulty) : null;
    replay = decodedReplay || null;
    replayCursor = replay ? core.createReplayCursor(replay) : null;
    paused = false;
    accumulator = 0;
    previousTime = performance.now();
    automap = false;
    flash = 0;
    shake = 0;
    notice = "";
    noticeTicks = 0;
    releaseInput();
    if (audio) audio.resetRun();
    bootLayer.hidden = true;
    messageLayer.hidden = true;
    pauseButton.disabled = false;
    restartButton.disabled = false;
    replayButton.disabled = false;
    pauseButton.textContent = "PAUSE";
    updateTelemetry(true);
    canvas.focus();
  }

  function restartRun() {
    if (!state) return;
    startRun(state.seed, state.difficulty, "live", null);
  }

  function setPaused(value) {
    if (!state || state.gameOver || state.victory) return;
    paused = Boolean(value);
    pauseButton.textContent = paused ? "RESUME" : "PAUSE";
    if (paused) {
      releaseInput();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      showMessage("SYSTEM HALT", "PAUSED", "Fixed-tick simulation is frozen. Press P or resume.", "RESUME", () => setPaused(false));
    } else {
      messageLayer.hidden = true;
      previousTime = performance.now();
      canvas.focus();
    }
    updateTelemetry(true);
  }

  function showMessage(kicker, title, body, button, action) {
    messageKicker.textContent = kicker;
    messageTitle.textContent = title;
    messageBody.textContent = body;
    messageButton.textContent = button;
    messageButton.onclick = action;
    messageLayer.hidden = false;
  }

  function handleEvents(events) {
    if (audio) audio.events(events);
    for (const event of events) {
      if (event.type === "shot") {
        flash = Math.max(flash, event.weapon === 1 ? 7 : 4);
        shake = Math.max(shake, event.weapon === 1 ? 3 : 1);
        threeStage.pulse("shot", event.weapon === 1 ? 0.7 : 0.35);
      } else if (event.type === "enemy-hit") {
        notice = `${core.ENEMY_TYPES[event.kind].name} // ${event.health}`;
        noticeTicks = 30;
      } else if (event.type === "enemy-down") {
        notice = `${core.ENEMY_TYPES[event.kind].name} ERASED`;
        noticeTicks = 55;
        shake = Math.max(shake, event.kind === "warden" ? 8 : 4);
        threeStage.pulse("blast", event.kind === "warden" ? 1 : 0.65);
      } else if (event.type === "player-hit") {
        flash = Math.max(flash, 12);
        shake = Math.max(shake, 6);
        notice = `SUIT BREACH // -${event.amount}`;
        noticeTicks = 45;
        threeStage.pulse("impact", 0.85);
      } else if (event.type === "pickup") {
        notice = `RECOVERED // ${event.kind.toUpperCase()}`;
        noticeTicks = 70;
      } else if (event.type === "denied") {
        notice = event.reason;
        noticeTicks = 80;
      } else if (event.type === "secret") {
        notice = "UNLISTED SECTOR FOUND";
        noticeTicks = 90;
      } else if (event.type === "mission-complete") {
        showMessage("UPLINK CONFIRMED", "SECTOR CLEARED", `Mission ${event.index + 1} receipt accepted. Loading the next recovered disk sector…`, "CONTINUE", () => { messageLayer.hidden = true; });
      } else if (event.type === "mission") {
        messageLayer.hidden = true;
        notice = `${state.blueprint.code} // ${state.blueprint.directive}`;
        noticeTicks = 150;
      } else if (event.type === "game-over") {
        if (mode === "replay") {
          notice = "MARINE DOWN // LEDGER CONTINUES";
          noticeTicks = 90;
        } else {
          paused = true;
          releaseInput();
          showMessage("SIGNAL LOST", "MARINE DOWN", `Final score ${event.score}. State receipt ${core.stateDigest(state)}.`, "RESTART", restartRun);
        }
        updateTelemetry(true);
      } else if (event.type === "victory") {
        if (mode === "replay") {
          notice = "MASTER RECOVERED // LEDGER CONTINUES";
          noticeTicks = 90;
        } else {
          paused = true;
          releaseInput();
          showMessage("DISK FOUR TRANSMITTED", "MASTER RECOVERED", `The lost release is alive again. Score ${event.score}. Canonical state ${core.stateDigest(state)}.`, "PLAY AGAIN", restartRun);
        }
        updateTelemetry(true);
      }
    }
  }

  function simulationStep() {
    if (!state) return;
    let word;
    if (mode === "replay") {
      word = core.nextReplayInput(replayCursor);
      if (word === null) {
        paused = true;
        updateTelemetry(true);
        showMessage("REPLAY EOF", "RECEIPT COMPLETE", `Reproduced ${replay.ticks} ticks. Final state ${core.stateDigest(state)}.`, "NEW LIVE RUN", restartRun);
        return;
      }
    } else {
      word = inputWord();
      if (!core.tryRecordInput(recorder, word)) {
        paused = true;
        updateTelemetry(true);
        showMessage("RECORDER LIMIT", "SIX-HOUR CAP", "This run reached the bounded replay-recording limit.", "RESTART", restartRun);
        return;
      }
    }
    core.step(state, word);
    handleEvents(state.events);
    if (mode === "replay" && (state.gameOver || state.victory)) updateTelemetry(true);
    if (flash > 0) flash -= 1;
    if (shake > 0) shake -= 1;
    if (noticeTicks > 0) noticeTicks -= 1;
  }

  function raycast(stateObject, angle) {
    const p = stateObject.player;
    const dirX = core.cosAngle(angle);
    const dirY = core.sinAngle(angle);
    let previousTileX = Math.floor(p.x / core.FP);
    let previousTileY = Math.floor(p.y / core.FP);
    for (let distance = 40; distance < MAX_RAY_DISTANCE; distance += RAY_STEP) {
      const worldX = p.x + Math.trunc(dirX * distance / core.TRIG_SCALE);
      const worldY = p.y + Math.trunc(dirY * distance / core.TRIG_SCALE);
      const tileX = Math.floor(worldX / core.FP);
      const tileY = Math.floor(worldY / core.FP);
      if (core.isBlockingCell(stateObject, tileX, tileY)) {
        const cell = core.cellAt(stateObject, tileX, tileY);
        const localX = ((worldX % core.FP) + core.FP) % core.FP;
        const localY = ((worldY % core.FP) + core.FP) % core.FP;
        const vertical = tileX !== previousTileX;
        const texture = vertical ? localY : localX;
        return { distance, cell, texture, vertical, tileX, tileY };
      }
      previousTileX = tileX;
      previousTileY = tileY;
    }
    return { distance: MAX_RAY_DISTANCE, cell: "#", texture: 0, vertical: false, tileX: -1, tileY: -1 };
  }

  function wallColor(hit, palette, brightness, stripe) {
    let index = 0;
    if (hit.cell === "P") index = 1;
    else if (hit.cell === "B") index = 3;
    else if (hit.cell === "D" || hit.cell === "K") index = 2;
    else if (hit.cell === "S") index = 1;
    const base = palette.wall[index];
    const textureBand = ((hit.texture >> 7) + stripe) & 7;
    const textureFactor = textureBand === 0 || textureBand === 7 ? 1.18 : textureBand & 1 ? 0.86 : 1;
    return shade(base, brightness * textureFactor * (hit.vertical ? 1 : 0.78));
  }

  function drawWorld() {
    const palette = PALETTES[state.blueprint.palette] || PALETTES.copper;
    const horizon = 78 + Math.floor(Math.sin(state.player.bob / 64 * TAU) * 2);
    ctx.fillStyle = palette.sky;
    ctx.fillRect(0, 0, WIDTH, horizon);
    for (let y = 0; y < horizon; y += 4) {
      ctx.fillStyle = y & 8 ? "rgba(255,255,255,0.015)" : "rgba(0,0,0,0.02)";
      ctx.fillRect(0, y, WIDTH, 2);
    }
    ctx.fillStyle = palette.floor;
    ctx.fillRect(0, horizon, WIDTH, VIEW_HEIGHT - horizon);
    for (let y = horizon + 2; y < VIEW_HEIGHT; y += 4) {
      const factor = (y - horizon) / Math.max(1, VIEW_HEIGHT - horizon);
      ctx.fillStyle = `rgba(0,0,0,${0.08 + factor * 0.35})`;
      ctx.fillRect(0, y, WIDTH, 2);
    }

    for (let column = 0; column < WIDTH; column += 2) {
      const rayAngle = state.player.angle - Math.floor(FOV / 2) + Math.floor(column * FOV / WIDTH);
      const hit = raycast(state, rayAngle);
      const correction = Math.max(1, core.cosAngle(rayAngle - state.player.angle));
      const corrected = Math.max(40, Math.trunc(hit.distance * correction / core.TRIG_SCALE));
      const wallHeight = clamp(Math.floor(102 * core.FP / corrected), 1, VIEW_HEIGHT * 2);
      const top = Math.floor(horizon - wallHeight / 2);
      const brightness = clamp(1.2 - corrected / (12 * core.FP), 0.26, 1.1);
      ctx.fillStyle = wallColor(hit, palette, brightness, column >> 1);
      ctx.fillRect(column, top, 2, wallHeight);
      if (hit.cell === "D" || hit.cell === "K") {
        ctx.fillStyle = shade(palette.accent, brightness * 0.65);
        if (((hit.texture >> 6) & 3) === 0) ctx.fillRect(column, top, 2, wallHeight);
      }
      zBuffer[column] = corrected;
      zBuffer[column + 1] = corrected;
    }
  }

  function projectEntity(entity) {
    const dx = entity.x - state.player.x;
    const dy = entity.y - state.player.y;
    const angle = Math.atan2(dy, dx);
    const playerAngle = state.player.angle / core.ANGLE_MAX * TAU;
    let difference = angle - playerAngle;
    while (difference < -Math.PI) difference += TAU;
    while (difference > Math.PI) difference -= TAU;
    const halfFovRadians = FOV / core.ANGLE_MAX * TAU / 2;
    if (Math.abs(difference) > halfFovRadians * 1.25) return null;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const depth = Math.trunc((dx * core.cosAngle(state.player.angle) + dy * core.sinAngle(state.player.angle)) / core.TRIG_SCALE);
    if (depth <= 0) return null;
    const screenX = WIDTH / 2 + difference / halfFovRadians * WIDTH / 2;
    const size = clamp(74 * core.FP / depth, 3, 118);
    return { screenX, distance, depth, size };
  }

  function pixelRect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
  }

  function drawEnemySprite(enemy, projection) {
    const { screenX, depth, size } = projection;
    const left = Math.floor(screenX - size / 2);
    const top = Math.floor(80 - size * 0.62 + Math.sin((state.tick + enemy.phase) * 0.08) * 1.2);
    const centerColumn = clamp(Math.floor(screenX), 0, WIDTH - 1);
    if (depth > zBuffer[centerColumn] + 140) return;
    const type = enemy.kind;
    const pain = enemy.pain > 0;
    const base = pain ? "#f4d8a1" : type === "warden" ? "#893c38" : type === "bulwark" ? "#80604b" : type === "specter" ? "#567e78" : type === "drone" ? "#5b978c" : type === "trooper" ? "#9b6542" : "#677c6e";
    const dark = pain ? "#9d443b" : "#1a2522";
    const eye = type === "warden" ? "#ffd269" : "#dd6a4c";
    pixelRect(left + size * 0.28, top + size * 0.08, size * 0.44, size * 0.26, dark);
    pixelRect(left + size * 0.2, top + size * 0.25, size * 0.6, size * 0.48, base);
    pixelRect(left + size * 0.1, top + size * 0.32, size * 0.18, size * 0.34, dark);
    pixelRect(left + size * 0.72, top + size * 0.32, size * 0.18, size * 0.34, dark);
    pixelRect(left + size * 0.26, top + size * 0.72, size * 0.18, size * 0.25, dark);
    pixelRect(left + size * 0.56, top + size * 0.72, size * 0.18, size * 0.25, dark);
    pixelRect(left + size * 0.36, top + size * 0.15, size * 0.08, size * 0.06, eye);
    pixelRect(left + size * 0.56, top + size * 0.15, size * 0.08, size * 0.06, eye);
    if (type === "drone") {
      pixelRect(left + size * 0.03, top + size * 0.38, size * 0.94, size * 0.1, base);
      pixelRect(left + size * 0.43, top + size * 0.1, size * 0.14, size * 0.7, dark);
    }
    if (type === "specter") {
      pixelRect(left + size * 0.12, top + size * 0.2, size * 0.76, size * 0.1, "#2c3d3b");
      pixelRect(left + size * 0.2, top + size * 0.62, size * 0.18, size * 0.28, dark);
      pixelRect(left + size * 0.62, top + size * 0.62, size * 0.18, size * 0.28, dark);
      pixelRect(left + size * 0.72, top + size * 0.06, size * 0.08, size * 0.48, "#a6c8b4");
    }
    if (type === "bulwark") {
      pixelRect(left + size * 0.02, top + size * 0.2, size * 0.28, size * 0.62, "#49372e");
      pixelRect(left + size * 0.7, top + size * 0.2, size * 0.28, size * 0.62, "#49372e");
      pixelRect(left + size * 0.18, top + size * 0.4, size * 0.64, size * 0.16, "#bc8352");
    }
    if (type === "warden") {
      pixelRect(left + size * 0.06, top + size * 0.2, size * 0.18, size * 0.6, "#512b2c");
      pixelRect(left + size * 0.76, top + size * 0.2, size * 0.18, size * 0.6, "#512b2c");
      const healthWidth = Math.max(1, Math.floor(size * enemy.health / enemy.maxHealth));
      pixelRect(left, top - 4, size, 2, "#301313");
      pixelRect(left, top - 4, healthWidth, 2, "#e09a57");
    }
    if (enemy.muzzle > 0) {
      const flare = Math.max(2, size * 0.16);
      pixelRect(left + size * 0.5 - flare / 2, top + size * 0.08, flare, flare * 0.45, "#ffd477");
    }
  }

  function drawPickupSprite(pickup, projection) {
    const { screenX, depth, size } = projection;
    const actualSize = Math.max(3, size * 0.42);
    const x = screenX - actualSize / 2;
    const y = 80 + size * 0.2 + Math.sin((state.tick + pickup.phase) * 0.09) * 2;
    const centerColumn = clamp(Math.floor(screenX), 0, WIDTH - 1);
    if (depth > zBuffer[centerColumn] + 120) return;
    const colors = {
      medkit: "#d7d1ad", armor: "#4f9b8d", cells: "#dd9b4f", shells: "#b05942",
      breach: "#8d5b3c", vulcan: "#7b897d", key: "#f0c764", archive: "#d7be83",
    };
    const color = colors[pickup.kind] || "#d7d1ad";
    pixelRect(x, y, actualSize, actualSize * 0.65, "#111817");
    pixelRect(x + actualSize * 0.15, y + actualSize * 0.12, actualSize * 0.7, actualSize * 0.42, color);
    if (pickup.kind === "medkit") {
      pixelRect(x + actualSize * 0.42, y + actualSize * 0.17, actualSize * 0.16, actualSize * 0.32, "#9c4037");
      pixelRect(x + actualSize * 0.32, y + actualSize * 0.27, actualSize * 0.36, actualSize * 0.12, "#9c4037");
    }
  }

  function drawExitSprite(exit, projection) {
    const { screenX, depth, size } = projection;
    const actualSize = Math.max(7, size * 0.68);
    const left = screenX - actualSize / 2;
    const top = 80 - actualSize * 0.38;
    const centerColumn = clamp(Math.floor(screenX), 0, WIDTH - 1);
    if (depth > zBuffer[centerColumn] + 120) return;
    const sealed = Boolean(core.missionObjectiveDenial(state));
    pixelRect(left, top, actualSize, actualSize * 0.86, "#111817");
    pixelRect(left + actualSize * 0.14, top + actualSize * 0.1, actualSize * 0.72, actualSize * 0.58, sealed ? "#71372f" : "#4f8f7f");
    pixelRect(left + actualSize * 0.25, top + actualSize * 0.19, actualSize * 0.5, actualSize * 0.23, sealed ? "#c06145" : "#afe2bd");
    pixelRect(left + actualSize * 0.38, top + actualSize * 0.71, actualSize * 0.24, actualSize * 0.1, "#c68c51");
  }

  function drawEntities() {
    const entries = [];
    for (const enemy of state.enemies) {
      const projection = projectEntity(enemy);
      if (projection) entries.push({ kind: "enemy", entity: enemy, projection });
    }
    for (const pickup of state.pickups) {
      const projection = projectEntity(pickup);
      if (projection) entries.push({ kind: "pickup", entity: pickup, projection });
    }
    const exit = {
      x: state.blueprint.exit.x * core.FP + core.FP / 2,
      y: state.blueprint.exit.y * core.FP + core.FP / 2,
    };
    const exitProjection = projectEntity(exit);
    if (exitProjection) entries.push({ kind: "exit", entity: exit, projection: exitProjection });
    entries.sort((a, b) => b.projection.depth - a.projection.depth);
    for (const entry of entries) {
      if (entry.kind === "enemy") drawEnemySprite(entry.entity, entry.projection);
      else if (entry.kind === "pickup") drawPickupSprite(entry.entity, entry.projection);
      else drawExitSprite(entry.entity, entry.projection);
    }
  }

  function drawWeapon() {
    const p = state.player;
    const bobX = Math.sin(p.bob / 64 * TAU) * 3;
    const bobY = Math.abs(Math.cos(p.bob / 64 * TAU)) * 2;
    const recoil = Math.max(0, p.cooldown > core.WEAPONS[p.weapon].gap - 6 ? 5 : 0);
    const center = WIDTH / 2 + bobX;
    const bottom = VIEW_HEIGHT + bobY + recoil;
    const metal = p.weapon === 2 ? "#586962" : p.weapon === 1 ? "#74523a" : "#455750";
    pixelRect(center - 30, bottom - 21, 60, 22, "#121817");
    pixelRect(center - 20, bottom - 35, 40, 22, metal);
    pixelRect(center - 9, bottom - 45, 18, 24, "#202b28");
    pixelRect(center - 5, bottom - 46, 10, 12, "#0a0d0c");
    if (p.weapon === 1) {
      pixelRect(center - 21, bottom - 43, 17, 18, "#3b2d25");
      pixelRect(center + 4, bottom - 43, 17, 18, "#3b2d25");
    } else if (p.weapon === 2) {
      const spin = state.tick & 3;
      pixelRect(center - 15 + spin, bottom - 49, 6, 20, "#273631");
      pixelRect(center - 3, bottom - 52 + spin, 6, 23, "#273631");
      pixelRect(center + 9 - spin, bottom - 49, 6, 20, "#273631");
      pixelRect(center - 25, bottom - 30, 8, 11, "#9a7147");
    } else {
      pixelRect(center - 13, bottom - 40, 7, 12, "#8ca493");
      pixelRect(center + 6, bottom - 40, 7, 12, "#8ca493");
      pixelRect(center - 3, bottom - 54, 6, 14, "#c99855");
    }
    if (state.tick - state.lastShotTick < 3) {
      pixelRect(center - 8, bottom - 57, 16, 10, "#f5d27a");
      pixelRect(center - 3, bottom - 65, 6, 9, "#fff1ad");
    }
  }

  function drawHud() {
    const p = state.player;
    const weapon = core.WEAPONS[p.weapon];
    ctx.fillStyle = "#101614";
    ctx.fillRect(0, HUD_TOP, WIDTH, HEIGHT - HUD_TOP);
    ctx.fillStyle = "#303a34";
    ctx.fillRect(0, HUD_TOP, WIDTH, 2);
    ctx.fillStyle = "#0a0e0d";
    ctx.fillRect(4, 165, 68, 30);
    ctx.fillRect(77, 165, 55, 30);
    ctx.fillRect(137, 165, 80, 30);
    ctx.fillRect(222, 165, 94, 30);
    ctx.font = "7px monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#b8b89c";
    ctx.fillText("VITAL", 8, 168);
    ctx.fillText("ARMOR", 81, 168);
    ctx.fillText("WEAPON", 141, 168);
    ctx.fillText("SCORE", 226, 168);
    ctx.font = "bold 13px monospace";
    ctx.fillStyle = p.health < 30 ? "#d75d48" : "#e8dcae";
    ctx.fillText(String(p.health).padStart(3, "0"), 8, 178);
    ctx.fillStyle = "#77a99a";
    ctx.fillText(String(p.armor).padStart(3, "0"), 81, 178);
    ctx.fillStyle = "#e3a25c";
    const ammo = weapon.ammo ? p[weapon.ammo] : "∞";
    ctx.fillText(`${p.weapon + 1}:${String(ammo).padStart(3, "0")}`, 141, 178);
    ctx.fillStyle = "#ddd7b7";
    ctx.fillText(String(state.score).padStart(7, "0"), 226, 178);
    ctx.font = "6px monospace";
    ctx.fillStyle = "#78847b";
    ctx.fillText(`${state.blueprint.code} // ${weapon.name}`, 5, 197 - 7);
    ctx.textAlign = "right";
    ctx.fillText(`K:${p.keys} A:${state.stats.archives}`, 315, 190);
    ctx.textAlign = "left";
  }

  function drawCrosshair() {
    ctx.fillStyle = "rgba(230,220,180,0.72)";
    ctx.fillRect(WIDTH / 2 - 6, 79, 4, 1);
    ctx.fillRect(WIDTH / 2 + 3, 79, 4, 1);
    ctx.fillRect(WIDTH / 2, 74, 1, 4);
    ctx.fillRect(WIDTH / 2, 81, 1, 4);
  }

  function drawAutomap() {
    const scale = 6;
    const mapWidth = state.blueprint.width * scale;
    const mapHeight = state.blueprint.height * scale;
    const left = Math.floor((WIDTH - mapWidth) / 2);
    const top = Math.floor((VIEW_HEIGHT - mapHeight) / 2);
    ctx.fillStyle = "rgba(4,7,6,0.92)";
    ctx.fillRect(left - 6, top - 6, mapWidth + 12, mapHeight + 12);
    for (let y = 0; y < state.blueprint.height; y += 1) {
      for (let x = 0; x < state.blueprint.width; x += 1) {
        const cell = core.cellAt(state, x, y);
        if ("#PB".includes(cell)) ctx.fillStyle = "#37443e";
        else if (cell === "D" || cell === "K") ctx.fillStyle = "#b57243";
        else if (cell === "S") ctx.fillStyle = "#776242";
        else ctx.fillStyle = "#111815";
        ctx.fillRect(left + x * scale, top + y * scale, scale - 1, scale - 1);
      }
    }
    ctx.fillStyle = "#d45b48";
    for (const enemy of state.enemies) ctx.fillRect(left + enemy.x / core.FP * scale - 1, top + enemy.y / core.FP * scale - 1, 3, 3);
    ctx.fillStyle = "#65b29c";
    ctx.fillRect(left + state.blueprint.exit.x * scale + 1, top + state.blueprint.exit.y * scale + 1, 3, 3);
    const px = left + state.player.x / core.FP * scale;
    const py = top + state.player.y / core.FP * scale;
    ctx.fillStyle = "#e8d27d";
    ctx.fillRect(px - 2, py - 2, 4, 4);
    ctx.strokeStyle = "#e8d27d";
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + core.cosAngle(state.player.angle) / core.TRIG_SCALE * 7, py + core.sinAngle(state.player.angle) / core.TRIG_SCALE * 7);
    ctx.stroke();
    ctx.font = "7px monospace";
    ctx.fillStyle = "#d6d1af";
    ctx.fillText("TACTICAL GRID // HOLD TAB", left, top - 11);
  }

  function drawNotice() {
    if (noticeTicks <= 0 || !notice) return;
    ctx.font = "bold 7px monospace";
    const width = ctx.measureText(notice).width + 12;
    ctx.fillStyle = "rgba(5,8,7,0.76)";
    ctx.fillRect(Math.floor((WIDTH - width) / 2), 8, width, 13);
    ctx.fillStyle = "#e4d69f";
    ctx.textAlign = "center";
    ctx.fillText(notice, WIDTH / 2, 11);
    ctx.textAlign = "left";
  }

  function drawStandby() {
    ctx.fillStyle = "#080b0b";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (let y = 0; y < HEIGHT; y += 4) {
      ctx.fillStyle = y & 4 ? "#0b100f" : "#070a09";
      ctx.fillRect(0, y, WIDTH, 2);
    }
    ctx.fillStyle = "#5d6b63";
    ctx.font = "8px monospace";
    ctx.fillText("BLACKSTAR RECOVERY MONITOR", 8, 12);
    ctx.fillStyle = "#c07b48";
    ctx.fillText("WAITING FOR MASTER BOOT…", 8, 25);
  }

  function render() {
    if (!state) {
      drawStandby();
      threeStage.render({ tick: 0, activity: 0.08 });
      return;
    }
    const offsetX = shake > 0 ? ((state.tick * 13) % (shake * 2 + 1)) - shake : 0;
    const offsetY = shake > 0 ? ((state.tick * 7) % (Math.max(1, shake) + 1)) - Math.floor(shake / 2) : 0;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    drawWorld();
    drawEntities();
    drawWeapon();
    drawCrosshair();
    drawHud();
    if (automap) drawAutomap();
    drawNotice();
    ctx.restore();

    if (state.player.hurt > 0) {
      ctx.fillStyle = `rgba(150,30,25,${state.player.hurt / 42})`;
      ctx.fillRect(0, 0, WIDTH, VIEW_HEIGHT);
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,224,142,${flash / 30})`;
      ctx.fillRect(0, 0, WIDTH, VIEW_HEIGHT);
    }
    if (paused) {
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    threeStage.render({
      tick: state.tick,
      speed: Math.hypot(state.player.vx || 0, state.player.vy || 0) / core.FP,
      danger: 1 - state.player.health / 100,
      activity: Math.max(flash / 12, state.enemies.length ? 0.28 : 0.08),
      heading: state.player.angle / core.ANGLE_MAX * TAU,
    });
  }

  function updateTelemetry(force) {
    if (!state) return;
    if (!force && state.tick === lastTelemetryTick) return;
    if (!force && state.tick % 12 !== 0) return;
    lastTelemetryTick = state.tick;
    missionReadout.textContent = `${state.missionIndex + 1}. ${state.blueprint.name}`;
    directiveReadout.textContent = state.blueprint.directive;
    enemyReadout.textContent = `${state.enemies.length} / ${state.totalLevelEnemies}`;
    const defeated = state.totalLevelEnemies - state.enemies.length;
    killMeter.style.width = `${state.totalLevelEnemies ? defeated / state.totalLevelEnemies * 100 : 0}%`;
    if (mode === "replay") {
      const replayTick = replayCursor ? replayCursor.tick : 0;
      const replayTicks = replay ? replay.ticks : 0;
      if (paused && replayTick >= replayTicks) modeReadout.textContent = `REPLAY COMPLETE ${replayTick}/${replayTicks}`;
      else if (paused) modeReadout.textContent = `REPLAY PAUSED ${replayTick}/${replayTicks}`;
      else modeReadout.textContent = `REPLAY ${replayTick}/${replayTicks}`;
    } else if (state.victory) modeReadout.textContent = "VICTORY";
    else if (state.gameOver) modeReadout.textContent = "GAME OVER";
    else modeReadout.textContent = paused ? "PAUSED" : "LIVE INPUT";
    seedReadout.textContent = core.seedHex(state.seed);
    tickReadout.textContent = String(state.tick);
    digestReadout.textContent = core.stateDigest(state);
  }

  function frame(time) {
    if (!previousTime) previousTime = time;
    const elapsed = Math.min(250, time - previousTime);
    previousTime = time;
    if (state && !paused && !replayDialog.open) {
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= TICK_MS && steps < MAX_FRAME_STEPS && !paused) {
        simulationStep();
        accumulator -= TICK_MS;
        steps += 1;
      }
      if (steps >= MAX_FRAME_STEPS) accumulator = 0;
    }
    render();
    updateTelemetry(false);
    requestAnimationFrame(frame);
  }

  function openReplayDialog() {
    if (!state) return;
    releaseInput();
    if (mode === "live" && recorder) {
      replayText.value = core.encodeReplay(recorder);
      replayMeta.textContent = `${recorder.ticks} ticks // seed ${core.seedHex(recorder.seed)} // state ${core.stateDigest(state)}`;
    } else if (replay) {
      replayText.value = core.encodeReplay({ version: replay.version, seed: replay.seed, difficulty: replay.difficulty, ticks: replay.ticks, runs: replay.runs.map((run) => run.slice()) });
      replayMeta.textContent = `${replayCursor.tick}/${replay.ticks} replay ticks // state ${core.stateDigest(state)}`;
    }
    replayDialog.showModal();
  }

  startButton.addEventListener("click", () => {
    startRun(seedInput.value, Number(difficultySelect.value), "live", null);
  });

  pauseButton.addEventListener("click", () => setPaused(!paused));
  restartButton.addEventListener("click", restartRun);
  replayButton.addEventListener("click", openReplayDialog);
  soundButton.addEventListener("click", () => {
    if (!audio) audio = createAudio();
    const enabled = audio.toggle();
    soundButton.textContent = enabled ? "AUDIO: ON" : "AUDIO: OFF";
    soundButton.setAttribute("aria-pressed", String(enabled));
  });
  fullscreenButton.addEventListener("click", () => {
    const machine = document.querySelector(".machine");
    if (!document.fullscreenElement) machine.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  });
  copyReplayButton.addEventListener("click", async () => {
    replayText.select();
    try {
      await navigator.clipboard.writeText(replayText.value);
      replayMeta.textContent = "Receipt copied to clipboard.";
    } catch (_error) {
      document.execCommand("copy");
      replayMeta.textContent = "Receipt selected for copying.";
    }
  });
  watchReplayButton.addEventListener("click", () => {
    try {
      const decoded = core.decodeReplay(replayText.value);
      replayDialog.close();
      startRun(decoded.seed, decoded.difficulty, "replay", decoded);
    } catch (error) {
      replayMeta.textContent = `Rejected: ${error.message}`;
    }
  });

  window.addEventListener("keydown", (event) => {
    if (isInteractiveTarget(event.target)) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(event.code)) event.preventDefault();
    if (event.code === "KeyP" && !event.repeat) {
      setPaused(!paused);
      return;
    }
    if (event.code === "Tab") automap = true;
    keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
    if (event.code === "Tab") automap = false;
  });
  window.addEventListener("blur", releaseInput);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state && !paused) setPaused(true);
  });

  canvas.addEventListener("click", () => {
    canvas.focus();
    if (state && !paused && canvas.requestPointerLock) canvas.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => {
    pointerHint.classList.toggle("hidden", document.pointerLockElement === canvas || !state);
  });
  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement === canvas && state && !paused) mouseTurn += event.movementX * 0.42;
  });
  canvas.addEventListener("mousedown", (event) => {
    if (event.button === 0 && document.pointerLockElement === canvas) mouseFire = true;
  });
  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) mouseFire = false;
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  for (const button of document.querySelectorAll("[data-hold]")) {
    const action = button.dataset.hold;
    const begin = (event) => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); touchActions.add(action); };
    const end = (event) => { event.preventDefault(); touchActions.delete(action); };
    button.addEventListener("pointerdown", begin);
    button.addEventListener("pointerup", end);
    button.addEventListener("pointercancel", end);
    button.addEventListener("lostpointercapture", end);
  }
  for (const button of document.querySelectorAll("[data-tap]")) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      tapActions |= core.INPUT[button.dataset.tap] || 0;
    });
  }

  replayDialog.addEventListener("close", () => {
    releaseInput();
    previousTime = performance.now();
  });

  window.blackstarAGA = Object.freeze({
    get state() { return state; },
    get mode() { return mode; },
    get paused() { return paused; },
    get recorder() { return recorder; },
    get replayTick() { return replayCursor ? replayCursor.tick : null; },
    start: startRun,
    restart: restartRun,
    project(entity) { return state && entity ? projectEntity(entity) : null; },
    digest() { return state ? core.stateDigest(state) : null; },
  });

  audio = createAudio();
  drawStandby();
  requestAnimationFrame(frame);
})();
