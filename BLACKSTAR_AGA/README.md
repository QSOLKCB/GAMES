# BLACKSTAR AGA

**The last game ever released for Amiga — then lost. A fictional recovered 1996
micro-release, rebuilt as an original deterministic offline browser FPS.**

BLACKSTAR AGA is a compact grid-and-sector-flavoured first-person shooter with a
320×200 software framebuffer, chunky procedural pixel art, four-voice-inspired
Web Audio effects, three linked missions, and replay receipts that reproduce the
fixed-tick simulation from its campaign seed and input ledger.

## Play

Open [`index.html`](index.html) directly in a modern desktop browser. No web
server, installation, account, network connection, external asset, or build step
is required.

1. Choose a campaign seed and duty roster.
2. Select **Boot Recovered Master**.
3. Click the game view for pointer-lock mouse look, or use the keyboard alone.

### Controls

| Input | Action |
|---|---|
| `W` / `S` | Move forward / backward |
| `A` / `D` or arrows | Turn |
| `Q` / `E` | Strafe |
| `Shift` | Run |
| `Space` or mouse 1 | Fire |
| `F` or `Enter` | Use doors, locks, secrets, and exits |
| `1`–`3` | Select pulse pistol, breach gun, or Vulcan 68 |
| Hold `Tab` | Tactical automap |
| `P` | Pause |
| `Esc` | Release captured mouse |

Touch controls appear automatically on coarse-pointer devices.

## Campaign

- **Dock Nine:** recover the amber cipher and reach the uplink lift.
- **Cryo Archive:** purge the archive guards and find the sealed stair.
- **Reactor Crown:** destroy the Black Warden and transmit Disk Four.

The seed changes deterministic enemy phases and item drops without changing the
hand-authored navigable mission topology. Three difficulty contracts scale player
vitality, hostile vitality, damage, and score.

## Deterministic contract

Simulation runs at exactly 60 fixed ticks per second. Gameplay state uses integer
fixed-point positions, integer angle units, a seeded xorshift32 stream, fixed
mission data, and explicit input words. The core never reads wall-clock time,
ambient randomness, storage, network state, rendering state, or audio state.

The **Replay / Receipt** panel encodes:

- engine version;
- normalized 32-bit campaign seed;
- difficulty;
- exact number of ticks;
- run-length-encoded keyboard, mouse-turn, and action input words;
- an FNV-1a checksum.

Loading a receipt creates a fresh run and applies the same input word at every
tick. The telemetry panel publishes the current canonical state digest. See
[`docs/DETERMINISM.md`](docs/DETERMINISM.md) for the boundary and limitations.

## Architecture

- `core.js` — pure deterministic simulation, campaign parsing, combat, replay and digest.
- `app.js` — fixed-step scheduler, raycaster, procedural sprites, UI, input and audio.
- `style.css` — responsive recovered-hardware shell with no fetched fonts or images.
- `index.html` — local-file-compatible application and strict offline CSP.
- `tests/` — Node determinism/offline tests and a Playwright end-to-end smoke test.

The raycaster and all art/audio are original. The implementation does not use a
third-party game engine, framework, package at runtime, ROM, WAD, map, texture,
sprite, or sample. See [`NOTICE.md`](NOTICE.md).

## Development checks

Node.js 22 or later is used for development-only tests:

```sh
npm test
npm ci
npm run test:browser
```

Playwright is pinned and used only by the browser smoke suite. It is not part of
the game runtime.

## Status

Playable vertical slice / complete three-mission mini-campaign. Version 1 replay
receipts are intentionally versioned rather than promised compatible with future
simulation revisions.
