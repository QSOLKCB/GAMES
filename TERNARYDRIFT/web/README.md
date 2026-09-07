# Ternary Drift — offline web edition

This is the **Three.js / HTML / CSS / JavaScript** edition of Ternary Drift.
The runtime, simulation, visuals, and synthesized sound are local.

This edition preserves the native vertical slice's central systems—fixed-tick inertial flight, engine kill, three generated systems, markets, cargo, upgrades, contracts, faction state, combat, salvage, jump gates, and five adaptive qutrits—but uses an independent JavaScript fixed-point ruleset tuned for the larger 3D browser presentation. It does not claim replay or save compatibility with `TERNARY.EXE`.

## Download and launch

1. Open the [GAMES repository](https://github.com/QSOLKCB/GAMES). Click the green
   **Code** button, then **Download ZIP**, or [download the source ZIP directly](https://github.com/QSOLKCB/GAMES/archive/refs/heads/main.zip).
2. Extract the **entire ZIP**. The extracted folder is normally named `GAMES-main`.
   Keep the folders together: the game needs [`vendor/three/`](../../vendor/three/)
   alongside `TERNARYDRIFT`. Do not run from inside the ZIP or copy out just the HTML file.
3. Open `GAMES-main`, then `TERNARYDRIFT`, then `web`.
   Open **[`index.html`](index.html)** in a modern desktop browser with WebGL enabled.
   If double-clicking opens a text editor, right-click and choose **Open With** your browser.
4. Enter a **UNIVERSE SEED**, or leave the default, and click **INITIALISE FLIGHT**.
5. You begin docked. Use **Up / Down** to select a commodity, **B** to buy,
   **S** to sell, or **M** to accept a contract. Press **L** or click **LAUNCH** to fly.
6. Click **AUDIO OFF** to enable sound. Use the flight controls below to explore.

Once downloaded, play requires no installation, compilation, server, or internet
connection. GitHub displays the HTML source; open the extracted local file to play.

## Controls

| Mode | Control | Action |
|---|---|---|
| Flight | `W` / `S` | Thrust / reverse |
| Flight | `A` / `D` | Strafe left / right |
| Flight | Left / Right arrows | Rotate the ship |
| Flight | `Space` | Fire the pulse cannon |
| Flight | `E` | Dock near a station or collect nearby salvage |
| Flight | `J` | Travel through a nearby jump gate |
| Flight | `K` | Toggle flight assist / engine kill |
| Docked | Up / Down arrows | Select a commodity |
| Docked | `B` / `S` | Buy / sell one unit |
| Docked | `M` | Accept a contract |
| Docked | `U` | Buy the next ship upgrade |
| Docked | `R` | Repair hull and refill shields |
| Docked | `L` | Launch |

Station repairs cost 3 credits per missing hull point plus 1 credit per missing shield point. Shield-only damage can be repaired; the full repair price must be affordable before either meter is restored.

The dock market updates when its stock, prices, cargo, station, or selection changes. Unchanged animation frames leave its live region untouched.

Run `npm test` to verify deterministic replay behavior, station services and spawns, dock controls and display updates, and the direct-file offline boundary. The dock UI tests run the real app and simulation with DOM and animation-clock test doubles; they do not test GPU rendering or screen-reader announcements.
