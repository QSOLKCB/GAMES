(function () {
  "use strict";

  const core = window.CartridgeZeroCore;
  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d", { alpha: false });
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
      if (event.type === "level") showNotice(`SIGNAL LEVEL ${event.level}`, 90);
      else if (event.type === "life-lost") showNotice(`${event.reason} // ${event.lives} LEFT`, 90);
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

  function clearScreen(palette) {
    ctx.fillStyle = monochrome ? "#070907" : palette.bg;
    ctx.fillRect(0, 0, core.WIDTH, core.HEIGHT);
    ctx.imageSmoothingEnabled = false;
  }

  function color(palette, key) {
    if (!monochrome) return palette[key];
    if (key === "dim") return "#263126";
    if (key === "secondary") return "#91a891";
    if (key === "cool") return "#6f866f";
    return "#c9dcc1";
  }

  function drawShip(x, y, palette, hostile, scale) {
    const size = scale || 1;
    ctx.fillStyle = hostile ? color(palette, "secondary") : color(palette, "main");
    ctx.beginPath();
    ctx.moveTo(x, y - 5 * size);
    ctx.lineTo(x - 5 * size, y + 4 * size);
    ctx.lineTo(x, y + 2 * size);
    ctx.lineTo(x + 5 * size, y + 4 * size);
    ctx.closePath();
    ctx.fill();
  }

  function drawPrism() {
    const palette = PALETTES[state.gameId];
    const game = state.game;
    clearScreen(palette);
    ctx.fillStyle = color(palette, "dim");
    ctx.fillRect(3, 7, 2, 178);
    ctx.fillRect(155, 7, 2, 178);
    for (const brick of game.bricks) {
      ctx.fillStyle = monochrome ? (brick.band % 2 ? "#8ca08c" : "#c5d5bd") : palette.bands[brick.band];
      ctx.fillRect(logical(brick.x - brick.w / 2), logical(brick.y - brick.h / 2), logical(brick.w), logical(brick.h));
      if (brick.hp > 1) {
        ctx.fillStyle = palette.bg;
        ctx.fillRect(logical(brick.x) - 1, logical(brick.y) - 1, 3, 2);
      }
    }
    ctx.fillStyle = color(palette, "main");
    ctx.fillRect(logical(game.paddleX) - 14, 176, 28, 4);
    ctx.fillStyle = color(palette, "secondary");
    ctx.fillRect(logical(game.ball.x) - 1, logical(game.ball.y) - 1, 3, 3);
    if (game.ball.stuck) {
      ctx.fillStyle = color(palette, "cool");
      ctx.font = "6px monospace";
      ctx.textAlign = "center";
      ctx.fillText("FIRE TO SERVE", 80, 151);
    }
  }

  function gridLaneX(lane, y) {
    const spread = 7 + Math.max(0, y - 22) * 0.22;
    return 80 + (lane - 3) * spread;
  }

  function drawGridburn() {
    const palette = PALETTES[state.gameId];
    const game = state.game;
    clearScreen(palette);
    ctx.strokeStyle = color(palette, "dim");
    ctx.lineWidth = 1;
    for (let boundary = -3.5; boundary <= 3.5; boundary += 1) {
      ctx.beginPath();
      ctx.moveTo(80 + boundary * 7, 22);
      ctx.lineTo(80 + boundary * 40, 191);
      ctx.stroke();
    }
    for (let row = 0; row < 11; row += 1) {
      const phase = (state.tick * 0.65 + row * 18) % 180;
      const y = 22 + Math.floor(phase * phase / 190);
      const half = 25 + (y - 22) * 0.78;
      ctx.beginPath();
      ctx.moveTo(80 - half, y);
      ctx.lineTo(80 + half, y);
      ctx.stroke();
    }
    for (const enemy of game.enemies) {
      const y = logical(enemy.y);
      const x = gridLaneX(enemy.lane, y);
      const size = Math.max(2, Math.floor(2 + y / 55));
      ctx.fillStyle = enemy.kind === 2 ? color(palette, "secondary") : color(palette, "cool");
      ctx.fillRect(Math.round(x - size), y - size, size * 2 + 1, size * 2 + 1);
      if (enemy.kind === 1) ctx.fillRect(Math.round(x - size - 2), y, size * 2 + 5, 1);
    }
    ctx.fillStyle = color(palette, "main");
    for (const shot of game.shots) ctx.fillRect(Math.round(gridLaneX(shot.lane, logical(shot.y))), logical(shot.y), 1, 5);
    ctx.fillStyle = color(palette, "secondary");
    for (const shot of game.enemyShots) ctx.fillRect(Math.round(gridLaneX(shot.lane, logical(shot.y))), logical(shot.y), 2, 3);
    drawShip(gridLaneX(game.lane, logical((176 - game.row * 15) * core.FP)), 176 - game.row * 15, palette, false, 0.8);
  }

  function drawOrbitalEnemy(enemy, palette) {
    const x = logical(enemy.x);
    const y = logical(enemy.y);
    ctx.fillStyle = enemy.row < 2 ? color(palette, "secondary") : color(palette, "cool");
    ctx.fillRect(x - 4, y - 2, 9, 5);
    ctx.fillRect(x - 2, y - 4, 5, 9);
    if ((state.tick >> 4) % 2) { ctx.fillRect(x - 6, y + 2, 2, 2); ctx.fillRect(x + 5, y + 2, 2, 2); }
  }

  function drawOrbital() {
    const palette = PALETTES[state.gameId];
    const game = state.game;
    clearScreen(palette);
    ctx.fillStyle = color(palette, "dim");
    ctx.fillRect(0, 184, 160, 8);
    for (const enemy of game.enemies) drawOrbitalEnemy(enemy, palette);
    drawShip(logical(game.playerX), 178, palette, false, 0.9);
    ctx.fillStyle = color(palette, "main");
    for (const shot of game.playerShots) ctx.fillRect(logical(shot.x), logical(shot.y), 1, 4);
    ctx.fillStyle = color(palette, "secondary");
    for (const shot of game.enemyShots) ctx.fillRect(logical(shot.x), logical(shot.y), 2, 4);
  }

  function drawTalonEnemy(enemy, palette) {
    const x = logical(enemy.x);
    const y = logical(enemy.y);
    ctx.fillStyle = enemy.state === "diving" ? color(palette, "secondary") : color(palette, "cool");
    ctx.beginPath();
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x - 6, y - 2);
    ctx.lineTo(x - 2, y);
    ctx.lineTo(x, y - 4);
    ctx.lineTo(x + 2, y);
    ctx.lineTo(x + 6, y - 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawTalon() {
    const palette = PALETTES[state.gameId];
    const game = state.game;
    clearScreen(palette);
    ctx.fillStyle = color(palette, "dim");
    for (let index = 0; index < 24; index += 1) {
      const star = core.mix32(state.seed ^ index * 7717);
      ctx.fillRect(star % 160, 8 + (star >>> 8) % 160, 1, 1);
    }
    for (const enemy of game.enemies) drawTalonEnemy(enemy, palette);
    drawShip(logical(game.playerX), 178, palette, false, 0.9);
    ctx.fillStyle = color(palette, "main");
    for (const shot of game.playerShots) ctx.fillRect(logical(shot.x), logical(shot.y), 1, 4);
    ctx.fillStyle = color(palette, "secondary");
    for (const shot of game.enemyShots) ctx.fillRect(logical(shot.x), logical(shot.y), 2, 3);
  }

  function drawRiverEntity(entity, palette) {
    const x = logical(entity.x);
    const y = logical(entity.y);
    if (entity.kind === "fuel") {
      ctx.fillStyle = color(palette, "main");
      ctx.fillRect(x - 3, y - 4, 7, 9);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(x - 1, y - 2, 3, 5);
      return;
    }
    ctx.fillStyle = entity.kind === "tower" ? color(palette, "secondary") : color(palette, "cool");
    ctx.fillRect(x - 5, y - 3, 11, 6);
    ctx.fillRect(x - 1, y - 6, 3, 4);
  }

  function drawRiver() {
    const palette = PALETTES[state.gameId];
    const game = state.game;
    clearScreen(palette);
    ctx.fillStyle = color(palette, "dim");
    const leftPoints = [{ x: 0, y: -4 }];
    const rightPoints = [{ x: 160, y: -4 }];
    for (let index = 0; index < game.rows.length; index += 1) {
      const row = game.rows[index];
      const y = index * 8 + game.offset / core.FP - 8;
      leftPoints.push({ x: row.center - row.width / 2, y });
      rightPoints.push({ x: row.center + row.width / 2, y });
    }
    leftPoints.push({ x: 0, y: 196 });
    rightPoints.push({ x: 160, y: 196 });
    ctx.beginPath();
    ctx.moveTo(0, -4);
    for (const point of leftPoints.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.lineTo(0, 196);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(160, -4);
    for (const point of rightPoints.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.lineTo(160, 196);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color(palette, "main");
    ctx.lineWidth = 1;
    ctx.beginPath();
    leftPoints.slice(1, -1).forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.stroke();
    ctx.beginPath();
    rightPoints.slice(1, -1).forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.stroke();
    for (const entity of game.entities) drawRiverEntity(entity, palette);
    drawShip(logical(game.playerX), logical(game.playerY), palette, false, 0.9);
    ctx.fillStyle = color(palette, "main");
    for (const shot of game.shots) ctx.fillRect(logical(shot.x), logical(shot.y), 1, 4);
    ctx.fillStyle = color(palette, "secondary");
    for (const shot of game.enemyShots) ctx.fillRect(logical(shot.x), logical(shot.y), 2, 3);
    ctx.fillStyle = color(palette, "main");
    ctx.fillRect(5, 186, Math.floor(game.fuel * 50 / 1000), 3);
    ctx.strokeStyle = color(palette, "cool");
    ctx.strokeRect(4.5, 185.5, 51, 4);
  }

  function drawTank(tank, palette, hostile) {
    const x = logical(tank.x);
    const y = logical(tank.y);
    const direction = core.DIR16[tank.angle];
    ctx.fillStyle = hostile ? color(palette, "secondary") : color(palette, "main");
    ctx.fillRect(x - 4, y - 4, 9, 9);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.round(direction.x * 8 / 1024), y + Math.round(direction.y * 8 / 1024));
    ctx.stroke();
  }

  function drawCircuit() {
    const palette = PALETTES[state.gameId];
    const game = state.game;
    clearScreen(palette);
    ctx.strokeStyle = color(palette, "dim");
    ctx.strokeRect(4.5, 8.5, 151, 177);
    ctx.fillStyle = color(palette, "dim");
    for (const wall of game.walls) ctx.fillRect(logical(wall.x - wall.w / 2), logical(wall.y - wall.h / 2), logical(wall.w), logical(wall.h));
    drawTank(game.player, palette, false);
    for (const bot of game.bots) drawTank(bot, palette, true);
    for (const shell of game.shells) {
      ctx.fillStyle = shell.owner === "player" ? color(palette, "main") : color(palette, "secondary");
      ctx.fillRect(logical(shell.x) - 1, logical(shell.y) - 1, 3, 3);
    }
  }

  function drawSkyTarget(target, palette) {
    const x = logical(target.x);
    const y = logical(target.y);
    ctx.fillStyle = target.kind === "sub" || target.kind === "skimmer" ? color(palette, "cool") : color(palette, "secondary");
    if (target.kind === "glider") {
      ctx.fillRect(x - 6, y - 1, 13, 3);
      ctx.fillRect(x - 1, y - 3, 4, 7);
    } else if (target.kind === "rotor") {
      ctx.fillRect(x - 4, y - 2, 9, 5);
      ctx.fillRect(x - 7, y - 4, 15, 1);
    } else if (target.kind === "skimmer") {
      ctx.fillRect(x - 7, y - 2, 15, 5);
      ctx.fillRect(x - 1, y - 5, 4, 4);
    } else {
      ctx.fillRect(x - 8, y - 2, 17, 4);
      ctx.fillRect(x - 2, y - 5, 5, 4);
    }
  }

  function drawTurret(x, y, aim, palette, hostile) {
    const direction = core.DIR16[aim];
    ctx.fillStyle = hostile ? color(palette, "secondary") : color(palette, "main");
    ctx.fillRect(x - 5, y - 3, 11, 5);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 2);
    ctx.lineTo(x + Math.round(direction.x * 10 / 1024), y - 2 + Math.round(direction.y * 10 / 1024));
    ctx.stroke();
  }

  function drawSkywater() {
    const palette = PALETTES[state.gameId];
    const game = state.game;
    clearScreen(palette);
    ctx.fillStyle = color(palette, "dim");
    ctx.fillRect(0, 151, 160, 41);
    ctx.fillStyle = color(palette, "cool");
    for (let x = (state.tick % 12) - 12; x < 160; x += 12) ctx.fillRect(x, 154, 7, 1);
    for (const target of game.targets) drawSkyTarget(target, palette);
    drawTurret(24, 181, game.playerAim, palette, false);
    drawTurret(136, 181, game.aiAim, palette, true);
    for (const shell of game.shells) {
      ctx.fillStyle = shell.owner === "player" ? color(palette, "main") : color(palette, "secondary");
      ctx.fillRect(logical(shell.x), logical(shell.y), 2, 2);
    }
    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = color(palette, "main");
    ctx.fillText(`YOU ${state.score}`, 32, 10);
    ctx.fillStyle = color(palette, "secondary");
    ctx.fillText(`AI ${game.aiScore}`, 128, 10);
    ctx.fillStyle = color(palette, "cool");
    ctx.fillText(`${Math.ceil(game.timeLeft / core.TICK_RATE)} SEC`, 80, 10);
  }

  const RENDERERS = Object.freeze({
    "prism-break": drawPrism,
    gridburn: drawGridburn,
    "orbital-siege": drawOrbital,
    "star-talon": drawTalon,
    "rift-runner": drawRiver,
    "iron-circuit": drawCircuit,
    "skywater-command": drawSkywater,
  });

  function renderStandby() {
    const palette = PALETTES[selectedGameId];
    clearScreen(palette);
    ctx.fillStyle = color(palette, "dim");
    for (let y = 20; y < 180; y += 12) ctx.fillRect(20 + (y % 24), y, 120 - (y % 24), 1);
    ctx.fillStyle = color(palette, "main");
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("CARTRIDGE ZERO", 80, 77);
    ctx.font = "7px monospace";
    ctx.fillStyle = color(palette, "cool");
    ctx.fillText("SEVEN SIGNALS", 80, 91);
    ctx.fillStyle = color(palette, "secondary");
    ctx.fillText("INSERTED // WAITING", 80, 119);
  }

  function render() {
    if (!state) renderStandby();
    else RENDERERS[state.gameId]();
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
