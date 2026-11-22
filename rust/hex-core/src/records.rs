//! Source scanning shared by both record formats, mirroring
//! `src/core/parser/records.ts`.

use crate::model::{HexRecord, ScannedRecords};
use crate::text::{strip_trailing_sub, trim_bounds, utf16_len};

pub struct ParsedRecords {
    pub records: Vec<HexRecord>,
    pub checksum_errors: u32,
    pub malformed_lines: u32,
}

type LineParser<'a> = &'a dyn Fn(&str, f64) -> HexRecord;

/// Split like JavaScript's `source.split(/\r?\n/)`.
pub(crate) fn split_crlf_lines(source: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut rest = source;
    while let Some(newline) = rest.find('\n') {
        let mut line = &rest[..newline];
        if let Some(stripped) = line.strip_suffix('\r') {
            line = stripped;
        }
        lines.push(line);
        rest = &rest[newline + 1..];
    }
    lines.push(rest);
    lines
}

/// Synchronous scan used by `parseIntelHex` / `parseSRec`.
pub fn parse_source_records(
    source: &str,
    parse_line: LineParser<'_>,
    on_record: &mut dyn FnMut(&mut HexRecord),
) -> ParsedRecords {
    let source = strip_trailing_sub(source);
    let mut records = Vec::new();
    let mut checksum_errors = 0;
    let mut malformed_lines = 0;

    for (index, line) in split_crlf_lines(source).into_iter().enumerate() {
        let (start, end) = trim_bounds(line);
        if start == end {
            continue;
        }
        let mut record = parse_line(&line[start..end], (index + 1) as f64);
        if record.error.is_some() {
            malformed_lines += 1;
        } else {
            if !record.checksum_valid {
                checksum_errors += 1;
            }
            on_record(&mut record);
        }
        records.push(record);
    }

    ParsedRecords {
        records,
        checksum_errors,
        malformed_lines,
    }
}

/// Character scanner used by the compact parse path. Keeps UTF-16 source ranges and
/// 1-based line numbers, exactly like `parseSourceRecordsAsync`.
pub fn scan_source_records(
    source: &str,
    parse_line: LineParser<'_>,
    on_record: &mut dyn FnMut(&mut HexRecord),
) -> ScannedRecords {
    let source = strip_trailing_sub(source);
    let mut scanned = ScannedRecords::default();
    let mut byte_cursor = 0usize;
    let mut utf16_cursor = 0usize;
    let mut line_number = 1f64;

    loop {
        let newline = source[byte_cursor..].find('\n');
        let line_end = newline.map_or(source.len(), |offset| byte_cursor + offset);
        let content_end = if line_end > byte_cursor && source.as_bytes()[line_end - 1] == b'\r' {
            line_end - 1
        } else {
            line_end
        };

        let line = &source[byte_cursor..content_end];
        let (trim_start, trim_end) = trim_bounds(line);
        let start_byte = byte_cursor + trim_start;
        let end_byte = byte_cursor + trim_end;

        if start_byte < end_byte {
            let range_start = utf16_cursor + utf16_len(&source[byte_cursor..start_byte]);
            let range_end = utf16_cursor + utf16_len(&source[byte_cursor..end_byte]);
            let mut record = parse_line(&source[start_byte..end_byte], line_number);
            if record.error.is_some() {
                scanned.malformed_lines += 1;
            } else {
                if !record.checksum_valid {
                    scanned.checksum_errors += 1;
                }
                on_record(&mut record);
            }
            scanned.ranges.push((range_start as u32, range_end as u32));
            scanned.records.push(record);
        }

        let Some(_) = newline else {
            break;
        };
        utf16_cursor += utf16_len(&source[byte_cursor..=line_end]);
        byte_cursor = line_end + 1;
        line_number += 1.0;
    }

    scanned
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ihex::parse_intel_hex_line;

    #[test]
    fn synchronous_scan_skips_blank_lines_but_counts_line_numbers() {
        let parsed = parse_source_records(
            ":00000001FF\n\n:00000001FF\n",
            &|raw, line| parse_intel_hex_line(raw, line),
            &mut |_| {},
        );
        assert_eq!(parsed.records.len(), 2);
        assert_eq!(parsed.records[0].line_number, 1.0);
        assert_eq!(parsed.records[1].line_number, 3.0);
    }

    #[test]
    fn compact_scan_reports_utf16_ranges() {
        let scanned = scan_source_records(
            "\u{1F44D}\n:00000001FF\n",
            &|raw, line| parse_intel_hex_line(raw, line),
            &mut |_| {},
        );
        assert_eq!(scanned.records.len(), 2);
        assert_eq!(scanned.ranges[0], (0, 2));
        assert_eq!(scanned.ranges[1], (3, 14));
        assert_eq!(scanned.malformed_lines, 1);
    }
}
