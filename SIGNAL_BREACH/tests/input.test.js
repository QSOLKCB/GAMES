"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const core = require("../core.js");
const THREE = require("../../vendor/three/three.min.js");

// Run the real app, scene objects, handlers and simulation with a controlled
// animation clock. Only DOM objects and the GPU renderer are test doubles.
class Element {
  constructor() { this.listeners = new Map(); this.style = {}; this.children = []; this.value = "INPUT-TEST"; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  async dispatch(type, values = {}) {
    const event = { button: -1, pointerId: 1, preventDefault() {}, ...values };
    for (const listener of this.listeners.get(type) || []) await listener(event);
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 700 }; }
  setPointerCapture(pointerId) { this.capturedPointer = pointerId; }
  setAttribute() {}
  focus() {}
  append(child) { this.children.push(child); }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text || ""; }
}

async function boot() {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const elements = new Map(Array.from(html.matchAll(/id="([^"]+)"/g), match => [match[1], new Element()]));
  const window = new Element();
  const inputs = [];
  let state;
  window.SignalBreachCore = { ...core,
    createGame(...args) {
      state = core.createGame(...args);
      state.enemies.length = 0;
      state.arena.cover.length = 0;
      return state;
    },
    step(state, input, aim) { inputs.push(input); return core.step(state, input, aim); },
  };
  window.SignalBreachSampler = { load: async (seed, count) => ({ samples: core.fallbackSamples(seed, count), runtime: "TEST" }) };
  window.THREE = { ...THREE, WebGLRenderer: class { setPixelRatio() {} setSize() {} render() {} } };
  let frame;
  let time = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app.js"), "utf8"), {
    window, console, performance: { now: () => time }, navigator: { getGamepads: () => [] },
    document: { querySelector: selector => elements.get(selector.slice(1)) || null,
      querySelectorAll: () => [], createElement: () => new Element() },
    requestAnimationFrame(callback) { frame = callback; },
  }, { filename: "SIGNAL_BREACH/app.js" });
  await elements.get("startButton").dispatch("click");
  function advance(count = 1) { for (let i = 0; i < count; i += 1) { time += 20; frame(time); } }
  return { canvas: elements.get("game"), window, inputs, state, advance };
}

for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
  test(`${type} releases canvas fire without dropping movement`, async () => {
    const game = await boot();
    await game.window.dispatch("keydown", { code: "KeyW" });
    await game.canvas.dispatch("pointerdown", { button: 0 });
    game.advance();
    assert.equal(game.canvas.capturedPointer, 1);
    assert.ok(game.inputs.at(-1) & core.INPUT.FIRE);
    assert.ok(game.state.bullets.length > 0, "pointer press reaches the real weapon simulation");
    const nextId = game.state.nextId;
    await game.canvas.dispatch(type, { button: type === "pointerup" ? 0 : -1 });
    game.inputs.length = 0;
    game.advance(12); // Beyond the carbine cooldown: held fire would produce more shots.
    assert.ok(game.inputs.length >= 12);
    assert.ok(game.inputs.every(input => !(input & core.INPUT.FIRE)), "canceled/released pointer must not stay held");
    assert.ok(game.inputs.every(input => input & core.INPUT.UP), "release must not clear unrelated keyboard input");
    assert.equal(game.state.nextId, nextId, "no new rounds after release");
    await game.canvas.dispatch("pointerdown", { button: 0, pointerId: 2 });
    game.advance();
    assert.ok(game.state.nextId > nextId, "a fresh pointer can fire again");
  });
}

test("canvas touch gestures remain under game control", () => {
  const css = fs.readFileSync(path.join(__dirname, "../style.css"), "utf8");
  assert.match(css, /#game\s*\{[^}]*touch-action\s*:\s*none\s*[;}]/);
});
