"use strict";

// Lightweight DOM/canvas smoke harness for environments without an installed browser.
// It executes the real app bootstrap, launches a sector, advances the fixed-step
// simulation, exercises player input, AI, weapons, HUD updates, and rendering.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Core = require("../core.js");

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  toggle(value, force) {
    if (force === undefined ? !this.values.has(value) : force) this.values.add(value);
    else this.values.delete(value);
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(id) {
    this.id = id || "";
    this.hidden = false;
    this.value = "";
    this.textContent = "";
    this.style = {};
    this.dataset = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this._innerHTML = "";
    this._queryChildren = [];
    this.bar = null;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (this.id === "ship-grid") {
      this._queryChildren = [];
      const pattern = /data-ship="([^"]+)"/g;
      let match;
      while ((match = pattern.exec(this._innerHTML))) {
        const card = new FakeElement();
        card.dataset.ship = match[1];
        this._queryChildren.push(card);
      }
    }
    if (/system-/.test(this.id)) this.bar = new FakeElement();
  }

  get innerHTML() { return this._innerHTML; }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  querySelectorAll(selector) { return selector === "[data-ship]" ? this._queryChildren : []; }
  querySelector(selector) { return selector === "i" ? (this.bar ||= new FakeElement()) : null; }
  closest() { return this; }
  prepend(child) { child.parentElement = this; this.children.unshift(child); }
  appendChild(child) { child.parentElement = this; this.children.push(child); }
  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
  }
  getContext() { return this._context || createCanvasContext(); }
}

function createCanvasContext() {
  const gradient = { addColorStop() {} };
  const target = {
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    measureText: () => ({ width: 10 }),
    setLineDash() {}
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      return () => undefined;
    },
    set(object, property, value) { object[property] = value; return true; }
  });
}

const ids = [
  "app", "game-canvas", "radar-canvas", "hud", "menu", "ship-grid", "difficulty-select",
  "difficulty-description", "bot-count-select", "arena-select", "seed-input", "random-seed",
  "launch-button", "help-button", "help-overlay", "close-help", "pause-button", "pause-overlay",
  "resume-button", "restart-button", "menu-button", "sector-overlay", "next-sector-button",
  "gameover-overlay", "retry-button", "gameover-menu-button", "toast", "combat-feed", "hud-sector",
  "hud-arena", "hud-score", "hud-kills", "hud-lives", "hud-objective", "hud-objective-detail",
  "objective-progress", "hud-ai", "hud-seed", "hud-fps", "hud-ship", "hud-role", "hud-ship-icon",
  "hud-energy-text", "energy-fill", "system-gun", "system-secondary", "system-special", "system-repel",
  "result-score", "result-kills", "result-accuracy", "next-sector-copy", "final-score", "final-sector",
  "final-kills", "best-score-copy"
];
const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
elements.get("bot-count-select").value = "4";
elements.get("game-canvas").width = 0;
elements.get("game-canvas").height = 0;
elements.get("radar-canvas").width = 208;
elements.get("radar-canvas").height = 144;
let gameBackingCanvas = null;
if (process.env.INERTIA_ZERO_RENDER_PATH) {
  try {
    const { createCanvas } = require("@napi-rs/canvas");
    gameBackingCanvas = createCanvas(1440, 900);
    const radarBackingCanvas = createCanvas(208, 144);
    elements.get("game-canvas")._context = gameBackingCanvas.getContext("2d");
    elements.get("radar-canvas")._context = radarBackingCanvas.getContext("2d");
  } catch (error) {
    throw new Error("INERTIA_ZERO_RENDER_PATH requires the optional @napi-rs/canvas development package");
  }
}

const documentListeners = new Map();
const document = {
  querySelector(selector) { return selector.startsWith("#") ? elements.get(selector.slice(1)) || null : null; },
  createElement() { return new FakeElement(); },
  addEventListener(type, callback) { documentListeners.set(type, callback); }
};
const windowListeners = new Map();
const localValues = new Map();
const fakeWindow = {
  InertiaZeroCore: Core,
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 1,
  addEventListener(type, callback) {
    if (type === "DOMContentLoaded") documentListeners.set(type, callback);
    else windowListeners.set(type, callback);
  },
  setTimeout() { return 0; },
  clearTimeout() {},
  AudioContext: undefined,
  webkitAudioContext: undefined
};

global.window = fakeWindow;
global.document = document;
global.localStorage = {
  getItem(key) { return localValues.get(key) ?? null; },
  setItem(key, value) { localValues.set(key, String(value)); }
};
Object.defineProperty(global, "navigator", { value: { getGamepads: () => [] }, configurable: true });
global.requestAnimationFrame = () => 1;

