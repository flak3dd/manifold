// ── Manifold database layer ───────────────────────────────────────────────────
//
// Uses bundled SQLite (rusqlite "bundled" feature).  To enable full SQLCipher
// disk-level encryption flip the Cargo feature to
// "bundled-sqlcipher-vendored-openssl" and uncomment the PRAGMA key block.
//
// Sensitive fields (proxy credentials, fingerprint seed) are additionally
// encrypted at the application layer with AES-256-GCM + Argon2id key derivation
// so they remain protected even in the plain-SQLite build.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    AeadCore, Aes256Gcm, Key, Nonce,
};
use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHasher};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rusqlite::{params, Connection};

use crate::error::{ManifoldError, Result};

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION: u32 = 1;

const SCHEMA_SQL: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
    version  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    fingerprint_json TEXT NOT NULL,          -- JSON blob (seed + all FP params)
    human_json       TEXT NOT NULL DEFAULT '{}', -- JSON blob (HumanBehavior)
    proxy_id         TEXT,
    notes            TEXT    NOT NULL DEFAULT '',
    tags             TEXT    NOT NULL DEFAULT '[]',  -- JSON array of strings
    status           TEXT    NOT NULL DEFAULT 'idle',
    created_at       TEXT    NOT NULL,
    last_used        TEXT,
    FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS proxies (
    id           TEXT PRIMARY KEY,
    name         TEXT    NOT NULL,
    proxy_type   TEXT    NOT NULL,           -- http | https | socks5
    host         TEXT    NOT NULL,
    port         INTEGER NOT NULL,
    username     TEXT,
    password_enc TEXT,                       -- AES-GCM encrypted, base64
    country      TEXT,
    healthy      INTEGER NOT NULL DEFAULT 0,
    latency_ms   INTEGER,
    last_checked TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    profile_id  TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    har_path    TEXT,
    trace_path  TEXT,
    entropy_log TEXT,                        -- JSON EntropyLog blob
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_profile ON sessions(profile_id);
CREATE INDEX IF NOT EXISTS idx_profiles_status  ON profiles(status);
"#;

// ── Database handle ───────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Db {
    inner: Arc<Mutex<DbInner>>,
}

struct DbInner {
    conn: Connection,
    cipher: Option<Aes256Gcm>,
}

impl Db {
    /// Open an in-memory SQLite database (test helper only).
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = rusqlite::Connection::open_in_memory()?;
        let db = Self {
            inner: Arc::new(Mutex::new(DbInner { conn, cipher: None })),
        };
        db.migrate()?;
        Ok(db)
    }

    /// Open an in-memory SQLite database with AES-GCM encryption (test helper only).
    #[cfg(test)]
    pub fn open_in_memory_with_key(master_key: &str) -> Result<Self> {
        let conn = rusqlite::Connection::open_in_memory()?;
        let cipher = Some(derive_cipher(master_key));
        let db = Self {
            inner: Arc::new(Mutex::new(DbInner { conn, cipher })),
        };
        db.migrate()?;
        Ok(db)
    }

    /// Open (or create) the Manifold database at `path`.
    ///
    /// `master_key` is used to derive the AES-256-GCM key for sensitive fields.
    /// Pass `None` to skip application-level encryption (not recommended for
    /// production use).
    pub fn open(path: &Path, master_key: Option<&str>) -> Result<Self> {
        std::fs::create_dir_all(path.parent().unwrap_or_else(|| Path::new(".")))?;

        let conn = Connection::open(path)?;

        // ── SQLCipher disk-level encryption (opt-in via Cargo feature) ────────
        // Uncomment when building with "bundled-sqlcipher-vendored-openssl":
        //
        // if let Some(key) = master_key {
        //     conn.execute_batch(&format!(
        //         "PRAGMA key = '{}';",
        //         key.replace('\'', "''")
        //     ))?;
        // }

        let cipher = master_key.map(|k| derive_cipher(k));

        let inner = DbInner { conn, cipher };
        let db = Self {
            inner: Arc::new(Mutex::new(inner)),
        };

        db.migrate()?;
        Ok(db)
    }

    // ── Schema migration ──────────────────────────────────────────────────────

    fn migrate(&self) -> Result<()> {
        let guard = self.inner.lock().unwrap();
        guard.conn.execute_batch(SCHEMA_SQL)?;

        let current: u32 = guard
            .conn
            .query_row("SELECT version FROM schema_version LIMIT 1", [], |r| {
                r.get(0)
            })
            .unwrap_or(0);

        if current < SCHEMA_VERSION {
            guard.conn.execute("DELETE FROM schema_version", [])?;
            guard.conn.execute(
                "INSERT INTO schema_version (version) VALUES (?1)",
                params![SCHEMA_VERSION],
            )?;
        }

        Ok(())
    }

    // ── Raw connection access (for repositories) ──────────────────────────────

    /// Run a closure with exclusive access to the underlying `Connection`.
    pub fn with_conn<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T>,
    {
        let guard = self.inner.lock().unwrap();
        f(&guard.conn)
    }

    // ── Application-level field encryption helpers ────────────────────────────

    /// Encrypt `plaintext` to a base64 string (nonce prepended).
    /// Returns `plaintext` unchanged if no master key was supplied.
    pub fn encrypt_field(&self, plaintext: &str) -> Result<String> {
        let guard = self.inner.lock().unwrap();
        match &guard.cipher {
            None => Ok(plaintext.to_string()),
            Some(cipher) => {
                let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
                let ciphertext = cipher
                    .encrypt(&nonce, plaintext.as_bytes())
                    .map_err(|e| ManifoldError::Crypto(e.to_string()))?;

                // Store as base64(nonce || ciphertext)
                let mut combined = nonce.to_vec();
                combined.extend_from_slice(&ciphertext);
                Ok(B64.encode(combined))
            }
        }
    }

    /// Decrypt a base64 field produced by `encrypt_field`.
    /// Returns `ciphertext` unchanged if no master key was supplied.
    pub fn decrypt_field(&self, ciphertext: &str) -> Result<String> {
        let guard = self.inner.lock().unwrap();
        match &guard.cipher {
            None => Ok(ciphertext.to_string()),
            Some(cipher) => {
                let combined = B64
                    .decode(ciphertext)
                    .map_err(|e| ManifoldError::Crypto(e.to_string()))?;

                if combined.len() < 12 {
                    return Err(ManifoldError::Crypto("encrypted field too short".into()));
                }

                let (nonce_bytes, ct) = combined.split_at(12);
                let nonce = Nonce::from_slice(nonce_bytes);
                let plaintext = cipher
                    .decrypt(nonce, ct)
                    .map_err(|e| ManifoldError::Crypto(e.to_string()))?;

                String::from_utf8(plaintext).map_err(|e| ManifoldError::Crypto(e.to_string()))
            }
        }
    }

    /// Convenience: encrypt only if the value is Some.
    pub fn encrypt_opt(&self, value: Option<&str>) -> Result<Option<String>> {
        match value {
            None => Ok(None),
            Some(v) => Ok(Some(self.encrypt_field(v)?)),
        }
    }

    /// Convenience: decrypt only if the value is Some.
    pub fn decrypt_opt(&self, value: Option<String>) -> Result<Option<String>> {
        match value {
            None => Ok(None),
            Some(v) => Ok(Some(self.decrypt_field(&v)?)),
        }
    }
}

