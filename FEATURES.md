# Manifold Features

## Overview

Manifold is a hardened browser automation platform with advanced fingerprinting, evasion, and credential testing capabilities. It combines realistic human-like behavior, anti-detection techniques, and large-scale login automation into a unified desktop application.

## Core Components

### 1. Browser Fingerprinting

**Deterministic Fingerprint Generation**
- Seeded PRNG ensures reproducible fingerprints from the same seed
- Covers 70+ fingerprint parameters:
  - Canvas, WebGL, Audio rendering with configurable noise
  - User agent, platform, hardware concurrency, device memory
  - Screen resolution, viewport, color depth, pixel ratio
  - WebRTC leak prevention with mDNS spoofing
  - Locale, timezone, language preferences
  - Permission states for geolocation, camera, microphone, etc.

**Fingerprint Editor**
- Live preview with seed-based regeneration
- Preset configurations for Windows/macOS/Linux
- OS-aware font subset selection
- UA-Client-Hints (UA-CH) brand, platform, architecture configuration
- GREASE values for browser detection evasion
- Import/export for backup and sharing

**Profile Persistence**
- Store unlimited fingerprint profiles
- Tags and notes for organization
- Copy & modify existing profiles
- Domain-aware profile assignment

### 2. Human Behavior Simulation

**Mouse Movement**
- Cubic Bézier curve path generation
- Configurable speed (px/sec) with jitter
- Overshoot and micro-jitter for natural movement
- Pre-click pause randomization
- Per-profile behavior presets (bot, fast, normal, cautious)

**Keyboard Typing**
- Realistic WPM-based typing with burst patterns
- Typo generation and correction timing
- Double-tap simulation for occasional mistakes
- Think-before-type delays for long fields
- QWERTY-adjacent key patterns

**Scroll Behavior**
- Momentum-decay scroll physics
- Overshoot prevention
- Variable tick timing (10-50ms)
- Page and element-specific scrolling

**Macro Behaviors**
- Page load pause randomization
- Inter-action delays
- Idle pause probability and duration
- Random pre-movement for cursor positioning

### 3. Anti-Detection Evasions

**JavaScript-Level Evasions**
- Canvas fingerprint noise injection
- WebGL vendor/renderer spoofing with noise
- Audio context fingerprint randomization
- Font subset detection evasion
- Navigator property patching (hardwareConcurrency, deviceMemory)
- WebRTC leak prevention (mDNS candidate filtering)
- Screen/outerWidth/Height masking
- Permission descriptor overrides

**Playwright-Level Interceptors**
- Client-Hints (Sec-CH-UA) header manipulation
- Request header consistency with JS navigator data
- Disable headless detection flags
- Custom user agent headers

**TLS/JA3 Evasion**
- CLIENTHELLO spoofing via Chromium args
- Random TLS cipher order
- Elliptic curve variation
- Supported versions manipulation

### 4. Browser Automation Engine

**Playwright Integration**
- Hardened Chromium launch with security flags
- Proxy support (HTTP, HTTPS, SOCKS5)
- Multi-context isolation
- Screenshot capture
- Network request interception and HAR export
- Page evaluation and script execution

**Session Management**
- Cookie persistence and export
- LocalStorage/SessionStorage capture
- IndexedDB database snapshots
- Browser history and form data

**Entropy Logging**
- Real-time fingerprint measurements
- Canvas/WebGL hash verification
- Audio context observation
- Font availability tracking
- WebRTC leak detection
- Timezone and language validation

### 5. Login Automation

**Form Configuration**
- CSS/XPath selector definition
- Success indicator detection
- Failure indicator recognition
- CAPTCHA detection
- Consent banner auto-dismiss
- TOTP/2FA code injection
- Post-submit timeout tuning

**Preset Detection**
- Auto-detect selectors for:
  - Google Accounts
  - Instagram
  - LinkedIn
  - Twitter/X
  - Amazon
  - Shopify
  - And 10+ others

**Credential Management**
- Bulk import from CSV, JSON, or plain text
- Email:password or username:password format
- Extra fields (TOTP seeds, security questions, recovery codes)
- Drag-and-drop file upload
- Duplicate detection

