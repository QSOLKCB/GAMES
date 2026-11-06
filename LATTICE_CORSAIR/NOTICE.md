# LATTICE CORSAIR notices

LATTICE CORSAIR is original QSOL-IMC work: setting, rules, factions' roles,
ships, equipment, commodities, outlaw clans, contract texts, interface and
presentation. It contains no names, data, text, art or code from any
commercial game.

## QSOLKCB/VANILLAJS (Apache License 2.0)

`flight.js` uses the seeded generator from `modules/math/index.js`
(`seededRandom`, kept as uint32 output) at commit
`93ace342c11e2427ad82920c8965f16e91518fb7`, Copyright 2026 QSOL–IMC / Trent Slade
and contributors. The SOVEREIGN LATTICE core it runs carries its own VANILLAJS
notice in `../SOVEREIGN_LATTICE/NOTICE.md`; the gamepad reader carries one in
`../shared/NOTICE.md`.

## QSOLKCB/OPT (Apache License 2.0)

Optimization patterns from commit `7556dd36acd53ed3ed538fd03b1db44e5c1ec869`
(OPT-INC-001, OPT-REDUCE-001; OPT-DSP-001 as a design idea). Patterns only; no
OPT source is copied. See `docs/OPTIMIZATION.md`.

## Within this repository

The galaxy and its war are a SOVEREIGN LATTICE game (`../SOVEREIGN_LATTICE/`).
Ships use the original INERTIA ZERO hull outlines (`../SUBSPACE/skins.js`).
Rendering uses the vendored Three.js build through `../shared/qsol-native.js`.
