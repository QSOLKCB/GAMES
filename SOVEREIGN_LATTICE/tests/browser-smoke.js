"use strict";
// Real-browser smoke test from file://: title, orders through the UI, turns,
// save/continue, gamepad, offline boundary and WebGL scene presence.
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

function installPad() {
  let pad = null;
  Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, value: () => (pad ? [pad] : []) });
  window.__pad = (held) => {
    pad = held === null ? null : { id: "scripted", index: 0, mapping: "standard", connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({ value: held.includes(i) ? 1 : 0, pressed: held.includes(i) })) };
  };
  window.__frames = (n) => new Promise((resolve) => { const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step); });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.GAMES_CHROMIUM || chromium.executablePath(),
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("request", (r) => requests.push(r.url()));
    await page.addInitScript(installPad);
    await page.goto(url);
    await page.waitForFunction(() => window.sovereignLattice && window.sovereignLattice.data);
    assert.equal(await page.title(), "SOVEREIGN LATTICE — Offline 4X");
    assert.equal(await page.locator(".empire-card").count(), 5);
    assert.match(await page.locator("#dataSource").innerText(), /bundled/);
    await page.screenshot({ path: path.join(__dirname, "title.png") });

    // Begin as the Ashen Choir on a small galaxy.
    await page.click("[data-empire='1']");
    await page.selectOption("#sizeSelect", "small");
    await page.fill("#seedInput", "BROWSER-SMOKE");
    await page.click("#beginButton");
    await page.waitForFunction(() => window.sovereignLattice.state && window.sovereignLattice.state.turn === 1);
    await page.waitForFunction(() => document.getElementById("empireName").textContent === "Ashen Choir");
    assert.equal(await page.evaluate(() => window.sovereignLattice.state.empires[0].race), "Cindervox");

    // The galaxy is drawn natively in WebGL.
    const scene = await page.evaluate(() => {
      const s = window.sovereignLattice.renderer.stage, gl = s.renderer.getContext();
      return { webgl: Boolean(gl), canvases: document.querySelectorAll("canvas").length, batches: [...s.batches.keys()].filter((k) => s.batches.get(k).used > 0) };
    });
    assert.ok(scene.webgl);
    assert.equal(scene.canvases, 1);
    for (const group of ["stars/", "lanes/", "fleets/"]) assert.ok(scene.batches.some((k) => k.startsWith(group)), `drew ${group}`);
    assert.ok(await page.locator("#labels span").count() > 5, "star labels are drawn");

    // Queue a facility at the capital through the system panel.
    await page.click("[data-build-facility='mine']");
    assert.equal(await page.evaluate(() => window.sovereignLattice.state.colonies[0].queue.length), 1);

    // Select the scout and send it one lane away with a right-click on the map.
    const plan = await page.evaluate(() => {
      const L = window.sovereignLattice, g = L.state, Core = window.SovereignCore;
      const scout = g.fleets.find((f) => f.owner === 0 && !Core.fleetStats(g, f).armed && !Core.fleetStats(g, f).colony);
      const lane = g.galaxy.lanes.find((l) => l[0] === scout.system || l[1] === scout.system);
      const target = lane[0] === scout.system ? lane[1] : lane[0];
      return { scout: scout.id, target };
    });
    await page.click(`[data-select-fleet='${plan.scout}']`);
    assert.equal(await page.evaluate(() => window.sovereignLattice.session.tab), "fleet");
    await page.evaluate((target) => { const L = window.sovereignLattice, s = L.state.galaxy.systems[target]; L.session.camera.x = s.x; L.session.camera.y = s.y; }, plan.target);
    await page.evaluate(() => window.__frames(2));
    const point = await page.evaluate((target) => { const L = window.sovereignLattice, s = L.state.galaxy.systems[target]; return L.toScreen(s.x, s.y); }, plan.target);
    await page.mouse.click(point.x, point.y, { button: "right" });
    const order = await page.evaluate((id) => window.sovereignLattice.state.fleets.find((f) => f.id === id).order, plan.scout);
    assert.equal(order.type, "move");
    assert.equal(order.destination, plan.target);

    // End the turn from the keyboard; the scout arrives or travels and the report appears.
    await page.focus("#game");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.sovereignLattice.state.turn === 2);
    assert.ok(await page.evaluate(() => window.sovereignLattice.state.empires[0].known.filter(Boolean).length > 1), "exploration revealed a system");

    // Pan and zoom.
    const before = await page.evaluate(() => ({ ...window.sovereignLattice.session.camera }));
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, -300);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(200);
    await page.keyboard.up("ArrowRight");
    const after = await page.evaluate(() => ({ ...window.sovereignLattice.session.camera }));
    assert.ok(after.zoom > before.zoom && after.x !== before.x);

    // Research choice and a custom design through the panels.
    await page.keyboard.press("r");
    await page.click("[data-research='weapons']");
    assert.equal(await page.evaluate(() => window.sovereignLattice.state.empires[0].researchField), "weapons");
    await page.keyboard.press("g");
    await page.click("[data-action='new-draft']");
    await page.click("[data-add-component='0']");
    await page.click("[data-add-component='0']");
    await page.fill("#draftName", "Smoke Picket");
    await page.click("[data-action='save-draft']");
    assert.ok(await page.evaluate(() => window.sovereignLattice.state.empires[0].designs.some((d) => d.name === "Smoke Picket")));

    // A scripted gamepad: neutral arms it, Start ends the turn.
    await page.evaluate(async () => { window.__pad([]); await window.__frames(4); window.__pad([9]); await window.__frames(3); window.__pad([]); await window.__frames(2); });
    await page.waitForFunction(() => window.sovereignLattice.state.turn === 3);

    for (let i = 0; i < 12; i++) await page.evaluate(() => window.sovereignLattice.endTurn());
    await page.screenshot({ path: path.join(__dirname, "galaxy.png") });

    // Save, reload, continue: the game resumes exactly.
    await page.click("[data-action='save']");
    const digest = await page.evaluate(() => window.SovereignCore.digest(window.sovereignLattice.state));
    await page.reload();
    await page.waitForFunction(() => window.sovereignLattice && window.sovereignLattice.data);
    assert.equal(await page.locator("#continueButton").isVisible(), true);
    await page.click("#continueButton");
    await page.waitForFunction(() => window.sovereignLattice.state);
    assert.equal(await page.evaluate(() => window.SovereignCore.digest(window.sovereignLattice.state)), digest);

    // Review regression: hover/preview from a large galaxy must not survive
    // into a smaller one (the render loop used to die on the stale id).
    await page.click("[data-action='menu']");
    await page.selectOption("#sizeSelect", "large");
    await page.click("#beginButton");
    await page.waitForFunction(() => window.sovereignLattice.state && window.sovereignLattice.state.galaxy.systems.length === 40);
    await page.evaluate(() => { const S = window.sovereignLattice.session; S.hover = 39; S.preview = [39, 38]; S.selection.system = 39; });
    await page.click("[data-action='menu']");
    await page.selectOption("#sizeSelect", "small");
    await page.click("#beginButton");
    await page.waitForFunction(() => window.sovereignLattice.state && window.sovereignLattice.state.galaxy.systems.length === 18);
    const session = await page.evaluate(() => { const S = window.sovereignLattice.session; return { hover: S.hover, preview: S.preview }; });
    assert.deepEqual(session, { hover: null, preview: null });
    const frameBefore = await page.evaluate(() => window.sovereignLattice.session.lastTime);
    await page.evaluate(() => window.__frames(5));
    assert.ok(await page.evaluate(() => window.sovereignLattice.session.lastTime) > frameBefore, "the render loop is still running");
    await page.click("[data-action='menu']");
    await page.click("#continueButton");
    await page.waitForFunction(() => window.sovereignLattice.state);

    // Help opens and closes; phone width keeps the controls reachable.
    await page.click("[data-action='help']");
    assert.equal(await page.locator("#help").isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#help").isVisible(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert.ok(await page.locator("#endTurn").isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal scroll at phone width");

    assert.deepEqual(errors, [], "no page errors");
    assert.ok(requests.every((r) => r.startsWith("file:") || r.startsWith("data:")), `offline only: ${requests.filter((r) => !r.startsWith("file:")).join(", ")}`);
    process.stdout.write("ok - SOVEREIGN LATTICE: title, WebGL galaxy, UI orders, turns, research, design, gamepad, save/continue, help, phone layout, offline\n");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
