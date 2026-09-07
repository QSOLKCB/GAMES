(function installSignalBreachSampler(root) {
  "use strict";
  function decodeBase64(text) {
    const binary = atob(text); const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  async function load(seed, count) {
    const core = root.SignalBreachCore;
    const bounded = Math.max(32, Math.min(512, count || 96));
    const fallback = () => ({ samples: core.fallbackSamples(seed, bounded), runtime: "JAVASCRIPT FALLBACK" });
    try {
      if (!root.GALAXY_WASM_BASE64 || !root.WebAssembly) return fallback();
      const result = await WebAssembly.instantiate(decodeBase64(root.GALAXY_WASM_BASE64), {});
      const wasm = result.instance.exports;
      if (typeof wasm.generate !== "function" || wasm.abi_version() < 2) return fallback();
      const generated = wasm.generate(65536, bounded, seed >>> 0);
      if (generated !== bounded || wasm.buffer_len() !== bounded * 8) return fallback();
      const view = new Float32Array(wasm.memory.buffer, wasm.buffer_ptr(), wasm.buffer_len());
      return { samples: new Float32Array(view), runtime: "GALAXY RUST / WASM" };
    } catch (error) {
      return fallback();
    }
  }
  root.SignalBreachSampler = Object.freeze({ load });
})(typeof globalThis !== "undefined" ? globalThis : this);
