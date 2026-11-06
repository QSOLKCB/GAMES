# LATTICE CORSAIR

**One ship. Five empires at war. Trade the lanes, take the contracts, and choose whose side you fly for.**

An offline, real-time space trading and combat game in pure web standards: native
HTML, CSS and classic JavaScript, one WebGL canvas, synthesized audio, no build
step, server, account or network request. Open [`index.html`](index.html) from
the extracted repository (it works from `file://`).

## The game

You are a freelance captain in the **Sovereign Lattice**, the galaxy of
[SOVEREIGN LATTICE](../SOVEREIGN_LATTICE/). Its five empires are at war, and that
war is a real SOVEREIGN LATTICE game playing itself in the background: every two
days the empires take a turn, colonies are founded and captured, and the news
reaches you at the next station. Every colony is a station you can dock at;
outlaw havens hide in the far reaches.

- **Fly.** Real-time, top-down flight with flight assist (or pure Newtonian),
  afterburner, lasers, cannons, homing missiles, deflectors and hull.
- **Trade.** Stations sell what their world produces cheaply and pay well for
  what it consumes. War fronts pay more for alloys, fuel, medicine and munitions.
  Selling a lot depresses the price for a few days. Contraband sells only in
  outlaw havens, and customs confiscate it.
- **Contracts.** Bounties on named outlaws, sealed courier parcels, patrol sweeps
  and war contracts against an empire's enemies, each with a deadline.
- **Standing.** Killing outlaws earns the local empire's favour; attacking an
  empire's ships angers it and pleases its enemies. Fall too low and its patrols
  hunt you and its stations refuse you.
- **Outfit.** Buy hulls and equipment. Shipyards only sell what their empire has
  researched in the background war, so the war shapes what you can fly.
- **Insurance.** If you are destroyed, the insurer tows you to your last port with
  a loaner, keeps a share of your credits, and your cargo is gone.

Patrols guard their stations, traders shuttle between gates and ports, outlaws
prey on everyone, and raiders cross the war fronts. Station turrets defend
their space.

### Controls

| Input | Action |
| --- | --- |
| W / S | Thrust / brake |
| A / D | Turn |
| Space | Fire |
| F | Missile (needs a target) |
| Shift | Afterburner |
| E | Dock / jump (slow down first) |
| Tab / Shift+Tab, R, T | Cycle targets, nearest hostile, clear target |
| J | Autopilot to the plotted route's next gate (or the target) |
| X | Flight assist on/off |
| M | Galaxy map: click a star, plot a route |
| + / − / wheel | Zoom |
| P / Esc | Pause |
| L (docked) | Launch |

**Standard gamepad:** left stick flies, RT fires, LT launches missiles, A docks
or jumps, B is the afterburner, X targets the nearest hostile, LB/RB cycle
targets, Y opens the map, View toggles flight assist, R3 toggles autopilot and
Start pauses (or launches while docked).

## Moddable data: `data/*.TXT`

| File | Contents |
| --- | --- |
| [`SHIPS.TXT`](data/SHIPS.TXT) | Hulls: structure, speed, thrust, turn, hardpoints, bays, cargo, price, hull art |
| [`EQUIPMENT.TXT`](data/EQUIPMENT.TXT) | Weapons, missiles, deflectors, armour, boosters, pods, scanners, drones, capacitors, with research requirements |
| [`COMMODITIES.TXT`](data/COMMODITIES.TXT) | Trade goods, prices, producing and consuming worlds, war demand, legality |
| [`OUTLAWS.TXT`](data/OUTLAWS.TXT) | Outlaw clans, colours, ship names and broadcast taunts |
| [`MISSIONS.TXT`](data/MISSIONS.TXT) | Contract headlines and briefings with placeholders |
| [`PILOTNAMES.TXT`](data/PILOTNAMES.TXT) | Syllables for wanted pilots' names |

The empires, races and leaders come from SOVEREIGN LATTICE's
[`EMPIRES.TXT`](../SOVEREIGN_LATTICE/data/EMPIRES.TXT). Each file documents its
format in its header; the game validates them at start-up and names the first
problem. After editing, run `node scripts/pack-data.js` (browsers cannot read
loose files from `file://`); served over HTTP, the game reads the `.TXT` files
directly. Saves record a data signature.

## Built from QSOL parts

- **SOVEREIGN LATTICE**: the galaxy, empires, colonies, research and war are its
  deterministic core, run by its AI in the background.
- **INERTIA ZERO**: every ship is drawn with its original hull outlines.
- **VANILLAJS** ([`NOTICE.md`](NOTICE.md)): the seeded generator and, through
  SOVEREIGN LATTICE, the total-order heap and checked integers.
- **Shared GAMES infrastructure**: the `qsol-native` WebGL stage and the
  `qsol-input` gamepad reader.
- **OPT**: applied with reference paths, conformance tests and measurements; see
  [`docs/OPTIMIZATION.md`](docs/OPTIMIZATION.md).

## Verify

```bash
node tests/core.test.js
node tests/offline.test.js
npm ci && npx playwright install chromium && node tests/browser-smoke.js
node scripts/benchmark.js
```

## Originality

LATTICE CORSAIR is an original game in the space trading and combat genre. Its
setting, factions, ships, equipment, goods, clans, texts, rules, interface and
art are QSOL work; it is not affiliated with, and contains no names, data or
assets from, any commercial space game. Code is under the repository's
[MIT License](../LICENSE); adapted VANILLAJS code keeps its Apache-2.0 notice.