const source = fs.readFileSync(path.resolve(__dirname, "../app.js"), "utf8");
vm.runInThisContext(source, { filename: "app.js" });
const ready = documentListeners.get("DOMContentLoaded");
if (!ready) throw new Error("App did not register a DOMContentLoaded bootstrap");
ready();

const game = fakeWindow.inertiaZero;
if (!game || game.mode !== "menu") throw new Error("App failed to enter menu mode");
if (elements.get("ship-grid").querySelectorAll("[data-ship]").length !== 8) throw new Error("Menu did not build all eight hull cards");

elements.get("difficulty-select").value = "ace";
elements.get("bot-count-select").value = "3";
elements.get("arena-select").value = "fortress";
elements.get("seed-input").value = "NODE-RUNTIME-SMOKE";
game.startRun();
if (game.mode !== "playing" || game.ships.length !== 4 || game.arena.style !== "fortress") throw new Error("Sector launch state is invalid");

game.player.invulnerable = 999;
game.input.keys.add("KeyW");
game.input.keys.add("Space");
for (let tick = 0; tick < 180; tick += 1) game.update(1 / 60);
game.input.keys.delete("KeyW");
game.input.keys.delete("Space");
for (let tick = 0; tick < 420; tick += 1) game.update(1 / 60);
game.render(0.5);
if (process.env.INERTIA_ZERO_RENDER_PATH && gameBackingCanvas) {
  fs.writeFileSync(process.env.INERTIA_ZERO_RENDER_PATH, gameBackingCanvas.toBuffer("image/png"));
}

const allFinite = game.ships.every((ship) => [ship.x, ship.y, ship.vx, ship.vy, ship.energy].every(Number.isFinite))
  && game.projectiles.every((projectile) => [projectile.x, projectile.y, projectile.vx, projectile.vy, projectile.life].every(Number.isFinite));
if (!allFinite) throw new Error("Long simulation produced a non-finite entity");
if (game.simulationTime < 9.9) throw new Error("Fixed-step clock did not advance");
if (game.player.x <= game.arena.playerSpawn.x) throw new Error("Player thrust input did not move the hull");
if (game.shotsFired < 2) throw new Error("Player weapon input did not spawn shots");
if (!game.ships.some((ship) => !ship.isPlayer && Math.hypot(ship.vx, ship.vy) > 0)) throw new Error("AI pilots did not manoeuvre");

game.pause();
if (game.mode !== "paused") throw new Error("Pause transition failed");
game.resume();
if (game.mode !== "playing") throw new Error("Resume transition failed");

game.objectiveState = { type: "elimination", initial: 1, remaining: 0, progress: 0 };
game.simulationTime = 0;
game.accumulator = 0;
game.lastFrame = 0;
game.frame(80);
if (game.mode !== "levelComplete" || game.simulationTime > 1 / 60 + 1e-9) {
  throw new Error("Fixed-step loop continued after a terminal sector transition");
}

function launchObjectiveLevel(level, seed) {
  game.returnToMenu();
  game.settings.ship = "warbird";
  elements.get("difficulty-select").value = "ace";
  elements.get("bot-count-select").value = "2";
  elements.get("arena-select").value = "mixed";
  elements.get("seed-input").value = seed;
  game.startRun();
  if (level !== 1) {
    game.level = level;
    game.loadLevel();
  }
  game.player.invulnerable = 999;
  if (game.objectiveState.type !== Core.OBJECTIVE_TYPES[(level - 1) % Core.OBJECTIVE_TYPES.length]) {
    throw new Error(`Level ${level} loaded the wrong objective type`);
  }
}

launchObjectiveLevel(1, "OBJECTIVE-ELIMINATION");
for (const hostile of game.ships.filter((ship) => !ship.isPlayer)) {
  game.destroyShip(hostile, game.player.team, game.player.id);
}
game.updateObjective(1 / 60);
if (game.mode !== "levelComplete") throw new Error("Elimination objective did not complete after the hostile wing was destroyed");

launchObjectiveLevel(2, "OBJECTIVE-CONTROL");
for (const hostile of game.ships.filter((ship) => !ship.isPlayer)) {
  game.destroyShip(hostile, game.player.team, game.player.id);
}
game.player.x = game.arena.objective.x;
game.player.y = game.arena.objective.y;
game.objectiveState.held = game.objectiveState.required - 0.01;
game.updateObjective(0.02);
if (game.mode !== "levelComplete") throw new Error("Control objective did not complete after the uncontested hold duration");

