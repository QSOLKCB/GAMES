# Design notes

## Turn structure

Orders are issued during a turn; `endTurn` then resolves, in order: AI planning,
movement (with interdiction at systems holding hostile armed ships or defended
colonies), combat, invasions and colonization, economy (income, research,
growth, defence regeneration, construction, repairs), visibility and victory.
Every step iterates in id order and draws randomness only from the seeded state
generator, so a seed, the data files and the orders fully determine the game.

## Economy

- Colonies produce minerals and energy (population plus mines or reactors, scaled
  by Industry), research (population plus labs) and construction capacity.
- Construction draws minerals from the empire stockpile as items progress.
- Energy pays upkeep for ships and facilities. It cannot go below zero; a
  shortfall halves research and construction until it is fixed.
- Blockaded colonies (hostile armed ships in orbit, none of yours) produce
  nothing and do not grow.

## Combat and capture

Battles run up to six rounds. Shields refresh every round; weapons fire on their
reload rhythm at random living enemies drawn from the seeded generator, and the
side that fires first rotates each round. Colony defences fight as one unit and
regenerate a fifth of their maximum per turn. When a colony's defences are at zero
and you control the space, troops land automatically if they exceed the garrison
(doubled for capitals). Captured colonies keep their founding species.

## AI

Each rival plans from its own explored systems and last-seen reports. It
researches by temperament, keeps recommended designs current, scouts the nearest
unexplored stars, settles the best known target (value against lane distance),
builds facilities to cover its needs, rallies warships to its capital, defends
threatened colonies and, after a temperament-specific grace period, besieges the
nearest enemy colony it can beat while troop barges join the siege.

## Interface

The galaxy is one WebGL canvas through the shared `QsolNative.Stage`. Star names
and fleet counts are DOM labels; panels are HTML. Hull art comes from INERTIA
ZERO's `skins.js`. Reduced-motion preferences stop pulsing and drifting.
