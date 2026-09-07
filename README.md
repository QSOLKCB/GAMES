# QSOL-IMC GAMES

Native and browser-based games and interactive experiments from **QSOL-IMC**.

Every project is designed for local, offline play with no account or telemetry. Runtime and build requirements are documented per project.

## Games

| Game | Runtime | Status | Launch / build |
|---|---|---|---|
| [SIGNAL BREACH](SIGNAL_BREACH/) | Offline Three.js + Rust/Wasm | Playable tactical twin-stick shooter | Open [`SIGNAL_BREACH/index.html`](SIGNAL_BREACH/index.html) |
| [CARTRIDGE ZERO: Seven Signals](CARTRIDGE_ZERO/) | Offline Canvas + Three.js | Polished deterministic seven-game anthology | Open [`CARTRIDGE_ZERO/index.html`](CARTRIDGE_ZERO/index.html) |
| [VECTOR ZERO](VECTOR_ZERO/) | Offline Canvas + Three.js | High-visibility deterministic 6DOF shooter | Open [`VECTOR_ZERO/index.html`](VECTOR_ZERO/index.html) |
| [BLACKSTAR AGA](BLACKSTAR_AGA/) | Offline Canvas + Three.js | Four-mission FPS with expanded arsenal and opposition | Open [`BLACKSTAR_AGA/index.html`](BLACKSTAR_AGA/index.html) |
| [PIXEL WARFRONT: Deterministic Command](PIXELWARFRONT/) | Offline Canvas + Three.js | Polished deterministic RTS | Open [`PIXELWARFRONT/index.html`](PIXELWARFRONT/index.html) |
| [SEEDSTORM: Deterministic Strike](SEEDSTORM/) | Offline Canvas + Three.js | Polished deterministic vertical shooter | Open [`SEEDSTORM/index.html`](SEEDSTORM/index.html) |
| [INERTIA ZERO](SUBSPACE/) | Offline Canvas + Three.js | Retuned near-Newtonian arena combat | Open [`SUBSPACE/index.html`](SUBSPACE/index.html) |
| [TERNARY DRIFT](TERNARYDRIFT/) | Native C99/Win32 + offline Three.js edition | Two playable vertical slices | Open [`TERNARYDRIFT/web/index.html`](TERNARYDRIFT/web/index.html) or build `TERNARY.EXE` |

## Running locally

- Browser projects: open the project's `index.html` directly in a modern desktop browser. No server is required. Three.js is pinned under [`vendor/three/`](vendor/three/) so local play never reaches a CDN.
- Native projects: follow the build and run instructions in the project's own README. The `TERNARY.EXE` target intentionally uses Win32, a software framebuffer, and `waveOut`; its native payload contains no HTML, JavaScript, WebAssembly, SDL, or external game runtime.

## Shared rendering boundary

The original deterministic Canvas simulations remain authoritative. A reusable
Three.js stage under [`shared/`](shared/) adds depth, atmosphere, and event pulses
without changing replay state. SIGNAL BREACH and the Ternary Drift web edition
use Three.js as their primary renderer; SIGNAL BREACH also packages the bounded
Rust/WebAssembly sampling approach from QSOLKCB/GALAXY for direct-file play.

## License

Code in this repository is available under the [MIT License](LICENSE). Individual projects may include additional independent-implementation or third-party notices in their own documentation.
