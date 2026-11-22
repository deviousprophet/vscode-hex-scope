//! Checksum repair, ported from `repairChecksums` in `src/core/document.ts`.

use crate::model::{Format, HexRecord};
use crate::records::split_crlf_lines;

/// Rewrite the checksum field of every valid record whose checksum is wrong.
///
/// Returns the repaired source and the number of lines changed. The line ending style is
/// preserved (CRLF when the source contains one, LF otherwise), matching the TypeScript
/// implementation.
pub fn repair_checksums(source: &str, format: Format) -> (String, u32) {
    let eol = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut lines: Vec<String> = split_crlf_lines(source)
        .into_iter()
        .map(str::to_string)
        .collect();

    let records = match format {
        Format::IntelHex => crate::ihex::parse_intel_hex(source).records,
        Format::SRec => crate::srec::parse_srec(source).records,
    };

    let mut repaired = 0;
    for record in &records {
        if record.error.is_some() || record.checksum_valid {
            continue;
        }
        let Some(index) = line_index(record) else {
            continue;
        };
        let Some(line) = lines.get_mut(index) else {
            continue;
        };
        let checksum = match format {
            Format::IntelHex => crate::ihex::compute_checksum(
                record.byte_count,
                record.address,
                record.record_type,
                &record.data,
            ),
            Format::SRec => crate::srec::checksum_for_bytes(
                record.byte_count,
                record.address,
                crate::srec::address_size(record.record_type),
                &record.data,
            ),
        };
        *line = replace_checksum(line, checksum);
        repaired += 1;
    }

    (lines.join(eol), repaired)
}

fn line_index(record: &HexRecord) -> Option<usize> {
    if record.line_number < 1.0 {
        return None;
    }
    let index = record.line_number.trunc() as usize;
    index.checked_sub(1)
}

fn replace_checksum(line: &str, checksum: u8) -> String {
    // JavaScript slices by UTF-16 code unit: drop the last two units, then append the field.
    let mut units: Vec<u16> = line.encode_utf16().collect();
    if units.len() >= 2 {
        units.truncate(units.len() - 2);
    }
    let mut out = String::from_utf16_lossy(&units);
    out.push_str(&format!("{checksum:02X}"));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repairs_an_intel_hex_checksum_and_keeps_line_endings() {
        let source = ":0400100001020304E3\r\n:00000001FF\r\n";
        let (repaired, count) = repair_checksums(source, Format::IntelHex);
        assert_eq!(count, 1);
        assert_eq!(repaired, ":0400100001020304E2\r\n:00000001FF\r\n");
    }

    #[test]
    fn repairs_an_srec_checksum() {
        let (repaired, count) = repair_checksums("S107000001020304EF\nS9030000FC\n", Format::SRec);
        assert_eq!(count, 1);
        assert_eq!(repaired, "S107000001020304EE\nS9030000FC\n");
    }

    #[test]
    fn leaves_malformed_records_alone() {
        let source = "not a record\n:00000001FF\n";
        let (repaired, count) = repair_checksums(source, Format::IntelHex);
        assert_eq!(count, 0);
        assert_eq!(repaired, source);
    }
}
