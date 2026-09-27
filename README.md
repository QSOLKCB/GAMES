# QSOL-IMC GAMES

Native and browser-based games and interactive experiments from **QSOL-IMC**.

Every project is designed for local, offline play with no account or telemetry. Runtime and build requirements are documented per project.

## Games

| Game | Runtime | Status | Launch / build |
|---|---|---|---|
| [SIGNAL BREACH](SIGNAL_BREACH/) | Offline Three.js + Rust/Wasm | Playable tactical twin-stick shooter | Open [`SIGNAL_BREACH/index.html`](SIGNAL_BREACH/index.html) |
| [CARTRIDGE ZERO: Seven Signals](CARTRIDGE_ZERO/) | Offline native Three.js/WebGL | Polished deterministic seven-game anthology | Open [`CARTRIDGE_ZERO/index.html`](CARTRIDGE_ZERO/index.html) |
| [VECTOR ZERO](VECTOR_ZERO/) | Offline native Three.js/WebGL | High-visibility deterministic 6DOF shooter | Open [`VECTOR_ZERO/index.html`](VECTOR_ZERO/index.html) |
| [BLACKSTAR AGA](BLACKSTAR_AGA/) | Offline native Three.js/WebGL | Four-mission FPS with expanded arsenal and opposition | Open [`BLACKSTAR_AGA/index.html`](BLACKSTAR_AGA/index.html) |
| [PIXEL WARFRONT: Deterministic Command](PIXELWARFRONT/) | Offline native Three.js/WebGL | Polished deterministic RTS | Open [`PIXELWARFRONT/index.html`](PIXELWARFRONT/index.html) |
| [SEEDSTORM: Deterministic Strike](SEEDSTORM/) | Offline native Three.js/WebGL | Polished deterministic vertical shooter | Open [`SEEDSTORM/index.html`](SEEDSTORM/index.html) |
| [INERTIA ZERO](SUBSPACE/) | Offline native Three.js/WebGL | Retuned near-Newtonian arena combat | Open [`SUBSPACE/index.html`](SUBSPACE/index.html) |
| [TERNARY DRIFT — Web Edition](TERNARYDRIFT/web/) | Offline Three.js / HTML / CSS / JavaScript | Playable space-trading and combat sandbox | Open [`TERNARYDRIFT/web/index.html`](TERNARYDRIFT/web/index.html) locally |
| [TERNARY DRIFT — Native Edition](TERNARYDRIFT/) | C99 / Win32 | Playable floppy-sized vertical slice | [Build and run `TERNARY.EXE`](TERNARYDRIFT/README.md#build) |

## Running locally

### Download and play the browser games

1. On the repository page, click the green **Code** button, then **Download ZIP**.
   You can also [download the source ZIP directly](https://github.com/QSOLKCB/GAMES/archive/refs/heads/main.zip).
2. Extract the **entire ZIP**. This normally creates a folder named `GAMES-main`.
   Keep its folders together, including `vendor` and `shared`; the games load
   local files from them. Do not open the HTML from inside the ZIP or copy it out alone.
3. In the extracted folder, open the game's `index.html` listed in the table above
   with a modern desktop browser. If it opens in a text editor, right-click it
   and choose **Open With** your browser.
4. Use the game's start button and its displayed controls. After downloading,
   the browser games need no installation, compilation, server, or internet connection.

The HTML links on GitHub display source; launch the extracted local file to play.
Three.js is included under [`vendor/three/`](vendor/three/) so play never needs a CDN.

### Ternary Drift web edition

After extracting the ZIP, open **`GAMES-main/TERNARYDRIFT/web/index.html`** in a
desktop browser with WebGL enabled. Enter a universe seed or keep the default,
then click **INITIALISE FLIGHT**. You start docked: trade or accept a contract,
then press **L** or click **LAUNCH** to leave the station. Click **AUDIO OFF** to
enable sound.

The web edition includes seeded systems, inertial flight, trading, cargo,
contracts, upgrades, combat, salvage, jump gates, and synthesized sound.
See the [web edition guide and controls](TERNARYDRIFT/web/README.md).

### Native Windows edition

The source ZIP also includes the native Ternary Drift source. Follow its
[build instructions](TERNARYDRIFT/README.md#build) to create `TERNARY.EXE`.
That target uses Win32, a software framebuffer, and `waveOut`; its native payload
contains no HTML, JavaScript, WebAssembly, SDL, or external game runtime.

## Shared rendering boundary

All eight browser titles use Three.js for their **primary gameplay world**.
The six former Canvas games now use one existing gameplay canvas, a WebGLRenderer,
a Scene and a game-specific camera. Their simulation state drives native meshes,
instanced geometry and world-space effects; there is no Canvas gameplay renderer,
decorative second canvas, or Canvas texture wrapped in a plane.

The shared native infrastructure in [`shared/qsol-native.js`](shared/qsol-native.js)
handles GPU batches, resize, pixel ratio, reduced motion, context recovery and
resource disposal. Each game's `renderer.js` owns its visual design and the mapping
from authoritative state to scene entities. HTML HUDs and SVG tactical maps remain
conventional interface elements. No 2D canvas is used by these six games.

See [the per-game audit and migration architecture](docs/NATIVE_RENDERING.md)
for scene inventories, camera choices, validation commands and the removal test.
SIGNAL BREACH and Ternary Drift's web edition retain their existing native Three.js
renderers. The native Windows edition remains a separate software-rendered target.

## License

Code in this repository is available under the [MIT License](LICENSE). Individual projects may include additional independent-implementation or third-party notices in their own documentation.
