// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "rust/target/wasm32-unknown-unknown/release/signal_breach_sampler.wasm");
const bytes = fs.readFileSync(source);
const output = path.resolve(root, "../vendor/galaxy-sampler");
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(source, path.join(output, "galaxy_sampler.wasm"));
fs.writeFileSync(path.join(output, "galaxy-wasm.js"),
  "// SPDX-License-Identifier: Apache-2.0\n// Generated from rust/src/lib.rs. Do not edit.\n" +
  "globalThis.GALAXY_WASM_BASE64 = " + JSON.stringify(bytes.toString("base64")) + ";\n");
console.log(`Packaged ${bytes.length} bytes of Rust WebAssembly.`);
