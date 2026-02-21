# Changelog

All notable changes to Manifold are documented in this file.

## [Unreleased]

### Fixed

#### Browser Automation & Login Testing
- **Fixed: Entropy capture SyntaxError** - Removed TypeScript `as any` cast from `ENTROPY_SCRIPT` in `playwright-bridge/index.ts` that was causing `SyntaxError: Unexpected identifier 'as'` when evaluated in browser context
- **Fixed: Soft signal detection SyntaxError** - Removed TypeScript casts from `page.evaluate()` callbacks in `login-runner.ts` (lines 273, 502) that prevented proper window property access
- **Fixed: Window property access** - Changed `(window as any).__manifold_last_status` to `window.__manifold_last_status` for plain JavaScript compatibility

#### Tauri Integration & IPC
- **Fixed: "Cannot read properties of undefined (reading 'invoke')" error** - Implemented dynamic imports of `@tauri-apps/api/core` to handle cases where Tauri is unavailable (e.g., dev mode in browser)
- **Added: Safe invoke wrapper** - Created `safeInvoke()` helper function that gracefully handles missing Tauri with proper error logging
- **Added: Tauri availability check** - Implemented `isTauriAvailable()` to detect `window.__TAURI_INTERNALS__` before attempting IPC calls
- **Added: Invoke caching** - Implemented `getInvoke()` with memoization to avoid repeated dynamic imports

#### Fingerprint Generation
- **Fixed: Fingerprint generation in dev mode** - Added JavaScript fallback (`generateFingerprintFallback`) for fingerprint generation when Tauri is unavailable
- **Added: Seeded PRNG in TypeScript** - Implemented deterministic fingerprint generator matching Rust `FingerprintOrchestrator::generate()` output
- **Added: JS fingerprint generator** - Created `src/lib/fingerprint.ts` (343 lines) with:
  - Seeded PRNG (LCG algorithm)
  - OS-weighted selection (Windows 70%, macOS 25%, Linux 5%)
  - UA construction for Chrome 120-131
  - WebGL options from real GPU models
  - Font subset selection per OS
  - Locale/timezone pairs
  - Hardware concurrency and device memory distributions
  - WebRTC mDNS hostname and IP generation
  - Permission state defaults

### Added

#### Automation UI Enhancements
- **Added: Results filtering system** - Implemented advanced filtering for login attempt results:
  - Search by username or final URL
  - Filter by credential status (success, failed, blocked, error)
  - Filter by attempt outcome (wrong credentials, CAPTCHA, rate limit, IP block, timeout, error)
  - Sort by index, username, status, or duration (ascending/descending toggle)
  - Real-time result count display

- **Added: Results filter bar component** - New UI element with:
  - Text search input with icon
  - Status dropdown selector
  - Outcome dropdown selector
  - Sort criteria dropdown
  - Sort direction toggle button
  - Result counter showing filtered/total

- **Added: CSS styling for filter bar** - Comprehensive styles including:
  - Search input with focus states
  - Filter select styling with hover/focus effects
  - Count badge with subtle background
  - Flex layout with responsive wrapping
  - Consistent color scheme matching design system

- **Added: Results filtering logic** - `filterResults()` function that:
  - Combines search, status, and outcome filters
  - Applies dynamic sorting with configurable direction
  - Maintains index for row numbering
  - Preserves result objects for actions

#### Documentation
- **Added: AUTOMATION.md** - 396-line comprehensive guide including:
  - Quick start (3 minutes to first run)
  - Form selector configuration examples
  - Advanced features (2FA, TOTP, extras)
  - Soft signal detection details
  - Result downloads and formats
  - Session capture structure
  - Troubleshooting guide with solutions
  - API integration reference
  - Performance optimization tips
  - Security notes and limitations
  - Real-world examples (account security testing, regional monitoring, deployment validation)

- **Added: FEATURES.md** - 415-line feature overview documenting:
  - 12 core components with detailed descriptions
  - Browser fingerprinting system
  - Human behavior simulation (mouse, keyboard, scroll, macros)
  - Anti-detection evasions (JS, Playwright, TLS/JA3)
  - Login automation with form configuration
  - Soft signal detection and response
  - Profile rotation engine
  - Results tracking and filtering
  - Run management and history
  - Proxy integration
  - Data export and analysis
  - Configuration and presets
  - Technical architecture overview
  - Performance characteristics
  - Security and privacy notes
  - Use cases and getting started guide

- **Added: CHANGELOG.md** (this file) - Version history and release notes

### Enhanced

#### Store Error Handling
- **Enhanced: Profile store (profiles.svelte.ts)** - Updated 12 invoke calls to use `safeInvoke`:
  - `loadProfiles()` - handles Tauri unavailability gracefully
  - `getProfile()` - returns null on Tauri failure
  - `createProfile()` - throws with clear error message
  - `updateProfile()` - throws with clear error message
  - `deleteProfile()` - handles graceful failure
  - `deleteSelected()` - handles batch deletions
  - `reseedProfile()` - throws with clear error message
  - `generateFingerprint()` - falls back to JS implementation
  - `cloneProfile()` - throws with clear error message
  - `launchProfile()` - throws with clear error message
  - `stopProfile()` - handles graceful failure
  - Emergency rotate functions

- **Enhanced: App store (app.svelte.ts)** - Updated 5 invoke calls with error handling:
  - `loadSources()` - graceful fallback for missing data
  - `persistSources()` - error logging
  - `startScraper()` - error handling
  - `stopScraper()` - error handling
  - Data persistence with fallback

- **Enhanced: Proxy store (proxy.svelte.ts)** - Updated 7 invoke calls:
  - `loadProxies()` - graceful empty state
  - `addProxy()` - clear error messages
  - `updateProxy()` - error handling with validation
  - `deleteProxy()` - graceful failure
  - `checkProxy()` - error handling
  - `checkAllProxies()` - batch error handling
  - Removed undefined `hydrateProxy` calls

### Changed

- **Changed: Entropy script** - Replaced `navigator.deviceMemory` type casting with plain property access (more compatible)
- **Changed: Navigator access** - Updated window property access patterns in soft signal detection for broader browser compatibility
- **Changed: Error messages** - Improved error clarity in fingerprint generation with context-specific messages

### Verified

- **TypeScript compilation**: 0 errors
- **Svelte type checking**: 0 errors, 39 pre-existing warnings (a11y only)
- **All invoke calls**: Wrapped with proper error handling
- **Browser compatibility**: Removed TypeScript syntax from runtime-evaluated strings

## [0.1.0] - 2024-01-15

### Initial Release

- Core fingerprinting engine with 70+ parameters
- Browser automation with Playwright + Chromium
- Anti-detection evasions (JavaScript, TLS/JA3)
- Login automation with form configuration
- Soft signal detection (CAPTCHA, rate limits, IP blocks)
- Profile rotation engine
- Proxy integration with health checking
- Session capture (cookies, localStorage, IndexedDB)
- Real-time monitoring and result tracking
- Run history and reporting
- Desktop app (Tauri) with SQLite backend
- SvelteKit + TypeScript frontend

---

## Format Notes

- **Fixed**: Bug fixes
- **Added**: New features or capabilities
- **Enhanced**: Improvements to existing features
- **Changed**: Changes to existing functionality
- **Verified**: Testing and validation results

Each section includes:
- Brief description of change
- Affected components
- Technical details where relevant
- Benefits or impact

---

For detailed guides, see:
- [AUTOMATION.md](AUTOMATION.md) - Browser automation guide
- [FEATURES.md](FEATURES.md) - Complete feature documentation
- [README.md](README.md) - Project overview