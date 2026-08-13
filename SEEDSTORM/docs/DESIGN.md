# Game design

## Identity

SEEDSTORM is an original industrial airspace shooter built around reproducible
procedural challenge. Its visual language uses oxidised orange, bone, cobalt,
charcoal, vector silhouettes, instrument panels, and generated terrain geometry.
It does not reproduce the visual identity, fiction, ships, enemies, weapons,
stages, music, or assets of an existing franchise.

## Run structure

Each run begins from one seed and continues through procedural levels until the
player loses all lives. A sector consists of generated formations followed by one
command craft. Clearing it awards a lives-and-bombs bonus, increases rank, derives
a new level seed, and immediately constructs the next sector.

The player has three interacting resources:

- **Power** expands the forward weapon from one stream to five angled streams.
- **Bombs** clear hostile projectiles, grant brief invulnerability, and apply
  deterministic damage to all active enemies.
- **Chain** raises score value in 0.25 increments after each six kills, up to 5×;
  taking damage resets it.

The small player hit radius supports close navigation and deterministic grazing.
Focus mode slows movement and exposes a visual hit-area guide.

## Procedural grammar

The generator assembles each sector from five enemy roles:

| Role | Pressure |
|---|---|
| Scout | Fast descent and aimed single shots |
| Wing | Broad lateral sweep |
| Turret | Holds altitude and controls lanes |
| Bomber | Durable three-way projectile spread |
| Spinner | Rapid oscillation and paired angular shots |

Four formation grammars distribute those roles across seven lanes. The current
rank controls unlocked roles, maximum formation size, schedule density, movement,
health, projectile speed, firing interval, boss health, and simultaneous boss
patterns. Drops are assigned when the blueprint is generated, so destroying the
same enemy in two replays never rerolls its reward.

## Replay-first design

SEEDSTORM intentionally has no save-state feature. A seed is a world recipe; a
replay is a performance record. Exporting a replay serializes the control stream
only up to the current tick, so a verifier can watch the run develop from its
initial state and compare the terminal digest.

This makes challenge sharing compact: players can exchange a seed for a common
airspace or exchange a replay code for an exact flight through it.
