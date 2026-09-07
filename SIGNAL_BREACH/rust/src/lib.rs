// SPDX-License-Identifier: Apache-2.0
//! Bounded arena sampling derived from the QSOL GALAXY browser sampler ABI.
//! The simulation stays in JavaScript; Rust supplies deterministic world data.
use std::cell::RefCell;

const STRIDE: usize = 8;
const MAX_RENDERED: usize = 512;

thread_local! {
    static SAMPLE: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
}

pub fn hash32(mut value: u32) -> u32 {
    value ^= value >> 16;
    value = value.wrapping_mul(0x7feb352d);
    value ^= value >> 15;
    value = value.wrapping_mul(0x846ca68b);
    value ^ (value >> 16)
}

pub fn sample_value(id: u32, seed: u32, lane: usize) -> f32 {
    (hash32(id ^ seed ^ (lane as u32 + 1).wrapping_mul(0x9e3779b9)) >> 8) as f32 / 16_777_216.0
}

#[no_mangle]
pub extern "C" fn abi_version() -> u32 { 2 }

#[no_mangle]
pub extern "C" fn max_rendered() -> u32 { MAX_RENDERED as u32 }

#[no_mangle]
pub extern "C" fn generate(logical: f64, count: u32, seed: u32) -> u32 {
    let valid = logical.is_finite() && logical.fract() == 0.0 && logical >= count as f64 && logical <= u32::MAX as f64 + 1.0;
    SAMPLE.with(|sample| {
        let mut buffer = sample.borrow_mut(); buffer.clear();
        if !valid || count == 0 || count as usize > MAX_RENDERED { return 0; }
        buffer.reserve(count as usize * STRIDE);
        for index in 0..count as usize {
            let id = (index as f64 * logical / count as f64) as u32;
            for lane in 0..STRIDE { buffer.push(sample_value(id, seed, lane)); }
        }
        count
    })
}

#[no_mangle]
pub extern "C" fn buffer_ptr() -> *const f32 { SAMPLE.with(|sample| sample.borrow().as_ptr()) }

#[no_mangle]
pub extern "C" fn buffer_len() -> u32 { SAMPLE.with(|sample| sample.borrow().len() as u32) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deterministic_bounded_sample() {
        assert_eq!(generate(65_536.0, 96, 303), 96);
        assert_eq!(buffer_len(), 96 * 8);
        let first = sample_value(0, 303, 0);
        assert_eq!(first, sample_value(0, 303, 0));
        assert_ne!(first, sample_value(0, 304, 0));
        assert_eq!(generate(65_536.0, 513, 303), 0);
    }
}
