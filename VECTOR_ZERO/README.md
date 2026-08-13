# VECTOR ZERO

**No horizon. No safe axis. One reproducible flight path.**

VECTOR ZERO is an original deterministic six-degrees-of-freedom arcade space
shooter. Fly a compact recovery craft through three connected procedural mines,
collect each mine's vector cores, fight autonomous custodians, and reach the zero
gate. The game runs directly from local HTML, CSS, and JavaScript files.

## Play

Open [`index.html`](index.html) in a modern desktop browser. No installation,
server, account, network connection, external asset, or runtime dependency is
required.

1. Choose a campaign seed and flight contract.
2. Select **Engage Six-Axis Core**.
3. Click the flight view for pointer-lock mouse look, or use the arrow keys.

### Controls

| Input | Action |
|---|---|
| `W` / `S` | Forward / reverse thrust |
| `A` / `D` | Strafe left / right |
| `R` / `F` | Rise / fall |
| `Q` / `E` | Roll left / right |
| Mouse or arrows | Yaw and pitch |
| `Shift` | Vector boost |
| `Space` or mouse 1 | Pulse laser |
| `X` or mouse 2 | Vector missile |
| Hold `Tab` | Current mine-layer schematic |
| `P` | Pause |
| `Esc` | Release captured mouse |

## Campaign

Each seeded campaign contains three increasingly large mines. A mine is a
connected set of cubic chambers and tunnels spanning multiple vertical layers.
Every required core, hostile, supply cache, start point, and exit occupies a
reachable open chamber. The third mine contains the Zero Custodian.

The objective contract is explicit:

1. recover all three vector cores;
2. survive or evade the autonomous mine craft;
3. enter the zero gate; and
4. clear all three mines to achieve Vector Zero.

## Deterministic contract

The canonical simulation advances at exactly 60 fixed ticks per second. It uses:

- integer fixed-point 3D positions and velocity;
- integer angle units and deterministic trigonometric approximation;
- explicit packed six-axis input words;
- a seeded xorshift32 stream held inside canonical state;
- deterministic entity and collision order; and
- checksummed `VZ01` replay receipts.

A receipt contains the engine version, normalized seed, difficulty, exact tick
count, and run-length-encoded input ledger. Loading it creates a fresh campaign
and applies every input word, including ledger entries after a terminal event.
The interface displays a canonical state digest during live flight and replay.

Rendering, animation-frame timing, Canvas, CSS, pointer lock, audio, and browser
layout do not feed back into simulation state. See
[`docs/DETERMINISM.md`](docs/DETERMINISM.md).

## Runtime and visual architecture

- `core.js` — mine generation, fixed-point 6DOF flight, collision, combat,
  objectives, replay receipts, and state digests.
- `app.js` — fixed-step scheduler, polygon projection and near-plane clipping,
  vector enemies and pickups, cockpit HUD, input, telemetry, and synthesized audio.
- `style.css` — responsive recovered-flight-computer presentation.
- `index.html` — local-file-compatible application with a strict offline CSP.
- `tests/` — deterministic, offline-boundary, and Playwright browser tests.

All art is code-native vector geometry. All sound is opt-in and synthesized at
runtime. VECTOR ZERO contains no third-party game assets; see [`NOTICE.md`](NOTICE.md).

## Development checks

Node.js 22 or later is used only for development checks:

```sh
npm test
npm ci
npm run test:browser
```

Playwright is pinned for browser testing and is not a runtime dependency.

## Status

Playable three-mine mini-campaign. Version 1 receipts are versioned rather than
promised compatible with future simulation revisions.
