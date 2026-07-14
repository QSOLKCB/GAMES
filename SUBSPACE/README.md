# INERTIA ZERO 1.0

**Offline Single-Player Inertia Arena**

> Zero ping. No queue. No compromise.

INERTIA ZERO is an independent browser-native reimplementation of the feel of classic 2D inertia arena combat, informed by public gameplay and protocol documentation. It was built for the experience that network latency used to deny: immediate ship response, readable projectile geometry, demanding energy management, and opponents that win through piloting rather than lag.

It is deliberately **single-player only**. There is no networking code, login, telemetry, matchmaking, server, or multiplayer mode.

## Launch

Open [`index.html`](index.html) directly in a modern desktop browser.

There is:

- no installation;
- no build step;
- no Node.js runtime requirement;
- no npm or third-party JavaScript dependency;
- no web server requirement; and
- no network request after the files are present.

Chrome/Chromium, Firefox, and current Safari are the primary targets. Keyboard controls are recommended. A standard gamepad is supported during flight; menus and pause dialogs require a keyboard or pointer.

## What is included

- Full-screen Canvas 2D combat with inertial acceleration, rotation, reverse thrust, wall rebound, and an energy-draining afterburner.
- One regenerating **energy bank** shared by hull integrity, guns, ordnance, boost, repel, and active systems.
- Eight original vector hull silhouettes with classic/SVS-inspired ship identities.
- Five honest AI tiers, from Cadet to Sovereign. Difficulty changes thinking quality—not enemy damage, speed, energy, or cooldown rules.
- Predictive interception, correlated aim error, projectile threat analysis, energy discipline, range control, obstacle avoidance, A* navigation, coordinated orbit choices, and short-horizon manoeuvre evaluation.
- Five deterministic arena recipes and four rotating mission types.
- Seeded campaign generation: the same campaign seed, sector, and recipe reproduce the same geometry.
- Elimination, beacon control, core assault, and timed survival directives.
- Procedural energy/system pickups, radar, off-screen threat indicators, coordinate grid, combat feed, local high score, pause/restart flow, and sector progression.
- Procedurally synthesized Web Audio effects with no bundled sound assets.
- A fixed 60 Hz simulation clock separated from display refresh.
- Direct `file://` operation using classic scripts rather than browser modules.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Rotate | `A` / `D` or `←` / `→` | Left stick |
| Forward thrust | `W` or `↑` | Left stick up / right trigger |
| Reverse thrust | `S` or `↓` | Left stick down / left trigger |
| Primary gun | `Space` or `Ctrl` | A / Cross |
| Secondary ordnance | `X` or `Tab` | B / Circle |
| Afterburner | `Shift` | Right shoulder |
| Hull special | `Q` | X / Square |
| Repel | `R` | Y / Triangle |
| Pause | `P` or `Esc` | — |
| Mute | `M` | — |

Mouse primary and secondary buttons may also fire the two weapon systems. Rotation remains inertial and hull-oriented—the pointer does not silently aim for you.

## Hull roster

SubSpace server operators could radically alter ship settings, so there is no single universal historical balance table. INERTIA ZERO uses recognisable **classic/SVS-inspired traits** rather than claiming one zone's rules are canonical. The named active specials and exact balance values are original gameplay extensions, not claims about universal historical settings.

| Hull | INERTIA ZERO role | Distinguishing system |
|---|---|---|
| **Warbird** | Agile, balanced precision duelist | Temporary overdrive improves thrust, speed, firing cadence, and recharge. |
| **Javelin** | Fastest straight-line interceptor | Vector dash for attack passes and projectile escapes. |
| **Spider** | Covert skirmisher | Energy-draining cloak; firing reveals the hull. |
| **Leviathan** | Slow heavy bomber | Siege discharge launches an amplified Level-3-style heavy bomb. |
| **Terrier** | Agile twin-gun interceptor | Paired primary ports and a timed multifire system. |
| **Weasel** | Electronic-warfare bomber | EMP ordnance and an area pulse that interrupts hostile recharge. |
| **Lancaster** | High-energy ricochet gunship | Bombs rebound once from geometry; barrier absorbs incoming damage. |
| **Shark** | Rapid-fire controller | Fast primary cadence and an enlarged repulsor field. |

All ships also have a primary gun, secondary ordnance, universal repel charge, reverse thrust, and energy-draining afterburner. Projectiles inherit the firing ship's velocity, making strafing vectors and lead calculation matter.

## AI tiers

| Tier | Behaviour |
|---|---|
| **Cadet** | Slow reactions, visible correlated aim drift, limited prediction and evasion. |
| **Veteran** | Predictive fire, basic pathfinding, energy reserve, and threat response. |
| **Ace** | Accurate interception, projectile evasion, flanking, range control, and manoeuvre planning. |
| **Elite** | Fast staggered flanking pressure, disciplined ordnance use, and strong defensive-system timing. |
| **Sovereign** | Near-instant tactical updates, minimal aim drift, strong nearest-threat prediction, and maximum orbit-spacing pressure. |

