# Determinism contract

BLACKSTAR AGA separates its gameplay simulation from its browser presentation.
`core.js` is the contract surface. `app.js`, Canvas, Web Audio, CSS, animation
frames, pointer lock, and monitor refresh rate are outside canonical state.

## Canonical inputs

A run begins with an engine version, normalized unsigned 32-bit seed, difficulty,
and the ordered sequence of packed input words. Each word contains action bits and
a bounded signed mouse-turn quantum. Keyboard and mouse state are sampled by the
browser shell once per fixed tick, not once per rendered frame.

## Canonical update

`step(state, inputWord)` advances exactly one 1/60-second tick. Positions are
integer fixed point (`1024` units per map cell); angles use `65536` units per turn.
The core uses integer trigonometric approximation, deterministic collision order,
deterministic entity order, and a xorshift32 stream held inside state.

The core deliberately contains no calls to:

- `Math.random()`;
- wall-clock or high-resolution timers;
- DOM, Canvas, Web Audio, storage, fetch, or other browser services.

## Replay receipts

The `BSA2` text format stores `[version, seed, difficulty, ticks, runs]` as JSON,
base64url-encodes it, and prefixes an FNV-1a checksum. A decoder rejects unknown
versions, malformed input runs, mismatched tick totals, payloads beyond the
six-hour cap, and checksum changes before simulation.

The checksum detects ordinary corruption and tampering; it is not a cryptographic
signature. A state digest is likewise a compact reproducibility receipt, not a
security proof.

## Scheduler boundary

The browser shell accumulates animation-frame time and executes whole fixed ticks.
It caps catch-up work to prevent a suspended tab from producing an unbounded frame.
Pausing, opening the replay dialog, or hiding the page freezes tick advancement.
Audio and rendering may differ by browser, device, or frame cadence without
changing core state for the same seed, difficulty, engine version, and input words.
