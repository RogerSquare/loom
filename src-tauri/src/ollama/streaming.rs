/// Incremental NDJSON line reassembler.
///
/// Ollama's `/api/chat` streams response objects as newline-delimited JSON.
/// Chunks from the network can split a line arbitrarily. `NdjsonBuffer`
/// accumulates bytes and yields complete UTF-8 lines (\n or \r\n terminated)
/// as they become available.
#[derive(Debug, Default)]
pub struct NdjsonBuffer {
    buf: Vec<u8>,
}

impl NdjsonBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Push a chunk of bytes and return any newly-completed lines.
    /// Non-UTF-8 lines are silently dropped (Ollama's output is always UTF-8).
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            let Some(newline_idx) = self.buf.iter().position(|&b| b == b'\n') else {
                break;
            };
            let line: Vec<u8> = self.buf.drain(..=newline_idx).collect();
            let mut end = line.len() - 1;
            if end > 0 && line[end - 1] == b'\r' {
                end -= 1;
            }
            if let Ok(s) = std::str::from_utf8(&line[..end]) {
                if !s.is_empty() {
                    out.push(s.to_owned());
                }
            }
        }
        out
    }

    /// Remaining buffered bytes that haven't been terminated by a newline.
    #[allow(dead_code)]
    pub fn remaining(&self) -> &[u8] {
        &self.buf
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_chunk_reassembly() {
        let mut buf = NdjsonBuffer::new();
        assert!(buf.push(b"hello ").is_empty());
        assert!(buf.push(b"wor").is_empty());
        let lines = buf.push(b"ld\n{\"a\":1}\n");
        assert_eq!(lines, vec!["hello world".to_string(), "{\"a\":1}".to_string()]);
        assert!(buf.remaining().is_empty());
    }

    #[test]
    fn complete_response_parsed() {
        let sample = br#"{"model":"llama","message":{"role":"assistant","content":"hi"},"done":false}
{"model":"llama","message":{"role":"assistant","content":" there"},"done":true,"eval_count":2}
"#;
        let mut buf = NdjsonBuffer::new();
        let lines = buf.push(sample);
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("\"content\":\"hi\""));
        assert!(lines[1].contains("\"done\":true"));
    }

    #[test]
    fn crlf_line_endings_handled() {
        let mut buf = NdjsonBuffer::new();
        let lines = buf.push(b"line one\r\nline two\r\n");
        assert_eq!(lines, vec!["line one".to_string(), "line two".to_string()]);
    }

    #[test]
    fn split_on_utf8_boundary_waits() {
        let mut buf = NdjsonBuffer::new();
        let snowman = "☃"; // 3 bytes: E2 98 83
        let first_two = &snowman.as_bytes()[..2];
        let rest = &snowman.as_bytes()[2..];
        assert!(buf.push(first_two).is_empty());
        let lines = buf.push(rest);
        assert!(lines.is_empty());
        let lines = buf.push(b"\n");
        assert_eq!(lines, vec![snowman.to_string()]);
    }

    #[test]
    fn empty_lines_skipped() {
        let mut buf = NdjsonBuffer::new();
        let lines = buf.push(b"a\n\n\nb\n");
        assert_eq!(lines, vec!["a".to_string(), "b".to_string()]);
    }
}
