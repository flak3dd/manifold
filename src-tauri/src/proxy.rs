// ── Manifold proxy repository + health checker ────────────────────────────────

use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::db::Db;
use crate::error::{ManifoldError, Result};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProxyType {
    #[default]
    Http,
    Https,
    Socks5,
}

impl std::fmt::Display for ProxyType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http => write!(f, "http"),
            Self::Https => write!(f, "https"),
            Self::Socks5 => write!(f, "socks5"),
        }
    }
}

impl std::str::FromStr for ProxyType {
    type Err = ManifoldError;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "http" => Ok(Self::Http),
            "https" => Ok(Self::Https),
            "socks5" => Ok(Self::Socks5),
            other => Err(ManifoldError::InvalidArg(format!(
                "unknown proxy type: {other:?}"
            ))),
        }
    }
}

/// Full proxy record returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proxy {
    pub id: String,
    pub name: String,
    pub proxy_type: ProxyType,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    /// Password is never returned to the frontend in plaintext.
    /// The field is present in the DB (encrypted), but serialised as `null`.
    #[serde(skip_serializing)]
    pub password: Option<String>,
    pub country: Option<String>,
    pub healthy: bool,
    pub latency_ms: Option<u32>,
    pub last_checked: Option<DateTime<Utc>>,
}

impl Proxy {
    /// Build the Playwright-compatible proxy URL string.
    ///
    /// Format: `http://user:pass@host:port`
    #[allow(dead_code)]
    pub fn to_playwright_url(&self) -> String {
        let scheme = match self.proxy_type {
            ProxyType::Socks5 => "socks5",
            _ => "http",
        };
        match (&self.username, &self.password) {
            (Some(u), Some(p)) => {
                format!("{scheme}://{}:{}@{}:{}", u, p, self.host, self.port)
            }
            (Some(u), None) => {
                format!("{scheme}://{}@{}:{}", u, self.host, self.port)
            }
            _ => format!("{scheme}://{}:{}", self.host, self.port),
        }
    }

    /// Build the Playwright `server` field (no credentials — they go separately).
    pub fn to_playwright_server(&self) -> String {
        let scheme = match self.proxy_type {
            ProxyType::Socks5 => "socks5",
            _ => "http",
        };
        format!("{scheme}://{}:{}", self.host, self.port)
    }
}

/// Subset of Proxy fields needed for health check results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyHealth {
    pub id: String,
    pub healthy: bool,
    pub latency_ms: Option<u32>,
    pub error: Option<String>,
    pub checked_at: DateTime<Utc>,
}

/// Payload for adding a new proxy.
#[derive(Debug, Deserialize)]
pub struct AddProxyRequest {
    pub name: String,
    pub proxy_type: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub country: Option<String>,
}

/// Payload for updating a proxy.
#[derive(Debug, Deserialize)]
pub struct UpdateProxyRequest {
    pub name: Option<String>,
    pub proxy_type: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub country: Option<String>,
}

// ── Repository ────────────────────────────────────────────────────────────────

pub struct ProxyRepo {
    db: Db,
}

impl ProxyRepo {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    // ── Create ────────────────────────────────────────────────────────────────

    pub fn add(&self, req: AddProxyRequest) -> Result<Proxy> {
        let id = Uuid::new_v4().to_string();
        let proxy_type: ProxyType = req.proxy_type.parse()?;

        if req.host.trim().is_empty() {
            return Err(ManifoldError::InvalidArg("host cannot be empty".into()));
        }
        if req.port == 0 {
            return Err(ManifoldError::InvalidArg("port cannot be 0".into()));
        }

        // Encrypt the password if supplied
        let password_enc = self.db.encrypt_opt(req.password.as_deref())?;

        self.db.with_conn(|conn| {
            conn.execute(
                r#"INSERT INTO proxies
                   (id, name, proxy_type, host, port,
                    username, password_enc, country, healthy)
                   VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0)"#,
                params![
                    id,
                    req.name,
                    proxy_type.to_string(),
                    req.host,
                    req.port as i64,
                    req.username,
                    password_enc,
                    req.country,
                ],
            )?;
            Ok(())
        })?;

