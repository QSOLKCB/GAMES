# Game design

## Identity

PIXEL WARFRONT is an original industrial command simulation whose central idea is
reproducible real-time strategy. Its visual language uses charcoal terrain,
oxidised orange, bone, cobalt, sparse instrument typography, pixelated geometry,
and procedural effects. It does not reproduce any established game's factions,
fiction, silhouettes, buildings, maps, interface layout, dialogue, music, or art.

## Campaign loop

Each campaign begins from one seed and continues until the player's command node
is destroyed. A mission deploys two command grids, six finite flux fields, and a
seed-derived terrain pattern. The player expands an economy, maintains supply and
power, produces units, and destroys the hostile command node.

Victory awards a score and flux carryover, derives the next battlefield from the
same campaign seed and new mission number, and increases the enemy rank.

## Unit roles

| Unit | Operational role |
|---|---|
| Drone | Harvests flux, returns cargo, and enables construction placement |
| Ranger | Mobile ranged pressure and early combined-arms defence |
| Siege Crawler | Slow, durable, long-range anti-structure firepower |

## Command-grid structures

| Structure | Operational role |
|---|---|
| Command Node | Primary objective, drone/ranger producer, drop-off, power and supply source |
| Grid Relay | Expands both power and supply capacity |
| Flux Refinery | Additional resource drop-off point |
| Forge Array | Ranger and siege-crawler production |
| Arc Turret | Powered autonomous area defence |

## Enemy commander

The enemy uses the same authoritative unit and combat rules. It receives a fixed
rank-derived income, deterministically chooses reinforcement types, and periodically
orders every available combat unit toward the player's command node. Later missions
increase health, damage, income, initial force, reinforcement frequency, and attack
frequency while unlocking more siege crawlers and fixed defences.

## Combat feedback

The core emits transient position and health snapshots for fire, impact, damage,
completion, and destruction. The browser consumes those events to draw health
bars, flashes, projectile impacts, debris bursts, larger command-node explosions,
screen shake, and synthesized audio. These effects never write back to gameplay.

## Replay-first design

The game has no save-state system. A seed is a battlefield recipe, while a replay
is a sparse command history. Empty simulation ticks are implicit. Playback starts
from a fresh deployment and applies each canonical command at its recorded tick.
Victory transitions lock player command input until the replacement battlefield
is deployed, preventing resources from being spent on queues that are about to be
discarded. Produced units choose the spawn side facing the battlefield interior
and all unit centers are clamped by their collision radius.
