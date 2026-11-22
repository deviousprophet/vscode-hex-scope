//! End-to-end protocol test: spawn the real binary and drive it over stdio.

use std::io::{Read, Write};
use std::process::{Command, Stdio};

use serde_json::Value;

fn write_frame(writer: &mut impl Write, header: &str, body: &[u8]) {
    let header = header.as_bytes();
    let mut prefix = [0u8; 6];
    prefix[..4].copy_from_slice(&((header.len() + body.len()) as u32).to_le_bytes());
    prefix[4..].copy_from_slice(&(header.len() as u16).to_le_bytes());
    writer.write_all(&prefix).unwrap();
    writer.write_all(header).unwrap();
    writer.write_all(body).unwrap();
    writer.flush().unwrap();
}

fn read_frame(reader: &mut impl Read) -> (Value, Vec<u8>) {
    let mut prefix = [0u8; 6];
    reader.read_exact(&mut prefix).unwrap();
    let payload_length = u32::from_le_bytes([prefix[0], prefix[1], prefix[2], prefix[3]]) as usize;
    let header_length = u16::from_le_bytes([prefix[4], prefix[5]]) as usize;
    let mut payload = vec![0u8; payload_length];
    reader.read_exact(&mut payload).unwrap();
    let body = payload.split_off(header_length);
    let header: Value = serde_json::from_slice(&payload).unwrap();
    (header, body)
}

#[test]
fn engine_answers_ping_and_parses_both_formats() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_hex-engine"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn hex-engine");
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = child.stdout.take().unwrap();

    write_frame(&mut stdin, r#"{"id":1,"op":"ping"}"#, b"");
    let (pong, body) = read_frame(&mut stdout);
    assert_eq!(pong["protocol"], 1);
    assert_eq!(pong["ok"], true);
    assert!(body.is_empty());

    write_frame(
        &mut stdin,
        r#"{"id":2,"op":"parse","format":"ihex"}"#,
        b":0400100001020304E2\n:00000001FF\n",
    );
    let (progress, _) = read_frame(&mut stdout);
    assert_eq!(progress["event"], "progress");
    let (result, body) = read_frame(&mut stdout);
    assert_eq!(result["recordCount"], 2);
    assert_eq!(result["totalDataBytes"], 4);
    assert_eq!(result["segments"][0]["startAddress"], 16);
    assert_eq!(result["segments"][0]["length"], 4);
    assert_eq!(&body[body.len() - 4..], &[1, 2, 3, 4]);

    write_frame(
        &mut stdin,
        r#"{"id":3,"op":"parse","format":"bin","baseAddress":4096}"#,
        &[9, 8, 7],
    );
    let (binary, bin_body) = read_frame(&mut stdout);
    assert_eq!(binary["baseAddress"], 4096);
    assert_eq!(binary["segments"][0]["startAddress"], 4096);
    assert_eq!(bin_body, vec![9, 8, 7]);

    let lines = r#"[{"lineNumber":1,"raw":":0400100001020304E2"}]"#;
    write_frame(
        &mut stdin,
        r#"{"id":4,"op":"records","format":"ihex"}"#,
        lines.as_bytes(),
    );
    let (records_header, records_body) = read_frame(&mut stdout);
    assert_eq!(records_header["count"], 1);
    let records: Value = serde_json::from_slice(&records_body).unwrap();
    assert_eq!(records[0]["data"], serde_json::json!([1, 2, 3, 4]));
    assert_eq!(records[0]["checksumValid"], true);

    write_frame(
        &mut stdin,
        r#"{"id":5,"op":"repair","format":"ihex"}"#,
        b":0400100001020304E3\n:00000001FF\n",
    );
    let (repair_header, repaired) = read_frame(&mut stdout);
    assert_eq!(repair_header["repaired"], 1);
    assert_eq!(
        std::str::from_utf8(&repaired).unwrap(),
        ":0400100001020304E2\n:00000001FF\n"
    );

    drop(stdin);
    let status = child.wait().unwrap();
    assert!(status.success());
}
