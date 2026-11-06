# Shared browser infrastructure notices

## `qsol-input.js`

The standard-gamepad reader is adapted under the Apache License 2.0 from
`modules/input/index.js` (`deadzone` and `FlightGamepad`) in
[QSOLKCB/VANILLAJS](https://github.com/QSOLKCB/VANILLAJS) at commit
`93ace342c11e2427ad82920c8965f16e91518fb7`.

Copyright 2026 QSOL–IMC / Trent Slade and contributors.

Adapted behaviour: standard-mapping pad selection, the rescaled deadzone and
neutral arming after a reset or a pad change. This repository's changes are
a classic-script/CommonJS wrapper for `file://` play, per-frame polling,
edge-detected buttons, digital d-pad/stick directions, and `linked`/`lost`
connection flags. No game-specific bindings, flight model or other VANILLAJS
modules are included. A copy of the Apache License 2.0 is available at
<https://www.apache.org/licenses/LICENSE-2.0>.