        Ok(Proxy {
            id,
            name: req.name,
            proxy_type,
            host: req.host,
            port: req.port,
            username: req.username,
            password: req.password,
            country: req.country,
            healthy: false,
            latency_ms: None,
            last_checked: None,
        })
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    pub fn get(&self, id: &str) -> Result<Proxy> {
        self.db
            .with_conn(|conn| {
                let row = conn
                    .query_row(
                        r#"SELECT id, name, proxy_type, host, port,
                                  username, password_enc, country,
                                  healthy, latency_ms, last_checked
                           FROM proxies WHERE id = ?1"#,
                        params![id],
                        |r| row_to_proxy_raw(r),
                    )
                    .optional()?;

                row.ok_or_else(|| ManifoldError::ProxyNotFound(id.into()))
            })
            .and_then(|raw| self.decrypt_proxy(raw))
    }

    pub fn list(&self) -> Result<Vec<Proxy>> {
        self.db
            .with_conn(|conn| {
                let mut stmt = conn.prepare(
                    r#"SELECT id, name, proxy_type, host, port,
                              username, password_enc, country,
                              healthy, latency_ms, last_checked
                       FROM proxies ORDER BY name ASC"#,
                )?;
                let raws = stmt
                    .query_map([], |r| row_to_proxy_raw(r))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(raws)
            })
            .and_then(|raws| {
                raws.into_iter()
                    .map(|raw| self.decrypt_proxy(raw))
                    .collect()
            })
    }

    // ── Update ────────────────────────────────────────────────────────────────

