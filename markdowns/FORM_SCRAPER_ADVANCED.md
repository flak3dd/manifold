# Advanced Form Scraper Features

## Overview

The Form Scraper now includes three advanced detection capabilities to handle complex modern web applications:

1. **SPA (Single Page Application) Detection** - Identifies React, Vue, Angular, Svelte, etc.
2. **CAPTCHA-Aware Detection** - Detects CAPTCHA providers and provides alternatives
3. **MFA Form Detection** - Identifies multi-factor authentication forms and their types

---

## 1. SPA (Single Page Application) Detection

### What It Does

Automatically detects if a login form is part of a Single Page Application (SPA) and identifies the framework being used.

### Supported Frameworks

- **React** - Facebook's UI library
- **Vue** - Progressive JavaScript framework
- **Angular** - Google's full-featured framework
- **Svelte** - Compiler-focused framework
- **Ember** - Opinionated web framework
- **Next.js** - React meta-framework
- **Nuxt** - Vue meta-framework

### Why This Matters

SPAs handle form submission and navigation differently than traditional server-rendered applications:

- **Dynamic Form Fields** - Fields may appear/disappear during form interaction
- **Client-Side Validation** - Form validation happens before submission
- **AJAX Submissions** - Forms submit without page reload
- **State Management** - Form state managed by framework (Redux, Vuex, etc.)
- **Navigation Changes** - Success/failure indicated by URL or state change

### Detection Results

When SPA is detected, the scraper returns:

```typescript
{
  isSPA: true,
  spaFramework: "react"  // or "vue", "angular", etc.
}
```

### How to Handle SPA Forms

#### Example: React Form

```typescript
const scraped = await scrapeFormSelectors({
  url: "https://app.example.com/login",
  waitForSPA: true  // Wait for React content to load
});

if (scraped.isSPA && scraped.spaFramework === "react") {
  // React often uses event handlers instead of form submission
  // May need to detect success via URL change or loading indicator
  console.log("Detected React SPA - adjusting automation strategy");
  
  config.success_selector = "[data-testid='profile-menu']";  // Or similar
}
```

#### Example: Vue Form

```typescript
if (scraped.isSPA && scraped.spaFramework === "vue") {
  // Vue forms often use v-model for two-way binding
  // Look for v-if or v-show directives that indicate form state
  config.success_selector = "[v-if='isLoggedIn']";
}
```

### SPA Detection Algorithm

The scraper looks for:

1. **Framework Markers** in HTML:
   - React: `data-reactroot`, `__react`, `react-dom`
   - Vue: `data-v-*`, `v-app`, `__vue__`
   - Angular: `ng-app`, `ng-controller`, `ng-version`
   - Svelte: `svelte-*`, `__svelte`
   - Next.js: `__NEXT_DATA__`, `__NEXT_PAGE__`
   - Nuxt: `__NUXT__`, `nuxt-link`

2. **Common SPA Patterns**:
   - App root elements: `id="app"`, `id="root"`, `id="spa"`
   - Large JavaScript bundles
   - Single HTML file with dynamic content

### Best Practices for SPA Forms

1. **Wait for Dynamic Content**
   - Set `waitForSPA: true` when scraping
   - May take longer than traditional forms

2. **Look for State Indicators**
   - Success: User menu, profile button, logout link
   - Failure: Error message, form clearing, validation errors

3. **Use Data Attributes**
   - SPAs often use `data-testid`, `data-qa` attributes
   - More stable than relying on classes
   - Example: `[data-testid="user-profile"]`

4. **Monitor for Client-Side Validation**
   - Errors may appear before submission
   - Look for `aria-invalid` or `aria-errormessage`

---

## 2. CAPTCHA-Aware Detection

### What It Does

Automatically detects CAPTCHA challenges and identifies the provider, allowing you to handle them appropriately.

### Supported CAPTCHA Providers

- **Google reCAPTCHA** (v2, v3)
- **hCaptcha** - Privacy-focused alternative
- **Arkose Labs** (FunCaptcha) - Advanced fraud detection
- **GeeTest** - Chinese provider
- **Cloudflare Turnstile** - Cloudflare's CAPTCHA
- **Friendly Captcha** - Privacy-first alternative

### Detection Results

When CAPTCHA is detected:

```typescript
{
  hasCaptcha: true,
  captchaProviders: ["recaptcha", "hcaptcha"],
  captchaSelectors: [".g-recaptcha", ".h-captcha"]
}
```

### CAPTCHA Provider Characteristics

#### Google reCAPTCHA v2
- **Selector**: `.g-recaptcha`, `[data-sitekey]`
- **Challenge**: "I'm not a robot" checkbox or image puzzle
- **Difficulty**: Medium
- **Automation**: Difficult without CAPTCHA solving service

