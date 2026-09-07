# CARTRIDGE ZERO: SEVEN SIGNALS

**One fictional cartridge. Seven original arcade signals. Every run receipts.**

CARTRIDGE ZERO is a self-contained deterministic browser anthology presented as
a recovered late-1970s multi-game home-console cartridge. It contains seven
distinct original games, a shared fixed-tick console core, deterministic AI
opponents, replay receipts, code-native low-resolution art, and synthesized
sound. The recovery story is fiction; the reproducibility contract is real.

## Play

Open [`index.html`](index.html) in a modern browser. No server, installation,
account, network connection, ROM, emulator, external asset download, or install-time dependency
is required.

1. Choose one of the seven programs.
2. Enter a signal seed and difficulty-switch position.
3. Select **Engage selected signal**.

Keyboard controls are arrows or `WASD`, `Space`/`Z` to fire, `X` for a secondary
action, and `P` to pause. A touch controller appears on narrow or coarse-pointer
devices.

## Seven programs

| Program | Contract |
|---|---|
| **Prism Break** | Deflect one spectral pulse through a seeded six-band wall. |
| **Gridburn** | Shift across seven converging lanes and burn incoming carriers. |
| **Orbital Siege** | Hold the moonline against a marching orbital formation. |
| **Star Talon** | Break a living formation as autonomous talons leave it to dive. |
| **Rift Runner** | Fly a procedurally bending river, manage fuel, and clear hazards. |
| **Iron Circuit** | Outmanoeuvre multiple deterministic tank opponents around walls. |
| **Skywater Command** | Compete with an autonomous rival battery for horizon targets. |

The games share console input and receipt machinery but have separate canonical
state and rules. They are not reskins of one simulation.

## Deterministic contract

The canonical core advances at exactly 60 ticks per second. It uses integer
coordinates and velocities, explicit action-bit inputs, ordered collision passes,
seeded xorshift32 randomness held in state, and deterministic AI decisions.

`CZ01` receipts contain engine version, program ID, normalized seed, difficulty,
exact tick count, and a run-length-encoded input ledger. Playback constructs a
fresh state and drains the entire ledger, including input after a terminal tick,
before publishing the final digest.

Canvas, CSS, browser timing, animation frames, audio, fullscreen state, color
switch position, and layout are presentation only. See
[`docs/DETERMINISM.md`](docs/DETERMINISM.md).

## Files

- `core.js` — all seven canonical simulations, AI, receipts, and digests.
- `app.js` — fixed-step host, renderers, controls, replay UI, synthesized audio,
  and individual hit/clear/finish presentation passes for all seven programs.
- `../shared/qsol-three-stage.js` — pinned local Three.js cabinet depth, particles,
  and event pulses outside canonical game state.
- `index.html` / `style.css` — offline fictional console and responsive controls.
- `docs/MANUAL.md` — recovered-cartridge fiction and complete game instructions.
- `docs/DESIGN.md` — architectural and originality decisions.
- `tests/` — deterministic, AI, receipt, offline, and browser regressions.

All game assets are generated from Canvas/Three.js primitives. All audio is
opt-in and synthesized at runtime; no samples or remote assets are loaded. See
[`NOTICE.md`](NOTICE.md).

## Development checks

Node.js 22 or later is used only for development verification:

```sh
npm test
npm ci
npm run test:browser
```

Playwright is pinned for browser testing and is not a game dependency.

## Status

Playable seven-game anthology with versioned `CZ01` receipts. Version 1 receipts
are intentionally versioned rather than promised compatible with later canonical
simulation revisions.