launchObjectiveLevel(3, "OBJECTIVE-CORE");
const core = game.arena.objective;
const coreBlocker = game.navigationObstacles.find((obstacle) => obstacle.kind === "rift-core");
if (!coreBlocker || coreBlocker.x !== core.x || coreBlocker.y !== core.y || coreBlocker.r !== core.radius) {
  throw new Error("Level-three core is missing from the AI navigation geometry");
}
if (!game.navigationArena.obstacles.includes(coreBlocker)) {
  throw new Error("Level-three core blocker was not attached to the pathfinding arena");
}
for (const pickup of game.pickups) {
  if (Core.pointBlocked(pickup, game.navigationObstacles, 42)) {
    throw new Error("Level-three pickup spawned inside blocked core/arena geometry");
  }
}
game.player.x = core.x + 1;
game.player.y = core.y;
game.player.vx = -120;
game.player.vy = 0;
game.resolveShipWorldCollision(game.player);
const coreClearance = Math.hypot(game.player.x - core.x, game.player.y - core.y);
if (coreClearance + 1e-9 < core.radius + game.player.config.radius) {
  throw new Error("Live rift core did not block ship movement");
}
game.damageCore(game.objectiveState.maxEnergy);
game.updateObjective(1 / 60);
if (game.mode !== "levelComplete") throw new Error("Core objective did not complete after its energy reached zero");

launchObjectiveLevel(4, "OBJECTIVE-SURVIVAL");
const reinforcementVictim = game.ships.find((ship) => !ship.isPlayer && ship.alive);
game.destroyShip(reinforcementVictim, game.player.team, game.player.id);
const shipsBeforeReinforcement = game.ships.length;
game.objectiveState.spawnTimer = 0;
game.updateObjective(1 / 60);
if (game.ships.length !== shipsBeforeReinforcement + 1 || !game.ships.at(-1).alive) {
  throw new Error("Survival objective did not replace a destroyed hostile with a live reinforcement");
}
game.objectiveState.remaining = 1 / 120;
game.updateObjective(1 / 60);
if (game.mode !== "levelComplete") throw new Error("Survival objective did not complete when its timer expired");

game.returnToMenu();
game.settings.ship = "warbird";
elements.get("difficulty-select").value = "cadet";
elements.get("bot-count-select").value = "2";
elements.get("arena-select").value = "open";
elements.get("seed-input").value = "FINAL-DEATH-TEST";
game.startRun();
game.lives = 1;
game.player.invulnerable = 0;
game.destroyShip(game.player, 2, 999);
if (game.lives !== 0) throw new Error("Final death did not consume the last hull");
game.pause();
if (game.mode === "paused") throw new Error("Final-death window can be paused");
game.restartSector();
if (game.mode !== "gameover") throw new Error("Restart resurrected a zero-hull campaign");

for (const shipId of Object.keys(Core.SHIPS)) {
  game.returnToMenu();
  game.settings.ship = shipId;
  elements.get("difficulty-select").value = "cadet";
  elements.get("bot-count-select").value = "2";
  elements.get("arena-select").value = "open";
  elements.get("seed-input").value = `HULL-${shipId}`;
  game.startRun();
  game.player.invulnerable = 99;
  const primaryFired = game.firePrimary(game.player);
  const ordnanceFired = game.fireSecondary(game.player);
  const specialActivated = game.useSpecial(game.player);
  const repelActivated = game.activateRepel(game.player);
  if (!primaryFired || !ordnanceFired || !specialActivated || !repelActivated) {
    throw new Error(`${shipId} failed a weapon or active-system command path`);
  }
  game.update(1 / 60);
  game.render(0.5);
  const finite = [game.player.x, game.player.y, game.player.vx, game.player.vy, game.player.energy].every(Number.isFinite);
  if (!finite) throw new Error(`${shipId} systems produced invalid state`);
}

game.returnToMenu();
if (game.mode !== "menu" || elements.get("menu").hidden) throw new Error("Hangar return transition failed");

console.log("PASS real app bootstrap and eight-hull menu");
console.log("PASS seeded fortress sector launch");
console.log("PASS 600-tick player, AI, weapon, HUD, and render smoke run");
console.log("PASS finite entity invariants under live combat");
console.log("PASS all eight primary, ordnance, special, and repel system paths");
console.log("PASS terminal-step freeze and zero-hull restart protection");
console.log("PASS elimination, control, core, and survival objective transitions");
console.log("PASS survival reinforcement and level-three core blocker");
console.log("PASS pause, resume, and hangar state transitions");
