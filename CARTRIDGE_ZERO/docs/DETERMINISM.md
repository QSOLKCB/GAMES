# Determinism contract

CARTRIDGE ZERO separates canonical arcade state from browser presentation.
`core.js` is the contract surface. Canvas, CSS, animation frames, monitor refresh,
Web Audio, fullscreen state, touch event timing, and the color switch are not
canonical.

## Run identity

A run is identified by:

1. engine version `1`;
2. one of seven exact program IDs;
3. a normalized unsigned 32-bit signal seed;
4. a bounded difficulty identifier; and
5. an ordered sequence of seven-bit action words.

`step(state, inputWord)` advances exactly one logical 1/60-second tick. The core
uses integer coordinates with 16 subpixels per logical pixel. Direction vectors,
velocities, cooldowns, hit boxes, procedural river rows, formation decisions,
target selection, and AI steering are integer operations performed in fixed
order.

## Randomness and AI

The only random stream is an explicit xorshift32 word stored in canonical state.
Game initialization derives it from the normalized seed and program ID. Every
random draw occurs through that state. AI opponents use only canonical geometry,
cooldowns, ordered candidate lists, and this explicit stream.

The tank opponents choose a discrete direction by maximum dot product, rotate by
one direction quantum, test line of sight against canonical walls, and fire only
when alignment and cooldown conditions are met. The rival horizon battery chooses
the nearest ordered target, rotates toward its discrete aim, and fires under an
explicit cooldown. Neither observes pixels, frame timing, audio, or host state.

## Receipts

`CZ01` stores `[version, program, seed, difficulty, ticks, runs]` as ASCII JSON,
base64url-encodes it with the host's native standard codec, and prefixes an FNV-1a
corruption checksum. Decoding verifies the header, checksum, program identity,
metadata bounds, action mask, run lengths, tick total, and a worst-case-safe
two-hour size bound.

Terminal states still consume later ledger words into `previousActions`. Browser
playback therefore continues to receipt EOF before publishing its final canonical
digest.

The checksum and digest detect ordinary corruption and reproducibility drift.
They are not cryptographic signatures and do not authenticate an author.