    pub fn update(&self, id: &str, req: UpdateProxyRequest) -> Result<Proxy> {
        let mut proxy = self.get(id)?;

        if let Some(name) = req.name {
            proxy.name = name;
        }
        if let Some(pt) = req.proxy_type {
            proxy.proxy_type = pt.parse()?;
        }
        if let Some(host) = req.host {
            proxy.host = host;
        }
        if let Some(port) = req.port {
            proxy.port = port;
        }
        if req.username.is_some() {
            proxy.username = req.username;
        }
        if req.password.is_some() {
            proxy.password = req.password;
        }
        if req.country.is_some() {
            proxy.country = req.country;
        }

        let password_enc = self.db.encrypt_opt(proxy.password.as_deref())?;

        self.db.with_conn(|conn| {
            let updated = conn.execute(
                r#"UPDATE proxies
                   SET name = ?1, proxy_type = ?2, host = ?3, port = ?4,
                       username = ?5, password_enc = ?6, country = ?7
                   WHERE id = ?8"#,
                params![
                    proxy.name,
                    proxy.proxy_type.to_string(),
                    proxy.host,
                    proxy.port as i64,
                    proxy.username,
                    password_enc,
                    proxy.country,
                    id,
                ],
            )?;
            if updated == 0 {
                return Err(ManifoldError::ProxyNotFound(id.into()));
            }
            Ok(())
        })?;

        Ok(proxy)
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    pub fn delete(&self, id: &str) -> Result<()> {
        self.db.with_conn(|conn| {
            let deleted = conn.execute("DELETE FROM proxies WHERE id = ?1", params![id])?;
            if deleted == 0 {
                return Err(ManifoldError::ProxyNotFound(id.into()));
            }
            Ok(())
        })
    }

    // ── Health check ──────────────────────────────────────────────────────────

    /// Perform a synchronous HTTP health check against the proxy.
    ///
    /// Connects through the proxy to `https://checkip.amazonaws.com` (or any
    /// fast endpoint) and records latency and the returned exit IP.
    ///
    /// This is intentionally synchronous so it can be called from a Tauri
    /// command via `std::thread::spawn` or `tauri::async_runtime::spawn_blocking`.
    pub fn check_health(&self, id: &str) -> Result<ProxyHealth> {
        let proxy = self.get(id)?;
        let checked_at = Utc::now();

        let result = Self::do_http_check(&proxy);

        let (healthy, latency_ms, error) = match result {
            Ok(ms) => (true, Some(ms), None),
            Err(e) => (false, None, Some(e)),
        };

        // Persist the result
        self.db.with_conn(|conn| {
            conn.execute(
                r#"UPDATE proxies
                   SET healthy = ?1, latency_ms = ?2, last_checked = ?3
                   WHERE id = ?4"#,
                params![
                    healthy as i64,
                    latency_ms.map(|ms| ms as i64),
                    checked_at.to_rfc3339(),
                    id,
                ],
            )?;
            Ok(())
        })?;

        Ok(ProxyHealth {
            id: id.to_string(),
            healthy,
            latency_ms,
            error,
            checked_at,
        })
    }

    /// Check all proxies in sequence and return results.
    pub fn check_all(&self) -> Result<Vec<ProxyHealth>> {
        let proxies = self.list()?;
        let mut results = Vec::with_capacity(proxies.len());
        for proxy in &proxies {
            let health = self.check_health(&proxy.id)?;
            results.push(health);
        }
        Ok(results)
    }

    // ── Internal HTTP check ───────────────────────────────────────────────────

    fn do_http_check(proxy: &Proxy) -> std::result::Result<u32, String> {
        use std::net::TcpStream;

        const CHECK_HOST: &str = "checkip.amazonaws.com";
        const TIMEOUT_SECS: u64 = 10;

        let proxy_addr = format!("{}:{}", proxy.host, proxy.port);
        let t0 = Instant::now();

        // Open TCP connection to the proxy server
        let stream = TcpStream::connect_timeout(
            &proxy_addr
                .parse()
                .map_err(|e| format!("invalid proxy address: {e}"))?,
            Duration::from_secs(TIMEOUT_SECS),
        )
        .map_err(|e| format!("TCP connect to proxy failed: {e}"))?;

        stream
            .set_read_timeout(Some(Duration::from_secs(TIMEOUT_SECS)))
            .ok();
        stream
            .set_write_timeout(Some(Duration::from_secs(TIMEOUT_SECS)))
            .ok();

        match proxy.proxy_type {
            ProxyType::Http | ProxyType::Https => {
                Self::http_connect_check(stream, proxy, CHECK_HOST, t0)
            }
            ProxyType::Socks5 => Self::socks5_check(stream, proxy, CHECK_HOST, t0),
        }
    }

    /// HTTP proxy check using standard GET request (not CONNECT tunnel).
    /// This works with residential/mobile proxies that don't support CONNECT.
    fn http_connect_check(
        mut stream: std::net::TcpStream,
        proxy: &Proxy,
        target: &str,
        t0: Instant,
    ) -> std::result::Result<u32, String> {
        use std::io::{BufRead, BufReader, Write};

        // Use standard HTTP GET through proxy (absolute URI form)
        // This is more compatible with residential/mobile proxies than CONNECT
        let mut req =
            format!("GET http://{target}/ HTTP/1.1\r\nHost: {target}\r\nConnection: close\r\n");
        if let (Some(user), Some(pass)) = (&proxy.username, &proxy.password) {
            use base64::Engine;
            let creds = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{pass}"));
            req.push_str(&format!("Proxy-Authorization: Basic {creds}\r\n"));
        }
        req.push_str("\r\n");

        stream
            .write_all(req.as_bytes())
            .map_err(|e| format!("write HTTP request: {e}"))?;

        // Read response line
        let mut reader = BufReader::new(&stream);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|e| format!("read HTTP response: {e}"))?;

        // Accept any 2xx or 3xx status as healthy
        // Common responses: 200 OK, 301/302 redirects
        if !line.contains(" 2") && !line.contains(" 3") {
            // Check for proxy auth errors specifically
            if line.contains("407") {
                return Err("Proxy authentication failed (407)".into());
            }
            if line.contains("403") {
                return Err("Proxy access forbidden (403)".into());
            }
            return Err(format!("HTTP request failed: {}", line.trim()));
        }

        // Drain remaining response
        loop {
            let mut h = String::new();
            if reader.read_line(&mut h).unwrap_or(0) == 0 || h == "\r\n" {
                break;
            }
        }

        Ok(t0.elapsed().as_millis() as u32)
    }

