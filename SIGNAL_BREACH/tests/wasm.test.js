"use strict";
const assert = require("node:assert/strict");
const core = require("../core.js");
require("../../vendor/galaxy-sampler/galaxy-wasm.js");

(async () => {
  const seed = core.textSeed("RUST-PARITY"); const count = 96;
  const bytes = Buffer.from(globalThis.GALAXY_WASM_BASE64, "base64");
  const result = await WebAssembly.instantiate(bytes, {}); const wasm = result.instance.exports;
  assert.ok(wasm.abi_version() >= 2);
  assert.equal(wasm.generate(65536, count, seed), count);
  const actual = new Float32Array(wasm.memory.buffer, wasm.buffer_ptr(), wasm.buffer_len());
  const expected = core.fallbackSamples(seed, count);
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) assert.equal(actual[index], expected[index], `lane ${index} differs`);
  console.log(`SIGNAL BREACH Rust/Wasm parity OK / ${bytes.length} bytes`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
