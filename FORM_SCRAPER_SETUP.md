# Form Scraper Integration Guide

## Overview

The Form Scraper utility automatically detects and extracts login form selectors from target URLs. When you click the "Auto-fill" button in the automation setup, it will:

1. Check hardcoded presets for known domains (Google, Instagram, Amazon, LinkedIn, etc.)
2. If no preset exists, scrape the target URL to detect form elements
3. Use intelligent heuristics to identify username, password, submit, and other form fields
4. Fill in the form configuration automatically

## How It Works

### Detection Algorithm

The scraper uses multiple strategies to find form elements:

1. **Pattern Matching** - Common selectors for each field type:
   - Username: `input[type="email"]`, `input[name*="user"]`, `input[placeholder*="email"]`
   - Password: `input[type="password"]`, `input[name="password"]`
   - Submit: `button[type="submit"]`, `button:contains("Login")`
   - CAPTCHA: `.g-recaptcha`, `.h-captcha`, `iframe[src*="recaptcha"]`
   - Consent: `[class*="cookie"]`, `[class*="consent"]`

2. **Scoring System** - Elements are scored based on:
   - Matching type attributes
   - Name/ID containing relevant keywords
   - Placeholder text matching field type
   - Element visibility and enabled state
   - Aria labels

3. **Fallback Chain**:
   - Hardcoded presets for known domains
   - Tauri-based headless scraping (if available)
   - Client-side DOM detection (for same-origin pages)
   - Manual configuration fallback

### Supported Domains (Hardcoded Presets)

The following domains have hardcoded selector presets:

- `shopify.com` - E-commerce platform
- `accounts.google.com` - Google Sign-In
- `instagram.com` - Meta's photo platform
- `twitter.com` - X platform
- `amazon.com` - E-commerce
- `linkedin.com` - Professional network

For other domains, the scraper will attempt automatic detection.

## Usage

### In the Automation UI

1. Enter your target URL (e.g., `https://example.com/login`)
2. Click the "Auto-fill" button
3. Wait for scraping to complete
4. The form fields will be automatically populated with detected selectors
5. You can manually adjust any incorrect selectors

### Programmatic Usage

```typescript
import { scrapeFormSelectors, selectorsToFormConfig, FORM_PRESETS } from "$lib/utils/form-scraper";

// Scrape a URL
const result = await scrapeFormSelectors({
  url: "https://example.com/login",
  timeout: 15000, // milliseconds
});

console.log(`Detected with ${result.confidence}% confidence`);
console.log(result.details); // Array of detection details

// Convert to LoginFormConfig
const config = selectorsToFormConfig("https://example.com/login", result);

// config now has:
// - username_selector
// - password_selector
// - submit_selector
// - success_selector
// - failure_selector
// - captcha_selector
// - consent_selector
// - totp_selector
```

## Confidence Scoring

The scraper provides a confidence score (0-100%) indicating how certain it is about the detected selectors:

- **80-100%**: Very confident, likely accurate
- **60-79%**: Moderately confident, should verify
- **40-59%**: Low confidence, recommend manual review
- **0-39%**: Very low confidence, manual configuration recommended

### Factors Affecting Confidence

- **Higher confidence**:
  - Clear type attributes (`type="email"`, `type="password"`)
  - Semantic naming (`name="username"`, `id="submit_btn"`)
  - Standard patterns

- **Lower confidence**:
  - Generic element names (`input`, `button`)
  - Obfuscated classes
  - Non-standard form layouts

## Detection Details

After scraping, the `details` array contains information about what was detected:

```typescript
result.details = [
  'username: "input[type="email"]" (score: 85)',
  'password: "input[type="password"]" (score: 90)',
  'submit: "button[type="submit"]" (score: 78)',
  'captcha: ".g-recaptcha" (score: 95)',
  'consent: "[class*="cookie"]" (score: 65)',
]
```

This helps you understand why certain selectors were chosen.

## Customization

### Adding a New Preset

To add a hardcoded preset for a domain:

1. Open `src/lib/utils/form-scraper.ts`
2. Find the `FORM_PRESETS` object
3. Add an entry:

```typescript
export const FORM_PRESETS: Record<string, Partial<LoginFormConfig>> = {
  "example.com": {
    username_selector: 'input[name="email"]',
    password_selector: 'input[name="password"]',
    submit_selector: 'button[id="login-btn"]',
    success_selector: '[data-testid="dashboard"]',
  },
  // ... other presets
};
```

### Adjusting Selector Patterns

To improve detection for a specific field type:

1. Open `src/lib/utils/form-scraper.ts`
2. Find the `SELECTOR_PATTERNS` object
3. Add patterns to the relevant field type:

```typescript
const SELECTOR_PATTERNS = {
  username: [
    'input[type="email"]',
    'input[name*="user"]',
    // Add new patterns here
    'input[aria-label*="username"]',
  ],
  // ...
};
```

## Error Handling

### Common Error Messages

1. **"Could not auto-detect form selectors"**
   - The scraper couldn't identify form fields
   - Domain might use non-standard HTML structure
   - **Solution**: Manually configure selectors using browser inspector

2. **"Invalid selector"**
   - The CSS selector syntax is invalid
   - Check selector doesn't have typos
   - **Solution**: Use valid CSS selectors

3. **"Timeout while scraping"**
   - Page took too long to load
   - Increase timeout or check URL
   - **Solution**: Check target URL is accessible

### Validation

Before running automation, validate your selectors:

```typescript
import { validateSelectors } from "$lib/utils/form-scraper";

const validation = await validateSelectors(url, {
  username_selector: 'input[name="email"]',
  password_selector: 'input[name="password"]',
  submit_selector: 'button[type="submit"]',
});

if (!validation.valid) {
  console.error("Missing selectors:", validation.missing);
}
```

