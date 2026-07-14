(function runInertiaZeroTests() {
  "use strict";

  const Core = typeof module === "object" && module.exports
    ? require("../core.js")
    : window.InertiaZeroCore;
  const results = [];

  function test(name, callback) {
    try {
      callback();
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: error.message });
    }
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed");
  }

  function equal(actual, expected, message) {
    assert(actual === expected, `${message || "Values differ"}: expected ${expected}, received ${actual}`);
  }

  function near(actual, expected, epsilon, message) {
    assert(Math.abs(actual - expected) <= epsilon, `${message || "Values are not near"}: expected ${expected}, received ${actual}`);
  }

  test("Golden seeded RNG sequence is stable", () => {
    const rng = new Core.RNG("INERTIA-ZERO-GOLDEN");
    const actual = Array.from({ length: 6 }, () => rng.next().toFixed(10));
    const expected = ["0.1169021316", "0.7517321797", "0.8972742707", "0.2409417641", "0.3969831748", "0.6384400085"];
    equal(actual.join(","), expected.join(","), "Golden sequence changed");
  });

  test("Same campaign seed reproduces the same arena", () => {
    const first = Core.generateArena("ADELAIDE-ZERO-PING", 7, "asteroids");
    const second = Core.generateArena("ADELAIDE-ZERO-PING", 7, "asteroids");
    equal(Core.arenaFingerprint(first), Core.arenaFingerprint(second), "Arena fingerprints differ");
    equal(JSON.stringify(first), JSON.stringify(second), "Arena payloads differ");
  });

  test("Different seeds produce different arena fingerprints", () => {
    const fingerprints = new Set();
    for (let index = 0; index < 80; index += 1) {
      fingerprints.add(Core.arenaFingerprint(Core.generateArena(`SEED-${index}`, 2, "asteroids")));
    }
    assert(fingerprints.size >= 78, `Expected at least 78 unique layouts, received ${fingerprints.size}`);
  });

  test("Objective types rotate across campaign sectors", () => {
    const types = Array.from({ length: 8 }, (_, index) => Core.generateArena("OBJECTIVES", index + 1, "open").objective.type);
    equal(types.join(","), "elimination,control,core,survival,elimination,control,core,survival", "Unexpected objective rotation");
  });

  test("All eight classic ship frames have complete legal configuration", () => {
    const ships = Object.values(Core.SHIPS);
    equal(ships.length, 8, "Ship count");
    const expected = ["warbird", "javelin", "spider", "leviathan", "terrier", "weasel", "lancaster", "shark"];
    equal(ships.map((ship) => ship.id).join(","), expected.join(","), "Ship order or IDs changed");
    for (const ship of ships) {
      assert(ship.maxEnergy > ship.gunCost + ship.secondaryCost, `${ship.id} has an unusable energy budget`);
      assert(ship.maxSpeed > 0 && ship.thrust > 0 && ship.turnRate > 0, `${ship.id} has invalid flight physics`);
      assert(ship.gunCooldown > 0 && ship.secondaryCooldown > 0 && ship.specialCooldown > 0, `${ship.id} has invalid cooldowns`);
      assert(typeof ship.special === "string" && typeof ship.secondary === "string", `${ship.id} lacks weapon identity`);
    }
  });

  test("AI difficulty changes decision skill without physics or damage bonuses", () => {
    const difficulties = Object.values(Core.DIFFICULTIES);
    equal(difficulties.length, 5, "Difficulty count");
    for (const difficulty of difficulties) {
      equal(difficulty.speedScale, 1, `${difficulty.id} speed scale`);
      equal(difficulty.damageScale, 1, `${difficulty.id} damage scale`);
    }
    assert(difficulties[4].reaction < difficulties[0].reaction, "Top AI should react faster");
    assert(difficulties[4].aimError < difficulties[0].aimError, "Top AI should aim more accurately");
    assert(difficulties[4].dodge > difficulties[0].dodge, "Top AI should evade more effectively");
  });

  test("Intercept solver leads a moving target", () => {
    const result = Core.solveIntercept(
      { x: 0, y: 0, vx: 0, vy: 0 },
      { x: 100, y: 0, vx: 10, vy: 0 },
      50
    );
    near(result.time, 2.5, 1e-9, "Intercept time");
    near(result.x, 125, 1e-9, "Intercept position");
    near(result.y, 0, 1e-9, "Intercept vertical position");
  });

  test("Line-of-sight detects both circular and rectangular cover", () => {
    const start = { x: 0, y: 50 };
    const end = { x: 200, y: 50 };
    assert(!Core.lineOfSight(start, end, [{ type: "circle", x: 100, y: 50, r: 20 }]), "Circle should block line of sight");
    assert(!Core.lineOfSight(start, end, [{ type: "rect", x: 90, y: 10, w: 20, h: 80 }]), "Rectangle should block line of sight");
    assert(Core.lineOfSight(start, end, [{ type: "circle", x: 100, y: 120, r: 20 }]), "Distant obstacle should not block line of sight");
  });

  test("A-star pathfinder returns unblocked waypoints through a channel arena", () => {
    const arena = Core.generateArena("PATH-TEST", 3, "channels");
    const start = arena.playerSpawn;
    const goal = arena.enemySpawns[0];
    const path = Core.findPath(start, goal, arena, 90);
    assert(path.length > 0, "Path is empty");
    near(path[path.length - 1].x, goal.x, 1e-9, "Path does not end at goal X");
    near(path[path.length - 1].y, goal.y, 1e-9, "Path does not end at goal Y");
    let previous = start;
    for (const point of path) {
      assert(!Core.pointBlocked(point, arena.obstacles, 28), `Waypoint ${point.x},${point.y} is blocked`);
      assert(Core.lineOfSight(previous, point, arena.obstacles, 29), `Path segment to ${point.x},${point.y} crosses an obstacle`);
      previous = point;
    }
  });

  test("Navigation routes stay segment-clear across procedural recipes", () => {
    const styles = ["open", "asteroids", "rings", "fortress", "channels"];
    for (let seed = 0; seed < 50; seed += 1) {
      for (const style of styles) {
        const arena = Core.generateArena(`ROUTE-${seed}`, (seed % 12) + 1, style);
        const targets = [...arena.enemySpawns, arena.objective];
        for (const target of targets) {
          const path = Core.findPath(arena.playerSpawn, target, arena, 90);
          assert(path.length > 0, `${style}/${seed}: no route to required target`);
          let previous = arena.playerSpawn;
          for (const point of path) {
            assert(Core.lineOfSight(previous, point, arena.obstacles, 29), `${style}/${seed}: route segment crosses geometry`);
            previous = point;
          }
        }
      }
    }
  });

  test("Procedural recipes keep every required spawn clear", () => {
    const styles = ["open", "asteroids", "rings", "fortress", "channels"];
    for (let seed = 0; seed < 150; seed += 1) {
      for (const style of styles) {
        const arena = Core.generateArena(`FUZZ-${seed}`, (seed % 12) + 1, style);
        if (style === "channels") {
          equal(arena.obstacles.filter((obstacle) => obstacle.type === "rect" && obstacle.kind === "conduit").length, 6, `${style}/${seed}: conduit sections`);
        }
        assert(!Core.pointBlocked(arena.playerSpawn, arena.obstacles, 36), `${style}/${seed}: player spawn blocked`);
        for (const spawn of arena.enemySpawns) {
          assert(!Core.pointBlocked(spawn, arena.obstacles, 36), `${style}/${seed}: enemy spawn blocked`);
        }
        assert(!Core.pointBlocked(arena.objective, arena.obstacles, arena.objective.radius + 12), `${style}/${seed}: objective blocked`);
        for (const obstacle of arena.obstacles) {
          const values = obstacle.type === "circle"
            ? [obstacle.x, obstacle.y, obstacle.r]
            : [obstacle.x, obstacle.y, obstacle.w, obstacle.h];
          assert(values.every(Number.isFinite), `${style}/${seed}: non-finite obstacle geometry`);
        }
      }
    }
  });

  test("Angle utilities choose the shortest rotation", () => {
    near(Core.angleDelta(Math.PI * 1.9, Math.PI * 0.1), Math.PI * 0.2, 1e-9, "Wrapped angle delta");
    near(Core.rotateToward(0, Math.PI, 0.3), 0.3, 1e-9, "Rotation clamp");
  });

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;

  if (typeof document !== "undefined") {
    const root = document.querySelector("#results");
    root.innerHTML = results.map((result) => `
      <article class="${result.passed ? "pass" : "fail"}">
        <b>${result.passed ? "PASS" : "FAIL"}</b>
        <span>${result.name}</span>
        ${result.error ? `<small>${result.error}</small>` : ""}
      </article>`).join("");
    document.querySelector("#summary").textContent = `${passed} passed // ${failed} failed`;
    document.body.classList.toggle("has-failures", failed > 0);
  } else {
    for (const result of results) {
      console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}${result.error ? ` — ${result.error}` : ""}`);
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
  }
}());