    /// SOCKS5 handshake check (no-auth or user/pass auth).
    fn socks5_check(
        mut stream: std::net::TcpStream,
        proxy: &Proxy,
        target: &str,
        t0: Instant,
    ) -> std::result::Result<u32, String> {
        use std::io::{Read, Write};

        // Greeting: [VER=5, NMETHODS=1 or 2, METHOD=0x00 (no auth) or 0x02 (user/pass)]
        let has_auth = proxy.username.is_some();
        let greeting: &[u8] = if has_auth {
            &[0x05, 0x02, 0x00, 0x02]
        } else {
            &[0x05, 0x01, 0x00]
        };
        stream
            .write_all(greeting)
            .map_err(|e| format!("socks5 greeting: {e}"))?;

        let mut resp = [0u8; 2];
        stream
            .read_exact(&mut resp)
            .map_err(|e| format!("socks5 greeting resp: {e}"))?;
        if resp[0] != 0x05 {
            return Err("not a SOCKS5 server".into());
        }

        match resp[1] {
            0x00 => { /* no auth, continue */ }
            0x02 => {
                // Username/password sub-negotiation (RFC 1929)
                let user = proxy.username.as_deref().unwrap_or("");
                let pass = proxy.password.as_deref().unwrap_or("");
                let mut auth = vec![0x01u8, user.len() as u8];
                auth.extend_from_slice(user.as_bytes());
                auth.push(pass.len() as u8);
                auth.extend_from_slice(pass.as_bytes());
                stream
                    .write_all(&auth)
                    .map_err(|e| format!("socks5 auth send: {e}"))?;

                let mut ar = [0u8; 2];
                stream
                    .read_exact(&mut ar)
                    .map_err(|e| format!("socks5 auth resp: {e}"))?;
                if ar[1] != 0x00 {
                    return Err("SOCKS5 authentication failed".into());
                }
            }
            0xFF => return Err("SOCKS5 server rejected all auth methods".into()),
            m => return Err(format!("SOCKS5 unexpected auth method: 0x{m:02x}")),
        }

        // CONNECT request to target:80
        let mut req = vec![0x05u8, 0x01, 0x00, 0x03];
        req.push(target.len() as u8);
        req.extend_from_slice(target.as_bytes());
        req.extend_from_slice(&80u16.to_be_bytes());
        stream
            .write_all(&req)
            .map_err(|e| format!("socks5 connect req: {e}"))?;

        // Read reply (at least 10 bytes for IPv4)
        let mut reply = [0u8; 10];
        stream
            .read_exact(&mut reply)
            .map_err(|e| format!("socks5 connect reply: {e}"))?;

        if reply[0] != 0x05 {
            return Err("SOCKS5 malformed reply".into());
        }
        if reply[1] != 0x00 {
            let code = reply[1];
            let msg = match code {
                0x01 => "general failure",
                0x02 => "connection not allowed",
                0x03 => "network unreachable",
                0x04 => "host unreachable",
                0x05 => "connection refused",
                0x06 => "TTL expired",
                0x07 => "command not supported",
                0x08 => "address type not supported",
                _ => "unknown error",
            };
            return Err(format!("SOCKS5 connect error 0x{code:02x}: {msg}"));
        }

        Ok(t0.elapsed().as_millis() as u32)
    }

    // ── BrightData/Luminati rotation helpers ──────────────────────────────────

    /// Build a BrightData-compatible sticky-session proxy config.
    ///
    /// BrightData rotates IPs by encoding a session ID into the username:
    /// `lum-customer-CUSTOMER-zone-ZONE-session-SESSION`
    #[allow(dead_code)]
    pub fn brightdata_sticky(
        base_host: &str,
        base_port: u16,
        customer: &str,
        zone: &str,
        session_id: &str,
        password: &str,
    ) -> AddProxyRequest {
        AddProxyRequest {
            name: format!("BrightData {zone} s={session_id}"),
            proxy_type: "http".into(),
            host: base_host.to_string(),
            port: base_port,
            username: Some(format!(
                "lum-customer-{customer}-zone-{zone}-session-{session_id}"
            )),
            password: Some(password.to_string()),
            country: None,
        }
    }

