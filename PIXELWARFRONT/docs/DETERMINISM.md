# Determinism and replay contract

This document defines the version 1 deterministic contract for PIXEL WARFRONT.

## Transition system

For engine version `v`, campaign seed `s`, and canonical command list `C_t`, the
authoritative state advances as:

```text
S_0     = initialise(v, s)
S_{t+1} = F_v(S_t, C_t)
```

`PixelWarfrontCore.step` implements `F_v` at 20 ticks per second. Positions,
velocities, health, construction and production timers, resources, scores,
cooldowns, and targeting comparisons are integers. The core never reads a wall
clock, frame time, DOM, network, browser storage, ambient random source, renderer,
or audio system.

Movement uses a fixed Chebyshev-normalized integer step. Target candidates and
producer candidates use deterministic distance ordering with entity ID tie-breaks.

## Procedural missions

Mission `n` derives private streams from the canonical unsigned 32-bit campaign
seed. Before gameplay begins, the generator fixes:

- biome and terrain tiles;
- flux-field positions, capacities, and visual phases;
- initial bases, fixed defences, and enemy force;
- enemy health, damage, income, reinforcements, and wave cadence;
- a checked mission signature.

Every next mission strictly increases at least enemy health and damage. Cadences
approach positive lower bounds and never reach zero.

## Command replay format

A replay contains:

```text
R = (engineVersion, campaignSeed, tickCount, [(tick, commands), ...])
```

Ticks with no player commands are absent. Accepted commands are:

- move selected player units to a world position;
- attack an existing hostile entity;
- gather from an existing flux field with selected drones;
- stop selected units;
- construct one allowed structure with selected drones;
- queue one allowed unit role.

Playback initializes `S_0`, emits an empty command list for omitted ticks, and
applies recorded commands in strictly increasing tick order. Commands are bounded,
canonicalized, and revalidated during decoding.

The textual envelope is `PWR1.<checksum>.<base64url>`. The checksum is an eight-hex
FNV-1a value over the payload. It detects accidental corruption, not adversarial
tampering. Recording is capped at six hours at 20 Hz.

## Included in the contract

- seed identities and mission blueprints;
- entity identifiers and spawn order;
- player and enemy economies;
- construction, production, supply, and power;
- command validation and application;
- movement, target selection, projectiles, damage, destruction, and victory;
- enemy commander reinforcement and attack scheduling;
- campaign progression, score, and statistics;
- replay decoding and per-tick playback;
- the regression digest returned by `stateDigest`.

## Deliberately outside the contract

- Canvas pixels, CSS layout, selection-box styling, animation, interpolation,
  impact sparks, explosions, and screen shake;
- the transient `state.events` presentation queue and payload shape;
- Web Audio timing, speaker output, and mute state;
- the non-authoritative random-seed button;
- browser focus, pointer sampling, viewport size, and display refresh rate;
- a replay loaded into a modified or later engine version.

`ENGINE_VERSION` must increase if a change alters the authoritative transition,
procedural generator, command interpretation, replay format, or digest schema.

## Regression evidence

`tests/core.test.js` checks stable seed normalization, identical mission generation,
monotonic rank pressure, a checked golden digest, replay round-trip equality,
tamper rejection, harvesting, construction and production timing, victory and
mission escalation, and absence of ambient nondeterministic inputs from the core.
