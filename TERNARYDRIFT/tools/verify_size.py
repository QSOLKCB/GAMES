#!/usr/bin/env python3
"""Fail when the Ternary Drift distribution exceeds its internal byte budget."""

from __future__ import annotations

import argparse
from pathlib import Path

FLOPPY_LIMIT = 1_474_560
INTERNAL_LIMIT = 1_350_000


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--limit", type=int, default=INTERNAL_LIMIT)
    args = parser.parse_args()

    missing = [path for path in args.files if not path.is_file()]
    if missing:
        for path in missing:
            print(f"missing: {path}")
        return 2

    sizes = [(path, path.stat().st_size) for path in args.files]
    total = sum(size for _, size in sizes)
    for path, size in sizes:
        print(f"{size:9d}  {path}")
    print(f"{total:9d}  total")
    print(f"{args.limit:9d}  enforced internal limit")
    print(f"{FLOPPY_LIMIT:9d}  1.44 MB floppy capacity")
    if args.limit > FLOPPY_LIMIT:
        print("error: configured limit exceeds floppy capacity")
        return 2
    if total > args.limit:
        print(f"error: package exceeds the enforced limit by {total - args.limit} bytes")
        return 1
    print(f"ok: {args.limit - total} bytes of internal headroom")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