#### hCaptcha
- **Selector**: `.h-captcha`, `[data-sitekey*="hcaptcha"]`
- **Challenge**: Image selection puzzle
- **Difficulty**: Medium
- **Automation**: Similar to reCAPTCHA

#### Arkose Labs (FunCaptcha)
- **Selector**: `[data-arkose]`, `[data-enforcement-uuid]`
- **Challenge**: Interactive puzzle
- **Difficulty**: Hard
- **Automation**: Requires sophisticated solutions

#### Cloudflare Turnstile
- **Selector**: `.cf-turnstile`, `[data-sitekey*="cloudflare"]`
- **Challenge**: "Verify you are human"
- **Difficulty**: Easy to Medium
- **Automation**: Some automated solutions available

### How to Handle CAPTCHAs

#### Example: Detecting reCAPTCHA

```typescript
const scraped = await scrapeFormSelectors({
  url: "https://example.com/login",
  detectCaptcha: true
});

if (scraped.hasCaptcha) {
  console.log("CAPTCHA detected:", scraped.captchaProviders);
  
  // Store CAPTCHA selector for later handling
  config.captcha_selector = scraped.captcha_selector;
  
  // Set up automation strategy
  if (scraped.captchaProviders.includes("recaptcha")) {
    // Use reCAPTCHA solving service
    console.log("Integrating reCAPTCHA solver");
    config.captcha_selector = ".g-recaptcha";
  } else if (scraped.captchaProviders.includes("hcaptcha")) {
    // Use hCaptcha solving service
    console.log("Integrating hCaptcha solver");
    config.captcha_selector = ".h-captcha";
  }
}
```

#### Example: Handling Multiple CAPTCHAs

```typescript
if (scraped.hasCaptcha && scraped.captchaProviders.length > 1) {
  console.log("Multiple CAPTCHA providers detected");
  console.log("Providers:", scraped.captchaProviders);
  
  // May need to handle multiple challenges
  // Or site uses fallback CAPTCHA options
  const priorities = {
    "turnstile": 1,      // Easiest
    "recaptcha": 2,
    "hcaptcha": 3,
    "arkose": 4,         // Hardest
  };
  
  const easiest = scraped.captchaProviders.sort(
    (a, b) => (priorities[a] || 99) - (priorities[b] || 99)
  )[0];
  
  console.log("Targeting easiest CAPTCHA:", easiest);
}
```

### CAPTCHA Solving Strategies

#### 1. External Service (Recommended)
```typescript
// Use service like 2captcha, AntiCaptcha, etc.
if (config.captcha_selector) {
  // Pause automation when CAPTCHA appears
  // Wait for manual solving or service response
  // Continue after CAPTCHA solved
}
```

#### 2. Browser Extension
```typescript
// Use extension that auto-solves CAPTCHAs
// Requires specific extension configuration
```

#### 3. Manual Intervention
```typescript
// Display CAPTCHA to human operator
// Pause automation until solved
// Resume after CAPTCHA bypass
```

#### 4. Detect Bypass Methods
```typescript
// Some sites have accessibility features
// CAPTCHA may be skipped under certain conditions
// Example: Device fingerprint recognition
```

### Best Practices

1. **Always Monitor for CAPTCHA**
   - Set `detectCaptcha: true` during form scraping
   - Plan your CAPTCHA handling strategy

2. **Rate Your CAPTCHA Risk**
   ```
   Low Risk:     No CAPTCHA detected
   Medium Risk:  Single CAPTCHA (reCAPTCHA, hCaptcha)
   High Risk:    Multiple CAPTCHAS or advanced (Arkose)
   ```

3. **Implement Fallback Strategy**
   - If CAPTCHA appears, pause and alert user
   - Or integrate CAPTCHA solving service
   - Or rotate to different automation session

4. **Monitor CAPTCHA Changes**
   - Sites update CAPTCHA providers
   - Re-run scraper periodically to detect changes

---

## 3. MFA Form Detection

### What It Does

Automatically detects multi-factor authentication (MFA/2FA) forms and identifies the authentication method required.

### Supported MFA Types

- **TOTP** (Time-based One-Time Password) - Authenticator apps
- **SMS** - Text message codes
- **Email** - Email verification codes
- **Push Notification** - Mobile app approval
- **Security Key** - Hardware security keys (U2F/FIDO2/WebAuthn)

### Detection Results

When MFA is detected:

```typescript
{
  hasMFA: true,
  mfaType: "totp",           // or "sms", "email", "push", "security_key"
  mfa_selector: "input[name='mfa_code']",
  totp_selector: "input[placeholder='code']"  // If applicable
}
```

