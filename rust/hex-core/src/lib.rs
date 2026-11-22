//! Hex Scope parsing core: Intel HEX, Motorola SREC and raw-binary images.
//!
//! The engine binary and the `rust-anything` parity crate both call this library, so the
//! behaviour proven against the TypeScript originals is the behaviour the extension runs.

pub mod bin;
pub mod compact;
pub mod ihex;
pub mod jsnum;
pub mod model;
pub mod records;
pub mod segments;
pub mod srec;
pub mod text;

pub use model::{CompactResult, Format, HexRecord, Page, ParseResult, ScannedRecords, Segment};

/// Parse a text source into the compact worker payload.
pub fn parse_compact(source: &str, format: Format) -> CompactResult {
    match format {
        Format::IntelHex => {
            let scanned = ihex::scan_intel_hex(source);
            let start_address = scanned.start_address;
            compact::build_compact(scanned, ihex::is_data_record, start_address, None)
        }
        Format::SRec => {
            let scanned = srec::scan_srec(source);
            let start_address = scanned.start_address;
            compact::build_compact(
                scanned,
                |record| srec::srec_is_data(record.record_type),
                start_address,
                None,
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intel_hex_compact_result_matches_expected_shape() {
        let source = ":020000040800F2\n:0400100001020304E2\n:00000001FF\n";
        let result = parse_compact(source, Format::IntelHex);
        assert_eq!(result.pages.len(), 1);
        assert_eq!(result.pages[0].line_number, vec![1, 2, 3]);
        assert_eq!(result.pages[0].resolved_address, vec![0, 0x0800_0010, 0]);
        assert_eq!(result.segments.len(), 1);
        assert_eq!(result.segments[0].start_address, 0x0800_0010);
        assert_eq!(result.segments[0].data, vec![1, 2, 3, 4]);
        assert_eq!(result.total_data_bytes, 4);
        assert_eq!(result.checksum_errors, 0);
        assert_eq!(result.malformed_lines, 0);
    }

    #[test]
    fn srec_compact_result_keeps_start_address_and_data() {
        let source = "S00600004844521B\nS107000001020304EE\nS9030000FC\n";
        let result = parse_compact(source, Format::SRec);
        assert_eq!(result.pages.len(), 1);
        assert_eq!(result.segments.len(), 1);
        assert_eq!(result.segments[0].start_address, 0);
        assert_eq!(result.segments[0].data, vec![1, 2, 3, 4]);
        assert_eq!(result.start_address, Some(0));
    }
}
