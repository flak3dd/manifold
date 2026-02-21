use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::net::TcpStream;
use tokio::sync::Mutex;

use rustls::pki_types::ServerName;
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use tokio_rustls::TlsConnector;
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
    pub async fn new(port: u16, seed: u64) -> std::io::Result<Self> {
        let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
        let config = TlsBridgeConfig::new(seed);

        println!("[tls-bridge] Started on port {} with seed: {}", port, seed);

        Ok(TlsBridge {
            listener,
            config,
            active_connections: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Start accepting connections
    pub async fn run(&self) -> std::io::Result<()> {
        loop {
            let (client_stream, client_addr) = self
                .listener
                .accept()
                .await
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            let config = self.config.clone();
            let active_connections = self.active_connections.clone();

            let connection_id = format!("{}", client_addr);
            let connection_id_clone = connection_id.clone();
            let active_connections_clone = active_connections.clone();
            let handle = tokio::spawn(async move {
                if let Err(e) = Self::handle_connection(client_stream, config).await {
                    eprintln!(
                        "[tls-bridge] Connection error for {}: {}",
                        connection_id_clone, e
                    );
                }

                // Clean up when done
                active_connections_clone
                    .lock()
                    .await
                    .remove(&connection_id_clone);
            });

            active_connections
                .lock()
                .await
                .insert(connection_id, handle);
        }
    }

    /// Handle individual proxy connection
    async fn handle_connection(
        mut client_stream: TcpStream,
        _config: TlsBridgeConfig,
    ) -> std::io::Result<()> {
        // Read CONNECT request from Playwright
        let mut buffer = [0u8; 4096];
        let n = client_stream
            .read(&mut buffer)
            .await
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let request = String::from_utf8_lossy(&buffer[..n]).to_string();

        // Parse CONNECT request (e.g., "CONNECT example.com:443 HTTP/1.1")
        let lines: Vec<&str> = request.lines().collect();
        if lines.is_empty() || !lines[0].starts_with("CONNECT ") {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Invalid CONNECT request",
            ));
        }

        let host_port_str = lines[0]
            .strip_prefix("CONNECT ")
            .ok_or(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "No CONNECT",
            ))?
            .split(" ")
            .next()
            .ok_or(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "No host",
            ))?;

        let parts: Vec<&str> = host_port_str.split(":").collect();
        if parts.is_empty() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "No parts",
            ));
        }

        let host = parts[0].to_string();
        let port: u16 = parts.get(1).and_then(|p| p.parse().ok()).unwrap_or(443);

        // Respond with 200 Connection established
        client_stream
            .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
            .await
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        // Establish outbound TLS connection with fingerprinting
        let mut root_store = RootCertStore::empty();
        root_store.extend(TLS_SERVER_ROOTS.iter().cloned());
        let tls_config = ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();
        let connector = TlsConnector::from(std::sync::Arc::new(tls_config));
        let tcp_stream = TcpStream::connect((host.as_str(), port))
            .await
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let host_static: &'static str = Box::leak(host.into_boxed_str());
        let server_name = ServerName::try_from(host_static).unwrap();
        let target_stream = connector
            .connect(server_name, tcp_stream)
            .await
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        // Proxy data bidirectionally
        Self::proxy_streams(client_stream, target_stream).await?;

        Ok(())
    }

    /// Bidirectional data proxying
    async fn proxy_streams<S1, S2>(mut client: S1, mut server: S2) -> std::io::Result<()>
    where
        S1: AsyncRead + AsyncWrite + Unpin,
        S2: AsyncRead + AsyncWrite + Unpin,
    {
        use tokio::io::copy_bidirectional;

        copy_bidirectional(&mut client, &mut server)
            .await
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        Ok(())
    }

    /// Get current active connection count
    pub async fn active_connection_count(&self) -> std::io::Result<usize> {
        Ok(self.active_connections.lock().await.len())
    }
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
