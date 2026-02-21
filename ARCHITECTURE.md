# Manifold Architecture Documentation

> **Manifold** — Hardened Browser Automation & Fingerprint Management Platform

This document provides a comprehensive breakdown of the Manifold application architecture, organized into logical sections for easier analysis and maintenance.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
3. [Application Layers](#3-application-layers)
4. [Frontend (SvelteKit)](#4-frontend-sveltekit)
5. [Backend (Tauri/Rust)](#5-backend-taurirust)
6. [Playwright Bridge](#6-playwright-bridge)
7. [Evasion System](#7-evasion-system)
8. [Human Behavior Simulation](#8-human-behavior-simulation)
9. [State Management](#9-state-management)
10. [Data Flow](#10-data-flow)
11. [Key Features](#11-key-features)
12. [File Structure Reference](#12-file-structure-reference)
13. [Configuration & Environment](#13-configuration--environment)
14. [Testing](#14-testing)

---

## 1. Overview

Manifold is a desktop application designed for:
- **Browser Fingerprint Management** — Generate and manage unique browser fingerprints
- **Profile Management** — Create, store, and launch browser profiles with consistent identities
- **Proxy Management** — Configure and rotate proxies with health checking
- **Automation** — Run credential testing and form automation flows
- **Anti-Detection** — Evade bot detection systems through sophisticated browser evasions

### Architecture Pattern

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (SvelteKit)                         │
│                    UI Components & State Stores                      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Tauri IPC / WebSocket
┌───────────────────────────────┼─────────────────────────────────────┐
│                               ▼                                      │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│  │  Tauri Backend  │    │ Playwright      │    │   WebSocket     │ │
│  │  (Rust)         │◄──►│ Bridge          │◄──►│   Server        │ │
│  │                 │    │ (TypeScript)    │    │   (Scraper)     │ │
│  └────────┬────────┘    └────────┬────────┘    └─────────────────┘ │
│           │                      │                                   │
│           ▼                      ▼                                   │
│  ┌─────────────────┐    ┌─────────────────┐                         │
│  │   SQLite DB     │    │   Chromium      │                         │
│  │   (Encrypted)   │    │   (Hardened)    │                         │
│  └─────────────────┘    └─────────────────┘                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Technology Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| **SvelteKit 5** | UI framework with Svelte 5 runes |
| **TypeScript** | Type safety |
| **TailwindCSS** | Styling |
| **bits-ui** | UI component library |
| **Vite** | Build tool |

### Backend
| Technology | Purpose |
|------------|---------|
| **Tauri 2** | Desktop application framework |
| **Rust** | Backend logic, security |
| **SQLite (rusqlite)** | Data persistence |
| **AES-GCM / Argon2** | Encryption |

### Browser Automation
| Technology | Purpose |
|------------|---------|
| **Playwright** | Browser automation |
| **playwright-extra** | Plugin system |
| **puppeteer-extra-plugin-stealth** | Anti-detection |

### Communication
| Technology | Purpose |
|------------|---------|
| **WebSocket (ws)** | Real-time communication |
| **Tauri IPC** | Frontend-backend bridge |

---

## 3. Application Layers

### Layer 1: Presentation (Frontend)
- Svelte components
- Route pages
- State stores (Svelte 5 runes)

### Layer 2: Application Logic
- Tauri commands (Rust)
- Business logic
- Data validation

### Layer 3: Browser Control
- Playwright bridge
- Evasion scripts
- Human behavior simulation

### Layer 4: Data Persistence
- SQLite database
- Encrypted storage
- Session/profile data

---

## 4. Frontend (SvelteKit)

### Directory: `src/`

```
src/
├── app.css                    # Global styles
├── app.html                   # HTML template
├── lib/                       # Shared library code
│   ├── components/            # Reusable UI components
│   ├── constants/             # Static configuration
│   ├── presets/               # Flow presets (automation configs)
│   ├── stores/                # Svelte 5 state stores
│   ├── utils/                 # Utility functions
│   ├── fingerprint.ts         # JS fingerprint generator (fallback)
│   ├── types.ts               # TypeScript type definitions
│   └── websocket.ts           # WebSocket client
└── routes/                    # SvelteKit pages
    ├── +layout.svelte         # Root layout
    ├── +page.svelte           # Home/dashboard
    ├── automation/            # Credential automation
    ├── fingerprint/           # Fingerprint viewer
    ├── profiles/              # Profile management
    ├── proxies/               # Proxy management
    ├── trace/                 # Session tracing
    └── url-test/              # URL testing tool
```

### Components (`src/lib/components/`)

| Component | Purpose |
|-----------|---------|
| `AddSourceDialog.svelte` | Dialog for adding scrape sources |
| `BatchProfileGenerator.svelte` | Bulk profile creation |
| `FingerprintPreview.svelte` | Display fingerprint details |
| `PanicButton.svelte` | Emergency shutdown button |
| `ProfileModal.svelte` | Profile create/edit modal |
| `ResultPanel.svelte` | Display scrape results |
| `Sidebar.svelte` | Navigation sidebar |
| `SourceCard.svelte` | Source display card |
| `StatusBadge.svelte` | Status indicator badge |

### State Stores (`src/lib/stores/`)

| Store | Purpose |
|-------|---------|
| `app.svelte.ts` | Global app state, WebSocket connection |
| `automation.svelte.ts` | Automation runs, credentials, results |
| `bridge.svelte.ts` | Playwright bridge connection state |
| `profiles.svelte.ts` | Profile CRUD operations |
| `proxy.svelte.ts` | Proxy management, rotation |
| `scrape-handoff.svelte.ts` | URL test → Automation handoff |
| `urltest.svelte.ts` | URL testing state |

### Routes (Pages)

| Route | File | Purpose |
|-------|------|---------|
| `/` | `+page.svelte` | Dashboard |
| `/profiles` | `profiles/+page.svelte` | Profile management |
| `/proxies` | `proxies/+page.svelte` | Proxy configuration |
| `/automation` | `automation/+page.svelte` | Credential automation |
| `/url-test` | `url-test/+page.svelte` | URL testing & scraping |
| `/fingerprint` | `fingerprint/+page.svelte` | Fingerprint viewer |
| `/trace` | `trace/+page.svelte` | Session tracing |

---

## 5. Backend (Tauri/Rust)

### Directory: `src-tauri/src/`

```
src-tauri/
├── src/
│   ├── main.rs              # Entry point
│   ├── lib.rs               # Tauri app builder & command registration
│   ├── commands.rs          # IPC command handlers
│   ├── db.rs                # Database operations
│   ├── error.rs             # Error types
│   ├── fingerprint.rs       # Fingerprint generation (Rust)
│   ├── geo_validator.rs     # Geo consistency validation
│   ├── human.rs             # Human behavior defaults
│   ├── profile.rs           # Profile data structures
│   └── proxy.rs             # Proxy management
├── Cargo.toml               # Rust dependencies
└── tauri.conf.json          # Tauri configuration
```

### Tauri Commands (IPC API)

#### Profile Commands
| Command | Description |
|---------|-------------|
| `list_profiles` | Get all profiles |
| `get_profile` | Get single profile by ID |
| `create_profile` | Create new profile |
| `update_profile` | Update existing profile |
| `delete_profile` | Delete profile |
| `reseed_profile` | Regenerate profile fingerprint |
| `duplicate_profile` | Clone a profile |
| `set_profile_status` | Update profile status |

#### Fingerprint Commands
| Command | Description |
|---------|-------------|
| `generate_fingerprint` | Generate new fingerprint |
| `reseed_fingerprint` | Regenerate with new seed |

#### Proxy Commands
| Command | Description |
|---------|-------------|
| `list_proxies` | Get all proxies |
| `get_proxy` | Get single proxy |
| `add_proxy` | Add new proxy |
| `update_proxy` | Update proxy settings |
| `delete_proxy` | Remove proxy |
| `check_proxy` | Health check single proxy |
| `check_all_proxies` | Health check all proxies |

#### Bridge Commands
| Command | Description |
|---------|-------------|
| `launch_profile` | Launch browser with profile |
| `stop_bridge` | Stop browser session |
| `get_bridge_url` | Get bridge WebSocket URL |
| `set_bridge_port` | Configure bridge port |

#### Other Commands
| Command | Description |
|---------|-------------|
| `panic_shutdown` | Emergency shutdown all |
| `export_session` | Export session data |
| `scrape_form_selectors` | Scrape form from URL |
| `validate_geo_consistency` | Validate geo settings |
| `auto_correct_geo` | Auto-fix geo mismatches |

### Database Schema (SQLite)

```sql
-- Profiles table
CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    fingerprint TEXT NOT NULL,      -- JSON blob
    human TEXT NOT NULL,            -- JSON blob (behavior config)
    proxy_id TEXT,
    notes TEXT,
    tags TEXT,                      -- JSON array
    status TEXT DEFAULT 'idle',
    created_at TEXT NOT NULL,
    last_used TEXT,
    data_dir TEXT NOT NULL
);

-- Proxies table
CREATE TABLE proxies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    proxy_type TEXT NOT NULL,       -- http, https, socks5
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT,
    password_encrypted TEXT,        -- AES-GCM encrypted
    country TEXT,
    healthy INTEGER DEFAULT 1,
    latency_ms INTEGER,
    last_checked TEXT
);

-- Sessions table
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    har_data TEXT,                  -- JSON blob
    entropy_logs TEXT,              -- JSON blob
    events TEXT                     -- JSON blob
);
```

---

## 6. Playwright Bridge

### Directory: `playwright-bridge/`

```
playwright-bridge/
├── index.ts              # Entry point, WebSocket server
├── login-runner.ts       # Credential automation runner
├── login-types.ts        # Login automation types
├── types.ts              # Bridge type definitions
└── tests/                # Bridge tests
```

### Purpose
The Playwright Bridge is a separate Node.js process that:
1. Receives launch configuration via environment variable
2. Starts a hardened Chromium browser
3. Applies all evasion scripts
4. Exposes WebSocket API for control
5. Handles automation commands

### Launch Flow
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Tauri     │────►│  Bridge      │────►│  Chromium   │
│   Backend   │     │  Process     │     │  Browser    │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  WebSocket   │
                    │  Server      │◄──── Frontend
                    └──────────────┘
```

### WebSocket Messages

#### Client → Bridge
| Message Type | Purpose |
|--------------|---------|
| `navigate` | Navigate to URL |
| `click` | Click element |
| `type` | Type text |
| `screenshot` | Capture screenshot |
| `runLogin` | Execute login automation |
| `stop` | Stop current operation |

#### Bridge → Client
| Message Type | Purpose |
|--------------|---------|
| `ready` | Browser ready |
| `navigated` | Navigation complete |
| `har` | HAR entry captured |
| `entropy` | Entropy log entry |
| `error` | Error occurred |
| `loginResult` | Login automation result |

---

## 7. Evasion System

### Directory: `evasions/`

```
evasions/
├── index.ts              # Barrel export & applyAllEvasions()
├── types.ts              # EvasionConfig type
├── navigator.ts          # Navigator property spoofing
├── client-hints.ts       # User-Agent Client Hints
├── canvas.ts             # Canvas fingerprint noise
├── webgl.ts              # WebGL fingerprint spoofing
├── audio.ts              # AudioContext fingerprint noise
├── fonts.ts              # Font enumeration spoofing
├── webrtc.ts             # WebRTC IP leak prevention
└── tls-grease.ts         # TLS fingerprint diversity
```

### Evasion Categories

#### 1. Navigator Evasion (`navigator.ts`)
- `navigator.hardwareConcurrency`
- `navigator.deviceMemory`
- `navigator.webdriver` (hide automation)
- `navigator.permissions`
- `navigator.plugins`

#### 2. Client Hints (`client-hints.ts`)
- `navigator.userAgentData`
- `Sec-CH-UA-*` request headers
- Screen dimensions
- Color scheme

#### 3. Canvas Evasion (`canvas.ts`)
- `getImageData()` noise injection
- `toDataURL()` modification
- `toBlob()` modification

#### 4. WebGL Evasion (`webgl.ts`)
- Vendor/renderer spoofing
- `getParameter()` interception
- `readPixels()` noise
- Extension filtering

#### 5. Audio Evasion (`audio.ts`)
- `AudioBuffer.getChannelData()` noise
- `AnalyserNode` modifications
- `OfflineAudioContext` noise

#### 6. Font Evasion (`fonts.ts`)
- `FontFaceSet` filtering
- `measureText()` noise
- Font family enumeration

#### 7. WebRTC Evasion (`webrtc.ts`)
- IP address masking
- mDNS candidate rewriting
- `RTCPeerConnection` interception

#### 8. TLS GREASE (`tls-grease.ts`)
- TLS fingerprint diversity
- JA4H header manipulation
- HTTP/2 settings randomization

### Evasion Application Order
```
1. navigator    → Base navigator properties
2. clientHints  → User-Agent Client Hints
3. canvas       → 2D canvas fingerprint
4. webgl        → WebGL fingerprint
5. audio        → Audio fingerprint
6. fonts        → Font enumeration
7. webrtc       → WebRTC leak prevention
```

---

## 8. Human Behavior Simulation

### Directory: `human/`

```
human/
├── index.ts              # HumanBehaviorMiddleware
└── entropy.ts            # Entropy collection
```

### Behavior Configuration

```typescript
interface HumanBehavior {
  mouse: MouseConfig;
  typing: TypingConfig;
  scroll: ScrollConfig;
  macro: MacroBehavior;
}

interface MouseConfig {
  jitter: number;           // Random movement noise (px)
  curvature: number;        // Bézier curve factor
  speed_base_ms: number;    // Base movement speed
  speed_variance: number;   // Speed randomization
  click_delay_ms: number;   // Pre-click pause
}

interface TypingConfig {
  wpm_base: number;         // Base typing speed
  wpm_variance: number;     // Speed variation
  error_rate: number;       // Typo probability
  correction_delay_ms: number;
  burst_probability: number;
  pause_probability: number;
  pause_duration_ms: number;
}
```

### Entropy Collection
- Mouse movement patterns
- Keyboard timing
- Scroll behavior
- Click patterns
- Session events

---

## 9. State Management

### Svelte 5 Runes Pattern

Manifold uses Svelte 5's runes (`$state`, `$derived`, `$effect`) for reactive state:

```typescript
// Example from profiles.svelte.ts
let profiles = $state<Profile[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);

let filteredProfiles = $derived.by(() => {
  let result = [...profiles];
  // filtering logic
  return result;
});
```

### Store Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      App Store (Global)                      │
│  - WebSocket connection                                      │
│  - Toast notifications                                       │
│  - Global settings                                           │
└─────────────────────────────────────────────────────────────┘
           │
           ├──────────────┬──────────────┬──────────────┐
           ▼              ▼              ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Profiles   │  │   Proxies    │  │  Automation  │  │   URL Test   │
│    Store     │  │    Store     │  │    Store     │  │    Store     │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

---

## 10. Data Flow

### Profile Launch Flow

```
1. User clicks "Launch" on profile
           │
           ▼
2. Frontend calls Tauri command `launch_profile`
           │
           ▼
3. Tauri spawns Playwright Bridge process
   with MANIFOLD_LAUNCH_CONFIG env var
           │
           ▼
4. Bridge parses config, launches Chromium
           │
           ▼
5. Bridge applies all evasions to page
           │
           ▼
6. Bridge starts WebSocket server
           │
           ▼
7. Frontend connects to Bridge WebSocket
           │
           ▼
8. User interacts via hardened browser
```

### Automation Flow

```
1. User imports credentials (text/file)
           │
           ▼
2. User configures form selectors
   (manual or via scraper)
           │
           ▼
3. User selects profile pool
           │
           ▼
4. User starts automation run
           │
           ▼
5. For each credential:
   a. Pick profile from pool
   b. Launch browser with evasions
   c. Navigate to login page
   d. Fill form with human-like behavior
   e. Submit and detect result
   f. Capture screenshot/session
   g. Report result
           │
           ▼
6. Aggregate results, export report
```

### Form Scraping Flow

```
1. User enters target URL
           │
           ▼
2. Scraper navigates to URL
           │
           ▼
3. Scraper dismisses cookie consent
           │
           ▼
4. Scraper finds login link/button
           │
           ▼
5. Scraper navigates to login page
           │
           ▼
6. Scraper detects form selectors:
   - Username field
   - Password field
   - Submit button
   - CAPTCHA presence
   - Error indicators
           │
           ▼
7. Returns selectors with confidence score
```

---

## 11. Key Features

### Feature Matrix

| Feature | Location | Description |
|---------|----------|-------------|
| **Fingerprint Generation** | `src/lib/fingerprint.ts`, `src-tauri/src/fingerprint.rs` | Seeded, deterministic fingerprint generation |
| **Profile Management** | `src/routes/profiles/`, `src/lib/stores/profiles.svelte.ts` | CRUD operations for browser profiles |
| **Proxy Rotation** | `src/lib/stores/proxy.svelte.ts` | Round-robin, Poisson-distributed rotation |
| **Browser Evasions** | `evasions/` | Anti-detection script injection |
| **Human Simulation** | `human/` | Realistic mouse/keyboard behavior |
| **Form Scraping** | `src/lib/utils/form-scraper.ts` | Automatic form selector detection |
| **Credential Automation** | `src/routes/automation/`, `playwright-bridge/login-runner.ts` | Bulk login testing |
| **Session Export** | `src-tauri/src/commands.rs` | HAR capture, session replay |
| **Geo Validation** | `src-tauri/src/geo_validator.rs` | Timezone/locale consistency |
| **Panic Button** | `src/lib/components/PanicButton.svelte` | Emergency shutdown |

### Proxy Support

| Type | Authentication | Notes |
|------|----------------|-------|
| HTTP | ✅ Yes | Full support |
| HTTPS | ✅ Yes | Full support |
| SOCKS5 | ⚠️ Limited | No auth in Playwright Chromium |

### Browser Support

| Browser | Support | Notes |
|---------|---------|-------|
| Chromium | ✅ Primary | Full evasion support |
| Firefox | ❌ No | Not implemented |
| WebKit | ❌ No | Not implemented |

---

## 12. File Structure Reference

### Complete Directory Tree

```
manifold/
├── .github/                    # GitHub Actions workflows
├── .svelte-kit/                # SvelteKit generated
├── .vscode/                    # VS Code settings
├── build/                      # Build output
├── coverage/                   # Test coverage reports
├── evasions/                   # Browser evasion scripts
│   ├── audio.ts
│   ├── canvas.ts
│   ├── client-hints.ts
│   ├── fonts.ts
│   ├── index.ts
│   ├── navigator.ts
│   ├── tls-grease.ts
│   ├── types.ts
│   ├── webgl.ts
│   └── webrtc.ts
├── human/                      # Human behavior simulation
│   ├── entropy.ts
│   └── index.ts
├── node_modules/               # NPM dependencies
├── playwright-bridge/          # Browser automation bridge
│   ├── index.ts
│   ├── login-runner.ts
│   ├── login-types.ts
│   ├── types.ts
│   └── tests/
├── profiles/                   # Profile data storage
├── scripts/                    # CLI scripts
│   ├── functionality-test.ts
│   ├── scraper.ts
│   ├── test-flow-joefortune.ts
│   └── tsconfig.json
├── src/                        # Frontend source
│   ├── app.css
│   ├── app.html
│   ├── lib/
│   │   ├── components/
│   │   ├── constants/
│   │   ├── presets/
│   │   ├── stores/
│   │   ├── utils/
│   │   ├── fingerprint.ts
│   │   ├── types.ts
│   │   └── websocket.ts
│   └── routes/
│       ├── automation/
│       ├── fingerprint/
│       ├── profiles/
│       ├── proxies/
│       ├── trace/
│       ├── url-test/
│       ├── +layout.svelte
│       ├── +layout.ts
│       └── +page.svelte
├── src-tauri/                  # Rust backend
│   ├── capabilities/
│   ├── gen/
│   ├── icons/
│   ├── src/
│   │   ├── commands.rs
│   │   ├── db.rs
│   │   ├── error.rs
│   │   ├── fingerprint.rs
│   │   ├── geo_validator.rs
│   │   ├── human.rs
│   │   ├── lib.rs
│   │   ├── main.rs
│   │   ├── profile.rs
│   │   └── proxy.rs
│   ├── tests/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── static/                     # Static assets
├── test-results/               # Test output
├── package.json                # NPM configuration
├── tailwind.config.js          # Tailwind CSS config
├── tsconfig.json               # TypeScript config
├── vite.config.js              # Vite config
└── vitest.config.ts            # Vitest config
```

---

## 13. Configuration & Environment

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `MANIFOLD_MASTER_KEY` | Database encryption key | None (unencrypted) |
| `MANIFOLD_LAUNCH_CONFIG` | Bridge launch configuration | Dev defaults |
| `MANIFOLD_DEBUG` | Enable debug logging | `0` |

### NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `vite dev` | Start dev server |
| `build` | `vite build` | Production build |
| `tauri` | `tauri` | Tauri CLI |
| `scraper` | `tsx scripts/scraper.ts` | Run scraper server |
| `bridge` | `tsx playwright-bridge/index.ts` | Run bridge directly |
| `bridge:dev` | `tsx --watch playwright-bridge/index.ts` | Bridge with hot reload |

### Tauri Configuration (`tauri.conf.json`)

```json
{
  "productName": "Manifold",
  "version": "0.1.0",
  "identifier": "com.manifold.app",
  "build": {
    "frontendDist": "../build"
  },
  "plugins": {
    "opener": {},
    "shell": { "open": true }
  }
}
```

---

## 14. Testing

### Test Locations

| Type | Location | Framework |
|------|----------|-----------|
| Unit Tests | `*.test.ts` files | Vitest |
| Store Tests | `src/lib/stores/*.test.ts` | Vitest |
| Utility Tests | `src/lib/utils/*.test.ts` | Vitest |
| E2E Scripts | `scripts/` | Playwright |
| Rust Tests | `src-tauri/tests/` | Cargo test |

### Running Tests

```bash
# Frontend unit tests
npm run test

# With coverage
npm run test -- --coverage

# Rust tests
cd src-tauri && cargo test

# E2E test flow
npx tsx scripts/test-flow-joefortune.ts
```

---

## Quick Reference

### Adding a New Evasion

1. Create `evasions/my-evasion.ts`
2. Export factory function: `export function myEvasion(cfg: EvasionConfig): string`
3. Add to `INIT_SCRIPTS` array in `evasions/index.ts`
4. Add config options to `EvasionConfig` type

### Adding a New Tauri Command

1. Add function in `src-tauri/src/commands.rs`
2. Add `#[tauri::command]` attribute
3. Register in `lib.rs` invoke_handler
4. Call from frontend: `invoke('command_name', { args })`

### Adding a New Store

1. Create `src/lib/stores/my-store.svelte.ts`
2. Define state with `$state()` runes
3. Define derived state with `$derived()`
4. Export store object with getters/actions
5. Import in components

### Adding a New Route

1. Create `src/routes/my-route/+page.svelte`
2. Add navigation link in `Sidebar.svelte`
3. Implement page component

---

*Last Updated: 2026-02-21*