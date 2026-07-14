"use strict";

const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  const gameUrl = pathToFileURL(path.resolve(__dirname, "../index.html")).href;
  await page.goto(gameUrl, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.inertiaZero));
  await page.screenshot({ path: "/tmp/inertia-zero-menu.png", fullPage: true });

  const menuState = await page.evaluate(() => ({
    mode: window.inertiaZero.mode,
    shipCards: document.querySelectorAll("[data-ship]").length,
    difficulties: document.querySelectorAll("#difficulty-select option").length,
    arenas: document.querySelectorAll("#arena-select option").length
  }));
  if (menuState.mode !== "menu" || menuState.shipCards !== 8 || menuState.difficulties !== 5 || menuState.arenas !== 6) {
    throw new Error(`Unexpected menu state: ${JSON.stringify(menuState)}`);
  }

  await page.click('[data-ship="lancaster"]');
  await page.selectOption("#difficulty-select", "sovereign");
  await page.selectOption("#bot-count-select", "4");
  await page.selectOption("#arena-select", "fortress");
  await page.fill("#seed-input", "BROWSER-SMOKE-001");
  await page.click("#launch-button");
  await page.waitForFunction(() => window.inertiaZero.mode === "playing" && window.inertiaZero.simulationTime > 0.25);

  const before = await page.evaluate(() => ({
    mode: window.inertiaZero.mode,
    ship: window.inertiaZero.player.type,
    difficulty: window.inertiaZero.settings.difficulty,
    style: window.inertiaZero.arena.style,
    ships: window.inertiaZero.ships.length,
    obstacles: window.inertiaZero.arena.obstacles.length,
    time: window.inertiaZero.simulationTime,
    x: window.inertiaZero.player.x,
    shots: window.inertiaZero.shotsFired
  }));
  if (before.ship !== "lancaster" || before.difficulty !== "sovereign" || before.style !== "fortress" || before.ships !== 5 || before.obstacles < 8) {
    throw new Error(`Unexpected launch state: ${JSON.stringify(before)}`);
  }

  await page.keyboard.down("KeyW");
  await page.keyboard.down("Space");
  await page.waitForTimeout(550);
  await page.keyboard.up("Space");
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    time: window.inertiaZero.simulationTime,
    x: window.inertiaZero.player.x,
    speed: Math.hypot(window.inertiaZero.player.vx, window.inertiaZero.player.vy),
    shots: window.inertiaZero.shotsFired,
    finite: window.inertiaZero.ships.every((ship) => [ship.x, ship.y, ship.vx, ship.vy, ship.energy].every(Number.isFinite))
  }));
  if (!(after.time > before.time && after.x > before.x && after.speed > 0 && after.shots > before.shots && after.finite)) {
    throw new Error(`Flight input did not produce a valid simulation transition: ${JSON.stringify({ before, after })}`);
  }

  await page.screenshot({ path: "/tmp/inertia-zero-flight.png", fullPage: true });
  await page.click("#pause-button");
  await page.waitForFunction(() => window.inertiaZero.mode === "paused");
  const pausedAt = await page.evaluate(() => window.inertiaZero.simulationTime);
  await page.waitForTimeout(180);
  const stillPausedAt = await page.evaluate(() => window.inertiaZero.simulationTime);
  if (pausedAt !== stillPausedAt) throw new Error("Simulation advanced while paused");
  await page.click("#resume-button");
  await page.waitForFunction(() => window.inertiaZero.mode === "playing");

  const testsUrl = pathToFileURL(path.resolve(__dirname, "index.html")).href;
  await page.goto(testsUrl, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelectorAll("#results article").length > 0);
  const browserTests = await page.locator("#summary").textContent();
  if (!browserTests.includes("0 failed")) throw new Error(`Browser core suite failed: ${browserTests}`);

    if (errors.length) throw new Error(errors.join("\n"));
    console.log("PASS menu boot and full roster rendering");
    console.log("PASS seeded Sovereign fortress launch");
    console.log("PASS keyboard flight and weapon simulation");
    console.log("PASS pause freezes the fixed-step clock");
    console.log("PASS browser-native core verification page");
  } finally {
    if (browser) await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
