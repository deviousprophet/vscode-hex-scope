//! The Rust port of the primitive helpers in `src/core/parser/`.
//!
//! These adapters exist so `rust-anything record`/`diff` can compare the Rust core with the
//! TypeScript originals. The engine binary calls `hex-core` directly; the record-producing
//! parser exports stay in TypeScript because their `Uint8Array` payloads are not
//! round-trippable through the bridge's wire format.

#![forbid(unsafe_code)]

use serde_json::{Value, json};

/// Port of `isValidBinBaseAddress` (`src/core/parser/binImage.ts:22`).
pub fn is_valid_bin_base_address(value: Value) -> Result<bool, String> {
    if let Some(marker) = value.get("$num").and_then(Value::as_str) {
        return Ok(marker == "-0");
    }
    let number = match value.as_f64() {
        Some(number) => number,
        None => return Ok(false),
    };
    Ok(hex_core::bin::is_valid_base_address(number))
}

/// Port of `binAddressRangeFits` (`src/core/parser/binImage.ts:30`).
pub fn bin_address_range_fits(base_address: f64, byte_length: f64) -> Result<bool, String> {
    Ok(hex_core::bin::address_range_fits(base_address, byte_length))
}

/// Port of `parseBinBaseAddress` (`src/core/parser/binImage.ts:41`).
pub fn parse_bin_base_address(input: String, byte_length: f64) -> Result<Value, String> {
    match hex_core::bin::parse_base_address(&input, byte_length) {
        Ok(value) => Ok(json!({ "ok": true, "value": value })),
        Err(error) => Ok(json!({ "ok": false, "error": error })),
    }
}

/// Port of `validateBinBaseAddressInput` (`src/core/parser/binImage.ts:57`).
pub fn validate_bin_base_address_input(
    input: String,
    byte_length: f64,
) -> Result<Option<String>, String> {
    match hex_core::bin::parse_base_address(&input, byte_length) {
        Ok(_) => Ok(None),
        Err(error) => Ok(Some(error)),
    }
}

/// Port of `formatBinBaseAddress` (`src/core/parser/binImage.ts:63`).
pub fn format_bin_base_address(value: f64) -> Result<String, String> {
    Ok(hex_core::bin::format_base_address(value))
}

/// Port of `srecIsData` (`src/core/parser/srecParser.ts:25`).
pub fn srec_is_data(r#type: f64) -> Result<bool, String> {
    Ok(matches!(r#type, 1.0 | 2.0 | 3.0))
}
