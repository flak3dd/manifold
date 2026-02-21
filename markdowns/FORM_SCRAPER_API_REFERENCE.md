# Form Scraper Tauri Command - API Reference

## Command: `scrape_form_selectors`

### Quick Reference

```typescript
// TypeScript/JavaScript
const result = await window.__TAURI__.invoke('scrape_form_selectors', {
  url: string;
  timeout: u64;
  wait_for_spa?: boolean;
  detect_captcha?: boolean;
  detect_mfa?: boolean;
});
```

## Request Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | — | Target login URL (must start with http:// or https://) |
| `timeout` | u64 | Yes | — | Maximum wait time in milliseconds (max 30000) |
| `wait_for_spa` | boolean | No | true | Wait for SPA framework detection (reserved) |
| `detect_captcha` | boolean | No | true | Enable CAPTCHA provider detection |
| `detect_mfa` | boolean | No | true | Enable MFA/2FA indicator detection |

## Response Type

```typescript
interface ScrapedFormSelectorsResponse {
  // Original URL
  url: string;

  // Confidence score (0-100%)
  confidence: number;

  // Detected form field selectors
  username_selector?: string;
  password_selector?: string;
  submit_selector?: string;
  success_selector?: string;
  failure_selector?: string;
  captcha_selector?: string;
  consent_selector?: string;
  totp_selector?: string;
  mfa_selector?: string;

  // Framework and feature detection
  is_spa: boolean;
  spa_framework?: string;
  has_captcha: boolean;
  captcha_providers: string[];
  has_mfa: boolean;
  mfa_type?: string;

  // Debug information
  details: string[];
}
```

## Usage Examples

### Basic Usage

```typescript
// Simple detection
const result = await window.__TAURI__.invoke('scrape_form_selectors', {
  url: 'https://accounts.google.com/ServiceLogin',
  timeout: 15000,
});

console.log(`Confidence: ${result.confidence}%`);
console.log(`Username field: ${result.username_selector}`);
console.log(`Password field: ${result.password_selector}`);
console.log(`Submit button: ${result.submit_selector}`);
```

### With Feature Detection

```typescript
// Full feature detection
const result = await window.__TAURI__.invoke('scrape_form_selectors', {
  url: 'https://example.com/login',
  timeout: 15000,
  detect_captcha: true,
  detect_mfa: true,
});

if (result.has_captcha) {
  console.log(`CAPTCHA detected: ${result.captcha_providers.join(', ')}`);
}

if (result.has_mfa) {
  console.log(`MFA detected, TOTP field: ${result.totp_selector}`);
}

if (result.is_spa) {
  console.log(`SPA framework: ${result.spa_framework}`);
}
```

### With Error Handling

```typescript
try {
  const result = await window.__TAURI__.invoke('scrape_form_selectors', {
    url: userInput.url,
    timeout: 15000,
  });

  if (result.confidence > 50) {
    // High confidence - auto-fill
    applySelectors(result);
  } else if (result.confidence > 0) {
    // Low confidence - show for review
    showConfirmDialog(result);
  } else {
    // No detection - show error
    showError('Could not detect form fields. Please configure manually.');
  }
} catch (error) {
  console.error('Form scraping failed:', error);
  showError(error.message);
}
```

## Response Examples

### Successful Detection (Google)

```json
{
  "url": "https://accounts.google.com/ServiceLogin",
  "confidence": 95,
  "username_selector": "input[type='email']",
  "password_selector": "input[type='password']",
  "submit_selector": "#identifierNext button",
  "success_selector": "[data-ogsr-up]",
  "failure_selector": "#view_container .Ekjuhf",
  "captcha_selector": ".g-recaptcha",
  "totp_selector": "input[name='totpPin']",
  "mfa_selector": "input[name='totpPin']",
  "is_spa": false,
  "spa_framework": null,
  "has_captcha": true,
  "captcha_providers": ["reCAPTCHA"],
  "has_mfa": true,
  "mfa_type": "totp",
  "details": [
    "Detected using Tauri form scraper",
    "username: input[type='email'] (score: 28)",
    "password: input[type='password'] (score: 25)",
    "submit: #identifierNext button (score: 22)"
  ]
}
```

### Low Confidence (Unknown Site)

```json
{
  "url": "https://example.com/login",
  "confidence": 45,
  "username_selector": "input[name='user']",
  "password_selector": "input[type='password']",
  "submit_selector": "button[type='submit']",
  "success_selector": null,
  "failure_selector": ".alert",
  "is_spa": true,
  "spa_framework": "React",
  "has_captcha": false,
  "captcha_providers": [],
  "has_mfa": false,
  "details": [
    "Detected SPA framework: React",
    "Low confidence due to custom form structure"
  ]
}
```

### No Detection

```json
{
  "url": "https://example.com/unknown",
  "confidence": 0,
  "username_selector": null,
  "password_selector": null,
  "submit_selector": null,
  "is_spa": false,
  "spa_framework": null,
  "has_captcha": false,
  "captcha_providers": [],
  "has_mfa": false,
  "details": [
    "No form fields detected on page",
    "Page may require authentication or use Shadow DOM"
  ]
}
```

## Error Responses

### Invalid URL

```typescript
// Input
await window.__TAURI__.invoke('scrape_form_selectors', {
  url: 'not-a-valid-url',
  timeout: 15000,
});

// Response: Error
// "Invalid URL: must start with http:// or https://"
```

### Network Timeout

