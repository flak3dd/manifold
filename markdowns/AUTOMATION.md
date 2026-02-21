# Browser Automation Guide

## Overview

Manifold's browser automation engine enables large-scale, fingerprint-aware login testing with real-time result tracking, profile rotation, and session capture. It uses Playwright with integrated anti-detection evasions to attempt logins across diverse target websites.

## Quick Start

### 1. Define Target & Credentials

1. Navigate to **Automation** tab
2. Enter target login URL (e.g., `https://accounts.google.com/ServiceLogin`)
3. Import credentials as:
   - **Colon-separated**: `user@example.com:password123`
   - **CSV**: `username,password` (auto-detected)
   - **JSON**: `[{"username":"user","password":"pass"}]`
   - **Drag & drop**: Files are auto-parsed

### 2. Configure Login Form

The UI auto-detects selectors for common platforms (Google, Instagram, LinkedIn, Twitter, Amazon, Shopify). For custom sites:

- **Username selector**: CSS selector for email/username input
- **Password selector**: CSS selector for password input
- **Submit selector**: CSS selector for login button
- **Success selector** (optional): Element that appears on successful login (dashboard, profile, etc.)
- **Failure selector** (optional): Error message that appears on failed login

Example for a custom site:
```
Username: input[name="email"]
Password: input[name="password"]
Submit: button.login-btn
Success: .dashboard-header
Failure: .error-message
```

### 3. Select Profiles

Choose which fingerprint profiles to use for the run:
- Profiles are rotated across credentials
- Soft signals (CAPTCHA, rate-limit) trigger rotation
- Hard signals (account locked, IP banned) skip the credential

### 4. Launch Run

Click **Launch** to start the automation run. The system will:
1. Iterate through all credentials
2. Use selected profiles sequentially or in parallel
3. Capture results in real-time
4. Rotate on soft signals (CAPTCHA, rate limits)
5. Export session state on success (cookies, localStorage, IndexedDB)

## Features

### Real-Time Monitoring

The **Run** tab displays:
- **Overall stats**: Total attempts, successes, failures, blocks, errors
- **Live results table**: Username, status, outcome, profile used, duration
- **Signals detected**: CAPTCHA, rate limits, IP blocks, account locks
- **Rotation events**: When and why profiles/proxies rotated

### Advanced Filtering & Search

Results can be filtered by:
- **Search**: Find credentials by username or final URL
- **Status**: All, Success, Failed, Blocked, Error
- **Outcome**: Specific failure reason (wrong credentials, CAPTCHA, rate limit, etc.)
- **Sort by**: Index, username, status, or duration (ascending/descending)

### Result Actions

For each attempt result:
- **View screenshot**: See the final page state at login attempt
- **Download session**: Export cookies + localStorage + IndexedDB state
- **View details**: Expand row to see final URL, timestamps, rotation events

### Session Capture

On successful login, Manifold captures:
- **Cookies**: All HTTP cookies with domain, path, expiry, flags
- **LocalStorage**: Key-value pairs from page storage
- **IndexedDB**: Database snapshots with all records
- **Screenshots**: Final page state PNG

Sessions are downloadable as JSON for use in other tools:
```json
{
  "credential_id": "uuid",
  "captured_at": "2024-01-15T10:30:00Z",
  "cookies": [
    {
      "name": "session_id",
      "value": "abc123xyz",
      "domain": ".example.com",
      "secure": true,
      "httpOnly": true
    }
  ],
  "local_storage": { "theme": "dark" },
  "indexed_db": [
    {
      "db_name": "app_cache",
      "version": 1,
      "stores": [
        {
          "name": "pages",
          "records": [ ... ]
        }
      ]
    }
  ]
}
```

## Configuration

### Form Selectors

Use CSS selectors or XPath. Common patterns:

```javascript
// Gmail
username_selector: 'input[type="email"]'
password_selector: 'input[type="password"]'
submit_selector: '#identifierNext button'
success_selector: '[data-ogsr-up]'

// LinkedIn
username_selector: '#username'
password_selector: '#password'
submit_selector: '.sign-in-form__submit-button'
success_selector: '.global-nav'

// Generic
username_selector: 'input[name="email"], input[name="username"]'
password_selector: 'input[type="password"]'
submit_selector: 'button[type="submit"]'
success_selector: '.dashboard, .profile, [data-user-logged-in]'
failure_selector: '.error, .alert-danger, [role="alert"]'
```

### Timeouts

- **Page load timeout** (default 15s): Max wait for page to load after navigation
- **Post-submit timeout** (default 8s): Max wait for success/failure indicators after form submit

Increase for slow sites or high-traffic periods.

### Run Modes

**Sequential**: One credential at a time (slower, more stealth)
```
Profile A → Cred 1 → Cred 2 → Profile B → Cred 3
```

**Parallel**: Multiple credentials in parallel (faster, needs more profiles)
```
Profile A → Cred 1
Profile B → Cred 2
Profile C → Cred 3
```

### Rotation Policies

- **Rotate every N attempts**: Change profile after N credentials
- **Soft threshold**: Number of soft signals before rotation (default 1)
- **Max retries**: How many times to retry a soft-blocked credential

### Evasion Options

- **Domain-aware noise**: Vary fingerprint details per domain (recommended)
- **Patch TLS**: Use CLIENTHELLO spoofing for advanced bot detection
- **Anti-CAPTCHA**: (Future) Auto-solve CAPTCHA with external service

## Results

### Status vs Outcome

**Status** (credential state):
- `pending`: Not yet attempted
- `running`: Currently in flight
- `success`: Login confirmed
- `failed`: Wrong credentials (hard fail)
- `soft_blocked`: CAPTCHA/rate-limit (can retry)
- `hard_blocked`: Account locked/banned (skip)
- `error`: Unexpected error
- `skipped`: Manually skipped