// ── Key derivation ────────────────────────────────────────────────────────────

/// Derive a stable AES-256-GCM key from a master passphrase using Argon2id
/// with a fixed application salt (not secret — just domain separation).
fn derive_cipher(master_key: &str) -> Aes256Gcm {
    // Fixed salt: prevents the same password hashing to the same key in
    // unrelated applications, but is deterministic so the DB can be reopened.
    const FIXED_SALT: &[u8] = b"manifold-db-v1-salt-2025";

    let salt_b64 = B64.encode(FIXED_SALT);
    let salt = SaltString::from_b64(&salt_b64).unwrap_or_else(|_| SaltString::generate(&mut OsRng));

    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(master_key.as_bytes(), &salt)
        .expect("argon2 key derivation failed");

    // The Argon2 output hash is 32 bytes (256 bits) — perfect for AES-256.
    let hash_bytes = hash.hash.expect("argon2 produced no hash");
    let key_bytes: [u8; 32] = hash_bytes
        .as_bytes()
        .try_into()
        .expect("argon2 hash is not 32 bytes");

    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    Aes256Gcm::new(key)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Schema / lifecycle ────────────────────────────────────────────────────

    #[test]
    fn open_in_memory_creates_schema() {
        let db = Db::open_in_memory().unwrap();
        // profiles, proxies, sessions tables must exist
        db.with_conn(|conn| {
            for table in &["profiles", "proxies", "sessions", "schema_version"] {
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    rusqlite::params![table],
                    |r| r.get(0),
                )?;
                assert_eq!(count, 1, "table {table} missing");
            }
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn schema_version_is_set() {
        let db = Db::open_in_memory().unwrap();
        let version: u32 = db
            .with_conn(|conn| {
                Ok(
                    conn.query_row("SELECT version FROM schema_version LIMIT 1", [], |r| {
                        r.get(0)
                    })?,
                )
            })
            .unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn double_migrate_is_idempotent() {
        let db = Db::open_in_memory().unwrap();
        // Calling migrate a second time must not panic or corrupt the version
        db.with_conn(|conn| {
            conn.execute_batch(super::SCHEMA_SQL)?;
            Ok(())
        })
        .unwrap();
        let version: u32 = db
            .with_conn(|conn| {
                Ok(
                    conn.query_row("SELECT version FROM schema_version LIMIT 1", [], |r| {
                        r.get(0)
                    })?,
                )
            })
            .unwrap();
        assert_eq!(version, 1);
    }

    // ── Passthrough (no master key) ───────────────────────────────────────────

    #[test]
    fn encrypt_decrypt_passthrough_no_key() {
        let db = Db::open_in_memory().unwrap();
        let plain = "super_secret_password";
        let enc = db.encrypt_field(plain).unwrap();
        assert_eq!(enc, plain, "no-key mode must return plaintext unchanged");
        let dec = db.decrypt_field(&enc).unwrap();
        assert_eq!(dec, plain);
    }

    #[test]
    fn encrypt_opt_none_passthrough() {
        let db = Db::open_in_memory().unwrap();
        let result = db.encrypt_opt(None).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn encrypt_opt_some_passthrough() {
        let db = Db::open_in_memory().unwrap();
        let result = db.encrypt_opt(Some("value")).unwrap();
        assert_eq!(result, Some("value".to_string()));
    }

    #[test]
    fn decrypt_opt_none_passthrough() {
        let db = Db::open_in_memory().unwrap();
        let result = db.decrypt_opt(None).unwrap();
        assert!(result.is_none());
    }

    // ── AES-GCM encryption ────────────────────────────────────────────────────

    #[test]
    fn encrypt_decrypt_roundtrip_with_key() {
        let db = Db::open_in_memory_with_key("test_master_key_abc").unwrap();
        let plain = "my_proxy_password_123!";
        let enc = db.encrypt_field(plain).unwrap();
        assert_ne!(enc, plain, "ciphertext must differ from plaintext");
        let dec = db.decrypt_field(&enc).unwrap();
        assert_eq!(dec, plain);
    }

    #[test]
    fn different_encryptions_of_same_plaintext_differ() {
        // Each call uses a fresh nonce, so ciphertexts must be distinct
        let db = Db::open_in_memory_with_key("key").unwrap();
        let a = db.encrypt_field("hello").unwrap();
        let b = db.encrypt_field("hello").unwrap();
        assert_ne!(a, b, "each encryption must use a unique nonce");
    }

    #[test]
    fn decrypt_corrupted_data_returns_error() {
        let db = Db::open_in_memory_with_key("key").unwrap();
        // A random base64 string that is not valid ciphertext
        let garbage = "dGhpcyBpcyBub3QgYSB2YWxpZCBjaXBoZXJ0ZXh0";
        let result = db.decrypt_field(garbage);
        assert!(result.is_err(), "corrupted ciphertext must return an error");
    }

    #[test]
    fn decrypt_too_short_field_returns_error() {
        let db = Db::open_in_memory_with_key("key").unwrap();
        // Base64 of 5 bytes — shorter than the 12-byte nonce
        use base64::{engine::general_purpose::STANDARD as B64, Engine};
        let short = B64.encode(b"short");
        let result = db.decrypt_field(&short);
        assert!(result.is_err());
    }

    #[test]
    fn encrypt_opt_some_with_key() {
        let db = Db::open_in_memory_with_key("key").unwrap();
        let enc = db.encrypt_opt(Some("secret")).unwrap();
        assert!(enc.is_some());
        assert_ne!(enc.as_deref(), Some("secret"));
        let dec = db.decrypt_opt(enc).unwrap();
        assert_eq!(dec, Some("secret".to_string()));
    }

    #[test]
    fn same_key_produces_same_cipher_key_material() {
        // Two Db instances with the same master key must be able to decrypt
        // each other's ciphertexts (deterministic KDF).
        let db1 = Db::open_in_memory_with_key("shared_key").unwrap();
        let db2 = Db::open_in_memory_with_key("shared_key").unwrap();
        let plain = "cross_instance_test";
        let enc = db1.encrypt_field(plain).unwrap();
        let dec = db2.decrypt_field(&enc).unwrap();
        assert_eq!(dec, plain);
    }

    #[test]
    fn different_keys_cannot_decrypt_each_others_ciphertexts() {
        let db1 = Db::open_in_memory_with_key("key_alpha").unwrap();
        let db2 = Db::open_in_memory_with_key("key_beta").unwrap();
        let enc = db1.encrypt_field("data").unwrap();
        let result = db2.decrypt_field(&enc);
        assert!(result.is_err(), "wrong key must fail to decrypt");
    }
}

// ── Path helpers ──────────────────────────────────────────────────────────────

/// Resolve the default database path:
///   $APPDATA/manifold/manifold.db   (Windows)
///   ~/.local/share/manifold/manifold.db  (Linux)
///   ~/Library/Application Support/manifold/manifold.db  (macOS)
pub fn default_db_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("manifold")
        .join("manifold.db")
}

/// Resolve the profiles root directory (next to the binary / workspace root).
pub fn profiles_dir() -> PathBuf {
    // In dev: look for ./profiles relative to the workspace root
    let workspace = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let candidate = workspace.join("profiles");
    if candidate.exists() {
        return candidate;
    }

    // In production: next to the binary
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("profiles")))
        .unwrap_or_else(|| PathBuf::from("profiles"))
}
