# Manifold — Headless Browser Automation Platform
# Multi-instance Docker container for farm deployments

FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive
ENV MANIFOLD_HEADLESS=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # Base system
    curl \
    wget \
    gnupg \
    software-properties-common \
    ca-certificates \
    # Node.js dependencies
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    # Rust dependencies
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && . $HOME/.cargo/env \
    # GUI libraries for Tauri (even in headless mode)
    libwebkit2gtk-4.1-dev \
    libappindicator3-dev \
    librsvg2-dev \
    patchelf \
    libgtk-3-dev \
    libatk-bridge2.0-dev \
    libdrm2 \
    libxkbcommon-dev \
    libxss1 \
    libasound2-dev \
    # Headless display server
    xvfb \
    x11-utils \
    # Fonts for rendering
    fonts-liberation \
    fonts-dejavu \
    # Additional tools
    jq \
    sqlite3 \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Set up Rust environment
ENV PATH="/root/.cargo/bin:${PATH}"
ENV RUSTUP_HOME=/root/.rustup
ENV CARGO_HOME=/root/.cargo

# Verify installations
RUN node --version && npm --version && cargo --version && rustc --version

# Create application directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./src-tauri/

# Install Node.js dependencies
RUN npm ci

# Copy source code
COPY . .

# Build Tauri application for Linux
RUN npm run tauri build -- --no-bundle

# Create data directories
RUN mkdir -p /app/data/profiles /app/data/sessions /app/logs

# Create non-root user for security
RUN useradd -m -s /bin/bash manifold && \
    chown -R manifold:manifold /app

# Switch to non-root user
USER manifold

# Set up environment
ENV DISPLAY=:99
ENV MANIFOLD_DATA_DIR=/app/data
ENV RUST_LOG=info

# Expose ports
EXPOSE 8765/tcp  # Bridge WebSocket port
EXPOSE 8766/tcp  # Primary bridge port
EXPOSE 8767/tcp  # TLS bridge port

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8766/health || exit 1

# Start Xvfb and the application
CMD ["bash", "-c", "\
    # Start virtual display server
    Xvfb :99 -screen 0 1920x1080x24 > /dev/null 2>&1 & \
    sleep 2 && \
    echo 'Virtual display started' && \
    # Start Manifold
    exec /app/src-tauri/target/release/manifold \
"]

# Labels for container metadata
LABEL org.opencontainers.image.title="Manifold"
LABEL org.opencontainers.image.description="Headless Browser Automation & Fingerprint Management Platform"
LABEL org.opencontainers.image.vendor="Manifold Team"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.source="https://github.com/flak3dd/manifold"

# Volume mounts for persistent data
VOLUME ["/app/data", "/app/logs"]
