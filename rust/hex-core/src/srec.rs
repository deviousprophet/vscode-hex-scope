//! Motorola SREC line parser, ported from `src/core/parser/srecParser.ts`.

use crate::model::{HexRecord, ParseResult, ScannedRecords};
use crate::records::{parse_source_records, scan_source_records};
use crate::segments::build_contiguous_segments;

pub fn address_size(record_type: u8) -> u8 {
    match record_type {
        0 => 2,
        1 => 2,
        2 => 3,
        3 => 4,
        5 => 2,
        6 => 3,
        7 => 4,
        8 => 3,
        9 => 2,
        _ => 2,
    }
}

pub fn srec_is_data(record_type: u8) -> bool {
    matches!(record_type, 1..=3)
}

/// `computeSRecChecksum` with JavaScript number semantics.
pub fn compute_srec_checksum(byte_count: f64, address: f64, address_size: f64, data: &[f64]) -> u8 {
    let mut sum = byte_count;
    let mut index = 0.0;
    while index < address_size {
        let shift = (address_size - 1.0 - index) * 8.0;
        sum += f64::from(crate::jsnum::shift_right_unsigned(address, shift) & 0xFF);
        index += 1.0;
    }
    for value in data {
        sum += value;
    }
    ((!crate::jsnum::to_int32(sum)) & 0xFF) as u8
}

fn parse_record_type(raw: &str, base: &HexRecord) -> Result<u8, HexRecord> {
    if !raw.starts_with('S') || crate::text::utf16_len(raw) < 4 {
        let mut record = base.clone();
        record.error = Some("Missing \"S\" start code or line too short".to_string());
        return Err(record);
    }
    let type_char = raw.chars().nth(1);
    let is_digit = type_char.is_some_and(|c| c.is_ascii_digit());
    if !is_digit {
        let mut record = base.clone();
        let shown = type_char.unwrap_or('\u{FFFD}');
        record.error = Some(format!("Invalid record type character: \"{shown}\""));
        return Err(record);
    }
    let record_type = type_char.unwrap().to_digit(10).unwrap_or(0) as u8;
    if record_type == 4 {
        let mut record = base.clone();
        record.record_type = record_type;
        record.error = Some("Reserved record type: S4".to_string());
        return Err(record);
    }
    Ok(record_type)
}

struct Layout {
    byte_count: u8,
    address_size: u8,
}

fn parse_layout(hex: &str, record_type: u8, base: &HexRecord) -> Result<Layout, HexRecord> {
    let byte_count = crate::hex::byte(hex.as_bytes(), 0);
    let size = address_size(record_type);
    let layout = Layout {
        byte_count,
        address_size: size,
    };

    if u16::from(layout.byte_count) < u16::from(layout.address_size) + 1 {
        let mut record = base.clone();
        record.record_type = record_type;
        record.byte_count = layout.byte_count;
        record.error = Some(format!(
            "Byte count {} too small for S{record_type} (minimum {})",
            layout.byte_count,
            layout.address_size + 1
        ));
        return Err(record);
    }
    if record_type >= 5 && layout.byte_count != layout.address_size + 1 {
        let mut record = base.clone();
        record.record_type = record_type;
        record.byte_count = layout.byte_count;
        record.error = Some(format!(
            "S{record_type} must have byte count {}, got {}",
            layout.address_size + 1,
            layout.byte_count
        ));
        return Err(record);
    }

    let expected_hex_len = 2 + usize::from(layout.byte_count) * 2;
    if hex.len() != expected_hex_len {
        let mut record = base.clone();
        record.record_type = record_type;
        record.byte_count = layout.byte_count;
        record.error = Some(format!(
            "Expected {expected_hex_len} hex chars, got {}",
            hex.len()
        ));
        return Err(record);
    }

    Ok(layout)
}

fn parse_address(hex: &str, size: u8) -> u32 {
    let bytes = hex.as_bytes();
    let mut address: u32 = 0;
    for index in 0..usize::from(size) {
        address = address
            .wrapping_mul(256)
            .wrapping_add(u32::from(crate::hex::byte(bytes, 2 + index * 2)));
    }
    address
}

fn parse_data(hex: &str, layout: &Layout) -> Vec<u8> {
    let offset = 2 + usize::from(layout.address_size) * 2;
    let len = i32::from(layout.byte_count) - i32::from(layout.address_size) - 1;
    let count = len.max(0) as usize;
    let bytes = hex.as_bytes();
    let mut data = Vec::with_capacity(count);
    for index in 0..count {
        data.push(crate::hex::byte(bytes, offset + index * 2));
    }
    data
}

pub(crate) fn checksum_for_bytes(
    byte_count: u8,
    address: u32,
    address_size: u8,
    data: &[u8],
) -> u8 {
    let mut sum = u32::from(byte_count);
    for index in 0..address_size {
        sum += (address >> ((address_size - 1 - index) * 8)) & 0xFF;
    }
    for value in data {
        sum += u32::from(*value);
    }
    (!sum & 0xFF) as u8
}

