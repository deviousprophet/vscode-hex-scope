//! Contiguous segment discovery, ported from `src/core/parser/segments.ts`.

use crate::model::{HexRecord, Segment, SegmentRange};

pub fn can_use_segment_record(record: &HexRecord, is_data: bool) -> bool {
    record.error.is_none() && is_data && record.checksum_valid
}

/// Discover contiguous data ranges. A record that cannot contribute (error, wrong type,
/// bad checksum) is skipped and therefore breaks contiguity, matching the original.
pub fn collect_segment_ranges(
    records: &[HexRecord],
    is_data: impl Fn(&HexRecord) -> bool,
) -> Vec<SegmentRange> {
    let mut ranges: Vec<SegmentRange> = Vec::new();
    let mut current: Option<usize> = None;

    for (index, record) in records.iter().enumerate() {
        if !can_use_segment_record(record, is_data(record)) {
            continue;
        }
        let starts_new = match current {
            None => true,
            Some(at) => {
                let range = &ranges[at];
                u64::from(record.resolved_address) != u64::from(range.address) + range.length
            }
        };
        if starts_new {
            ranges.push(SegmentRange {
                start_record: index,
                end_record: index,
                address: record.resolved_address,
                length: 0,
            });
            current = Some(ranges.len() - 1);
        }
        let at = current.expect("a range was just selected");
        let range = &mut ranges[at];
        range.end_record = index;
        range.length += record.data.len() as u64;
    }

    ranges
}

pub fn build_contiguous_segments(
    records: &[HexRecord],
    is_data: impl Fn(&HexRecord) -> bool + Copy,
) -> Vec<Segment> {
    collect_segment_ranges(records, is_data)
        .into_iter()
        .map(|range| {
            let mut data = Vec::with_capacity(range.length as usize);
            for record in &records[range.start_record..=range.end_record] {
                if can_use_segment_record(record, is_data(record)) {
                    data.extend_from_slice(&record.data);
                }
            }
            Segment {
                start_address: range.address,
                data,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(address: u32, data: &[u8], checksum_valid: bool) -> HexRecord {
        let mut record = HexRecord::base("", 1.0);
        record.record_type = 0;
        record.address = address;
        record.resolved_address = address;
        record.data = data.to_vec();
        record.checksum_valid = checksum_valid;
        record
    }

    #[test]
    fn merges_adjacent_records_and_breaks_on_invalid_checksum() {
        let records = [
            record(0x10, &[1, 2], true),
            record(0x12, &[3], true),
            record(0x13, &[4], false),
            record(0x14, &[5], true),
        ];
        let segments = build_contiguous_segments(&records, |_| true);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].start_address, 0x10);
        assert_eq!(segments[0].data, vec![1, 2, 3]);
        assert_eq!(segments[1].start_address, 0x14);
        assert_eq!(segments[1].data, vec![5]);
    }
}
