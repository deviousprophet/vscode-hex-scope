//! The Hex Scope parsing engine: framed stdio requests from the extension host.

mod ops;
mod protocol;

use std::io::{self, BufReader, BufWriter};

use ops::{Frame, Request};

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::with_capacity(1024 * 1024, stdin.lock());
    let mut writer = BufWriter::with_capacity(1024 * 1024, stdout.lock());

    while let Some((header, body)) = protocol::read_frame(&mut reader)? {
        let request = Request::from_header(&header);
        let (response, progress) = match request {
            Ok(request) if request.op == "ping" => (ops::ping(request.id), None),
            Ok(request) if request.op == "parse" => match ops::parse(request.id, &request, &body) {
                Ok(result) => result,
                Err(error) => (Frame::error(request.id, error), None),
            },
            Ok(request) if request.op == "records" => {
                match ops::records(request.id, &request, &body) {
                    Ok(frame) => (frame, None),
                    Err(error) => (Frame::error(request.id, error), None),
                }
            }
            Ok(request) if request.op == "repair" => match ops::repair(request.id, &request, &body)
            {
                Ok(frame) => (frame, None),
                Err(error) => (Frame::error(request.id, error), None),
            },
            Ok(request) => (
                Frame::error(request.id, format!("unknown op: {}", request.op)),
                None,
            ),
            Err(error) => {
                let id = serde_json::from_slice::<serde_json::Value>(&header)
                    .ok()
                    .and_then(|value| value.get("id").and_then(serde_json::Value::as_u64))
                    .unwrap_or(0);
                (Frame::error(id, error), None)
            }
        };

        if let Some(progress) = progress {
            protocol::write_frame(&mut writer, &progress.header, &progress.body)?;
        }
        protocol::write_frame(&mut writer, &response.header, &response.body)?;
    }

    Ok(())
}
