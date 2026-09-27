# Native gameplay rendering migration

The previous stage added an independent translucent WebGL canvas while each game
continued to draw its complete playable world with Canvas 2D. That architecture
has been removed. `shared/qsol-three-stage.js` and its blending CSS are retired.

Every migrated title now constructs its own renderer adapter, backed by
`QsolNative.Stage`: one `THREE.WebGLRenderer` bound to the **existing** game canvas,
one `THREE.Scene`, and a real camera. The simulation's scheduler calls the adapter
after its existing fixed-step updates. The adapter reads state and uploads instance
transforms, colors and counts; it never calls the simulation RNG or changes state.
All six `core.js` files remain unchanged.

## Per-game audit and resulting scene

| Game | Simulation | Primary gameplay renderer | Camera | Native Three.js entities | Legacy Canvas gameplay renderer |
|---|---|---|---|---|---|
| BLACKSTAR_AGA | Existing fixed-point campaign and input receipts | Three.js/WebGL | Perspective FPS | Collision-grid rooms, doors, ceiling ribs, faceted opposition, pickups, exit console, camera-relative weapon, muzzle effects | No |
| CARTRIDGE_ZERO | All seven existing canonical programs and CZ01 receipts | Three.js/WebGL | Orthographic with cabinet projection | Bricks, paddle, ball; lanes and ships; formations and diving craft; river banks, fuel and towers; walls, tanks and shells; aircraft, boats, subs and turrets | No |
| PIXELWARFRONT | Existing fixed-tick RTS and command receipts | Three.js/WebGL | Orthographic with cabinet projection | Terrain, resources, HQ, relays, refinery tanks, factories, turrets, drones, rangers, crawlers, bullets, health/construction bars, selection and order indicators | No |
| VECTOR_ZERO | Existing fixed-point 6DOF mines and VZ02 receipts | Three.js/WebGL | Perspective, oriented by simulation basis | BufferGeometry mine surfaces, LineSegments seams, faceted and wireframe enemies, cores, supplies, projectiles, exit rings and cockpit geometry | No |
| SEEDSTORM | Existing fixed-tick shooter and input receipts | Three.js/WebGL | Orthographic | Extruded strike craft and six enemy silhouettes, bullets, pickups, focus and invulnerability rings, boss/health bars, bomb wave, impacts and industrial canyon strata | No |
| SUBSPACE / INERTIA ZERO | Existing 60 Hz inertial combat and campaign logic | Three.js/WebGL | Following orthographic | Eight extruded hulls, asteroids, crystals, fortifications, projectiles, pickups, objectives, shields, engine trails, explosion waves and offscreen threats | No |

BLACKSTAR's old `raycast`, column drawing, sprite painter and software z-buffer
are gone. Its fixed-point map, blocking-cell rules, enemy AI and hitscan remain
in the core. VECTOR retains surface extraction and diagnostic projection helpers;
its Canvas near-plane clipping and painter's algorithm are gone. Three.js performs
clipping and depth testing on the actual mine geometry.

CARTRIDGE's seven `draw*` pipelines are replaced individually. GRIDBURN retains its
lane/depth mapping, RIFT RUNNER interpolates the canonical river rows, IRON CIRCUIT
uses DIR16 for turret direction, and SKYWATER retains both player and AI turrets.
Each mode has its own scene inventory and palette, including monochrome mode.

PIXELWARFRONT's resources, buildings, units, selection box and order paths now live
in GPU batches. Its ground-plane projection remains identical to simulation/input
coordinates; a cabinet projection reveals elevated surfaces. SEEDSTORM keeps its
original craft outlines as extruded geometry with faceted cores and separate combat
and terrain depths. SUBSPACE retains fixed-step interpolation and cloak visibility
rules, renders its eight original silhouettes as geometry, and keeps SVG radar as
an auxiliary tactical display.

## UI boundary

Menus, receipts, scoring panels and conventional text HUDs remain HTML. BLACKSTAR
and VECTOR automaps and SUBSPACE radar are SVG UI. World-space health bars,
selection rings, projectile trails, focus rings, objective geometry and other
in-world indicators are WebGL objects. **There is no remaining 2D-canvas use**, not
even texture generation, in these six titles. No CanvasTexture or image of the old
game renderer is used. The local Three.js distribution is still bundled for offline
classic-script loading; these games no longer load the unused Wasm overlay sampler.

## Performance and lifecycle

Repeated primitives are `InstancedMesh` batches keyed by semantic category, shape
and material. Buffers double only when a population first exceeds capacity; normal
frames update transforms/colors/counts in place. Empty populations have zero draw
count, so removed entities cannot leave stale meshes. Shapes and materials are
shared. VECTOR rebuilds its static mine surface and edge geometry only when the
blueprint signature changes and disposes the replaced resources.

