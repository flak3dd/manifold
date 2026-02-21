# Form Scraper Tauri Backend - Test Guide

## Overview

This guide provides step-by-step instructions for testing the new `scrape_form_selectors` Tauri command implementation.

## Prerequisites

1. Tauri app built: `npm run tauri build`
2. Development environment set up
3. Browser with DevTools (F12)
4. Internet connection

## Unit Tests (Rust)

### Test Individual Detection Functions

The Rust backend includes several detection helper functions. To test them:

```bash
cd src-tauri
cargo test --lib
```

### Key Functions to Test

1. **find_username_field** - Detects email/username inputs
2. **find_password_field** - Detects password inputs
3. **find_submit_button** - Detects submit buttons
4. **detect_spa** - Identifies SPA frameworks
5. **detect_captcha** - Finds CAPTCHA providers
6. **detect_mfa_indicators** - Finds 2FA/MFA indicators

## Integration Tests

### Test 1: Basic Form Detection (Google Login)

**Target URL**: `https://accounts.google.com/ServiceLogin`

**Expected Results**:
- `username_selector`: Should find email input (high confidence)
- `password_selector`: Should find password input (high confidence)
- `submit_selector`: Should find submit button (high confidence)
- `confidence`: 80-100%
- `is_spa`: `false` (or `true` depending on Google's current implementation)

**How to Test**:
1. Open automation page
2. Enter URL: `https://accounts.google.com/ServiceLogin`
3. Click "Auto-fill"
4. Check console (F12) for detailed logs
5. Verify selectors are populated in form fields

**Expected Console Output**:
```
[formScraper] Target URL: https://accounts.google.com/ServiceLogin
[formScraper] Attempting Tauri-based form scraping...
[formScraper] ✅ Successfully scraped selectors using Tauri
[formScraper] Confidence: 95
[formScraper] Detected fields: {username: "✓", password: "✓", submit: "✓", ...}
```

### Test 2: SPA Detection (React Site)

**Target URL**: `https://app.slack.com/client/`

**Expected Results**:
- `is_spa`: `true`
- `spa_framework`: `React` or similar
- Form fields should still be detected
- `confidence`: 60-90%

**How to Test**:
1. Enter URL in automation page
2. Click "Auto-fill"
3. Check for SPA framework in response
4. Verify selectors still detected despite JavaScript rendering

### Test 3: CAPTCHA Detection

**Target URL**: `https://www.hcaptcha.com/` (or any site with CAPTCHA)

**Expected Results**:
- `has_captcha`: `true`
- `captcha_providers`: Should include detected provider(s)
- `captcha_selector`: CSS selector for CAPTCHA widget

**How to Test**:
1. Navigate to a site with visible CAPTCHA
2. Enter URL in automation
3. Click "Auto-fill"
4. Check console for CAPTCHA detection
5. Verify `captcha_providers` list is populated

### Test 4: Invalid URL Handling

**Test Cases**:

#### 4a: Malformed URL
**Input**: `not-a-valid-url`
**Expected**: Error message about invalid URL format

#### 4b: Unreachable URL
**Input**: `https://this-domain-definitely-does-not-exist-12345.com`
**Expected**: Network error message, graceful handling

#### 4c: Page Not Found
**Input**: `https://google.com/this-page-does-not-exist-12345`
**Expected**: HTTP error message, confidence = 0

**How to Test**:
1. Try each URL in automation
2. Check console for error messages
3. Verify no crashes or unhandled exceptions
4. Check error message is user-friendly

### Test 5: Timeout Handling

**Target URL**: Any URL (we'll use a slow one like a local server)

**How to Test**:
1. Start a slow local server that delays response:
```bash
# Simple Python server with delay
python3 -c "
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
class DelayedHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        time.sleep(20)  # 20 second delay
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(b'<html><body>Test</body></html>')
HTTPServer(('localhost', 8888), DelayedHandler).serve_forever()
"
```

2. Enter URL: `http://localhost:8888/`
3. Click "Auto-fill"
4. Timeout should trigger after 15 seconds
5. Error message should explain timeout

**Expected Timeout**: 15 seconds (default)

### Test 6: Framework Detection Accuracy

Test detection of different SPA frameworks:

#### React Sites
**URLs to Test**:
- NextJS: `https://nextjs.org/`
- Create React App: Any site with `data-react-root`

#### Vue Sites
**URLs to Test**:
- `https://vuejs.org/`

#### Angular Sites
**URLs to Test**:
- `https://angular.io/`

#### Expected Results
- Correct framework identified
- Form fields still detected
- High confidence for form elements

### Test 7: Multiple Field Types

Test detection of various form field types:

#### 7a: Username Variations
**Test Different Input Types**:
- `<input type="email">`
- `<input name="username">`
- `<input name="user_email">`
- `<input placeholder="Email">`

#### 7b: Password Variations
**Test Different Input Types**:
- `<input type="password">`
- `<input name="pwd">`
- `<input name="pass">`

#### 7c: Submit Button Variations
**Test Different Types**:
- `<button type="submit">`
- `<input type="submit">`
- `<button onclick="...">Login</button>`

**How to Test**:
1. Create a test HTML page with various input types
2. Host locally: `python3 -m http.server 8000`
3. Enter URL in automation
4. Verify detection of each variation
5. Check accuracy of selector generation

### Test 8: Success/Failure Indicators

Test detection of success and failure messages:

**Test Page HTML**:
```html
<form>
  <input type="email" name="email">
  <input type="password" name="password">
  <button type="submit">Login</button>
</form>
<div class="dashboard" style="display:none;">Success!</div>
<div class="error-message" style="display:none;">Failed!</div>
```

**Expected Results**:
- `success_selector`: `.dashboard`
- `failure_selector`: `.error-message`

**How to Test**:
1. Create test HTML with success/failure divs
2. Host locally
3. Run auto-fill
4. Verify selectors detected

### Test 9: TOTP/2FA Field Detection

Test MFA field detection:

**Test Input Types**:
- `<input name="totp">`
- `<input name="2fa_code">`
- `<input placeholder="Authenticator Code">`

**Expected Results**:
- `totp_selector`: Detected
- `mfa_selector`: Same as totp
- `has_mfa`: `true`

### Test 10: Consent Banner Detection

Test detection of cookie/GDPR consent banners:

**Target URL**: `https://example.com/` (or any site with consent banner)

**Expected Results**:
- `consent_selector`: CSS selector for consent button/banner

## Performance Tests

### Test 1: Response Time

**Objective**: Measure scraping speed

**How to Test**:
1. Open DevTools Network tab
2. Run auto-fill on known domain
3. Note time from request to response
4. Expected: 2-10 seconds

**Console Output**:
```
[formScraper] Starting Tauri-based form scraping...
[timestamp] Request sent
[timestamp] Response received
```

### Test 2: Memory Usage

**Objective**: Check memory consumption during scrapes

**How to Test**:
1. Open DevTools → Memory tab
2. Take heap snapshot before
3. Run auto-fill
4. Take heap snapshot after
5. Compare memory usage
6. Expected: +1-2 MB

### Test 3: Concurrent Scrapes

**Objective**: Test multiple simultaneous scrapes

**How to Test**:
1. Click auto-fill on multiple tabs simultaneously
2. Monitor console for parallel execution
3. Check all complete successfully
4. Verify no race conditions or conflicts

## Browser DevTools Testing

### Test 1: Network Tab

1. Open DevTools → Network tab
2. Run auto-fill
3. Check for HTTP request to target URL
4. Verify:
   - User-Agent: `Mozilla/5.0...Chrome/120.0...`
   - Method: `GET`
   - Status: `200` or appropriate error code
   - Response type: `text/html`

### Test 2: Console Logs

1. Open DevTools → Console tab
2. Filter for `[formScraper]` messages
3. Verify detailed logging:
   - URL being scraped
   - Tauri availability
   - Detection results
   - Confidence score
   - Any warnings or errors

**Expected Logs**:
```
[formScraper] Tauri available: true
[formScraper] Target URL: https://...
[formScraper] Attempting Tauri-based form scraping...
[formScraper] ✅ Successfully scraped selectors using Tauri
[formScraper] Confidence: 85
[formScraper] Detected fields: {username: "✓", password: "✓", submit: "✓"}
```

## Regression Tests

### Test 1: Client-Side Detection Still Works

**Objective**: Ensure fallback detection still works

**How to Test**:
1. Disable Tauri (simulated)
2. Run auto-fill on same-origin page
3. Verify client-side detection works
4. Check confidence score is reasonable

### Test 2: Preset Domains Still Work

**Objective**: Verify hardcoded presets still function

**Test URLs**:
- `https://accounts.google.com/ServiceLogin`
- `https://www.instagram.com/accounts/login/`
- `https://www.amazon.com/ap/signin`
- `https://www.linkedin.com/login`

**Expected Results**:
- Presets loaded instantly
- High confidence (90-100%)
- No server scraping needed

### Test 3: Error Recovery

**Objective**: Verify graceful error handling

**How to Test**:
1. Test with network offline
2. Test with invalid JSON response
3. Test with malformed HTML
4. Test with very large page (5MB+)
5. Verify:
   - No crashes
   - Clear error messages
   - Fallback to client-side detection

## Checklist for Full Testing

- [ ] Compile without errors: `cargo check`
- [ ] Tauri app builds: `npm run tauri build`
- [ ] Google login page auto-fills correctly
- [ ] Invalid URLs show clear errors
- [ ] Timeout handling works
- [ ] SPA framework detection accurate
- [ ] CAPTCHA detection identifies providers
- [ ] MFA/TOTP fields detected
- [ ] Success/failure indicators found
- [ ] Multiple concurrent scrapes work
- [ ] Memory usage reasonable (<5 MB)
- [ ] Console logs are detailed and helpful
- [ ] Presets still work
- [ ] Client-side fallback works
- [ ] No security issues (validates URLs, etc.)

## Known Test Limitations

1. **Dynamic Content**: Pages that load content via JavaScript won't be detected server-side
2. **Authentication**: Can't test pages requiring login
3. **Rate Limiting**: Some sites may rate-limit repeated requests
4. **JavaScript Rendering**: Server-side doesn't execute JavaScript (use playwright-bridge for that)

## Troubleshooting Test Issues

### Issue: "Command scrape_form_selectors not found"
- **Cause**: Command not registered in `src-tauri/src/lib.rs`
- **Fix**: Check `invoke_handler!` includes `scrape_form_selectors`
- **Rebuild**: `npm run tauri build`

### Issue: HTTP client timeouts
- **Cause**: Network too slow or target unreachable
- **Fix**: Increase timeout, check internet connection
- **Test**: Try with `https://example.com` (should be fast)

### Issue: No selectors detected
- **Cause**: Page structure different than expected
- **Fix**: Check page with DevTools, adjust detection patterns
- **Debug**: Add logging to `detect_form_fields` function

### Issue: Wrong framework detected
- **Cause**: Detection patterns outdated
- **Fix**: Update `detect_spa_framework` function
- **Example**: Add new framework indicators

## Next Steps After Testing

1. **File Issues**: Report any bugs found during testing
2. **Add Tests**: Create unit tests for edge cases
3. **Optimize**: Profile and improve performance
4. **Document**: Update docs with test results
5. **Iterate**: Improve detection based on test feedback

## Quick Test Script

To quickly test the backend without GUI:

```bash
# 1. Start Tauri app with devtools
npm run tauri dev

# 2. In browser console, test the command:
await window.__TAURI__.invoke('scrape_form_selectors', {
  url: 'https://accounts.google.com/ServiceLogin',
  timeout: 15000,
  wait_for_spa: true,
  detect_captcha: true,
  detect_mfa: true,
})

# 3. Check response and confidence score
```

## See Also

- `FORM_SCRAPER_ENHANCEMENT.md` - Technical documentation
- `AUTOMATION.md` - Automation system guide
- `src-tauri/src/commands.rs` - Command implementation
- `src/lib/utils/form-scraper.ts` - TypeScript integration