fn build_record(
    raw: &str,
    line_number: f64,
    record_type: u8,
    hex: &str,
    layout: &Layout,
) -> HexRecord {
    let address = parse_address(hex, layout.address_size);
    let data = parse_data(hex, layout);
    let checksum = crate::hex::byte(hex.as_bytes(), hex.len() - 2);
    let expected = checksum_for_bytes(layout.byte_count, address, layout.address_size, &data);

    HexRecord {
        line_number,
        raw: raw.to_string(),
        byte_count: layout.byte_count,
        address,
        record_type,
        data,
        checksum,
        checksum_valid: checksum == expected,
        resolved_address: if srec_is_data(record_type) {
            address
        } else {
            0
        },
        error: None,
    }
}

/// Parse one trimmed SREC line.
pub fn parse_srec_line(raw: &str, line_number: f64) -> HexRecord {
    let base = HexRecord::base(raw, line_number);
    let record_type = match parse_record_type(raw, &base) {
        Ok(record_type) => record_type,
        Err(record) => return record,
    };

    let hex = match raw.char_indices().nth(2) {
        Some((at, _)) => &raw[at..],
        None => "",
    };
    let is_hex = !hex.is_empty() && hex.bytes().all(|byte| byte.is_ascii_hexdigit());
    if !is_hex {
        let mut record = base.clone();
        record.record_type = record_type;
        record.error = Some("Non-hex characters in record".to_string());
        return record;
    }
    if hex.len() < 4 {
        let mut record = base.clone();
        record.record_type = record_type;
        record.error = Some("Record too short".to_string());
        return record;
    }

    match parse_layout(hex, record_type, &base) {
        Ok(layout) => build_record(raw, line_number, record_type, hex, &layout),
        Err(record) => record,
    }
}

/// Parse a whole SREC source, matching `parseSRec`.
pub fn parse_srec(source: &str) -> ParseResult {
    let mut start_address: Option<i64> = None;
    let parsed = parse_source_records(
        source,
        &|raw, line_number| parse_srec_line(raw, line_number),
        &mut |record| {
            if matches!(record.record_type, 7..=9) {
                start_address = Some(i64::from(record.address));
            }
        },
    );

    let segments = build_contiguous_segments(&parsed.records, |record: &HexRecord| {
        srec_is_data(record.record_type)
    });
    let total_data_bytes = segments
        .iter()
        .map(|segment| segment.data.len() as u64)
        .sum();

    ParseResult {
        records: parsed.records,
        segments,
        total_data_bytes,
        checksum_errors: parsed.checksum_errors,
        malformed_lines: parsed.malformed_lines,
        start_address: start_address.map(|value| value as f64),
    }
}

/// Parse a whole source in the async scanner's shape, for the compact engine path.
pub fn scan_srec(source: &str) -> ScannedRecords {
    let mut start_address: Option<i64> = None;
    let mut scanned = scan_source_records(
        source,
        &|raw, line_number| parse_srec_line(raw, line_number),
        &mut |record| {
            if matches!(record.record_type, 7..=9) {
                start_address = Some(i64::from(record.address));
            }
        },
    );
    scanned.start_address = start_address;
    scanned
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_s1_s2_and_s3_data_records() {
        let s1 = parse_srec_line("S107000001020304EE", 1.0);
        assert!(s1.error.is_none() && s1.checksum_valid);
        assert_eq!(
            (s1.address, s1.record_type, s1.data.as_slice()),
            (0, 1, &[1, 2, 3, 4][..])
        );

        let s2 = parse_srec_line("S2061000000102E6", 1.0);
        assert!(s2.error.is_none() && s2.checksum_valid);
        assert_eq!((s2.address, s2.record_type), (0x10_0000, 2));

        let s3 = parse_srec_line("S3090800000001020304E4", 1.0);
        assert!(s3.error.is_none() && s3.checksum_valid);
        assert_eq!((s3.address, s3.record_type), (0x0800_0000, 3));
    }

    #[test]
    fn flags_a_bad_checksum_and_keeps_it_out_of_segments() {
        let record = parse_srec_line("S107000001020304EF", 1.0);
        assert!(record.error.is_none());
        assert!(!record.checksum_valid);
        let parsed = parse_srec("S107000001020304EF\nS9030000FC\n");
        assert_eq!(parsed.checksum_errors, 1);
        assert!(parsed.segments.is_empty());
    }

    #[test]
    fn rejects_reserved_types_and_bad_counts_with_the_original_messages() {
        assert_eq!(
            parse_srec_line("S4060000", 1.0).error.as_deref(),
            Some("Reserved record type: S4")
        );
        assert_eq!(
            parse_srec_line("S1020000", 1.0).error.as_deref(),
            Some("Byte count 2 too small for S1 (minimum 3)")
        );
        assert_eq!(
            parse_srec_line("S1070000010203", 1.0).error.as_deref(),
            Some("Expected 16 hex chars, got 12")
        );
        assert_eq!(
            parse_srec_line("S", 1.0).error.as_deref(),
            Some("Missing \"S\" start code or line too short")
        );
    }

    #[test]
    fn start_address_comes_from_the_end_record() {
        let parsed = parse_srec("S107000001020304EE\nS9030030CC\n");
        assert_eq!(parsed.start_address, Some(0x30 as f64));
        assert_eq!(parsed.segments.len(), 1);
        assert_eq!(parsed.total_data_bytes, 4);
    }
}
