//! Intel HEX line parser and address-state machine, ported from
//! `src/core/parser/intelHexParser.ts`.

use crate::model::{HexRecord, ParseResult};
use crate::records::parse_source_records;
use crate::segments::build_contiguous_segments;

const RECORD_TYPE_NAMES: [(u8, &str); 6] = [
    (0x00, "Data"),
    (0x01, "End of File"),
    (0x02, "Ext Segment Addr"),
    (0x03, "Start Segment Addr"),
    (0x04, "Ext Linear Addr"),
    (0x05, "Start Linear Addr"),
];

fn record_type_name(record_type: u8) -> Option<&'static str> {
    RECORD_TYPE_NAMES
        .iter()
        .find(|(kind, _)| *kind == record_type)
        .map(|(_, name)| *name)
}

fn required_byte_count(record_type: u8) -> Option<u8> {
    match record_type {
        0x01 => Some(0),
        0x02 => Some(2),
        0x03 => Some(4),
        0x04 => Some(2),
        0x05 => Some(4),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AddressMode {
    Linear,
    Segment,
}

#[derive(Clone, Copy, Debug)]
pub struct IntelHexAddressState {
    pub upper_address: u32,
    pub address_mode: AddressMode,
    pub start_address: Option<i64>,
}

impl Default for IntelHexAddressState {
    fn default() -> Self {
        Self {
            upper_address: 0,
            address_mode: AddressMode::Linear,
            start_address: None,
        }
    }
}

impl IntelHexAddressState {
    /// Apply one error-free record to the addressing state.
    pub fn update(&mut self, record: &mut HexRecord) {
        match record.record_type {
            0x02 => {
                self.address_mode = AddressMode::Segment;
                self.upper_address = u32::from(record.data[0]) << 8 | u32::from(record.data[1]);
                self.upper_address <<= 4;
            }
            0x04 => {
                self.address_mode = AddressMode::Linear;
                self.upper_address = u32::from(record.data[0]) << 8 | u32::from(record.data[1]);
                self.upper_address <<= 16;
            }
            0x03 => {
                let base = (u32::from(record.data[0]) << 8 | u32::from(record.data[1])) << 4;
                let offset = u32::from(record.data[2]) << 8 | u32::from(record.data[3]);
                self.start_address = Some(i64::from(base + offset));
            }
            0x05 => {
                let raw = u32::from(record.data[0]) << 24
                    | u32::from(record.data[1]) << 16
                    | u32::from(record.data[2]) << 8
                    | u32::from(record.data[3]);
                self.start_address = Some(i64::from(raw as i32));
            }
            0x00 => {
                record.resolved_address = match self.address_mode {
                    AddressMode::Linear => self.upper_address.wrapping_add(record.address),
                    AddressMode::Segment => {
                        self.upper_address.wrapping_add(record.address) & 0xFFFFF
                    }
                };
            }
            _ => {}
        }
    }
}

struct IntelHexFields {
    byte_count: u8,
    address: u32,
    record_type: u8,
    data: Vec<u8>,
    checksum: u8,
    checksum_valid: bool,
}

fn hex_nibble(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        _ => byte - b'A' + 10,
    }
}

fn hex_byte(hex: &[u8], at: usize) -> u8 {
    (hex_nibble(hex[at]) << 4) | hex_nibble(hex[at + 1])
}

fn parse_payload(raw: &str, base: &HexRecord) -> Result<String, HexRecord> {
    if !raw.starts_with(':') {
        let mut record = base.clone();
        record.error = Some("Missing start code \":\"".to_string());
        return Err(record);
    }

    let hex = &raw[1..];
    let is_hex = !hex.is_empty() && hex.bytes().all(|b| b.is_ascii_hexdigit());
    if !is_hex {
        let mut record = base.clone();
        record.error = Some("Non-hex characters in record".to_string());
        return Err(record);
    }
    if hex.len() < 10 {
        let mut record = base.clone();
        record.error = Some("Record too short".to_string());
        return Err(record);
    }

    let byte_count = hex_byte(hex.as_bytes(), 0);
    let expected_length = 10 + usize::from(byte_count) * 2;
    if hex.len() != expected_length {
        let mut record = base.clone();
        record.error = Some(format!(
            "Expected {expected_length} hex chars, got {}",
            hex.len()
        ));
        return Err(record);
    }
    Ok(hex.to_string())
}

fn compute_checksum(byte_count: u8, address: u32, record_type: u8, data: &[u8]) -> u8 {
    let mut sum =
        u32::from(byte_count) + ((address >> 8) & 0xFF) + (address & 0xFF) + u32::from(record_type);
    for byte in data {
        sum += u32::from(*byte);
    }
    ((!sum).wrapping_add(1) & 0xFF) as u8
}

fn parse_fields(hex: &str) -> IntelHexFields {
    let bytes = hex.as_bytes();
    let byte_count = hex_byte(bytes, 0);
    let address = u32::from(hex_byte(bytes, 2)) << 8 | u32::from(hex_byte(bytes, 4));
    let record_type = hex_byte(bytes, 6);
    let mut data = Vec::with_capacity(usize::from(byte_count));
    for index in 0..usize::from(byte_count) {
        data.push(hex_byte(bytes, 8 + index * 2));
    }
    let checksum = hex_byte(bytes, 8 + usize::from(byte_count) * 2);
    let checksum_valid = checksum == compute_checksum(byte_count, address, record_type, &data);
    IntelHexFields {
        byte_count,
        address,
        record_type,
        data,
        checksum,
        checksum_valid,
    }
}

fn validate_fields(fields: &IntelHexFields) -> Option<String> {
    if record_type_name(fields.record_type).is_none() {
        return Some(format!("Unknown record type: 0x{:02X}", fields.record_type));
    }
    if let Some(required) = required_byte_count(fields.record_type)
        && fields.byte_count != required
    {
        let name = record_type_name(fields.record_type).unwrap_or("Record");
        return Some(format!(
            "{name} must have byte count {required}, got {}",
            fields.byte_count
        ));
    }
    None
}

fn build_record(
    raw: &str,
    line_number: f64,
    fields: IntelHexFields,
    error: Option<String>,
) -> HexRecord {
    HexRecord {
        line_number,
        raw: raw.to_string(),
        byte_count: fields.byte_count,
        address: fields.address,
        record_type: fields.record_type,
        data: fields.data,
        checksum: fields.checksum,
        checksum_valid: fields.checksum_valid,
        resolved_address: 0,
        error,
    }
}

/// Parse one trimmed Intel HEX line.
pub fn parse_intel_hex_line(raw: &str, line_number: f64) -> HexRecord {
    let base = HexRecord::base(raw, line_number);
    let hex = match parse_payload(raw, &base) {
        Ok(hex) => hex,
        Err(record) => return record,
    };
    let fields = parse_fields(&hex);
    let error = validate_fields(&fields);
    build_record(raw, line_number, fields, error)
}

/// Parse a whole Intel HEX source, matching `parseIntelHex`.
pub fn parse_intel_hex(source: &str) -> ParseResult {
    let mut state = IntelHexAddressState::default();
    let parsed = parse_source_records(
        source,
        &|raw, line_number| parse_intel_hex_line(raw, line_number),
        &mut |record| state.update(record),
    );

    let segments = build_contiguous_segments(&parsed.records, |record: &HexRecord| {
        record.record_type == 0
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
        start_address: state.start_address.map(|value| value as f64),
    }
}

/// The data-record predicate for Intel HEX.
pub fn is_data_record(record: &HexRecord) -> bool {
    record.record_type == 0
}

/// Parse a whole source in the async scanner's shape, for the compact engine path.
pub fn scan_intel_hex(source: &str) -> crate::model::ScannedRecords {
    let mut state = IntelHexAddressState::default();
    let mut scanned = crate::records::scan_source_records(
        source,
        &|raw, line_number| parse_intel_hex_line(raw, line_number),
        &mut |record| state.update(record),
    );
    scanned.start_address = state.start_address;
    scanned
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_data_record_with_a_valid_checksum() {
        let record = parse_intel_hex_line(":0400100001020304E2", 1.0);
        assert!(record.error.is_none());
        assert!(record.checksum_valid);
        assert_eq!(record.byte_count, 4);
        assert_eq!(record.address, 0x10);
        assert_eq!(record.record_type, 0);
        assert_eq!(record.data, vec![1, 2, 3, 4]);
    }

    #[test]
    fn flags_a_bad_checksum_without_making_it_malformed() {
        let record = parse_intel_hex_line(":0400100001020304E3", 1.0);
        assert!(record.error.is_none());
        assert!(!record.checksum_valid);
    }

    #[test]
    fn rejects_malformed_lines_with_the_original_messages() {
        assert_eq!(
            parse_intel_hex_line("nope", 1.0).error.as_deref(),
            Some("Missing start code \":\"")
        );
        assert_eq!(
            parse_intel_hex_line(":ZZ", 1.0).error.as_deref(),
            Some("Non-hex characters in record")
        );
        assert_eq!(
            parse_intel_hex_line(":00", 1.0).error.as_deref(),
            Some("Record too short")
        );
        assert_eq!(
            parse_intel_hex_line(":00000006FA", 1.0).error.as_deref(),
            Some("Unknown record type: 0x06")
        );
        assert_eq!(
            parse_intel_hex_line(":02000001DEAD72", 1.0)
                .error
                .as_deref(),
            Some("End of File must have byte count 0, got 2")
        );
    }

    #[test]
    fn extended_linear_and_segment_addresses_resolve_data() {
        let linear = parse_intel_hex(":020000040800F2\n:0400100001020304E2\n:00000001FF\n");
        assert_eq!(linear.segments[0].start_address, 0x0800_0010);
        let segment = parse_intel_hex(":020000021000EC\n:0400100001020304E2\n:00000001FF\n");
        assert_eq!(segment.segments[0].start_address, 0x1_0010);
    }

    #[test]
    fn start_address_records_keep_javascript_signed_semantics() {
        let linear = parse_intel_hex(":04000005FFFFFFFFFB\n:00000001FF\n");
        assert_eq!(linear.start_address, Some(-1.0));
        let segment = parse_intel_hex(":0400000300003800C1\n:00000001FF\n");
        assert_eq!(segment.start_address, Some(0x3800 as f64));
    }

    #[test]
    fn start_segment_address_adds_the_offset_to_the_shifted_base() {
        let parsed = parse_intel_hex(":0400000301010011E6\n:00000001FF\n");
        assert_eq!(parsed.start_address, Some(0x1021 as f64));
    }
}
