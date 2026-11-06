"use strict";
// Drives the shared standard-gamepad reader through each wired game with a
// scripted navigator.getGamepads(), checking neutral arming, recorded input,
// Start pause/resume and pause on disconnect.
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const B = { SOUTH: 0, EAST: 1, WEST: 2, NORTH: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

function installFakePad() {
  let pad = null;
  Object.defineProperty(Navigator.prototype, "getGamepads", {
    configurable: true,
    value: () => (pad ? [pad] : []),
  });
  window.__setPad = (spec) => {
    if (!spec) {
      pad = null;
      return;
    }
    const held = spec.held || [];
    pad = {
      id: "QSOL scripted standard pad",
      index: 0,
      mapping: "standard",
      connected: true,
      axes: spec.axes || [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({ value: held.includes(i) ? 1 : 0, pressed: held.includes(i) })),
    };
  };
  window.__frames = (count) =>
    new Promise((resolve) => {
      const next = () => (count-- <= 0 ? resolve() : requestAnimationFrame(next));
      requestAnimationFrame(next);
    });
}

async function pad(page, spec, frames = 4) {
  await page.evaluate(([value, count]) => {
    window.__setPad(value);
    return window.__frames(count);
  }, [spec, frames]);
}

// Press and release a button with a neutral sample on both sides.
async function tap(page, button) {
  await pad(page, {});
  await pad(page, { held: [button] });
  await pad(page, {});
}

const games = [
  {
    name: "BLACKSTAR_AGA",
    api: "blackstarAGA",
    boot: "#bootLayer",
    message: "#messageLayer",
    messageTitle: "#messageTitle",
    drive: { held: [B.RT], axes: [0, -1, 0, 0] },
    expect: (word, core) => (word & core.INPUT.FIRE) !== 0 && (word & core.INPUT.FORWARD) !== 0,
    core: "BlackstarCore",
  },
  {
    name: "VECTOR_ZERO",
    api: "vectorZero",
    boot: "#bootLayer",
    message: "#messageLayer",
    messageTitle: "#messageTitle",
    drive: { held: [B.RT, B.SOUTH], axes: [0, -1, 1, 0] },
    expect: (word, core) =>
      (word & core.INPUT.FIRE) !== 0 && (word & core.INPUT.FORWARD) !== 0 && (word & core.INPUT.RISE) !== 0 && ((word >>> 12) & 0xff) === 6, // full right stick = +6 yaw per tick
    core: "VectorZeroCore",
  },
  {
    name: "CARTRIDGE_ZERO",
    api: "cartridgeZero",
    boot: "#bootLayer",
    message: "#messageLayer",
    messageTitle: "#messageTitle",
    drive: { held: [B.SOUTH, B.LEFT] },
    expect: (word, core) => (word & core.INPUT.FIRE) !== 0 && (word & core.INPUT.LEFT) !== 0,
    core: "CartridgeZeroCore",
  },
  {
    name: "SEEDSTORM",
    api: null,
    boot: "#introLayer",
    message: "#messageLayer",
    messageTitle: "#messageTitle",
    drive: { held: [B.RT], axes: [-1, 0, 0, 0] },
    expect: (word, core) => (word & core.INPUT.FIRE) !== 0 && (word & core.INPUT.LEFT) !== 0,
    core: "SeedStormCore",
  },
];

async function isVisible(page, selector) {
  return page.evaluate((s) => {
    const node = document.querySelector(s);
    return Boolean(node) && !node.hidden && !node.classList.contains("is-hidden");
  }, selector);
}

async function paused(page, game) {
  if (game.api) return page.evaluate((api) => window[api].paused, game.api);
  return (await page.locator("#pauseButton").innerText()).trim() === "RESUME";
}

// Recorded input words for the live run, as (word, count) runs.
async function recordedRuns(page, game) {
  if (game.api) return page.evaluate((api) => window[api].recorder.runs.map((run) => run.slice()), game.api);
  await page.click("#replayButton");
  const runs = await page.evaluate((coreName) => {
    const decoded = window[coreName].decodeReplay(document.querySelector("#replayText").value);
    return decoded.runs.map((run) => run.slice());
  }, game.core);
  await page.evaluate(() => document.querySelector("#replayDialog").close());
  return runs;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.GAMES_CHROMIUM || chromium.executablePath(),
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  try {
    for (const game of games) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.addInitScript(installFakePad);
      await page.goto(pathToFileURL(path.join(root, game.name, "index.html")).href);
      await page.evaluate(() => window.__frames(2));
      assert.equal(await isVisible(page, game.boot), true, `${game.name}: title screen visible`);

      // A pad that appears with Start already held must not launch anything.
      await pad(page, { held: [B.START, B.SOUTH] }, 6);
      assert.equal(await isVisible(page, game.boot), true, `${game.name}: held Start ignored until neutral`);

      if (game.name === "CARTRIDGE_ZERO") {
        await tap(page, B.RIGHT);
        assert.equal(await page.locator("#selectedTitle").innerText(), "GRIDBURN", "d-pad picks the next program");
        await tap(page, B.LEFT);
        assert.equal(await page.locator("#selectedTitle").innerText(), "PRISM BREAK", "d-pad picks the previous program");
      }

      // Neutral arms the pad; a fresh Start launches a live run.
      await tap(page, B.START);
      assert.equal(await isVisible(page, game.boot), false, `${game.name}: Start launches`);
      assert.equal(await paused(page, game), false, `${game.name}: live after launch`);

      // Drive with sticks and buttons. The input must reach the recorded words.
      await pad(page, {}, 4);
      await pad(page, game.drive, 30);
      await pad(page, {}, 2);
      const inputs = await page.evaluate((name) => ({ INPUT: window[name].INPUT }), game.core);
      const runs = await recordedRuns(page, game);
      assert.ok(runs.some(([word]) => game.expect(word, inputs)), `${game.name}: gamepad input recorded (${JSON.stringify(runs.slice(-6))})`);

      // Start pauses; Start on the pause message resumes.
      await tap(page, B.START);
      assert.equal(await paused(page, game), true, `${game.name}: Start pauses`);
      await tap(page, B.START);
      assert.equal(await paused(page, game), false, `${game.name}: Start resumes`);

      // An armed pad disconnecting mid-run pauses with an explanation.
      await pad(page, {}, 4);
      await pad(page, null, 4);
      assert.equal(await paused(page, game), true, `${game.name}: disconnect pauses`);
      assert.equal(await isVisible(page, game.message), true, `${game.name}: disconnect message visible`);
      assert.equal(await page.locator(game.messageTitle).innerText(), "CONTROLLER DISCONNECTED");

      assert.deepEqual(errors, [], `${game.name}: no page errors`);
      process.stdout.write(`ok - ${game.name} standard gamepad: neutral arming, recorded input, Start pause/resume, disconnect pause\n`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