Every tier flies the same ship physics and pays the same weapon/system energy costs. Sovereign is difficult because it reads trajectories, protects its energy reserve, routes around cover, evaluates future manoeuvres, and uses each hull's systems intelligently—not because it receives hidden bonuses.

## Procedural sectors

The campaign rotates through:

- **Open Frontier** — sparse debris and long engagement lanes;
- **Asteroid Graveyard** — dense irregular cover and ambush geometry;
- **Orbital Rings** — nested broken rings around the directive area;
- **Broken Citadel** — fragmented station walls and bank-shot corridors; and
- **Plasma Channels** — long conduits with navigable openings and flanking routes.

The generator reserves safe clearance around all required spawns and the central objective. Every arena receives a compact geometry-derived fingerprint displayed in the HUD. Within the same INERTIA ZERO build/version, a campaign seed plus sector number and chosen recipe deterministically identifies its geometry.

Mission order is:

1. eliminate the hostile wing;
2. secure and hold the beacon;
3. breach the defended rift core;
4. survive a timed interdiction with reinforcements;
5. repeat at a higher threat budget and new geometry.

One reserve hull is awarded after every third cleared sector, up to the campaign cap.

## Energy doctrine

Energy is intentionally the central risk system:

- incoming damage removes energy;
- guns and bombs remove energy;
- afterburner continuously removes energy;
- special systems and repel remove energy; and
- energy regenerates unless EMP-locked.

An exhausted pilot is both unable to attack and close to destruction. Strong play means spending enough energy to create an advantage without becoming a free kill.

## File structure

```text
SUBSPACE/
├── index.html              # Application shell, menu, HUD, and dialogs
├── style.css               # Responsive presentation and retro tactical UI
├── core.js                 # Seeded RNG, ship/AI data, geometry, pathfinding, world generation
├── app.js                  # Simulation, combat, AI, audio, rendering, objectives, and UI state
├── README.md
└── tests/
    ├── index.html          # Browser-openable core verification page
    ├── core.test.js        # Determinism, geometry, pathfinding, and generation tests
    ├── runtime-smoke.js    # Headless DOM/canvas simulation smoke harness
    └── browser-smoke.js    # Optional Playwright end-to-end browser smoke test
```

## Verification

The game itself needs no Node.js. Node is used only for automated development checks.

```bash
node --check core.js
node --check app.js
node tests/core.test.js
node tests/runtime-smoke.js
```

Alternatively, open [`tests/index.html`](tests/index.html) directly to run the core suite in a browser.

The core suite checks:

- a golden seeded-RNG sequence;
- same-seed arena reproduction;
- cross-seed layout diversity;
- the eight-hull configuration contract;
- no AI speed/damage cheats;
- intercept geometry and line-of-sight;
- A* navigation; and
- spawn/objective clearance across 750 generated arenas.

The dependency-free runtime smoke harness boots the real app against a lightweight DOM and Canvas API stub, launches live combat, advances 600 simulation ticks, exercises weapons and AI, renders a full frame, verifies finite entity state, checks every hull's weapon/system command paths, covers all four objective transitions and survival reinforcement, checks the live core blocker and reachable pickup placement, and covers terminal/pause/resume/hangar transitions. Developers with the optional `@napi-rs/canvas` package can also set `INERTIA_ZERO_RENDER_PATH=/tmp/inertia-zero.png` to write a native PNG during the same run.

## Independent implementation and trademark notice

INERTIA ZERO is independent software built from original code, vector geometry, procedural levels, interface work, and synthesized audio, using public gameplay and protocol documentation as historical reference. It does **not** include or redistribute original SubSpace/Continuum executables, source code, maps, tiles, ship bitmaps, sound archives, or other proprietary assets.

The historical ship names are used descriptively to meet the project's classic-roster goal. INERTIA ZERO is not an official SubSpace product and is not affiliated with its original developers, publishers, or the Continuum community.

Useful historical references informing the high-level mechanics and roster distinctions include:

- [SubSpace overview](https://en.wikipedia.org/wiki/SubSpace_%28video_game%29)
- [Chaos/Standard VIE Settings ship traits](https://chaos.svssubspace.com/?page=zonesettings)
- [SubSpace Protocol — weapon, item, and toggle enumerations](https://www.twcore.org/SubspaceProtocol/)

These references are documentation only and are not runtime dependencies.

## License

Copyright © 2026 QSOL-IMC / Trent Slade.

Released under the repository's [MIT License](../LICENSE).
