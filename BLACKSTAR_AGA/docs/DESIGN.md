# Design dossier

## Fictional recovery frame

BLACKSTAR AGA presents itself as Disk Four of an ambitious 1996 Amiga AGA game:
the final Amiga release, duplicated in a tiny mail-order run and then lost. That
fiction gives the interface its restoration-lab language, boot monitor, stamped
telemetry, compact campaign, and constraints. The project does not claim that a
historical disk was actually recovered.

## Visual contract

- internal framebuffer: 320×200;
- nearest-neighbour enlargement and deliberately chunky silhouettes;
- restrained copper, oxide, phosphor, ice and reactor palettes;
- procedural wall striping, hostile sprites, pickups, weapon views and effects;
- CRT scanline/glass treatment in CSS, outside the game framebuffer;
- no remote images, typefaces, textures, or shaders.

## Engine shape

The renderer is an original stepped raycaster over fixed-cell maps. Moving doors,
locked amber-cipher doors, hidden sectors, enemies and pickups add sector-shooter
flavour while keeping collision and visibility deterministic. Enemies activate on
line of sight or weapon noise, move through the same collision grid as the player,
and attack through explicit deterministic cooldowns.

## Amiga-inspired audio

All sound is opt-in and synthesized at runtime. Short square/saw oscillators,
seeded noise bursts, abrupt envelopes and a quiet machine hum suggest tracker and
Paula-era economy. Audio never feeds back into gameplay state.

## Scope

The vertical slice is a complete three-mission mini-campaign rather than a claim
to reproduce a historical platform build. Browser-native presentation enables the
fiction to be played and audited from local files while the source remains small,
offline, inspectable, and portable.
