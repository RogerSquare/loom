use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum LoomError {
    #[allow(dead_code)]
    #[error("ollama request failed: {0}")]
    Ollama(String),

    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("channel send failed: {0}")]
    Channel(String),

    #[error("utf8 error: {0}")]
    Utf8(#[from] std::str::Utf8Error),
}

impl Serialize for LoomError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, LoomError>;