### MFA Type Characteristics

#### TOTP (Authenticator Apps)
- **Apps**: Google Authenticator, Authy, Microsoft Authenticator
- **Challenge**: 6-digit code that changes every 30 seconds
- **Selector**: `input[placeholder*="code"]`, `input[id*="totp"]`
- **Difficulty**: Medium (requires TOTP seed)
- **Automation**: Possible with TOTP seed

#### SMS
- **Challenge**: 6-digit code sent via text
- **Selector**: `input[placeholder*="SMS"]`, `button:contains("Send SMS")`
- **Difficulty**: Hard (requires phone access)
- **Automation**: Difficult without SMS interception

#### Email
- **Challenge**: Code sent via email
- **Selector**: `input[placeholder*="email code"]`, `button:contains("Send email")`
- **Difficulty**: Hard (requires email access)
- **Automation**: Can check email, slower

#### Push Notification
- **Challenge**: User approves on mobile device
- **Selector**: `button:contains("approve")`, `.push-notification`
- **Difficulty**: Very Hard (requires device interaction)
- **Automation**: Not practical without device access

#### Security Key (WebAuthn/FIDO2)
- **Challenge**: Physical hardware key
- **Selector**: `button:contains("security key")`, `[class*="webauthn"]`
- **Difficulty**: Very Hard (requires hardware)
- **Automation**: Not practical without physical key

### How to Handle MFA

#### Example: TOTP Detection and Handling

```typescript
const scraped = await scrapeFormSelectors({
  url: "https://example.com/login",
  detectMFA: true
});

if (scraped.hasMFA) {
  console.log("MFA required:", scraped.mfaType);
  
  if (scraped.mfaType === "totp") {
    // We can automate TOTP if we have the seed
    console.log("TOTP detected - can automate with seed");
    
    // Store TOTP selector for later
    config.totp_selector = scraped.totp_selector;
    
    // In automation, you'll need:
    // 1. TOTP seed from account setup
    // 2. TOTP library to generate codes
    const totpLib = require('speakeasy');
    const code = totpLib.totp({
      secret: credential.totp_seed,
      encoding: 'base32',
    });
  } else if (scraped.mfaType === "sms") {
    console.log("SMS MFA detected - requires manual/service handling");
    // Need to intercept SMS or use SMS service
  } else if (scraped.mfaType === "push") {
    console.log("Push notification MFA - not automatable");
    // User must approve on phone
  }
}
```

#### Example: MFA Field Injection

```typescript
// After credential login, wait for MFA form
const mfaInput = document.querySelector(config.totp_selector);

if (mfaInput) {
  // Generate TOTP code
  const totp = generateTOTPCode(credential.totp_seed);
  
  // Fill in MFA code
  mfaInput.value = totp;
  mfaInput.dispatchEvent(new Event('input', { bubbles: true }));
  
  // Submit MFA form
  const submitBtn = document.querySelector(config.submit_selector);
  submitBtn.click();
}
```

### MFA Detection Algorithm

The scraper looks for:

1. **MFA Keywords** in page text:
   - "two-factor", "2fa", "mfa"
   - "authenticator", "verification code"
   - "security code", "security key"

2. **Field Patterns**:
   - TOTP: `input[placeholder*="code"]`, `input[id*="totp"]`
   - SMS: `button:contains("Send SMS")`, `input[placeholder*="SMS"]`
   - Email: `button:contains("Send email")`, `input[placeholder*="email code"]`
   - Push: `button:contains("approve")`, `[class*="push"]`
   - Security Key: `button:contains("security key")`, `[class*="webauthn"]`

3. **Element Attributes**:
   - Data attributes: `[data-mfa]`, `[data-auth]`
   - Classes: `class*="mfa"`, `class*="verification"`
   - IDs: `id*="mfa-code"`, `id*="2fa"`

### Best Practices for MFA

1. **Store TOTP Seeds Securely**
   ```typescript
   // During account setup, save TOTP seed
   credential.totp_seed = "JBSWY3DPEBLW64TMMQ====";  // Base32 encoded
   // Never log or transmit in plaintext
   ```

2. **Detect MFA Type Early**
   ```typescript
   // Scrape form before first login attempt
   const scraped = await scrapeFormSelectors({ 
     url: loginUrl,
     detectMFA: true 
   });
   // Plan automation strategy based on MFA type
   ```

3. **Handle MFA in Automation**
   ```typescript
   // After username/password submission:
   if (scraped.hasMFA) {
     if (scraped.mfaType === "totp") {
       // Inject TOTP code automatically
       injectTOTPCode(credential.totp_seed);
     } else {
       // Pause for manual handling
       console.log("Waiting for user to complete MFA...");
       await waitForMFACompletion();
     }
   }
   ```

