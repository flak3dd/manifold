# Form Scraper Troubleshooting Guide

## Error: "Could not auto-detect form selectors. Please configure manually."

This error occurs when the form scraper cannot automatically detect login form selectors from your target URL. Here's how to diagnose and fix it.

---

## Root Causes

### 1. **Tauri Bridge Not Running**
The form scraper prefers using the Tauri backend for reliable headless browser automation.

**Symptoms:**
- Scraper works locally but not in production
- Error appears immediately without delay
- Console shows "Tauri unavailable"

**Fix:**
```bash
# Make sure the Tauri bridge is running
npm run bridge

# Or in production, ensure the Tauri app is properly initialized
```

### 2. **CORS or Network Issues**
The client-side fallback tries to fetch the page, which may fail due to CORS.

**Symptoms:**
- Works for same-origin pages only
- External domains always fail
- Browser console shows CORS error

**Fix:**
- Use the Tauri bridge for cross-origin scraping
- Or configure CORS on the target server

### 3. **Complex SPA (React, Vue, Angular)**
Single-page applications render form elements dynamically via JavaScript, which the client-side parser can't detect.

**Symptoms:**
- Works for static HTML pages
- Fails for modern JavaScript frameworks
- Page shows "Loading..." when you view source

**Fix:**
```typescript
// Ensure waitForSPA option is enabled
const result = await scrapeFormSelectors({
  url: "https://example.com/login",
  timeout: 15000,
  waitForSPA: true,  // ← Important for React, Vue, Angular, etc.
});
```

### 4. **Form Elements Hidden or Non-Standard**
Some sites hide login forms behind modals, iframes, or use non-standard HTML.

**Symptoms:**
- Form exists but isn't detected
- Confidence score < 50%
- Success/failure selectors missing

**Fix:**
1. Manually inspect the page with browser DevTools
2. Find the selectors yourself (see "Manual Selector Discovery" below)
3. Enter them directly in the form

### 5. **Page Requires Authentication or Has Session State**
Some login pages redirect or require prior authentication.

**Symptoms:**
- Scraper sees different page than you do
- Confidence is very low
- Wrong selectors are detected

**Fix:**
- Make sure the target URL is the actual login page
- Test directly in your browser first
- Check if page requires cookies or session state

### 6. **JavaScript-Generated Form**
The form is rendered by JavaScript after page load.

**Symptoms:**
- View page source shows no form
- But form is visible in browser
- Client-side parser fails

**Fix:**
- Use Tauri bridge (handles JS execution)
- Or increase timeout for page to render

---

## Diagnostic Steps

### Step 1: Test the Target URL
Open the target URL in your browser and verify:
- ✅ Login form is visible
- ✅ Form has username/email field
- ✅ Form has password field
- ✅ Form has submit button
- ✅ Page loads completely

### Step 2: Check Console Logs
Open browser DevTools (F12) → Console tab and look for:

```javascript
// Success messages (green)
"[formScraper] Successfully scraped selectors using Tauri"
"[formScraper] Detected SPA framework: react"

// Warning messages (yellow)
"[formScraper] Tauri scraping failed, falling back to client-side"
"[formScraper] Client-side detection failed"

// Error details
"Unable to detect form selectors"
```

### Step 3: Check Tauri Bridge Status
```javascript
// In browser console, check if Tauri is available
console.log(typeof window.__TAURI_INTERNALS__);
// Should print: "object" (if Tauri is available)
// If undefined, Tauri bridge isn't running
```

### Step 4: Test with Hardcoded Presets
Try a known domain to verify scraper works:
```
Target URL: https://accounts.google.com/ServiceLogin
Expected: Should auto-detect with confidence > 80%
```

If this works, the scraper is functional. If this fails, check Tauri bridge.

---

## Manual Selector Discovery

If auto-detection fails, find selectors manually using browser DevTools:

### 1. Open DevTools
```
Windows/Linux: F12 or Ctrl+Shift+I
Mac: Cmd+Option+I
```

### 2. Inspect Username Field
1. Click "Inspect" tool (top-left of DevTools)
2. Click on the username/email input field
3. Right-click highlighted element → "Copy" → "Copy selector"
4. Paste into "Username / Email field" input

**Example selectors:**
```
#email
input[type="email"]
input[name="username"]
input[placeholder="Email or username"]
```

### 3. Inspect Password Field
1. Use Inspect tool on the password field
2. Copy selector
3. Paste into "Password field" input

**Example selectors:**
```
input[type="password"]
#password
input[name="pass"]
```

### 4. Inspect Submit Button
1. Use Inspect tool on the login/sign in button
2. Copy selector
3. Paste into "Submit button" input

**Example selectors:**
```
button[type="submit"]
button.login-btn
#sign-in-button
```

### 5. Inspect Success Indicator (Optional)
After successful login, what element appears?
- User profile icon
- Dashboard heading
- Account name
- Logout button

**Example selectors:**
```
.dashboard-header
#home-feed
.profile-avatar
[aria-label="logout"]
```

### 6. Inspect Failure Indicator (Optional)
When login fails, what error message appears?
- Red error text
- Alert box
- Error banner
- Toast notification

**Example selectors:**
```
.error-message
[class*="invalid"]
[role="alert"]
.invalid-credentials
```

---

## Advanced Troubleshooting

### Enable Verbose Logging
Edit the form scraper to log more details:

```typescript
// Add this to src/lib/utils/form-scraper.ts
console.log("[formScraper] Attempting Tauri scrape for:", options.url);
console.log("[formScraper] Tauri available:", isTauriAvailable());
console.log("[formScraper] Client-side fallback attempted");
```

