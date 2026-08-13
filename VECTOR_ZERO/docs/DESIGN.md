# Design dossier

## Identity

VECTOR ZERO is framed as a recovered null-space flight prototype whose navigation
computer treats a mine as a sequence of reproducible vector states. The fiction
supports a restrained industrial cockpit, amber/cyan instrumentation, software
polygon display, terse telemetry, and canonical flight receipts.

## Flight model

The craft has six independently usable degrees of freedom:

- forward/reverse, strafe, and rise/fall translation;
- yaw, pitch, and roll rotation;
- damped inertia rather than grid stepping; and
- boost that spends the shared energy reserve.

The compact chambers reward orientation, controlled velocity, strafing fire, and
vertical route reading without requiring a physically simulated spacecraft.

## Mine and combat shape

Each mine is a connected 3D cell complex. Exposed cell boundaries become polygon
faces; adjacent cells form open tunnels. The software renderer transforms them
through the integer flight basis, clips polygons against the near plane, projects
to the 480×270 framebuffer, and draws far-to-near.

Enemies, pickups, projectiles, and the zero gate use original code-native vector
silhouettes. Autonomous craft navigate the same collision volume, fire explicit
projectiles, and receive no hidden simulation access beyond canonical state.

## Scope and originality

The vertical slice is a complete three-mine arcade campaign. It draws inspiration
from the broad 6DOF mine-shooter genre while using original code, geometry,
balance, names, presentation, art, sound, levels, and fiction. It is not a port,
source-compatible engine, or historical asset recreation.
