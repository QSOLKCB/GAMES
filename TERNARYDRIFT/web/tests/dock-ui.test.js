"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const core = require("../core.js");

// Exercise the real app and simulation. DOM objects and the animation clock
// are controlled test doubles; this does not exercise a GPU or screen reader.
function boot() {
  const mutations = [];
  class Element {
    constructor(id = "") {
      this.id = id; this.listeners = new Map(); this.children = []; this.style = {}; this.dataset = {};
      this.classList = { add() {}, remove() {} }; this.value = "DOCK-UI-TEST";
    }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
    dispatch(type, values = {}) {
      for (const listener of this.listeners.get(type) || []) listener({ preventDefault() {}, ...values });
    }
    record() { mutations.push(this); }
    set textContent(value) { this.text = String(value); this.children = []; this.record(); }
    get textContent() { return this.text || ""; }
    set innerHTML(value) { this.html = value; this.record(); }
    get innerHTML() { return this.html || ""; }
    set hidden(value) { this.isHidden = value; this.record(); }
    get hidden() { return !!this.isHidden; }
    append(child) { child.parent = this; this.children.push(child); this.record(); }
    focus() {}
  }
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const elements = new Map(Array.from(html.matchAll(/id="([^"]+)"/g), match => [match[1], new Element(match[1])]));
  const dock = elements.get("dockLayer");
  dock.hidden = true;
  for (const id of ["dockFaction", "dockTitle", "marketRows"]) elements.get(id).parent = dock;
  const buttons = new Map(Array.from(html.matchAll(/data-action="([^"]+)"/g), match => {
    const button = new Element(); button.dataset.action = match[1]; button.parent = dock;
    return [match[1], button];
  }));
  const window = new Element();
  let state;
  window.TernaryDriftWebCore = { ...core, createGame(seed) { state = core.createGame(seed); return state; } };
  let frame;
  let time = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app.js"), "utf8"), {
    window, performance: { now: () => time },
    document: { querySelector: selector => elements.get(selector.slice(1)) || null,
      querySelectorAll: () => Array.from(buttons.values()), createElement: () => new Element() },
    requestAnimationFrame(callback) { frame = callback; },
  }, { filename: "TERNARYDRIFT/web/app.js" });
  elements.get("startButton").dispatch("click");
  function advance(count = 1) { for (let i = 0; i < count; i += 1) { time += 20; frame(time); } }
  function press(code) { window.dispatch("keydown", { code }); advance(); window.dispatch("keyup", { code }); advance(); }
  function click(action) { buttons.get(action).dispatch("click"); advance(); advance(); }
  function dockMutationCount() {
    return mutations.filter(element => {
      for (let current = element; current; current = current.parent) if (current === dock) return true;
      return false;
    }).length;
  }
  return { state, elements, buttons, advance, press, click, dockMutationCount };
}

function assertMarket(game) {
  const { state, elements } = game;
  const market = state.systems[state.player.system].market;
  const rows = elements.get("marketRows").children;
  assert.equal(rows.length, core.COMMODITIES.length);
  rows.forEach((row, index) => {
    assert.equal(row.className, `market-row${index === state.selectedCommodity ? " selected" : ""}`);
    assert.ok(row.innerHTML.includes(`<strong>${core.COMMODITIES[index]}</strong>`));
    assert.ok(row.innerHTML.includes(`<span>${market.inventory[index]} stk</span>`));
    assert.ok(row.innerHTML.includes(`<b>${core.marketPrice(state, state.player.system, index, true)}</b>`));
    assert.ok(row.innerHTML.includes(`<span>${state.player.cargo[index]} hold</span>`));
  });
}

test("unchanged dock frames leave the entire live region untouched", () => {
  const game = boot();
  assertMarket(game);
  const rows = game.elements.get("marketRows").children.slice();
  const before = game.dockMutationCount();
  game.advance(120);
  assert.ok(game.state.tick > 100, "the simulation continues while docked");
  assert.equal(game.dockMutationCount(), before, "unchanged headings, rows and visibility must not generate dock mutations");
  assert.deepEqual(game.elements.get("marketRows").children, rows);
});

test("keyboard selection and keyboard/button trades refresh market data", () => {
  const game = boot();
  game.press("ArrowDown");
  assert.equal(game.state.selectedCommodity, 1);
  assertMarket(game);
  const credits = game.state.player.credits;
  const price = core.marketPrice(game.state, 0, 1, true);
  game.press("KeyB");
  assert.equal(game.state.player.cargo[1], 1);
  assert.equal(game.state.player.credits, credits - price);
  assertMarket(game);
  assert.match(game.elements.get("toast").textContent, /^BUY ORE/);
  game.click("SELL");
  assert.equal(game.state.player.cargo[1], 0);
  assertMarket(game);
  assert.match(game.elements.get("toast").textContent, /^SELL ORE/);
  const before = game.dockMutationCount();
  game.advance(10);
  assert.equal(game.dockMutationCount(), before, "rendering settles after the transaction");
});

test("production and reputation changes refresh stock and prices without input", () => {
  const game = boot();
  const market = game.state.systems[0].market;
  market.production = [1, 0, 0, 0];
  const stock = market.inventory[0];
  game.state.marketTicks = 899;
  const before = game.dockMutationCount();
  game.advance();
  assert.equal(market.inventory[0], stock + 1);
  assert.ok(game.dockMutationCount() > before);
  assertMarket(game);
  const price = core.marketPrice(game.state, 0, 1, true);
  const rows = game.elements.get("marketRows").children;
  game.state.player.reputation[market.faction] += 180;
  game.advance();
  assert.equal(core.marketPrice(game.state, 0, 1, true), price - 1);
  assert.notEqual(game.elements.get("marketRows").children, rows, "price-only changes must invalidate the market display");
  assertMarket(game);
});

test("launch and docking controls update visibility without recurring mutations", () => {
  const game = boot();
  game.click("LAUNCH");
  assert.equal(game.state.player.docked, false);
  assert.equal(game.elements.get("dockLayer").hidden, true);
  assert.equal(game.elements.get("toast").textContent, "LAUNCH CLEAR");
  // Put the ship in docking range in another system; the key still passes
  // through the real app and core to perform the transition and notification.
  game.state.player.system = 1;
  const destination = game.state.systems[1];
  game.state.player.x = destination.station.x;
  game.state.player.y = destination.station.y;
  game.press("KeyE");
  assert.equal(game.state.player.docked, true);
  assert.equal(game.elements.get("dockLayer").hidden, false);
  assert.equal(game.elements.get("toast").textContent, "STATION LINK ESTABLISHED");
  assert.equal(game.elements.get("dockTitle").textContent, `DOCKED AT ${destination.name}`);
  assert.equal(game.elements.get("dockFaction").textContent, core.FACTIONS[destination.market.faction]);
  assertMarket(game);
  const before = game.dockMutationCount();
  game.advance(10);
  assert.equal(game.dockMutationCount(), before);
});
