# Tauri Command Parameter Fix

## Problem

The `scrape_form_selectors` command was failing with:

```
invalid args `req` for command `scrape_form_selectors`: command scrape_form_selectors missing required key req
```

## Root Cause

The Rust command was defined to accept a single struct parameter named `req`:

```rust
#[tauri::command]
pub async fn scrape_form_selectors(
    req: FormScraperRequest,
) -> Result<ScrapedFormSelectorsResponse> {
```

Tauri 2.x serializes `invoke()` arguments as a flat JSON object, where each key maps directly to a command parameter by name. When the frontend calls:

```typescript
await invoke("scrape_form_selectors", {
  url: "...",
  timeout: 15000,
  wait_for_spa: true,
  detect_captcha: true,
  detect_mfa: true,
});
```

Tauri looks for a parameter literally named `req` in the flat object — and fails because no such key exists. Wrapping all fields into a single struct means Tauri expects `{ req: { url, timeout, ... } }`, not `{ url, timeout, ... }`.

## Fix

Replace the single struct parameter with individual flat parameters that match the keys the frontend already sends:

```rust
// Before (broken)
#[tauri::command]
pub async fn scrape_form_selectors(
    req: FormScraperRequest,
) -> Result<ScrapedFormSelectorsResponse> {
    // used as req.url, req.timeout, ...
}

// After (fixed)
#[tauri::command]
pub async fn scrape_form_selectors(
    url: String,
    timeout: u64,
    wait_for_spa: Option<bool>,
    detect_captcha: Option<bool>,
    detect_mfa: Option<bool>,
) -> Result<ScrapedFormSelectorsResponse> {
    // used as url, timeout, ...
}
```

The `FormScraperRequest` struct was also removed since it was no longer needed.

## Secondary Fix

Renaming the `detect_captcha` parameter shadowed the free function `detect_captcha(html)` defined later in the file, causing a compiler error. The free function was renamed `detect_captcha_in_html` to avoid the conflict:

```rust
// Renamed to avoid shadowing the `detect_captcha` parameter
fn detect_captcha_in_html(html: &str) -> (bool, Vec<String>) {
    ...
}
```

All internal call sites and unit tests were updated accordingly.

## Rule: Tauri 2.x Invoke Argument Mapping

| Frontend call | Rust signature |
|---|---|
| `invoke("cmd", { foo: 1, bar: 2 })` | `fn cmd(foo: i32, bar: i32)` ✅ |
| `invoke("cmd", { foo: 1, bar: 2 })` | `fn cmd(req: MyStruct)` ❌ (expects `{ req: {...} }`) |
| `invoke("cmd", { req: { foo: 1 } })` | `fn cmd(req: MyStruct)` ✅ |

**Always match parameter names to the exact keys sent by the frontend.** Use structs only when the frontend explicitly nests the payload under that struct's name as a key.

## Files Changed

| File | Change |
|---|---|
| `src-tauri/src/commands.rs` | Replaced `req: FormScraperRequest` with flat parameters; removed `FormScraperRequest` struct; renamed `detect_captcha` → `detect_captcha_in_html` |

## Verification

```bash
cargo check   # no errors
cargo test    # 246 passed, 0 failed
```
