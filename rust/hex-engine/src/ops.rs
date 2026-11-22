//! Request handling: JSON headers, binary payloads, no JSON for record bytes.

use hex_core::{CompactResult, Format};
use serde_json::{Map, Value, json};

pub const PROTOCOL: u64 = 1;

/// What a `parse` request carries.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Input {
    Text(Format),
    Bin,
}

/// A request header, after validation.
pub struct Request {
    pub id: u64,
    pub op: String,
    pub input: Option<Input>,
    pub base_address: Option<u32>,
}

impl Request {
    pub fn from_header(header: &[u8]) -> Result<Self, String> {
        let value: Value = serde_json::from_slice(header)
            .map_err(|error| format!("invalid request header: {error}"))?;
        let object = value
            .as_object()
            .ok_or_else(|| "request header must be a JSON object".to_string())?;
        let id = object
            .get("id")
            .and_then(Value::as_u64)
            .ok_or_else(|| "request header has no numeric id".to_string())?;
        let op = object
            .get("op")
            .and_then(Value::as_str)
            .ok_or_else(|| "request header has no op".to_string())?
            .to_string();
        let input = match object.get("format").and_then(Value::as_str) {
            Some("ihex") => Some(Input::Text(Format::IntelHex)),
            Some("srec") => Some(Input::Text(Format::SRec)),
            Some("bin") => Some(Input::Bin),
            Some(other) => return Err(format!("unknown format: {other}")),
            None => None,
        };
        let base_address = match object.get("baseAddress") {
            None | Some(Value::Null) => None,
            Some(value) => {
                let number = value
                    .as_f64()
                    .ok_or_else(|| "baseAddress must be a number".to_string())?;
                if !hex_core::bin::is_valid_base_address(number) {
                    return Err("baseAddress must be a 32-bit unsigned integer".to_string());
                }
                Some(number as u32)
            }
        };
        Ok(Self {
            id,
            op,
            input,
            base_address,
        })
    }
}

/// One response frame: header JSON plus the raw body.
pub struct Frame {
    pub header: Vec<u8>,
    pub body: Vec<u8>,
}

impl Frame {
    fn new(value: Value, body: Vec<u8>) -> Self {
        Self {
            header: value.to_string().into_bytes(),
            body,
        }
    }

    pub fn error(id: u64, message: impl Into<String>) -> Self {
        Self::new(
            json!({"id": id, "ok": false, "error": message.into()}),
            Vec::new(),
        )
    }
}

/// `ping`: the handshake the host validates before sending any work.
pub fn ping(id: u64) -> Frame {
    Frame::new(
        json!({
            "id": id,
            "ok": true,
            "protocol": PROTOCOL,
            "engine": "hex-engine",
            "version": env!("CARGO_PKG_VERSION"),
        }),
        Vec::new(),
    )
}

/// `parse`: text source or raw image to the compact worker payload.
pub fn parse(id: u64, request: &Request, body: &[u8]) -> Result<(Frame, Option<Frame>), String> {
    match request.input {
        Some(Input::Bin) => {
            let base_address = request
                .base_address
                .ok_or_else(|| "a base address is required for raw binary input".to_string())?;
            Ok((
                compact_frame(id, hex_core::bin::parse_bin(body, base_address)),
                None,
            ))
        }
        Some(Input::Text(format)) => {
            let source = std::str::from_utf8(body)
                .map_err(|error| format!("source is not valid UTF-8: {error}"))?;
            let compact = hex_core::parse_compact(source, format);
            let total = compact
                .pages
                .iter()
                .map(|page| page.line_number.len() as u64)
                .sum();
            Ok((compact_frame(id, compact), Some(progress_frame(total))))
        }
        None => Err("parse requires a text or binary format".to_string()),
    }
}

fn progress_frame(total: u64) -> Frame {
    Frame::new(
        json!({
            "id": 0,
            "event": "progress",
            "stage": "build",
            "completed": total,
            "total": total,
        }),
        Vec::new(),
    )
}

