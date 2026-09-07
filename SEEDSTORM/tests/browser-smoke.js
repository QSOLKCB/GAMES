"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const core = require("../core.js");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.SEEDSTORM_CHROMIUM || chromium.executablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  const requests = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("request", (request) => requests.push(request.url()));

  const url = `file://${path.join(__dirname, "..", "index.html")}`;
  await page.goto(url, { waitUntil: "load" });
  assert.equal(await page.title(), "SEEDSTORM — Deterministic Strike");
  assert.equal(await page.locator("#introLayer").isVisible(), true);
  assert.equal(await page.locator("#startButton").isEnabled(), true);
  await page.screenshot({ path: path.join(__dirname, "seedstorm-intro.png"), fullPage: true });

  await page.fill("#seedInput", "BROWSER-SMOKE");
  await page.focus("#startButton");
  await page.keyboard.press("Space");
  await page.locator("#introLayer").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#introLayer").isVisible(), false);
  assert.match(await page.locator("#seedReadout").innerText(), /^[0-9A-F]{8}$/);
  assert.equal(await page.locator("#runMode").innerText(), "LIVE INPUT");

  await page.focus("#pauseButton");
  await page.keyboard.press("Space");
  await page.locator("#messageLayer").waitFor({ state: "visible" });
  assert.equal(await page.locator("#pauseButton").innerText(), "RESUME");
  await page.click("#restartButton");
  await page.locator("#messageLayer").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#pauseButton").innerText(), "PAUSE");
  assert.equal(await page.locator("#runMode").innerText(), "LIVE INPUT");
  await page.waitForTimeout(250);
  const restartTelemetry = await page.evaluate(() => ({
    progress: document.querySelector("#levelProgress").style.width,
    pause: document.querySelector("#pauseButton").textContent,
    pauseDisabled: document.querySelector("#pauseButton").disabled,
    hidden: document.hidden,
    focused: document.hasFocus(),
  }));
  process.stdout.write(`restart telemetry ${JSON.stringify(restartTelemetry)}\n`);
  assert.deepEqual(errors, [], "restart must not throw before its first simulation tick");
  await page.waitForFunction(
    () => Number.parseFloat(document.querySelector("#levelProgress").style.width) > 0,
    null,
    { timeout: 20000 }
  );

  await page.keyboard.down("KeyZ");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(260);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(340);
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, "seedstorm-health.png"), fullPage: true });
  assert.ok(Number.isFinite(Number(await page.locator("#scoreReadout").innerText())), "live score telemetry must remain numeric");
  await page.screenshot({ path: path.join(__dirname, "seedstorm-explosion.png"), fullPage: true });
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.up("KeyZ");
  assert.ok(Number(await page.locator("#scoreReadout").innerText()) >= 0);
  await page.screenshot({ path: path.join(__dirname, "seedstorm-live.png"), fullPage: true });

  await page.click("#replayButton");
  assert.equal(await page.locator("#replayDialog").evaluate((element) => element.open), true);
  const code = await page.locator("#replayText").inputValue();
  assert.match(code, /^SSR1\.[0-9A-F]{8}\.[A-Za-z0-9_-]+$/);
  assert.match(await page.locator("#replayMeta").innerText(), /ticks/);
  const decoded = core.decodeReplay(code);
  assert.ok(decoded.ticks > 0, "browser flight must advance before replay export");
  assert.ok(decoded.runs.length > 0, "advanced replay must contain input runs");

  await page.click(".close-button");
  await page.focus("#pauseButton");
  if (await page.locator("#pauseButton").innerText() === "PAUSE") await page.keyboard.press("Space");
  assert.equal(await page.locator("#pauseButton").innerText(), "RESUME");
  await page.click("#loadReplayButton");
  await page.fill("#replayText", code);
  await page.click("#watchReplayButton");
  await page.waitForFunction(() => document.querySelector("#runMode").textContent.startsWith("REPLAY"));
  assert.equal(await page.locator("#pauseButton").innerText(), "PAUSE");
  assert.match(await page.locator("#runMode").innerText(), /^REPLAY \/\/ \d+(?:\.\d+)?%$/);
  await page.waitForFunction(() => /REPLAY COMPLETE|GAME OVER/.test(document.querySelector("#messageTitle").textContent), null, { timeout: 10000 });
  await page.locator("#messageLayer").waitFor({ state: "visible" });
  assert.match(await page.locator("#messageTitle").textContent(), /REPLAY COMPLETE|GAME OVER/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url, { waitUntil: "load" });
  const mobileLayout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    introVisible: getComputedStyle(document.querySelector("#introLayer")).visibility !== "hidden",
  }));
  assert.equal(mobileLayout.introVisible, true);
  assert.ok(mobileLayout.content <= mobileLayout.viewport + 1, `mobile layout overflows by ${mobileLayout.content - mobileLayout.viewport}px`);
  await page.screenshot({ path: path.join(__dirname, "seedstorm-mobile.png"), fullPage: true });

  const externalRequests = requests.filter((requestUrl) => !requestUrl.startsWith("file://"));
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);

  await page.screenshot({ path: path.join(__dirname, "seedstorm-smoke.png"), fullPage: true });
  await browser.close();
  process.stdout.write("ok - offline browser launch, combat feedback, live controls, replay export, and replay playback\n");
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
