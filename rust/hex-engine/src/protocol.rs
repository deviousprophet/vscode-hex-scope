//! Framed stdio transport shared by the engine loop and its integration tests.
//!
//! One frame is `[u32 LE payload length][u16 LE header length][header JSON][body]`.

use std::io::{self, Read, Write};

pub const MAX_FRAME: usize = 64 * 1024 * 1024;
pub const MAX_HEADER: usize = 0xFFFF;

/// Read one frame from `reader`. `Ok(None)` means a clean end of stream.
pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<(Vec<u8>, Vec<u8>)>> {
    let mut prefix = [0u8; 6];
    match reader.read_exact(&mut prefix) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }

    let payload_length = u32::from_le_bytes([prefix[0], prefix[1], prefix[2], prefix[3]]) as usize;
    let header_length = u16::from_le_bytes([prefix[4], prefix[5]]) as usize;
    if payload_length > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("frame of {payload_length} bytes exceeds the {MAX_FRAME} limit"),
        ));
    }
    if header_length > payload_length {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "header length exceeds the frame payload",
        ));
    }

    let mut payload = vec![0u8; payload_length];
    reader.read_exact(&mut payload)?;
    let body = payload.split_off(header_length);
    Ok(Some((payload, body)))
}

/// Write one frame and flush it, so the host sees the response before the next read.
pub fn write_frame(writer: &mut impl Write, header: &[u8], body: &[u8]) -> io::Result<()> {
    if header.len() > MAX_HEADER {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "response header is too large",
        ));
    }
    let payload_length = header.len() + body.len();
    if payload_length > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "response exceeds the frame limit",
        ));
    }

    let mut prefix = [0u8; 6];
    prefix[..4].copy_from_slice(&(payload_length as u32).to_le_bytes());
    prefix[4..].copy_from_slice(&(header.len() as u16).to_le_bytes());
    writer.write_all(&prefix)?;
    writer.write_all(header)?;
    writer.write_all(body)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_frame() {
        let mut buffer = Vec::new();
        write_frame(&mut buffer, br#"{"id":1}"#, b"body").unwrap();
        let mut cursor = io::Cursor::new(buffer);
        let (header, body) = read_frame(&mut cursor).unwrap().unwrap();
        assert_eq!(header, br#"{"id":1}"#);
        assert_eq!(body, b"body");
        assert!(read_frame(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn rejects_a_header_longer_than_the_payload() {
        let mut frame = Vec::new();
        frame.extend_from_slice(&2u32.to_le_bytes());
        frame.extend_from_slice(&3u16.to_le_bytes());
        frame.extend_from_slice(&[0, 0]);
        let error = read_frame(&mut io::Cursor::new(frame)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }
}
