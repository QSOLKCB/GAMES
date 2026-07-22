# Vertical-slice architecture

The implementation is deliberately split across three translation units:

```text
td_game.c    authoritative fixed-step simulation, persistence images, replay
td_audio.c   deterministic tracker event compiler and procedural PCM synthesis
td_win32.c   window, input sampling, framebuffer presentation, waveOut, file I/O
```

`td_game.c` and `td_audio.c` depend only on C99 headers and are tested on the host. `td_win32.c` is the only platform layer. The shipping executable dynamically uses Windows system APIs already present on the target machine; no third-party DLL is distributed.

## Authoritative update

Each tick applies this order:

1. advance the tick counter and bounded market interval;
2. expire a contract if required;
3. apply docked commands or fixed-point flight input;
4. update deterministic raider steering and weapon cooldowns;
5. integrate projectiles and resolve hits, destruction, and salvage;
6. respawn the vertical-slice raider on its deterministic timer;
7. sample the five music qutrits every 15 simulation ticks;
8. retain the current input mask for edge detection.

The renderer and mixer never call a gameplay RNG or mutate the game state.

## Compact content strategy

- Ships, station modules, gates, shield rings, projectiles, salvage, stars, and UI are drawn from lines, circles, rectangles, and a 5×7 bitmap font.
- The logical palette is a small set of muted indexed-style ramps, expanded into the 32-bit DIB at draw time.
- Instruments are generated from single-cycle square, triangle and saw oscillators plus seeded noise.
- Tracker rows are compiled from compact rules and a per-system music genome; no recorded music asset exists.
- System names use two tiny syllable dictionaries.

This gives the vertical slice useful authored character without spending the package budget on image or audio containers.
