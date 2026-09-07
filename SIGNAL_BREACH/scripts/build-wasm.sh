#!/usr/bin/env sh
set -eu
cargo build --manifest-path rust/Cargo.toml --release --target wasm32-unknown-unknown
node scripts/package-wasm.mjs
