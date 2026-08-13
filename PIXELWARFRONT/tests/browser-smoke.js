"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const core = require("../core.js");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PIXELWARFRONT_CHROMIUM || chromium.executablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  const requests = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("request", (request) => requests.push(request.url()));

  const url = `file://${path.join(__dirname, "..", "index.html")}`;
  await page.goto(url, { waitUntil: "load" });
  assert.equal(await page.title(), "PIXEL WARFRONT — Deterministic Command");
  assert.equal(await page.locator("#introLayer").isVisible(), true);
  assert.equal(await page.locator("#startButton").isEnabled(), true);
  await page.screenshot({ path: path.join(__dirname, "pixelwarfront-intro.png"), fullPage: true });

  await page.fill("#seedInput", "BROWSER-WARFRONT");
  await page.click("#startButton");
  await page.locator("#introLayer").waitFor({ state: "hidden" });
  assert.match(await page.locator("#seedReadout").innerText(), /^[0-9A-F]{8}$/);
  assert.equal(await page.locator("#runMode").innerText(), "LIVE COMMAND");
  assert.equal(await page.locator("#creditsReadout").innerText(), "0920");

  await page.focus("#pauseButton");
  await page.keyboard.press("Space");
  await page.locator("#messageLayer").waitFor({ state: "visible" });
  assert.equal(await page.locator("#pauseButton").innerText(), "RESUME");
  await page.focus("#restartButton");
  await page.keyboard.press("Space");
  await page.locator("#messageLayer").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#pauseButton").innerText(), "PAUSE");

  const box = await page.locator("#game").boundingBox();
  assert.ok(box, "battlefield canvas must be visible");
  const world = (x, y) => ({ x: box.x + x / core.WIDTH * box.width, y: box.y + y / core.HEIGHT * box.height });
  const selectStart = world(142, 250);
  const selectEnd = world(220, 348);
  await page.mouse.move(selectStart.x, selectStart.y);
  await page.mouse.down();
  await page.mouse.move(selectEnd.x, selectEnd.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector("#selectionName").textContent.startsWith("NO"));

  const destination = world(390, 300);
  await page.mouse.click(destination.x, destination.y, { button: "right" });
  await page.waitForTimeout(180);
  assert.match(await page.locator("#statusLine").innerText(), /move order/i);

  await page.click("#buildRelay");
  assert.match(await page.locator("#placementStatus").innerText(), /PLACE GRID RELAY/);
  const relaySite = world(170, 200);
  await page.mouse.click(relaySite.x, relaySite.y);
  await page.waitForTimeout(180);
  assert.match(await page.locator("#statusLine").innerText(), /placement command/i);

  await page.click("#trainDrone");
  await page.waitForTimeout(2700);
  await page.screenshot({ path: path.join(__dirname, "pixelwarfront-live.png"), fullPage: true });

  await page.click("#replayButton");
  assert.equal(await page.locator("#replayDialog").evaluate((element) => element.open), true);
  const code = await page.locator("#replayText").inputValue();
  assert.match(code, /^PWR1\.[0-9A-F]{8}\.[A-Za-z0-9_-]+$/);
  assert.match(await page.locator("#replayMeta").innerText(), /command frames/);
  const decoded = core.decodeReplay(code);
  assert.ok(decoded.entries.length >= 1);

  await page.click("#watchReplayButton");
  await page.waitForFunction(() => document.querySelector("#runMode").textContent.startsWith("REPLAY"));
  assert.equal(await page.locator("#replayDialog").evaluate((element) => element.open), false);
  await page.waitForFunction(() => document.querySelector("#messageTitle").textContent === "REPLAY COMPLETE", null, { timeout: 8000 });
  await page.locator("#messageLayer").waitFor({ state: "visible" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url, { waitUntil: "load" });
  const mobile = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    introVisible: getComputedStyle(document.querySelector("#introLayer")).visibility !== "hidden",
  }));
  assert.equal(mobile.introVisible, true);
  assert.ok(mobile.content <= mobile.viewport + 1, `mobile layout overflows by ${mobile.content - mobile.viewport}px`);
  await page.screenshot({ path: path.join(__dirname, "pixelwarfront-mobile.png"), fullPage: true });

  const externalRequests = requests.filter((requestUrl) => !requestUrl.startsWith("file://"));
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(errors, []);
  await browser.close();
  process.stdout.write("ok - offline RTS launch, selection, command, production, export, and replay playback\n");
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
