# Ternary Drift

**Ternary Drift** is a native C99/Win32 2D space-trading and combat sandbox built under a hard floppy-sized distribution constraint. Its economy, missions, combat, replay stream, and adaptive tracker score all derive from a declared 64-bit universe seed.

This directory contains the first native vertical slice of the larger design—not a browser prototype and not a claim that the complete game is finished.

## Current vertical slice

The implementation currently provides:

- a 64-bit Windows executable using the Win32 API, a 480×270 software framebuffer, integer nearest-neighbour scaling, and `waveOut` audio;
- a 60 Hz fixed-timestep authoritative simulation using Q16.16 fixed-point flight and no gameplay floating point;
- three seed-generated systems, each with a station, jump gate, faction owner, compact market, and musical genome;
- assisted inertial flight, engine-kill drifting, strafing, cruise thrust, pulse-cannon combat, shield/hull damage, one deterministic Ashwake raider type, and salvage drops;
- four commodities, bounded inventory-responsive pricing, cargo capacity, buying, selling, repairs, and three upgrade tracks;
- delivery and bounty contracts generated from the mission RNG stream;
- five faction reputation values with basic action propagation;
- a four-channel restricted XM-style tracker model with procedural square, triangle, noise, and saw voices;
- row-boundary ternary music adaptation driven by navigation, threat, economy, faction, and hull qutrits;
- versioned save images, transition-compressed input replays, deterministic final-state verification, and logical state hashes;
- host-side determinism tests, a MinGW-w64 build, and an automated 1,350,000-byte internal package limit (below a 1,474,560-byte floppy).

No web technology, SDL, Electron, external game runtime, downloaded content, recorded soundtrack, MP3, OGG, WAV music, or large raster asset is used.

## Build

### Windows with MinGW-w64

Run:

```bat
build.bat
```

This creates `build\TERNARY.EXE` and runs the size verifier when Python is available.

### Cross-compile from Linux

With `x86_64-w64-mingw32-gcc` installed:

```sh
make windows
make size
make package
```

The distribution payload is:

```text
TERNARY.EXE
README.TXT
```

All current pattern fragments, instruments, font data, palette choices, ship geometry, and world tables are embedded compactly in the executable. A separate `TERNARY.DAT` is deferred until packed resources justify its directory overhead.

## Test the deterministic core

The authoritative game and tracker compiler are platform-neutral C99. On a POSIX development machine:

```sh
make test
```

The test suite runs two long simulations with identical seeds and inputs, exercises market/mission/jump state, verifies save corruption rejection, records and replays an input-transition stream, and compares independently rendered tracker output and event hashes.

## Controls

### Flight

| Control | Action |
|---|---|
| `W` / `S` | Thrust / reverse |
| `A` / `D` | Lateral strafe |
| Left / Right | Rotate |
| `Space` | Fire pulse cannon |
| `Shift` | Cruise thrust |
| `K` | Toggle flight assist / engine kill |
| `E` | Dock or tractor nearby salvage |
| `J` | Traverse a nearby jump gate |

### Docked

| Control | Action |
|---|---|
| Up / Down | Select a commodity |
| `B` / `S` | Buy / sell one unit |
| `M` | Accept a generated contract |
| `U` | Buy the displayed upgrade |
| `R` | Repair and recharge |
| `L` | Launch |

### Persistence and verification

| Control | Action |
|---|---|
| `F5` / `F6` | Save / load `TERNARY.SAV` |
| `F9` | Start a fresh seeded recording; press again to write `TERNARY.RPL` |
| `F10` | Replay `TERNARY.RPL` and verify its final logical state hash |

Pass an optional seed on the command line:

```text
TERNARY.EXE 0x5445524E41525931
```

## Determinism boundary

The fixed-step game state is authoritative. World generation, economy, missions, and combat use separate PCG streams so audio rendering or visual particles cannot perturb gameplay. The tracker receives a read-only projection of game state. Win32 timing, presentation, audio-buffer scheduling, window size, and frame cadence are deliberately outside the authoritative hash.

See [determinism](docs/DETERMINISM.md) and [audio model](docs/AUDIO_MODEL.md) for the precise boundary.

## Explicitly deferred

The design brief targets 12 systems, 10 commodities, eight hulls, nine mission types, five fully simulated factions, physical convoys, mining, richer equipment and subsystem damage, 4–8 tracker channels, a packed resource archive, and long-run economic persistence. Those are not yet implemented.

The current slice has three systems, four commodities, one player hull, one enemy archetype, two mission types, basic reputation propagation, four tracker channels, and embedded procedural resources. Save files are versioned and hash-checked but intentionally same-build while the state schema is changing. Pattern jump/break commands and an external packed pattern format are reserved but deferred.

The detailed status ledger is in [docs/STATUS.md](docs/STATUS.md).

## License

Ternary Drift is covered by the repository's [MIT License](../LICENSE).
