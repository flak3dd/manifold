// ── Manifold error types ──────────────────────────────────────────────────────

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum ManifoldError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("Profile not found: {0}")]
    ProfileNotFound(String),

    #[error("Proxy not found: {0}")]
    ProxyNotFound(String),

    #[error("Session not found: {0}")]
    #[allow(dead_code)]
    SessionNotFound(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Proxy health check failed: {0}")]
    #[allow(dead_code)]
    ProxyCheck(String),

    #[error("Bridge not running")]
    BridgeOffline,

    #[error("Encryption error: {0}")]
    Crypto(String),

    #[error("Invalid argument: {0}")]
    InvalidArg(String),

    #[error("{0}")]
    Other(String),
}

/// Tauri commands must return serialisable errors.
impl Serialize for ManifoldError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, ManifoldError>;

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Display messages ──────────────────────────────────────────────────────

    #[test]
    fn profile_not_found_message() {
        let e = ManifoldError::ProfileNotFound("abc-123".into());
        assert_eq!(e.to_string(), "Profile not found: abc-123");
    }

    #[test]
    fn proxy_not_found_message() {
        let e = ManifoldError::ProxyNotFound("px-456".into());
        assert_eq!(e.to_string(), "Proxy not found: px-456");
    }

    #[test]
    fn bridge_offline_message() {
        let e = ManifoldError::BridgeOffline;
        assert_eq!(e.to_string(), "Bridge not running");
    }

    #[test]
    fn invalid_arg_message() {
        let e = ManifoldError::InvalidArg("port cannot be 0".into());
        assert_eq!(e.to_string(), "Invalid argument: port cannot be 0");
    }

    #[test]
    fn crypto_error_message() {
        let e = ManifoldError::Crypto("aead: decryption failed".into());
        assert_eq!(e.to_string(), "Encryption error: aead: decryption failed");
    }

    #[test]
    fn other_error_message() {
        let e = ManifoldError::Other("something unexpected".into());
        assert_eq!(e.to_string(), "something unexpected");
    }

    #[test]
    fn session_not_found_message() {
        let e = ManifoldError::SessionNotFound("sess-789".into());
        assert_eq!(e.to_string(), "Session not found: sess-789");
    }

    #[test]
    fn proxy_check_message() {
        let e = ManifoldError::ProxyCheck("TCP connect refused".into());
        assert_eq!(
            e.to_string(),
            "Proxy health check failed: TCP connect refused"
        );
    }

    // ── From conversions ──────────────────────────────────────────────────────

    #[test]
    fn from_json_error() {
        let json_err = serde_json::from_str::<i32>("not_a_number").unwrap_err();
        let e: ManifoldError = json_err.into();
        let msg = e.to_string();
        assert!(
            msg.starts_with("JSON error:"),
            "expected 'JSON error:' prefix, got: {msg}"
        );
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let e: ManifoldError = io_err.into();
        let msg = e.to_string();
        assert!(
            msg.starts_with("IO error:"),
            "expected 'IO error:' prefix, got: {msg}"
        );
    }

    // ── Serde serialization ───────────────────────────────────────────────────

    #[test]
    fn error_serializes_to_display_string() {
        let e = ManifoldError::ProfileNotFound("p1".into());
        let json = serde_json::to_string(&e).unwrap();
        // Should serialize as a JSON string of the display message
        assert_eq!(json, r#""Profile not found: p1""#);
    }

    #[test]
    fn bridge_offline_serializes_correctly() {
        let e = ManifoldError::BridgeOffline;
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(json, r#""Bridge not running""#);
    }

    #[test]
    fn invalid_arg_serializes_correctly() {
        let e = ManifoldError::InvalidArg("bad input".into());
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(json, r#""Invalid argument: bad input""#);
    }

    // ── Result type alias ─────────────────────────────────────────────────────

    #[test]
    fn result_ok_is_ok() {
        let r: Result<i32> = Ok(42);
        assert!(r.is_ok());
        assert_eq!(r.unwrap(), 42);
    }

    #[test]
    fn result_err_carries_error() {
        let r: Result<i32> = Err(ManifoldError::BridgeOffline);
        assert!(r.is_err());
        assert_eq!(r.unwrap_err().to_string(), "Bridge not running");
    }

    // ── Debug formatting ──────────────────────────────────────────────────────

    #[test]
    fn error_is_debug_formattable() {
        let e = ManifoldError::InvalidArg("test".into());
        let debug = format!("{e:?}");
        assert!(debug.contains("InvalidArg"));
    }
}
