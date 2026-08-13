# CARTRIDGE ZERO operator manual

## Archive note

The following story is fictional.

In 1979, an unnamed engineering group allegedly prepared one final domestic
signal cartridge: seven small games sharing a diagnostic replay bus. A production
fire destroyed the release inventory, and the only engineering cartridge was
said to have disappeared into a broadcaster's equipment store. Its label read
only **CARTRIDGE ZERO — SEVEN SIGNALS**.

This browser work imagines what that impossible cartridge might have felt like.
It is an original modern implementation, not recovered software, a ROM dump, an
emulator, or a reconstruction of a historical product.

## Console switches

- **Game Select** returns to the seven-program directory.
- **Reset** restarts the selected program with the same canonical identity.
- **Pause** freezes the logical clock between ticks.
- **Color / B/W** changes presentation only.
- **Sound** enables synthesized browser audio; it never changes gameplay.
- **Receipt** exports or loads a canonical `CZ01` input ledger.

Difficulty **Switch B** supplies a forgiving contract, **Switch A** supplies the
standard arcade contract, and **Nightmare** accelerates or strengthens pressure
according to each program's rules.

## Program 01 — Prism Break

Move left and right. Fire serves the pulse. Clear all six spectral bands without
letting the pulse fall beneath the paddle. Reinforced cells appear in later
levels. Paddle impact position changes the rebound angle.

## Program 02 — Gridburn

Move left and right across seven lanes. Up and down move between four depth rows.
Fire along the occupied lane. Carriers descend, change lanes, and emit hostile
pulses. Every eighteen destroyed carriers raises the signal level.

## Program 03 — Orbital Siege

Move along the moonline and fire upward. The formation marches laterally until an
edge contact makes it reverse and descend. Prevent any member reaching the
moonline. Higher rows and reinforced later-wave targets score more.

## Program 04 — Star Talon

Move and fire beneath the formation. Talons periodically detach, steer toward the
player, and fire during a dive. A diving talon scores more than one destroyed
inside formation. Clear the flock to call a faster one.

## Program 05 — Rift Runner

Steer inside the generated river. Up and down alter throttle; fire clears skiffs
and towers. Collect fuel lattices, avoid the banks, and survive hostile river
fire. Distance continuously raises score and eventually raises the level.

## Program 06 — Iron Circuit

Left and right rotate the tank. Up and down drive forward and reverse. Fire sends
one shell along the current direction. Autonomous armour navigates the same wall
contract, aims in sixteen deterministic directions, checks line of sight, and
fires under explicit cooldown. Destroy every opponent to begin a denser round.

## Program 07 — Skywater Command

Left and right rotate the western battery; fire launches a straight shell. The
eastern battery is an autonomous rival competing for the same gliders, rotors,
skimmers, and submerged targets. When seventy-five seconds expire, the higher
score owns the horizon.

## Ledger use

A receipt records program identity, seed, difficulty, and exact input runs. Paste
one into the Receipt panel and choose **Watch receipt**. Playback ignores live
controls and consumes every stored tick. Matching final state digests establish
reproduction under the same engine version.
