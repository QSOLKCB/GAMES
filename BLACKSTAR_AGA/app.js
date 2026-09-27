(function () {
  "use strict";

  const core = window.BlackstarCore;
  const canvas = document.querySelector("#game");
  const presentation = new window.BlackstarRenderer(canvas, core);
  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const TICK_MS = 1000 / core.TICK_RATE;
  const MAX_FRAME_STEPS = 8;
  const FOV = 11264;
  const TAU = Math.PI * 2;

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
      } else if (event.type === "enemy-hit") {
        notice = `${core.ENEMY_TYPES[event.kind].name} // ${event.health}`;
        noticeTicks = 30;
      } else if (event.type === "enemy-down") {
        notice = `${core.ENEMY_TYPES[event.kind].name} ERASED`;
        noticeTicks = 55;
        shake = Math.max(shake, event.kind === "warden" ? 8 : 4);
      } else if (event.type === "player-hit") {
        flash = Math.max(flash, 12);
        shake = Math.max(shake, 6);
        notice = `SUIT BREACH // -${event.amount}`;
        noticeTicks = 45;
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

  function render() {
    presentation.render(state, { automap, paused, notice: noticeTicks > 0 ? notice : "", palette: state ? PALETTES[state.blueprint.palette] || PALETTES.copper : PALETTES.copper });
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
  render();
  requestAnimationFrame(frame);
})();