fn compact_frame(id: u64, compact: CompactResult) -> Frame {
    let mut header = Map::new();
    header.insert("id".to_string(), json!(id));
    header.insert("ok".to_string(), json!(true));
    header.insert(
        "recordCount".to_string(),
        json!(
            compact
                .pages
                .iter()
                .map(|page| page.line_number.len())
                .sum::<usize>()
        ),
    );
    header.insert(
        "totalDataBytes".to_string(),
        json!(compact.total_data_bytes),
    );
    header.insert("checksumErrors".to_string(), json!(compact.checksum_errors));
    header.insert("malformedLines".to_string(), json!(compact.malformed_lines));
    if let Some(start_address) = compact.start_address {
        header.insert("startAddress".to_string(), json!(start_address));
    }
    if let Some(base_address) = compact.base_address {
        header.insert("baseAddress".to_string(), json!(base_address));
    }
    header.insert(
        "pageLengths".to_string(),
        json!(
            compact
                .pages
                .iter()
                .map(|page| page.line_number.len())
                .collect::<Vec<_>>()
        ),
    );

    let mut segments = Vec::with_capacity(compact.segments.len());
    let mut offset = 0usize;
    for segment in &compact.segments {
        segments.push(json!({
            "startAddress": segment.start_address,
            "offset": offset,
            "length": segment.data.len(),
        }));
        offset += segment.data.len();
    }
    header.insert("segments".to_string(), Value::Array(segments));

    let mut body = Vec::new();
    for page in &compact.pages {
        for value in &page.source_start {
            body.extend_from_slice(&value.to_le_bytes());
        }
        for value in &page.source_end {
            body.extend_from_slice(&value.to_le_bytes());
        }
        for value in &page.line_number {
            body.extend_from_slice(&value.to_le_bytes());
        }
        for value in &page.address {
            body.extend_from_slice(&value.to_le_bytes());
        }
        for value in &page.resolved_address {
            body.extend_from_slice(&value.to_le_bytes());
        }
        body.extend_from_slice(&page.byte_count);
        body.extend_from_slice(&page.record_type);
        body.extend_from_slice(&page.checksum);
        body.extend_from_slice(&page.flags);
    }
    for segment in &compact.segments {
        body.extend_from_slice(&segment.data);
    }

    header.insert("bodyLength".to_string(), json!(body.len()));
    Frame::new(Value::Object(header), body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(header: &str) -> Request {
        Request::from_header(header.as_bytes()).unwrap()
    }

    #[test]
    fn parses_a_protocol_header() {
        let parsed = request(r#"{"id":7,"op":"parse","format":"ihex"}"#);
        assert_eq!(parsed.id, 7);
        assert_eq!(parsed.input, Some(Input::Text(Format::IntelHex)));
    }

    #[test]
    fn rejects_unknown_formats_and_bad_bases() {
        assert!(Request::from_header(br#"{"id":1,"op":"parse","format":"elf"}"#).is_err());
        assert!(
            Request::from_header(br#"{"id":1,"op":"parse","format":"bin","baseAddress":-1}"#)
                .is_err()
        );
    }

    #[test]
    fn compact_frame_layout_matches_the_protocol() {
        let source = b":0400100001020304E2\n:00000001FF\n";
        let (frame, progress) = parse(
            3,
            &request(r#"{"id":3,"op":"parse","format":"ihex"}"#),
            source,
        )
        .unwrap();
        assert!(progress.is_some());
        let header: Value = serde_json::from_slice(&frame.header).unwrap();
        assert_eq!(header["recordCount"], 2);
        assert_eq!(header["segments"][0]["length"], 4);
        assert_eq!(
            frame.body.len(),
            header["bodyLength"].as_u64().unwrap() as usize
        );
        assert_eq!(&frame.body[frame.body.len() - 4..], &[1, 2, 3, 4]);
    }
}
