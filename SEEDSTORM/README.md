# SEEDSTORM: Deterministic Strike

**SEEDSTORM** is an original, offline, browser-based vertical-scrolling shooter. A
32-bit run seed generates every level, while a compact per-tick input log makes
the resulting flight exactly replayable from tick zero.

Open [`index.html`](index.html) directly in a modern desktop browser. No server,
installation, account, network connection, asset download, telemetry, or browser
storage is required.

## What the game does

- Generates an unbounded sequence of procedural sectors from one run seed.
- Raises the rank after every clear: denser waves, faster enemies and bullets,
  shorter firing intervals, tougher craft, larger formations, and richer boss
  patterns are introduced according to a deterministic difficulty schedule.
- Builds complete wave schedules, enemy paths, item drops, biome selection, and
  command-craft parameters from a level-specific derived seed.
- Simulates gameplay at a fixed 60 ticks per second using integer gameplay
  coordinates and a versioned deterministic core.
- Confirms every projectile collision with a hit flash and impact spark, reveals a
  compact health bar above damaged enemies, and renders larger procedural
  explosions when enemies and command craft are destroyed.
- Records only the seed and run-length-encoded input masks. Replays do not contain
  serialized world state, checkpoints, screenshots, or save-state snapshots.
- Synthesizes its sound effects and sparse score at runtime with the Web Audio API.
  All visual assets are drawn procedurally on the Canvas 2D surface.

## Controls

| Action | Keyboard | Touch / pointer |
|---|---|---|
| Move | Arrow keys or `WASD` | Drag over the play field |
| Fire | `Z` or `Space` | Hold a drag over the play field |
| Focus / slow movement | `Shift` | Hold **FOCUS** |
| Bomb | `X` or `B` | Tap **BOMB** |
| Pause | `P` or `Escape` | Use the **PAUSE** instrument |

## Seeds and replays

A seed regenerates the same procedural airspace. It cannot reproduce the player's
choices by itself. **Export Replay** adds the exact input mask applied at each
simulation tick, encoded as consecutive `(mask, count)` runs.

Replay codes use the form:

```text
SSR1.<8-hex checksum>.<base64url payload>
```

The payload contains `[engineVersion, seed, tickCount, inputRuns]`. The checksum
detects accidental damage or editing before simulation begins; it is not a
cryptographic signature. A replay is accepted only by its matching engine version
and is always simulated from a fresh initial state. Recording seals cleanly after
six hours while live play continues; the sealed code remains an exact replay of
those first six hours.

See [`docs/DETERMINISM.md`](docs/DETERMINISM.md) for the normative contract and
limitations.

## Architecture

| File | Responsibility |
|---|---|
| [`core.js`](core.js) | Pure deterministic level generation, fixed-tick simulation, replay codec, and state digest |
| [`app.js`](app.js) | Browser controls, Canvas 2D renderer, synthesized audio, replay UI, and frame scheduling |
| [`index.html`](index.html) | Offline application shell and accessibility structure |
| [`style.css`](style.css) | Responsive industrial arcade interface |
| [`tests/core.test.js`](tests/core.test.js) | Golden digest, determinism, collision events, progression, replay, and input regressions |
| [`tests/offline.test.js`](tests/offline.test.js) | Offline-boundary and application-shell checks |
| [`tests/browser-smoke.js`](tests/browser-smoke.js) | Real-browser launch, input, replay export, and replay playback smoke test |

The renderer and audio system consume the simulation state but are excluded from
the deterministic state digest. Frame rate changes therefore do not alter game
logic: the application catches up in fixed 60 Hz simulation steps.

## Tests

The deterministic and offline checks need only Node.js:

```sh
node tests/core.test.js
node tests/offline.test.js
```

For the optional real-browser smoke test:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

GitHub Actions runs both groups for changes under `SEEDSTORM/`.

## Independent implementation notice

SEEDSTORM is an original work in the established vertical-scrolling shooter
genre. It includes no code, artwork, audio, characters, story, names, logos,
level layouts, or data from Raiden or any other third-party game. Raiden is a
third-party trademark; this project is not affiliated with or endorsed by its
owners.

Code is licensed under the repository's [MIT License](../LICENSE).