### 6. Soft Signal Detection

**Automatic Detection Of:**
- CAPTCHA challenges (reCAPTCHA, hCaptcha, others)
- Rate limiting (HTTP 429, generic messages)
- IP/geographic blocking
- Account locked / 2FA required
- Consent banners
- Generic error messages

**Response Handling:**
- Configurable retry limits
- Automatic profile rotation on soft signals
- Optional proxy rotation
- Detailed logging of detection triggers

### 7. Profile Rotation Engine

**Rotation Triggers:**
- Soft signal detection (CAPTCHA, rate limit, IP block)
- Every N attempts threshold
- Consecutive failures threshold
- Manual rotation via UI

**Rotation History:**
- Timestamp of each rotation event
- Old/new profile IDs
- Rotation trigger reason
- Associated proxy changes
- Detailed event log viewable in UI

**Proxy Rotation:**
- Rotate from configured proxy pool
- BrightData/Luminati integration
- Custom proxy configuration
- Health checking and fallback

### 8. Results Tracking

**Real-Time Monitoring**
- Live credential status updates
- Per-attempt outcome logging
- Screenshot capture at completion
- Session state export
- Rotation event tracking

**Advanced Filtering**
- Search by username or URL
- Filter by status (success, failed, blocked, error)
- Filter by outcome (wrong credentials, CAPTCHA, rate limit, etc.)
- Sort by: index, username, status, duration
- Ascending/descending toggle

**Expandable Details**
- Final URL after login attempt
- Start/end timestamps
- Detailed outcome message
- Session export availability
- Full rotation event trail
- Signals detected during attempt

**Session Capture**
- HTTP cookies with domain/path/expiry/flags
- LocalStorage key-value pairs
- IndexedDB database snapshots
- Screenshot PNG
- JSON export for external use

### 9. Run Management

**Execution Modes**
- Sequential: One credential at a time (slower, stealthier)
- Parallel: Multiple concurrent credentials (faster, requires more profiles)
- Configurable concurrency level

**Run Controls**
- Start/pause/resume/abort buttons
- Live progress stats (total, success, failed, blocked, error, rotations)
- Per-credential pause/skip
- Real-time error visibility

**Run Persistence**
- History tab with all past runs
- Click to view past run results
- Export reports (JSON)
- Export successful credentials (CSV)
- Export session captures (ZIP)
- Delete runs to clean up history

### 10. Proxy Integration

**Proxy Management**
- List, add, update, delete proxies
- Support for HTTP, HTTPS, SOCKS5
- BrightData sticky-session proxy builder
- BrightData rotating proxy builder
- Health checking with latency measurement
- Per-country filtering

**Proxy Pool**
- Select multiple proxies for rotation
- Round-robin assignment
- Fallback on unhealthy proxies
- Per-profile proxy assignment

### 11. Data Export & Analysis

**Report Formats**
- JSON full report with all metadata
- CSV of successful logins
- ZIP of session captures
- HAR (HTTP Archive) for network analysis

**Downloadable Data**
- Individual session states
- Screenshots
- Rotation logs
- Run statistics

### 12. Configuration & Presets

**Domain Profiles**
- Pre-configured threat levels (paranoid, high, medium, low)
- Recommended TLS patching settings
- Minimum inter-attempt gaps
- Known anti-bot signatures

**Form Presets**
- Common login form patterns
- Timeout recommendations per domain
- Success/failure selector patterns
- Consent banner patterns

**Platform Presets**
- Device profiles (desktop, mobile)
- OS presets (Windows, macOS, Linux)
- Browser versions and features
- Screen resolution templates

## UI Components

### Automation Page
- **Setup Tab**: Credential import, form configuration, profile selection
- **Run Tab**: Live results table with filtering, sorting, detail expansion
- **History Tab**: Past run review and replay

### Fingerprint Page
- **Noise Configuration**: Canvas, WebGL, audio noise sliders
- **Navigator Properties**: User agent, platform, hardware concurrency
- **Screen Settings**: Resolution, viewport, DPI, color depth presets
- **WebRTC Options**: Block, fake-mDNS, passthrough modes
- **UA-CH Configuration**: Brand, platform, architecture, bitness
- **Permissions Editor**: Add/remove/modify permission states

