# SOVEREIGN LATTICE notices

SOVEREIGN LATTICE is original QSOL-IMC work: rules, AI, empires, peoples, names,
data files, interface and presentation. It is an original game in the 4X genre and
contains no names, data, text, art or code from any commercial game.

## QSOLKCB/VANILLAJS (Apache License 2.0)

Adapted from commit `93ace342c11e2427ad82920c8965f16e91518fb7`,
Copyright 2026 QSOL–IMC / Trent Slade and contributors:

- `modules/math/index.js` `seededRandom`: the same mixing steps, kept as uint32
  output (`nextU32` in `core.js`).
- `modules/navigation/index.js` `Frontier`: the binary heap with a total order
  independent of insertion scheduling, here driving Dijkstra over the lane graph
  instead of A* over a grid (`Frontier`, `dijkstra` in `core.js`).
- `modules/integer-math/index.js`: the checked-integer policy (economy values
  must stay safe integers, `int` in `core.js`).

The standard-gamepad reader in `../shared/qsol-input.js` carries its own
VANILLAJS notice in `../shared/NOTICE.md`.

## QSOLKCB/OPT (Apache License 2.0)

Optimization patterns from commit `7556dd36acd53ed3ed538fd03b1db44e5c1ec869`
(OPT-INV-001, OPT-INC-001, OPT-REDUCE-001; OPT-PRUNE-001 evaluated and rolled
back). Patterns only: no OPT source is copied. See `docs/OPTIMIZATION.md`.

## Within this repository

Fleet glyphs and ship cards use the original INERTIA ZERO hull outlines from
`../SUBSPACE/skins.js` (MIT, this repository). Rendering uses the vendored
Three.js build in `../vendor/three/` through `../shared/qsol-native.js`.
