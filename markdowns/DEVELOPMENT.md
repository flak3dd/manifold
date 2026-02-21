# Development Guide — Manifold

> Complete setup instructions, workflow guidelines, and contribution standards for the Manifold browser automation platform.

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Environment Configuration](#environment-configuration)
- [Development Workflow](#development-workflow)
- [First Launch Checklist](#first-launch-checklist)
- [Testing](#testing)
- [Building](#building)
- [Troubleshooting](#troubleshooting)
- [Code Organization](#code-organization)
- [Contributing](#contributing)

## Requirements

### System Requirements

| Component | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | 20.10.0+ | Frontend build and development |
| **Rust** | 1.75.0+ | Tauri backend compilation |
| **OS** | Windows/Linux/macOS | Cross-platform desktop app |

### Platform-Specific Dependencies

#### Windows
```powershell
# Enable Developer Mode for symbolic links
# Install Visual Studio Build Tools 2022 with:
# - Desktop development with C++
# - Windows 10/11 SDK
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

#### macOS
```bash
# Install Xcode command line tools
xcode-select --install

# Install required libraries via Homebrew
brew install webkitgtk gtk4 librsvg
```

## Installation

### 1. Clone Repository
```bash
git clone https://github.com/flak3dd/manifold.git
cd manifold
```

### 2. Frontend Dependencies
```bash
npm install
```

### 3. Verify Tauri CLI
```bash
# Install Tauri CLI globally
npm install -g @tauri-apps/cli

# Or install locally (recommended)
npm run tauri --version
```

### 4. Verify Rust Installation
```bash
cargo --version
rustc --version

# Update to latest stable if needed
rustup update stable
```

## Environment Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Database encryption (optional - leave empty for default system key)
MANIFOLD_MASTER_KEY=your-secure-passphrase-here

# Debug logging (set to "1" to enable verbose output)
MANIFOLD_DEBUG=1

# Development ports (optional - defaults provided)
MANIFOLD_BRIDGE_PORT=8080
```

### IDE Setup

#### Visual Studio Code (Recommended)
Install these extensions:
- `svelte.svelte-vscode` — Svelte language support
- `tauri-apps.tauri-vscode` — Tauri development tools
- `rust-lang.rust-analyzer` — Rust language server
- `esbenp.prettier-vscode` — Code formatting
- `ms-vscode.vscode-typescript-next` — TypeScript support

#### VS Code Settings
Add to `.vscode/settings.json`:
```json
{
  "svelte.enable-ts-plugin": true,
  "rust-analyzer.checkOnSave.command": "clippy",
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "editor.formatOnSave": true
}
```

## Development Workflow

### Running in Development Mode

```bash
# Start full development environment (frontend + backend + bridge)
npm run tauri dev

# Alternative: Run components separately
npm run dev        # Frontend only (port 5173)
npm run bridge     # Playwright bridge server (port 8080)
npm run tauri dev  # Backend only (waits for frontend)
```

### Development Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `npm run dev` | `vite dev` | Frontend development server |
| `npm run build` | `vite build` | Frontend production build |
| `npm run check` | `svelte-kit sync && svelte-check` | Type checking |
| `npm run tauri` | `tauri` | Tauri CLI commands |
| `npm run bridge` | `tsx playwright-bridge/index.ts` | Playwright bridge |
| `npm run scraper` | `tsx scripts/scraper.ts` | Standalone scraper |

### Hot Reload

- **Frontend**: Automatic via Vite HMR
- **Backend**: Automatic via Tauri (rebuilds on Rust changes)
- **Bridge**: Manual restart required (`npm run bridge:dev` for watch mode)

## First Launch Checklist

### □ Initial Setup
- [ ] Run `npm install`
- [ ] Verify Tauri CLI: `npm run tauri --version`
- [ ] Verify Rust: `cargo --version`

### □ Environment Configuration
- [ ] Create `.env` file with required variables
- [ ] Set `MANIFOLD_MASTER_KEY` (recommended for security)
- [ ] Enable debug logging if developing: `MANIFOLD_DEBUG=1`

### □ First Development Run
- [ ] Execute `npm run tauri dev`
- [ ] Wait for initial compilation (may take 2-3 minutes first time)
- [ ] Verify desktop app window opens
- [ ] Check browser console for any errors

### □ Core Functionality Verification
- [ ] **Profile Creation**: Create a new browser profile
- [ ] **Fingerprint Display**: Verify fingerprint values are generated
- [ ] **Launch Test**: Launch a profile and confirm browser opens
- [ ] **Automation Setup**: Add credentials and configure automation
- [ ] **Proxy Configuration**: Add and test proxy settings

### □ Integration Testing
- [ ] Run unit tests: `npm test`
- [ ] Run scraper standalone: `npm run scraper`
- [ ] Test bridge connection: Check WebSocket logs
- [ ] Verify HAR recording works

### □ Production Build Test
- [ ] Run `npm run tauri build`
- [ ] Verify build completes without errors
- [ ] Test built application launches correctly

## Testing

### Unit Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test src/lib/stores/automation.test.ts

# Watch mode for development
npm test -- --watch

# Coverage report
npm test -- --coverage
```

### Integration Tests
```bash
# End-to-end functionality test
npm run scraper

# Bridge integration test
npm run bridge

# Tauri-specific tests
npm run tauri build -- --no-bundle && cargo test
```

### Manual Testing Checklist

#### Core Features
- [ ] Profile CRUD operations (Create, Read, Update, Delete)
- [ ] Browser launch with fingerprint validation
- [ ] Proxy health checking and rotation
- [ ] Form scraping accuracy on test sites
- [ ] Automation run execution (sequential/parallel)
- [ ] Session export/import functionality
- [ ] HAR export with entropy data

#### Evasion Validation
- [ ] Canvas fingerprinting bypass
- [ ] WebRTC IP masking (check `ipinfo.io` in browser)
- [ ] navigator.webdriver removal
- [ ] Client Hints consistency
- [ ] TLS GREASE header injection

#### Performance Benchmarks
- [ ] Profile launch time < 100ms
- [ ] Memory usage per browser instance < 200MB
- [ ] HAR file size for typical page load < 5MB
- [ ] Concurrent automation runs stability

## Building

### Development Builds
```bash
npm run tauri build -- --debug
```

### Production Builds
```bash
# Full production build with optimizations
npm run tauri build

# Build for specific platform
npm run tauri build -- --target x86_64-apple-darwin  # macOS Intel
npm run tauri build -- --target aarch64-apple-darwin # macOS Apple Silicon
npm run tauri build -- --target x86_64-pc-windows-msvc # Windows x64
```

### Build Artifacts

Production builds create:
- `src-tauri/target/release/bundle/` containing platform-specific installers
- `.dmg` (macOS), `.msi` (Windows), `.deb` (Linux)
- Application bundles with embedded frontend and backend

## Troubleshooting

### Common Issues

#### Build Errors

**Tauri CLI not found**
```bash
npm install -g @tauri-apps/cli
# or
npx @tauri-apps/cli --version
```

**Rust toolchain issues**
```bash
rustup install stable
rustup target add aarch64-apple-darwin  # for Apple Silicon
```

**WebKit dependencies missing (Linux)**
```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

#### Runtime Errors

**Database encryption failures**
- Ensure `MANIFOLD_MASTER_KEY` is set consistently
- Check file permissions on database directory

**Bridge connection failures**
- Verify WebSocket port (default 8080) is available
- Check firewall/antivirus blocking connections
- Enable debug logging: `MANIFOLD_DEBUG=1`

**Browser launch failures**
- Ensure Chrome/Chromium is installed and in PATH
- Check antivirus software not blocking browser automation
- Verify profile data directory permissions

#### Development Issues

**Hot reload not working**
- Restart the Tauri development server
- Check that file watching is enabled in your IDE
- Verify no TypeScript compilation errors blocking HMR

**WebSocket connection lost**
```bash
# Restart bridge server
npm run bridge

# Or use dev mode
npm run bridge:dev
```

### Debug Tools

#### Enable Debug Logging
```bash
# Environment variable
MANIFOLD_DEBUG=1 npm run tauri dev

# Or in .env file
MANIFOLD_DEBUG=1
```

#### Browser DevTools
- Press `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (macOS)
- Check Console tab for frontend errors
- Network tab shows WebSocket communication

#### Rust Debug Builds
```bash
# Build with debug symbols
npm run tauri build -- --debug

# Run with verbose logging
RUST_LOG=debug npm run tauri dev
```

## Code Organization

### Directory Structure

```
manifold/
├── src/                          # Frontend (SvelteKit)
│   ├── lib/
│   │   ├── components/           # UI components
│   │   ├── stores/               # State management
│   │   ├── utils/                # Utility functions
│   │   └── types.ts              # TypeScript definitions
│   └── routes/                   # Page routes
├── src-tauri/                    # Backend (Rust/Tauri)
│   ├── src/
│   │   ├── commands.rs           # Tauri IPC commands
│   │   ├── db.rs                 # Database layer
│   │   ├── fingerprint.rs        # Fingerprint generation
│   │   └── main.rs               # Application entry
│   └── tauri.conf.json           # Tauri configuration
├── playwright-bridge/            # Automation bridge
│   ├── index.ts                  # WebSocket server
│   ├── login-runner.ts           # Automation execution
│   └── types.ts                  # Shared type definitions
├── evasions/                     # Anti-detection modules
│   ├── canvas.ts                 # Canvas fingerprinting
│   ├── webgl.ts                  # WebGL spoofing
│   └── ...                       # Other evasion modules
└── human/                        # Human behavior simulation
    ├── index.ts                  # Main behavior engine
    └── ...
```

### Code Standards

#### TypeScript
- Strict type checking enabled
- Interfaces preferred over type aliases for objects
- Export all public APIs explicitly

#### Rust
- Clippy warnings treated as errors
- Comprehensive error handling with `Result<T, E>`
- Memory-safe patterns throughout

#### Commit Messages
```
type(scope): description

types: feat, fix, docs, style, refactor, test, chore

examples:
feat(automation): add parallel credential testing
fix(fingerprint): resolve WebGL vendor spoofing
docs(readme): update installation instructions
```

## Contributing

### Pull Request Process

1. **Fork** the repository
2. **Create** a feature branch from `master`
3. **Implement** your changes with comprehensive tests
4. **Run** the full test suite: `npm test && npm run tauri build`
5. **Update** documentation if needed
6. **Commit** with descriptive messages
7. **Push** your branch and create a PR
8. **Wait** for CI checks to pass
9. **Address** any review feedback

### Feature Development Checklist

- [ ] Tests written and passing
- [ ] Documentation updated
- [ ] Breaking changes clearly marked
- [ ] Performance impact assessed
- [ ] Security implications reviewed
- [ ] Cross-platform compatibility verified

### Bug Reports

When reporting bugs, include:
- Manifold version (`npm run tauri --version`)
- Operating system and version
- Steps to reproduce
- Expected vs actual behavior
- Console logs (with `MANIFOLD_DEBUG=1`)
- Screenshot if applicable

---

**For additional support**, join the community discussions or create an issue on GitHub.