### Test with Curl/Network Tools
Verify the page is accessible:
```bash
curl -I https://example.com/login
# Should return 200 OK, not 403/404/5xx
```

### Check Page Structure
View the page source to understand form structure:
```bash
curl https://example.com/login | grep -i "form\|input\|password\|submit"
```

### Test with Different URLs
Try variations of the URL:
```
https://example.com/login
https://example.com/signin
https://example.com/auth
https://example.com/account/login
```

### Increase Timeout
If page loads slowly, increase timeout:
```typescript
const result = await scrapeFormSelectors({
  url: targetUrl,
  timeout: 30000,  // ← Increase from default 15000
  waitForSPA: true,
});
```

---

## Common Website Configurations

### Google Accounts
- **URL**: `https://accounts.google.com/ServiceLogin`
- **Status**: ✅ Has hardcoded preset
- **Auto-detect**: Yes, should work immediately

### Microsoft / Office 365
- **URL**: `https://login.microsoft.com`
- **Status**: ✅ Has hardcoded preset
- **Auto-detect**: Yes, should work immediately

### Facebook
- **URL**: `https://www.facebook.com/login`
- **Status**: ⚠️ May require additional detection
- **Auto-detect**: Partial, may need manual adjustments

### LinkedIn
- **URL**: `https://www.linkedin.com/login`
- **Status**: ✅ Has hardcoded preset
- **Auto-detect**: Yes, should work immediately

### Twitter / X
- **URL**: `https://twitter.com/i/flow/login`
- **Status**: ✅ Has hardcoded preset
- **Auto-detect**: Partial (dynamic form loading)

### Amazon
- **URL**: `https://www.amazon.com/ap/signin`
- **Status**: ✅ Has hardcoded preset
- **Auto-detect**: Yes, should work immediately

### GitHub
- **URL**: `https://github.com/login`
- **Status**: ⚠️ No preset, but detectable
- **Auto-detect**: Usually works, may need timeout increase

### Custom Sites
- **Status**: ⚠️ Depends on HTML structure
- **Auto-detect**: Works best for standard forms
- **If fails**: Use manual selector discovery

---

## Solutions by Scenario

### Scenario: "Scraping..." button stuck for 30+ seconds

**Problem**: Timeout too long or Tauri bridge hanging

**Solutions**:
1. Increase Tauri bridge timeout in backend
2. Check if Tauri bridge process is running
3. Reduce timeout to 10 seconds for faster feedback
4. Use manual selector entry as fallback

### Scenario: Wrong selectors detected

**Problem**: Confidence score low or incorrect elements found

**Solutions**:
1. Use manual selector discovery (see above)
2. Check if page has multiple forms (usually gets first one)
3. Verify page fully loaded when scraping starts
4. Try different URL variation (www vs non-www, http vs https)

### Scenario: Works locally, fails in production

**Problem**: Tauri bridge not available in production environment

**Solutions**:
1. Ensure Tauri backend is running in production
2. Check Tauri availability: `console.log(typeof window.__TAURI_INTERNALS__)`
3. Implement fallback to manual configuration
4. Use hardcoded presets for known sites

### Scenario: Dynamic/modal forms not detected

**Problem**: Form hidden until user interaction or behind modal

**Solutions**:
1. Increase timeout to allow modal to appear
2. Ensure URL points directly to form page
3. Check if form appears after page load
4. Use SPA detection option: `waitForSPA: true`

### Scenario: CAPTCHA always detected but not present

**Problem**: False positive CAPTCHA detection

**Solutions**:
1. Manually clear captcha_selector field
2. Check if CAPTCHA script is present but hidden
3. Disable CAPTCHA detection if not needed
4. Report false positive with page URL

---

## Getting Help

### Provide These Details:
1. **Target URL**: The login page URL
2. **Error Message**: Exact error from console
3. **Console Logs**: Output from DevTools console
4. **Browser**: Chrome, Firefox, Safari, Edge
5. **Tauri Status**: Is bridge running?
6. **Page Type**: Static HTML, React, Vue, Angular, etc.

### Debug Output Example:
```javascript
// Browser console (F12)
[formScraper] Attempting Tauri scrape for: https://example.com/login
[formScraper] Tauri unavailable, falling back to client-side
[formScraper] Client-side detection failed: CORS error
```

### Manual Verification:
1. Open page in browser → Form visible? ✅ or ❌
2. Right-click form → Inspect → View HTML structure
3. Find `<input type="email">` or `<input type="password">`
4. Right-click → Copy selector
5. Verify selector works: `document.querySelector("#email")` should find element

---

## Quick Reference

| Issue | Solution | Time |
|-------|----------|------|
| Tauri not running | `npm run bridge` | 5min |
| CORS error | Use Tauri bridge | 2min |
| SPA not loading | Add `waitForSPA: true` | 1min |
| Manual detection | Use DevTools Inspector | 5min |
| Hardcoded preset available | Use that domain | <1sec |
| Timeout too short | Increase to 20-30 seconds | 1min |
| Complex form | Update selector patterns | 10min |

---

## Next Steps

1. ✅ Check if Tauri bridge is running
2. ✅ Verify target URL loads form in browser
3. ✅ Open browser DevTools console (F12)
4. ✅ Look for error messages in console
5. ✅ If auto-detect fails, use manual discovery
6. ✅ Test with known hardcoded preset domains first
7. ✅ Report issue with debug details if persistent

---

**Last Updated**: 2024-02-20
**Status**: Troubleshooting guide v1.0