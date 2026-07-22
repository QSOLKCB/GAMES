# Determinism contract

For one executable version:

> The same 64-bit universe seed and the same input mask at every 60 Hz simulation tick produce the same logical state hash.

## Authoritative state

The hash covers:

- universe seed and tick;
- PCG state for the economy, mission, and combat streams;
- generated system identity, geometry, market state, faction, and music genome;
- player position, velocity, heading, resources, cargo, upgrades, and reputation;
- enemies, projectiles, salvage, active contract, timers, and music qutrits;
- input edge state and deterministic event serials.

It serializes logical fields in a declared byte order rather than hashing C struct padding.

## Non-authoritative presentation

The following are intentionally excluded:

- `QueryPerformanceCounter` values and render cadence;
- audio-buffer completion order;
- window size and position;
- synthesized PCM phase and visual star drawing;
- save/replay UI mode.

The main loop stores elapsed time as performance-counter units multiplied by 60 and consumes exactly one counter frequency per simulation tick. A catch-up cap prevents an unresponsive machine from running an unbounded update burst; this can change real-time pacing but not the result of a supplied tick-indexed input sequence.

## RNG isolation

PCG streams are seeded independently for economy, missions, and combat. Per-system construction uses a local world-generation stream. Audio and visual identity use hashes or their own state and cannot consume authoritative randomness.

## Replay protocol

A replay stores the universe seed, initial state hash, only input-mask transitions with tick deltas, final tick, final hash, and a checksum. Starting a recording resets the run to its seed so the initial state is reproducible without embedding a save image. Playback regenerates that state, rejects an initial-hash mismatch, applies transitions at their exact ticks, and reports success only when both the final tick and logical state hash match.

Compatibility is currently version-exact. A schema migration format is deferred while the vertical slice is changing quickly.
