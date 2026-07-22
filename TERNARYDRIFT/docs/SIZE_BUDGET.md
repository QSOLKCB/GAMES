# Package-size discipline

Two byte limits are distinguished:

| Limit | Bytes | Meaning |
|---|---:|---|
| Internal release gate | 1,350,000 | CI fails above this value |
| 1.44 MB floppy capacity | 1,474,560 | Absolute distribution ceiling |

The checked payload currently consists only of `TERNARY.EXE` and `README.TXT`. Save and replay files are user-generated and are not part of the distributed package.

`tools/verify_size.py` sums exact filesystem byte counts, rejects a configured ceiling larger than a floppy, and exits non-zero above the internal limit. The GitHub workflow cross-compiles with MinGW-w64, strips the executable, enables section garbage collection, runs the checker, and uploads the measured package as a build artifact.

The source tree is not part of the contest payload. Documentation may therefore remain detailed without being confused with shipped bytes.
