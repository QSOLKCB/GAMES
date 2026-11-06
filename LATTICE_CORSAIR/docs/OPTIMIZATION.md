# Optimization record

LATTICE CORSAIR applies records from [QSOLKCB/OPT](https://github.com/QSOLKCB/OPT)
at commit `7556dd36acd53ed3ed538fd03b1db44e5c1ec869` with OPT's discipline: a
problem contract, a reference path, conformance tests, measurement on the target,
and keeping only what pays. Measurements come from
[`scripts/benchmark.js`](../scripts/benchmark.js) and are stored with source
SHA-256 hashes in [`PERFORMANCE.json`](PERFORMANCE.json) (Node v22.23.4,
Intel(R) Xeon(R) Processor @ 2.10GHz, 7 repeats after one warm-up, medians, parity checked
on every workload). They are local observations, not portable speedup claims.

## OPT-INC-001 — signature-bound market tables (applied)

- **Contract.** X: compute a station's price table on every read vs. reuse.
  F: reused tables equal a fresh `marketFresh` evaluation. C: the key is the
  complete effective input: station id, `career.version` and `war.version`
  (monotonic epochs advanced by every career and war mutation), seed and day.
- **Validation.** `tests/core.test.js` compares cached and fresh tables for six
  stations across trades, day changes and war turns.
- **Measured.** 19 stations x 60 reads: cached
  0.896 ms vs fresh 9.492 ms.
- **Interface use.** Station screens and the galaxy map rebuild only when their
  signature (including `career.version`) changes; HUD text nodes are written only
  when their value changes.
- **Rollback condition.** Any new price input outside the key must be added to it.

## OPT-REDUCE-001 — collision broad-phase (applied for large crowds only)

- **Contract.** X: test each shot against every ship vs. only ships in the
  uniform-grid cells (256 units) its swept segment touches. F: the same first hit
  (lowest segment parameter, then lowest id) as the all-pairs reference
  `collideBrute`. C: identical hits.
- **Validation.** Three crowded fights, over 2,000 shot probes, grid and brute
  force must agree on every hit (`tests/core.test.js`); the benchmark re-checks.
- **Measured** (50 passes over a snapshot of live projectiles):

| Ships | Projectiles | Grid (incl. rebuild) | Brute force |
| ---: | ---: | ---: | ---: |
| 14 | 34 | 1.014 ms | 0.278 ms |
| 26 | 46 | 0.907 ms | 0.915 ms |
| 58 | 69 | 1.129 ms | 2.656 ms |

- **Decision.** Rebuilding the grid every tick costs more than it saves at the
  crowd sizes normal play produces (up to about 16 NPCs); it pays off well above
  that. `flight.js` therefore uses the grid only at 32 or more live ships and
  brute force below. Both paths are exact, so the choice changes cost, never
  behaviour. The crossover is host-specific; the threshold is a conservative,
  documented choice rather than a portable constant.

## Design choice in the spirit of OPT-DSP-001

NPC brains decide at 10 Hz and hold their outputs between decisions, while
physics runs at 60 Hz. This is the game's defined behaviour (deterministic and
tested), not an approximation of a 60 Hz reference, so no equivalence is claimed.

## Inherited

Lane routes come from SOVEREIGN LATTICE's route table (OPT-INV-001,
`LANES_IMMUTABLE`), conformance-tested in that game.

## Context

One minute of flight in a busy system (3,600 fixed steps) takes
10.26 ms on this host.
