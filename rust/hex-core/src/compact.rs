//! Compact metadata pages and segment assembly, ported from
//! `src/core/parser/compact.ts`.

use crate::model::{CompactResult, HexRecord, Page, ScannedRecords, Segment};
use crate::segments::{can_use_segment_record, collect_segment_ranges};

const RECORD_PAGE_CAPACITY: usize = 65_536;

fn record_flags(record: &HexRecord) -> u8 {
    let mut flags = 0;
    if record.checksum_valid {
        flags |= 1;
    }
    if record.error.is_some() {
        flags |= 2;
    }
    flags
}

fn empty_page() -> Page {
    Page {
        source_start: Vec::with_capacity(RECORD_PAGE_CAPACITY),
        source_end: Vec::with_capacity(RECORD_PAGE_CAPACITY),
        line_number: Vec::with_capacity(RECORD_PAGE_CAPACITY),
        address: Vec::with_capacity(RECORD_PAGE_CAPACITY),
        resolved_address: Vec::with_capacity(RECORD_PAGE_CAPACITY),
        byte_count: Vec::with_capacity(RECORD_PAGE_CAPACITY),
        record_type: Vec::with_capacity(RECORD_PAGE_CAPACITY),
        checksum: Vec::with_capacity(RECORD_PAGE_CAPACITY),
        flags: Vec::with_capacity(RECORD_PAGE_CAPACITY),
    }
}

/// Build the compact payload for a scanned source.
pub fn build_compact(
    scanned: ScannedRecords,
    is_data: impl Fn(&HexRecord) -> bool + Copy,
    start_address: Option<i64>,
    base_address: Option<u32>,
) -> CompactResult {
    let ranges = collect_segment_ranges(&scanned.records, is_data);
    let mut segments: Vec<Segment> = ranges
        .iter()
        .map(|range| Segment {
            start_address: range.address,
            data: Vec::with_capacity(range.length as usize),
        })
        .collect();
    let mut pages: Vec<Page> = Vec::new();

    let mut seg_cursor = 0usize;
    for (index, record) in scanned.records.iter().enumerate() {
        while seg_cursor < ranges.len() && index > ranges[seg_cursor].end_record {
            seg_cursor += 1;
        }
        if seg_cursor < ranges.len()
            && index >= ranges[seg_cursor].start_record
            && can_use_segment_record(record, is_data(record))
        {
            segments[seg_cursor].data.extend_from_slice(&record.data);
        }

        let page_index = index / RECORD_PAGE_CAPACITY;
        if pages.len() == page_index {
            pages.push(empty_page());
        }
        let page = &mut pages[page_index];
        let (source_start, source_end) = scanned.ranges[index];
        page.source_start.push(source_start);
        page.source_end.push(source_end);
        page.line_number
            .push(crate::jsnum::to_uint32(record.line_number));
        page.address.push(record.address);
        page.resolved_address.push(record.resolved_address);
        page.byte_count.push(record.byte_count);
        page.record_type.push(record.record_type);
        page.checksum.push(record.checksum);
        page.flags.push(record_flags(record));
    }

    let total_data_bytes = segments
        .iter()
        .map(|segment| segment.data.len() as u64)
        .sum();

    CompactResult {
        pages,
        segments,
        total_data_bytes,
        checksum_errors: scanned.checksum_errors,
        malformed_lines: scanned.malformed_lines,
        start_address,
        base_address,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ihex::scan_intel_hex;

    #[test]
    fn pages_carry_metadata_and_flags() {
        let scanned = scan_intel_hex(":10001000AABBCCDDEEFF00112233445566778899E8\n:00000001FF\n");
        let compact = build_compact(scanned, |record| record.record_type == 0, None, None);
        assert_eq!(compact.pages.len(), 1);
        assert_eq!(compact.pages[0].line_number, vec![1, 2]);
        assert_eq!(compact.segments.len(), 1);
        assert_eq!(compact.segments[0].start_address, 0x10);
        assert_eq!(compact.total_data_bytes, 16);
    }
}