**Outcome** (what actually happened):
- `success`: Login succeeded
- `wrong_credentials`: Password incorrect
- `captcha_block`: CAPTCHA challenge
- `rate_limited`: HTTP 429 or rate-limit indicator
- `ip_blocked`: IP/geo-restricted
- `account_locked`: Account locked/2FA required
- `timeout`: Didn't complete in time
- `error`: Unexpected error

### Downloads

**Report** (JSON):
```json
{
  "run_id": "uuid",
  "target_url": "https://example.com/login",
  "started_at": "2024-01-15T10:00:00Z",
  "ended_at": "2024-01-15T10:45:00Z",
  "stats": {
    "total": 100,
    "success": 45,
    "failed": 30,
    "soft_blocked": 15,
    "hard_blocked": 5,
    "error": 5,
    "rotations": 12
  },
  "results": [ ... ]
}
```

**Hits** (CSV):
```csv
username,password,profile_id,duration_ms,final_url
user1@example.com,pass123,profile-abc,2500,https://example.com/dashboard
user2@example.com,pass456,profile-def,2200,https://example.com/account
```

**Sessions** (ZIP of JSON files):
```
sessions.zip
├── cred-uuid-1.json (cookies, localStorage, IndexedDB)
├── cred-uuid-2.json
└── ...
```

## Advanced Features

### Credential Extras

For 2FA/TOTP logins, add extras when importing:

**CSV with TOTP**:
```
username,password,totp_seed
user@example.com,pass123,JBSWY3DPEBLW64TMMQQ====
```

**JSON with extras**:
```json
[
  {
    "username": "user@example.com",
    "password": "pass123",
    "extras": {
      "totp_seed": "JBSWY3DPEBLW64TMMQQ====",
      "security_question": "What is your pet's name?",
      "recovery_code": "12345-67890"
    }
  }
]
```

Configure the `totp_selector` to auto-fill TOTP codes.

### Soft Signal Detection

Automatically detects:
- **CAPTCHA challenges**: reCAPTCHA, hCaptcha, native CAPTCHAs
- **Rate limiting**: HTTP 429, generic "too many attempts" messages
- **IP blocks**: Geographic restrictions, proxy detection
- **Account locked**: 2FA required, account suspended, temporary lock
- **Consent banners**: Cookie/GDPR banners (auto-dismissed)

### Profile Rotation Triggers

On soft signals, the system:
1. Rotates to next profile in pool
2. Records rotation event (which trigger, old→new profile)
3. Retries the credential (if retries remain)
4. Can also rotate proxy if configured

### History & Comparison

The **History** tab shows all past runs:
- Click a run to view its results
- Compare outcomes across different target URLs
- Download past run reports

## Troubleshooting

### "Selectors not found"

1. Open the target URL manually in a browser
2. Inspect the HTML to find exact selectors
3. Test selectors in browser console: `document.querySelector('...')`
4. Update selectors and re-run

### "All credentials blocked"

- Site may have advanced bot detection
- Try different profiles or proxies
- Increase post-submit timeout
- Enable TLS patching
- Space out attempts with longer delays

### "Success indicator never found"

- Site may load success page dynamically
- Use network tab to find success URL pattern
- Check for redirect chains
- Increase post-submit timeout

### "CAPTCHA not auto-dismissed"

- Manifold doesn't auto-solve CAPTCHAs (requires external service)
- Can pause run and manually solve
- Future versions may integrate Anti-CAPTCHA/2Captcha APIs

## API Integration

Bridge commands used:
- `launch_profile(id, url)`: Start browser session
- `stop_bridge()`: Stop current session
- `get_bridge_url()`: WebSocket connection point

WebSocket messages:
```typescript
// Client → Bridge
{ type: "navigate", sessionId, url }
{ type: "click", sessionId, selector }
{ type: "type", sessionId, selector, text }
{ type: "execute", sessionId, script }

// Bridge → Client
{ type: "navigate_done", sessionId, url, status }
{ type: "execute_result", sessionId, value }
{ type: "entropy", sessionId, log }
{ type: "error", sessionId, error }
```

## Performance Tips

1. **Parallel mode**: Use 4-8 profiles for parallel runs (requires more memory)
2. **Batch size**: Test 10-50 credentials initially, scale up
3. **Delays**: Increase inter-attempt gaps to avoid rate limits
4. **Timeouts**: Reduce if targeting fast sites, increase for slow ones
5. **Proxies**: Rotate proxies on soft blocks for better success rates
6. **Domain presets**: Use known presets for major sites (faster, more reliable)

## Security Notes

- Credentials are stored in-memory during runs (not persisted by default)
- Session exports contain auth tokens (handle with care)
- Run reports are retained in history (delete when no longer needed)
- All logins happen in sandboxed browser contexts

## Known Limitations

- No multi-step login flows (can extend with custom scripts)
- No API-based authentication (Playwright web-only)
- No automatic CAPTCHA solving (manual or external service)
- No automatic account creation (cred generation only)

## Examples

### Test a service's account security

```
Target: https://myservice.com/login
Credentials: 1000 common password combos
Profiles: 5 diverse fingerprints
Mode: Parallel (5 concurrent)
Result: Identifies weak credentials
```

### Monitor auth status across regions

```
Target: https://api.example.com/auth/login
Credentials: 100 test accounts
Profiles: 1 per region (US, EU, APAC, etc.)
Mode: Sequential (3s delays)
Result: Region-specific blocking patterns
```

### Validate login flows before prod deployment

```
Target: https://staging.example.com/login
Credentials: QA test accounts
Profiles: 1 (staging doesn't need evasion)
Mode: Sequential
Result: Confidence that login works end-to-end
```
