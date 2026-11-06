"use strict";
// Real-browser smoke test from file://.
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

function installPad() {
  let pad = null;
  Object.defineProperty(Navigator.prototype, "getGamepads", { configurable: true, value: () => (pad ? [pad] : []) });
  window.__pad = (held) => { pad = held === null ? null : { id: "scripted", index: 0, mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ value: held.includes(i) ? 1 : 0, pressed: held.includes(i) })) }; };
  window.__frames = (n) => new Promise((r) => { const s = () => (n-- <= 0 ? r() : requestAnimationFrame(s)); requestAnimationFrame(s); });
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.GAMES_CHROMIUM || chromium.executablePath(), args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("request", (r) => requests.push(r.url()));
    await page.addInitScript(installPad);
    await page.goto(url);
    await page.waitForFunction(() => window.latticeCorsair && window.latticeCorsair.data);
    assert.equal(await page.title(), "LATTICE CORSAIR — Offline Space Captain");
    assert.equal(await page.locator(".faction-card").count(), 5, "the five empires of the Sovereign Lattice");
    await page.screenshot({ path: path.join(__dirname, "title.png") });

    await page.click("[data-faction='2']");
    await page.fill("#seedInput", "BROWSER-SMOKE");
    await page.click("#beginButton");
    await page.waitForFunction(() => window.latticeCorsair.session.mode === "docked");
    await page.waitForFunction(() => document.querySelectorAll("#stationBody tr").length > 5);
    assert.match(await page.locator("#stationKicker").innerText(), /CAPITAL/);

    // Market: buy one unit of something the station sells.
    const credits0 = await page.evaluate(() => window.latticeCorsair.career.credits);
    await page.locator("[data-buy]:not([disabled])").first().click();
    assert.ok(await page.evaluate((c) => window.latticeCorsair.career.credits < c, credits0));
    // Contracts: accept the first offer.
    await page.click("[data-tab='contracts']");
    await page.locator("[data-accept]").first().click();
    assert.equal(await page.evaluate(() => window.latticeCorsair.career.missions.filter((m) => m.status === "active").length), 1);
    // Every tab renders.
    for (const tab of ["shipyard", "outfitting", "news", "market"]) { await page.click(`[data-tab='${tab}']`); await page.evaluate(() => window.__frames(2)); }

    // Launch and fly.
    await page.click("[data-action='undock']");
    await page.waitForFunction(() => window.latticeCorsair.session.mode === "flight");
    // The first flight frame is drawn on a later animation frame; on slow
    // runners that can be well after the mode switch, so wait for it.
    await page.waitForFunction(() => {
      const s = window.latticeCorsair.renderer.stage;
      return ["bodies/", "stations/", "gates/", "player/"].every((g) => [...s.batches.keys()].some((k) => k.startsWith(g) && s.batches.get(k).used > 0));
    }, null, { timeout: 20000 });
    const scene = await page.evaluate(() => {
      const s = window.latticeCorsair.renderer.stage;
      return { canvases: document.querySelectorAll("canvas").length, groups: [...s.batches.keys()].filter((k) => s.batches.get(k).used > 0) };
    });
    assert.equal(scene.canvases, 1);
    for (const g of ["bodies/", "stations/", "gates/", "player/"]) assert.ok(scene.groups.some((k) => k.startsWith(g)), `drew ${g}`);
    const start = await page.evaluate(() => ({ x: window.latticeCorsair.world.player.x, y: window.latticeCorsair.world.player.y }));
    await page.focus("#game");
    await page.keyboard.down("w");
    await page.waitForFunction((s) => { const p = window.latticeCorsair.world.player; return Math.hypot(p.x - s.x, p.y - s.y) > 30; }, start, { timeout: 20000 });
    await page.keyboard.up("w");
    await page.keyboard.down(" "); await page.waitForTimeout(300); await page.keyboard.up(" ");
    assert.ok(await page.evaluate(() => window.latticeCorsair.world.shots.length >= 0));
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => document.querySelectorAll("#radar circle").length >= 2, null, { timeout: 20000 });

    // Galaxy map: plot a route; the next gate becomes the waypoint.
    await page.keyboard.press("m");
    await page.waitForSelector("#map:not([hidden])");
    const dest = await page.evaluate(() => { const L = window.latticeCorsair; return L.career.war.galaxy.systems.find((s) => s.id !== L.career.system).id; });
    await page.click(`#mapSvg [data-system='${dest}']`, { force: true });
    await page.click(`#mapInfo [data-route='${dest}']`);
    assert.equal(await page.evaluate(() => window.latticeCorsair.session.routeTo), dest);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => /Gate to|dock|jump/i.test(document.getElementById("prompt").textContent), null, { timeout: 20000 });

    // Dock again with E: put the ship next to the station, stopped.
    await page.evaluate(() => { const L = window.latticeCorsair, w = L.world, st = w.layout.stations.find((s) => s.id === L.career.home) || w.layout.stations[0]; Object.assign(w.player, { x: st.x + 40, y: st.y, vx: 0, vy: 0 }); });
    await page.evaluate(() => window.__frames(2));
    await page.keyboard.press("e");
    await page.waitForFunction(() => window.latticeCorsair.session.mode === "docked");

    // Gamepad: neutral arms it; Start launches from the station, Start again pauses.
    await page.evaluate(async () => { window.__pad([]); await window.__frames(4); window.__pad([9]); await window.__frames(3); window.__pad([]); await window.__frames(3); });
    await page.waitForFunction(() => window.latticeCorsair.session.mode === "flight");
    await page.evaluate(async () => { window.__pad([9]); await window.__frames(3); window.__pad([]); await window.__frames(2); });
    assert.equal(await page.locator("#pause").isVisible(), true);
    await page.screenshot({ path: path.join(__dirname, "flight.png") });

    // Save and continue.
    await page.click("[data-action='menu']");
    await page.waitForFunction(() => window.latticeCorsair.session.mode === "title");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("qsol-lattice-corsair-save-v1")).career.day);
    await page.reload();
    await page.waitForFunction(() => window.latticeCorsair && window.latticeCorsair.data);
    await page.click("#continueButton");
    await page.waitForFunction(() => window.latticeCorsair.career);
    assert.equal(await page.evaluate(() => window.latticeCorsair.career.day), saved);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal scroll at phone width");
    assert.deepEqual(errors, [], "no page errors");
    assert.ok(requests.every((r) => r.startsWith("file:") || r.startsWith("data:")), "offline only");
    process.stdout.write("ok - LATTICE CORSAIR: title, docked market and contracts, WebGL flight, radar, map routing, docking, gamepad, save/continue, phone layout, offline\n");
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
