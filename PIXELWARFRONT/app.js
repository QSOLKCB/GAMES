(function () {
  "use strict";

  const core = globalThis.PixelWarfrontCore;
  if (!core) throw new Error("PIXEL WARFRONT deterministic core failed to load");

  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const STEP_MS = 1000 / core.TICK_RATE;
  const palettes = [
    { ground: "#11181b", grid: "#243238", high: "#2b3739", low: "#0b1215", mineral: "#76b0ba", enemy: "#df6843" },
    { ground: "#10171a", grid: "#26383f", high: "#29434a", low: "#0a1114", mineral: "#65a8b6", enemy: "#e07149" },
    { ground: "#171715", grid: "#37382f", high: "#4a4638", low: "#10100e", mineral: "#d1aa63", enemy: "#d8613f" },
    { ground: "#171210", grid: "#3c2f2a", high: "#4a332d", low: "#0f0c0b", mineral: "#87aeb0", enemy: "#e06a43" },
    { ground: "#111816", grid: "#2a3935", high: "#3c4841", low: "#0a100e", mineral: "#8eb3a2", enemy: "#dd6c45" },
  ];

  const ui = {
    intro: $("introLayer"), seedInput: $("seedInput"), randomSeed: $("randomSeed"),
    start: $("startButton"), introReplay: $("introReplayButton"), message: $("messageLayer"),
    messageKicker: $("messageKicker"), messageTitle: $("messageTitle"), messageText: $("messageText"),
    seed: $("seedReadout"), mode: $("runMode"), credits: $("creditsReadout"), supply: $("supplyReadout"),
    power: $("powerReadout"), mission: $("missionReadout"), score: $("scoreReadout"), rank: $("rankReadout"),
    biome: $("biomeReadout"), threat: $("threatBar"), signature: $("signatureReadout"),
    selectionName: $("selectionName"), selectionMeta: $("selectionMeta"), placementStatus: $("placementStatus"),
    moveMode: $("moveModeButton"), attackMode: $("attackModeButton"), gatherMode: $("gatherModeButton"), stop: $("stopButton"),
    trainDrone: $("trainDrone"), trainRanger: $("trainRanger"), trainTank: $("trainTank"),
    buildRelay: $("buildRelay"), buildRefinery: $("buildRefinery"), buildFactory: $("buildFactory"), buildTurret: $("buildTurret"),
    pause: $("pauseButton"), restart: $("restartButton"), replay: $("replayButton"), loadReplay: $("loadReplayButton"), sound: $("soundButton"), status: $("statusLine"),
    dialog: $("replayDialog"), replayText: $("replayText"), replayMeta: $("replayMeta"),
    copyReplay: $("copyReplayButton"), watchReplay: $("watchReplayButton"),
  };

  let state = null;
  let recorder = null;
  let replay = null;
  let replayCursor = null;
  let mode = "standby";
  let paused = false;
  let recordingStopped = false;
  let recordingTerminalDigest = null;
  let selectedIds = new Set();
  let commandMode = "move";
  let pendingBuild = null;
  let pendingCommands = [];
  let pointerDown = false;
  let dragStart = null;
  let dragCurrent = null;
  let lastTime = performance.now();
  let accumulator = 0;
  let effects = [];
  let hitUntil = new Map();
  let screenFlash = 0;
  let shake = 0;

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

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
      this.lastFireTick = -100;
      this.lastHitTick = -100;
      this.lastSelectTick = -100;
    }

    ensure() {
      if (!this.enabled) return null;
      if (!this.context) {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return null;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.2;
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
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain || 0.04), now + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(envelope);
      envelope.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    }

    event(event, gameState) {
      if (!this.enabled) return;
      if (event.type === "fire" && gameState.tick - this.lastFireTick >= 3) {
        this.lastFireTick = gameState.tick;
        this.tone(event.kind === "tank" ? 90 : 190, 0.08, "square", 0.028, 55);
      } else if (event.type === "hit" && gameState.tick - this.lastHitTick >= 2) {
        this.lastHitTick = gameState.tick;
        this.tone(620, 0.035, "square", 0.015, 280);
      } else if (event.type === "destroy") {
        this.tone(event.kind === "hq" ? 68 : 110, event.kind === "hq" ? 0.65 : 0.18, "sawtooth", 0.065, 34);
      } else if (event.type === "deposit") {
        this.tone(330, 0.08, "triangle", 0.02, 500);
      } else if (event.type === "unit-ready" || event.type === "construction-complete") {
        this.tone(220, 0.16, "triangle", 0.035, 660);
      } else if (event.type === "wave") {
        this.tone(58, 0.5, "sawtooth", 0.055, 42);
      } else if (event.type === "victory") {
        this.tone(110, 0.75, "triangle", 0.09, 880);
      } else if (event.type === "game-over") {
        this.tone(150, 0.7, "square", 0.08, 34);
      }
    }

    select(tick) {
      if (!this.enabled || tick - this.lastSelectTick < 2) return;
      this.lastSelectTick = tick;
      this.tone(480, 0.045, "square", 0.016, 360);
    }

    musicTick(gameState) {
      if (!this.enabled || paused || gameState.tick % 40 !== 0) return;
      const notes = [0, 3, 5, 7, 10, 12];
      const index = visualHash(gameState.seed, gameState.level, Math.floor(gameState.tick / 40)) % notes.length;
      const root = 48.999 * Math.pow(2, (gameState.level % 4) / 12);
      this.tone(root * Math.pow(2, notes[index] / 12), 0.33, "triangle", 0.012, 0);
    }

    toggle() {
      this.enabled = !this.enabled;
      if (!this.enabled && this.context) this.context.suspend();
      else this.ensure();
      return this.enabled;
    }
  }

  const audio = new AudioSystem();

  function setStatus(text) { ui.status.textContent = text; }

  function showMessage(kicker, title, text) {
    ui.messageKicker.textContent = kicker;
    ui.messageTitle.textContent = title;
    ui.messageText.textContent = text;
    ui.message.classList.remove("is-hidden");
  }

  function hideMessage() { ui.message.classList.add("is-hidden"); }

  function resetPresentation() {
    selectedIds = new Set();
    commandMode = "move";
    pendingBuild = null;
    pendingCommands = [];
    pointerDown = false;
    dragStart = null;
    dragCurrent = null;
    accumulator = 0;
    effects = [];
    hitUntil = new Map();
    screenFlash = 0;
    shake = 0;
    audio.resetRun();
    updateCommandMode();
  }

  function enableRunControls() {
    ui.pause.disabled = false;
    ui.restart.disabled = false;
    ui.replay.disabled = mode !== "live";
  }

  function startLive(seedInput) {
    const seed = core.normalizeSeed(seedInput);
    state = core.createRun(seed);
    recorder = core.createRecorder(seed);
    replay = null;
    replayCursor = null;
    mode = "live";
    paused = false;
    recordingStopped = false;
    recordingTerminalDigest = null;
    resetPresentation();
    ui.pause.textContent = "PAUSE";
    ui.seedInput.value = `0x${core.seedHex(seed)}`;
    ui.intro.classList.add("is-hidden");
    hideMessage();
    enableRunControls();
    audio.ensure();
    canvas.focus({ preventScroll: true });
    setStatus(`Command deployed from seed ${core.seedHex(seed)}.`);
  }

  function startReplay(replayData) {
    state = core.createRun(replayData.seed);
    recorder = null;
    replay = replayData;
    replayCursor = core.createReplayCursor(replayData);
    mode = "replay";
    paused = false;
    recordingStopped = false;
    recordingTerminalDigest = null;
    resetPresentation();
    ui.pause.textContent = "PAUSE";
    ui.seedInput.value = `0x${core.seedHex(replayData.seed)}`;
    ui.intro.classList.add("is-hidden");
    hideMessage();
    enableRunControls();
    ui.pause.disabled = false;
    ui.replay.disabled = true;
    ui.dialog.close();
    audio.ensure();
    canvas.focus({ preventScroll: true });
    setStatus(`Replaying ${replayData.ticks.toLocaleString()} command ticks from initial deployment.`);
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
    if (paused) showMessage("COMMAND SYSTEM", "PAUSED", "Press P or Resume to continue");
    else {
      hideMessage();
      canvas.focus({ preventScroll: true });
    }
  }

  function randomSeedText() {
    const words = ["COBALT", "FORGE", "RELAY", "OXIDE", "VECTOR", "FRONT", "CIPHER", "GRID", "FLUX", "IRON"];
    let value;
    if (globalThis.crypto && globalThis.crypto.getRandomValues) {
      const array = new Uint32Array(2);
      globalThis.crypto.getRandomValues(array);
      value = `${words[array[0] % words.length]}-${(array[1] >>> 0).toString(36).toUpperCase()}`;
    } else value = `WARFRONT-${Date.now().toString(36).toUpperCase()}`;
    ui.seedInput.value = value;
    ui.seedInput.select();
  }

  function queueCommand(command) {
    if (!state || mode !== "live" || paused || state.gameOver) return;
    pendingCommands.push(command);
  }

  function liveSelectedUnits() {
    if (!state) return [];
    return state.units.filter((unit) => unit.team === core.PLAYER && !unit.dead && selectedIds.has(unit.id));
  }

  function cleanSelection() {
    if (!state) return;
    const live = new Set(state.units.filter((unit) => unit.team === core.PLAYER && !unit.dead).map((unit) => unit.id));
    for (const id of selectedIds) if (!live.has(id)) selectedIds.delete(id);
  }

  function updateCommandMode() {
    for (const button of [ui.moveMode, ui.attackMode, ui.gatherMode]) button.classList.remove("is-active");
    if (commandMode === "move") ui.moveMode.classList.add("is-active");
    if (commandMode === "attack") ui.attackMode.classList.add("is-active");
    if (commandMode === "gather") ui.gatherMode.classList.add("is-active");
    if (pendingBuild) {
      ui.placementStatus.textContent = `PLACE ${core.BUILDING_TYPES[pendingBuild].label} WITH LEFT CLICK · ESC CANCELS`;
    } else if (commandMode === "attack") {
      ui.placementStatus.textContent = "ATTACK MODE · CLICK A HOSTILE TARGET";
    } else if (commandMode === "gather") {
      ui.placementStatus.textContent = "GATHER MODE · CLICK A FLUX FIELD WITH DRONES SELECTED";
    } else {
      ui.placementStatus.textContent = "RIGHT-CLICK OR M + CLICK TO MOVE · DRAG TO BOX SELECT";
    }
  }

  function setCommandMode(next) {
    if (mode === "replay") return;
    commandMode = next;
    pendingBuild = null;
    updateCommandMode();
  }

  function setBuildMode(kind) {
    if (mode === "replay") return;
    const drones = liveSelectedUnits().filter((unit) => unit.kind === "drone");
    if (!drones.length) {
      setStatus("Select at least one drone before placing a structure.");
      return;
    }
    pendingBuild = kind;
    commandMode = "move";
    updateCommandMode();
  }

  function addEffect(type, event) {
    effects.push({
      type,
      x: event.x / core.SCALE,
      y: event.y / core.SCALE,
      radius: event.radius / core.SCALE,
      startTick: state.tick,
      duration: type === "impact" ? 7 : event.kind === "hq" ? 70 : event.entityType === "building" ? 36 : 24,
      seed: visualHash(state.seed, event.id, state.tick ^ (type === "impact" ? 0x4a11 : 0xe710de)),
      major: event.kind === "hq",
    });
    if (effects.length > 160) effects.splice(0, effects.length - 160);
  }

  function processCoreEvents() {
    for (const event of state.events) {
      audio.event(event, state);
      if (event.type === "hit") {
        hitUntil.set(event.id, state.tick + 3);
        addEffect("impact", event);
      } else if (event.type === "destroy") {
        addEffect("explosion", event);
        shake = Math.max(shake, event.kind === "hq" ? 16 : event.entityType === "building" ? 7 : 3);
        screenFlash = Math.max(screenFlash, event.kind === "hq" ? 12 : 2);
      } else if (event.type === "wave") {
        setStatus("Hostile command pulse detected: attack wave mobilised.");
      } else if (event.type === "construction-complete") {
        setStatus(`${core.BUILDING_TYPES[event.kind].label} is operational.`);
      } else if (event.type === "unit-ready" && event.team === core.PLAYER) {
        setStatus(`${core.UNIT_TYPES[event.kind].label} ready for orders.`);
      } else if (event.type === "victory") {
        showMessage("THEATRE SECURED", "COMMAND NODE DOWN", "Next procedural mission deploying");
      } else if (event.type === "mission") {
        hideMessage();
        selectedIds.clear();
        setStatus(`Mission ${state.level} deployed. Enemy rank ${state.blueprint.difficulty.rank}.`);
      } else if (event.type === "game-over") {
        showMessage("COMMAND LINK LOST", "DEFEAT", mode === "live" ? "Export the command replay or restart this seed" : "Recorded campaign reached defeat");
        ui.pause.disabled = true;
        if (mode === "live") ui.replay.disabled = false;
      }
    }
    effects = effects.filter((effect) => state.tick - effect.startTick <= effect.duration);
    for (const [id, until] of hitUntil) if (until < state.tick) hitUntil.delete(id);
    audio.musicTick(state);
  }

  function simulationStep() {
    if (!state || paused || state.gameOver) return false;
    let commands;
    if (mode === "replay") {
      commands = core.nextReplayCommands(replayCursor);
      if (commands === null) {
        paused = true;
        ui.pause.disabled = true;
        showMessage("COMMAND RECORDER", "REPLAY COMPLETE", `Verified ${core.stateDigest(state)} after ${state.tick.toLocaleString()} ticks`);
        setStatus(`Replay complete. Final deterministic digest ${core.stateDigest(state)}.`);
        return false;
      }
    } else {
      commands = pendingCommands.splice(0, pendingCommands.length);
      if (!recordingStopped && !core.tryRecordCommands(recorder, commands)) {
        recordingStopped = true;
        recordingTerminalDigest = core.stateDigest(state);
        setStatus("Command recorder sealed at six hours; live strategy continues.");
      }
    }
    core.step(state, commands);
    cleanSelection();
    processCoreEvents();
    return true;
  }

  function updateHud() {
    if (!state) {
      ui.seed.textContent = "--------";
      return;
    }
    const supply = core.supplyStatus(state, core.PLAYER);
    const power = core.powerStatus(state, core.PLAYER);
    ui.seed.textContent = core.seedHex(state.seed);
    ui.credits.textContent = String(state.credits).padStart(4, "0");
    ui.supply.textContent = `${supply.used}/${supply.capacity}`;
    ui.power.textContent = `${power.used}/${power.capacity}`;
    ui.power.style.color = power.powered ? "" : "#e96f47";
    ui.mission.textContent = String(state.level).padStart(2, "0");
    ui.score.textContent = String(state.score).padStart(6, "0");
    ui.rank.textContent = String(state.blueprint.difficulty.rank).padStart(2, "0");
    ui.biome.textContent = state.blueprint.biome.name;
    ui.signature.textContent = `SIG ${state.blueprint.signature}`;
    const enemyHq = state.buildings.find((building) => building.team === core.ENEMY && building.kind === "hq");
    const threat = enemyHq ? Math.max(0, enemyHq.health / enemyHq.maxHealth * 100) : 0;
    ui.threat.style.width = `${threat.toFixed(2)}%`;
    if (mode === "replay") {
      const percent = replay.ticks ? Math.min(100, replayCursor.tick / replay.ticks * 100) : 100;
      ui.mode.textContent = `REPLAY // ${percent.toFixed(1)}%`;
    } else ui.mode.textContent = state.gameOver ? "COMMAND LOST" : recordingStopped ? "LIVE // RECORDER SEALED" : "LIVE COMMAND";

    const selected = liveSelectedUnits();
    if (!selected.length) {
      ui.selectionName.textContent = "NO UNITS SELECTED";
      ui.selectionMeta.textContent = "Left-click or drag over friendly units.";
    } else {
      const counts = new Map();
      for (const unit of selected) counts.set(unit.kind, (counts.get(unit.kind) || 0) + 1);
      ui.selectionName.textContent = `${selected.length} UNIT${selected.length === 1 ? "" : "S"} ACTIVE`;
      ui.selectionMeta.textContent = Array.from(counts).map(([kind, count]) => `${count} ${core.UNIT_TYPES[kind].label}`).join(" · ");
    }

    const productionLocked = mode !== "live" || state.gameOver;
    ui.trainDrone.disabled = productionLocked;
    ui.trainRanger.disabled = productionLocked;
    const hasFactory = state.buildings.some((building) =>
      building.team === core.PLAYER && building.kind === "factory" && !building.dead && building.construction <= 0
    );
    ui.trainTank.disabled = productionLocked || !hasFactory;
    const noDrone = !selected.some((unit) => unit.kind === "drone");
    for (const button of [ui.buildRelay, ui.buildRefinery, ui.buildFactory, ui.buildTurret]) button.disabled = productionLocked || noDrone;
  }

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) * core.WIDTH / bounds.width, 0, core.WIDTH),
      y: clamp((event.clientY - bounds.top) * core.HEIGHT / bounds.height, 0, core.HEIGHT),
    };
  }

  function nearestAt(point, entities, padding) {
    const found = entities.filter((entity) => {
      const dx = entity.x / core.SCALE - point.x;
      const dy = entity.y / core.SCALE - point.y;
      const radius = entity.radius / core.SCALE + (padding || 0);
      return dx * dx + dy * dy <= radius * radius;
    });
    found.sort((a, b) => a.id - b.id);
    return found[0] || null;
  }

  function selectAt(point, additive) {
    const target = nearestAt(point, state.units.filter((unit) => unit.team === core.PLAYER && !unit.dead), 5);
    if (!additive) selectedIds.clear();
    if (target) {
      if (additive && selectedIds.has(target.id)) selectedIds.delete(target.id);
      else selectedIds.add(target.id);
      audio.select(state.tick);
    }
  }

  function selectBox(start, end, additive) {
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    if (!additive) selectedIds.clear();
    for (const unit of state.units) {
      if (unit.team !== core.PLAYER || unit.dead) continue;
      const x = unit.x / core.SCALE;
      const y = unit.y / core.SCALE;
      if (x >= left && x <= right && y >= top && y <= bottom) selectedIds.add(unit.id);
    }
    if (selectedIds.size) audio.select(state.tick);
  }

  function selectedIdArray(kind) {
    return liveSelectedUnits().filter((unit) => !kind || unit.kind === kind).map((unit) => unit.id).sort((a, b) => a - b);
  }

  function issueAt(point, explicitRightClick) {
    const ids = selectedIdArray();
    if (!ids.length) {
      setStatus("Select friendly units before issuing a command.");
      return;
    }
    if (pendingBuild) {
      const drones = selectedIdArray("drone");
      queueCommand({ t: "build", ids: drones, kind: pendingBuild, x: Math.round(point.x), y: Math.round(point.y) });
      setStatus(`${core.BUILDING_TYPES[pendingBuild].label} placement command issued.`);
      pendingBuild = null;
      updateCommandMode();
      return;
    }
    const enemy = nearestAt(point, [
      ...state.units.filter((unit) => unit.team === core.ENEMY && !unit.dead),
      ...state.buildings.filter((building) => building.team === core.ENEMY && !building.dead),
    ], 5);
    const resource = nearestAt(point, state.resources.filter((item) => item.amount > 0), 7);
    if ((commandMode === "attack" || explicitRightClick) && enemy) {
      queueCommand({ t: "attack", ids, target: enemy.id });
      setStatus("Attack order transmitted.");
    } else if ((commandMode === "gather" || explicitRightClick) && resource) {
      const drones = selectedIdArray("drone");
      if (drones.length) {
        queueCommand({ t: "gather", ids: drones, target: resource.id });
        setStatus("Flux harvest route assigned.");
      } else setStatus("Only drones can harvest flux.");
    } else {
      queueCommand({ t: "move", ids, x: Math.round(point.x), y: Math.round(point.y) });
      setStatus("Formation move order transmitted.");
    }
    if (!explicitRightClick && commandMode !== "move") setCommandMode("move");
  }

  function drawBackground(gameState, time) {
    const seed = gameState ? gameState.seed : core.normalizeSeed("PIXEL-WARFRONT-ATTRACT");
    const blueprint = gameState ? gameState.blueprint : core.makeMissionBlueprint(seed, 1);
    const palette = palettes[blueprint.biomeIndex % palettes.length];
    ctx.fillStyle = palette.ground;
    ctx.fillRect(0, 0, core.WIDTH, core.HEIGHT);
    const terrain = blueprint.terrain;
    for (let row = 0; row < core.GRID_ROWS; row += 1) {
      for (let column = 0; column < core.GRID_COLUMNS; column += 1) {
        const tile = terrain[row * core.GRID_COLUMNS + column];
        const x = column * core.CELL_SIZE;
        const y = row * core.CELL_SIZE + 12;
        const hash = visualHash(seed, blueprint.levelSeed, row * 61 + column);
        if (tile === 1) ctx.fillStyle = palette.high;
        else if (tile === 2) ctx.fillStyle = palette.low;
        else if (tile === 3) ctx.fillStyle = "#352922";
        else ctx.fillStyle = palette.ground;
        ctx.globalAlpha = tile === 0 ? 0.22 : 0.55;
        ctx.fillRect(x, y, core.CELL_SIZE, core.CELL_SIZE);
        if (tile > 0 && (hash & 3) === 0) {
          ctx.fillStyle = tile === 3 ? palette.enemy : palette.grid;
          ctx.globalAlpha = 0.28;
          ctx.fillRect(x + 5 + (hash % 9), y + 6 + ((hash >>> 8) % 9), 4 + ((hash >>> 16) % 11), 3);
        }
      }
    }
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= core.WIDTH; x += core.CELL_SIZE) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, core.HEIGHT); ctx.stroke();
    }
    for (let y = 12; y <= core.HEIGHT; y += core.CELL_SIZE) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(core.WIDTH, y + 0.5); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const vignette = ctx.createRadialGradient(core.WIDTH / 2, core.HEIGHT / 2, 170, core.WIDTH / 2, core.HEIGHT / 2, 620);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, core.WIDTH, core.HEIGHT);
  }

  function healthBar(entity, x, y, width) {
    if (entity.health >= entity.maxHealth || entity.maxHealth <= 0) return;
    const ratio = Math.max(0, entity.health / entity.maxHealth);
    ctx.fillStyle = "rgba(2,4,5,0.87)";
    ctx.fillRect(x - width / 2 - 1, y, width + 2, 5);
    ctx.fillStyle = entity.team === core.PLAYER ? "#78a9b3" : "#e06945";
    ctx.fillRect(x - width / 2, y + 1, width * ratio, 3);
  }

  function drawResource(resource, tick, palette) {
    const x = resource.x / core.SCALE;
    const y = resource.y / core.SCALE;
    const ratio = resource.maxAmount ? resource.amount / resource.maxAmount : 0;
    const pulse = 0.7 + ((tick + resource.phase) % 24) / 80;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.3 + ratio * 0.7;
    ctx.fillStyle = palette.mineral;
    for (let index = 0; index < 6; index += 1) {
      const hash = visualHash(resource.id, resource.phase, index);
      const angle = (hash % 6283) / 1000;
      const distance = 5 + ((hash >>> 12) % 17);
      const size = 5 + ((hash >>> 21) % 7);
      ctx.save();
      ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
      ctx.rotate(angle);
      ctx.fillRect(-size / 2, -size / 2, size, size * pulse);
      ctx.restore();
    }
    ctx.globalAlpha = 0.24 * ratio;
    ctx.fillStyle = "#dff8f4";
    ctx.beginPath(); ctx.arc(0, 0, 25 + ((tick + resource.phase) % 9), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function teamColors(team) {
    return team === core.PLAYER
      ? { body: "#526f77", edge: "#a4c2c7", glow: "#65a3af", dark: "#142127" }
      : { body: "#7d3c31", edge: "#e58a69", glow: "#e06844", dark: "#271411" };
  }

  function drawBuilding(building, tick) {
    const x = building.x / core.SCALE;
    const y = building.y / core.SCALE;
    const radius = building.radius / core.SCALE;
    const color = teamColors(building.team);
    ctx.save();
    ctx.translate(x, y);
    if (building.kind === "hq") {
      ctx.fillStyle = color.dark;
      ctx.fillRect(-radius, -radius * 0.65, radius * 2, radius * 1.3);
      ctx.strokeStyle = color.edge; ctx.lineWidth = 3;
      ctx.strokeRect(-radius + 2, -radius * 0.65 + 2, radius * 2 - 4, radius * 1.3 - 4);
      ctx.fillStyle = color.body;
      ctx.fillRect(-radius * 0.56, -radius * 0.92, radius * 1.12, radius * 1.84);
      ctx.fillStyle = color.glow;
      ctx.fillRect(-5, -radius * 0.72, 10, radius * 1.44);
    } else if (building.kind === "relay") {
      ctx.fillStyle = color.dark; ctx.fillRect(-19, -19, 38, 38);
      ctx.strokeStyle = color.edge; ctx.lineWidth = 2; ctx.strokeRect(-18, -18, 36, 36);
      ctx.strokeStyle = color.glow; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(0, -27); ctx.stroke();
      ctx.globalAlpha = 0.35 + (tick % 20) / 60;
      ctx.beginPath(); ctx.arc(0, -26, 7 + tick % 5, 0, Math.PI * 2); ctx.stroke();
    } else if (building.kind === "refinery") {
      ctx.fillStyle = color.dark; ctx.fillRect(-28, -22, 56, 44);
      ctx.strokeStyle = color.edge; ctx.lineWidth = 2; ctx.strokeRect(-27, -21, 54, 42);
      ctx.fillStyle = color.body; ctx.fillRect(-21, -14, 22, 28); ctx.fillRect(7, -18, 13, 36);
      ctx.fillStyle = "#73adb6"; ctx.fillRect(-15, -7, 10, 14);
    } else if (building.kind === "factory") {
      ctx.fillStyle = color.dark; ctx.fillRect(-33, -26, 66, 52);
      ctx.strokeStyle = color.edge; ctx.lineWidth = 2; ctx.strokeRect(-32, -25, 64, 50);
      ctx.fillStyle = color.body; ctx.fillRect(-24, -17, 48, 17); ctx.fillRect(-28, 8, 56, 11);
      ctx.fillStyle = "#060809"; ctx.fillRect(-15, 0, 30, 25);
      ctx.fillStyle = color.glow; ctx.fillRect(-10, 4, 20, 3);
    } else if (building.kind === "turret") {
      ctx.rotate((building.targetId || tick * 0.15) * 0.02);
      ctx.fillStyle = color.dark; ctx.fillRect(-17, -17, 34, 34);
      ctx.strokeStyle = color.edge; ctx.lineWidth = 2; ctx.strokeRect(-16, -16, 32, 32);
      ctx.fillStyle = color.body; ctx.fillRect(-8, -8, 16, 16);
      ctx.fillStyle = color.glow; ctx.fillRect(-3, -30, 6, 27);
    }

    if (building.construction > 0) {
      const ratio = 1 - building.construction / Math.max(1, building.constructionTotal);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#080b0d";
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2 * (1 - ratio));
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = "#d6a261";
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(-radius, -radius, radius * 2, radius * 2);
      ctx.setLineDash([]);
    }
    ctx.restore();

    if ((hitUntil.get(building.id) || -1) >= tick) {
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#fff1cf"; ctx.beginPath(); ctx.arc(x, y, radius + 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    healthBar(building, x, y - radius - 9, Math.max(32, radius * 1.65));
    if (building.queue.length) {
      const queued = building.queue[0];
      const total = core.UNIT_TYPES[queued.kind].trainTicks;
      const ratio = Math.max(0, 1 - queued.remaining / total);
      ctx.fillStyle = "rgba(2,4,5,0.86)"; ctx.fillRect(x - 24, y + radius + 5, 48, 5);
      ctx.fillStyle = "#d6a261"; ctx.fillRect(x - 23, y + radius + 6, 46 * ratio, 3);
    }
  }

  function drawUnit(unit, tick) {
    const x = unit.x / core.SCALE;
    const y = unit.y / core.SCALE;
    const radius = unit.radius / core.SCALE;
    const color = teamColors(unit.team);
    ctx.save();
    ctx.translate(x, y);
    let angle = 0;
    const target = unit.targetId && state ? [...state.units, ...state.buildings].find((entity) => entity.id === unit.targetId) : null;
    if (target) angle = Math.atan2(target.y - unit.y, target.x - unit.x) + Math.PI / 2;
    else if (unit.order === "move") angle = Math.atan2(unit.targetY - unit.y, unit.targetX - unit.x) + Math.PI / 2;
    ctx.rotate(angle);
    if (unit.kind === "drone") {
      ctx.fillStyle = color.body;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.strokeStyle = color.edge; ctx.lineWidth = 1; ctx.strokeRect(-7.5, -7.5, 15, 15);
      ctx.fillStyle = unit.carry > 0 ? "#75b4bd" : color.glow;
      ctx.fillRect(-3, -3, 6, 6);
      ctx.fillStyle = color.dark; ctx.fillRect(-11, -3, 4, 6); ctx.fillRect(7, -3, 4, 6);
    } else if (unit.kind === "ranger") {
      ctx.fillStyle = color.body;
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(9, 9); ctx.lineTo(0, 6); ctx.lineTo(-9, 9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = color.edge; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = color.glow; ctx.fillRect(-2, -9, 4, 11);
    } else {
      ctx.fillStyle = color.dark; ctx.fillRect(-15, -12, 30, 24);
      ctx.strokeStyle = color.edge; ctx.lineWidth = 2; ctx.strokeRect(-14, -11, 28, 22);
      ctx.fillStyle = color.body; ctx.fillRect(-9, -9, 18, 18);
      ctx.fillStyle = color.glow; ctx.fillRect(-3, -23, 6, 23);
      ctx.fillStyle = "#090b0c"; ctx.fillRect(-18, -11, 5, 22); ctx.fillRect(13, -11, 5, 22);
    }
    ctx.restore();

    if (selectedIds.has(unit.id)) {
      ctx.strokeStyle = "#e6ddc9"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, radius + 6 + (tick % 4) * 0.3, 0, Math.PI * 2); ctx.stroke();
    }
    if ((hitUntil.get(unit.id) || -1) >= tick) {
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.42;
      ctx.fillStyle = "#fff1cf"; ctx.beginPath(); ctx.arc(x, y, radius + 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    healthBar(unit, x, y - radius - 7, 24);
  }

  function drawProjectile(projectile) {
    const x = projectile.x / core.SCALE;
    const y = projectile.y / core.SCALE;
    ctx.fillStyle = projectile.team === core.PLAYER ? "#bfe7ea" : "#f07b50";
    ctx.beginPath(); ctx.arc(x, y, Math.max(2, projectile.radius / core.SCALE), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = projectile.team === core.PLAYER ? "rgba(104,170,180,0.45)" : "rgba(234,100,62,0.45)";
    ctx.lineWidth = 3; ctx.stroke();
  }

  function drawImpact(effect, age) {
    const progress = age / effect.duration;
    const alpha = Math.max(0, 1 - progress);
    ctx.save(); ctx.translate(effect.x, effect.y); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#fff0cc"; ctx.lineWidth = 1.5;
    for (let index = 0; index < 5; index += 1) {
      const hash = visualHash(effect.seed, index, 0x1a2b);
      const angle = (hash % 6283) / 1000;
      const distance = 2 + age * (0.7 + ((hash >>> 11) % 80) / 100);
      ctx.beginPath(); ctx.moveTo(Math.cos(angle) * distance, Math.sin(angle) * distance);
      ctx.lineTo(Math.cos(angle) * (distance + 5), Math.sin(angle) * (distance + 5)); ctx.stroke();
    }
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 0, 3 * alpha, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  function drawExplosion(effect, age) {
    const progress = age / effect.duration;
    const alpha = Math.max(0, 1 - progress);
    const scale = effect.major ? 2.1 : Math.max(0.75, effect.radius / 25);
    ctx.save(); ctx.translate(effect.x, effect.y); ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = alpha * 0.8; ctx.strokeStyle = "#f47b4e"; ctx.lineWidth = Math.max(1, 5 * (1 - progress));
    ctx.beginPath(); ctx.arc(0, 0, (4 + progress * (effect.major ? 68 : 32)) * scale, 0, Math.PI * 2); ctx.stroke();
    const count = effect.major ? 30 : 14;
    for (let index = 0; index < count; index += 1) {
      const hash = visualHash(effect.seed, index, 0xe710);
      const angle = (hash % 6283) / 1000;
      const distance = age * (0.6 + ((hash >>> 11) % 120) / 100) * scale;
      const size = (2 + ((hash >>> 24) % 5)) * Math.max(0.45, alpha);
      ctx.save(); ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance + age * age * 0.01);
      ctx.rotate(angle + age * (((hash >>> 8) & 1) ? 0.08 : -0.08));
      ctx.globalAlpha = alpha * 0.8; ctx.fillStyle = index % 3 === 0 ? "#e8dfc8" : index % 3 === 1 ? "#ed7348" : "#73a3aa";
      ctx.fillRect(-size / 2, -size / 2, size * 1.8, size); ctx.restore();
    }
    ctx.restore();
  }

  function drawEffects(gameState) {
    for (const effect of effects) {
      const age = gameState.tick - effect.startTick;
      if (age < 0 || age > effect.duration) continue;
      if (effect.type === "impact") drawImpact(effect, age);
      else drawExplosion(effect, age);
    }
  }

  function drawOrders(gameState) {
    ctx.save(); ctx.setLineDash([5, 5]); ctx.lineWidth = 1;
    for (const unit of gameState.units) {
      if (!selectedIds.has(unit.id)) continue;
      if (unit.order === "move") {
        ctx.strokeStyle = "rgba(214,220,210,0.34)";
        ctx.beginPath(); ctx.moveTo(unit.x / core.SCALE, unit.y / core.SCALE); ctx.lineTo(unit.targetX / core.SCALE, unit.targetY / core.SCALE); ctx.stroke();
      }
    }
    ctx.setLineDash([]); ctx.restore();
  }

  function drawSelectionBox() {
    if (!pointerDown || !dragStart || !dragCurrent) return;
    const left = Math.min(dragStart.x, dragCurrent.x);
    const top = Math.min(dragStart.y, dragCurrent.y);
    const width = Math.abs(dragCurrent.x - dragStart.x);
    const height = Math.abs(dragCurrent.y - dragStart.y);
    if (width < 3 && height < 3) return;
    ctx.fillStyle = "rgba(101,163,175,0.09)"; ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = "#9fc4c9"; ctx.lineWidth = 1; ctx.strokeRect(left + 0.5, top + 0.5, width, height);
  }

  function drawOverlay(gameState) {
    ctx.fillStyle = "rgba(4,7,8,0.74)"; ctx.fillRect(0, 0, core.WIDTH, 31);
    ctx.fillStyle = "#d9d4c7"; ctx.font = "700 12px monospace"; ctx.textAlign = "left";
    ctx.fillText(`MISSION ${String(gameState.level).padStart(2, "0")} // ${gameState.blueprint.biome.code}`, 12, 19);
    ctx.fillStyle = "#82949c"; ctx.font = "10px monospace"; ctx.textAlign = "center";
    ctx.fillText(`SEED ${core.seedHex(gameState.seed)} // SIG ${gameState.blueprint.signature}`, core.WIDTH / 2, 19);
    ctx.textAlign = "right"; ctx.fillStyle = "#e2764d"; ctx.font = "700 12px monospace";
    ctx.fillText(`FLUX ${state.credits} // SCORE ${String(state.score).padStart(6, "0")}`, core.WIDTH - 12, 19);

    if (gameState.levelTick < 70) {
      const alpha = Math.min(1, gameState.levelTick / 12, (70 - gameState.levelTick) / 16);
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = "rgba(8,11,13,0.84)"; ctx.fillRect(285, 230, 390, 116);
      ctx.strokeStyle = "#df6b44"; ctx.strokeRect(285.5, 230.5, 389, 115);
      ctx.fillStyle = "#8e9aa0"; ctx.font = "11px monospace"; ctx.textAlign = "center";
      ctx.fillText(`PROCEDURAL THEATRE ${String(gameState.level).padStart(2, "0")}`, core.WIDTH / 2, 260);
      ctx.fillStyle = "#e8e1d4"; ctx.font = "700 24px monospace"; ctx.fillText(gameState.blueprint.biome.name, core.WIDTH / 2, 294);
      ctx.fillStyle = "#df6b44"; ctx.font = "10px monospace";
      ctx.fillText(`ENEMY RANK ${gameState.blueprint.difficulty.rank} // ${gameState.blueprint.signature}`, core.WIDTH / 2, 320);
      ctx.globalAlpha = 1;
    }
  }

  function render(time) {
    ctx.save();
    if (shake > 0) {
      const x = ((visualHash(state ? state.tick : 0, shake, 1) % 9) - 4) * Math.min(1, shake / 8);
      const y = ((visualHash(state ? state.tick : 0, shake, 2) % 9) - 4) * Math.min(1, shake / 8);
      ctx.translate(x, y); shake -= 1;
    }
    drawBackground(state, time);
    if (state) {
      const palette = palettes[state.blueprint.biomeIndex % palettes.length];
      for (const resource of state.resources) if (resource.amount > 0) drawResource(resource, state.tick, palette);
      drawOrders(state);
      for (const building of state.buildings) drawBuilding(building, state.tick);
      for (const unit of state.units) drawUnit(unit, state.tick);
      for (const projectile of state.projectiles) drawProjectile(projectile);
      drawEffects(state);
      drawSelectionBox();
      drawOverlay(state);
    } else {
      ctx.fillStyle = "rgba(233,227,213,0.03)"; ctx.font = "900 120px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("PW", core.WIDTH / 2, core.HEIGHT / 2 + 42);
    }
    if (screenFlash > 0) {
      ctx.fillStyle = `rgba(239,224,200,${Math.min(0.25, screenFlash / 65)})`;
      ctx.fillRect(0, 0, core.WIDTH, core.HEIGHT); screenFlash -= 1;
    }
    ctx.restore();
  }

  function frame(time) {
    const elapsed = Math.min(120, Math.max(0, time - lastTime));
    lastTime = time;
    if (state && !paused && !state.gameOver) {
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= STEP_MS && steps < 6) {
        if (!simulationStep()) break;
        accumulator -= STEP_MS;
        steps += 1;
      }
      if (steps >= 6) accumulator = 0;
    } else accumulator = 0;
    updateHud();
    render(time);
    requestAnimationFrame(frame);
  }

  function isInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest(
      "button, input, textarea, select, a[href], summary, [contenteditable='true'], [role='button'], [role='link']"
    ));
  }

  document.addEventListener("keydown", (event) => {
    if (isInteractiveTarget(event.target)) return;
    if (event.code === "KeyP" || event.code === "Escape") {
      if (event.code === "Escape" && (pendingBuild || commandMode !== "move")) {
        event.preventDefault(); setCommandMode("move"); return;
      }
      if (ui.dialog.open) return;
      event.preventDefault(); togglePause(); return;
    }
    if (mode === "replay") return;
    if (event.code === "KeyM") { event.preventDefault(); setCommandMode("move"); }
    else if (event.code === "KeyA") { event.preventDefault(); setCommandMode("attack"); }
    else if (event.code === "KeyG") { event.preventDefault(); setCommandMode("gather"); }
    else if (event.code === "KeyS") {
      event.preventDefault(); const ids = selectedIdArray(); if (ids.length) queueCommand({ t: "stop", ids });
    }
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!state || mode === "replay" || paused) return;
    issueAt(canvasPoint(event), true);
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (!state || mode === "replay" || paused || event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    if (pendingBuild || commandMode === "attack" || commandMode === "gather") {
      issueAt(point, false);
      return;
    }
    pointerDown = true;
    dragStart = point;
    dragCurrent = point;
    audio.ensure();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pointerDown) return;
    event.preventDefault();
    dragCurrent = canvasPoint(event);
  });

  canvas.addEventListener("pointerup", (event) => {
    if (!pointerDown) return;
    event.preventDefault();
    const end = canvasPoint(event);
    const dx = Math.abs(end.x - dragStart.x);
    const dy = Math.abs(end.y - dragStart.y);
    if (dx < 5 && dy < 5) selectAt(end, event.shiftKey);
    else selectBox(dragStart, end, event.shiftKey);
    pointerDown = false;
    dragStart = null;
    dragCurrent = null;
  });

  canvas.addEventListener("pointercancel", () => {
    pointerDown = false; dragStart = null; dragCurrent = null;
  });

  globalThis.addEventListener("blur", () => {
    pointerDown = false; dragStart = null; dragCurrent = null;
    if (state && !paused && !state.gameOver && mode === "live") togglePause();
  });

  function openReplayDialog(withCurrent) {
    if (withCurrent && recorder) {
      try {
        ui.replayText.value = core.encodeReplay(recorder);
        const digest = recordingTerminalDigest || (state ? core.stateDigest(state) : "--------");
        const boundary = recordingStopped ? " · recorder sealed" : "";
        ui.replayMeta.textContent = `${recorder.ticks.toLocaleString()} ticks · ${recorder.entries.length.toLocaleString()} command frames · seed ${core.seedHex(recorder.seed)} · digest ${digest}${boundary}`;
      } catch (error) { ui.replayMeta.textContent = error.message; }
    } else if (!withCurrent) {
      ui.replayText.value = "";
      ui.replayMeta.textContent = "Paste a replay code to inspect it.";
    }
    if (!ui.dialog.open) ui.dialog.showModal();
    ui.replayText.focus();
  }

  function inspectReplayText() {
    const value = ui.replayText.value.trim();
    if (!value) { ui.replayMeta.textContent = "No replay loaded."; return null; }
    try {
      const parsed = core.decodeReplay(value);
      ui.replayMeta.textContent = `VALID · ${parsed.ticks.toLocaleString()} ticks · ${parsed.entries.length.toLocaleString()} command frames · seed ${core.seedHex(parsed.seed)} · engine v${parsed.version}`;
      return parsed;
    } catch (error) {
      ui.replayMeta.textContent = `INVALID · ${error.message}`;
      return null;
    }
  }

  async function copyCurrentReplay() {
    if (!recorder) { ui.replayMeta.textContent = "Only a live campaign can be exported."; return; }
    const code = core.encodeReplay(recorder);
    ui.replayText.value = code;
    let copied = false;
    if (navigator.clipboard && globalThis.isSecureContext) {
      try { await navigator.clipboard.writeText(code); copied = true; } catch (_error) { copied = false; }
    }
    if (!copied) { ui.replayText.select(); copied = document.execCommand("copy"); }
    ui.replayMeta.textContent = copied
      ? `COPIED · ${recorder.ticks.toLocaleString()} ticks · ${recorder.entries.length.toLocaleString()} command frames · no state snapshot`
      : "Replay generated. Select the code and copy it manually.";
    setStatus(`Command replay generated at tick ${recorder.ticks.toLocaleString()}.`);
  }

  ui.start.addEventListener("click", () => startLive(ui.seedInput.value));
  ui.seedInput.addEventListener("keydown", (event) => { if (event.key === "Enter") startLive(ui.seedInput.value); });
  ui.randomSeed.addEventListener("click", randomSeedText);
  ui.pause.addEventListener("click", togglePause);
  ui.restart.addEventListener("click", restartCurrentSeed);
  ui.replay.addEventListener("click", () => openReplayDialog(true));
  ui.loadReplay.addEventListener("click", () => openReplayDialog(false));
  ui.introReplay.addEventListener("click", () => openReplayDialog(false));
  ui.copyReplay.addEventListener("click", copyCurrentReplay);
  ui.watchReplay.addEventListener("click", () => { const parsed = inspectReplayText(); if (parsed) startReplay(parsed); });
  ui.replayText.addEventListener("input", inspectReplayText);
  ui.sound.addEventListener("click", () => {
    const enabled = audio.toggle();
    ui.sound.textContent = `SOUND: ${enabled ? "ON" : "OFF"}`;
    ui.sound.setAttribute("aria-pressed", String(enabled));
  });
  ui.moveMode.addEventListener("click", () => setCommandMode("move"));
  ui.attackMode.addEventListener("click", () => setCommandMode("attack"));
  ui.gatherMode.addEventListener("click", () => setCommandMode("gather"));
  ui.stop.addEventListener("click", () => { const ids = selectedIdArray(); if (ids.length) queueCommand({ t: "stop", ids }); });
  ui.trainDrone.addEventListener("click", () => queueCommand({ t: "train", kind: "drone" }));
  ui.trainRanger.addEventListener("click", () => queueCommand({ t: "train", kind: "ranger" }));
  ui.trainTank.addEventListener("click", () => queueCommand({ t: "train", kind: "tank" }));
  ui.buildRelay.addEventListener("click", () => setBuildMode("relay"));
  ui.buildRefinery.addEventListener("click", () => setBuildMode("refinery"));
  ui.buildFactory.addEventListener("click", () => setBuildMode("factory"));
  ui.buildTurret.addEventListener("click", () => setBuildMode("turret"));

  const seedFromHash = location.hash.match(/^#seed=([0-9a-f]{8})$/i);
  if (seedFromHash) ui.seedInput.value = `0x${seedFromHash[1].toUpperCase()}`;
  updateCommandMode();
  updateHud();
  render(performance.now());
  requestAnimationFrame(frame);
})();
