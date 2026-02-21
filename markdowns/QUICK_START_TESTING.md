# Form Scraper — Quick Start Testing Guide

## Prerequisites

- Manifold built and running (`npm run tauri dev`)
- Internet connection
- Browser DevTools (F12)

---

## 1. Test Auto-fill in the UI

1. Open Manifold → **Automation** tab
2. Enter a target URL in the **Target Login URL** field
3. Click **Auto-fill**
4. Watch the status message below the button

### Expected outcomes

| Scenario | Message |
|---|---|
| Known preset (Google, Amazon, etc.) | `✓ Loaded preset for accounts.google.com` |
| Unknown site, detected | `✓ Auto-detected selectors (confidence: 82%)` |
| SPA detected | `✓ Auto-detected selectors (confidence: 74%) \| SPA (React)` |
| CAPTCHA present | `… \| CAPTCHA: reCAPTCHA` |
| Detection failed | `Could not auto-detect form selectors. …` |

---

## 2. Quick Smoke Tests

### 2a. Preset domain (instant)

```
URL: https://accounts.google.com/ServiceLogin
Expected: fills all fields immediately, no network request
```

### 2b. Unknown domain (scraped)

```
URL: https://example.com
Expected: 2-10 second wait, then either selectors or a clear error
```

### 2c. Invalid URL

```
URL: not-a-url
Expected: error — "Invalid URL: must start with http:// or https://"
```

### 2d. Unreachable host

```
URL: https://this-definitely-does-not-exist-xyz123.com/login
Expected: network error message within ~15 seconds
```

---

## 3. Verify in Browser Console (F12)

Open DevTools → Console, filter for `[formScraper]`.

A successful Tauri scrape looks like:

```
[formScraper] Tauri available: true
[formScraper] Target URL: https://example.com/login
[formScraper] Attempting Tauri-based form scraping...
[formScraper] ✅ Successfully scraped selectors using Tauri
[formScraper] Confidence: 85
[formScraper] Detected fields: {username: "✓", password: "✓", submit: "✓", ...}
```

A failed Tauri scrape with client-side fallback:

```
[formScraper] Tauri available: true
[formScraper] Attempting Tauri-based form scraping...
[formScraper] ⚠ Tauri scraping failed: Failed to fetch URL: …
[formScraper] Attempting client-side form detection...
[formScraper] ✅ Client-side detection succeeded
```

---

## 4. Run Rust Tests

```bash
cd src-tauri

# All tests
cargo test

# Unit tests only (fast, no network)
cargo test --lib commands::tests

# Integration tests only
cargo test --test form_scraper_integration

# Single test with output
cargo test test_google_form_detection -- --nocapture
```

### Expected output

```
test result: ok. 229 passed; 0 failed   ← lib tests (profiles, proxies, db + form scraper)
test result: ok. 17 passed;  0 failed   ← integration tests
```

---

## 5. Test Sites Cheat Sheet

| Site | Expected confidence | Notes |
|---|---|---|
| `https://accounts.google.com/ServiceLogin` | Preset (instant) | Multi-step, reCAPTCHA |
| `https://www.amazon.com/ap/signin` | Preset (instant) | |
| `https://www.instagram.com/accounts/login/` | Preset (instant) | |
| `https://www.linkedin.com/login` | Preset (instant) | |
| `https://twitter.com/login` | Preset (instant) | |
| `https://shopify.com/login` | Preset (instant) | |
| `https://github.com/login` | 70–90% | Simple static form |
| `https://reddit.com/login` | 50–80% | React SPA |
| `https://discord.com/login` | 40–70% | Heavy React SPA, may be low |

---

## 6. Troubleshooting

### "Command scrape_form_selectors not found"
Tauri app is not built with the latest changes.
```bash
npm run tauri build
# or for dev:
npm run tauri dev
```

### "invalid args `req`…"
Old build cached. Rebuild:
```bash
cargo clean && cargo build
```

### Confidence is 0 / no selectors detected
- Page may be a heavy SPA (form is rendered by JS after load)
- Open DevTools → Inspector and find selectors manually
- Add a hardcoded preset in `src-tauri/src/commands.rs` → `KNOWN_FORM_CONFIGS`
  or in `src/lib/utils/form-scraper.ts` → `FORM_PRESETS`

### Timeout error
- Default timeout is 15 s; the site may be slow
- No workaround in the UI yet — this is a known limitation

---

## 7. Adding a Custom Preset

**TypeScript (instant, client-side)** — `src/lib/utils/form-scraper.ts`:

```typescript
export const FORM_PRESETS = {
  // ... existing presets ...
  "yoursite.com": {
    username_selector: '#email',
    password_selector: '#password',
    submit_selector:   'button[type="submit"]',
    success_selector:  '.dashboard',
    failure_selector:  '.error',
  },
};
```

**Rust (server-side)** — `src/lib/stores/automation.svelte.ts` → `KNOWN_FORM_CONFIGS` follows the same pattern and is used by the automation run engine.

---

## 8. Files Reference

| File | Purpose |
|---|---|
| `src/routes/automation/+page.svelte` | `applyPreset()` — Auto-fill button handler |
| `src/lib/utils/form-scraper.ts` | TypeScript scraper, presets, fallback detection |
| `src-tauri/src/commands.rs` | `scrape_form_selectors` Rust command |
| `src-tauri/tests/form_scraper_integration.rs` | Integration test suite |
| `TAURI_PARAMETER_FIX.md` | Why the `req` arg error happened and how it was fixed |
| `ALL_PHASES_COMPLETION_SUMMARY.md` | Full implementation + test summary |