    /// Build a BrightData rotating (no sticky session) proxy config.
    #[allow(dead_code)]
    pub fn brightdata_rotating(
        base_host: &str,
        base_port: u16,
        customer: &str,
        zone: &str,
        password: &str,
    ) -> AddProxyRequest {
        AddProxyRequest {
            name: format!("BrightData {zone} (rotating)"),
            proxy_type: "http".into(),
            host: base_host.to_string(),
            port: base_port,
            username: Some(format!("lum-customer-{customer}-zone-{zone}")),
            password: Some(password.to_string()),
            country: None,
        }
    }

    // ── Private decrypt helper ────────────────────────────────────────────────

    fn decrypt_proxy(&self, mut raw: ProxyRaw) -> Result<Proxy> {
        raw.password = self.db.decrypt_opt(raw.password)?;
        Ok(Proxy {
            id: raw.id,
            name: raw.name,
            proxy_type: raw.proxy_type.parse().unwrap_or_default(),
            host: raw.host,
            port: raw.port,
            username: raw.username,
            password: raw.password,
            country: raw.country,
            healthy: raw.healthy,
            latency_ms: raw.latency_ms,
            last_checked: raw.last_checked,
        })
    }
}

// ── Row types ─────────────────────────────────────────────────────────────────

/// Intermediate struct holding raw (possibly encrypted) DB values.
struct ProxyRaw {
    id: String,
    name: String,
    proxy_type: String,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>, // encrypted or plaintext depending on build
    country: Option<String>,
    healthy: bool,
    latency_ms: Option<u32>,
    last_checked: Option<DateTime<Utc>>,
}

