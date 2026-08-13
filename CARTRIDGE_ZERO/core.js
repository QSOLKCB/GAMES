(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CartridgeZeroCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ENGINE_VERSION = 1;
  const REPLAY_PREFIX = "CZ01";
  const TICK_RATE = 60;
  const WIDTH = 160;
  const HEIGHT = 192;
  const FP = 16;
  const MAX_REPLAY_TICKS = TICK_RATE * 60 * 60 * 2;
  const MAX_REPLAY_PAYLOAD_LENGTH = 160 + MAX_REPLAY_TICKS * 8;
  const MAX_REPLAY_CODE_LENGTH = REPLAY_PREFIX.length + 10 + Math.ceil(MAX_REPLAY_PAYLOAD_LENGTH / 3) * 4;

  const INPUT = Object.freeze({
    LEFT: 1,
    RIGHT: 2,
    UP: 4,
    DOWN: 8,
    FIRE: 16,
    SECOND: 32,
    START: 64,
  });
  const ACTION_MASK = 0x7f;

  const GAMES = Object.freeze([
    Object.freeze({ id: "prism-break", number: 1, name: "PRISM BREAK", code: "PB", tagline: "Split the spectrum. Clear the wall." }),
    Object.freeze({ id: "gridburn", number: 2, name: "GRIDBURN", code: "GB", tagline: "Seven lanes. No safe frequency." }),
    Object.freeze({ id: "orbital-siege", number: 3, name: "ORBITAL SIEGE", code: "OS", tagline: "Hold the moonline." }),
    Object.freeze({ id: "star-talon", number: 4, name: "STAR TALON", code: "ST", tagline: "Break the predatory formation." }),
    Object.freeze({ id: "rift-runner", number: 5, name: "RIFT RUNNER", code: "RR", tagline: "Fly the river that rewrites itself." }),
    Object.freeze({ id: "iron-circuit", number: 6, name: "IRON CIRCUIT", code: "IC", tagline: "Out-think the machine armour." }),
    Object.freeze({ id: "skywater-command", number: 7, name: "SKYWATER COMMAND", code: "SC", tagline: "Win the horizon before time expires." }),
  ]);

  const DIFFICULTIES = Object.freeze([
    Object.freeze({ id: 0, name: "SWITCH B", lives: 5, speed: 85, aggression: 75 }),
    Object.freeze({ id: 1, name: "SWITCH A", lives: 3, speed: 100, aggression: 100 }),
    Object.freeze({ id: 2, name: "NIGHTMARE", lives: 2, speed: 118, aggression: 135 }),
  ]);

  const DIR16 = Object.freeze([
    Object.freeze({ x: 1024, y: 0 }), Object.freeze({ x: 946, y: 392 }),
    Object.freeze({ x: 724, y: 724 }), Object.freeze({ x: 392, y: 946 }),
    Object.freeze({ x: 0, y: 1024 }), Object.freeze({ x: -392, y: 946 }),
    Object.freeze({ x: -724, y: 724 }), Object.freeze({ x: -946, y: 392 }),
    Object.freeze({ x: -1024, y: 0 }), Object.freeze({ x: -946, y: -392 }),
    Object.freeze({ x: -724, y: -724 }), Object.freeze({ x: -392, y: -946 }),
    Object.freeze({ x: 0, y: -1024 }), Object.freeze({ x: 392, y: -946 }),
    Object.freeze({ x: 724, y: -724 }), Object.freeze({ x: 946, y: -392 }),
  ]);

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function mix32(value) {
    let mixed = value >>> 0;
    mixed ^= mixed >>> 16;
    mixed = Math.imul(mixed, 0x7feb352d);
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x846ca68b);
    mixed ^= mixed >>> 16;
    return (mixed >>> 0) || 0x6d2b79f5;
  }

  function normalizeSeed(value) {
    if (typeof value === "number" && Number.isFinite(value)) return (value >>> 0) || 0x6d2b79f5;
    const text = String(value == null ? "" : value).trim();
    if (/^0x[0-9a-f]{1,8}$/i.test(text)) return (parseInt(text.slice(2), 16) >>> 0) || 0x6d2b79f5;
    if (/^[0-9]{1,10}$/.test(text)) return (Number(text) >>> 0) || 0x6d2b79f5;
    return mix32(fnv1a(text || "CARTRIDGE-ZERO"));
  }

  function seedHex(seed) {
    return (seed >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function normalizeDifficulty(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? clamp(Math.trunc(numeric), 0, DIFFICULTIES.length - 1) : 1;
  }

  function normalizeGame(value) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < GAMES.length) return GAMES[value].id;
    const id = String(value || "").trim().toLowerCase();
    return GAMES.some((game) => game.id === id) ? id : GAMES[0].id;
  }

  function nextValue(value) {
    let state = value >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) || 0x6d2b79f5;
  }

  function nextRandom(state) {
    state.rng = nextValue(state.rng);
    return state.rng;
  }

  function randomInt(state, limit) {
    return limit > 0 ? nextRandom(state) % limit : 0;
  }

  function edgePressed(state, actions, bit) {
    return Boolean((actions & bit) && !(state.previousActions & bit));
  }

  function pointInBox(x, y, box, margin) {
    const pad = margin || 0;
    return x >= box.x - box.w / 2 - pad && x <= box.x + box.w / 2 + pad &&
      y >= box.y - box.h / 2 - pad && y <= box.y + box.h / 2 + pad;
  }

  function boxesOverlap(first, second) {
    return Math.abs(first.x - second.x) * 2 < first.w + second.w && Math.abs(first.y - second.y) * 2 < first.h + second.h;
  }

  function loseLife(state, reason) {
    if (state.gameOver || state.victory) return;
    state.lives -= 1;
    state.events.push({ type: "life-lost", reason, lives: state.lives });
    if (state.lives <= 0) {
      state.gameOver = true;
      state.events.push({ type: "game-over", score: state.score, reason });
    }
  }

  function makePrismBricks(seed, level) {
    const bricks = [];
    for (let row = 0; row < 6; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const phase = mix32(seed ^ Math.imul(level + 3, 0x9e3779b1) ^ Math.imul(row * 8 + column + 1, 0x85ebca6b));
        bricks.push({
          id: row * 8 + column + 1,
          x: (13 + column * 19) * FP,
          y: (25 + row * 9) * FP,
          w: 17 * FP,
          h: 6 * FP,
          hp: level > 1 && phase % 7 === 0 ? 2 : 1,
          band: (row + phase % 3) % 6,
        });
      }
    }
    return bricks;
  }

  function resetPrismBall(state) {
    const game = state.game;
    game.ball = { x: game.paddleX, y: 168 * FP, vx: ((state.seed ^ state.level) & 1) ? 22 : -22, vy: -25, stuck: true };
  }

  function initPrism(state) {
    state.game = { paddleX: 80 * FP, bricks: makePrismBricks(state.seed, state.level), ball: null };
    resetPrismBall(state);
  }

  function stepPrism(state, actions) {
    const game = state.game;
    const paddleSpeed = Math.floor(34 * DIFFICULTIES[state.difficulty].speed / 100);
    if ((actions & INPUT.LEFT) && !(actions & INPUT.RIGHT)) game.paddleX -= paddleSpeed;
    if ((actions & INPUT.RIGHT) && !(actions & INPUT.LEFT)) game.paddleX += paddleSpeed;
    game.paddleX = clamp(game.paddleX, 14 * FP, 146 * FP);
    const ball = game.ball;
    if (ball.stuck) {
      ball.x = game.paddleX;
      if (edgePressed(state, actions, INPUT.FIRE) || edgePressed(state, actions, INPUT.SECOND)) {
        ball.stuck = false;
        state.events.push({ type: "serve" });
      }
      return;
    }
    const previousX = ball.x;
    const previousY = ball.y;
    ball.x += ball.vx;
    ball.y += ball.vy;
    if (ball.x <= 2 * FP && ball.vx < 0) { ball.x = 2 * FP; ball.vx = -ball.vx; state.events.push({ type: "bounce" }); }
    if (ball.x >= 158 * FP && ball.vx > 0) { ball.x = 158 * FP; ball.vx = -ball.vx; state.events.push({ type: "bounce" }); }
    if (ball.y <= 8 * FP && ball.vy < 0) { ball.y = 8 * FP; ball.vy = -ball.vy; state.events.push({ type: "bounce" }); }
    const paddle = { x: game.paddleX, y: 178 * FP, w: 27 * FP, h: 4 * FP };
    if (ball.vy > 0 && previousY <= paddle.y && pointInBox(ball.x, ball.y, paddle, 2 * FP)) {
      ball.y = 174 * FP;
      ball.vy = -Math.abs(ball.vy);
      ball.vx = clamp(ball.vx + Math.trunc((ball.x - game.paddleX) / 8), -38, 38);
      if (Math.abs(ball.vx) < 10) ball.vx = ball.vx < 0 ? -10 : 10;
      state.events.push({ type: "paddle" });
    }
    for (let index = 0; index < game.bricks.length; index += 1) {
      const brick = game.bricks[index];
      if (!pointInBox(ball.x, ball.y, brick, 2 * FP)) continue;
      brick.hp -= 1;
      state.score += 25 + brick.band * 5;
      if (brick.hp <= 0) game.bricks.splice(index, 1);
      if (previousY < brick.y - brick.h / 2 || previousY > brick.y + brick.h / 2) ball.vy = -ball.vy;
      else ball.vx = -ball.vx;
      state.events.push({ type: "brick", band: brick.band, remaining: game.bricks.length });
      break;
    }
    if (ball.y > (HEIGHT + 4) * FP) {
      loseLife(state, "PRISM LOST");
      if (!state.gameOver) resetPrismBall(state);
    } else if (game.bricks.length === 0) {
      state.level += 1;
      state.score += 1000;
      game.bricks = makePrismBricks(state.seed, state.level);
      resetPrismBall(state);
      state.events.push({ type: "level", level: state.level });
    }
  }

  function initGridburn(state) {
    state.game = { lane: 3, row: 0, moveCooldown: 0, shotCooldown: 0, spawnTimer: 35, enemies: [], shots: [], enemyShots: [], kills: 0, nextId: 1, invulnerable: 0 };
  }

  function gridPlayerY(game) {
    return (176 - game.row * 15) * FP;
  }

  function stepGridburn(state, actions) {
    const game = state.game;
    if (game.moveCooldown > 0) game.moveCooldown -= 1;
    if (game.shotCooldown > 0) game.shotCooldown -= 1;
    if (game.invulnerable > 0) game.invulnerable -= 1;
    if (game.moveCooldown <= 0) {
      if ((actions & INPUT.LEFT) && !(actions & INPUT.RIGHT)) { game.lane = Math.max(0, game.lane - 1); game.moveCooldown = 6; }
      else if ((actions & INPUT.RIGHT) && !(actions & INPUT.LEFT)) { game.lane = Math.min(6, game.lane + 1); game.moveCooldown = 6; }
      else if ((actions & INPUT.UP) && !(actions & INPUT.DOWN)) { game.row = Math.min(3, game.row + 1); game.moveCooldown = 8; }
      else if ((actions & INPUT.DOWN) && !(actions & INPUT.UP)) { game.row = Math.max(0, game.row - 1); game.moveCooldown = 8; }
    }
    if ((actions & INPUT.FIRE) && game.shotCooldown <= 0) {
      game.shots.push({ lane: game.lane, y: gridPlayerY(game) - 5 * FP });
      game.shotCooldown = 9;
      state.events.push({ type: "shot", owner: "player" });
    }
    game.spawnTimer -= 1;
    if (game.spawnTimer <= 0) {
      const kind = randomInt(state, 5) === 0 ? 2 : randomInt(state, 3);
      game.enemies.push({ id: game.nextId++, lane: randomInt(state, 7), y: 19 * FP, kind, hp: kind === 2 ? 2 : 1, phase: randomInt(state, 180) });
      game.spawnTimer = Math.max(25, 84 - state.level * 3 - state.difficulty * 9);
    }
    for (const shot of game.shots) shot.y -= 52;
    for (const shot of game.enemyShots) shot.y += 34 + state.difficulty * 4;
    const enemySpeed = Math.floor((10 + state.level) * DIFFICULTIES[state.difficulty].speed / 100);
    for (const enemy of game.enemies) {
      enemy.y += enemySpeed;
      enemy.phase += 1;
      if (enemy.kind === 1 && enemy.phase % 120 === 0) enemy.lane = clamp(enemy.lane + (randomInt(state, 2) ? 1 : -1), 0, 6);
      if (enemy.phase % Math.max(75, 150 - state.difficulty * 24) === 0 && enemy.lane === game.lane) {
        game.enemyShots.push({ lane: enemy.lane, y: enemy.y + 3 * FP });
        state.events.push({ type: "shot", owner: "enemy" });
      }
    }
    const liveShots = [];
    for (const shot of game.shots) {
      let hit = false;
      for (let index = 0; index < game.enemies.length; index += 1) {
        const enemy = game.enemies[index];
        if (enemy.lane !== shot.lane || Math.abs(enemy.y - shot.y) > 6 * FP) continue;
        enemy.hp -= 1;
        hit = true;
        if (enemy.hp <= 0) {
          game.enemies.splice(index, 1);
          game.kills += 1;
          state.score += 80 + enemy.kind * 45;
          state.events.push({ type: "target", kind: enemy.kind });
        }
        break;
      }
      if (!hit && shot.y > 8 * FP) liveShots.push(shot);
    }
    game.shots = liveShots;
    const playerY = gridPlayerY(game);
    const liveEnemyShots = [];
    for (const shot of game.enemyShots) {
      if (game.invulnerable <= 0 && shot.lane === game.lane && Math.abs(shot.y - playerY) < 5 * FP) {
        loseLife(state, "GRID PULSE");
        game.invulnerable = 90;
        state.events.push({ type: "hit", owner: "player" });
      } else if (shot.y < HEIGHT * FP) liveEnemyShots.push(shot);
    }
    game.enemyShots = liveEnemyShots;
    const survivors = [];
    for (const enemy of game.enemies) {
      if (game.invulnerable <= 0 && enemy.lane === game.lane && Math.abs(enemy.y - playerY) < 7 * FP) {
        loseLife(state, "LANE COLLISION");
        game.invulnerable = 90;
      } else if (enemy.y > 188 * FP) {
        if (game.invulnerable <= 0) {
          loseLife(state, "GRID BREACH");
          game.invulnerable = 90;
        }
      } else survivors.push(enemy);
    }
    game.enemies = survivors;
    const expectedLevel = 1 + Math.floor(game.kills / 18);
    if (expectedLevel > state.level) { state.level = expectedLevel; state.events.push({ type: "level", level: state.level }); }
  }

  function makeOrbitalWave(state) {
    const enemies = [];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        if (state.level > 1 && mix32(state.seed ^ row * 31 ^ column * 131 ^ state.level) % 19 === 0) continue;
        enemies.push({ id: row * 8 + column + 1, x: (25 + column * 16) * FP, y: (29 + row * 12) * FP, row, column, hp: row === 0 && state.level > 2 ? 2 : 1 });
      }
    }
    state.game.enemies = enemies;
    state.game.direction = 1;
    state.game.marchTimer = 0;
    state.game.enemyShots = [];
    state.game.playerShots = [];
  }

  function initOrbital(state) {
    state.game = { playerX: 80 * FP, playerShots: [], enemyShots: [], enemies: [], direction: 1, marchTimer: 0, fireCooldown: 0, invulnerable: 0 };
    makeOrbitalWave(state);
  }

  function resetOrbitalPlayer(state) {
    state.game.playerX = 80 * FP;
    state.game.playerShots = [];
    state.game.enemyShots = [];
    state.game.invulnerable = 90;
  }

  function stepOrbital(state, actions) {
    const game = state.game;
    if (game.fireCooldown > 0) game.fireCooldown -= 1;
    if (game.invulnerable > 0) game.invulnerable -= 1;
    const speed = 28 + state.difficulty * 4;
    if ((actions & INPUT.LEFT) && !(actions & INPUT.RIGHT)) game.playerX -= speed;
    if ((actions & INPUT.RIGHT) && !(actions & INPUT.LEFT)) game.playerX += speed;
    game.playerX = clamp(game.playerX, 7 * FP, 153 * FP);
    if ((actions & INPUT.FIRE) && game.fireCooldown <= 0) {
      game.playerShots.push({ x: game.playerX, y: 171 * FP });
      game.fireCooldown = 12;
      state.events.push({ type: "shot", owner: "player" });
    }
    game.marchTimer += 1;
    const marchEvery = Math.max(5, 18 - state.level - state.difficulty * 2);
    if (game.marchTimer >= marchEvery) {
      game.marchTimer = 0;
      const edge = game.enemies.some((enemy) => enemy.x + game.direction * 3 * FP < 8 * FP || enemy.x + game.direction * 3 * FP > 152 * FP);
      if (edge) {
        game.direction = -game.direction;
        for (const enemy of game.enemies) enemy.y += 5 * FP;
        state.events.push({ type: "march" });
      } else {
        for (const enemy of game.enemies) enemy.x += game.direction * 3 * FP;
      }
    }
    for (const shot of game.playerShots) shot.y -= 48;
    for (const shot of game.enemyShots) shot.y += 29 + state.difficulty * 4;
    const fireInterval = Math.max(24, 72 - state.level * 2 - state.difficulty * 10);
    if (game.enemies.length && state.tick % fireInterval === 0) {
      const enemy = game.enemies[randomInt(state, game.enemies.length)];
      game.enemyShots.push({ x: enemy.x, y: enemy.y + 5 * FP });
      state.events.push({ type: "shot", owner: "enemy" });
    }
    const playerShots = [];
    for (const shot of game.playerShots) {
      let hit = false;
      for (let index = 0; index < game.enemies.length; index += 1) {
        const enemy = game.enemies[index];
        if (Math.abs(shot.x - enemy.x) >= 6 * FP || Math.abs(shot.y - enemy.y) >= 5 * FP) continue;
        enemy.hp -= 1;
        hit = true;
        if (enemy.hp <= 0) {
          game.enemies.splice(index, 1);
          state.score += 40 + (4 - enemy.row) * 20;
          state.events.push({ type: "target", row: enemy.row });
        }
        break;
      }
      if (!hit && shot.y > 5 * FP) playerShots.push(shot);
    }
    game.playerShots = playerShots;
    const enemyShots = [];
    for (const shot of game.enemyShots) {
      if (game.invulnerable <= 0 && Math.abs(shot.x - game.playerX) < 6 * FP && Math.abs(shot.y - 177 * FP) < 5 * FP) {
        loseLife(state, "ORBITAL FIRE");
        if (!state.gameOver) resetOrbitalPlayer(state);
      } else if (shot.y < HEIGHT * FP) enemyShots.push(shot);
    }
    game.enemyShots = enemyShots;
    if (game.enemies.some((enemy) => enemy.y >= 165 * FP)) {
      if (game.invulnerable <= 0) loseLife(state, "MOONLINE OVERRUN");
      if (!state.gameOver) { state.level = Math.max(1, state.level - 1); makeOrbitalWave(state); resetOrbitalPlayer(state); }
    } else if (game.enemies.length === 0) {
      state.level += 1;
      state.score += 750;
      makeOrbitalWave(state);
      state.events.push({ type: "level", level: state.level });
    }
  }

  function triangleWave(tick, period, amplitude) {
    const half = Math.floor(period / 2);
    const phase = ((tick % period) + period) % period;
    return phase < half ? -amplitude + Math.trunc(phase * amplitude * 2 / half) : amplitude - Math.trunc((phase - half) * amplitude * 2 / half);
  }

  function makeTalonWave(state) {
    const enemies = [];
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        enemies.push({ id: row * 7 + column + 1, homeX: (32 + column * 16) * FP, homeY: (31 + row * 13) * FP, x: 0, y: 0, row, state: "formation", vx: 0, vy: 0, phase: mix32(state.seed ^ row * 17 ^ column * 97 ^ state.level) % 180 });
      }
    }
    state.game.enemies = enemies;
    state.game.playerShots = [];
    state.game.enemyShots = [];
  }

  function initTalon(state) {
    state.game = { playerX: 80 * FP, enemies: [], playerShots: [], enemyShots: [], fireCooldown: 0, diveTimer: 70, invulnerable: 0 };
    makeTalonWave(state);
  }

  function stepTalon(state, actions) {
    const game = state.game;
    if (game.fireCooldown > 0) game.fireCooldown -= 1;
    if (game.invulnerable > 0) game.invulnerable -= 1;
    const speed = 30 + state.difficulty * 4;
    if ((actions & INPUT.LEFT) && !(actions & INPUT.RIGHT)) game.playerX -= speed;
    if ((actions & INPUT.RIGHT) && !(actions & INPUT.LEFT)) game.playerX += speed;
    game.playerX = clamp(game.playerX, 7 * FP, 153 * FP);
    if ((actions & INPUT.FIRE) && game.fireCooldown <= 0) {
      game.playerShots.push({ x: game.playerX, y: 171 * FP });
      game.fireCooldown = 10;
      state.events.push({ type: "shot", owner: "player" });
    }
    const offset = triangleWave(state.tick, 220, 15 * FP);
    for (const enemy of game.enemies) {
      if (enemy.state === "formation") {
        enemy.x = enemy.homeX + offset;
        enemy.y = enemy.homeY + triangleWave(state.tick + enemy.phase, 90, 2 * FP);
      } else {
        enemy.x += enemy.vx;
        enemy.y += enemy.vy;
        enemy.vx += enemy.x < game.playerX ? 1 : -1;
        enemy.vx = clamp(enemy.vx, -30, 30);
        if (enemy.y > 198 * FP) enemy.state = "formation";
      }
    }
    game.diveTimer -= 1;
    if (game.diveTimer <= 0) {
      const candidates = game.enemies.filter((enemy) => enemy.state === "formation");
      if (candidates.length) {
        const diver = candidates[randomInt(state, candidates.length)];
        diver.state = "diving";
        diver.vx = clamp(Math.trunc((game.playerX - diver.x) / 70), -24, 24);
        diver.vy = 18 + state.level * 2 + state.difficulty * 3;
        state.events.push({ type: "dive", id: diver.id });
      }
      game.diveTimer = Math.max(28, 82 - state.level * 3 - state.difficulty * 10);
    }
    const shootingDivers = game.enemies.filter((enemy) => enemy.state === "diving" && enemy.y > 60 * FP && enemy.y < 145 * FP);
    if (shootingDivers.length && state.tick % Math.max(30, 74 - state.difficulty * 14) === 0) {
      const shooter = shootingDivers[randomInt(state, shootingDivers.length)];
      game.enemyShots.push({ x: shooter.x, y: shooter.y, vx: clamp(Math.trunc((game.playerX - shooter.x) / 50), -18, 18), vy: 31 });
      state.events.push({ type: "shot", owner: "enemy" });
    }
    for (const shot of game.playerShots) shot.y -= 55;
    for (const shot of game.enemyShots) { shot.x += shot.vx; shot.y += shot.vy; }
    const playerShots = [];
    for (const shot of game.playerShots) {
      let hit = false;
      for (let index = 0; index < game.enemies.length; index += 1) {
        const enemy = game.enemies[index];
        if (Math.abs(shot.x - enemy.x) >= 6 * FP || Math.abs(shot.y - enemy.y) >= 5 * FP) continue;
        game.enemies.splice(index, 1);
        state.score += enemy.state === "diving" ? 180 : 90 + (3 - enemy.row) * 20;
        state.events.push({ type: "target", mode: enemy.state });
        hit = true;
        break;
      }
      if (!hit && shot.y > 4 * FP) playerShots.push(shot);
    }
    game.playerShots = playerShots;
    const playerBox = { x: game.playerX, y: 177 * FP, w: 11 * FP, h: 7 * FP };
    const enemyShots = [];
    for (const shot of game.enemyShots) {
      if (game.invulnerable <= 0 && pointInBox(shot.x, shot.y, playerBox, 1 * FP)) {
        loseLife(state, "TALON FIRE");
        game.invulnerable = 90;
      } else if (shot.y < HEIGHT * FP && shot.x > 0 && shot.x < WIDTH * FP) enemyShots.push(shot);
    }
    game.enemyShots = enemyShots;
    for (const enemy of game.enemies) {
      if (game.invulnerable <= 0 && enemy.state === "diving" && pointInBox(enemy.x, enemy.y, playerBox, 3 * FP)) {
        loseLife(state, "TALON STRIKE");
        game.invulnerable = 90;
        enemy.state = "formation";
        break;
      }
    }
    if (game.enemies.length === 0) {
      state.level += 1;
      state.score += 900;
      makeTalonWave(state);
      state.events.push({ type: "level", level: state.level });
    }
  }

  function nextRiverRow(state, reference) {
    const drift = randomInt(state, 9) - 4;
    const widthDrift = randomInt(state, 7) - 3;
    const width = clamp(reference.width + widthDrift, 52, 94);
    const center = clamp(reference.center + drift, Math.ceil(width / 2) + 5, WIDTH - Math.ceil(width / 2) - 5);
    return { center, width };
  }

  function initRiver(state) {
    const rows = [];
    let row = { center: 80, width: 78 };
    for (let index = 0; index < 27; index += 1) {
      row = nextRiverRow(state, row);
      rows.push(row);
    }
    state.game = { playerX: rows[22].center * FP, playerY: 166 * FP, rows, offset: 0, speed: 13, fuel: 1000, entities: [], shots: [], enemyShots: [], spawnTimer: 24, distance: 0, nextId: 1, invulnerable: 0 };
  }

  function riverBoundsAt(game, yPixels) {
    const rowIndex = clamp(Math.floor((yPixels - game.offset / FP + 8) / 8), 0, game.rows.length - 1);
    const row = game.rows[rowIndex];
    return { left: row.center - row.width / 2, right: row.center + row.width / 2, center: row.center, width: row.width };
  }

  function resetRiverPlayer(state, reason) {
    loseLife(state, reason);
    if (state.gameOver) return;
    const bounds = riverBoundsAt(state.game, state.game.playerY / FP);
    state.game.playerX = Math.trunc(bounds.center * FP);
    state.game.fuel = Math.max(state.game.fuel, 360);
    state.game.invulnerable = 100;
  }

  function stepRiver(state, actions) {
    const game = state.game;
    if (game.invulnerable > 0) game.invulnerable -= 1;
    const horizontal = 27 + state.difficulty * 3;
    if ((actions & INPUT.LEFT) && !(actions & INPUT.RIGHT)) game.playerX -= horizontal;
    if ((actions & INPUT.RIGHT) && !(actions & INPUT.LEFT)) game.playerX += horizontal;
    if ((actions & INPUT.UP) && !(actions & INPUT.DOWN)) game.speed = Math.min(22, game.speed + 1);
    else if ((actions & INPUT.DOWN) && !(actions & INPUT.UP)) game.speed = Math.max(8, game.speed - 1);
    else game.speed += game.speed < 13 ? 1 : game.speed > 13 ? -1 : 0;
    if (edgePressed(state, actions, INPUT.FIRE) || ((actions & INPUT.FIRE) && state.tick % 9 === 0)) {
      game.shots.push({ x: game.playerX, y: game.playerY - 7 * FP });
      state.events.push({ type: "shot", owner: "player" });
    }
    const scroll = Math.floor(game.speed * DIFFICULTIES[state.difficulty].speed / 100);
    game.offset += scroll;
    game.distance += scroll;
    if (game.distance % (20 * FP) < scroll) state.score += 5;
    while (game.offset >= 8 * FP) {
      game.offset -= 8 * FP;
      game.rows.pop();
      game.rows.unshift(nextRiverRow(state, game.rows[0]));
    }
    game.spawnTimer -= 1;
    if (game.spawnTimer <= 0) {
      const top = game.rows[1];
      const roll = randomInt(state, 10);
      const kind = roll < 5 ? "skiff" : roll < 8 ? "tower" : "fuel";
      game.entities.push({ id: game.nextId++, kind, x: (Math.trunc(top.center - top.width / 3) + randomInt(state, Math.max(1, Math.trunc(top.width * 2 / 3)))) * FP, y: 8 * FP, hp: kind === "tower" ? 2 : 1, phase: randomInt(state, 180) });
      game.spawnTimer = Math.max(28, 62 - state.level * 2 - state.difficulty * 5);
    }
    for (const entity of game.entities) {
      entity.y += scroll;
      entity.phase += 1;
      if (entity.kind === "skiff") entity.x += entity.phase % 80 < 40 ? 3 : -3;
      if (entity.kind !== "fuel" && entity.phase % Math.max(95, 165 - state.difficulty * 25) === 0 && entity.y < game.playerY) {
        game.enemyShots.push({ x: entity.x, y: entity.y + 4 * FP, vx: clamp(Math.trunc((game.playerX - entity.x) / 80), -12, 12) });
        state.events.push({ type: "shot", owner: "enemy" });
      }
    }
    for (const shot of game.shots) shot.y -= 52;
    for (const shot of game.enemyShots) { shot.x += shot.vx; shot.y += 35; }
    const shots = [];
    for (const shot of game.shots) {
      let hit = false;
      for (let index = 0; index < game.entities.length; index += 1) {
        const entity = game.entities[index];
        if (entity.kind === "fuel" || Math.abs(shot.x - entity.x) > 6 * FP || Math.abs(shot.y - entity.y) > 6 * FP) continue;
        entity.hp -= 1;
        hit = true;
        if (entity.hp <= 0) {
          game.entities.splice(index, 1);
          state.score += entity.kind === "tower" ? 180 : 100;
          state.events.push({ type: "target", kind: entity.kind });
        }
        break;
      }
      if (!hit && shot.y > 0) shots.push(shot);
    }
    game.shots = shots;
    const playerBox = { x: game.playerX, y: game.playerY, w: 10 * FP, h: 9 * FP };
    const entities = [];
    for (const entity of game.entities) {
      if (entity.kind === "fuel" && pointInBox(entity.x, entity.y, playerBox, 4 * FP)) {
        game.fuel = Math.min(1000, game.fuel + 420);
        state.score += 75;
        state.events.push({ type: "fuel" });
      } else if (entity.kind !== "fuel" && game.invulnerable <= 0 && pointInBox(entity.x, entity.y, playerBox, 3 * FP)) {
        resetRiverPlayer(state, "RIVER COLLISION");
      } else if (entity.y < (HEIGHT + 10) * FP) entities.push(entity);
    }
    game.entities = entities;
    const enemyShots = [];
    for (const shot of game.enemyShots) {
      if (game.invulnerable <= 0 && pointInBox(shot.x, shot.y, playerBox, FP)) resetRiverPlayer(state, "RIVER FIRE");
      else if (shot.y < HEIGHT * FP) enemyShots.push(shot);
    }
    game.enemyShots = enemyShots;
    const bounds = riverBoundsAt(game, game.playerY / FP);
    if (game.invulnerable <= 0 && (game.playerX / FP < bounds.left + 4 || game.playerX / FP > bounds.right - 4)) resetRiverPlayer(state, "BANK IMPACT");
    if (state.tick % 8 === 0) {
      game.fuel -= 1 + state.difficulty;
      if (game.fuel <= 0) { game.fuel = 0; resetRiverPlayer(state, "FUEL EMPTY"); }
    }
    const expectedLevel = 1 + Math.floor(game.distance / (1500 * FP));
    if (expectedLevel > state.level) { state.level = expectedLevel; state.events.push({ type: "level", level: state.level }); }
  }

  function makeCircuitWalls(seed, level) {
    const shift = (mix32(seed ^ level) % 9) - 4;
    return [
      { x: (80 + shift) * FP, y: 64 * FP, w: 42 * FP, h: 7 * FP },
      { x: (49 - shift) * FP, y: 119 * FP, w: 7 * FP, h: 48 * FP },
      { x: (116 + shift) * FP, y: 126 * FP, w: 7 * FP, h: 42 * FP },
      { x: 81 * FP, y: 157 * FP, w: 34 * FP, h: 6 * FP },
    ];
  }

  function circuitCanOccupy(game, x, y) {
    if (x < 8 * FP || x > 152 * FP || y < 12 * FP || y > 181 * FP) return false;
    const tank = { x, y, w: 9 * FP, h: 9 * FP };
    return !game.walls.some((wall) => boxesOverlap(tank, wall));
  }

  function resetCircuitRound(state) {
    const game = state.game;
    game.player.x = 25 * FP;
    game.player.y = 164 * FP;
    game.player.angle = 12;
    game.player.invulnerable = 75;
    game.bots = [];
    const botCount = Math.min(4, 1 + state.level);
    for (let index = 0; index < botCount; index += 1) {
      game.bots.push({ id: index + 1, x: (135 - index * 18) * FP, y: (28 + index * 24) * FP, angle: 4 + (index % 3), cooldown: 45 + index * 12, turnTimer: 0, blocked: 0 });
    }
    game.shells = [];
  }

  function initCircuit(state) {
    state.game = { walls: makeCircuitWalls(state.seed, state.level), player: { x: 0, y: 0, angle: 12, cooldown: 0, rotateCooldown: 0, invulnerable: 0 }, bots: [], shells: [], nextShellId: 1, aiShots: 0 };
    resetCircuitRound(state);
  }

  function turnToward(current, desired) {
    const clockwise = (desired - current + 16) % 16;
    if (clockwise === 0) return current;
    return (current + (clockwise <= 8 ? 1 : 15)) % 16;
  }

  function nearestDirection(dx, dy) {
    let best = 0;
    let bestDot = -Infinity;
    for (let index = 0; index < DIR16.length; index += 1) {
      const dot = dx * DIR16[index].x + dy * DIR16[index].y;
      if (dot > bestDot) { bestDot = dot; best = index; }
    }
    return best;
  }

  function segmentIntersectsBox(x0, y0, x1, y1, box) {
    const left = box.x - Math.trunc(box.w / 2);
    const right = box.x + Math.trunc(box.w / 2);
    const top = box.y - Math.trunc(box.h / 2);
    const bottom = box.y + Math.trunc(box.h / 2);
    if (Math.max(x0, x1) < left || Math.min(x0, x1) > right || Math.max(y0, y1) < top || Math.min(y0, y1) > bottom) return false;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const cross = (x, y) => dx * (y - y0) - dy * (x - x0);
    const corners = [cross(left, top), cross(right, top), cross(right, bottom), cross(left, bottom)];
    return !corners.every((value) => value > 0) && !corners.every((value) => value < 0);
  }

  function circuitLineClear(game, x0, y0, x1, y1) {
    return !game.walls.some((wall) => segmentIntersectsBox(x0, y0, x1, y1, wall));
  }

  function spawnCircuitShell(state, owner, tank) {
    const direction = DIR16[tank.angle];
    state.game.shells.push({ id: state.game.nextShellId++, owner, x: tank.x + Math.trunc(direction.x * 7 * FP / 1024), y: tank.y + Math.trunc(direction.y * 7 * FP / 1024), vx: Math.trunc(direction.x * 48 / 1024), vy: Math.trunc(direction.y * 48 / 1024), age: 0 });
    state.events.push({ type: "shot", owner });
  }

  function moveCircuitTank(game, tank, amount) {
    const direction = DIR16[tank.angle];
    const x = tank.x + Math.trunc(direction.x * amount / 1024);
    const y = tank.y + Math.trunc(direction.y * amount / 1024);
    if (circuitCanOccupy(game, x, y)) { tank.x = x; tank.y = y; return true; }
    return false;
  }

  function stepCircuit(state, actions) {
    const game = state.game;
    const player = game.player;
    if (player.cooldown > 0) player.cooldown -= 1;
    if (player.rotateCooldown > 0) player.rotateCooldown -= 1;
    if (player.invulnerable > 0) player.invulnerable -= 1;
    if (player.rotateCooldown <= 0) {
      if ((actions & INPUT.LEFT) && !(actions & INPUT.RIGHT)) { player.angle = (player.angle + 15) % 16; player.rotateCooldown = 3; }
      else if ((actions & INPUT.RIGHT) && !(actions & INPUT.LEFT)) { player.angle = (player.angle + 1) % 16; player.rotateCooldown = 3; }
    }
    if ((actions & INPUT.UP) && !(actions & INPUT.DOWN)) moveCircuitTank(game, player, 22);
    if ((actions & INPUT.DOWN) && !(actions & INPUT.UP)) moveCircuitTank(game, player, -15);
    if ((actions & INPUT.FIRE) && player.cooldown <= 0) { spawnCircuitShell(state, "player", player); player.cooldown = 30; }
    for (const bot of game.bots) {
      if (bot.cooldown > 0) bot.cooldown -= 1;
      if (bot.turnTimer > 0) bot.turnTimer -= 1;
      const dx = player.x - bot.x;
      const dy = player.y - bot.y;
      const desired = nearestDirection(dx, dy);
      if (bot.turnTimer <= 0) { bot.angle = turnToward(bot.angle, desired); bot.turnTimer = Math.max(2, 5 - state.difficulty); }
      const moved = moveCircuitTank(game, bot, 11 + state.difficulty * 2 + Math.min(5, state.level));
      bot.blocked = moved ? 0 : bot.blocked + 1;
      if (!moved && bot.blocked > 2) { bot.angle = (bot.angle + (randomInt(state, 2) ? 3 : 13)) % 16; bot.blocked = 0; }
      const alignment = Math.min((desired - bot.angle + 16) % 16, (bot.angle - desired + 16) % 16);
      if (bot.cooldown <= 0 && alignment <= 1 && circuitLineClear(game, bot.x, bot.y, player.x, player.y)) {
        spawnCircuitShell(state, `bot-${bot.id}`, bot);
        game.aiShots += 1;
        bot.cooldown = Math.max(28, 68 - state.difficulty * 12 - state.level * 3);
      }
    }
    const shells = [];
    for (const shell of game.shells) {
      shell.x += shell.vx;
      shell.y += shell.vy;
      shell.age += 1;
      const shellBox = { x: shell.x, y: shell.y, w: 2 * FP, h: 2 * FP };
      if (shell.x < 3 * FP || shell.x > 157 * FP || shell.y < 5 * FP || shell.y > 188 * FP || game.walls.some((wall) => boxesOverlap(shellBox, wall))) {
        state.events.push({ type: "impact" });
        continue;
      }
      if (shell.owner !== "player" && player.invulnerable <= 0 && shell.age > 3 && pointInBox(shell.x, shell.y, { x: player.x, y: player.y, w: 9 * FP, h: 9 * FP }, FP)) {
        loseLife(state, "AI ARMOUR HIT");
        if (!state.gameOver) resetCircuitRound(state);
        continue;
      }
      let hitBot = false;
      if (shell.owner === "player") {
        for (let index = 0; index < game.bots.length; index += 1) {
          const bot = game.bots[index];
          if (shell.age <= 3 || !pointInBox(shell.x, shell.y, { x: bot.x, y: bot.y, w: 9 * FP, h: 9 * FP }, FP)) continue;
          game.bots.splice(index, 1);
          state.score += 500;
          state.events.push({ type: "target", kind: "tank" });
          hitBot = true;
          break;
        }
      }
      if (!hitBot && shell.age < 150) shells.push(shell);
    }
    game.shells = shells;
    if (!state.gameOver && game.bots.length === 0) {
      state.level += 1;
      state.score += 1000;
      game.walls = makeCircuitWalls(state.seed, state.level);
      resetCircuitRound(state);
      state.events.push({ type: "level", level: state.level });
    }
  }

  function initSkywater(state) {
    state.game = { playerAim: 12, aiAim: 12, playerCooldown: 0, aiCooldown: 45, targets: [], shells: [], spawnTimer: 12, timeLeft: 75 * TICK_RATE, aiScore: 0, playerShots: 0, aiShots: 0, nextId: 1 };
  }

  function spawnSkyTarget(state) {
    const game = state.game;
    const roll = randomInt(state, 10);
    const kind = roll < 4 ? "glider" : roll < 7 ? "rotor" : roll < 9 ? "skimmer" : "sub";
    const fromLeft = Boolean(randomInt(state, 2));
    const spec = kind === "glider" ? { y: 42, speed: 16, points: 90, hp: 1 } :
      kind === "rotor" ? { y: 78, speed: 11, points: 130, hp: 2 } :
      kind === "skimmer" ? { y: 145, speed: 9, points: 170, hp: 2 } : { y: 171, speed: 7, points: 240, hp: 3 };
    game.targets.push({ id: game.nextId++, kind, x: (fromLeft ? -10 : 170) * FP, y: (spec.y + randomInt(state, 13) - 6) * FP, vx: (fromLeft ? spec.speed : -spec.speed) * DIFFICULTIES[state.difficulty].speed / 100 | 0, hp: spec.hp, points: spec.points, phase: randomInt(state, 200) });
  }

  function skyAimToward(sourceX, sourceY, targetX, targetY) {
    const desired = nearestDirection(targetX - sourceX, targetY - sourceY);
    return clamp(desired, 9, 15);
  }

  function spawnSkyShell(state, owner, aim) {
    const direction = DIR16[aim];
    const sourceX = owner === "player" ? 24 * FP : 136 * FP;
    const sourceY = 180 * FP;
    state.game.shells.push({ owner, x: sourceX, y: sourceY, vx: Math.trunc(direction.x * 58 / 1024), vy: Math.trunc(direction.y * 58 / 1024), age: 0 });
    if (owner === "player") state.game.playerShots += 1;
    else state.game.aiShots += 1;
    state.events.push({ type: "shot", owner });
  }

  function stepSkywater(state, actions) {
    const game = state.game;
    if (game.playerCooldown > 0) game.playerCooldown -= 1;
    if (game.aiCooldown > 0) game.aiCooldown -= 1;
    if ((actions & INPUT.LEFT) && !(actions & INPUT.RIGHT) && state.tick % 3 === 0) game.playerAim = Math.max(9, game.playerAim - 1);
    if ((actions & INPUT.RIGHT) && !(actions & INPUT.LEFT) && state.tick % 3 === 0) game.playerAim = Math.min(15, game.playerAim + 1);
    if ((actions & INPUT.FIRE) && game.playerCooldown <= 0) { spawnSkyShell(state, "player", game.playerAim); game.playerCooldown = 18; }
    game.spawnTimer -= 1;
    if (game.spawnTimer <= 0) {
      spawnSkyTarget(state);
      game.spawnTimer = Math.max(28, 66 - state.level * 2 - state.difficulty * 6);
    }
    for (const target of game.targets) {
      target.x += target.vx;
      target.phase += 1;
      if (target.kind === "rotor") target.y += target.phase % 80 < 40 ? 2 : -2;
    }
    if (game.targets.length) {
      let target = game.targets[0];
      let best = Math.abs(target.x - 136 * FP) + Math.abs(target.y - 180 * FP);
      for (const candidate of game.targets) {
        const distance = Math.abs(candidate.x - 136 * FP) + Math.abs(candidate.y - 180 * FP);
        if (distance < best) { target = candidate; best = distance; }
      }
      const desired = skyAimToward(136 * FP, 180 * FP, target.x, target.y);
      if (state.tick % Math.max(2, 5 - state.difficulty) === 0) game.aiAim = turnToward(game.aiAim, desired);
      if (game.aiCooldown <= 0 && Math.abs(game.aiAim - desired) <= 1) {
        spawnSkyShell(state, "ai", game.aiAim);
        game.aiCooldown = Math.max(18, 44 - state.difficulty * 7);
      }
    }
    for (const shell of game.shells) {
      shell.x += shell.vx;
      shell.y += shell.vy;
      shell.age += 1;
    }
    const shells = [];
    for (const shell of game.shells) {
      let hit = false;
      for (let index = 0; index < game.targets.length; index += 1) {
        const target = game.targets[index];
        const targetBox = { x: target.x, y: target.y, w: (target.kind === "skimmer" || target.kind === "sub" ? 15 : 11) * FP, h: 7 * FP };
        if (!pointInBox(shell.x, shell.y, targetBox, FP)) continue;
        target.hp -= 1;
        hit = true;
        if (target.hp <= 0) {
          game.targets.splice(index, 1);
          const points = target.points + state.level * 10;
          if (shell.owner === "player") state.score += points;
          else game.aiScore += points;
          state.events.push({ type: "target", owner: shell.owner, kind: target.kind, points });
        }
        break;
      }
      if (!hit && shell.age < 100 && shell.x > -5 * FP && shell.x < 165 * FP && shell.y > 0) shells.push(shell);
    }
    game.shells = shells;
    game.targets = game.targets.filter((target) => target.x > -20 * FP && target.x < 180 * FP);
    game.timeLeft -= 1;
    const expectedLevel = 1 + Math.floor((75 * TICK_RATE - game.timeLeft) / (20 * TICK_RATE));
    if (expectedLevel > state.level) { state.level = expectedLevel; state.events.push({ type: "level", level: state.level }); }
    if (game.timeLeft <= 0) {
      game.timeLeft = 0;
      state.gameOver = true;
      state.victory = state.score > game.aiScore;
      state.events.push({ type: "round-end", score: state.score, aiScore: game.aiScore, victory: state.victory });
    }
  }

  const INITIALIZERS = Object.freeze({
    "prism-break": initPrism,
    gridburn: initGridburn,
    "orbital-siege": initOrbital,
    "star-talon": initTalon,
    "rift-runner": initRiver,
    "iron-circuit": initCircuit,
    "skywater-command": initSkywater,
  });

  const STEPPERS = Object.freeze({
    "prism-break": stepPrism,
    gridburn: stepGridburn,
    "orbital-siege": stepOrbital,
    "star-talon": stepTalon,
    "rift-runner": stepRiver,
    "iron-circuit": stepCircuit,
    "skywater-command": stepSkywater,
  });

  function createRun(gameInput, seedInput, difficultyInput) {
    const gameId = normalizeGame(gameInput);
    const seed = normalizeSeed(seedInput);
    const difficulty = normalizeDifficulty(difficultyInput);
    const state = {
      engineVersion: ENGINE_VERSION,
      gameId,
      seed,
      difficulty,
      tick: 0,
      rng: mix32(seed ^ fnv1a(gameId)),
      level: 1,
      score: 0,
      lives: DIFFICULTIES[difficulty].lives,
      previousActions: 0,
      gameOver: false,
      victory: false,
      events: [],
      game: null,
    };
    INITIALIZERS[gameId](state);
    state.events = [{ type: "boot", gameId, seed, difficulty }];
    return state;
  }

  function step(state, inputWordInput) {
    const actions = Number(inputWordInput) & ACTION_MASK;
    state.events = [];
    if (state.gameOver || state.victory) {
      state.previousActions = actions;
      return state;
    }
    state.tick += 1;
    STEPPERS[state.gameId](state, actions);
    state.previousActions = actions;
    return state;
  }

  function createRecorder(gameInput, seedInput, difficultyInput) {
    return { version: ENGINE_VERSION, gameId: normalizeGame(gameInput), seed: normalizeSeed(seedInput), difficulty: normalizeDifficulty(difficultyInput), ticks: 0, runs: [] };
  }

  function recordInput(recorder, inputWordInput) {
    if (!recorder || recorder.version !== ENGINE_VERSION || !Array.isArray(recorder.runs)) throw new Error("Invalid replay recorder");
    if (recorder.ticks >= MAX_REPLAY_TICKS) throw new Error("Replay exceeds the two-hour limit");
    const inputWord = Number(inputWordInput) & ACTION_MASK;
    const last = recorder.runs[recorder.runs.length - 1];
    if (last && last[0] === inputWord && last[1] < 65535) last[1] += 1;
    else recorder.runs.push([inputWord, 1]);
    recorder.ticks += 1;
    return recorder;
  }

  function tryRecordInput(recorder, inputWordInput) {
    if (!recorder || recorder.version !== ENGINE_VERSION || !Array.isArray(recorder.runs)) throw new Error("Invalid replay recorder");
    if (recorder.ticks >= MAX_REPLAY_TICKS) return false;
    recordInput(recorder, inputWordInput);
    return true;
  }

  function encodeBase64Ascii(text) {
    if (typeof btoa !== "function") throw new Error("ASCII base64 encoding is unavailable");
    return btoa(text);
  }

  function decodeBase64Ascii(encoded) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error("Replay payload is not valid base64");
    if (typeof atob !== "function") throw new Error("ASCII base64 decoding is unavailable");
    try { return atob(encoded); } catch (_error) { throw new Error("Replay payload is not valid base64"); }
  }

  function encodeReplay(recorder) {
    if (!recorder || recorder.version !== ENGINE_VERSION || !Array.isArray(recorder.runs)) throw new Error("Invalid replay recorder");
    const payload = JSON.stringify([ENGINE_VERSION, recorder.gameId, recorder.seed >>> 0, recorder.difficulty, recorder.ticks, recorder.runs]);
    const checksum = seedHex(fnv1a(payload));
    const encoded = encodeBase64Ascii(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const code = `${REPLAY_PREFIX}.${checksum}.${encoded}`;
    if (code.length > MAX_REPLAY_CODE_LENGTH) throw new Error("Replay code is too large");
    return code;
  }

  function decodeReplay(codeInput) {
    const code = String(codeInput || "").trim();
    if (code.length > MAX_REPLAY_CODE_LENGTH) throw new Error("Replay code is too large");
    const parts = code.split(".");
    if (parts.length !== 3 || parts[0] !== REPLAY_PREFIX || !/^[0-9A-F]{8}$/.test(parts[1])) throw new Error("Replay code header is invalid");
    let encoded = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    while (encoded.length % 4) encoded += "=";
    const payload = decodeBase64Ascii(encoded);
    if (seedHex(fnv1a(payload)) !== parts[1]) throw new Error("Replay checksum mismatch");
    let parsed;
    try { parsed = JSON.parse(payload); } catch (_error) { throw new Error("Replay payload is not valid JSON"); }
    if (!Array.isArray(parsed) || parsed.length !== 6 || parsed[0] !== ENGINE_VERSION) throw new Error("Replay engine version is unsupported");
    const gameId = parsed[1];
    const seed = parsed[2];
    const difficulty = parsed[3];
    const ticks = parsed[4];
    const runs = parsed[5];
    if (normalizeGame(gameId) !== gameId || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff ||
        !Number.isInteger(difficulty) || difficulty < 0 || difficulty >= DIFFICULTIES.length ||
        !Number.isInteger(ticks) || ticks < 0 || ticks > MAX_REPLAY_TICKS ||
        !Array.isArray(runs) || runs.length > ticks + 1) throw new Error("Replay metadata is invalid");
    let total = 0;
    const cleanRuns = [];
    for (const run of runs) {
      if (!Array.isArray(run) || run.length !== 2 || !Number.isInteger(run[0]) || run[0] < 0 || run[0] > ACTION_MASK ||
          !Number.isInteger(run[1]) || run[1] < 1 || run[1] > 65535) throw new Error("Replay input run is invalid");
      total += run[1];
      if (total > MAX_REPLAY_TICKS) throw new Error("Replay tick count is invalid");
      cleanRuns.push(Object.freeze([run[0], run[1]]));
    }
    if (total !== ticks) throw new Error("Replay tick count does not match its input stream");
    return Object.freeze({ version: ENGINE_VERSION, gameId, seed: seed >>> 0, difficulty, ticks, runs: Object.freeze(cleanRuns) });
  }

  function createReplayCursor(replay) {
    return { replay, runIndex: 0, runOffset: 0, tick: 0 };
  }

  function nextReplayInput(cursor) {
    if (!cursor || cursor.tick >= cursor.replay.ticks) return null;
    const run = cursor.replay.runs[cursor.runIndex];
    const input = run[0];
    cursor.runOffset += 1;
    cursor.tick += 1;
    if (cursor.runOffset >= run[1]) { cursor.runIndex += 1; cursor.runOffset = 0; }
    return input;
  }

  function stateDigest(state) {
    const compact = {
      version: state.engineVersion,
      gameId: state.gameId,
      seed: state.seed,
      difficulty: state.difficulty,
      tick: state.tick,
      rng: state.rng,
      level: state.level,
      score: state.score,
      lives: state.lives,
      previousActions: state.previousActions,
      gameOver: state.gameOver,
      victory: state.victory,
      game: state.game,
    };
    return seedHex(fnv1a(JSON.stringify(compact)));
  }

  return Object.freeze({
    ENGINE_VERSION,
    REPLAY_PREFIX,
    TICK_RATE,
    WIDTH,
    HEIGHT,
    FP,
    MAX_REPLAY_TICKS,
    MAX_REPLAY_CODE_LENGTH,
    INPUT,
    ACTION_MASK,
    GAMES,
    DIFFICULTIES,
    DIR16,
    clamp,
    normalizeSeed,
    normalizeDifficulty,
    normalizeGame,
    seedHex,
    mix32,
    createRun,
    step,
    createRecorder,
    recordInput,
    tryRecordInput,
    encodeReplay,
    decodeReplay,
    createReplayCursor,
    nextReplayInput,
    stateDigest,
    riverBoundsAt,
    circuitCanOccupy,
    circuitLineClear,
  });
});
