# Signal Breach

Signal Breach is an offline tactical twin-stick shooter: one operator breaches a communications yard, captures three contested relays, then extracts through the east aperture. Movement and aim are independent, cover stops rounds, each enemy silhouette has a distinct role, and three weapons support different engagement ranges.

Open `index.html` directly in a modern desktop browser. Everything needed to play—including Three.js and the WebAssembly payload—is committed locally. There are no accounts, downloads, requests, analytics, or build steps at play time.

## Controls

- Keyboard and mouse: `WASD` move, mouse aims, left mouse fires, `Space` dashes, `Q` / `E` cycle weapons.
- Gamepad: left stick moves, right stick aims, right trigger or south button fires, east button dashes, bumpers cycle weapons.
- Touch: a compact move, fire, and dash pad is available. Aim by moving a pointer over the arena before firing.

## Weapons and opposition

- **Vector Carbine:** accurate sustained fire.
- **Arc Scatter:** wide close-range breach pattern.
- **Null Lance:** slow, high-damage penetrating line shot; damages each crossed enemy once, and stops at hard cover or its lifetime limit.
- **Wraith:** fast lateral pressure; **Lancer:** ranged fire support; **Bulwark:** slow armored denial unit.

## GALAXY Rust/WebAssembly lineage

The committed sampler in `../vendor/galaxy-sampler/` is the bounded Rust/Wasm module from [QSOLKCB/GALAXY](https://github.com/QSOLKCB/GALAXY), used locally to create deterministic arena data. Its base64 classic-script package makes `file://` play possible without `fetch`. A compact compatible Rust source and rebuild pipeline live in `rust/` and `scripts/`; JavaScript implements the same bounded hash sampler as a graceful fallback when WebAssembly is unavailable.

The copied GALAXY object and notices are retained under `../vendor/galaxy-sampler/`. The game code is covered by the repository MIT license; the sampler source/object retains Apache-2.0 notices.

## Development

Run `npm test` for deterministic simulation, combat regressions, arena, WebAssembly parity, syntax, and offline-boundary checks. Pointer-release tests execute the real app and Three.js scene objects with a controlled clock and test doubles for the DOM and GPU renderer; they are not browser/GPU rendering tests. With Rust and the `wasm32-unknown-unknown` target installed, run `./scripts/build-wasm.sh` to replace the shipped sampler with the smaller game-specific compatible build.
