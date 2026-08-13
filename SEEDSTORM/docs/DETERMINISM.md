# Determinism and replay contract

This document defines the version 1 deterministic contract for SEEDSTORM.

## Transition system

For engine version `v`, initial seed `s`, and input mask `I_t`, the authoritative
gameplay state advances by the pure transition:

```text
S_0     = initialise(v, s)
S_{t+1} = F_v(S_t, I_t)
```

`F_v` is implemented by `SeedStormCore.step`. The application invokes it at a
fixed rate of 60 ticks per second. Gameplay coordinates, velocities, counters,
health, collision radii, schedules, and scores are integers. The core does not
read the wall clock, frame time, browser storage, network, audio system, DOM, or
an ambient random source.

Diagonal player movement uses a fixed integer approximation rather than a
floating-point square root. Enemy aim selects among fixed integer direction
vectors. These choices keep authoritative arithmetic stable across conforming
JavaScript engines.

## Procedural levels

The base run seed is a canonical unsigned 32-bit value. Text seeds are reduced to
that value with FNV-1a followed by a 32-bit avalanche mixer. Numeric and `0x` seeds
are accepted directly so exported seed identities round-trip exactly.

Level `n` derives its private seed as:

```text
levelSeed = mix32(baseSeed XOR imul(n, 0x9E3779B1))
```

The level generator consumes only this seed and the level number. It fixes, before
play begins:

- biome selection;
- wave ticks and formations;
- enemy classes and horizontal lanes;
- path phases and firing offsets;
- deterministic power-up and bomb drops;
- command-craft arrival and pattern parameters.

Increasing the level always raises the integer rank. Several pressure parameters
eventually reach safe playability caps, while enemy health and command-craft health
continue to increase. Thus every next level is strictly tougher in at least one
authoritative dimension without allowing spawn or firing intervals to reach zero.

## Replay format

A replay is:

```text
R = (engineVersion, baseSeed, tickCount, RLE(I_0 ... I_{N-1}))
```

Each input is a seven-bit mask for left, right, up, down, fire, focus, and bomb.
Consecutive equal masks are run-length encoded as `[mask, count]`. The replay
contains no copy of `S_t` at any time. Playback creates `S_0` from the seed and
applies all decoded inputs in order.

The textual envelope is `SSR1.<checksum>.<base64url>`. The checksum is an eight-hex
FNV-1a value over the unencoded payload. Decoding rejects:

- a wrong envelope or engine version;
- malformed base64 or JSON;
- a checksum mismatch;
- invalid input bits or run lengths;
- inconsistent or excessive tick counts;
- recordings longer than six hours at 60 Hz.

The checksum and state digest are reproducibility aids, not authentication or
security primitives.

## Included in the contract

- level blueprints and their signatures;
- entity creation and identifiers;
- movement, firing, collision, damage, pickups, bombs, and lives;
- score, chain multiplier, statistics, level clears, and game-over state;
- replay decoding and per-tick playback;
- the final regression digest returned by `stateDigest`.

## Deliberately outside the contract

- Canvas pixels, CSS layout, scanline overlay, animation interpolation, and screen
  shake;
- Web Audio scheduling, speaker output, and mute state;
- the non-authoritative random-seed button;
- browser focus, window size, and display refresh rate;
- a replay code loaded into a modified or later engine version.

The `ENGINE_VERSION` must be incremented if a change alters the authoritative
transition, procedural generator, replay interpretation, or digest schema.

## Regression evidence

`tests/core.test.js` checks:

1. stable seed identities;
2. identical blueprints for identical `(seed, level)` pairs;
3. monotonic difficulty escalation;
4. a checked 1,500-tick golden state digest;
5. replay round-trip equality of complete final state digests;
6. checksum rejection after replay tampering;
7. command-craft defeat and deterministic level escalation;
8. edge-triggered bomb semantics;
9. absence of ambient time, randomness, and browser storage from the core.
