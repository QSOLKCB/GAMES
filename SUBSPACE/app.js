(function launchInertiaZero() {
  "use strict";

  const Core = window.InertiaZeroCore;
  if (!Core) throw new Error("InertiaZeroCore failed to load");

  const VERSION = "1.0.0";
  const FIXED_STEP = 1 / 60;
  const MAX_FRAME_DELTA = 0.08;
  const PLAYER_TEAM = 1;
  const ENEMY_TEAM = 2;
  const STORAGE_KEY = "qsol-inertia-zero-settings-v1";
  const SCORE_KEY = "qsol-inertia-zero-best-v1";

  const $ = (selector) => document.querySelector(selector);
  const nodes = {
    app: $("#app"),
    canvas: $("#game-canvas"),
    radar: $("#radar-canvas"),
    hud: $("#hud"),
    menu: $("#menu"),
    shipGrid: $("#ship-grid"),
    difficulty: $("#difficulty-select"),
    difficultyDescription: $("#difficulty-description"),
    botCount: $("#bot-count-select"),
    arena: $("#arena-select"),
    seed: $("#seed-input"),
    randomSeed: $("#random-seed"),
    launch: $("#launch-button"),
    helpButton: $("#help-button"),
    helpOverlay: $("#help-overlay"),
    closeHelp: $("#close-help"),
    pauseButton: $("#pause-button"),
    pauseOverlay: $("#pause-overlay"),
    resume: $("#resume-button"),
    restart: $("#restart-button"),
    menuButton: $("#menu-button"),
    sectorOverlay: $("#sector-overlay"),
    nextSector: $("#next-sector-button"),
    gameoverOverlay: $("#gameover-overlay"),
    retry: $("#retry-button"),
    gameoverMenu: $("#gameover-menu-button"),
    toast: $("#toast"),
    combatFeed: $("#combat-feed"),
    hudSector: $("#hud-sector"),
    hudArena: $("#hud-arena"),
    hudScore: $("#hud-score"),
    hudKills: $("#hud-kills"),
    hudLives: $("#hud-lives"),
    hudObjective: $("#hud-objective"),
    hudObjectiveDetail: $("#hud-objective-detail"),
    objectiveProgress: $("#objective-progress"),
    hudAI: $("#hud-ai"),
    hudSeed: $("#hud-seed"),
    hudFPS: $("#hud-fps"),
    hudShip: $("#hud-ship"),
    hudRole: $("#hud-role"),
    hudShipIcon: $("#hud-ship-icon"),
    hudEnergyText: $("#hud-energy-text"),
    energyFill: $("#energy-fill"),
    systemGun: $("#system-gun"),
    systemSecondary: $("#system-secondary"),
    systemSpecial: $("#system-special"),
    systemRepel: $("#system-repel"),
    resultScore: $("#result-score"),
    resultKills: $("#result-kills"),
    resultAccuracy: $("#result-accuracy"),
    nextSectorCopy: $("#next-sector-copy"),
    finalScore: $("#final-score"),
    finalSector: $("#final-sector"),
    finalKills: $("#final-kills"),
    bestScoreCopy: $("#best-score-copy")
  };

  class InputController {
    constructor(game) {
      this.game = game;
      this.keys = new Set();
      this.pressed = new Set();
      this.pointerPrimary = false;
      this.pointerSecondary = false;
      this.gamepadWasActive = false;
      this.bind();
    }

    bind() {
      const controlledKeys = new Set([
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab",
        "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "KeyW", "KeyA",
        "KeyS", "KeyD", "KeyX", "KeyQ", "KeyR", "KeyP", "Escape", "KeyM"
      ]);
      window.addEventListener("keydown", (event) => {
        if (controlledKeys.has(event.code) && this.game.mode === "playing") event.preventDefault();
        if (!this.keys.has(event.code)) this.pressed.add(event.code);
        this.keys.add(event.code);
        if ((event.code === "KeyP" || event.code === "Escape") && !event.repeat) {
          if (this.game.mode === "playing" || this.game.mode === "paused") this.game.togglePause();
        }
        if (event.code === "KeyM" && !event.repeat && this.game.mode !== "menu") {
          this.game.audio.toggleMute();
          this.game.toast(this.game.audio.muted ? "AUDIO MUTED" : "AUDIO RESTORED");
        }
      }, { passive: false });
      window.addEventListener("keyup", (event) => this.keys.delete(event.code));
      window.addEventListener("blur", () => {
        this.keys.clear();
        this.pointerPrimary = false;
        this.pointerSecondary = false;
        if (this.game.mode === "playing") this.game.pause();
      });
      nodes.canvas.addEventListener("pointerdown", (event) => {
        if (this.game.mode !== "playing") return;
        if (event.button === 0) this.pointerPrimary = true;
        if (event.button === 2) this.pointerSecondary = true;
        this.game.audio.ensure();
      });
      window.addEventListener("pointerup", (event) => {
        if (event.button === 0) this.pointerPrimary = false;
        if (event.button === 2) this.pointerSecondary = false;
      });
      nodes.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    }

    down(...codes) {
      return codes.some((code) => this.keys.has(code));
    }

    consume(code) {
      const present = this.pressed.has(code);
      this.pressed.delete(code);
      return present;
    }

    sample() {
      const command = {
        turn: (this.down("KeyD", "ArrowRight") ? 1 : 0) - (this.down("KeyA", "ArrowLeft") ? 1 : 0),
        thrust: this.down("KeyW", "ArrowUp"),
        reverse: this.down("KeyS", "ArrowDown"),
        boost: this.down("ShiftLeft", "ShiftRight"),
        fire: this.down("Space", "ControlLeft", "ControlRight") || this.pointerPrimary,
        secondary: this.down("KeyX", "Tab") || this.pointerSecondary,
        special: this.down("KeyQ"),
        repel: this.down("KeyR")
      };

      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = Array.from(pads).find(Boolean);
      if (pad) {
        const axisX = Math.abs(pad.axes[0] || 0) > 0.18 ? pad.axes[0] : 0;
        if (axisX) command.turn = Core.clamp(axisX, -1, 1);
        command.thrust ||= (pad.axes[1] || 0) < -0.25 || Boolean(pad.buttons[7]?.pressed);
        command.reverse ||= (pad.axes[1] || 0) > 0.25 || Boolean(pad.buttons[6]?.pressed);
        command.fire ||= Boolean(pad.buttons[0]?.pressed);
        command.secondary ||= Boolean(pad.buttons[1]?.pressed);
        command.special ||= Boolean(pad.buttons[2]?.pressed);
        command.repel ||= Boolean(pad.buttons[3]?.pressed);
        command.boost ||= Boolean(pad.buttons[5]?.pressed);
        if (!this.gamepadWasActive && pad.buttons.some((button) => button.pressed)) {
          this.gamepadWasActive = true;
          this.game.toast("GAMEPAD LINKED");
        }
      }
      return command;
    }

    endTick() {
      this.pressed.clear();
    }
  }

  class AudioEngine {
    constructor() {
      this.context = null;
      this.master = null;
      this.muted = false;
      this.lastPlayed = new Map();
    }

    ensure() {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = 0.34;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") this.context.resume();
    }

    toggleMute() {
      this.ensure();
      this.muted = !this.muted;
      if (this.master && this.context) {
        this.master.gain.cancelScheduledValues(this.context.currentTime);
        this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.34, this.context.currentTime + 0.05);
      }
    }

    canPlay(name, interval) {
      if (!this.context || this.muted) return false;
      const now = this.context.currentTime;
      const previous = this.lastPlayed.get(name) || -Infinity;
      if (now - previous < interval) return false;
      this.lastPlayed.set(name, now);
      return true;
    }

    tone(name, frequency, duration, options) {
      this.ensure();
      const settings = options || {};
      if (!this.canPlay(name, settings.throttle ?? 0.025)) return;
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      oscillator.type = settings.type || "square";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(25, settings.endFrequency || frequency * 0.72), now + duration);
      filter.type = "lowpass";
      filter.frequency.value = settings.filter || 2600;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(settings.volume || 0.08, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    }

    noise(name, duration, volume) {
      this.ensure();
      if (!this.canPlay(name, 0.055)) return;
      const length = Math.floor(this.context.sampleRate * duration);
      const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let state = Core.hashSeed(`${name}:${Math.floor(this.context.currentTime * 20)}`);
      for (let index = 0; index < length; index += 1) {
        state = Math.imul(state ^ (state >>> 15), 1 | state) >>> 0;
        data[index] = ((state / 4294967296) * 2 - 1) * (1 - index / length);
      }
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      gain.gain.value = volume || 0.12;
      source.buffer = buffer;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start();
    }

    play(name) {
      if (name === "gun") this.tone("gun", 360, 0.075, { endFrequency: 130, volume: 0.05, throttle: 0.035 });
      else if (name === "bomb") this.tone("bomb", 150, 0.18, { endFrequency: 52, volume: 0.09, type: "sawtooth", filter: 1100, throttle: 0.09 });
      else if (name === "hit") this.tone("hit", 210, 0.07, { endFrequency: 80, volume: 0.045, type: "triangle", throttle: 0.045 });
      else if (name === "pickup") this.tone("pickup", 520, 0.2, { endFrequency: 1040, volume: 0.06, type: "sine", throttle: 0.08 });
      else if (name === "special") this.tone("special", 95, 0.36, { endFrequency: 760, volume: 0.08, type: "sawtooth", filter: 1700, throttle: 0.16 });
      else if (name === "warning") this.tone("warning", 280, 0.22, { endFrequency: 230, volume: 0.055, type: "square", throttle: 0.5 });
      else if (name === "explode") {
        this.noise("explode", 0.38, 0.16);
        this.tone("explode-tone", 92, 0.4, { endFrequency: 28, volume: 0.1, type: "sawtooth", throttle: 0.05 });
      }
    }
  }

  class InertiaZeroGame {
    constructor() {
      this.ctx = nodes.canvas.getContext("2d", { alpha: false });
      this.radarCtx = nodes.radar.getContext("2d");
      this.audio = new AudioEngine();
      this.input = new InputController(this);
      this.mode = "menu";
      this.settings = {
        ship: "warbird",
        difficulty: "ace",
        botCount: 4,
        arena: "mixed",
        seed: "ADELAIDE-ZERO-PING"
      };
      this.level = 1;
      this.score = 0;
      this.totalKills = 0;
      this.lives = 4;
      this.levelStartScore = 0;
      this.levelStartKills = 0;
      this.shotsFired = 0;
      this.shotsHit = 0;
      this.hitShotIds = new Set();
      this.levelShotsFired = 0;
      this.levelShotsHit = 0;
      this.entityId = 1;
      this.simulationTime = 0;
      this.arena = null;
      this.navigationArena = null;
      this.navigationObstacles = [];
      this.rng = new Core.RNG("INERTIA-ZERO-BOOT");
      this.menuArena = Core.generateArena("INERTIA-ZERO-MENU", 1, "open");
      this.ships = [];
      this.projectiles = [];
      this.particles = [];
      this.pickups = [];
      this.player = null;
      this.objectiveState = null;
      this.camera = { x: 0, y: 0, shake: 0 };
      this.width = 1280;
      this.height = 720;
      this.dpr = 1;
      this.lastFrame = performance.now();
      this.accumulator = 0;
      this.fps = 60;
      this.toastTimer = 0;
      this.feedEntries = [];
      this.attractTime = 0;
      this.resize();
      this.buildMenu();
      this.bindUI();
      this.restoreSettings();
      requestAnimationFrame((time) => this.frame(time));
    }

    buildMenu() {
      const shapes = {
        warbird: "28,2 47,35 28,28 9,35",
        javelin: "28,1 40,38 28,31 16,38",
        spider: "28,5 35,18 51,10 42,26 50,38 30,31 28,39 26,31 6,38 14,26 5,10 21,18",
        leviathan: "28,3 48,20 45,38 35,31 28,39 21,31 11,38 8,20",
        terrier: "28,3 36,13 49,14 42,35 31,29 28,39 25,29 14,35 7,14 20,13",
        weasel: "28,2 36,24 44,35 30,30 28,40 26,30 12,35 20,24",
        lancaster: "28,2 39,12 46,37 31,30 28,40 25,30 10,37 17,12",
        shark: "28,4 47,17 40,23 50,37 31,29 28,40 25,29 6,37 16,23 9,17"
      };
      nodes.shipGrid.innerHTML = Object.values(Core.SHIPS).map((ship, index) => `
        <button class="ship-card${ship.id === this.settings.ship ? " is-selected" : ""}" type="button"
          aria-pressed="${ship.id === this.settings.ship}" data-ship="${ship.id}" style="--ship-color:${ship.accent}">
          <span class="ship-card-top"><span class="ship-number">HULL 0${index + 1}</span>
            <svg class="mini-ship" viewBox="0 0 56 42" aria-hidden="true"><polygon points="${shapes[ship.id]}" fill="rgba(5,12,14,.9)" stroke="currentColor" stroke-width="1.4"/><line x1="28" y1="7" x2="28" y2="31" stroke="currentColor" opacity=".45"/></svg>
          </span>
          <b>${ship.name}</b><small>${ship.role}</small><span class="selected-mark">SELECTED</span>
        </button>`).join("");
      nodes.difficulty.innerHTML = Object.values(Core.DIFFICULTIES)
        .map((difficulty) => `<option value="${difficulty.id}">${difficulty.name} — ${difficulty.id === "sovereign" ? "maximum threat" : difficulty.summary.split(".")[0].toLowerCase()}</option>`)
        .join("");
      nodes.arena.innerHTML = Object.values(Core.ARENA_STYLES)
        .map((arena) => `<option value="${arena.id}">${arena.name}</option>`)
        .join("");
    }

    bindUI() {
      nodes.shipGrid.addEventListener("click", (event) => {
        const card = event.target.closest("[data-ship]");
        if (!card) return;
        this.settings.ship = card.dataset.ship;
        this.syncMenu();
      });
      nodes.difficulty.addEventListener("change", () => {
        this.settings.difficulty = nodes.difficulty.value;
        this.syncMenu();
      });
      nodes.botCount.addEventListener("change", () => { this.settings.botCount = Number(nodes.botCount.value); });
      nodes.arena.addEventListener("change", () => { this.settings.arena = nodes.arena.value; });
      nodes.seed.addEventListener("input", () => { this.settings.seed = this.cleanSeed(nodes.seed.value); });
      nodes.randomSeed.addEventListener("click", () => {
        const words = ["ADELAIDE", "NULL-PING", "DARK-LATTICE", "RIFT", "VOID", "QUANTUM", "IRON", "ECHO", "ORBIT", "NEXUS"];
        const random = new Uint32Array(2);
        crypto.getRandomValues(random);
        this.settings.seed = `${words[random[0] % words.length]}-${words[random[1] % words.length]}-${(random[0] ^ random[1]).toString(16).slice(0, 4).toUpperCase()}`;
        nodes.seed.value = this.settings.seed;
      });
      nodes.launch.addEventListener("click", () => this.startRun());
      nodes.helpButton.addEventListener("click", () => {
        nodes.helpOverlay.hidden = false;
        nodes.closeHelp.focus?.();
      });
      nodes.closeHelp.addEventListener("click", () => {
        nodes.helpOverlay.hidden = true;
        nodes.helpButton.focus?.();
      });
      nodes.helpOverlay.addEventListener("click", (event) => {
        if (event.target === nodes.helpOverlay) {
          nodes.helpOverlay.hidden = true;
          nodes.helpButton.focus?.();
        }
      });
      window.addEventListener("keydown", (event) => {
        if (event.code === "Escape" && !nodes.helpOverlay.hidden) {
          event.preventDefault();
          nodes.helpOverlay.hidden = true;
          nodes.helpButton.focus?.();
        }
      });
      nodes.pauseButton.addEventListener("click", () => this.pause());
      nodes.resume.addEventListener("click", () => this.resume());
      nodes.restart.addEventListener("click", () => {
        nodes.pauseOverlay.hidden = true;
        this.restartSector();
      });
      nodes.menuButton.addEventListener("click", () => this.returnToMenu());
      nodes.nextSector.addEventListener("click", () => {
        nodes.sectorOverlay.hidden = true;
        this.level += 1;
        if (this.level > 1 && this.level % 3 === 1) this.lives = Math.min(6, this.lives + 1);
        this.loadLevel();
      });
      nodes.retry.addEventListener("click", () => {
        nodes.gameoverOverlay.hidden = true;
        this.startRun();
      });
      nodes.gameoverMenu.addEventListener("click", () => this.returnToMenu());
      window.addEventListener("resize", () => this.resize());
    }

    cleanSeed(value) {
      return String(value || "INERTIA-ZERO").toUpperCase().replace(/[^A-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 36) || "INERTIA-ZERO";
    }

    restoreSettings() {
      try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (stored && Core.SHIPS[stored.ship] && Core.DIFFICULTIES[stored.difficulty] && Core.ARENA_STYLES[stored.arena]) {
          Object.assign(this.settings, stored);
        }
      } catch (error) {
        // Storage is optional; private/local-file contexts may reject access.
      }
      this.syncMenu();
    }

    saveSettings() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      } catch (error) {
        // The game remains fully functional without persistent settings.
      }
    }

    syncMenu() {
      nodes.shipGrid.querySelectorAll("[data-ship]").forEach((card) => {
        const selected = card.dataset.ship === this.settings.ship;
        card.classList.toggle("is-selected", selected);
        card.setAttribute("aria-pressed", String(selected));
      });
      nodes.difficulty.value = this.settings.difficulty;
      nodes.botCount.value = String(this.settings.botCount);
      nodes.arena.value = this.settings.arena;
      nodes.seed.value = this.settings.seed;
      nodes.difficultyDescription.textContent = Core.DIFFICULTIES[this.settings.difficulty].summary;
    }

    resize() {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      nodes.canvas.width = Math.floor(this.width * this.dpr);
      nodes.canvas.height = Math.floor(this.height * this.dpr);
      nodes.canvas.style.width = `${this.width}px`;
      nodes.canvas.style.height = `${this.height}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    startRun() {
      this.settings.ship = this.settings.ship || "warbird";
      this.settings.difficulty = nodes.difficulty.value;
      this.settings.botCount = Number(nodes.botCount.value);
      this.settings.arena = nodes.arena.value;
      this.settings.seed = this.cleanSeed(nodes.seed.value);
      this.saveSettings();
      this.audio.ensure();
      this.level = 1;
      this.score = 0;
      this.totalKills = 0;
      this.lives = 4;
      this.shotsFired = 0;
      this.shotsHit = 0;
      this.hitShotIds.clear();
      this.entityId = 1;
      nodes.menu.hidden = true;
      nodes.helpOverlay.hidden = true;
      nodes.gameoverOverlay.hidden = true;
      nodes.sectorOverlay.hidden = true;
      nodes.hud.hidden = false;
      nodes.pauseButton.hidden = false;
      nodes.app.classList.remove("is-menu");
      this.loadLevel();
    }

    restartSector() {
      if (this.lives <= 0) {
        this.endGame();
        return;
      }
      this.score = this.levelStartScore;
      this.totalKills = this.levelStartKills;
      this.loadLevel();
    }

    loadLevel() {
      this.rng = new Core.RNG(`${this.settings.seed}:${this.level}:simulation`);
      this.arena = Core.generateArena(this.settings.seed, this.level, this.settings.arena);
      this.arenaFingerprint = Core.arenaFingerprint(this.arena);
      this.ships.length = 0;
      this.projectiles.length = 0;
      this.particles.length = 0;
      this.pickups.length = 0;
      this.simulationTime = 0;
      this.levelStartScore = this.score;
      this.levelStartKills = this.totalKills;
      this.levelShotsFired = 0;
      this.levelShotsHit = 0;
      this.feedEntries.length = 0;
      nodes.combatFeed.innerHTML = "";

      this.player = this.createShip(
        this.settings.ship,
        PLAYER_TEAM,
        this.arena.playerSpawn.x,
        this.arena.playerSpawn.y,
        0,
        true,
        this.settings.difficulty
      );
      this.player.invulnerable = 2.25;
      this.ships.push(this.player);

      const botTotal = Math.min(13, this.settings.botCount + Math.floor((this.level - 1) * 0.65));
      const shipIds = Object.keys(Core.SHIPS);
      const shuffledShips = this.rng.shuffle(shipIds);
      for (let index = 0; index < botTotal; index += 1) {
        const spawn = this.arena.enemySpawns[index % this.arena.enemySpawns.length];
        const angle = Math.atan2(this.arena.playerSpawn.y - spawn.y, this.arena.playerSpawn.x - spawn.x);
        const ship = this.createShip(
          shuffledShips[(index + this.level) % shuffledShips.length],
          ENEMY_TEAM,
          spawn.x + this.rng.range(-45, 45),
          spawn.y + this.rng.range(-45, 45),
          angle,
          false,
          this.settings.difficulty
        );
        ship.callsign = this.makeCallsign(index);
        ship.invulnerable = 1.2 + index * 0.05;
        this.ships.push(ship);
      }

      this.objectiveState = this.createObjectiveState(botTotal);
      this.navigationObstacles = this.arena.obstacles.slice();
      if (this.objectiveState.type === "core") {
        this.navigationObstacles.push({
          type: "circle",
          x: this.arena.objective.x,
          y: this.arena.objective.y,
          r: this.arena.objective.radius,
          kind: "rift-core"
        });
      }
      this.navigationArena = { ...this.arena, obstacles: this.navigationObstacles };
      this.createPickups(9 + Math.min(7, this.level));
      this.camera.x = this.player.x;
      this.camera.y = this.player.y;
      this.camera.shake = 0;
      this.mode = "playing";
      this.accumulator = 0;
      this.lastFrame = performance.now();
      this.updateHUD(true);
      this.addFeed(`SECTOR <b>${String(this.level).padStart(2, "0")}</b> LINKED`);
      this.toast(`${this.arena.styleName.toUpperCase()} // ${this.objectiveLabel()}`);
    }

    createShip(type, team, x, y, angle, isPlayer, difficultyId) {
      const config = Core.SHIPS[type];
      const brainSeed = `${this.settings.seed}:${this.level}:pilot:${this.entityId}`;
      return {
        id: this.entityId++,
        type,
        config,
        team,
        x,
        y,
        previousX: x,
        previousY: y,
        vx: 0,
        vy: 0,
        angle,
        energy: config.maxEnergy,
        alive: true,
        isPlayer,
        callsign: isPlayer ? "TRENT" : "HOSTILE",
        control: this.emptyCommand(),
        gunCooldown: 0,
        secondaryCooldown: 0,
        specialCooldown: 0,
        repelCooldown: 0,
        invulnerable: 0,
        rechargeLock: 0,
        stun: 0,
        flash: 0,
        cloak: 0,
        barrier: 0,
        overdrive: 0,
        dash: 0,
        multifire: 0,
        respawnTimer: 0,
        boostHeat: 0,
        ai: isPlayer ? null : {
          difficulty: Core.DIFFICULTIES[difficultyId],
          rng: new Core.RNG(brainSeed),
          thinkTimer: 0,
          pathTimer: 0,
          path: [],
          aimBias: 0,
          ordnanceTimer: 0,
          orbitSign: this.entityId % 2 ? 1 : -1,
          lastKnown: { x: this.arena?.playerSpawn.x || x, y: this.arena?.playerSpawn.y || y },
          command: this.emptyCommand()
        }
      };
    }

    emptyCommand() {
      return { turn: 0, thrust: false, reverse: false, boost: false, fire: false, secondary: false, special: false, repel: false };
    }

    makeCallsign(index) {
      const prefixes = ["VECTOR", "CINDER", "NULL", "GHOST", "IRON", "ORBIT", "RIFT", "EMBER", "STATIC", "ECHO", "DUSK", "LATTICE"];
      return `${prefixes[(index + this.level * 2) % prefixes.length]}-${String(index + 1).padStart(2, "0")}`;
    }

    createObjectiveState(enemyCount) {
      const type = this.arena.objective.type;
      if (type === "elimination") return { type, initial: enemyCount, remaining: enemyCount, progress: 0 };
      if (type === "control") return { type, required: 18 + this.level * 1.5, held: 0, contested: false, progress: 0 };
      if (type === "core") return { type, maxEnergy: 1800 + this.level * 260, energy: 1800 + this.level * 260, progress: 0, flash: 0 };
      return { type, duration: 42 + Math.min(18, this.level * 2), remaining: 42 + Math.min(18, this.level * 2), spawnTimer: 7, progress: 0 };
    }

    createPickups(count) {
      let attempts = 0;
      while (this.pickups.length < count && attempts < count * 30) {
        attempts += 1;
        const point = {
          x: this.rng.range(240, this.arena.width - 240),
          y: this.rng.range(180, this.arena.height - 180)
        };
        if (Core.pointBlocked(point, this.navigationObstacles, 42)) continue;
        if (Core.distanceSquared(point, this.arena.playerSpawn) < 160 * 160) continue;
        this.pickups.push({ id: this.entityId++, x: point.x, y: point.y, phase: this.rng.range(0, Core.TAU), type: this.rng.chance(0.22) ? "system" : "energy", alive: true });
      }
    }

    frame(time) {
      const delta = Math.min(MAX_FRAME_DELTA, Math.max(0, (time - this.lastFrame) / 1000));
      this.lastFrame = time;
      this.fps += ((delta > 0 ? 1 / delta : 60) - this.fps) * 0.06;
      this.attractTime += delta;
      if (this.mode === "playing") {
        this.accumulator += delta;
        let steps = 0;
        while (this.accumulator >= FIXED_STEP && steps < 6 && this.mode === "playing") {
          this.update(FIXED_STEP);
          this.accumulator -= FIXED_STEP;
          steps += 1;
        }
        if (this.mode !== "playing") this.accumulator = 0;
        if (steps === 6) this.accumulator = 0;
      }
      this.render(this.accumulator / FIXED_STEP);
      if (this.toastTimer > 0) {
        this.toastTimer -= delta;
        if (this.toastTimer <= 0) nodes.toast.classList.remove("is-visible");
      }
      requestAnimationFrame((nextTime) => this.frame(nextTime));
    }

    update(dt) {
      this.simulationTime += dt;
      this.player.control = this.player.alive ? this.input.sample() : this.emptyCommand();
      for (const ship of this.ships) {
        if (!ship.alive) continue;
        if (!ship.isPlayer) this.updateAI(ship, dt);
        this.updateShip(ship, dt);
      }
      this.updateProjectiles(dt);
      this.updatePickups(dt);
      this.updateParticles(dt);
      this.updateObjective(dt);
      this.updateRespawns(dt);
      this.updateCamera(dt);
      this.input.endTick();
      this.updateHUD(false);
    }

    updateShip(ship, dt) {
      const config = ship.config;
      ship.gunCooldown = Math.max(0, ship.gunCooldown - dt);
      ship.secondaryCooldown = Math.max(0, ship.secondaryCooldown - dt);
      ship.specialCooldown = Math.max(0, ship.specialCooldown - dt);
      ship.repelCooldown = Math.max(0, ship.repelCooldown - dt);
      ship.invulnerable = Math.max(0, ship.invulnerable - dt);
      ship.rechargeLock = Math.max(0, ship.rechargeLock - dt);
      ship.stun = Math.max(0, ship.stun - dt);
      ship.flash = Math.max(0, ship.flash - dt);
      ship.cloak = Math.max(0, ship.cloak - dt);
      ship.barrier = Math.max(0, ship.barrier - dt);
      ship.overdrive = Math.max(0, ship.overdrive - dt);
      ship.dash = Math.max(0, ship.dash - dt);
      ship.multifire = Math.max(0, ship.multifire - dt);

      if (ship.rechargeLock <= 0) {
        const rechargeScale = ship.overdrive > 0 ? 1.28 : 1;
        ship.energy = Math.min(config.maxEnergy, ship.energy + config.recharge * rechargeScale * dt);
      }
      if (ship.cloak > 0) {
        ship.energy = Math.max(1, ship.energy - 21 * dt);
        if (ship.energy <= config.maxEnergy * 0.08) ship.cloak = 0;
      }

      const control = ship.stun > 0 ? this.emptyCommand() : ship.control;
      const overdriveScale = ship.overdrive > 0 ? 1.17 : 1;
      let thrustScale = overdriveScale;
      let speedScale = overdriveScale * (ship.dash > 0 ? 1.92 : 1);
      const boosting = control.boost && ship.energy > 80;
      if (boosting) {
        const boostDrain = 118 * dt;
        ship.energy = Math.max(1, ship.energy - boostDrain);
        thrustScale *= 1.48;
        speedScale *= 1.34;
        ship.boostHeat = Math.min(1, ship.boostHeat + dt * 2.5);
      } else {
        ship.boostHeat = Math.max(0, ship.boostHeat - dt * 1.8);
      }

      ship.angle += control.turn * config.turnRate * dt;
      ship.angle = (ship.angle + Core.TAU) % Core.TAU;
      const forwardX = Math.cos(ship.angle);
      const forwardY = Math.sin(ship.angle);
      if (control.thrust) {
        const acceleration = config.thrust / config.mass * thrustScale;
        ship.vx += forwardX * acceleration * dt;
        ship.vy += forwardY * acceleration * dt;
      }
      if (control.reverse) {
        const acceleration = config.thrust / config.mass * config.reverse;
        ship.vx -= forwardX * acceleration * dt;
        ship.vy -= forwardY * acceleration * dt;
      }

      const drag = Math.pow(config.drag, dt * 60);
      ship.vx *= drag;
      ship.vy *= drag;
      const speed = Math.hypot(ship.vx, ship.vy);
      const maximumSpeed = config.maxSpeed * speedScale;
      if (speed > maximumSpeed) {
        const ratio = maximumSpeed / speed;
        ship.vx *= ratio;
        ship.vy *= ratio;
      }

      ship.previousX = ship.x;
      ship.previousY = ship.y;
      ship.x += ship.vx * dt;
      ship.y += ship.vy * dt;
      this.resolveShipWorldCollision(ship);

      if (control.special) this.useSpecial(ship);
      if (control.fire) this.firePrimary(ship);
      if (control.secondary) this.fireSecondary(ship);
      if (control.repel) this.activateRepel(ship);
    }

    firePrimary(ship) {
      const config = ship.config;
      if (ship.gunCooldown > 0 || ship.energy <= config.gunCost + 12) return false;
      const cooldownScale = ship.overdrive > 0 ? 0.62 : 1;
      ship.gunCooldown = config.gunCooldown * cooldownScale;
      ship.energy -= config.gunCost;
      ship.cloak = 0;
      let shots = [{ angle: 0, lateral: 0 }];
      if (ship.type === "terrier") {
        shots = ship.multifire > 0
          ? [
            { angle: -0.065, lateral: -8 }, { angle: -0.018, lateral: -4.5 },
            { angle: 0.018, lateral: 4.5 }, { angle: 0.065, lateral: 8 }
          ]
          : [{ angle: 0, lateral: -7.5 }, { angle: 0, lateral: 7.5 }];
      } else if (ship.multifire > 0) {
        shots = [{ angle: -0.085, lateral: 0 }, { angle: 0, lateral: 0 }, { angle: 0.085, lateral: 0 }];
      }
      for (const shot of shots) this.spawnBullet(ship, shot.angle, shot.lateral);
      if (ship.isPlayer) {
        this.shotsFired += shots.length;
        this.levelShotsFired += shots.length;
        this.audio.play("gun");
      }
      return true;
    }

    spawnBullet(ship, angleOffset, lateralOffset) {
      const config = ship.config;
      const angle = ship.angle + angleOffset;
      const sideX = -Math.sin(ship.angle);
      const sideY = Math.cos(ship.angle);
      const nose = config.radius + 8;
      const x = ship.x + Math.cos(ship.angle) * nose + sideX * lateralOffset;
      const y = ship.y + Math.sin(ship.angle) * nose + sideY * lateralOffset;
      this.projectiles.push({
        id: this.entityId++,
        ownerId: ship.id,
        team: ship.team,
        kind: "gun",
        x,
        y,
        previousX: x,
        previousY: y,
        vx: ship.vx + Math.cos(angle) * config.gunSpeed,
        vy: ship.vy + Math.sin(angle) * config.gunSpeed,
        radius: 3,
        damage: config.gunDamage,
        life: 1.42,
        color: ship.team === PLAYER_TEAM ? "#efcf82" : "#d97c6c",
        countsForAccuracy: ship.isPlayer,
        hitRegistered: false,
        remove: false
      });
    }

    fireSecondary(ship, forcedType, powerScale) {
      const config = ship.config;
      const type = forcedType || config.secondary;
      const scale = powerScale || 1;
      if (!forcedType && (ship.secondaryCooldown > 0 || ship.energy <= config.secondaryCost + 20)) return false;
      if (!forcedType) {
        ship.secondaryCooldown = config.secondaryCooldown;
        ship.energy -= config.secondaryCost;
        ship.cloak = 0;
      }
      const profiles = {
        bomb: { speed: 465, damage: 330, radius: 105, fuse: 2.4, size: 7 },
        heavyBomb: { speed: 365, damage: 650, radius: 185, fuse: 2.9, size: 11 },
        cluster: { speed: 430, damage: 280, radius: 112, fuse: 2.15, size: 8 },
        mine: { speed: 62, damage: 390, radius: 135, fuse: 13, size: 9, arm: 0.62 },
        empBomb: { speed: 420, damage: 240, radius: 125, fuse: 2.4, size: 8, emp: 3.4 },
        bounceBomb: { speed: 455, damage: 360, radius: 112, fuse: 3.1, size: 8, bounces: 1 }
      };
      const profile = profiles[type] || profiles.bomb;
      const angle = ship.angle;
      const nose = config.radius + profile.size + 4;
      const x = ship.x + Math.cos(ship.angle) * nose;
      const y = ship.y + Math.sin(ship.angle) * nose;
      this.projectiles.push({
        id: this.entityId++,
        ownerId: ship.id,
        team: ship.team,
        kind: type,
        x,
        y,
        previousX: x,
        previousY: y,
        vx: ship.vx + Math.cos(angle) * profile.speed,
        vy: ship.vy + Math.sin(angle) * profile.speed,
        radius: profile.size,
        damage: profile.damage * scale,
        explosionRadius: profile.radius * Math.sqrt(scale),
        life: profile.fuse,
        arm: profile.arm || 0,
        emp: profile.emp || 0,
        bounces: profile.bounces || 0,
        color: ship.team === PLAYER_TEAM ? "#e8bd68" : "#d36f62",
        countsForAccuracy: ship.isPlayer && !forcedType,
        hitRegistered: false,
        remove: false
      });
      if (ship.isPlayer && !forcedType) {
        this.shotsFired += 1;
        this.levelShotsFired += 1;
        this.audio.play("bomb");
      }
      return true;
    }

    useSpecial(ship) {
      const config = ship.config;
      if (ship.specialCooldown > 0 || ship.energy <= config.specialCost + 30) return false;
      ship.specialCooldown = config.specialCooldown;
      ship.energy -= config.specialCost;
      ship.cloak = 0;
      switch (config.special) {
        case "overdrive":
          ship.overdrive = 4.6;
          break;
        case "dash": {
          ship.dash = 0.42;
          ship.vx += Math.cos(ship.angle) * 390;
          ship.vy += Math.sin(ship.angle) * 390;
          ship.invulnerable = Math.max(ship.invulnerable, 0.28);
          this.spawnParticles(ship.x, ship.y, config.accent, 18, 280);
          break;
        }
        case "cloak":
          ship.cloak = 6.2;
          break;
        case "siege":
          this.fireSecondary(ship, "heavyBomb", 1.35);
          break;
        case "multifire":
          ship.multifire = 6;
          break;
        case "emp":
          this.emitEMP(ship, 360, 3.8);
          break;
        case "barrier":
          ship.barrier = 5.2;
          break;
        case "repulse":
          this.performRepel(ship, 325, 570);
          break;
        default:
          ship.overdrive = 3;
      }
      if (ship.isPlayer) {
        this.audio.play("special");
        this.toast(`${config.special.toUpperCase()} ONLINE`);
      }
      return true;
    }

    emitEMP(ship, radius, duration) {
      for (const target of this.ships) {
        if (!target.alive || target.team === ship.team) continue;
        const distance = Math.sqrt(Core.distanceSquared(ship, target));
        if (distance > radius + target.config.radius) continue;
        target.rechargeLock = Math.max(target.rechargeLock, duration * (1 - distance / (radius * 1.4)));
        target.stun = Math.max(target.stun, 0.22);
        this.applyDamage(target, 65 * (1 - distance / (radius * 1.2)), ship.team, ship.id, "emp");
      }
      this.spawnPulse(ship.x, ship.y, radius, "#82b9c3");
    }

    activateRepel(ship) {
      if (ship.repelCooldown > 0 || ship.energy <= 195) return false;
      ship.repelCooldown = ship.type === "shark" ? 3.8 : 5.6;
      ship.energy -= 180;
      this.performRepel(ship, ship.type === "shark" ? 300 : 240, ship.type === "shark" ? 540 : 445);
      if (ship.isPlayer) this.audio.play("special");
      return true;
    }

    performRepel(ship, radius, force) {
      for (const target of this.ships) {
        if (!target.alive || target.id === ship.id || target.team === ship.team) continue;
        const dx = target.x - ship.x;
        const dy = target.y - ship.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        if (distance > radius) continue;
        const strength = force * (1 - distance / radius);
        target.vx += dx / distance * strength;
        target.vy += dy / distance * strength;
      }
      for (const projectile of this.projectiles) {
        if (projectile.remove || projectile.team === ship.team) continue;
        const dx = projectile.x - ship.x;
        const dy = projectile.y - ship.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        if (distance > radius) continue;
        const speed = Math.max(320, Math.hypot(projectile.vx, projectile.vy));
        projectile.vx = dx / distance * speed;
        projectile.vy = dy / distance * speed;
        projectile.team = ship.team;
        projectile.ownerId = ship.id;
        projectile.color = ship.team === PLAYER_TEAM ? "#efcf82" : "#d97c6c";
      }
      this.spawnPulse(ship.x, ship.y, radius, ship.config.accent);
    }

    resolveShipWorldCollision(ship) {
      const radius = ship.config.radius;
      const restitution = 0.76;
      if (ship.x < radius) {
        ship.x = radius;
        if (ship.vx < 0) ship.vx = -ship.vx * restitution;
      } else if (ship.x > this.arena.width - radius) {
        ship.x = this.arena.width - radius;
        if (ship.vx > 0) ship.vx = -ship.vx * restitution;
      }
      if (ship.y < radius) {
        ship.y = radius;
        if (ship.vy < 0) ship.vy = -ship.vy * restitution;
      } else if (ship.y > this.arena.height - radius) {
        ship.y = this.arena.height - radius;
        if (ship.vy > 0) ship.vy = -ship.vy * restitution;
      }

      for (const obstacle of this.arena.obstacles) {
        let normalX = 0;
        let normalY = 0;
        let penetration = 0;
        if (obstacle.type === "circle") {
          const dx = ship.x - obstacle.x;
          const dy = ship.y - obstacle.y;
          const distance = Math.max(0.001, Math.hypot(dx, dy));
          const minimum = radius + obstacle.r;
          if (distance >= minimum) continue;
          normalX = dx / distance;
          normalY = dy / distance;
          penetration = minimum - distance;
        } else {
          const closestX = Core.clamp(ship.x, obstacle.x, obstacle.x + obstacle.w);
          const closestY = Core.clamp(ship.y, obstacle.y, obstacle.y + obstacle.h);
          let dx = ship.x - closestX;
          let dy = ship.y - closestY;
          let distance = Math.hypot(dx, dy);
          if (distance >= radius) continue;
          if (distance < 0.001) {
            const choices = [
              { value: Math.abs(ship.x - obstacle.x), x: -1, y: 0 },
              { value: Math.abs(obstacle.x + obstacle.w - ship.x), x: 1, y: 0 },
              { value: Math.abs(ship.y - obstacle.y), x: 0, y: -1 },
              { value: Math.abs(obstacle.y + obstacle.h - ship.y), x: 0, y: 1 }
            ].sort((a, b) => a.value - b.value);
            normalX = choices[0].x;
            normalY = choices[0].y;
            penetration = radius + choices[0].value;
          } else {
            normalX = dx / distance;
            normalY = dy / distance;
            penetration = radius - distance;
          }
        }
        ship.x += normalX * penetration;
        ship.y += normalY * penetration;
        const normalVelocity = ship.vx * normalX + ship.vy * normalY;
        if (normalVelocity < 0) {
          ship.vx -= (1 + restitution) * normalVelocity * normalX;
          ship.vy -= (1 + restitution) * normalVelocity * normalY;
        }
      }
      if (this.objectiveState?.type === "core" && this.objectiveState.energy > 0) {
        const core = this.arena.objective;
        const dx = ship.x - core.x;
        const dy = ship.y - core.y;
        const distance = Math.max(0.001, Math.hypot(dx, dy));
        const minimum = radius + core.radius;
        if (distance < minimum) {
          const normalX = dx / distance;
          const normalY = dy / distance;
          ship.x += normalX * (minimum - distance);
          ship.y += normalY * (minimum - distance);
          const normalVelocity = ship.vx * normalX + ship.vy * normalY;
          if (normalVelocity < 0) {
            ship.vx -= (1 + restitution) * normalVelocity * normalX;
            ship.vy -= (1 + restitution) * normalVelocity * normalY;
          }
        }
      }
    }

    updateProjectiles(dt) {
      for (const projectile of this.projectiles) {
        if (projectile.remove) continue;
        projectile.life -= dt;
        if (projectile.arm > 0) projectile.arm -= dt;
        projectile.previousX = projectile.x;
        projectile.previousY = projectile.y;

        if (projectile.kind === "mine") {
          projectile.vx *= Math.pow(0.93, dt * 60);
          projectile.vy *= Math.pow(0.93, dt * 60);
        }
        projectile.x += projectile.vx * dt;
        projectile.y += projectile.vy * dt;

        if (projectile.x < -30 || projectile.y < -30 || projectile.x > this.arena.width + 30 || projectile.y > this.arena.height + 30) {
          if (projectile.kind !== "gun" && projectile.kind !== "shard") this.explodeProjectile(projectile);
          projectile.remove = true;
          continue;
        }

        if (this.objectiveState?.type === "core" && this.objectiveState.energy > 0) {
          const core = { x: this.arena.objective.x, y: this.arena.objective.y, r: this.arena.objective.radius };
          if (Core.segmentCircleIntersects({ x: projectile.previousX, y: projectile.previousY }, projectile, core, projectile.radius)) {
            if (projectile.team === PLAYER_TEAM) this.registerProjectileHit(projectile);
            if (projectile.kind === "gun" || projectile.kind === "shard") {
              if (projectile.team === PLAYER_TEAM) this.damageCore(projectile.damage);
              projectile.remove = true;
              this.spawnParticles(projectile.x, projectile.y, projectile.color, 4, 90);
            } else {
              this.explodeProjectile(projectile);
            }
            continue;
          }
        }

        const obstacle = this.projectileObstacle(projectile);
        if (obstacle) {
          if (projectile.bounces > 0) {
            this.bounceProjectile(projectile, obstacle);
            projectile.bounces -= 1;
          } else if (projectile.kind === "gun" || projectile.kind === "shard") {
            projectile.remove = true;
            this.spawnParticles(projectile.x, projectile.y, projectile.color, 3, 80);
          } else {
            this.explodeProjectile(projectile);
          }
          continue;
        }

        let hit = null;
        for (const ship of this.ships) {
          if (!ship.alive || ship.team === projectile.team || ship.invulnerable > 0) continue;
          if (Core.segmentCircleIntersects(
            { x: projectile.previousX, y: projectile.previousY },
            projectile,
            { x: ship.x, y: ship.y, r: ship.config.radius },
            projectile.radius
          )) {
            hit = ship;
            break;
          }
        }

        if (hit) {
          this.registerProjectileHit(projectile);
          if (projectile.kind === "gun" || projectile.kind === "shard") {
            this.applyDamage(hit, projectile.damage, projectile.team, projectile.ownerId, projectile.kind);
            projectile.remove = true;
            this.spawnParticles(projectile.x, projectile.y, projectile.color, 5, 120);
            if (hit.isPlayer) this.audio.play("hit");
          } else {
            this.explodeProjectile(projectile);
          }
          continue;
        }

        if (projectile.kind === "mine" && projectile.arm <= 0) {
          const target = this.ships.find((ship) => ship.alive && ship.team !== projectile.team && Core.distanceSquared(ship, projectile) < 112 * 112);
          if (target) {
            this.registerProjectileHit(projectile);
            this.explodeProjectile(projectile);
            continue;
          }
        }
        if (projectile.life <= 0) {
          if (projectile.kind === "gun" || projectile.kind === "shard") projectile.remove = true;
          else this.explodeProjectile(projectile);
        }
      }
      this.projectiles = this.projectiles.filter((projectile) => !projectile.remove);
    }

    projectileObstacle(projectile) {
      const start = { x: projectile.previousX, y: projectile.previousY };
      for (const obstacle of this.arena.obstacles) {
        if (obstacle.type === "circle") {
          if (Core.segmentCircleIntersects(start, projectile, obstacle, projectile.radius)) return obstacle;
        } else if (Core.segmentRectIntersects(start, projectile, obstacle, projectile.radius)) {
          return obstacle;
        }
      }
      return null;
    }

    bounceProjectile(projectile, obstacle) {
      projectile.x = projectile.previousX;
      projectile.y = projectile.previousY;
      if (obstacle.type === "circle") {
        const dx = projectile.x - obstacle.x;
        const dy = projectile.y - obstacle.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const nx = dx / distance;
        const ny = dy / distance;
        const dot = projectile.vx * nx + projectile.vy * ny;
        projectile.vx -= 2 * dot * nx;
        projectile.vy -= 2 * dot * ny;
      } else {
        const cameFromSide = projectile.previousX < obstacle.x || projectile.previousX > obstacle.x + obstacle.w;
        if (cameFromSide) projectile.vx *= -1;
        else projectile.vy *= -1;
      }
      projectile.x += projectile.vx * FIXED_STEP * 0.3;
      projectile.y += projectile.vy * FIXED_STEP * 0.3;
      this.spawnParticles(projectile.x, projectile.y, projectile.color, 5, 100);
    }

    explodeProjectile(projectile) {
      if (projectile.remove) return;
      projectile.remove = true;
      const radius = projectile.explosionRadius || 90;
      let damagedHostile = false;
      for (const ship of this.ships) {
        if (!ship.alive || ship.team === projectile.team || ship.invulnerable > 0) continue;
        const distance = Math.hypot(ship.x - projectile.x, ship.y - projectile.y);
        if (distance > radius + ship.config.radius) continue;
        const falloff = Core.clamp(1 - distance / (radius + ship.config.radius), 0.18, 1);
        damagedHostile = this.applyDamage(ship, projectile.damage * falloff, projectile.team, projectile.ownerId, projectile.kind) || damagedHostile;
        if (projectile.emp) ship.rechargeLock = Math.max(ship.rechargeLock, projectile.emp * falloff);
      }
      if (damagedHostile) this.registerProjectileHit(projectile);
      if (this.objectiveState?.type === "core" && projectile.team === PLAYER_TEAM) {
        const distance = Math.hypot(this.arena.objective.x - projectile.x, this.arena.objective.y - projectile.y);
        if (distance < radius + this.arena.objective.radius) {
          const falloff = Core.clamp(1 - distance / (radius + this.arena.objective.radius), 0.2, 1);
          this.damageCore(projectile.damage * falloff);
          this.registerProjectileHit(projectile);
        }
      }
      if (projectile.kind === "cluster") {
        for (let index = 0; index < 9; index += 1) {
          const angle = index / 9 * Core.TAU + projectile.id * 0.19;
          this.projectiles.push({
            id: this.entityId++, ownerId: projectile.ownerId, team: projectile.team, kind: "shard",
            x: projectile.x, y: projectile.y, previousX: projectile.x, previousY: projectile.y,
            vx: projectile.vx * 0.18 + Math.cos(angle) * 560,
            vy: projectile.vy * 0.18 + Math.sin(angle) * 560,
            radius: 2.5, damage: 62, life: 0.62, color: projectile.color,
            rootId: projectile.rootId || projectile.id,
            countsForAccuracy: projectile.countsForAccuracy,
            hitRegistered: false, remove: false
          });
        }
      }
      this.spawnParticles(projectile.x, projectile.y, projectile.color, Math.min(32, 12 + Math.floor(radius / 10)), 260);
      this.spawnPulse(projectile.x, projectile.y, radius, projectile.color);
      if (this.player && Math.hypot(this.player.x - projectile.x, this.player.y - projectile.y) < 600) {
        this.camera.shake = Math.max(this.camera.shake, Math.min(16, radius * 0.075));
        this.audio.play("explode");
      }
    }

    registerProjectileHit(projectile) {
      const rootId = projectile.rootId || projectile.id;
      if (projectile.hitRegistered || this.hitShotIds.has(rootId)) return;
      projectile.hitRegistered = true;
      this.hitShotIds.add(rootId);
      if (projectile.countsForAccuracy) {
        this.shotsHit += 1;
        this.levelShotsHit += 1;
      }
    }

    applyDamage(ship, rawDamage, sourceTeam, sourceId, kind) {
      if (!ship.alive || ship.invulnerable > 0 || rawDamage <= 0) return false;
      let damage = rawDamage;
      if (ship.barrier > 0) damage *= 0.42;
      ship.energy -= damage;
      ship.flash = 0.13;
      if (kind === "emp" || kind === "empBomb") ship.rechargeLock = Math.max(ship.rechargeLock, 2.2);
      if (ship.energy <= 0) this.destroyShip(ship, sourceTeam, sourceId);
      return true;
    }

    destroyShip(ship, sourceTeam, sourceId) {
      if (!ship.alive) return;
      ship.alive = false;
      ship.energy = 0;
      ship.respawnTimer = ship.isPlayer ? 2.35 : 0;
      this.spawnParticles(ship.x, ship.y, ship.team === PLAYER_TEAM ? "#e8bd68" : "#d36f62", 42, 390);
      this.spawnPulse(ship.x, ship.y, 155, ship.team === PLAYER_TEAM ? "#e8bd68" : "#d36f62");
      this.camera.shake = Math.max(this.camera.shake, ship.isPlayer ? 19 : 11);
      this.audio.play("explode");
      if (ship.isPlayer) {
        this.lives -= 1;
        this.addFeed("<b>PLAYER HULL</b> DESTROYED");
        this.audio.play("warning");
      } else {
        const base = Math.round(360 + ship.config.maxEnergy * 0.22 + this.level * 35);
        const multiplier = Core.DIFFICULTIES[this.settings.difficulty].scoreScale;
        this.score += Math.round(base * multiplier);
        this.totalKills += 1;
        if (this.objectiveState?.type === "elimination") this.objectiveState.remaining = Math.max(0, this.objectiveState.remaining - 1);
        this.addFeed(`<b>${ship.callsign}</b> NEUTRALISED`);
        if (this.rng.chance(0.28)) {
          this.pickups.push({ id: this.entityId++, x: ship.x, y: ship.y, phase: this.rng.range(0, Core.TAU), type: this.rng.chance(0.25) ? "system" : "energy", alive: true });
        }
      }
    }

    damageCore(amount) {
      if (this.objectiveState?.type !== "core" || this.objectiveState.energy <= 0) return;
      this.objectiveState.energy = Math.max(0, this.objectiveState.energy - amount);
      this.objectiveState.flash = 0.14;
      this.score += Math.round(amount * 0.35);
      this.camera.shake = Math.max(this.camera.shake, 4);
    }

    updatePickups(dt) {
      for (const pickup of this.pickups) {
        if (!pickup.alive) continue;
        pickup.phase += dt * 1.8;
        for (const ship of this.ships) {
          if (!ship.alive || Core.distanceSquared(ship, pickup) > (ship.config.radius + 13) ** 2) continue;
          pickup.alive = false;
          if (pickup.type === "energy") ship.energy = Math.min(ship.config.maxEnergy, ship.energy + ship.config.maxEnergy * 0.28);
          else {
            ship.specialCooldown *= 0.45;
            ship.repelCooldown *= 0.45;
            ship.energy = Math.min(ship.config.maxEnergy, ship.energy + ship.config.maxEnergy * 0.12);
          }
          if (ship.isPlayer) {
            this.score += pickup.type === "energy" ? 60 : 110;
            this.audio.play("pickup");
            this.toast(pickup.type === "energy" ? "ENERGY RESTORED" : "SYSTEM COOLDOWN REDUCED");
          }
          break;
        }
      }
      this.pickups = this.pickups.filter((pickup) => pickup.alive);
    }

    spawnParticles(x, y, color, count, speed) {
      for (let index = 0; index < count; index += 1) {
        const angle = this.rng.range(0, Core.TAU);
        const velocity = this.rng.range(speed * 0.15, speed);
        const life = this.rng.range(0.18, 0.65);
        this.particles.push({
          type: "spark", x, y, previousX: x, previousY: y,
          vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity,
          life, maxLife: life, color, size: this.rng.range(1, 3.2)
        });
      }
    }

    spawnPulse(x, y, radius, color) {
      this.particles.push({ type: "pulse", x, y, life: 0.42, maxLife: 0.42, radius, color });
    }

    updateParticles(dt) {
      for (const particle of this.particles) {
        particle.life -= dt;
        if (particle.type === "spark") {
          particle.previousX = particle.x;
          particle.previousY = particle.y;
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          particle.vx *= Math.pow(0.96, dt * 60);
          particle.vy *= Math.pow(0.96, dt * 60);
        }
      }
      this.particles = this.particles.filter((particle) => particle.life > 0);
    }

    updateObjective(dt) {
      const state = this.objectiveState;
      if (!state || this.mode !== "playing") return;
      if (!this.player.alive && this.lives <= 0) return;
      if (state.flash) state.flash = Math.max(0, state.flash - dt);
      if (state.type === "elimination") {
        state.progress = 1 - state.remaining / Math.max(1, state.initial);
        if (state.remaining <= 0) this.completeLevel();
      } else if (state.type === "control") {
        const objective = this.arena.objective;
        const playerInside = this.player.alive && Core.distanceSquared(this.player, objective) <= objective.radius ** 2;
        const enemiesInside = this.ships.filter((ship) => ship.alive && ship.team === ENEMY_TEAM && Core.distanceSquared(ship, objective) <= (objective.radius + ship.config.radius) ** 2).length;
        state.contested = enemiesInside > 0;
        if (playerInside && enemiesInside === 0) state.held += dt;
        else if (enemiesInside > 0) state.held = Math.max(0, state.held - dt * 0.36);
        else state.held = Math.max(0, state.held - dt * 0.1);
        state.progress = Core.clamp(state.held / state.required, 0, 1);
        if (state.held >= state.required) this.completeLevel();
      } else if (state.type === "core") {
        state.progress = 1 - state.energy / state.maxEnergy;
        if (state.energy <= 0) this.completeLevel();
      } else if (state.type === "survival") {
        state.remaining = Math.max(0, state.remaining - dt);
        state.spawnTimer -= dt;
        const livingEnemies = this.ships.filter((ship) => ship.alive && ship.team === ENEMY_TEAM).length;
        const desired = Math.min(12, this.settings.botCount + Math.floor(this.level * 0.45));
        if (state.spawnTimer <= 0 && livingEnemies < desired) {
          this.spawnReinforcement();
          state.spawnTimer = Math.max(4.5, 8.2 - this.level * 0.18);
        }
        state.progress = 1 - state.remaining / state.duration;
        if (state.remaining <= 0 && this.player.alive) this.completeLevel();
      }
    }

    spawnReinforcement() {
      const spawn = this.rng.pick(this.arena.enemySpawns);
      const shipId = this.rng.pick(Object.keys(Core.SHIPS));
      const bot = this.createShip(
        shipId, ENEMY_TEAM, spawn.x + this.rng.range(-30, 30), spawn.y + this.rng.range(-30, 30),
        Math.atan2(this.player.y - spawn.y, this.player.x - spawn.x), false, this.settings.difficulty
      );
      bot.callsign = this.makeCallsign(this.ships.length);
      bot.invulnerable = 1.15;
      this.ships.push(bot);
      this.addFeed(`<b>${bot.callsign}</b> ENTERED THE GRID`);
    }

    updateRespawns(dt) {
      if (this.player.alive) return;
      this.player.respawnTimer -= dt;
      if (this.player.respawnTimer > 0) return;
      if (this.lives <= 0) {
        this.endGame();
        return;
      }
      const spawn = this.arena.playerSpawn;
      Object.assign(this.player, {
        x: spawn.x, y: spawn.y, previousX: spawn.x, previousY: spawn.y,
        vx: 0, vy: 0, angle: 0, energy: this.player.config.maxEnergy,
        alive: true, invulnerable: 2.6, rechargeLock: 0, stun: 0,
        cloak: 0, barrier: 0, overdrive: 0, dash: 0, multifire: 0,
        gunCooldown: 0, secondaryCooldown: 0, specialCooldown: 0, repelCooldown: 0,
        boostHeat: 0, flash: 0, control: this.emptyCommand()
      });
      this.addFeed("<b>PLAYER HULL</b> RESTORED");
      this.toast(`RESPAWN COMPLETE // ${this.lives} HULL${this.lives === 1 ? "" : "S"} REMAIN`);
    }

    updateCamera(dt) {
      const target = this.player?.alive ? this.player : this.arena?.playerSpawn;
      if (!target || !this.arena) return;
      const halfWidth = this.width * 0.5;
      const halfHeight = this.height * 0.5;
      const desiredX = Core.clamp(target.x, Math.min(halfWidth, this.arena.width * 0.5), Math.max(this.arena.width - halfWidth, this.arena.width * 0.5));
      const desiredY = Core.clamp(target.y, Math.min(halfHeight, this.arena.height * 0.5), Math.max(this.arena.height - halfHeight, this.arena.height * 0.5));
      const smoothing = 1 - Math.exp(-dt * 7.5);
      this.camera.x = Core.lerp(this.camera.x, desiredX, smoothing);
      this.camera.y = Core.lerp(this.camera.y, desiredY, smoothing);
      this.camera.shake = Math.max(0, this.camera.shake - dt * 20);
    }

    completeLevel() {
      if (this.mode !== "playing") return;
      this.mode = "levelComplete";
      const timeBonus = Math.round(Math.max(0, 2400 - this.simulationTime * 22));
      this.score += timeBonus;
      const accuracy = this.levelShotsFired ? Math.round(this.levelShotsHit / this.levelShotsFired * 100) : 0;
      nodes.resultScore.textContent = String(this.score - this.levelStartScore).padStart(5, "0");
      nodes.resultKills.textContent = String(this.totalKills - this.levelStartKills).padStart(2, "0");
      nodes.resultAccuracy.textContent = `${accuracy}%`;
      nodes.nextSectorCopy.textContent = this.level % 3 === 0
        ? "Reserve command has issued one additional hull for the next sector."
        : `Sector ${String(this.level + 1).padStart(2, "0")} will derive a fresh arena from ${this.settings.seed}.`;
      nodes.sectorOverlay.hidden = false;
      nodes.nextSector.focus?.();
      this.audio.play("special");
    }

    endGame() {
      if (this.mode === "gameover") return;
      this.mode = "gameover";
      let previousBest = 0;
      try {
        previousBest = Number(localStorage.getItem(SCORE_KEY)) || 0;
        if (this.score > previousBest) localStorage.setItem(SCORE_KEY, String(this.score));
      } catch (error) {
        // Score persistence is optional.
      }
      nodes.finalScore.textContent = String(this.score).padStart(6, "0");
      nodes.finalSector.textContent = String(this.level).padStart(2, "0");
      nodes.finalKills.textContent = String(this.totalKills).padStart(2, "0");
      nodes.bestScoreCopy.textContent = this.score > previousBest
        ? `New local campaign record: ${this.score.toLocaleString()}.`
        : `Local record: ${previousBest.toLocaleString()}. Seed: ${this.settings.seed}.`;
      nodes.gameoverOverlay.hidden = false;
      nodes.retry.focus?.();
    }

    updateAI(ship, dt) {
      const brain = ship.ai;
      const difficulty = brain.difficulty;
      brain.thinkTimer -= dt;
      brain.pathTimer -= dt;
      brain.ordnanceTimer = Math.max(0, brain.ordnanceTimer - dt);
      if (brain.thinkTimer > 0) {
        ship.control = brain.command;
        return;
      }
      brain.thinkTimer = difficulty.reaction * brain.rng.range(0.88, 1.12);

      if (!this.player.alive) {
        brain.command = this.emptyCommand();
        brain.command.thrust = true;
        brain.command.turn = brain.orbitSign * 0.45;
        ship.control = brain.command;
        return;
      }

      const target = this.player;
      const dx = target.x - ship.x;
      const dy = target.y - ship.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const detectionRange = 150 + difficulty.prediction * 470;
      const targetVisible = target.cloak <= 0 || distance < detectionRange;
      if (targetVisible) {
        brain.lastKnown.x = target.x;
        brain.lastKnown.y = target.y;
      }

      const strategicTarget = this.objectiveState?.type === "control" && distance > 480
        ? { x: this.arena.objective.x, y: this.arena.objective.y, vx: 0, vy: 0 }
        : targetVisible
          ? target
          : { x: brain.lastKnown.x, y: brain.lastKnown.y, vx: 0, vy: 0 };
      const lineClear = Core.lineOfSight(ship, strategicTarget, this.navigationObstacles, ship.config.radius + 8);
      let navigationTarget = strategicTarget;
      if (!lineClear) {
        if (brain.pathTimer <= 0 || !brain.path.length) {
          brain.path = Core.findPath(ship, strategicTarget, this.navigationArena, 90);
          brain.pathTimer = difficulty.pathInterval;
        }
        while (brain.path.length && Core.distanceSquared(ship, brain.path[0]) < 78 * 78) brain.path.shift();
        if (brain.path.length) navigationTarget = brain.path[0];
      } else {
        brain.path.length = 0;
      }

      const intercept = Core.solveIntercept(ship, target, ship.config.gunSpeed);
      const prediction = targetVisible ? difficulty.prediction : 0;
      const aimPoint = {
        x: Core.lerp(target.x, intercept.x, prediction),
        y: Core.lerp(target.y, intercept.y, prediction)
      };
      const desiredAim = Math.atan2(aimPoint.y - ship.y, aimPoint.x - ship.x);
      const aimErrorTarget = (brain.rng.next() * 2 - 1) * difficulty.aimError;
      brain.aimBias = Core.lerp(brain.aimBias, aimErrorTarget, 0.18 + (1 - difficulty.prediction) * 0.16);
      const biasedAim = desiredAim + brain.aimBias;
      const aimDelta = Core.angleDelta(ship.angle, biasedAim);
      const threat = this.findIncomingThreat(ship, difficulty);
      const secondarySpeeds = { bomb: 465, heavyBomb: 365, cluster: 430, mine: 62, empBomb: 420, bounceBomb: 455 };
      const secondaryRadii = { bomb: 7, heavyBomb: 11, cluster: 8, mine: 9, empBomb: 8, bounceBomb: 8 };
      const secondaryIntercept = Core.solveIntercept(ship, target, secondarySpeeds[ship.config.secondary] || 420);
      const secondaryAimPoint = {
        x: Core.lerp(target.x, secondaryIntercept.x, prediction),
        y: Core.lerp(target.y, secondaryIntercept.y, prediction)
      };
      const secondaryAim = Math.atan2(secondaryAimPoint.y - ship.y, secondaryAimPoint.x - ship.x) + brain.aimBias * 0.7;
      const secondaryAimDelta = Core.angleDelta(ship.angle, secondaryAim);
      const energyRatio = ship.energy / ship.config.maxEnergy;
      const minimumOrdnanceRange = ship.config.secondary === "mine" ? 80 : 155;
      const maximumOrdnanceRange = ship.config.secondary === "heavyBomb" ? 820 : ship.config.secondary === "mine" ? 310 : 650;
      const ordnanceReady = ship.secondaryCooldown <= 0
        && distance > minimumOrdnanceRange
        && distance < maximumOrdnanceRange
        && ship.energy > ship.config.secondaryCost + ship.config.maxEnergy * difficulty.reserve;
      if (!ordnanceReady) brain.ordnanceTimer = 0;
      else if (brain.ordnanceTimer <= 0 && brain.rng.chance(0.25 + difficulty.aggression * 0.38)) brain.ordnanceTimer = 0.48 + difficulty.prediction * 0.32;
      const secondaryIntent = ordnanceReady && brain.ordnanceTimer > 0;
      const combatAim = secondaryIntent ? secondaryAim : biasedAim;
      const gunLine = targetVisible && Core.lineOfSight(ship, aimPoint, this.navigationObstacles, 3);
      const secondaryLine = targetVisible && Core.lineOfSight(
        ship,
        secondaryAimPoint,
        this.navigationObstacles,
        secondaryRadii[ship.config.secondary] || 8
      );

      const preferred = ship.config.preferredRange;
      let moveX = navigationTarget.x - ship.x;
      let moveY = navigationTarget.y - ship.y;
      if (lineClear && strategicTarget === target) {
        const radialX = dx / distance;
        const radialY = dy / distance;
        const orbitX = -radialY * brain.orbitSign;
        const orbitY = radialX * brain.orbitSign;
        const rangeError = Core.clamp((distance - preferred) / preferred, -1, 1);
        const spacingOffset = difficulty.spacing * (((ship.id % 3) - 1) * 0.32);
        moveX = radialX * rangeError * 1.25 + orbitX * (0.65 + spacingOffset);
        moveY = radialY * rangeError * 1.25 + orbitY * (0.65 + spacingOffset);
      }

      const avoidance = this.obstacleAvoidance(ship);
      moveX += avoidance.x * (1.2 + difficulty.prediction);
      moveY += avoidance.y * (1.2 + difficulty.prediction);
      if (threat) {
        moveX += threat.dodgeX * (2.2 + difficulty.dodge * 2.8);
        moveY += threat.dodgeY * (2.2 + difficulty.dodge * 2.8);
      }

      let desiredMove = Math.atan2(moveY, moveX);
      const weaponLine = gunLine || (secondaryIntent && secondaryLine);
      const hasFiringWindow = weaponLine && distance < 920;
      if (hasFiringWindow && (distance < preferred * 1.45 || difficulty.prediction > 0.85)) {
        const aimWeight = difficulty.prediction > 0.9 ? 0.76 : 0.58;
        desiredMove = ship.angle + Core.angleDelta(ship.angle, desiredMove) * (1 - aimWeight)
          + Core.angleDelta(ship.angle, combatAim) * aimWeight;
      }
      let moveDelta = Core.angleDelta(ship.angle, desiredMove);
      let command = this.emptyCommand();
      command.turn = Math.abs(moveDelta) < 0.025 ? 0 : Math.sign(moveDelta);
      command.thrust = Math.abs(moveDelta) < 1.15;
      command.reverse = distance < preferred * 0.58 && Math.abs(Core.angleDelta(ship.angle, combatAim)) < 0.85;

      if (difficulty.dodge >= 0.7 && lineClear) {
        const planned = this.planManeuver(ship, target, secondaryIntent ? secondaryAimPoint : aimPoint, threat, difficulty);
        if (planned) {
          command.turn = planned.turn;
          command.thrust = planned.thrust;
          command.reverse = planned.reverse;
        }
      }

      const fireTolerance = 0.045 + difficulty.aimError * 1.45 + (distance < 250 ? 0.08 : 0);
      command.fire = gunLine
        && Math.abs(aimDelta) < fireTolerance
        && distance < Math.min(1050, ship.config.gunSpeed * 1.18)
        && energyRatio > difficulty.reserve;
      command.secondary = secondaryLine && secondaryIntent && Math.abs(secondaryAimDelta) < fireTolerance * 1.9;
      command.boost = distance > preferred * 1.8 && Math.abs(moveDelta) < 0.45 && energyRatio > 0.62;
      command.repel = Boolean(threat && threat.time < 0.32 && difficulty.dodge > 0.38 && ship.energy > 260);
      command.special = this.shouldUseSpecial(ship, target, threat, distance, aimDelta, energyRatio);

      if (ship.config.special === "cloak" && (command.special || (ship.cloak > 1.2 && distance > Math.max(180, preferred * 0.7)))) {
        command.fire = false;
        command.secondary = false;
      }
      if (command.special && ship.config.special === "repulse") command.repel = false;
      const reserveEnergy = ship.config.maxEnergy * difficulty.reserve;
      const actionCost = () => (command.fire ? ship.config.gunCost : 0)
        + (command.secondary ? ship.config.secondaryCost : 0)
        + (command.special ? ship.config.specialCost : 0)
        + (command.repel ? 180 : 0);
      if (ship.energy - actionCost() < reserveEnergy) command.secondary = false;
      if (ship.energy - actionCost() < reserveEnergy) command.fire = false;
      if (ship.energy - actionCost() < reserveEnergy && command.special) command.repel = false;

      if (!targetVisible) {
        command.fire = false;
        command.secondary = false;
        command.special = ship.config.special === "cloak" && energyRatio > 0.7;
      }
      brain.command = command;
      ship.control = command;
    }

    findIncomingThreat(ship, difficulty) {
      let best = null;
      for (const projectile of this.projectiles) {
        if (projectile.remove || projectile.team === ship.team) continue;
        const rx = projectile.x - ship.x;
        const ry = projectile.y - ship.y;
        const vx = projectile.vx - ship.vx;
        const vy = projectile.vy - ship.vy;
        const velocitySquared = vx * vx + vy * vy;
        if (velocitySquared < 1) continue;
        const time = Core.clamp(-(rx * vx + ry * vy) / velocitySquared, 0, 1.35);
        if (time <= 0.015) continue;
        const closestX = rx + vx * time;
        const closestY = ry + vy * time;
        const closest = Math.hypot(closestX, closestY);
        const dangerRadius = ship.config.radius + projectile.radius + (projectile.explosionRadius || 0) * 0.22;
        if (closest > dangerRadius + 34 * difficulty.dodge) continue;
        const score = time + closest * 0.002;
        if (!best || score < best.score) {
          const projectileSpeed = Math.max(1, Math.hypot(vx, vy));
          const side = ((projectile.vx * (ship.y - projectile.y) - projectile.vy * (ship.x - projectile.x)) >= 0 ? 1 : -1)
            * (ship.ai?.orbitSign || 1);
          best = {
            projectile,
            time,
            closest,
            score,
            dodgeX: -vy / projectileSpeed * side,
            dodgeY: vx / projectileSpeed * side
          };
        }
      }
      return best;
    }

    obstacleAvoidance(ship) {
      const lookahead = 120 + Math.hypot(ship.vx, ship.vy) * 0.34;
      const speed = Math.max(1, Math.hypot(ship.vx, ship.vy));
      const predicted = {
        x: ship.x + ship.vx / speed * lookahead,
        y: ship.y + ship.vy / speed * lookahead
      };
      let avoidX = 0;
      let avoidY = 0;
      for (const obstacle of this.navigationObstacles) {
        let closestX;
        let closestY;
        let clearance;
        if (obstacle.type === "circle") {
          const dx = predicted.x - obstacle.x;
          const dy = predicted.y - obstacle.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          closestX = obstacle.x + dx / distance * obstacle.r;
          closestY = obstacle.y + dy / distance * obstacle.r;
          clearance = distance - obstacle.r;
        } else {
          closestX = Core.clamp(predicted.x, obstacle.x, obstacle.x + obstacle.w);
          closestY = Core.clamp(predicted.y, obstacle.y, obstacle.y + obstacle.h);
          clearance = Math.hypot(predicted.x - closestX, predicted.y - closestY);
        }
        const influence = ship.config.radius + 135;
        if (clearance >= influence) continue;
        const dx = predicted.x - closestX;
        const dy = predicted.y - closestY;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const force = 1 - clearance / influence;
        avoidX += dx / distance * force;
        avoidY += dy / distance * force;
      }
      const wall = 150;
      if (predicted.x < wall) avoidX += (wall - predicted.x) / wall;
      if (predicted.x > this.arena.width - wall) avoidX -= (predicted.x - (this.arena.width - wall)) / wall;
      if (predicted.y < wall) avoidY += (wall - predicted.y) / wall;
      if (predicted.y > this.arena.height - wall) avoidY -= (predicted.y - (this.arena.height - wall)) / wall;
      return { x: avoidX, y: avoidY };
    }

    planManeuver(ship, target, aimPoint, threat, difficulty) {
      const turns = [-1, -0.45, 0, 0.45, 1];
      const thrustStates = [false, true];
      const horizon = 0.42 + difficulty.dodge * 0.52;
      const slices = 6;
      let best = null;
      for (const turn of turns) {
        for (const thrust of thrustStates) {
          let x = ship.x;
          let y = ship.y;
          let vx = ship.vx;
          let vy = ship.vy;
          let angle = ship.angle;
          let invalid = false;
          for (let step = 0; step < slices; step += 1) {
            const stepTime = horizon / slices;
            angle += turn * ship.config.turnRate * stepTime;
            if (thrust) {
              vx += Math.cos(angle) * ship.config.thrust / ship.config.mass * stepTime;
              vy += Math.sin(angle) * ship.config.thrust / ship.config.mass * stepTime;
            }
            const speed = Math.hypot(vx, vy);
            if (speed > ship.config.maxSpeed) {
              vx *= ship.config.maxSpeed / speed;
              vy *= ship.config.maxSpeed / speed;
            }
            x += vx * stepTime;
            y += vy * stepTime;
            if (x < ship.config.radius || y < ship.config.radius || x > this.arena.width - ship.config.radius || y > this.arena.height - ship.config.radius
              || Core.pointBlocked({ x, y }, this.navigationObstacles, ship.config.radius + 3)) {
              invalid = true;
              break;
            }
          }
          if (invalid) continue;
          const range = Math.hypot(target.x - x, target.y - y);
          const rangePenalty = Math.abs(range - ship.config.preferredRange) / ship.config.preferredRange;
          const finalAim = Math.atan2(aimPoint.y - y, aimPoint.x - x);
          const aimPenalty = Math.abs(Core.angleDelta(angle, finalAim));
          let threatPenalty = 0;
          if (threat) {
            const projectileX = threat.projectile.x + threat.projectile.vx * horizon;
            const projectileY = threat.projectile.y + threat.projectile.vy * horizon;
            const clearance = Math.hypot(projectileX - x, projectileY - y);
            threatPenalty = Math.max(0, 180 - clearance) / 35;
          }
          const velocityToward = ((target.x - x) * vx + (target.y - y) * vy) / Math.max(1, range * Math.hypot(vx, vy));
          const score = -rangePenalty * 1.7 - aimPenalty * (1.25 + difficulty.prediction) - threatPenalty + velocityToward * 0.18;
          if (!best || score > best.score) best = { score, turn, thrust, reverse: !thrust && range < ship.config.preferredRange * 0.55 && aimPenalty < 0.75 };
        }
      }
      return best;
    }

    shouldUseSpecial(ship, target, threat, distance, aimDelta, energyRatio) {
      if (ship.specialCooldown > 0 || ship.energy <= ship.config.specialCost + ship.config.maxEnergy * ship.ai.difficulty.reserve) return false;
      const special = ship.config.special;
      if (special === "overdrive") return distance < 720 && energyRatio > 0.72 && Math.abs(aimDelta) < 0.65;
      if (special === "dash") return (threat && threat.time < 0.45) || (distance > 850 && energyRatio > 0.74);
      if (special === "cloak") return distance > 260 && distance < 850 && energyRatio > 0.58 && target.cloak <= 0;
      if (special === "siege") return distance > 380 && distance < 780 && Math.abs(aimDelta) < 0.16;
      if (special === "multifire") return distance < 590 && energyRatio > 0.65;
      if (special === "emp") return distance < 345 || Boolean(threat && threat.time < 0.35);
      if (special === "barrier") return energyRatio < 0.48 || Boolean(threat && threat.time < 0.42);
      if (special === "repulse") return distance < 240 || Boolean(threat && threat.time < 0.4);
      return false;
    }

    render(interpolation) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = "#03090b";
      ctx.fillRect(0, 0, this.width, this.height);
      if (this.mode === "menu" || !this.arena) {
        this.renderMenuBackdrop(ctx);
        return;
      }

      this.renderSpaceBackdrop(ctx);
      const shakeX = Math.sin(this.attractTime * 47.3) * this.camera.shake;
      const shakeY = Math.cos(this.attractTime * 39.7) * this.camera.shake * 0.72;
      ctx.save();
      ctx.translate(this.width * 0.5 - this.camera.x + shakeX, this.height * 0.5 - this.camera.y + shakeY);
      this.drawWorldGrid(ctx);
      this.drawObjective(ctx);
      for (const obstacle of this.arena.obstacles) this.drawObstacle(ctx, obstacle);
      for (const pickup of this.pickups) this.drawPickup(ctx, pickup);
      for (const projectile of this.projectiles) this.drawProjectile(ctx, projectile, interpolation);
      for (const ship of this.ships) {
        if (!ship.alive) continue;
        if (!ship.isPlayer && ship.cloak > 0 && this.player?.alive && Core.distanceSquared(ship, this.player) > 250 * 250) continue;
        this.drawShip(ctx, ship, interpolation);
      }
      for (const particle of this.particles) this.drawParticle(ctx, particle);
      ctx.restore();
      this.drawOffscreenIndicators(ctx);
      this.drawRespawnStatus(ctx);
      this.drawRadar();
    }

    renderMenuBackdrop(ctx) {
      const gradient = ctx.createRadialGradient(this.width * 0.72, this.height * 0.18, 40, this.width * 0.72, this.height * 0.18, Math.max(this.width, this.height));
      gradient.addColorStop(0, "#122629");
      gradient.addColorStop(0.38, "#071315");
      gradient.addColorStop(1, "#030709");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.save();
      for (const star of this.menuArena.stars) {
        const x = ((star.x / this.menuArena.width * this.width) - this.attractTime * 4 * star.layer + this.width) % this.width;
        const y = star.y / this.menuArena.height * this.height;
        ctx.globalAlpha = star.alpha * 0.55;
        ctx.fillStyle = star.size > 1.5 ? "#d6c28e" : "#91aaa5";
        ctx.fillRect(x, y, star.size, star.size);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(114,185,173,.055)";
      ctx.lineWidth = 1;
      const spacing = 84;
      const offset = (this.attractTime * 5) % spacing;
      for (let x = -spacing + offset; x < this.width + spacing; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x - this.height * 0.13, this.height);
        ctx.stroke();
      }
      for (let y = 0; y < this.height; y += spacing) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.width, y);
        ctx.stroke();
      }

      const orbitX = this.width * 0.79;
      const orbitY = this.height * 0.57;
      ctx.translate(orbitX, orbitY);
      ctx.rotate(this.attractTime * 0.06);
      ctx.strokeStyle = "rgba(232,189,104,.12)";
      ctx.lineWidth = 1;
      for (const radius of [115, 205, 310]) {
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius * 0.42, 0, 0, Core.TAU);
        ctx.stroke();
      }
      ctx.rotate(-this.attractTime * 0.17);
      this.drawDecorativeHull(ctx, 0, 0, 86);
      ctx.restore();
    }

    drawDecorativeHull(ctx, x, y, size) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.24);
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.65, -size * 0.56);
      ctx.lineTo(-size * 0.35, 0);
      ctx.lineTo(-size * 0.65, size * 0.56);
      ctx.closePath();
      ctx.fillStyle = "rgba(5,13,15,.84)";
      ctx.strokeStyle = "rgba(232,189,104,.28)";
      ctx.lineWidth = 1.3;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(size * 0.7, 0);
      ctx.lineTo(-size * 0.38, 0);
      ctx.strokeStyle = "rgba(114,185,173,.25)";
      ctx.stroke();
      ctx.restore();
    }

    renderSpaceBackdrop(ctx) {
      const gradient = ctx.createRadialGradient(this.width * 0.5, this.height * 0.45, 20, this.width * 0.5, this.height * 0.45, Math.max(this.width, this.height) * 0.78);
      gradient.addColorStop(0, "#081417");
      gradient.addColorStop(1, "#020708");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, this.height);

      const left = this.camera.x - this.width * 0.5;
      const top = this.camera.y - this.height * 0.5;
      for (const nebula of this.arena.nebulae) {
        const x = nebula.x - left;
        const y = nebula.y - top;
        if (x < -nebula.radius || y < -nebula.radius || x > this.width + nebula.radius || y > this.height + nebula.radius) continue;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, nebula.radius);
        glow.addColorStop(0, `hsla(${nebula.hue},35%,32%,${nebula.alpha})`);
        glow.addColorStop(1, `hsla(${nebula.hue},35%,16%,0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(x - nebula.radius, y - nebula.radius, nebula.radius * 2, nebula.radius * 2);
      }
      for (const star of this.arena.stars) {
        const parallaxX = (star.x - this.camera.x * star.layer) % this.arena.width;
        const parallaxY = (star.y - this.camera.y * star.layer) % this.arena.height;
        const x = ((parallaxX + this.arena.width) % this.arena.width) / this.arena.width * this.width;
        const y = ((parallaxY + this.arena.height) % this.arena.height) / this.arena.height * this.height;
        ctx.globalAlpha = star.alpha;
        ctx.fillStyle = star.size > 1.5 ? "#d9c78f" : "#91aaa5";
        ctx.fillRect(x, y, star.size, star.size);
      }
      ctx.globalAlpha = 1;
    }

    drawWorldGrid(ctx) {
      ctx.save();
      ctx.strokeStyle = "rgba(103,145,137,.07)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 15]);
      for (let x = 0; x <= this.arena.width; x += 320) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.arena.height);
        ctx.stroke();
      }
      for (let y = 0; y <= this.arena.height; y += 275) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.arena.width, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(232,189,104,.22)";
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, this.arena.width - 3, this.arena.height - 3);
      ctx.fillStyle = "rgba(132,159,153,.35)";
      ctx.font = "9px monospace";
      for (let x = 160, index = 0; x < this.arena.width; x += 320, index += 1) {
        ctx.fillText(String.fromCharCode(65 + index), x, 17);
      }
      for (let y = 145, index = 1; y < this.arena.height; y += 275, index += 1) {
        ctx.fillText(String(index), 8, y);
      }
      ctx.restore();
    }

    drawObjective(ctx) {
      const objective = this.arena.objective;
      const state = this.objectiveState;
      if (!state) return;
      ctx.save();
      ctx.translate(objective.x, objective.y);
      if (state.type === "control") {
        const pulse = 1 + Math.sin(this.simulationTime * 2.4) * 0.025;
        ctx.strokeStyle = state.contested ? "rgba(211,111,98,.72)" : "rgba(232,189,104,.55)";
        ctx.lineWidth = 2;
        ctx.setLineDash([14, 9]);
        ctx.beginPath();
        ctx.arc(0, 0, objective.radius * pulse, -Math.PI / 2, -Math.PI / 2 + Core.TAU * Math.max(0.035, state.progress));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(114,185,173,.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, objective.radius * 0.72, 0, Core.TAU);
        ctx.stroke();
        ctx.fillStyle = "rgba(232,189,104,.65)";
        ctx.fillRect(-3, -3, 6, 6);
      } else if (state.type === "core") {
        const flash = state.flash > 0;
        const radius = objective.radius;
        ctx.rotate(this.simulationTime * 0.08);
        ctx.beginPath();
        for (let index = 0; index < 6; index += 1) {
          const angle = index / 6 * Core.TAU;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = flash ? "rgba(217,124,108,.32)" : "rgba(27,54,55,.72)";
        ctx.strokeStyle = flash ? "#e18a78" : "rgba(114,185,173,.66)";
        ctx.lineWidth = 3;
        ctx.fill();
        ctx.stroke();
        ctx.rotate(-this.simulationTime * 0.22);
        for (const ring of [0.38, 0.62]) {
          ctx.beginPath();
          ctx.arc(0, 0, radius * ring, 0, Core.TAU);
          ctx.strokeStyle = `rgba(232,189,104,${0.22 + ring * 0.2})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(232,189,104,.8)";
        ctx.beginPath();
        ctx.arc(0, 0, 10 + Math.sin(this.simulationTime * 4) * 2, 0, Core.TAU);
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(114,185,173,.12)";
        ctx.setLineDash([5, 12]);
        ctx.beginPath();
        ctx.arc(0, 0, objective.radius, 0, Core.TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    drawObstacle(ctx, obstacle) {
      if (!this.inView(obstacle.x, obstacle.y, obstacle.type === "circle" ? obstacle.r + 80 : Math.max(obstacle.w, obstacle.h) + 80)) return;
      ctx.save();
      if (obstacle.type === "circle") {
        ctx.translate(obstacle.x, obstacle.y);
        ctx.rotate(obstacle.phase + this.simulationTime * obstacle.spin * 0.07);
        const sides = 8 + (Math.floor(obstacle.r) % 5);
        ctx.beginPath();
        for (let index = 0; index < sides; index += 1) {
          const angle = index / sides * Core.TAU;
          const variation = 0.86 + Math.sin(index * 7.17 + obstacle.phase) * 0.11;
          const x = Math.cos(angle) * obstacle.r * variation;
          const y = Math.sin(angle) * obstacle.r * variation;
          if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const crystal = obstacle.kind === "crystal";
        ctx.fillStyle = crystal ? "rgba(20,43,45,.94)" : "rgba(16,25,26,.96)";
        ctx.strokeStyle = crystal ? "rgba(109,177,170,.55)" : "rgba(111,134,129,.36)";
        ctx.lineWidth = crystal ? 1.6 : 1.2;
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-obstacle.r * 0.4, -obstacle.r * 0.15);
        ctx.lineTo(obstacle.r * 0.22, obstacle.r * 0.34);
        ctx.lineTo(obstacle.r * 0.48, -obstacle.r * 0.22);
        ctx.strokeStyle = crystal ? "rgba(232,189,104,.2)" : "rgba(137,155,151,.13)";
        ctx.stroke();
      } else {
        ctx.translate(obstacle.x, obstacle.y);
        const citadel = obstacle.kind === "citadel";
        ctx.fillStyle = citadel ? "rgba(13,29,31,.98)" : "rgba(10,24,26,.98)";
        ctx.strokeStyle = citadel ? "rgba(232,189,104,.34)" : "rgba(114,185,173,.32)";
        ctx.lineWidth = 1.5;
        ctx.fillRect(0, 0, obstacle.w, obstacle.h);
        ctx.strokeRect(0, 0, obstacle.w, obstacle.h);
        ctx.strokeStyle = "rgba(147,175,169,.12)";
        ctx.lineWidth = 1;
        const segments = Math.max(1, Math.floor((obstacle.w > obstacle.h ? obstacle.w : obstacle.h) / 56));
        for (let index = 1; index < segments; index += 1) {
          ctx.beginPath();
          if (obstacle.w > obstacle.h) {
            const x = obstacle.w * index / segments;
            ctx.moveTo(x, 0); ctx.lineTo(x, obstacle.h);
          } else {
            const y = obstacle.h * index / segments;
            ctx.moveTo(0, y); ctx.lineTo(obstacle.w, y);
          }
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(232,189,104,.35)";
        for (let index = 0; index < segments; index += 2) {
          if (obstacle.w > obstacle.h) ctx.fillRect(obstacle.w * (index + 0.5) / segments - 1, obstacle.h * 0.5 - 1, 2, 2);
          else ctx.fillRect(obstacle.w * 0.5 - 1, obstacle.h * (index + 0.5) / segments - 1, 2, 2);
        }
      }
      ctx.restore();
    }

    drawPickup(ctx, pickup) {
      if (!this.inView(pickup.x, pickup.y, 40)) return;
      ctx.save();
      ctx.translate(pickup.x, pickup.y);
      ctx.rotate(pickup.phase);
      const scale = 1 + Math.sin(pickup.phase * 1.7) * 0.12;
      ctx.scale(scale, scale);
      ctx.strokeStyle = pickup.type === "energy" ? "#8fc5a6" : "#e8bd68";
      ctx.fillStyle = pickup.type === "energy" ? "rgba(100,181,145,.18)" : "rgba(232,189,104,.16)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(7, 0); ctx.lineTo(0, 9); ctx.lineTo(-7, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(-1.5, -1.5, 3, 3);
      ctx.restore();
    }

    drawProjectile(ctx, projectile, interpolation) {
      const x = Core.lerp(projectile.previousX, projectile.x, interpolation);
      const y = Core.lerp(projectile.previousY, projectile.y, interpolation);
      if (!this.inView(x, y, (projectile.explosionRadius || 20) + 20)) return;
      const speed = Math.max(1, Math.hypot(projectile.vx, projectile.vy));
      const nx = projectile.vx / speed;
      const ny = projectile.vy / speed;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = projectile.color;
      ctx.fillStyle = projectile.color;
      if (projectile.kind === "gun" || projectile.kind === "shard") {
        ctx.globalAlpha = 0.82;
        ctx.lineWidth = projectile.kind === "gun" ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(x - nx * 16, y - ny * 16);
        ctx.lineTo(x + nx * 4, y + ny * 4);
        ctx.stroke();
      } else if (projectile.kind === "mine") {
        ctx.globalAlpha = projectile.arm > 0 ? 0.42 : 0.85;
        ctx.translate(x, y);
        ctx.rotate(this.simulationTime * 1.8 + projectile.id);
        ctx.beginPath();
        for (let index = 0; index < 6; index += 1) {
          const angle = index / 6 * Core.TAU;
          const radius = index % 2 ? 5 : 10;
          const px = Math.cos(angle) * radius;
          const py = Math.sin(angle) * radius;
          if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.globalAlpha = 0.34;
        ctx.beginPath();
        ctx.arc(x, y, projectile.radius * 1.9 + Math.sin(this.simulationTime * 8 + projectile.id) * 1.5, 0, Core.TAU);
        ctx.fill();
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.arc(x, y, projectile.radius * 0.72, 0, Core.TAU);
        ctx.fill();
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - nx * 25, y - ny * 25);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawShip(ctx, ship, interpolation) {
      const x = Core.lerp(ship.previousX, ship.x, interpolation);
      const y = Core.lerp(ship.previousY, ship.y, interpolation);
      if (!this.inView(x, y, 95)) return;
      const radius = ship.config.radius;
      const teamColor = ship.team === PLAYER_TEAM ? "#edca78" : "#d97668";
      const cloakAlpha = ship.cloak > 0 ? 0.23 + Math.sin(this.simulationTime * 19 + ship.id) * 0.09 : 1;
      ctx.save();
      ctx.globalAlpha = cloakAlpha;
      ctx.translate(x, y);
      ctx.rotate(ship.angle);

      if (ship.control.thrust || ship.control.boost) {
        const length = ship.control.boost ? radius * 1.8 : radius * (0.75 + Math.sin(this.simulationTime * 28 + ship.id) * 0.16);
        const flame = ctx.createLinearGradient(-radius - length, 0, -radius * 0.5, 0);
        flame.addColorStop(0, "rgba(114,185,173,0)");
        flame.addColorStop(0.65, "rgba(114,185,173,.55)");
        flame.addColorStop(1, "rgba(232,189,104,.8)");
        ctx.fillStyle = flame;
        ctx.beginPath();
        ctx.moveTo(-radius * 0.65, -radius * 0.26);
        ctx.lineTo(-radius - length, 0);
        ctx.lineTo(-radius * 0.65, radius * 0.26);
        ctx.closePath();
        ctx.fill();
      }

      const vertices = this.shipVertices(ship.type);
      ctx.beginPath();
      vertices.forEach((point, index) => {
        const px = point[0] * radius;
        const py = point[1] * radius;
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = ship.flash > 0 ? "rgba(239,214,170,.9)" : "rgba(7,16,18,.96)";
      ctx.strokeStyle = teamColor;
      ctx.lineWidth = ship.isPlayer ? 1.8 : 1.35;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(radius * 0.68, 0);
      ctx.lineTo(-radius * 0.45, 0);
      ctx.strokeStyle = ship.config.accent;
      ctx.globalAlpha *= 0.62;
      ctx.stroke();
      ctx.globalAlpha = cloakAlpha;

      if (ship.invulnerable > 0 || ship.barrier > 0) {
        ctx.rotate(-ship.angle);
        ctx.strokeStyle = ship.barrier > 0 ? "rgba(114,185,173,.75)" : "rgba(232,189,104,.52)";
        ctx.lineWidth = ship.barrier > 0 ? 2.2 : 1.2;
        ctx.setLineDash(ship.invulnerable > 0 ? [5, 5] : []);
        ctx.beginPath();
        ctx.arc(0, 0, radius + 8 + Math.sin(this.simulationTime * 5) * 1.5, 0, Core.TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();

      if (!ship.isPlayer && ship.cloak <= 0 && Core.distanceSquared(ship, this.player) < 720 * 720) {
        ctx.save();
        ctx.font = "7px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(215,226,223,.5)";
        ctx.fillText(ship.callsign, x, y - radius - 15);
        const width = 34;
        ctx.fillStyle = "rgba(255,255,255,.08)";
        ctx.fillRect(x - width / 2, y + radius + 8, width, 2);
        ctx.fillStyle = "rgba(217,118,104,.76)";
        ctx.fillRect(x - width / 2, y + radius + 8, width * Core.clamp(ship.energy / ship.config.maxEnergy, 0, 1), 2);
        ctx.restore();
      }
    }

    shipVertices(type) {
      const shapes = {
        warbird: [[1.12, 0], [-0.82, -0.82], [-0.48, 0], [-0.82, 0.82]],
        javelin: [[1.28, 0], [-0.82, -0.43], [-0.46, 0], [-0.82, 0.43]],
        spider: [[1.02, 0], [0.2, -0.42], [-0.66, -0.95], [-0.45, -0.24], [-0.88, 0], [-0.45, 0.24], [-0.66, 0.95], [0.2, 0.42]],
        leviathan: [[1.04, 0], [0.42, -0.64], [-0.56, -0.9], [-0.9, -0.34], [-0.72, 0], [-0.9, 0.34], [-0.56, 0.9], [0.42, 0.64]],
        terrier: [[1.08, 0], [0.46, -0.38], [0.15, -0.84], [-0.65, -0.67], [-0.45, 0], [-0.65, 0.67], [0.15, 0.84], [0.46, 0.38]],
        weasel: [[1.22, 0], [0.08, -0.45], [-0.74, -0.58], [-0.42, 0], [-0.74, 0.58], [0.08, 0.45]],
        lancaster: [[1.12, 0], [0.38, -0.55], [-0.55, -0.72], [-0.82, -0.28], [-0.55, 0], [-0.82, 0.28], [-0.55, 0.72], [0.38, 0.55]],
        shark: [[1.14, 0], [0.2, -0.36], [-0.72, -0.88], [-0.48, -0.2], [-0.84, 0], [-0.48, 0.2], [-0.72, 0.88], [0.2, 0.36]]
      };
      return shapes[type] || shapes.warbird;
    }

    drawParticle(ctx, particle) {
      const progress = Core.clamp(particle.life / particle.maxLife, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = progress * 0.75;
      ctx.strokeStyle = particle.color;
      ctx.fillStyle = particle.color;
      if (particle.type === "spark") {
        ctx.lineWidth = particle.size * progress;
        ctx.beginPath();
        ctx.moveTo(particle.previousX, particle.previousY);
        ctx.lineTo(particle.x, particle.y);
        ctx.stroke();
      } else {
        const radius = particle.radius * (1 - progress * 0.82);
        ctx.lineWidth = 1 + progress * 2;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, radius, 0, Core.TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    inView(x, y, padding) {
      const margin = padding || 0;
      return x >= this.camera.x - this.width * 0.5 - margin
        && x <= this.camera.x + this.width * 0.5 + margin
        && y >= this.camera.y - this.height * 0.5 - margin
        && y <= this.camera.y + this.height * 0.5 + margin;
    }

    drawOffscreenIndicators(ctx) {
      if (!this.player?.alive) return;
      const marginX = 38;
      const marginTop = 160;
      const marginBottom = 100;
      for (const ship of this.ships) {
        if (!ship.alive || ship.team !== ENEMY_TEAM || ship.cloak > 0) continue;
        const screenX = ship.x - this.camera.x + this.width * 0.5;
        const screenY = ship.y - this.camera.y + this.height * 0.5;
        if (screenX > marginX && screenX < this.width - marginX && screenY > marginTop && screenY < this.height - marginBottom) continue;
        const centreX = this.width * 0.5;
        const centreY = this.height * 0.5;
        const angle = Math.atan2(screenY - centreY, screenX - centreX);
        const x = Core.clamp(screenX, marginX, this.width - marginX);
        const y = Core.clamp(screenY, marginTop, this.height - marginBottom);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = "rgba(217,118,104,.78)";
        ctx.beginPath();
        ctx.moveTo(8, 0); ctx.lineTo(-5, -4); ctx.lineTo(-3, 0); ctx.lineTo(-5, 4); ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    drawRespawnStatus(ctx) {
      if (this.player?.alive || this.mode !== "playing") return;
      const value = Math.max(0, this.player.respawnTimer);
      ctx.save();
      ctx.fillStyle = "rgba(3,9,11,.72)";
      ctx.fillRect(this.width * 0.5 - 125, this.height * 0.5 - 32, 250, 64);
      ctx.strokeStyle = "rgba(232,189,104,.34)";
      ctx.strokeRect(this.width * 0.5 - 125, this.height * 0.5 - 32, 250, 64);
      ctx.textAlign = "center";
      ctx.fillStyle = "#e8bd68";
      ctx.font = "700 10px monospace";
      ctx.fillText(this.lives > 0 ? "RECONSTRUCTING PILOT HULL" : "SIGNAL TERMINATED", this.width * 0.5, this.height * 0.5 - 4);
      ctx.fillStyle = "rgba(215,226,223,.72)";
      ctx.font = "9px monospace";
      ctx.fillText(this.lives > 0 ? `${value.toFixed(1)} SECONDS` : "NO RESERVE HULLS", this.width * 0.5, this.height * 0.5 + 15);
      ctx.restore();
    }

    drawRadar() {
      if (!this.arena || nodes.hud.hidden) return;
      const ctx = this.radarCtx;
      const width = nodes.radar.width;
      const height = nodes.radar.height;
      const scaleX = width / this.arena.width;
      const scaleY = height / this.arena.height;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(3,10,12,.96)";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "rgba(111,151,143,.1)";
      ctx.lineWidth = 1;
      for (let x = width / 5; x < width; x += width / 5) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = height / 4; y < height; y += height / 4) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
      ctx.fillStyle = "rgba(120,143,139,.22)";
      for (const obstacle of this.arena.obstacles) {
        if (obstacle.type === "circle") {
          ctx.beginPath();
          ctx.arc(obstacle.x * scaleX, obstacle.y * scaleY, Math.max(1, obstacle.r * Math.min(scaleX, scaleY)), 0, Core.TAU);
          ctx.fill();
        } else {
          ctx.fillRect(obstacle.x * scaleX, obstacle.y * scaleY, Math.max(1, obstacle.w * scaleX), Math.max(1, obstacle.h * scaleY));
        }
      }
      ctx.strokeStyle = "rgba(232,189,104,.62)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.arena.objective.x * scaleX, this.arena.objective.y * scaleY, Math.max(3, this.arena.objective.radius * Math.min(scaleX, scaleY)), 0, Core.TAU);
      ctx.stroke();
      for (const pickup of this.pickups) {
        ctx.fillStyle = pickup.type === "energy" ? "rgba(127,193,158,.7)" : "rgba(232,189,104,.7)";
        ctx.fillRect(pickup.x * scaleX - 1, pickup.y * scaleY - 1, 2, 2);
      }
      for (const ship of this.ships) {
        if (!ship.alive) continue;
        if (ship.team === ENEMY_TEAM && ship.cloak > 0 && (!this.player.alive || Core.distanceSquared(ship, this.player) > 220 * 220)) continue;
        ctx.fillStyle = ship.team === PLAYER_TEAM ? "#edca78" : "#d97668";
        const size = ship.isPlayer ? 4 : 3;
        ctx.fillRect(ship.x * scaleX - size / 2, ship.y * scaleY - size / 2, size, size);
      }
      const viewX = (this.camera.x - this.width * 0.5) * scaleX;
      const viewY = (this.camera.y - this.height * 0.5) * scaleY;
      ctx.strokeStyle = "rgba(215,226,223,.28)";
      ctx.strokeRect(viewX, viewY, this.width * scaleX, this.height * scaleY);
      ctx.strokeStyle = "rgba(232,189,104,.32)";
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    }

    objectiveLabel() {
      const type = this.objectiveState?.type || this.arena?.objective.type;
      if (type === "elimination") return "ELIMINATE THE HOSTILE WING";
      if (type === "control") return "SECURE THE CENTRAL BEACON";
      if (type === "core") return "BREACH THE RIFT CORE";
      return "SURVIVE THE INTERDICTION";
    }

    objectiveDetail() {
      const state = this.objectiveState;
      if (!state) return "AWAITING DIRECTIVE";
      if (state.type === "elimination") return `HOSTILES REMAINING ${String(state.remaining).padStart(2, "0")}`;
      if (state.type === "control") return state.contested
        ? `BEACON CONTESTED // ${state.held.toFixed(1)} / ${state.required.toFixed(1)} s`
        : `CONTROL ${state.held.toFixed(1)} / ${state.required.toFixed(1)} s`;
      if (state.type === "core") return `CORE ENERGY ${Math.ceil(state.energy)} / ${state.maxEnergy}`;
      return `INTERDICTION ENDS IN ${state.remaining.toFixed(1)} s`;
    }

    updateHUD(force) {
      if (!this.player || nodes.hud.hidden) return;
      const ship = this.player;
      const config = ship.config;
      nodes.hudSector.textContent = String(this.level).padStart(2, "0");
      nodes.hudArena.textContent = this.arena.styleName.toUpperCase();
      nodes.hudScore.textContent = String(Math.round(this.score)).padStart(6, "0");
      nodes.hudKills.textContent = String(this.totalKills).padStart(2, "0");
      nodes.hudLives.textContent = String(Math.max(0, this.lives)).padStart(2, "0");
      nodes.hudObjective.textContent = this.objectiveLabel();
      nodes.hudObjectiveDetail.textContent = this.objectiveDetail();
      nodes.objectiveProgress.style.width = `${Core.clamp(this.objectiveState?.progress || 0, 0, 1) * 100}%`;
      nodes.hudAI.textContent = Core.DIFFICULTIES[this.settings.difficulty].name.toUpperCase();
      nodes.hudSeed.textContent = this.arenaFingerprint.toUpperCase();
      nodes.hudFPS.textContent = String(Math.round(this.fps));
      nodes.hudShip.textContent = config.name.toUpperCase();
      nodes.hudRole.textContent = config.role.toUpperCase();
      nodes.hudShipIcon.textContent = { warbird: "▲", javelin: "△", spider: "✣", leviathan: "◆", terrier: "◇", weasel: "⌁", lancaster: "⬡", shark: "⋔" }[ship.type];
      nodes.hudEnergyText.textContent = `${Math.max(0, Math.ceil(ship.energy))} / ${config.maxEnergy}`;
      nodes.energyFill.style.width = `${Core.clamp(ship.energy / config.maxEnergy, 0, 1) * 100}%`;
      if (force) {
        const secondaryNames = { bomb: "BOMB", heavyBomb: "L3 BOMB", cluster: "CLUSTER", mine: "MINE", empBomb: "EMP", bounceBomb: "RICOCHET" };
        nodes.systemSecondary.innerHTML = `<kbd>X</kbd> ${secondaryNames[config.secondary] || "BOMB"} <i></i>`;
        nodes.systemSpecial.innerHTML = `<kbd>Q</kbd> ${config.special.toUpperCase()} <i></i>`;
      }
      this.updateSystemIndicator(nodes.systemGun, ship.gunCooldown, config.gunCooldown);
      this.updateSystemIndicator(nodes.systemSecondary, ship.secondaryCooldown, config.secondaryCooldown);
      this.updateSystemIndicator(nodes.systemSpecial, ship.specialCooldown, config.specialCooldown);
      this.updateSystemIndicator(nodes.systemRepel, ship.repelCooldown, ship.type === "shark" ? 3.8 : 5.6);
    }

    updateSystemIndicator(element, cooldown, maximum) {
      const ready = cooldown <= 0;
      element.classList.toggle("is-ready", ready);
      element.classList.toggle("is-cooling", !ready);
      const bar = element.querySelector("i");
      if (bar) bar.style.transform = `scaleX(${ready ? 1 : Core.clamp(1 - cooldown / maximum, 0, 1)})`;
    }

    addFeed(html) {
      const entry = document.createElement("span");
      entry.innerHTML = html;
      nodes.combatFeed.prepend(entry);
      while (nodes.combatFeed.children.length > 5) nodes.combatFeed.lastElementChild.remove();
      window.setTimeout(() => entry.remove(), 5200);
    }

    toast(message) {
      nodes.toast.textContent = message;
      nodes.toast.classList.add("is-visible");
      this.toastTimer = 2.4;
    }

    pause() {
      if (this.mode !== "playing" || (!this.player.alive && this.lives <= 0)) return;
      this.mode = "paused";
      nodes.pauseOverlay.hidden = false;
      nodes.resume.focus?.();
    }

    resume() {
      if (this.mode !== "paused") return;
      nodes.pauseOverlay.hidden = true;
      this.mode = "playing";
      this.lastFrame = performance.now();
      this.accumulator = 0;
      nodes.canvas.focus?.();
    }

    togglePause() {
      if (this.mode === "playing") this.pause();
      else if (this.mode === "paused") this.resume();
    }

    returnToMenu() {
      this.mode = "menu";
      this.arena = null;
      this.navigationArena = null;
      this.navigationObstacles = [];
      this.ships.length = 0;
      this.projectiles.length = 0;
      this.particles.length = 0;
      nodes.pauseOverlay.hidden = true;
      nodes.sectorOverlay.hidden = true;
      nodes.gameoverOverlay.hidden = true;
      nodes.hud.hidden = true;
      nodes.pauseButton.hidden = true;
      nodes.menu.hidden = false;
      nodes.app.classList.add("is-menu");
      this.syncMenu();
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    window.inertiaZero = new InertiaZeroGame();
  });
}());
