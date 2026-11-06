# Optimization record

SOVEREIGN LATTICE applies records from [QSOLKCB/OPT](https://github.com/QSOLKCB/OPT)
at commit `7556dd36acd53ed3ed538fd03b1db44e5c1ec869`, following its protocol:
define the problem contract, keep a reference path, test conformance, measure on
the target, and roll back what does not pay. Correctness outranks speed.

Measurements come from [`scripts/benchmark.js`](../scripts/benchmark.js) and are
stored with source SHA-256 hashes and environment in
[`PERFORMANCE.json`](PERFORMANCE.json) (Node v22.23.4,
Intel(R) Xeon(R) Processor @ 2.10GHz, 7 repeats after one warm-up,
medians). Parity is checked on every measured workload. These are local
observations on one host, not portable speedup claims.

## OPT-INV-001 — invariant-driven route reuse (applied)

- **Problem contract.** X: per-query shortest-path search vs. reuse of an
  all-pairs table. F: answers identical (path and cost, including tie order) to a
  fresh search. f: route-query cost plus table construction. d: minimize.
  C: every reused route equals `routeReference`. B/S: one benchmark run per
  change; stop when parity holds and the cost is no worse.
- **Invariant `LANES_IMMUTABLE`.** Lanes never change after generation. The
  galaxy is deep-frozen at creation and on load; a table is reused only while the
  galaxy's lane list is the frozen list it was built from. An unfrozen list is
  never cached (fail closed).
- **Reference path.** `routeReference`: a fresh single-source Dijkstra with the
  same total-order heap, stopping at the target.
- **Validation.** `tests/core.test.js` compares table and reference for every
  ordered pair on six galaxies, checks deep-freezing and that unfrozen lanes are
  recomputed. The benchmark re-checks parity on its workload.
- **Measured** (all ordered pairs once, mid-game state):

| Galaxy | Systems | Queries | Table | Fresh searches | Table build (once) |
| --- | ---: | ---: | ---: | ---: | ---: |
| small | 18 | 324 | 0.165 ms | 3.284 ms | 0.294 ms |
| medium | 28 | 784 | 0.097 ms | 7.464 ms | 0.175 ms |
| large | 40 | 1600 | 0.141 ms | 20.466 ms | 0.194 ms |

- **Adaptation.** The first version re-hashed every lane on each query to verify
  a content signature; measured, that was slower than a fresh search on graphs of
  this size. The signature is now computed once at build time, and reuse is gated
  on the frozen identity, which a frozen object guarantees.
- **Rollback condition.** If lanes ever become mutable during play, remove the
  cache or bind it to a monotonic lane epoch.

## OPT-INC-001 — signature-bound design statistics (applied)

- **Problem contract.** X: recompute ship statistics on every read vs. reuse.
  F: reused statistics equal a fresh evaluation. C: the cache key is the complete
  effective input: the immutable design (invariant `DESIGNS_IMMUTABLE`: designs
  are frozen; edits create a new id) and the owner's tech levels, whose every
  change advances `empire.techEpoch`, a monotonic epoch.
- **Validation.** Cached and fresh statistics are compared for every design across
  twelve tech changes; a cached value is never served across a tech change.
- **Measured.** 76 ships x 20 passes: cached
  0.27 ms vs fresh 0.927 ms (large galaxy).
- **Interface use.** The side panel and star labels redraw only when their
  signature changes. Signatures include `state.version`, a monotonic epoch that
  every core mutation advances, so an A to B to A edit still redraws (tested).
  No speed claim is made for this; it removes per-frame DOM rebuilding.
- **Rollback condition.** Any stats input outside (design, tech) requires adding
  it to the key or removing the cache.

## OPT-REDUCE-001 — early working-set reduction (applied)

AI colonization filters planets by cheap predicates (explored, unclaimed, not
reserved by another colony ship, settleable with current technology) before any
route lookup or scoring. The test compares the reduced list with filtering every
planet afterwards. No speed claim is made; it keeps AI scoring to real options.

## OPT-PRUNE-001 — bound-driven pruning (evaluated, rolled back)

The colony-target search was implemented as a distance-ordered scan with an
analytic upper bound on planet value, proven sound over the complete finite
domain (every climate, size, richness and colonization level) and tested equal
to the exhaustive search across several hundred states. It evaluated about one
third of candidates, yet the sort it needs cost more than the cheap scoring it
skipped: Measured on this host before rollback (large galaxy, all empires x systems): pruned 7.57 ms vs exhaustive 7.20 ms median in one run and 12.49 vs 10.61 ms in another, evaluating 3122 of 8880 candidates. The distance sort cost more than the cheap scoring it skipped, so the exhaustive path is the only path.
Per OPT's rollback rule the exhaustive argmax is the only path.

## Context

Whole-game cost is small either way: 100 self-play turns with four AIs take
small 40.617 ms, medium 61.077 ms, large 56.054 ms on this host.
