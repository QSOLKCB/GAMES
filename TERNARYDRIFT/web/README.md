# Ternary Drift — offline web edition

Open `index.html` directly in a modern desktop browser. The vendored Three.js runtime, simulation, visuals, and synthesized sound are local; the game performs no network requests and needs no server.

This edition preserves the native vertical slice's central systems—fixed-tick inertial flight, engine kill, three generated systems, markets, cargo, upgrades, contracts, faction state, combat, salvage, jump gates, and five adaptive qutrits—but uses an independent JavaScript fixed-point ruleset tuned for the larger 3D browser presentation. It does not claim replay or save compatibility with `TERNARY.EXE`.

## Controls

- Flight: `W` / `S` thrust and reverse; `A` / `D` strafe; arrow keys rotate; `Space` fires; `E` docks or tractors salvage; `J` uses a gate; `K` toggles flight assist.
- Docked: arrow keys select a commodity; `B` buys; `S` sells; `M` accepts a contract; `U` cycles upgrades; `R` repairs; `L` launches.

Run `npm test` to verify deterministic replay behavior and the direct-file offline boundary.
