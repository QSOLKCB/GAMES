# SOVEREIGN LATTICE

**Explore the lanes. Settle the worlds. Out-research, out-build and out-fight the rival empires.**

An offline, single-player, turn-based 4X strategy game in pure web standards:
native HTML, CSS and classic JavaScript, one WebGL canvas, synthesized audio, no
build step, server, account or network request. Open [`index.html`](index.html)
from the extracted repository (it works from `file://`).

## The game

You lead one of five original empires across a seeded lattice of stars joined by
jump lanes. Each turn you give orders, then every empire moves at once.

- **Explore.** Stars start uncharted. Scouts and colonies reveal systems; ancient
  beacons reward the first empire to decode them.
- **Expand.** Settler Arks found colonies on worlds your species can live on.
  Colonization research opens neighbouring climates, outposts on gas giants and
  asteroids, harsh worlds and barren rock.
- **Exploit.** Colonies grow and build mines, reactors, labs, shipyards, defence
  batteries and arcologies. Minerals build; energy pays upkeep (a shortfall
  halves research and construction); labs drive six research fields.
- **Exterminate.** Design ships from hulls and components, mass fleets, break
  colony defences and land troops. Fleets fight automatically when hostiles share
  a system and are stopped when they enter one. Capitals are fortified, and
  captured worlds keep their own people.

Win by eliminating every rival or by leading the score at the turn limit.

The four rival AIs play honestly: they see only what their own scouts, fleets
and colonies have seen, and each has a temperament (aggressive, expansionist,
technologist, defensive or balanced) that shapes research, building and war.

### Controls

| Input | Action |
| --- | --- |
| Click | Select a star or fleet |
| Right-click, or **M** then click | Move the selected fleet |
| Drag, WASD or arrows | Pan |
| Wheel, + / − | Zoom |
| Tab / Shift+Tab | Next / previous idle fleet |
| C | Next colony |
| R, G, E, L | Research, designs, empires, log |
| Enter | End turn |
| Esc | Cancel / close |
| U | Audio on/off |

**Standard gamepad** (through the shared [`qsol-input.js`](../shared/qsol-input.js)):
left stick moves a cursor, A selects, X sends the selected fleet to the star under
the cursor, B goes back, LB/RB cycle idle fleets, LT/RT zoom, the right stick
pans, View cycles panels and Start ends the turn. Pads must rest at neutral after
connecting.

## Moddable data: `data/*.TXT`

All empires, races, leaders, ship names, hulls, components, facilities, research
fields and star-name syllables live in plain text files:

| File | Contents |
| --- | --- |
| [`EMPIRES.TXT`](data/EMPIRES.TXT) | Empires, races, leader titles, colours, home climates, AI temperaments, ship-name lists, lore |
| [`HULLS.TXT`](data/HULLS.TXT) | Hull classes, slots, structure, speed, cost, research requirement, hull art |
| [`COMPONENTS.TXT`](data/COMPONENTS.TXT) | Weapons, armour, shields, engines, colony pods, troop bays, sensors |
| [`FACILITIES.TXT`](data/FACILITIES.TXT) | Colony facilities |
| [`TECHNOLOGY.TXT`](data/TECHNOLOGY.TXT) | Research fields, costs and limits |
| [`SYSTEMNAMES.TXT`](data/SYSTEMNAMES.TXT) | Syllables for generated star names |

Each file documents its own format in its header. The game validates every file
at start-up and names the first problem it finds. Browsers do not let a page read
loose files from `file://`, so the texts are also bundled into
[`data/packed.js`](data/packed.js): after editing, run

```bash
node scripts/pack-data.js
```

When the folder is served over HTTP (for example `python3 -m http.server`), the
game reads the `.TXT` files directly and the title screen shows "live data". A
test fails if `packed.js` is out of date. Saves record a data signature and will
not load into different data.

## Built from QSOL parts

- **VANILLAJS** ([`NOTICE.md`](NOTICE.md)): the seeded generator, the binary heap
  with a total order (here driving lane-graph Dijkstra) and the checked-integer
  policy, adapted to classic scripts so the game opens from `file://`.
- **INERTIA ZERO**: fleets are drawn with its original hull outlines from
  [`../SUBSPACE/skins.js`](../SUBSPACE/skins.js), painted in empire colours, in
  both the WebGL map and the SVG ship cards.
- **Shared GAMES infrastructure**: the [`qsol-native`](../shared/qsol-native.js)
  WebGL stage and the [`qsol-input`](../shared/qsol-input.js) gamepad reader.
- **OPT**: optimization records applied with reference paths, conformance tests
  and local measurements; see [`docs/OPTIMIZATION.md`](docs/OPTIMIZATION.md).

## Files

```text
SOVEREIGN_LATTICE/
├── index.html, style.css   # Shell, title screen, panels
├── core.js                 # Deterministic rules, AI, save/load (no DOM)
├── renderer.js             # WebGL galaxy map via QsolNative.Stage
├── app.js                  # Interface, input, audio, saves, loop
├── data/*.TXT, packed.js   # Moddable game data and its file:// bundle
├── scripts/                # pack-data.js, benchmark.js
├── tests/                  # core, offline and browser tests
└── docs/                   # DESIGN.md, OPTIMIZATION.md, PERFORMANCE.json
```

## Verify

```bash
node tests/core.test.js
node tests/offline.test.js
npm ci && npx playwright install chromium && node tests/browser-smoke.js
node scripts/benchmark.js
```

The core tests cover data validation, determinism, galaxy invariants, every OPT
reference/conformance gate, orders, colonization, combat and invasion, save/load
and full self-play games. The browser test plays through the real interface from
`file://`, including a scripted gamepad, save and continue, and phone layout.

## Originality

SOVEREIGN LATTICE is an original game in the 4X strategy genre. Its empires,
peoples, names, ships, rules, interface and art are QSOL work; it is not
affiliated with, and contains no names, data or assets from, any commercial 4X
title. Code is under the repository's [MIT License](../LICENSE); adapted
VANILLAJS code keeps its Apache-2.0 notice ([`NOTICE.md`](NOTICE.md)).