```typescript
// Input
await window.__TAURI__.invoke('scrape_form_selectors', {
  url: 'https://very-slow-site.com',
  timeout: 5000,  // 5 second timeout
});

// Response: Error
// "Failed to fetch URL: operation timed out"
```

### Unreachable Host

```typescript
// Input
await window.__TAURI__.invoke('scrape_form_selectors', {
  url: 'https://this-domain-does-not-exist-xyz.com',
  timeout: 15000,
});

// Response: Error
// "Failed to fetch URL: Name or service not known"
```

## Field Detection Rules

### Username Field Detection

Detects via:
- `input[type='email']`
- `input[name*='email']`
- `input[name*='username']`
- `input[name*='user']`
- `input[placeholder*='email']`
- `input[placeholder*='username']`

### Password Field Detection

Detects via:
- `input[type='password']`
- `input[name*='password']`
- `input[name*='pwd']`
- `input[name*='pass']`

### Submit Button Detection

Detects via:
- `button[type='submit']`
- `input[type='submit']`
- Buttons containing: "Login", "Sign in", "Submit"

### CAPTCHA Detection

Detects:
- **reCAPTCHA**: `.g-recaptcha`, `g-recaptcha`, `[data-sitekey]`
- **hCaptcha**: `.h-captcha`, `h-captcha`
- **Arkose**: `arkose` script
- **GeeTest**: `geetest`
- **Cloudflare**: `cloudflare` + `challenge`
- **FunCaptcha**: `funcaptcha`

### Framework Detection

Detects:
- **React**: `data-react-root`, `__react`
- **Vue**: `__vue__`
- **Angular**: `ng-app`, `ng-version`
- **Svelte**: `svelte` (via class names)
- **Ember**: `ember-application`
- **Next.js**: `__next`
- **Nuxt**: `_nuxt`

### MFA Detection

Detects via:
- `input[name*='totp']`
- `input[name*='2fa']`
- `input[name*='mfa']`
- `input[placeholder*='code']`
- Keywords: "2fa", "two-factor", "authenticator", "verify"

## Confidence Scoring

Scoring formula:

```
Base score: 0

Per field found:
  + Username field: 20%
  + Password field: 20%
  + Submit button: 20%
  + Success indicator: 15%
  + Failure indicator: 10%
  + CAPTCHA detected: 5%
  + TOTP field: 5%

Bonus:
  + All 3 critical fields: +5%

Maximum: 100%
```

## Best Practices

### 1. Handle Timeouts Gracefully

```typescript
// Use reasonable timeout
const timeout = 15000; // 15 seconds

try {
  const result = await window.__TAURI__.invoke('scrape_form_selectors', {
    url: targetUrl,
    timeout,
  });
} catch (error) {
  if (error.includes('timeout')) {
    // Fall back to manual entry
    showManualFormInput();
  }
}
```

### 2. Check Confidence Before Using

```typescript
const result = await scrapeFormSelectors(url);

if (result.confidence >= 80) {
  // High confidence - auto-apply
  applySelectors(result);
} else if (result.confidence >= 50) {
  // Medium confidence - show for confirmation
  showReviewDialog(result);
} else {
  // Low/no confidence - require manual input
  showManualInput();
}
```

### 3. Provide User Feedback

```typescript
// Show detection progress
showMessage('Detecting form fields...');

const result = await scrapeFormSelectors(url);

if (result.confidence > 0) {
  showMessage(`✓ Detected with ${result.confidence}% confidence`);
  if (result.is_spa) {
    showMessage(`• SPA: ${result.spa_framework}`);
  }
  if (result.has_captcha) {
    showMessage(`• CAPTCHA: ${result.captcha_providers.join(', ')}`);
  }
} else {
  showMessage('✗ Could not detect form fields');
}
```

### 4. Handle Feature Detection

```typescript
const result = await scrapeFormSelectors(url);

// Warn about CAPTCHA
if (result.has_captcha) {
  showWarning(`CAPTCHA detected (${result.captcha_providers.join(', ')})`);
}

// Show MFA fields
if (result.has_mfa) {
  if (result.totp_selector) {
    enableTotpInput(result.totp_selector);
  }
}

// Note SPA complexity
if (result.is_spa) {
  console.log(`Website uses ${result.spa_framework}`);
}
```

## Performance Tips

- **Timeout**: 15 seconds is recommended (may be slower for large pages)
- **Concurrent Requests**: Can safely run multiple scrapes in parallel
- **Caching**: Consider caching results per domain
- **Fallback**: Have manual input as fallback

## Limitations

- ❌ No JavaScript execution (server-side parsing only)
- ❌ No Shadow DOM support
- ❌ No iframe detection
- ❌ No authentication support
- ❌ No dynamic content (AJAX loaded)

## Migration from Client-Side

If migrating from client-side detection:

```typescript
// Old way (client-side only)
const selectors = detectClientSide(url);

// New way (server-side first, then client-side fallback)
let selectors;
if (isTauriAvailable()) {
  selectors = await scrapeFormSelectors(url);
} else {
  selectors = detectClientSide(url);
}
```

## See Also

- `FORM_SCRAPER_ENHANCEMENT.md` - Technical documentation
- `FORM_SCRAPER_TEST_GUIDE.md` - Testing procedures
- `AUTOMATION.md` - Automation system guide
- `src/lib/utils/form-scraper.ts` - Frontend implementation
- `src-tauri/src/commands.rs` - Backend implementation
