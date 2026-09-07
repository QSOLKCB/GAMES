# GALAXY Rust/WebAssembly sampler

This directory vendors the bounded Rust/Wasm browser sampler from
`QSOLKCB/GALAXY` commit `408caec95a03e771a82c35e67a6c8b65e6bfdfa5`.
Its classic-script base64 package works from `file://` without `fetch` and is
used only for deterministic presentation/arena samples. Every consumer has a
JavaScript fallback, so WebAssembly support is an enhancement rather than a boot
requirement.

- `galaxy_sampler.wasm` — unmodified compiled module from GALAXY.
- `galaxy-wasm.js` — unmodified classic-script base64 package from GALAXY.
- `LICENSE` / `NOTICE.md` — upstream Apache-2.0 license and notice.

SHA-256: `8bb7b4504ba7ac423136ae455eeb8400f2d703f574b3ca263ec61d76e9c654da`
for the `.wasm` object and
`92a8e79705f9b12c2aaa9578efdce61c35a05b8b24bb7f0929115d4c50687177`
for the classic-script package.

`SIGNAL_BREACH/rust/` contains the smaller ABI-compatible source used when
rebuilding this shared sampler specifically for the games repository.