4. **Account Setup Detection**
   ```typescript
   // If MFA not yet enabled on account:
   // Can skip MFA during initial setup
   if (!scraped.hasMFA) {
     console.log("MFA not required on this account");
   }
   ```

---

## Integration Example: Complete Flow

```typescript
import { scrapeFormSelectors, selectorsToFormConfig } from "$lib/utils/form-scraper";

async function setupAutomationForTarget(url: string, credential: any) {
  // 1. Scrape with all advanced options enabled
  const scraped = await scrapeFormSelectors({
    url,
    timeout: 15000,
    waitForSPA: true,        // Handle SPAs
    detectCaptcha: true,     // Detect CAPTCHA
    detectMFA: true,         // Detect MFA
  });

  // 2. Analyze SPA
  if (scraped.isSPA) {
    console.log(`SPA Framework: ${scraped.spaFramework}`);
    console.log("Adjusting selectors for client-side form handling");
  }

  // 3. Analyze CAPTCHA
  if (scraped.hasCaptcha) {
    console.log(`CAPTCHA Providers: ${scraped.captchaProviders}`);
    console.warn("⚠️ CAPTCHA detected - will require solving service");
    // Set up CAPTCHA solving
    setupCAPTCHASolver(scraped.captchaProviders[0]);
  }

  // 4. Analyze MFA
  if (scraped.hasMFA) {
    console.log(`MFA Type: ${scraped.mfaType}`);
    if (scraped.mfaType === "totp") {
      console.log("✓ TOTP automatable with seed");
      // Store TOTP seed securely
    } else {
      console.warn(`⚠️ ${scraped.mfaType} requires manual/service handling`);
    }
  }

  // 5. Convert to config
  const config = selectorsToFormConfig(url, scraped);

  // 6. Customize based on detections
  config.username_selector = config.username_selector;
  config.password_selector = config.password_selector;
  config.submit_selector = config.submit_selector;
  
  if (scraped.hasCaptcha) {
    config.captcha_selector = scraped.captcha_selector;
  }
  
  if (scraped.hasMFA && scraped.mfaType === "totp") {
    config.totp_selector = scraped.totp_selector;
  }

  return config;
}
```

---

## API Reference

### `scrapeFormSelectors(options)`

**Parameters:**
```typescript
{
  url: string;           // Target URL
  timeout?: number;      // Timeout in ms (default: 15000)
  headless?: boolean;    // Use headless browser (default: true)
  waitForSPA?: boolean;  // Wait for SPA content (default: false)
  detectCaptcha?: boolean; // Detect CAPTCHA (default: false)
  detectMFA?: boolean;   // Detect MFA (default: false)
}
```

**Returns:**
```typescript
{
  // Form fields
  username_selector?: string;
  password_selector?: string;
  submit_selector?: string;
  success_selector?: string;
  failure_selector?: string;
  captcha_selector?: string;
  consent_selector?: string;
  totp_selector?: string;
  mfa_selector?: string;

  // Confidence and details
  confidence: number;       // 0-100%
  details: string[];

  // SPA Detection
  isSPA?: boolean;
  spaFramework?: string;    // "react", "vue", "angular", etc.

  // CAPTCHA Detection
  hasCaptcha?: boolean;
  captchaProviders?: string[]; // ["recaptcha", "hcaptcha"]
  captchaSelectors?: string[];

  // MFA Detection
  hasMFA?: boolean;
  mfaType?: string;         // "totp", "sms", "email", "push", "security_key"
}
```

---

## Troubleshooting

### SPA Not Detected
- Verify framework is in the supported list
- Check if framework is loaded after JavaScript execution
- Manually specify `waitForSPA: true`

### CAPTCHA Not Detected
- Some CAPTCHAs load dynamically after interaction
- Try manual selector entry if auto-detect fails
- Check if site uses custom CAPTCHA implementation

### MFA Not Detected
- MFA might appear after first login (chicken-and-egg problem)
- Pre-configure MFA settings if known
- Monitor for MFA during first login attempt

### False Positives
- Page might have MFA keywords in FAQ or help text
- Increase confidence threshold
- Manually review detected fields

---

## Performance Impact

- **SPA Detection**: <100ms
- **CAPTCHA Detection**: <200ms
- **MFA Detection**: <100ms
- **Total Added Overhead**: ~500ms

---

## Future Enhancements

- [ ] Visual selector picker UI
- [ ] Browser extension for real-time detection
- [ ] ML-based field classification
- [ ] Support for custom CAPTCHA implementations
- [ ] MFA flow simulation
- [ ] Interactive form testing UI