//! Shared parser model, mirroring `src/core/parser/types.ts` and `compact.ts`.

/// A single parsed record. `line_number` is a float because the TypeScript line parser
/// accepts any number; the scanners always pass integers.
#[derive(Clone, Debug, PartialEq)]
pub struct HexRecord {
    pub line_number: f64,
    pub raw: String,
    pub byte_count: u8,
    pub address: u32,
    pub record_type: u8,
    pub data: Vec<u8>,
    pub checksum: u8,
    pub checksum_valid: bool,
    pub resolved_address: u32,
    pub error: Option<String>,
}

impl HexRecord {
    pub fn base(raw: &str, line_number: f64) -> Self {
        Self {
            line_number,
            raw: raw.to_string(),
            byte_count: 0,
            address: 0,
            record_type: 0,
            data: Vec::new(),
            checksum: 0,
            checksum_valid: false,
            resolved_address: 0,
            error: None,
        }
    }
}

/// A contiguous block of memory data.
#[derive(Clone, Debug, PartialEq)]
pub struct Segment {
    pub start_address: u32,
    pub data: Vec<u8>,
}

/// Full parse result, as `ParseResult` in TypeScript.
#[derive(Clone, Debug, PartialEq)]
pub struct ParseResult {
    pub records: Vec<HexRecord>,
    pub segments: Vec<Segment>,
    pub total_data_bytes: u64,
    pub checksum_errors: u32,
    pub malformed_lines: u32,
    pub start_address: Option<f64>,
}

/// Record metadata pages, as `SerializedCompactPage` in TypeScript.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Page {
    pub source_start: Vec<u32>,
    pub source_end: Vec<u32>,
    pub line_number: Vec<u32>,
    pub address: Vec<u32>,
    pub resolved_address: Vec<u32>,
    pub byte_count: Vec<u8>,
    pub record_type: Vec<u8>,
    pub checksum: Vec<u8>,
    pub flags: Vec<u8>,
}

/// Compact worker payload, as `SerializedCompactParseResult` in TypeScript.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CompactResult {
    pub pages: Vec<Page>,
    pub segments: Vec<Segment>,
    pub total_data_bytes: u64,
    pub checksum_errors: u32,
    pub malformed_lines: u32,
    pub start_address: Option<i64>,
    pub base_address: Option<u32>,
}

/// A data range discovered while scanning records.
#[derive(Clone, Debug, PartialEq)]
pub struct SegmentRange {
    pub start_record: usize,
    pub end_record: usize,
    pub address: u32,
    pub length: u64,
}

/// The record dialect being parsed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Format {
    IntelHex,
    SRec,
}

/// Records plus their UTF-16 source ranges, as the async scanner produces them.
#[derive(Debug, Default)]
pub struct ScannedRecords {
    pub records: Vec<HexRecord>,
    pub ranges: Vec<(u32, u32)>,
    pub checksum_errors: u32,
    pub malformed_lines: u32,
    pub start_address: Option<i64>,
}