## Best Practices

1. **Start with Auto-fill**
   - Always try auto-fill first to save time
   - Check the confidence score

2. **Verify Selectors**
   - If confidence is low (<60%), manually verify
   - Use browser developer tools to inspect elements

3. **Test Before Running**
   - Test with a single credential first
   - Verify form detection works as expected

4. **Update Presets**
   - If a preset becomes outdated, update it
   - Sites change their HTML structure frequently

5. **Manual Override**
   - If auto-fill fails, you can always manually enter selectors
   - CSS selectors are the preferred format over XPath

## Advanced: Tauri Integration

The form scraper can use Tauri's headless browser for more reliable detection:

```rust
// In src-tauri/src/commands.rs
#[tauri::command]
async fn scrape_form_selectors(url: String, timeout: u64) -> Result<ScrapedFormSelectors> {
    // Launch headless browser
    // Navigate to URL
    // Analyze DOM
    // Return detected selectors
}
```

If Tauri is available and configured, the scraper will:
1. Launch a headless browser instance
2. Navigate to the target URL
3. Analyze the page DOM
4. Return more accurate selectors

## Troubleshooting

### Auto-fill not working

**Check:**
1. Is the URL valid and accessible?
2. Is the target page a standard login form?
3. Check browser console for errors
4. Try with a different URL to test functionality

**Solution:**
- Enable Tauri support for better detection
- Manually configure selectors
- Check if the domain has a hardcoded preset

### Selectors detecting but not finding elements

**Possible causes:**
1. Page structure changed after scraping
2. Elements loaded dynamically via JavaScript
3. Selectors too specific or too generic

**Solutions:**
1. Re-run auto-fill to get fresh selectors
2. Use more generic selectors (e.g., `input[type="email"]` instead of `#email-field`)
3. Manually inspect page and adjust selectors

### Confidence score very low

**Reasons:**
1. Non-standard form layout
2. Obfuscated or minified HTML
3. Dynamic form generation

**Solutions:**
1. Manually verify selectors using inspector
2. Try simpler selectors
3. Contact support if site uses custom form framework

## Examples

### Example 1: Simple Form Detection

```typescript
// Target: Example.com with standard form
const result = await scrapeFormSelectors({
  url: "https://example.com/login",
});

// Result:
// {
//   username_selector: 'input[type="email"]',
//   password_selector: 'input[type="password"]',
//   submit_selector: 'button[type="submit"]',
//   confidence: 92,
//   details: [...]
// }
```

### Example 2: Preset Domain

```typescript
// Target: Instagram (has hardcoded preset)
const result = await scrapeFormSelectors({
  url: "https://instagram.com/accounts/login/",
});

// Result uses preset:
// {
//   username_selector: 'input[name="username"]',
//   password_selector: 'input[name="password"]',
//   submit_selector: 'button[type="submit"]',
//   confidence: 100,
//   details: ["Loaded preset for instagram.com"]
// }
```

### Example 3: Complex Form with Low Confidence

```typescript
// Target: Complex custom form
const result = await scrapeFormSelectors({
  url: "https://custom-site.com/auth/login",
});

// Result:
// {
//   username_selector: 'div.form__input:nth-child(1) input',
//   password_selector: 'div.form__input:nth-child(2) input',
//   submit_selector: 'button.form__submit',
//   confidence: 45, // Low confidence
//   details: [
//     'username: "div.form__input:nth-child(1) input" (score: 35)',
//     'password: "div.form__input:nth-child(2) input" (score: 42)',
//     'submit: "button.form__submit" (score: 48)',
//   ]
// }

// Recommendation: Manually verify these selectors
```

## API Reference

### `scrapeFormSelectors(options)`

Scrapes form selectors from a URL.

**Parameters:**
- `url` (string, required) - Target URL to scrape
- `timeout` (number, optional, default: 15000) - Timeout in milliseconds
- `headless` (boolean, optional, default: true) - Use headless browser

**Returns:** `Promise<ScrapedFormSelectors>`

**ScrapedFormSelectors:**
```typescript
{
  username_selector?: string;
  password_selector?: string;
  submit_selector?: string;
  success_selector?: string;
  failure_selector?: string;
  captcha_selector?: string;
  consent_selector?: string;
  totp_selector?: string;
  confidence: number; // 0-100
  details: string[]; // Detection details
}
```

### `selectorsToFormConfig(url, selectors)`

Converts scraped selectors to LoginFormConfig.

**Returns:** `Partial<LoginFormConfig>`

### `validateSelectors(url, selectors)`

Validates that selectors exist on the page.

**Returns:** `Promise<{ valid: boolean; missing: string[] }>`

### `FORM_PRESETS`

Object containing hardcoded presets for known domains.

**Type:** `Record<string, Partial<LoginFormConfig>>`

## Performance

- **Scraping time**: 2-10 seconds per URL
- **Confidence calculation**: <100ms
- **Memory usage**: ~5-10MB per scrape
- **Parallel scrapes**: Limited by browser resources

## Security Considerations

1. **No credential collection** - Scraper only analyzes HTML structure
2. **HTTPS required** - Tauri headless browser enforces HTTPS
3. **No data logging** - Results are not sent anywhere
4. **Same-origin policy** - Client-side scraping respects browser security

## Future Improvements

- [ ] Machine learning model for selector detection
- [ ] Screenshot-based visual detection
- [ ] Support for SPA (Single Page Application) forms
- [ ] CAPTCHA-aware detection
- [ ] MFA form detection
- [ ] Internationalization support