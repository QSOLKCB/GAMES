# Determinism contract

VECTOR ZERO separates its canonical gameplay simulation from browser
presentation. `core.js` is the contract surface; Canvas, CSS, Web Audio, pointer
lock, animation frames, and monitor refresh rate are non-canonical.

## Canonical inputs and update

A run begins with engine version 1, a normalized unsigned 32-bit campaign seed,
a difficulty identifier, and an ordered sequence of packed input words. Each word
contains eleven action bits, one signed yaw quantum, and one signed pitch quantum.

`step(state, inputWord)` advances exactly one 1/60-second tick. Positions and
velocity use integer fixed point with 1024 units per base metre. Angles use 65536
units per turn. Basis vectors use a deterministic integer trigonometric
approximation. Collision samples and entity processing use fixed order.

The core contains no ambient randomness, clock, DOM, storage, network, rendering,
or audio access. Its xorshift32 state is explicit and included in the digest.

## Procedural mine contract

Mine generation starts at a fixed central cell and grows a bounded connected set
of orthogonally adjacent cells. Every open cell is reachable from the start by
construction. Cores, enemies, supplies, and the zero gate are selected only from
those open cells. A mine signature hashes the canonical blueprint.

## Replay receipts

`VZ02` stores `[version, seed, difficulty, ticks, runs]` as JSON, base64url-encodes
it, and prefixes an FNV-1a corruption checksum. Decoding verifies the header,
checksum, metadata, run structure, tick total, and a worst-case-safe two-hour size
bound before simulation.

Terminal simulation state does not discard later ledger words: `previousActions`
remains canonical, so browser replay continues to receipt EOF before publishing
the final state digest.

The checksum and digest detect ordinary corruption and reproducibility drift;
they are not cryptographic signatures.
