# Early file formats

The formats are deliberately versioned but not yet declared stable.

## `TERNARY.SAV`

The save contains:

```text
magic:       TDS1
version:     1
game size:   sizeof the current TdGame schema
checksum:    header/state-hash check
state hash:  logical deterministic hash
game image:  current native schema
```

Loading requires matching magic, version, game-structure size, checksum, and a recomputed logical state hash. It therefore rejects truncation, cross-version layout mismatches, and state corruption detectable by the hash. It is intentionally a same-build format in this vertical slice.

## `TERNARY.RPL`

The replay contains:

```text
magic and version
universe seed
initial logical state hash
final logical state hash and tick
event count and checksum
event[event_count] = { tick_delta, input_mask }
```

Only changes in the input mask are recorded. Runtime playback cursors are not written. This keeps an ordinary run to a few kilobytes and allows the executable to regenerate all world state from the seed.

## Future packed data

There is no `TERNARY.DAT` in the vertical slice because all current content is smaller when linked and dead-stripped with the code. A future archive may contain packed authored tracker fragments, geometry deltas, font/palette tables, and text tokens. It will be added only after measuring that its table and decoder reduce the complete package size.