### Profiles Page
- **Profile List**: Search, filter, select, launch profiles
- **Profile Editor**: Create, clone, delete, export profiles
- **Target Assignment**: Encode login targets in profile metadata
- **Bulk Operations**: Launch selected, stop all, emergency rotate

### Proxies Page
- **Proxy List**: View, add, edit, delete proxies
- **BrightData Integration**: Quick proxy builders for sticky/rotating
- **Health Checks**: Single and bulk proxy validation
- **Country Filtering**: List proxies by geographic location

### Trace/Bridge Page
- **Bridge Connection**: Monitor WebSocket to Chromium bridge
- **Live Trace**: View all browser interactions in real-time
- **Network Capture**: HAR export of all requests/responses
- **Screenshots**: Timeline of captured screenshots
- **Session Export**: Download captured session state

## Technical Architecture

### Frontend (SvelteKit + TypeScript)
- Reactive state with Svelte 5 runes
- Real-time updates via WebSocket
- Component-based UI with consistent design system
- Dark mode with customizable CSS variables

### Backend (Tauri + Rust)
- Cross-platform desktop app (Windows, macOS, Linux)
- SQLite database with optional AES-GCM encryption
- Async command handlers for browser operations
- Profile/proxy/credential persistence

### Bridge (Node.js + Playwright)
- Hardened Chromium launcher with evasion scripts
- WebSocket server for real-time communication
- HAR capture and session export
- Entropy/fingerprint measurement

### Fingerprint Generator (Rust + TypeScript)
- Deterministic seeded PRNG (mulberry32/SmallRng)
- ~150 line UA construction with version ranges
- WebGL options from real GPU models
- Font subset selection per OS
- Timezone/locale from realistic pairs
- JS fallback for web dev environments

## Performance Characteristics

- **Startup**: ~2s to launch hardened Chromium with 100+ evasion patches
- **Login Attempt**: ~2-10s per credential (depends on site speed)
- **Parallel Runs**: 4-8 concurrent with minimal overhead
- **Memory**: ~150MB per browser context
- **Session Export**: <1s for typical site (cookies, localStorage)

## Security & Privacy

- All execution in sandboxed Chromium contexts
- No credential persistence (except deliberate exports)
- Local-only database with optional encryption
- No cloud/telemetry
- Source code available for audit
- Works offline (except for proxy services)

## Limitations & Future Work

**Current Limitations:**
- No multi-step login flows (fixable with custom scripts)
- No API-based authentication (Playwright web-only)
- No automatic CAPTCHA solving
- No account creation automation

**Planned Enhancements:**
- Lua scripting for custom login flows
- Anti-CAPTCHA/2Captcha integration
- Email-based 2FA interception
- GraphQL API for programmatic access
- Distributed runs across multiple machines
- Credential validation with live password checks
- Browser extension for manual browsing with evasions

## Use Cases

### Security Testing
- Identify weak password policies
- Test account lockout mechanisms
- Validate 2FA enforcement
- Check rate limiting effectiveness

### Credential Validation
- Verify leaked credential lists
- Test password reset flows
- Validate account recovery processes
- Bulk health-check accounts

### Bot Detection Testing
- Measure bot detection sensitivity
- Find evasion bypass techniques
- Test fingerprint detection accuracy
- Validate user behavior modeling

### Account Recovery
- Recover forgotten account access
- Test alternative authentication methods
- Validate backup codes
- Test security questions

### Penetration Testing
- Identify authentication weaknesses
- Test for brute-force vulnerability
- Validate IP-based restrictions
- Check geographic blocking

## Getting Started

1. **Install**: Download from releases or build from source
2. **Create Profile**: Generate fingerprint or use preset
3. **Add Credentials**: Import from CSV/JSON/text
4. **Configure Target**: Set form selectors (or use auto-detect)
5. **Launch Run**: Click Launch and monitor results
6. **Export Results**: Download hits, sessions, or reports

See [AUTOMATION.md](AUTOMATION.md) for detailed guide.