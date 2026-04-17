/// Server-Sent Events (SSE) line parser.
///
/// SSE streams (used by Anthropic, OpenAI) send events as:
/// ```text
/// event: content_block_delta
/// data: {"type":"content_block_delta","delta":{"text":"Hello"}}
///
/// event: message_stop
/// data: {"type":"message_stop"}
/// ```
///
/// Events are separated by blank lines. Each event can have multiple fields
/// (event, data, id, retry) but we only care about `event` and `data`.
/// Multi-line `data:` fields are joined with newlines per the SSE spec.

#[derive(Debug, Clone)]
pub struct SseEvent {
    pub event_type: Option<String>,
    pub data: String,
}

/// Incremental SSE parser. Feed it bytes, get back complete events.
#[derive(Debug, Default)]
pub struct SseBuffer {
    buf: String,
    current_event: Option<String>,
    current_data: Vec<String>,
}

impl SseBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Push a chunk of bytes and return any newly-completed SSE events.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        let text = match std::str::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        self.buf.push_str(text);

        let mut events = Vec::new();

        loop {
            // Find the next line ending
            let newline_pos = match self.buf.find('\n') {
                Some(pos) => pos,
                None => break,
            };

            let line = self.buf[..newline_pos].trim_end_matches('\r').to_string();
            self.buf = self.buf[newline_pos + 1..].to_string();

            if line.is_empty() {
                // Blank line = event boundary
                if !self.current_data.is_empty() {
                    events.push(SseEvent {
                        event_type: self.current_event.take(),
                        data: self.current_data.join("\n"),
                    });
                    self.current_data.clear();
                }
                self.current_event = None;
            } else if let Some(value) = line.strip_prefix("data:") {
                self.current_data.push(value.trim_start().to_string());
            } else if let Some(value) = line.strip_prefix("event:") {
                self.current_event = Some(value.trim_start().to_string());
            }
            // Ignore "id:", "retry:", comments (":"), and unknown fields
        }

        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_data_event() {
        let mut buf = SseBuffer::new();
        let events = buf.push(b"data: {\"text\":\"hello\"}\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "{\"text\":\"hello\"}");
        assert!(events[0].event_type.is_none());
    }

    #[test]
    fn parses_typed_event() {
        let mut buf = SseBuffer::new();
        let events = buf.push(b"event: content_block_delta\ndata: {\"delta\":\"hi\"}\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type.as_deref(), Some("content_block_delta"));
        assert_eq!(events[0].data, "{\"delta\":\"hi\"}");
    }

    #[test]
    fn handles_multi_line_data() {
        let mut buf = SseBuffer::new();
        let events = buf.push(b"data: line1\ndata: line2\ndata: line3\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "line1\nline2\nline3");
    }

    #[test]
    fn handles_partial_chunks() {
        let mut buf = SseBuffer::new();
        assert!(buf.push(b"data: {\"par").is_empty());
        assert!(buf.push(b"tial\":true}").is_empty());
        let events = buf.push(b"\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "{\"partial\":true}");
    }

    #[test]
    fn handles_multiple_events_in_one_chunk() {
        let mut buf = SseBuffer::new();
        let input = b"event: delta\ndata: {\"a\":1}\n\nevent: done\ndata: {\"b\":2}\n\n";
        let events = buf.push(input);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_type.as_deref(), Some("delta"));
        assert_eq!(events[0].data, "{\"a\":1}");
        assert_eq!(events[1].event_type.as_deref(), Some("done"));
        assert_eq!(events[1].data, "{\"b\":2}");
    }

    #[test]
    fn handles_crlf_line_endings() {
        let mut buf = SseBuffer::new();
        let events = buf.push(b"event: test\r\ndata: hello\r\n\r\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type.as_deref(), Some("test"));
        assert_eq!(events[0].data, "hello");
    }

    #[test]
    fn ignores_comments_and_unknown_fields() {
        let mut buf = SseBuffer::new();
        let events = buf.push(b": this is a comment\nid: 123\nretry: 5000\ndata: actual\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "actual");
    }

    #[test]
    fn empty_data_not_emitted() {
        let mut buf = SseBuffer::new();
        // Just blank lines with no data fields
        let events = buf.push(b"\n\n\n");
        assert!(events.is_empty());
    }

    #[test]
    fn data_with_no_space_after_colon() {
        let mut buf = SseBuffer::new();
        let events = buf.push(b"data:{\"compact\":true}\n\n");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data, "{\"compact\":true}");
    }

    #[test]
    fn simulates_anthropic_stream() {
        let mut buf = SseBuffer::new();
        let chunk1 = b"event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_01\",\"model\":\"claude-sonnet-4-20250514\"}}\n\n";
        let chunk2 = b"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n";
        let chunk3 = b"event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":5}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

        let e1 = buf.push(chunk1);
        assert_eq!(e1.len(), 1);
        assert_eq!(e1[0].event_type.as_deref(), Some("message_start"));

        let e2 = buf.push(chunk2);
        assert_eq!(e2.len(), 1);
        assert!(e2[0].data.contains("Hello"));

        let e3 = buf.push(chunk3);
        assert_eq!(e3.len(), 2);
        assert_eq!(e3[0].event_type.as_deref(), Some("message_delta"));
        assert_eq!(e3[1].event_type.as_deref(), Some("message_stop"));
    }
}
