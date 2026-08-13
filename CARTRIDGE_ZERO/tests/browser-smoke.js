"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const core = require("../core.js");

function allNumbersAreFiniteIntegers(value) {
  if (typeof value === "number") return Number.isFinite(value) && Number.isInteger(value);
  if (Array.isArray(value)) return value.every(allNumbersAreFiniteIntegers);
  if (value && typeof value === "object") return Object.values(value).every(allNumbersAreFiniteIntegers);
  return true;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CARTRIDGE_ZERO_CHROMIUM || chromium.executablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  const requests = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("request", (request) => requests.push(request.url()));

  const url = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
  await page.goto(url, { waitUntil: "load" });
  assert.equal(await page.title(), "CARTRIDGE ZERO — Seven Deterministic Signals");
  assert.equal(await page.locator("#bootLayer").isVisible(), true);
  assert.equal(await page.locator("#startButton").isEnabled(), true);
  assert.equal(await page.locator("#gameGrid button").count(), core.GAMES.length);

  for (const game of core.GAMES) {
    await page.click(`[data-game="${game.id}"]`);
    assert.equal(await page.locator("#selectedTitle").innerText(), game.name);
    assert.equal(await page.locator("#cartridgeLabel").innerText(), game.name);
  }

  const standbyRecorder = core.createRecorder("star-talon", "STANDBY-RECEIPT", 1);
  for (let tick = 0; tick < 30; tick += 1) core.recordInput(standbyRecorder, tick === 29 ? core.INPUT.FIRE : 0);
  const standbyCode = core.encodeReplay(standbyRecorder);
  assert.equal(await page.locator("#replayButton").isEnabled(), true);
  await page.click("#replayButton");
  assert.equal(await page.locator("#replayDialog").evaluate((element) => element.open), true);
  assert.equal(await page.locator("#replayText").inputValue(), "");
  assert.match(await page.locator("#replayMeta").innerText(), /Paste a CZ01 receipt/);
  await page.fill("#replayText", standbyCode);
  await page.click("#watchReplayButton");
  await page.waitForFunction(() => cartridgeZero.mode === "replay" && cartridgeZero.state.gameId === "star-talon");
  await page.waitForFunction(() => document.querySelector("#messageTitle").textContent === "RECEIPT COMPLETE");
  assert.equal(await page.evaluate(() => cartridgeZero.replayTick), standbyRecorder.ticks);
  await page.click("#messageButton");
  await page.locator("#bootLayer").waitFor({ state: "visible" });
  assert.equal(await page.locator("#replayButton").isEnabled(), true);
  await page.screenshot({ path: path.join(__dirname, "cartridge-zero-boot.png"), fullPage: true });

  const renderMetrics = {};
  for (const game of core.GAMES) {
    await page.evaluate(({ gameId, index }) => {
      cartridgeZero.start(gameId, `BROWSER-${gameId}`, index % 3, "live", null);
    }, { gameId: game.id, index: game.number });
    await page.waitForFunction((gameId) => (
      cartridgeZero.state && cartridgeZero.state.gameId === gameId && cartridgeZero.state.tick > 7
    ), game.id);
    renderMetrics[game.id] = await page.evaluate(() => {
      const canvas = document.querySelector("#game");
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      let opaque = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] === 255) opaque += 1;
        colors.add(`${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`);
      }
      return { colors: colors.size, opaque, state: cartridgeZero.state };
    });
    assert.ok(renderMetrics[game.id].colors >= 3, `${game.name} must draw a distinct playfield`);
    assert.ok(renderMetrics[game.id].opaque > core.WIDTH * core.HEIGHT * 0.95, `${game.name} must fill the logical display`);
    assert.equal(allNumbersAreFiniteIntegers(renderMetrics[game.id].state), true, `${game.name} browser state must remain canonical`);
    assert.equal(await page.locator("#gameReadout").innerText(), game.name);
    assert.match(await page.locator("#digestReadout").innerText(), /^[0-9A-F]{8}$/);
  }

  await page.evaluate(() => cartridgeZero.start("prism-break", "BROWSER-CONTROLS", 1, "live", null));
  await page.waitForFunction(() => cartridgeZero.state.tick > 5);
  const before = await page.evaluate(() => ({
    tick: cartridgeZero.state.tick,
    paddleX: cartridgeZero.state.game.paddleX,
    stuck: cartridgeZero.state.game.ball.stuck,
  }));
  await page.locator("#game").focus();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(260);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.down("Space");
  await page.waitForTimeout(80);
  await page.keyboard.up("Space");
  const after = await page.evaluate(() => ({
    tick: cartridgeZero.state.tick,
    paddleX: cartridgeZero.state.game.paddleX,
    stuck: cartridgeZero.state.game.ball.stuck,
  }));
  assert.ok(after.tick > before.tick);
  assert.ok(after.paddleX > before.paddleX, "held right input must move the paddle continuously");
  assert.equal(before.stuck, true);
  assert.equal(after.stuck, false, "fire must serve the Prism Break ball");
  assert.equal(await page.locator("#modeReadout").innerText(), "LIVE");

  await page.click("#pauseButton");
  assert.equal(await page.locator("#messageTitle").innerText(), "PAUSED");
  assert.equal(await page.locator("#modeReadout").innerText(), "PAUSED");
  const pausedTick = await page.evaluate(() => cartridgeZero.state.tick);
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => cartridgeZero.state.tick), pausedTick);
  await page.click("#messageButton");
  await page.locator("#messageLayer").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#modeReadout").innerText(), "LIVE");
  const beforeSwitchInput = await page.evaluate(() => cartridgeZero.state.game.paddleX);
  await page.click("#colorButton");
  assert.equal(await page.evaluate(() => document.activeElement.id), "game");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(180);
  await page.keyboard.up("ArrowLeft");
  assert.ok(await page.evaluate((beforeX) => cartridgeZero.state.game.paddleX < beforeX, beforeSwitchInput), "keyboard control must resume immediately after a console switch");
  await page.click("#replayButton");
  await page.click(".dialog-head button");
  assert.equal(await page.locator("#replayDialog").evaluate((element) => element.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "game");
  await page.screenshot({ path: path.join(__dirname, "cartridge-zero-prism.png"), fullPage: true });

  await page.waitForFunction(() => cartridgeZero.state.tick > 35);
  await page.click("#replayButton");
  assert.equal(await page.locator("#replayDialog").evaluate((element) => element.open), true);
  const code = await page.locator("#replayText").inputValue();
  assert.match(code, /^CZ01\.[0-9A-F]{8}\.[A-Za-z0-9_-]+$/);
  const decoded = core.decodeReplay(code);
  const liveDigest = await page.evaluate(() => cartridgeZero.digest());
  assert.ok(decoded.ticks > 0);
  assert.equal(decoded.gameId, "prism-break");
  await page.click("#watchReplayButton");
  await page.waitForFunction(() => cartridgeZero.mode === "replay");
  await page.waitForFunction((ticks) => (
    cartridgeZero.replayTick === ticks &&
    !document.querySelector("#messageLayer").hidden &&
    document.querySelector("#messageTitle").textContent === "RECEIPT COMPLETE"
  ), decoded.ticks, { timeout: 10000 });
  assert.equal(await page.evaluate(() => cartridgeZero.digest()), liveDigest);
  assert.equal(await page.locator("#digestReadout").innerText(), liveDigest);
  assert.match(await page.locator("#modeReadout").innerText(), /^REPLAY COMPLETE \d+\/\d+$/);

  const terminalRecorder = core.createRecorder("gridburn", "BROWSER-TERMINAL-TAIL", 2);
  for (let tick = 0; tick < 179; tick += 1) core.recordInput(terminalRecorder, 0);
  core.recordInput(terminalRecorder, core.INPUT.LEFT | core.INPUT.FIRE);
  const terminalReplay = core.decodeReplay(core.encodeReplay(terminalRecorder));
  const beganUnpaused = await page.evaluate((replayObject) => {
    cartridgeZero.start(replayObject.gameId, replayObject.seed, replayObject.difficulty, "replay", replayObject);
    cartridgeZero.state.gameOver = true;
    return !cartridgeZero.paused;
  }, terminalReplay);
  assert.equal(beganUnpaused, true, "a terminal replay must continue consuming its ledger tail");
  await page.click("#pauseButton");
  assert.equal(await page.evaluate(() => cartridgeZero.paused), true);
  assert.match(await page.locator("#modeReadout").innerText(), /^PAUSED REPLAY /);
  const pausedReplayTick = await page.evaluate(() => cartridgeZero.replayTick);
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => cartridgeZero.replayTick), pausedReplayTick);
  await page.click("#messageButton");
  assert.equal(await page.evaluate(() => cartridgeZero.paused), false);
  await page.waitForFunction((ticks) => (
    cartridgeZero.replayTick === ticks &&
    document.querySelector("#messageTitle").textContent === "RECEIPT COMPLETE"
  ), terminalReplay.ticks, { timeout: 5000 });
  assert.equal(await page.evaluate(() => cartridgeZero.state.previousActions), core.INPUT.LEFT | core.INPUT.FIRE);
  assert.equal(await page.locator("#digestReadout").innerText(), await page.evaluate(() => cartridgeZero.digest()));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url, { waitUntil: "load" });
  const mobile = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
    bootVisible: getComputedStyle(document.querySelector("#bootLayer")).display !== "none",
    launch: document.querySelector("#startButton").getBoundingClientRect(),
    gameView: document.querySelector("#viewport").getBoundingClientRect(),
    controller: getComputedStyle(document.querySelector(".controller")).display,
  }));
  assert.equal(mobile.bootVisible, true);
  assert.equal(mobile.controller, "flex");
  assert.ok(mobile.contentWidth <= mobile.viewportWidth + 1, `mobile layout overflows by ${mobile.contentWidth - mobile.viewportWidth}px`);
  assert.ok(mobile.launch.top >= mobile.gameView.top - 1, "mobile launch control must remain inside the screen");
  assert.ok(mobile.launch.bottom <= mobile.gameView.bottom + 1, "mobile launch control must fit without scrolling the boot layer");
  await page.screenshot({ path: path.join(__dirname, "cartridge-zero-mobile.png"), fullPage: true });

  assert.deepEqual(requests.filter((requestUrl) => !requestUrl.startsWith("file://")), []);
  assert.deepEqual(errors, []);
  await browser.close();
  process.stdout.write("ok - seven-program boot, rendering, controls, pause, exact receipt playback, terminal ledger drain, offline boundary, and mobile console\n");
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
