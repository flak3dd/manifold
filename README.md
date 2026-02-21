# Manifold — Hardened Browser Automation & Fingerprint Management

[![CI](https://github.com/flak3dd/manifold/actions/workflows/ci.yml/badge.svg)](https://github.com/flak3dd/manifold/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Sovereign browser automation platform that exceeds GoLogin/Multilogin/Octo in entropy depth and JA4 realism. Fully self-hosted, zero dependencies on external APIs.

## 🚀 Key Features

### Browser Fingerprint Management
- **Deterministic Profiles** — Generate identical fingerprints from numeric seeds
- **Entropy Maximization** — Unparalleled browser diversity with 1000+ signal combinations
- **Geo Consistency** — Automatic geographic alignment (timezone, locale, UA languages)
- **Hardware Spoofing** — Realistic CPU cores (2-16), RAM buckets (0.25-8GB), screen dimensions
- **Noise Injection** — Seeded entropy across canvas, WebGL, audio, and font APIs

### Anti-Detection Evasions
- **JA4H Integration** — TLS fingerprint diversity per request (Chrome 120+ realism)
- **Client Hints** — Sec-CH-UA-* header consistency with navigator.userAgentData
- **WebRTC Masking** — Block, fake-mDNS, or passthrough modes with UUID-format mDNS hosts
- **Permission Spoofing** — Grant/deny API permissions per profile
- **Font Enumeration** — Subset filtering with CSS-style redirection

### Human Behavior Simulation
- **Multi-Speed Profiles** — Bot (fast), Fast, Normal, Cautious movement patterns
- **Natural Mouse Trajectories** — Bézier curves with scatter, overshoot, jitter
- **Intelligent Typing** — Character-level delays with typos and corrections
- **Page Interaction Flow** — Load pauses, form thinking, macro-behavior timing

### Automation & Scraping
- **Form Detection** — Smart login/captcha/multi-factor form identification
- **Credential Testing** — Parallel/sequential execution with proxy rotation
- **Session Export** — Encrypted local storage/cookies for reuse
- **HAR Recording** — Complete network traffic capture with entropy metadata

## 📋 Requirements

- **Node.js 20+**
- **Rust 1.75+**
- **Platform-specific dependencies** (see [DEVELOPMENT.md](DEVELOPMENT.md))

## 🚀 Quick Start

1. **Clone & Setup**
   ```bash
   git clone https://github.com/flak3dd/manifold.git
   cd manifold
   npm install
   ```

2. **Development**
   ```bash
   npm run tauri dev
   ```

3. **Build for Production**
   ```bash
   npm run tauri build
   ```

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed setup instructions and environment configuration.

## 🏗️ Architecture

Manifold follows a layered architecture:

- **Frontend**: SvelteKit 5 with modern reactive state stores
- **Backend**: Rust with Tauri 2 for cross-platform desktop execution
- **Automation**: TypeScript Playwright bridge with WebSocket real-time control
- **Persistence**: SQLite with AES-GCM encryption and Argon2 key derivation

For a complete architectural breakdown, see [ARCHITECTURE.md](ARCHITECTURE.md).

## 🔧 Configuration

### Environment Variables
- `MANIFOLD_MASTER_KEY`: Optional encryption passphrase for database
- `MANIFOLD_DEBUG`: Enable verbose logging (`1` = on)

### Proxy Support
- HTTP/HTTPS proxies with authentication
- SOCKS5 (converted via HTTP proxy wrapper)
- Health checking and rotation
- Profile-level proxy assignment

## 📊 Capabilities

| Feature | Status |
|---------|--------|
| Browser Profile Generation | ✅ Complete |
| Anti-Detection Evasions | ✅ Complete |
| Human Behavior Simulation | ✅ Complete |
| Form Scraping & Automation | ✅ Complete |
| Proxy Management | ✅ Complete |
| Session Export/Import | ✅ Complete |
| HAR Recording | ✅ Complete |
| Real-time WebSocket Control | ✅ Complete |

## 🔬 Testing

```bash
# Unit tests (Vitest)
npm test

# Integration tests (Rust)
npm run tauri build -- --no-bundle && cargo test

# End-to-end functionality
npm run scraper
npm run bridge
```

Test reports are saved to `test-results/` with screenshots and detailed logs.

## 📖 Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Complete system design and implementation details
- **[DEVELOPMENT.md](DEVELOPMENT.md)** — Setup, development workflow, and contribution guidelines
- **[FORM_SCRAPER.md](FORM_SCRAPER_ADVANCED.md)** — Advanced form detection techniques
- **[TESTING.md](QUICK_START_TESTING.md)** — Testing procedures and guidelines

## 🛡️ Security

- **Zero External Dependencies** — All fingerprinting and evasion logic is local
- **Database Encryption** — AES-GCM with user-provided or system-derived keys
- **Memory Safety** — Rust backend prevents buffer overflows and memory corruption
- **No Telemetry** — Completely offline operation with no data collection

## 📈 Performance

- **Sub-100ms Profile Launch** — Optimized browser initialization
- **Real-time Monitoring** — WebSocket-based live session control
- **Efficient Storage** — Compressed session exports and HAR files
- **Low Resource Usage** — Minimal memory footprint per browser instance

## 🤝 Contributing

1. Read [DEVELOPMENT.md](DEVELOPMENT.md) for setup instructions
2. Review [ARCHITECTURE.md](ARCHITECTURE.md) for code organization
3. Create feature branches from `master`
4. Submit PRs with comprehensive test coverage

## 📄 License

MIT License — see [LICENSE](LICENSE) file for details.

## ⚡ Philosophy

Manifold was built on the principle that browser automation should be **sovereign** — not dependent on SaaS platforms with undisclosed detection algorithms or data collection practices. Every line of code is designed to maximize fingerprint diversity while maintaining operational security.

- **Entropy First**: Uncompromising browser diversity
- **Self-Hosted**: Zero external API dependencies
- **Open Source**: Transparent implementation
- **Production Ready**: Enterprise-grade reliability and performance