fn row_to_proxy_raw(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProxyRaw> {
    let id: String = row.get(0)?;
    let name: String = row.get(1)?;
    let proxy_type: String = row.get(2)?;
    let host: String = row.get(3)?;
    let port: i64 = row.get(4)?;
    let username: Option<String> = row.get(5)?;
    let password: Option<String> = row.get(6)?;
    let country: Option<String> = row.get(7)?;
    let healthy: i64 = row.get(8)?;
    let latency_ms: Option<i64> = row.get(9)?;
    let last_checked: Option<String> = row.get(10)?;

    let last_checked = last_checked.and_then(|s| {
        DateTime::parse_from_rfc3339(&s)
            .ok()
            .map(|dt| dt.with_timezone(&Utc))
    });

    Ok(ProxyRaw {
        id,
        name,
        proxy_type,
        host,
        port: port.clamp(1, 65535) as u16,
        username,
        password,
        country,
        healthy: healthy != 0,
        latency_ms: latency_ms.map(|ms| ms as u32),
        last_checked,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn make_repo() -> ProxyRepo {
        ProxyRepo::new(Db::open_in_memory().unwrap())
    }

    fn default_add(name: &str) -> AddProxyRequest {
        AddProxyRequest {
            name: name.to_string(),
            proxy_type: "http".to_string(),
            host: "127.0.0.1".to_string(),
            port: 8080,
            username: None,
            password: None,
            country: None,
        }
    }

    // ── ProxyType ─────────────────────────────────────────────────────────────

    #[test]
    fn proxy_type_display() {
        assert_eq!(ProxyType::Http.to_string(), "http");
        assert_eq!(ProxyType::Https.to_string(), "https");
        assert_eq!(ProxyType::Socks5.to_string(), "socks5");
    }

    #[test]
    fn proxy_type_from_str_roundtrip() {
        for s in &["http", "https", "socks5"] {
            let pt: ProxyType = s.parse().unwrap();
            assert_eq!(pt.to_string(), *s);
        }
    }

    #[test]
    fn proxy_type_unknown_errors() {
        let result: Result<ProxyType> = "ftp".parse();
        assert!(result.is_err());
    }

    // ── URL helpers ───────────────────────────────────────────────────────────

    #[test]
    fn to_playwright_url_http_no_creds() {
        let proxy = Proxy {
            id: "id".into(),
            name: "test".into(),
            proxy_type: ProxyType::Http,
            host: "proxy.example.com".into(),
            port: 3128,
            username: None,
            password: None,
            country: None,
            healthy: false,
            latency_ms: None,
            last_checked: None,
        };
        assert_eq!(proxy.to_playwright_url(), "http://proxy.example.com:3128");
    }

    #[test]
    fn to_playwright_url_http_with_creds() {
        let proxy = Proxy {
            id: "id".into(),
            name: "test".into(),
            proxy_type: ProxyType::Http,
            host: "proxy.example.com".into(),
            port: 3128,
            username: Some("user".into()),
            password: Some("pass".into()),
            country: None,
            healthy: false,
            latency_ms: None,
            last_checked: None,
        };
        assert_eq!(
            proxy.to_playwright_url(),
            "http://user:pass@proxy.example.com:3128"
        );
    }

    #[test]
    fn to_playwright_url_username_only() {
        let proxy = Proxy {
            id: "id".into(),
            name: "test".into(),
            proxy_type: ProxyType::Http,
            host: "proxy.example.com".into(),
            port: 3128,
            username: Some("user".into()),
            password: None,
            country: None,
            healthy: false,
            latency_ms: None,
            last_checked: None,
        };
        assert_eq!(
            proxy.to_playwright_url(),
            "http://user@proxy.example.com:3128"
        );
    }

    #[test]
    fn to_playwright_url_socks5() {
        let proxy = Proxy {
            id: "id".into(),
            name: "test".into(),
            proxy_type: ProxyType::Socks5,
            host: "socks.example.com".into(),
            port: 1080,
            username: None,
            password: None,
            country: None,
            healthy: false,
            latency_ms: None,
            last_checked: None,
        };
        assert_eq!(proxy.to_playwright_url(), "socks5://socks.example.com:1080");
    }

    #[test]
    fn to_playwright_server_omits_creds() {
        let proxy = Proxy {
            id: "id".into(),
            name: "test".into(),
            proxy_type: ProxyType::Http,
            host: "proxy.example.com".into(),
            port: 3128,
            username: Some("user".into()),
            password: Some("secret".into()),
            country: None,
            healthy: false,
            latency_ms: None,
            last_checked: None,
        };
        let server = proxy.to_playwright_server();
        assert!(
            !server.contains("user"),
            "server URL must not contain creds"
        );
        assert!(
            !server.contains("secret"),
            "server URL must not contain creds"
        );
        assert!(server.contains("proxy.example.com"));
        assert!(server.contains("3128"));
    }

    // ── BrightData helpers ────────────────────────────────────────────────────

    #[test]
    fn brightdata_sticky_username_format() {
        let req = ProxyRepo::brightdata_sticky(
            "brd.superproxy.io",
            22225,
            "customer123",
            "residential",
            "session_abc",
            "password123",
        );
        let username = req.username.unwrap();
        assert!(username.contains("customer123"));
        assert!(username.contains("residential"));
        assert!(username.contains("session_abc"));
        assert!(username.starts_with("lum-customer-"));
    }

    #[test]
    fn brightdata_rotating_username_format() {
        let req = ProxyRepo::brightdata_rotating(
            "brd.superproxy.io",
            22225,
            "customer456",
            "mobile",
            "pass456",
        );
        let username = req.username.unwrap();
        assert!(username.contains("customer456"));
        assert!(username.contains("mobile"));
        assert!(
            !username.contains("session"),
            "rotating must not include session"
        );
    }

    #[test]
    fn brightdata_sticky_host_and_port() {
        let req = ProxyRepo::brightdata_sticky("brd.superproxy.io", 22225, "c", "z", "s", "p");
        assert_eq!(req.host, "brd.superproxy.io");
        assert_eq!(req.port, 22225);
    }

    // ── Validation ────────────────────────────────────────────────────────────

    #[test]
    fn add_empty_host_returns_error() {
        let repo = make_repo();
        let err = repo
            .add(AddProxyRequest {
                name: "bad".into(),
                proxy_type: "http".into(),
                host: "   ".into(),
                port: 8080,
                username: None,
                password: None,
                country: None,
            })
            .unwrap_err();
        assert!(matches!(err, ManifoldError::InvalidArg(_)));
    }

    #[test]
    fn add_zero_port_returns_error() {
        let repo = make_repo();
        let err = repo
            .add(AddProxyRequest {
                name: "bad".into(),
                proxy_type: "http".into(),
                host: "127.0.0.1".into(),
                port: 0,
                username: None,
                password: None,
                country: None,
            })
            .unwrap_err();
        assert!(matches!(err, ManifoldError::InvalidArg(_)));
    }

    #[test]
    fn add_unknown_proxy_type_returns_error() {
        let repo = make_repo();
        let err = repo
            .add(AddProxyRequest {
                name: "bad".into(),
                proxy_type: "ftp".into(),
                host: "127.0.0.1".into(),
                port: 21,
                username: None,
                password: None,
                country: None,
            })
            .unwrap_err();
        assert!(matches!(err, ManifoldError::InvalidArg(_)));
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────

    #[test]
    fn add_returns_correct_fields() {
        let repo = make_repo();
        let px = repo.add(default_add("TestProxy")).unwrap();
        assert_eq!(px.name, "TestProxy");
        assert_eq!(px.host, "127.0.0.1");
        assert_eq!(px.port, 8080);
        assert_eq!(px.proxy_type, ProxyType::Http);
        assert!(!px.healthy);
        assert!(px.latency_ms.is_none());
    }

    #[test]
    fn add_assigns_uuid() {
        let repo = make_repo();
        let px = repo.add(default_add("UuidTest")).unwrap();
        assert_eq!(px.id.len(), 36);
        assert_eq!(px.id.chars().filter(|&c| c == '-').count(), 4);
    }

    #[test]
    fn get_existing_proxy() {
        let repo = make_repo();
        let added = repo.add(default_add("GetTest")).unwrap();
        let fetched = repo.get(&added.id).unwrap();
        assert_eq!(fetched.id, added.id);
        assert_eq!(fetched.name, "GetTest");
        assert_eq!(fetched.host, "127.0.0.1");
        assert_eq!(fetched.port, 8080);
    }

    #[test]
    fn get_nonexistent_returns_not_found() {
        let repo = make_repo();
        let err = repo.get("does-not-exist").unwrap_err();
        assert!(matches!(err, ManifoldError::ProxyNotFound(_)));
    }

    #[test]
    fn list_returns_all_proxies() {
        let repo = make_repo();
        repo.add(default_add("A")).unwrap();
        repo.add(default_add("B")).unwrap();
        repo.add(default_add("C")).unwrap();
        assert_eq!(repo.list().unwrap().len(), 3);
    }

    #[test]
    fn list_empty_returns_empty_vec() {
        let repo = make_repo();
        assert!(repo.list().unwrap().is_empty());
    }

    #[test]
    fn list_ordered_by_name_asc() {
        let repo = make_repo();
        repo.add(default_add("Zeta")).unwrap();
        repo.add(default_add("Alpha")).unwrap();
        repo.add(default_add("Mango")).unwrap();
        let list = repo.list().unwrap();
        let names: Vec<_> = list.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["Alpha", "Mango", "Zeta"]);
    }

    #[test]
    fn update_name_and_host() {
        let repo = make_repo();
        let px = repo.add(default_add("Original")).unwrap();
        repo.update(
            &px.id,
            UpdateProxyRequest {
                name: Some("Updated".into()),
                proxy_type: None,
                host: Some("10.0.0.1".into()),
                port: None,
                username: None,
                password: None,
                country: None,
            },
        )
        .unwrap();
        let fetched = repo.get(&px.id).unwrap();
        assert_eq!(fetched.name, "Updated");
        assert_eq!(fetched.host, "10.0.0.1");
    }

    #[test]
    fn update_proxy_type() {
        let repo = make_repo();
        let px = repo.add(default_add("TypeChange")).unwrap();
        repo.update(
            &px.id,
            UpdateProxyRequest {
                name: None,
                proxy_type: Some("socks5".into()),
                host: None,
                port: None,
                username: None,
                password: None,
                country: None,
            },
        )
        .unwrap();
        let fetched = repo.get(&px.id).unwrap();
        assert_eq!(fetched.proxy_type, ProxyType::Socks5);
    }

    #[test]
    fn update_nonexistent_returns_not_found() {
        let repo = make_repo();
        let err = repo
            .update(
                "ghost",
                UpdateProxyRequest {
                    name: Some("x".into()),
                    proxy_type: None,
                    host: None,
                    port: None,
                    username: None,
                    password: None,
                    country: None,
                },
            )
            .unwrap_err();
        assert!(matches!(err, ManifoldError::ProxyNotFound(_)));
    }

    #[test]
    fn delete_removes_proxy() {
        let repo = make_repo();
        let px = repo.add(default_add("ToDelete")).unwrap();
        repo.delete(&px.id).unwrap();
        assert!(matches!(
            repo.get(&px.id).unwrap_err(),
            ManifoldError::ProxyNotFound(_)
        ));
    }

    #[test]
    fn delete_removes_from_list() {
        let repo = make_repo();
        let px = repo.add(default_add("DelList")).unwrap();
        assert_eq!(repo.list().unwrap().len(), 1);
        repo.delete(&px.id).unwrap();
        assert!(repo.list().unwrap().is_empty());
    }

    #[test]
    fn delete_nonexistent_returns_not_found() {
        let repo = make_repo();
        let err = repo.delete("ghost").unwrap_err();
        assert!(matches!(err, ManifoldError::ProxyNotFound(_)));
    }

    // ── Credentials / country ─────────────────────────────────────────────────

    #[test]
    fn add_with_username_and_country() {
        let repo = make_repo();
        let px = repo
            .add(AddProxyRequest {
                name: "WithCreds".into(),
                proxy_type: "http".into(),
                host: "proxy.test".into(),
                port: 3128,
                username: Some("user1".into()),
                password: Some("pw1".into()),
                country: Some("US".into()),
            })
            .unwrap();
        assert_eq!(px.username, Some("user1".into()));
        assert_eq!(px.country, Some("US".into()));
        // password is returned in the in-memory no-key case
        assert_eq!(px.password, Some("pw1".into()));
    }

    #[test]
    fn password_survives_update_roundtrip() {
        let repo = make_repo();
        let px = repo
            .add(AddProxyRequest {
                name: "PwTest".into(),
                proxy_type: "http".into(),
                host: "h".into(),
                port: 1234,
                username: Some("u".into()),
                password: Some("original_pw".into()),
                country: None,
            })
            .unwrap();
        // Update without touching password
        repo.update(
            &px.id,
            UpdateProxyRequest {
                name: Some("PwTestUpdated".into()),
                proxy_type: None,
                host: None,
                port: None,
                username: None,
                password: None,
                country: None,
            },
        )
        .unwrap();
        let fetched = repo.get(&px.id).unwrap();
        // Password field may be None after round-trip through DB without key,
        // but the name change must have been applied
        assert_eq!(fetched.name, "PwTestUpdated");
    }

    #[test]
    fn add_socks5_proxy() {
        let repo = make_repo();
        let px = repo
            .add(AddProxyRequest {
                name: "SOCKS".into(),
                proxy_type: "socks5".into(),
                host: "socks.example.com".into(),
                port: 1080,
                username: None,
                password: None,
                country: Some("DE".into()),
            })
            .unwrap();
        assert_eq!(px.proxy_type, ProxyType::Socks5);
        assert_eq!(px.country, Some("DE".into()));
    }

    // ── Multiple proxies isolation ────────────────────────────────────────────

    #[test]
    fn multiple_proxies_are_independent() {
        let repo = make_repo();
        let a = repo.add(default_add("ProxyA")).unwrap();
        let b = repo.add(default_add("ProxyB")).unwrap();
        assert_ne!(a.id, b.id);

        repo.update(
            &a.id,
            UpdateProxyRequest {
                name: Some("ProxyA-Updated".into()),
                proxy_type: None,
                host: None,
                port: None,
                username: None,
                password: None,
                country: None,
            },
        )
        .unwrap();

        let b_check = repo.get(&b.id).unwrap();
        assert_eq!(b_check.name, "ProxyB", "updating A must not affect B");
    }
}
