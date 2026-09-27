(function () {
  "use strict";

  const core = window.CartridgeZeroCore;
  const canvas = document.querySelector("#game");
  const presentation = new window.CartridgeRenderer(canvas, core);
  const TICK_MS = 1000 / core.TICK_RATE;
  const MAX_FRAME_STEPS = 8;

  const bootLayer = document.querySelector("#bootLayer");
  const gameGrid = document.querySelector("#gameGrid");
  const seedInput = document.querySelector("#seedInput");
  const difficultySelect = document.querySelector("#difficultySelect");
  const startButton = document.querySelector("#startButton");
  const selectedTitle = document.querySelector("#selectedTitle");
  const selectedTagline = document.querySelector("#selectedTagline");
  const cartridgeLabel = document.querySelector("#cartridgeLabel");
  const cartridgeCode = document.querySelector("#cartridgeCode");
  const resetButton = document.querySelector("#resetButton");
  const selectButton = document.querySelector("#selectButton");
  const pauseButton = document.querySelector("#pauseButton");
  const soundButton = document.querySelector("#soundButton");
  const colorButton = document.querySelector("#colorButton");
  const replayButton = document.querySelector("#replayButton");
  const fullscreenButton = document.querySelector("#fullscreenButton");
  const gameReadout = document.querySelector("#gameReadout");
  const scoreReadout = document.querySelector("#scoreReadout");
  const livesReadout = document.querySelector("#livesReadout");
  const levelReadout = document.querySelector("#levelReadout");
  const seedReadout = document.querySelector("#seedReadout");
  const tickReadout = document.querySelector("#tickReadout");
  const digestReadout = document.querySelector("#digestReadout");
  const modeReadout = document.querySelector("#modeReadout");
  const controlHint = document.querySelector("#controlHint");
  const notice = document.querySelector("#notice");
  const messageLayer = document.querySelector("#messageLayer");
  const messageKicker = document.querySelector("#messageKicker");
  const messageTitle = document.querySelector("#messageTitle");
  const messageBody = document.querySelector("#messageBody");
  const messageButton = document.querySelector("#messageButton");
  const replayDialog = document.querySelector("#replayDialog");
  const replayText = document.querySelector("#replayText");
  const replayMeta = document.querySelector("#replayMeta");
  const copyReplayButton = document.querySelector("#copyReplayButton");
  const watchReplayButton = document.querySelector("#watchReplayButton");

  const PALETTES = Object.freeze({
    "prism-break": Object.freeze({ bg: "#090807", main: "#e8c477", secondary: "#b35d3d", cool: "#6d9b91", dim: "#3a3025", bands: ["#a94e32", "#c9773d", "#d8a653", "#8ca06c", "#5f8f8c", "#826f9b"] }),
    gridburn: Object.freeze({ bg: "#040a09", main: "#85d0b4", secondary: "#df9b4d", cool: "#4f8982", dim: "#193b36" }),
    "orbital-siege": Object.freeze({ bg: "#07090d", main: "#b6c8a4", secondary: "#d87c4b", cool: "#668c9d", dim: "#27343a" }),
    "star-talon": Object.freeze({ bg: "#0b0709", main: "#e2b46d", secondary: "#a95c63", cool: "#718e98", dim: "#39272b" }),
    "rift-runner": Object.freeze({ bg: "#07100f", main: "#e6c57a", secondary: "#bf6343", cool: "#5f928c", dim: "#203832" }),
    "iron-circuit": Object.freeze({ bg: "#0b0a08", main: "#d5b36c", secondary: "#a94f37", cool: "#718679", dim: "#423b2b" }),
    "skywater-command": Object.freeze({ bg: "#070b10", main: "#d8bd78", secondary: "#b95e45", cool: "#668e9a", dim: "#263945" }),
  });

  const CONTROL_HINTS = Object.freeze({
    "prism-break": "LEFT / RIGHT MOVE · FIRE SERVES",
    gridburn: "LEFT / RIGHT LANE · UP / DOWN DEPTH · FIRE",
    "orbital-siege": "LEFT / RIGHT MOVE · FIRE",
    "star-talon": "LEFT / RIGHT MOVE · FIRE",
    "rift-runner": "STEER · UP / DOWN THROTTLE · FIRE",
    "iron-circuit": "LEFT / RIGHT TURN · UP / DOWN DRIVE · FIRE",
    "skywater-command": "LEFT / RIGHT AIM · FIRE",
  });

  const keys = new Set();
  const touchActions = new Set();
  let selectedGameId = core.GAMES[0].id;
  let state = null;
  let recorder = null;
  let replay = null;
  let replayCursor = null;
  let mode = "standby";
  let paused = false;
  let accumulator = 0;
  let previousTime = 0;
  let lastTelemetryTick = -1;
  let noticeTicks = 0;
  let monochrome = false;
  let audio = null;

  function gameDefinition(id) {
    return core.GAMES.find((game) => game.id === id) || core.GAMES[0];
  }

  function logical(value) {
    return Math.round(value / core.FP);
  }

  function createAudio() {
    let context = null;
    let enabled = false;
    let noiseState = 0x51a7c0de;

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
      if (slide) oscillator.frequency.linearRampToValueAtTime(Math.max(24, frequency + slide), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(ac.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    }

    function noise(duration, volume) {
      if (!enabled) return;
      const ac = ensure();
      if (!ac) return;
      const length = Math.max(1, Math.floor(ac.sampleRate * duration));
      const buffer = ac.createBuffer(1, length, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) {
        noiseState ^= noiseState << 13;
        noiseState ^= noiseState >>> 17;
        noiseState ^= noiseState << 5;
        data[index] = ((noiseState >>> 0) / 0x80000000 - 1) * (1 - index / length);
      }
      const source = ac.createBufferSource();
      const gain = ac.createGain();
      source.buffer = buffer;
      gain.gain.value = volume;
      source.connect(gain).connect(ac.destination);
      source.start();
    }

    return {
      reset(seed) { noiseState = seed >>> 0 || 0x51a7c0de; },
      toggle() { enabled = !enabled; if (enabled) { ensure(); tone(110, 0.08, "square", 0.025, 80); } return enabled; },
      events(events) {
        for (const event of events) {
          if (event.type === "shot" && event.owner === "player") tone(170, 0.045, "square", 0.025, 120);
          else if (event.type === "shot") tone(82, 0.055, "square", 0.018, -25);
          else if (["brick", "target"].includes(event.type)) tone(240, 0.065, "square", 0.03, 90);
          else if (["bounce", "paddle", "march"].includes(event.type)) tone(78, 0.035, "square", 0.012, 12);
          else if (event.type === "fuel") tone(138, 0.16, "triangle", 0.03, 180);
          else if (event.type === "level") { tone(130, 0.18, "square", 0.03, 220); tone(260, 0.2, "triangle", 0.02, 160); }
          else if (event.type === "life-lost") { noise(0.16, 0.08); tone(92, 0.22, "sawtooth", 0.035, -55); }
          else if (["game-over", "round-end"].includes(event.type)) tone(70, 0.5, "sawtooth", 0.035, -35);
        }
      },
    };
  }

  function setSelectedGame(gameId) {
    selectedGameId = core.normalizeGame(gameId);
    const definition = gameDefinition(selectedGameId);
    selectedTitle.textContent = definition.name;
    selectedTagline.textContent = definition.tagline;
    cartridgeLabel.textContent = definition.name;
    cartridgeCode.textContent = `CZ-${String(definition.number).padStart(2, "0")}`;
    for (const button of gameGrid.querySelectorAll("button")) {
      const selected = button.dataset.game === selectedGameId;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
  }

  function buildGameGrid() {
    for (const game of core.GAMES) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.game = game.id;
      button.innerHTML = `<span>${String(game.number).padStart(2, "0")}</span><strong>${game.name}</strong><small>${game.tagline}</small>`;
      button.addEventListener("click", () => setSelectedGame(game.id));
      gameGrid.appendChild(button);
    }
    setSelectedGame(selectedGameId);
  }

  function releaseInput() {
    keys.clear();
    touchActions.clear();
    document.querySelectorAll("[data-action].active").forEach((button) => button.classList.remove("active"));
  }

  function inputWord() {
    const active = (action, codes) => touchActions.has(action) || codes.some((code) => keys.has(code));
    let word = 0;
    if (active("left", ["ArrowLeft", "KeyA"])) word |= core.INPUT.LEFT;
    if (active("right", ["ArrowRight", "KeyD"])) word |= core.INPUT.RIGHT;
    if (active("up", ["ArrowUp", "KeyW"])) word |= core.INPUT.UP;
    if (active("down", ["ArrowDown", "KeyS"])) word |= core.INPUT.DOWN;
    if (active("fire", ["Space", "KeyZ"])) word |= core.INPUT.FIRE;
    if (active("second", ["KeyX", "ShiftLeft", "ShiftRight"])) word |= core.INPUT.SECOND;
    return word;
  }

  function showNotice(text, ticks) {
    notice.textContent = text;
    notice.hidden = false;
    noticeTicks = ticks || 90;
  }

  function hideNotice() {
    notice.hidden = true;
    noticeTicks = 0;
  }

  function showMessage(kicker, title, body, buttonText, callback) {
    messageKicker.textContent = kicker;
    messageTitle.textContent = title;
    messageBody.textContent = body;
    messageButton.textContent = buttonText;
    messageButton.onclick = callback;
    messageLayer.hidden = false;
  }

  function hideMessage() {
    messageLayer.hidden = true;
  }

  function restoreGameplayFocus() {
    if (state && mode !== "standby" && !replayDialog.open) canvas.focus();
  }

  function setPaused(value) {
    if (!state || mode === "standby") return;
    const liveRunEnded = mode === "live" && (state.gameOver || state.victory);
    const replayEnded = mode === "replay" && replayCursor && replayCursor.tick >= replay.ticks;
    if (liveRunEnded || replayEnded) return;
    paused = Boolean(value);
    releaseInput();
    pauseButton.textContent = paused ? "RESUME" : "PAUSE";
    if (paused) showMessage("CONSOLE HOLD", "PAUSED", "The canonical clock is frozen between ticks.", "RESUME", () => setPaused(false));
    else { hideMessage(); restoreGameplayFocus(); }
    updateTelemetry(true);
  }

  function startRun(gameId, seed, difficulty, requestedMode, replayObject) {
    selectedGameId = core.normalizeGame(gameId);
    state = core.createRun(selectedGameId, seed, difficulty);
    mode = requestedMode || "live";
    replay = replayObject || null;
    replayCursor = replay ? core.createReplayCursor(replay) : null;
    recorder = mode === "live" ? core.createRecorder(selectedGameId, state.seed, state.difficulty) : null;
    paused = false;
    accumulator = 0;
    previousTime = performance.now();
    lastTelemetryTick = -1;
    bootLayer.hidden = true;
    messageLayer.hidden = true;
    pauseButton.disabled = false;
    resetButton.disabled = false;
    replayButton.disabled = false;
    pauseButton.textContent = "PAUSE";
    const definition = gameDefinition(selectedGameId);
    cartridgeLabel.textContent = definition.name;
    cartridgeCode.textContent = `CZ-${String(definition.number).padStart(2, "0")}`;
    controlHint.textContent = CONTROL_HINTS[selectedGameId];
    audio.reset(state.seed ^ state.tick);
    hideNotice();
    updateTelemetry(true);
    canvas.focus();
  }

  function resetRun() {
    if (!state) return;
    startRun(state.gameId, state.seed, state.difficulty, "live", null);
  }

  function returnToMenu() {
    releaseInput();
    paused = true;
    mode = "standby";
    state = null;
    recorder = null;
    replay = null;
    replayCursor = null;
    bootLayer.hidden = false;
    messageLayer.hidden = true;
    pauseButton.disabled = true;
    resetButton.disabled = true;
    replayButton.disabled = false;
    setSelectedGame(selectedGameId);
    updateTelemetry(true);
  }

  function finishReplay() {
    paused = true;
    releaseInput();
    const digest = core.stateDigest(state);
    showMessage("LEDGER EOF", "RECEIPT COMPLETE", `${gameDefinition(state.gameId).name} reproduced ${replay.ticks} ticks. Canonical state ${digest}.`, "SELECT GAME", returnToMenu);
    updateTelemetry(true);
  }

  function processEvents(events) {
    audio.events(events);
    for (const event of events) {
      if (["shot", "brick", "target", "impact", "hit"].includes(event.type)) {
      }
      if (event.type === "level") {
        showNotice(`SIGNAL LEVEL ${event.level}`, 90);
      }
      else if (event.type === "life-lost") {
        showNotice(`${event.reason} // ${event.lives} LEFT`, 90);
      }
      else if (event.type === "fuel") showNotice("FUEL LATTICE CAPTURED", 70);
      else if (event.type === "dive") showNotice("TALON BREAKING FORMATION", 50);
      else if (event.type === "game-over" && mode !== "replay") {
        paused = true;
        releaseInput();
        showMessage("SIGNAL LOST", "GAME OVER", `Final score ${state.score}. State ${core.stateDigest(state)}.`, "RESET", resetRun);
      } else if (event.type === "round-end" && mode !== "replay") {
        paused = true;
        releaseInput();
        const title = event.victory ? "HORIZON WON" : event.score === event.aiScore ? "SIGNAL DRAW" : "HORIZON LOST";
        showMessage("ROUND COMPLETE", title, `Player ${event.score} // machine ${event.aiScore}. State ${core.stateDigest(state)}.`, "RESET", resetRun);
      }
    }
  }

  function simulationStep() {
    let word;
    if (mode === "replay") {
      word = core.nextReplayInput(replayCursor);
      if (word === null) { finishReplay(); return; }
    } else {
      word = inputWord();
      if (!core.tryRecordInput(recorder, word)) {
        paused = true;
        releaseInput();
        showMessage("LEDGER SEALED", "TWO-HOUR LIMIT", "The valid receipt boundary has been reached. Export this run before resetting.", "OPEN RECEIPT", openReplayDialog);
        return;
      }
    }
    core.step(state, word);
    processEvents(state.events);
    if (noticeTicks > 0) {
      noticeTicks -= 1;
      if (noticeTicks <= 0) hideNotice();
    }
    if (mode === "replay" && replayCursor.tick >= replay.ticks) finishReplay();
  }

  function render() {
    presentation.render(state, { palette: PALETTES[state ? state.gameId : selectedGameId], monochrome, paused });
  }

  function updateTelemetry(force) {
    if (!state) {
      gameReadout.textContent = gameDefinition(selectedGameId).name;
      scoreReadout.textContent = "000000";
      livesReadout.textContent = "—";
      levelReadout.textContent = "—";
      seedReadout.textContent = "--------";
      tickReadout.textContent = "0";
      digestReadout.textContent = "--------";
      modeReadout.textContent = "SELECT";
      return;
    }
    if (!force && state.tick === lastTelemetryTick) return;
    if (!force && state.tick % 6 !== 0) return;
    lastTelemetryTick = state.tick;
    gameReadout.textContent = gameDefinition(state.gameId).name;
    scoreReadout.textContent = String(state.score).padStart(6, "0").slice(-8);
    livesReadout.textContent = state.gameId === "skywater-command" ? `AI ${state.game.aiScore}` : String(Math.max(0, state.lives));
    levelReadout.textContent = String(state.level);
    seedReadout.textContent = core.seedHex(state.seed);
    tickReadout.textContent = String(state.tick);
    digestReadout.textContent = core.stateDigest(state);
    if (mode === "replay") {
      if (replayCursor && replayCursor.tick >= replay.ticks) modeReadout.textContent = `REPLAY COMPLETE ${replay.ticks}/${replay.ticks}`;
      else modeReadout.textContent = `${paused ? "PAUSED " : ""}REPLAY ${replayCursor.tick}/${replay.ticks}`;
    }
    else modeReadout.textContent = paused ? "PAUSED" : state.gameOver || state.victory ? "TERMINAL" : "LIVE";
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
    releaseInput();
    if (!state) {
      replayText.value = "";
      replayMeta.textContent = "Paste a CZ01 receipt to reproduce its signal.";
    } else if (mode === "live" && recorder) {
      replayText.value = core.encodeReplay(recorder);
      replayMeta.textContent = `${gameDefinition(recorder.gameId).name} // ${recorder.ticks} ticks // state ${core.stateDigest(state)}`;
    } else if (replay) {
      replayText.value = core.encodeReplay({ version: replay.version, gameId: replay.gameId, seed: replay.seed, difficulty: replay.difficulty, ticks: replay.ticks, runs: replay.runs.map((run) => run.slice()) });
      replayMeta.textContent = `${replayCursor.tick}/${replay.ticks} replay ticks // state ${core.stateDigest(state)}`;
    }
    replayDialog.showModal();
  }

  startButton.addEventListener("click", () => startRun(selectedGameId, seedInput.value, Number(difficultySelect.value), "live", null));
  resetButton.addEventListener("click", resetRun);
  selectButton.addEventListener("click", returnToMenu);
  pauseButton.addEventListener("click", () => setPaused(!paused));
  replayButton.addEventListener("click", openReplayDialog);
  soundButton.addEventListener("click", () => {
    const enabled = audio.toggle();
    soundButton.textContent = enabled ? "SOUND ON" : "SOUND OFF";
    soundButton.setAttribute("aria-pressed", String(enabled));
    restoreGameplayFocus();
  });
  colorButton.addEventListener("click", () => {
    monochrome = !monochrome;
    document.documentElement.classList.toggle("mono", monochrome);
    colorButton.textContent = monochrome ? "B/W" : "COLOR";
    colorButton.setAttribute("aria-pressed", String(monochrome));
    restoreGameplayFocus();
  });
  fullscreenButton.addEventListener("click", () => {
    const consoleElement = document.querySelector(".console");
    if (!document.fullscreenElement) consoleElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
    restoreGameplayFocus();
  });
  copyReplayButton.addEventListener("click", async () => {
    replayText.select();
    try { await navigator.clipboard.writeText(replayText.value); replayMeta.textContent = "Receipt copied."; }
    catch (_error) { document.execCommand("copy"); replayMeta.textContent = "Receipt selected for copying."; }
  });
  watchReplayButton.addEventListener("click", () => {
    try {
      const decoded = core.decodeReplay(replayText.value);
      replayDialog.close();
      setSelectedGame(decoded.gameId);
      startRun(decoded.gameId, decoded.seed, decoded.difficulty, "replay", decoded);
    } catch (error) {
      replayMeta.textContent = `Rejected: ${error.message}`;
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(event.code)) event.preventDefault();
    if (event.code === "KeyP" && !event.repeat) { setPaused(!paused); return; }
    if (event.code === "Escape" && replayDialog.open) replayDialog.close();
    keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", releaseInput);
  document.addEventListener("visibilitychange", () => { if (document.hidden && state && !paused) setPaused(true); });
  replayDialog.addEventListener("close", () => {
    releaseInput();
    previousTime = performance.now();
    requestAnimationFrame(restoreGameplayFocus);
  });

  for (const button of document.querySelectorAll("[data-action]")) {
    const action = button.dataset.action;
    const engage = (event) => { event.preventDefault(); touchActions.add(action); button.classList.add("active"); };
    const release = (event) => { event.preventDefault(); touchActions.delete(action); button.classList.remove("active"); };
    button.addEventListener("pointerdown", engage);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  }

  window.cartridgeZero = Object.freeze({
    get state() { return state; },
    get mode() { return mode; },
    get paused() { return paused; },
    get recorder() { return recorder; },
    get replayTick() { return replayCursor ? replayCursor.tick : null; },
    select: setSelectedGame,
    start: startRun,
    reset: resetRun,
    menu: returnToMenu,
    digest() { return state ? core.stateDigest(state) : null; },
  });

  buildGameGrid();
  audio = createAudio();
  updateTelemetry(true);
  render();
  requestAnimationFrame(frame);
})();