The renderer uses the CSS canvas bounds, caps device pixel ratio at 2, and keeps
logical simulation dimensions independent of its drawing buffer. Reduced-motion
changes are observed live: decorative rotation, scrolling and exhaust/spark motion
are reduced without freezing gameplay. Context loss is reported in the HUD and
restoration resumes rendering from current state. Non-persisted pagehide disposes
renderer, geometries, instance resources, materials and listeners; bfcache preserves
the live instance. Explicit disposal is idempotent.

## Verification

- `node tests/native-renderers.static.js`: walks each entrypoint's local script
  dependencies, rejects context acquisition/CanvasTexture/OffscreenCanvas outside
  the vendored renderer, and checks the one-canvas native adapter boundary.
- `node tests/native-renderers.browser.js`: real Chromium/WebGL; throws on every
  2D-context request, checks renderer/scene/camera object types, scene populations,
  finite instance data, canonical-state-to-instance positions and nonblank GPU
  pixels. Hiding all gameplay groups must remove substantial framebuffer content.
  Tests resizing, live motion preference changes, context loss/recovery, repeated
  scene synchronization without geometry growth/state mutation, and disposal.
- Existing per-game core, offline and browser smoke suites cover controls, combat,
  all seven cartridge modes, pause/restart, receipts, RTS selection/commands and
  mobile layouts. SUBSPACE's DOM-only harness is explicitly simulation-only.
- Browser tests accept `GAMES_CHROMIUM` for an installed Chromium executable and
  `GAMES_TEST_ORIGIN` for an isolated HTTP test server. Without the latter they
  exercise direct-file startup. Neither setting changes production code.

Development example (Playwright is a development-only dependency):

```sh
npm --prefix BLACKSTAR_AGA ci
npx --prefix BLACKSTAR_AGA playwright install chromium
NODE_PATH=./BLACKSTAR_AGA/node_modules node tests/native-renderers.browser.js
```

The `Native Three.js gameplay` workflow runs the static and real-WebGL gates and
retains screenshots as build artifacts. See the PR for the exact executed results.

## Removal gate

For **each of the six titles**, removing the sole Three.js canvas removes the
rendered gameplay world: player, opposition, projectiles and world geometry.
Only conventional interface elements remain. There is no complete playable visual
scene underneath or above WebGL.

## Audited source boundaries

| Title | State read by presentation | Replaced routines | UI retained |
|---|---|---|---|
| BLACKSTAR_AGA | `player`, `blueprint`, doors via `isBlockingCell`, `enemies`, `pickups`, `events` | `drawWorld`, `drawEnemySprite`, `drawEntities`, `drawWeapon`, software HUD/map | DOM controls, receipts and telemetry; DOM vital/ammo HUD and SVG map |
| CARTRIDGE_ZERO | `gameId`, `game` with each program's bricks/ball/lanes/rows/entities/tanks/targets/shots | `drawPrism`, `drawGridburn`, `drawOrbital`, `drawTalon`, `drawRiver`, `drawCircuit`, `drawSkywater` | Existing console UI, color switch, receipts; text-only in-game status |
| PIXELWARFRONT | `blueprint.terrain`, `resources`, `buildings`, `units`, `projectiles`; selected IDs and visual effects | `drawBackground`, `drawResource`, `drawBuilding`, `drawUnit`, `drawProjectile`, selection/order/effect painters | Existing selection/production/mission UI and receipts |
| VECTOR_ZERO | `blueprint.cells/exit`, `player` basis, `enemies`, `pickups`, `projectiles` | `faceDrawable`, `drawFace`, `drawEnemy`, `drawPickup`, `drawProjectile`, cockpit painter | DOM cockpit vitals and target notice; SVG layer map; existing controls/receipts |
| SEEDSTORM | `player`, `enemies`, `playerBullets`, `enemyBullets`, `pickups`, `bombPulse`; hit/effect records | `drawBackground`, `drawPlayer`, `drawEnemy`, `drawEntities`, impact/explosion and world-HUD painters | Existing score/lives/bombs/sector panels and receipts |
| SUBSPACE | `arena`, `ships`, `projectiles`, `pickups`, `particles`, `objectiveState`, interpolated positions | Canvas `render`, all world `draw*` methods, software radar | Existing HTML HUD, menu, help, score storage and audio; SVG radar |

Input packing, collision, AI, scores, progression, audio scheduling, replay
recording/draining, and SUBSPACE's save/high-score code remain simulation/UI work.
Only presentation and its explicitly identified test boundary are replaced.
