# Restricted tracker and ternary music model

The audio path produces 22,050 Hz, 16-bit stereo PCM directly into four reusable `waveOut` buffers. Nothing is read from an audio file.

## Channels

| Channel | Voice | Role |
|---:|---|---|
| 1 | square | bass |
| 2 | triangle | harmony |
| 3 | seeded noise | percussion |
| 4 | saw | lead |

The source model uses tracker cells containing note, instrument, volume, effect, and parameter fields. Implemented effect paths are arpeggio (`0xy`), portamento up/down (`1xx`/`2xx`), tone portamento (`3xx`), vibrato (`4xy`), volume slide (`Axy`), set volume (`Cxx`), and speed/tempo (`Fxx`). Pattern jump and break identifiers are reserved in the enum but their control flow and the packed external pattern parser are deferred.

## Qutrit vector

The game projects five values, each clamped to `{0,1,2}`:

```text
navigation  docked/cruise, approach, danger
threat      safe, distant contact, nearby combat
economy     surplus, balanced, shortage
faction     friendly, neutral, hostile
hull        healthy, damaged, critical
```

The simulation samples these values every 15 ticks. The tracker accepts them as pending state and commits changes only on eight-row boundaries. This prevents buffer cadence or single-tick threshold changes from making the arrangement jitter.

Current mappings include:

- economy state → bass event interval and arpeggio density;
- threat state → percussion density, harmony tension, and lead activity;
- hull state → lead pitch-slide behaviour;
- system genome → root, scale, tempo, groove identity, instrument family, and motif hash.

Given the same seed, system genome, qutrit sequence, and rendered frame count, the tracker emits the same cell-event hash and PCM samples. Audio remains non-authoritative: muting it or changing buffer scheduling cannot alter gameplay.
