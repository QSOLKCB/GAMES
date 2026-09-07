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
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  const errors = [];
  const requests = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("request", (request) => requests.push(request.url()));

  const url = `file://${path.join(__dirname, "..", "index.html")}`;
  await page.goto(url, { waitUntil: "load" });
  await page.clock.pauseAt(new Date("2026-01-01T01:00:00Z"));
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
  // Keep browser input and the real frame loop, but advance every animation frame
  // explicitly so slow CI rendering cannot shorten the combat sequence.
  await page.keyboard.down("KeyZ");
  await page.clock.runFor(5000);
  await page.screenshot({ path: path.join(__dirname, "seedstorm-health.png"), fullPage: true });
  await page.clock.runFor(1000);
  await page.screenshot({ path: path.join(__dirname, "seedstorm-explosion.png"), fullPage: true });
  await page.keyboard.up("KeyZ");
  await page.keyboard.down("ArrowLeft");
  await page.clock.runFor(320);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.down("ArrowRight");
  await page.clock.runFor(320);
  await page.keyboard.up("ArrowRight");
  await page.clock.runFor(320);
  const liveScore = Number(await page.locator("#scoreReadout").innerText());
  assert.ok(liveScore > 0, "real keyboard fire must produce a visible combat score");
  await page.screenshot({ path: path.join(__dirname, "seedstorm-live.png"), fullPage: true });

  await page.click("#replayButton");
  assert.equal(await page.locator("#replayDialog").evaluate((element) => element.open), true);
  const code = await page.locator("#replayText").inputValue();
  assert.match(code, /^SSR1\.[0-9A-F]{8}\.[A-Za-z0-9_-]+$/);
  const replayMeta = await page.locator("#replayMeta").innerText();
  assert.match(replayMeta, /ticks/);
  const decoded = core.decodeReplay(code);
  assert.ok(decoded.ticks >= 400, "the real frame loop must advance through the combat sequence");
  assert.deepEqual(decoded.runs.map(([mask]) => mask), [core.INPUT.FIRE, core.INPUT.LEFT, core.INPUT.RIGHT, 0],
    "the live recorder must observe KeyZ, both movement keys, and their release");

  // Replay the browser's exported inputs through the unmodified deterministic
  // core. Positive hit/kill counts rule out score from grazing or default UI text;
  // matching the browser's live score and digest also verifies its simulation.
  const replayed = core.createRun(decoded.seed);
  const cursor = core.createReplayCursor(decoded);
  let mask;
  while ((mask = core.nextReplayInput(cursor)) !== null) core.step(replayed, mask);
  assert.ok(replayed.stats.shots > 0, "live KeyZ input must spawn projectiles");
  assert.ok(replayed.stats.hits > 0, "live projectiles must hit enemies");
  assert.ok(replayed.stats.kills > 0, "live projectile hits must finish an enemy");
  assert.equal(liveScore, replayed.score, "the HUD must show the actual live combat score");
  const liveDigest = /\bdigest ([0-9A-F]{8})\b/.exec(replayMeta);
  assert.ok(liveDigest, "replay export must include the live state digest");
  assert.equal(liveDigest[1], core.stateDigest(replayed), "live browser combat must match its exported inputs");

  await page.click(".close-button");
  await page.focus("#pauseButton");
  if (await page.locator("#pauseButton").innerText() === "PAUSE") await page.keyboard.press("Space");
  assert.equal(await page.locator("#pauseButton").innerText(), "RESUME");
  await page.click("#loadReplayButton");
  await page.fill("#replayText", code);
  await page.click("#watchReplayButton");
  assert.equal(await page.locator("#pauseButton").innerText(), "PAUSE");
  assert.match(await page.locator("#runMode").innerText(), /^REPLAY \/\/ \d+(?:\.\d+)?%$/);
  await page.clock.runFor(Math.ceil(decoded.ticks * 1000 / core.TICK_RATE) + 100);
  await page.locator("#messageLayer").waitFor({ state: "visible" });
  assert.equal(await page.locator("#messageTitle").textContent(), "REPLAY COMPLETE");
  assert.equal(Number(await page.locator("#scoreReadout").innerText()), liveScore);
  assert.match(await page.locator("#messageText").innerText(), new RegExp(core.stateDigest(replayed)));

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
