# Design notes

## Anthology rather than launcher

CARTRIDGE ZERO is one console with seven programs, not seven unrelated pages.
Selection, difficulty switches, controls, telemetry, receipts, pause behavior,
audio policy, mobile input, and rendering resolution are shared. Each program
still owns a distinct canonical state object and step function.

The 160×192 logical display is stretched by CSS to evoke period home-video pixel
proportions. That stretch is presentation-only. The core never reads pixels.

## Original program identities

- **Prism Break** is about spectral bands, seeded reinforced cells, and rebound
  control.
- **Gridburn** uses seven perspective lanes plus player depth, carrier classes,
  hostile pulses, and an endless kill-rank contract.
- **Orbital Siege** uses synchronized lateral marching, boundary descent, and a
  defended moonline.
- **Star Talon** uses a breathing formation whose members autonomously detach,
  steer, fire, and return.
- **Rift Runner** couples procedurally generated river geometry to throttle,
  distance, fuel, hazards, banks, and river fire.
- **Iron Circuit** is a walled tank arena with discrete steering, line-of-sight
  AI, collision, projectiles, and escalating multi-opponent rounds.
- **Skywater Command** is a timed score contest between two batteries over four
  target classes at different altitudes and durability levels.

No historical screen, formation, map, sprite, sound, score table, packaging
layout, or title is reproduced.

## Presentation

The fictional CZ-77 console uses charcoal plastic, worn cream labeling, amber,
rust, and restrained teal. The cartridge label changes with program selection,
while the case and switches remain stable. There are no external fonts, images,
audio files, or network resources.

The recovery fiction is explicitly labeled fictional in the manual and notice.
It creates atmosphere without making a false archival claim.
