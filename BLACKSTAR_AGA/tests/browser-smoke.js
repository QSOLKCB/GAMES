"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const core = require("../core.js");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BLACKSTAR_CHROMIUM || chromium.executablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  const requests = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("request", (request) => requests.push(request.url()));

  const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
  await page.goto(url, { waitUntil: "load" });
  assert.equal(await page.title(), "BLACKSTAR AGA — The Lost Amiga FPS");
  assert.equal(await page.locator("#bootLayer").isVisible(), true);
  assert.equal(await page.locator("#startButton").isEnabled(), true);
  await page.screenshot({ path: path.join(__dirname, "blackstar-boot.png"), fullPage: true });

  await page.fill("#seedInput", "BROWSER-BLACKSTAR");
  await page.selectOption("#difficultySelect", "0");
  await page.click("#startButton");
  await page.locator("#bootLayer").waitFor({ state: "hidden" });
  await page.waitForFunction(() => window.blackstarAGA && window.blackstarAGA.state && window.blackstarAGA.state.tick > 5);
  assert.equal(await page.locator("#modeReadout").innerText(), "LIVE INPUT");
  assert.match(await page.locator("#seedReadout").innerText(), /^[0-9A-F]{8}$/);
  assert.match(await page.locator("#digestReadout").innerText(), /^[0-9A-F]{8}$/);

  const before = await page.evaluate(() => ({ tick: blackstarAGA.state.tick, x: blackstarAGA.state.player.x }));
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(260);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("Space");
  await page.waitForTimeout(180);
  await page.keyboard.up("Space");
  const after = await page.evaluate(() => ({
    tick: blackstarAGA.state.tick,
    x: blackstarAGA.state.player.x,
    shots: blackstarAGA.state.stats.shots,
    hits: blackstarAGA.state.stats.hits,
  }));
  assert.ok(after.tick > before.tick);
  assert.ok(after.x > before.x);
  assert.ok(after.shots > 0);
  assert.ok(after.hits > 0, "the opening hostile must be visible and hittable");

  const edgeProjection = await page.evaluate(() => {
    const { state } = blackstarAGA;
    const forward = 8 * BlackstarCore.FP;
    const side = 4 * BlackstarCore.FP;
    const cos = BlackstarCore.cosAngle(state.player.angle);
    const sin = BlackstarCore.sinAngle(state.player.angle);
    const entity = {
      x: state.player.x + Math.trunc((cos * forward - sin * side) / BlackstarCore.TRIG_SCALE),
      y: state.player.y + Math.trunc((sin * forward + cos * side) / BlackstarCore.TRIG_SCALE),
    };
    return blackstarAGA.project(entity);
  });
  assert.ok(Math.abs(edgeProjection.depth - 8 * core.FP) <= 2);
  assert.ok(edgeProjection.distance > edgeProjection.depth * 1.1, "edge projection must retain distinct Euclidean and camera depths");
  await page.screenshot({ path: path.join(__dirname, "blackstar-game.png"), fullPage: true });

  await page.click("#pauseButton");
  assert.equal(await page.locator("#messageLayer").isVisible(), true);
  assert.equal(await page.locator("#modeReadout").innerText(), "PAUSED");
  const pausedTick = await page.evaluate(() => blackstarAGA.state.tick);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => blackstarAGA.state.tick), pausedTick);
  await page.click("#messageButton");
  await page.locator("#messageLayer").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#modeReadout").innerText(), "LIVE INPUT");

  await page.click("#replayButton");
  assert.equal(await page.locator("#replayDialog").evaluate((element) => element.open), true);
  const code = await page.locator("#replayText").inputValue();
  assert.match(code, /^BSA1\.[0-9A-F]{8}\.[A-Za-z0-9_-]+$/);
  const decoded = core.decodeReplay(code);
  assert.ok(decoded.ticks > 0);
  assert.match(await page.locator("#replayMeta").innerText(), /ticks/);
  await page.click("#watchReplayButton");
  await page.waitForFunction(() => window.blackstarAGA.mode === "replay");
  await page.waitForFunction(() => /REPLAY/.test(document.querySelector("#modeReadout").textContent));
  await page.waitForFunction(() => document.querySelector("#messageTitle").textContent === "RECEIPT COMPLETE", null, { timeout: 10000 });
  assert.equal(await page.locator("#messageLayer").isVisible(), true);
  assert.match(await page.locator("#modeReadout").innerText(), /^REPLAY COMPLETE \d+\/\d+$/);
  assert.equal(await page.locator("#digestReadout").innerText(), await page.evaluate(() => blackstarAGA.digest()));

  const terminalRecorder = core.createRecorder("BROWSER-TERMINAL-LEDGER", 2);
  for (let tick = 0; tick < 119; tick += 1) core.recordInput(terminalRecorder, 0);
  core.recordInput(terminalRecorder, core.packInput(core.INPUT.WEAPON_3, -7));
  const terminalReplay = core.decodeReplay(core.encodeReplay(terminalRecorder));
  await page.evaluate((decoded) => {
    blackstarAGA.start(decoded.seed, decoded.difficulty, "replay", decoded);
    const replayState = blackstarAGA.state;
    replayState.player.health = 1;
    const enemy = replayState.enemies[0];
    enemy.x = replayState.player.x;
    enemy.y = replayState.player.y;
    enemy.active = true;
    enemy.cooldown = 0;
  }, terminalReplay);
  await page.waitForFunction(() => blackstarAGA.state.gameOver);
  assert.equal(await page.evaluate(() => blackstarAGA.paused), false, "terminal replay must continue while ledger input remains");
  await page.waitForFunction((expectedTicks) => (
    blackstarAGA.replayTick === expectedTicks &&
    !document.querySelector("#messageLayer").hidden &&
    document.querySelector("#messageTitle").textContent === "RECEIPT COMPLETE"
  ), terminalReplay.ticks, { timeout: 5000 });
  assert.equal(await page.evaluate(() => blackstarAGA.replayTick), terminalReplay.ticks);
  assert.equal(await page.evaluate(() => blackstarAGA.state.previousActions), core.INPUT.WEAPON_3);
  assert.equal(await page.locator("#modeReadout").innerText(), `REPLAY COMPLETE ${terminalReplay.ticks}/${terminalReplay.ticks}`);
  assert.equal(await page.locator("#digestReadout").innerText(), await page.evaluate(() => blackstarAGA.digest()));

  await page.click("#messageButton");
  await page.waitForFunction(() => blackstarAGA.mode === "live" && blackstarAGA.state.tick > 0);
  await page.evaluate(() => {
    const liveState = blackstarAGA.state;
    liveState.player.health = 1;
    const enemy = liveState.enemies[0];
    enemy.x = liveState.player.x;
    enemy.y = liveState.player.y;
    enemy.active = true;
    enemy.cooldown = 0;
  });
  await page.waitForFunction(() => blackstarAGA.state.gameOver && blackstarAGA.paused);
  assert.equal(await page.locator("#modeReadout").innerText(), "GAME OVER");
  assert.equal(await page.locator("#tickReadout").innerText(), String(await page.evaluate(() => blackstarAGA.state.tick)));
  assert.equal(await page.locator("#digestReadout").innerText(), await page.evaluate(() => blackstarAGA.digest()));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url, { waitUntil: "load" });
  const mobile = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    boot: getComputedStyle(document.querySelector("#bootLayer")).display !== "none",
    launch: document.querySelector("#startButton").getBoundingClientRect(),
    gameView: document.querySelector("#viewport").getBoundingClientRect(),
  }));
  assert.equal(mobile.boot, true);
  assert.ok(mobile.content <= mobile.viewport + 1, `mobile layout overflows by ${mobile.content - mobile.viewport}px`);
  assert.ok(mobile.launch.bottom <= mobile.gameView.bottom + 1, "mobile boot button must fit inside the emulated display");
  assert.ok(mobile.launch.top >= mobile.gameView.top - 1, "mobile boot button must remain visible");
  await page.screenshot({ path: path.join(__dirname, "blackstar-mobile.png"), fullPage: true });

  assert.deepEqual(requests.filter((requestUrl) => !requestUrl.startsWith("file://")), []);
  assert.deepEqual(errors, []);
  await browser.close();
  process.stdout.write("ok - boot, fixed-step FPS input, pause, terminal replay drain, telemetry, camera depth, offline boundary, and mobile layout\n");
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
