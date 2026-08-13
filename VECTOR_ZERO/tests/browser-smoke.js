"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const core = require("../core.js");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.VECTOR_ZERO_CHROMIUM || chromium.executablePath(),
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
  assert.equal(await page.title(), "VECTOR ZERO — Deterministic 6DOF Mine Shooter");
  assert.equal(await page.locator("#bootLayer").isVisible(), true);
  assert.equal(await page.locator("#startButton").isEnabled(), true);
  await page.screenshot({ path: path.join(__dirname, "vector-zero-boot.png"), fullPage: true });

  await page.fill("#seedInput", "BROWSER-VECTOR-ZERO");
  await page.selectOption("#difficultySelect", "0");
  await page.click("#startButton");
  await page.locator("#bootLayer").waitFor({ state: "hidden" });
  await page.waitForFunction(() => window.vectorZero && vectorZero.state && vectorZero.state.tick > 5);
  assert.equal(await page.locator("#modeReadout").innerText(), "LIVE INPUT");
  assert.match(await page.locator("#seedReadout").innerText(), /^[0-9A-F]{8}$/);
  assert.match(await page.locator("#digestReadout").innerText(), /^[0-9A-F]{8}$/);

  const yawBeforeKeyboardSteering = await page.evaluate(() => vectorZero.state.player.yaw);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(220);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(60);
  const keyboardYawDelta = await page.evaluate((before) => {
    const after = vectorZero.state.player.yaw;
    return ((after - before + VectorZeroCore.ANGLE_MAX / 2) % VectorZeroCore.ANGLE_MAX) - VectorZeroCore.ANGLE_MAX / 2;
  }, yawBeforeKeyboardSteering);
  assert.ok(keyboardYawDelta < -1000, `held ArrowLeft must steer continuously, received yaw delta ${keyboardYawDelta}`);

  const before = await page.evaluate(() => ({
    tick: vectorZero.state.tick,
    x: vectorZero.state.player.x,
    y: vectorZero.state.player.y,
    z: vectorZero.state.player.z,
    roll: vectorZero.state.player.roll,
  }));
  await page.keyboard.down("KeyW");
  await page.keyboard.down("KeyR");
  await page.keyboard.down("KeyE");
  await page.waitForTimeout(360);
  await page.keyboard.up("KeyW");
  await page.keyboard.up("KeyR");
  await page.keyboard.up("KeyE");
  await page.keyboard.down("Space");
  await page.waitForTimeout(180);
  await page.keyboard.up("Space");
  const after = await page.evaluate(() => ({
    tick: vectorZero.state.tick,
    x: vectorZero.state.player.x,
    y: vectorZero.state.player.y,
    z: vectorZero.state.player.z,
    roll: vectorZero.state.player.roll,
    shots: vectorZero.state.stats.shots,
    finite: Object.values(vectorZero.state.player).filter((value) => typeof value === "number").every(Number.isFinite),
  }));
  assert.ok(after.tick > before.tick);
  assert.ok(after.x !== before.x || after.y !== before.y || after.z !== before.z);
  assert.notEqual(after.roll, before.roll);
  assert.ok(after.shots > 0);
  assert.equal(after.finite, true);
  assert.equal(await page.evaluate(() => {
    const state = vectorZero.state;
    return VectorZeroCore.canOccupy(state.blueprint, state.player.x, state.player.y, state.player.z, VectorZeroCore.PLAYER_RADIUS);
  }), true);

  const projected = await page.evaluate(() => {
    const state = vectorZero.state;
    const basis = VectorZeroCore.getBasis(state.player.yaw, state.player.pitch, state.player.roll);
    return vectorZero.project({
      x: state.player.x + Math.trunc(basis.forward.x * 8 * VectorZeroCore.FP / VectorZeroCore.TRIG_SCALE),
      y: state.player.y + Math.trunc(basis.forward.y * 8 * VectorZeroCore.FP / VectorZeroCore.TRIG_SCALE),
      z: state.player.z + Math.trunc(basis.forward.z * 8 * VectorZeroCore.FP / VectorZeroCore.TRIG_SCALE),
    });
  });
  assert.ok(projected);
  assert.ok(Math.abs(projected.x - 240) < 2);
  assert.ok(Math.abs(projected.y - 135) < 2);
  assert.ok(Math.abs(projected.depth - 8 * core.FP) < 8);
  await page.screenshot({ path: path.join(__dirname, "vector-zero-flight.png"), fullPage: true });

  await page.click("#pauseButton");
  assert.equal(await page.locator("#messageLayer").isVisible(), true);
  assert.equal(await page.locator("#modeReadout").innerText(), "PAUSED");
  const pausedTick = await page.evaluate(() => vectorZero.state.tick);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => vectorZero.state.tick), pausedTick);
  await page.click("#messageButton");
  await page.locator("#messageLayer").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#modeReadout").innerText(), "LIVE INPUT");

  await page.click("#replayButton");
  assert.equal(await page.locator("#replayDialog").evaluate((element) => element.open), true);
  const code = await page.locator("#replayText").inputValue();
  assert.match(code, /^VZ01\.[0-9A-F]{8}\.[A-Za-z0-9_-]+$/);
  const decoded = core.decodeReplay(code);
  assert.ok(decoded.ticks > 0);
  await page.click("#watchReplayButton");
  await page.waitForFunction(() => vectorZero.mode === "replay");
  await page.waitForFunction(() => /REPLAY/.test(document.querySelector("#modeReadout").textContent));
  await page.waitForFunction(() => (
    vectorZero.replayTick > 0 &&
    !document.querySelector("#messageLayer").hidden &&
    document.querySelector("#messageTitle").textContent === "RECEIPT COMPLETE"
  ), null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => vectorZero.replayTick), decoded.ticks);
  assert.equal(await page.locator("#digestReadout").innerText(), await page.evaluate(() => vectorZero.digest()));
  assert.match(await page.locator("#modeReadout").innerText(), /^REPLAY COMPLETE \d+\/\d+$/);

  const terminalRecorder = core.createRecorder("BROWSER-TERMINAL-VECTOR", 2);
  for (let tick = 0; tick < 119; tick += 1) core.recordInput(terminalRecorder, 0);
  core.recordInput(terminalRecorder, core.packInput(core.INPUT.ROLL_LEFT | core.INPUT.MISSILE, 7, -4));
  const terminalReplay = core.decodeReplay(core.encodeReplay(terminalRecorder));
  await page.evaluate((replayObject) => {
    vectorZero.start(replayObject.seed, replayObject.difficulty, "replay", replayObject);
    const replayState = vectorZero.state;
    replayState.player.shield = 1;
    const enemy = replayState.enemies[0];
    enemy.x = replayState.player.x + VectorZeroCore.FP;
    enemy.y = replayState.player.y;
    enemy.z = replayState.player.z;
    enemy.cooldown = 0;
    enemy.phase = 0;
  }, terminalReplay);
  await page.waitForFunction(() => vectorZero.state.gameOver, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => vectorZero.paused), false);
  await page.waitForFunction((expectedTicks) => (
    vectorZero.replayTick === expectedTicks &&
    !document.querySelector("#messageLayer").hidden &&
    document.querySelector("#messageTitle").textContent === "RECEIPT COMPLETE"
  ), terminalReplay.ticks, { timeout: 5000 });
  assert.equal(await page.evaluate(() => vectorZero.state.previousActions), core.INPUT.ROLL_LEFT | core.INPUT.MISSILE);
  assert.equal(await page.locator("#digestReadout").innerText(), await page.evaluate(() => vectorZero.digest()));

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
  assert.ok(mobile.launch.bottom <= mobile.gameView.bottom + 1, "mobile launch button must fit inside the flight display");
  assert.ok(mobile.launch.top >= mobile.gameView.top - 1, "mobile launch button must remain visible");
  await page.screenshot({ path: path.join(__dirname, "vector-zero-mobile.png"), fullPage: true });

  assert.deepEqual(requests.filter((requestUrl) => !requestUrl.startsWith("file://")), []);
  assert.deepEqual(errors, []);
  await browser.close();
  process.stdout.write("ok - boot, six-axis flight, combat, projection, pause, terminal replay drain, telemetry, offline boundary, and mobile layout\n");
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
