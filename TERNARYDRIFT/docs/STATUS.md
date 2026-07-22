# Implementation status

This ledger separates code that exists from the broader design target.

| Area | Implemented now | Deferred target |
|---|---|---|
| Platform | Native Win32 window, software DIB framebuffer, keyboard input, `waveOut` PCM | Controller support, configuration UI, broader Windows testing |
| Simulation | 60 fixed ticks/s, Q16.16 flight, bounded catch-up, logical hash | Full replay compatibility across schema versions |
| Universe | 3 deterministic systems, stations, sequential gates | 12-system connected graph, planets, belts, wrecks, anomalies |
| Flight | Thrust, reverse, strafe, rotation, damping, engine kill, cruise | Mouse aim, target cycling, secondary weapons |
| Combat | Pulse cannon, projectiles, shield/hull damage, deterministic raider AI | Seven additional weapons, subsystem damage, coordinated AI roles |
| Economy | 4 goods, inventory response, production ticks, buy/sell | 10 goods, physical convoys, piracy-driven shortages, contraband inspections |
| Missions | Delivery and bounty | Escort, intercept, defend, mine, salvage, smuggle, scout |
| Factions | 5 reputation registers and basic kill/contract changes | Relationship-matrix propagation and systemic territorial conflict |
| Ships | One player courier and one raider archetype | 8 player hulls and visible equipment geometry |
| Progression | Engine, cannon, shield/cargo upgrades; repair | Equipment inventory, shipyard, subsystem fitting |
| Salvage | Deterministic commodity drops and tractor pickup | Wreck tables, equipment salvage, dedicated contracts |
| Music | 4 procedural tracker channels, row compiler, qutrit adaptation | 8-channel mixer, packed authored fragments, external pattern tools |
| Tracker effects | `0xy`, `1xx`, `2xx`, `3xx`, `4xy`, `Axy`, `Cxx`, `Fxx` engine paths | `Bxx` and `Dxx` control flow; packed pattern file parser |
| Save/replay | Same-build save image, input-transition replay, checksum and final hash | Stable packed formats and migration tooling |
| Packaging | Self-contained EXE plus text README; 1,350,000-byte CI gate | Optional `TERNARY.DAT` only when it saves total bytes |

No item in the deferred column should be inferred from the executable or advertised as complete.
