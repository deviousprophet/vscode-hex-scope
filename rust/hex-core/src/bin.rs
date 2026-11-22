//! Raw-binary image helpers, ported from `src/core/parser/binImage.ts`.

use crate::jsnum::{is_integer, number_to_string, to_uint32};
use crate::model::{CompactResult, Segment};
use crate::text::js_trim;

pub const DEFAULT_BIN_BASE_ADDRESS: u32 = 0;
const MAX_ADDRESS: f64 = 4_294_967_295.0;
const ADDRESS_SPACE: f64 = 4_294_967_296.0;

/// True for a 32-bit unsigned integer address (0 .. 0xFFFFFFFF).
pub fn is_valid_base_address(value: f64) -> bool {
    is_integer(value) && (0.0..=MAX_ADDRESS).contains(&value)
}

/// True when `[base, base + length)` stays inside the 32-bit address space.
pub fn address_range_fits(base_address: f64, byte_length: f64) -> bool {
    if !is_valid_base_address(base_address) {
        return false;
    }
    if !is_integer(byte_length) || byte_length < 0.0 {
        return false;
    }
    base_address + byte_length <= ADDRESS_SPACE
}

/// True for 1-8 hex digits with an optional `0x` / `0X` prefix.
fn is_hex_address_text(text: &str) -> bool {
    let digits = text
        .strip_prefix("0x")
        .or_else(|| text.strip_prefix("0X"))
        .unwrap_or(text);
    (1..=8).contains(&digits.len()) && digits.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Parse the base-address prompt text.
pub fn parse_base_address(input: &str, byte_length: f64) -> Result<u32, String> {
    let text = js_trim(input);
    if text.is_empty() {
        return Err("Enter a base address.".to_string());
    }
    if !is_hex_address_text(text) {
        return Err("Use hexadecimal digits only (0x00000000–0xFFFFFFFF).".to_string());
    }
    let digits = text
        .strip_prefix("0x")
        .or_else(|| text.strip_prefix("0X"))
        .unwrap_or(text);
    let value = u32::from_str_radix(digits, 16)
        .map_err(|_| "Use hexadecimal digits only (0x00000000–0xFFFFFFFF).".to_string())?;
    if !address_range_fits(f64::from(value), byte_length) {
        return Err(format!(
            "{} + {} bytes exceeds the 32-bit address space.",
            format_base_address(f64::from(value)),
            number_to_string(byte_length)
        ));
    }
    Ok(value)
}

/// Display/prefill form: `0x` plus eight uppercase hex digits.
pub fn format_base_address(value: f64) -> String {
    format!("0x{:08X}", to_uint32(value))
}

/// Whole raw image as one contiguous segment anchored at `base_address`.
pub fn parse_bin(bytes: &[u8], base_address: u32) -> CompactResult {
    let segments = if bytes.is_empty() {
        Vec::new()
    } else {
        vec![Segment {
            start_address: base_address,
            data: bytes.to_vec(),
        }]
    };
    CompactResult {
        pages: Vec::new(),
        segments,
        total_data_bytes: bytes.len() as u64,
        checksum_errors: 0,
        malformed_lines: 0,
        start_address: None,
        base_address: Some(base_address),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_formats_addresses() {
        assert_eq!(format_base_address(0.0), "0x00000000");
        assert_eq!(format_base_address(0xDEAD_BEEF_u32 as f64), "0xDEADBEEF");
        assert_eq!(format_base_address(-1.0), "0xFFFFFFFF");
        assert_eq!(parse_base_address("0x1000", 16.0), Ok(0x1000));
        assert_eq!(parse_base_address("1000", 16.0), Ok(0x1000));
        assert!(parse_base_address("0x", 16.0).is_err());
        assert!(parse_base_address("xyz", 16.0).is_err());
        assert!(parse_base_address("0xFFFFFFF0", 32.0).is_err());
    }

    #[test]
    fn whole_image_is_one_segment() {
        let result = parse_bin(&[1, 2, 3], 0x100);
        assert_eq!(result.segments.len(), 1);
        assert_eq!(result.segments[0].start_address, 0x100);
        assert_eq!(result.total_data_bytes, 3);
        assert_eq!(result.base_address, Some(0x100));
    }
}
