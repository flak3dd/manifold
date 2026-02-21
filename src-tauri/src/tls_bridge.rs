use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_rustls::rustls::{ClientConfig, ServerConfig, RootCertStore};
use tokio_rustls::TlsConnector;
use rustls::crypto::ring::default_provider;
use webpki_roots::TLS_SERVER_ROOTS;

// ── TLS Bridge Configuration ───────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct TlsBridgeConfig {
    /// Seed for bridge identification
    pub seed: u64,
}

impl TlsBridgeConfig {
    pub fn new(seed: u64) -> Self {
        Self { seed }
    }
}

// ── TLS Bridge Server ───────────────────────────────────────────────────────

pub struct TlsBridge {
    /// TCP listener for incoming connections from Playwright
    listener: TcpListener,
    /// Bridge configuration
    config: TlsBridgeConfig,
    /// Active proxy connections
    active_connections: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
}

impl TlsBridge {
    /// Create new TLS bridge on specified port
    pub async fn new(port: u16, seed: u64) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let listener = TcpListener::bind(format!("127.0.0.1:{}", port))?;
        let config = TlsBridgeConfig::new(seed);

        println!("[tls-bridge] Started on port {} with seed: {}", port, seed);

        Ok(TlsBridge {
            listener,
            config,
            active_connections: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Start accepting connections
    pub async fn run(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        loop {
            let (client_stream, client_addr) = self.listener.accept().await?;
            let config = self.config.clone();
            let active_connections = self.active_connections.clone();

            let connection_id = format!("{}", client_addr);
            let handle = tokio::spawn(async move {
                if let Err(e) = Self::handle_connection(client_stream, config).await {
                    eprintln!("[tls-bridge] Connection error for {}: {}", connection_id, e);
                }

                // Clean up when done
                active_connections.lock().await.remove(&connection_id);
            });

            active_connections.lock().await.insert(connection_id, handle);
        }
    }

    /// Handle individual proxy connection
    async fn handle_connection(
        mut client_stream: std::net::TcpStream,
        _config: TlsBridgeConfig,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Convert to tokio stream
        let mut client_stream = TcpStream::from_std(client_stream)?;

        // Read CONNECT request from Playwright
        let mut buffer = [0u8; 4096];
        let n = client_stream.read(&mut buffer).await?;
        let request = String::from_utf8_lossy(&buffer[..n]);

        // Parse CONNECT request (e.g., "CONNECT example.com:443 HTTP/1.1")
        let lines: Vec<&str> = request.lines().collect();
        if lines.is_empty() || !lines[0].starts_with("CONNECT ") {
            return Err("Invalid CONNECT request".into());
        }

        let host_port: Vec<&str> = lines[0]
            .strip_prefix("CONNECT ")
            .and_then(|s| s.split(" ").next())
            .ok_or("Could not parse host:port")?
            .split(":")
            .collect();

        let host = host_port[0];
        let port: u16 = host_port.get(1).and_then(|p| p.parse().ok()).unwrap_or(443);

        // Respond with 200 Connection established
        client_stream.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await?;

        // Establish outbound connection (for now, direct connection without TLS fingerprinting)
        // TODO: Implement full TLS fingerprinting when rustls supports it
        let target_stream = TcpStream::connect((host, port)).await?;

        // Convert to tokio streams and proxy
        let mut client_stream = TcpStream::from_std(client_stream)?;
        let mut target_stream = target_stream;

        // Proxy data bidirectionally
        Self::proxy_streams(client_stream, target_stream).await?;

        Ok(())
    }

    /// Bidirectional data proxying
    async fn proxy_streams(
        mut client: TcpStream,
        mut server: TcpStream,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use tokio::io::copy_bidirectional;

        copy_bidirectional(&mut client, &mut server).await?;
        Ok(())
    }

    /// Get current active connection count
    pub async fn active_connection_count(&self) -> usize {
        self.active_connections.lock().await.len()
    }
// ── Imports ──────────────────────────────────────────────────────────────────

use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::Mutex;

// ── Helper Functions ─────────────────────────────────────────────────────────

fn fisher_yates_shuffle<T>(arr: &mut Vec<T>, rng: &mut Xoshiro128PlusPlus) {
    for i in (1..arr.len()).rev() {
        let j = (rng.next_u32() as usize) % (i + 1);
        arr.swap(i, j);
    }
}

fn generate_grease_value(rng: &mut Xoshiro128PlusPlus) -> u16 {
    // GREASE values are in ranges like 0x0A0A, 0x1A1A, etc. (RFC 8701)
    let base = rng.next_u32() % 16; // 0-15
    ((base * 0x101) + 0x0A0A) as u16
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bridge_config() {
        let config = TlsBridgeConfig::new(12345);
        assert_eq!(config.seed, 12345);
    }
}
