# Manifold Quick Start Guide

## Finding the Automation Tab

The **Automation** tab is located in the top navigation bar, between **Fingerprint** and **Trace**.

```
Dashboard | Profiles | Proxies | Fingerprint | **Automation** | Trace
```

When a login automation run is active, a live indicator (●) will appear next to "Automation".

## 3-Minute Setup

### Step 1: Prepare Credentials (30 seconds)

1. Click **Automation** tab
2. Enter target login URL: `https://example.com/login`
3. Import credentials:
   - **Easiest**: Paste plain text → `user1:pass1` (one per line)
   - **CSV**: Copy from Excel → `username,password` format
   - **Drag & drop**: Drop a `.csv` or `.json` file
4. Click **Import**

### Step 2: Configure Form (1 minute)

The form selectors might auto-detect for popular sites (Google, LinkedIn, Instagram, etc.).

For custom sites, you need 3 required selectors:

| Field | Example |
|-------|---------|
| **Username** | `input[name="email"]` or `#username` |
| **Password** | `input[name="password"]` or `#pass` |
| **Submit** | `button[type="submit"]` or `.login-btn` |

**How to find selectors:**
1. Open the target URL in your browser
2. Right-click on the username input → **Inspect**
3. Copy the selector from the HTML (e.g., `input[name="email"]`)
4. Paste into the form config
5. Repeat for password and submit button

**Optional advanced selectors:**
- Success indicator (shows on successful login): `.dashboard`, `.account`, `[data-user-logged-in]`
- Failure indicator (shows on failed login): `.error-message`, `[role="alert"]`
- CAPTCHA (auto-detected): `.g-recaptcha`, `.h-captcha`

### Step 3: Select Profiles & Launch (30 seconds)

1. Under **Profiles**, select at least 1 fingerprint profile (these spoof browser details)
2. Click **Launch**
3. Results appear in real-time in the **Run** tab

## The Run Tab

Once launched, you'll see:

### Live Stats Bar
```
Total | Hits | Failures | Blocked | Errors | Rotations
```

### Results Table

| Column | What It Shows |
|--------|---------------|
| **#** | Row number |
| **Username** | Credential username |
| **Status** | pending, running, success, failed, soft_blocked, hard_blocked, error |
| **Outcome** | What happened: success, wrong_credentials, captcha_block, rate_limited, ip_blocked, timeout, error |
| **Profile** | Which fingerprint was used |
| **Duration** | How long the attempt took (ms) |
| **Signals** | CAPTCHA, rate limit, IP block detected |
| **Rotations** | How many times profile rotated |
| **Actions** | Screenshot, session download, details |

### Filtering Results

**Search**: Find by username or final URL
**Status**: Show only success, failed, blocked, or error
**Outcome**: Show only specific failure reasons
**Sort**: By index, username, status, or duration
**Count**: Shows filtered / total results

### Viewing Details

Click the **+** icon in the Actions column to expand and see:
- Final URL after login
- Start/end time
- Session exported status
- Full rotation event history
- All detected signals

## Important Buttons

| Button | Does |
|--------|------|
| **Pause** | Pause current run (resume later) |
| **Resume** | Continue a paused run |
| **Abort** | Stop immediately |
| **Report** (on completion) | Download JSON with all results |
| **Hits** (on completion) | Download CSV of successful logins |
| **Sessions** (on completion) | Download ZIP of session captures |

## Key Concepts

### Statuses
- **success**: Login confirmed
- **failed**: Wrong credentials (won't retry)
- **soft_blocked**: CAPTCHA or rate-limit (will rotate & retry)
- **hard_blocked**: Account locked/banned (skip)
- **error**: Unexpected error

### What Gets Captured on Success
- Cookies (with domain, expiry, flags)
- LocalStorage key-value pairs
- IndexedDB database snapshots
- Final page screenshot
- All of the above in a JSON file for download

### Profile Rotation
When a "soft signal" (CAPTCHA, rate-limit) is detected:
1. Run pauses on that credential
2. Switches to the next profile in your selected pool
3. Retries the same credential
4. Records which profile rotated and why in the Rotation Log

### Soft Signal Detection
Automatically detects:
- reCAPTCHA, hCaptcha challenges
- HTTP 429 rate limits
- "Too many attempts" messages
- Geographic/IP blocking
- Account locked messages
- Consent banners (auto-dismissed)

## Troubleshooting

### "Selectors not found"
- Open target URL in browser
- Inspect the form elements
- Verify selectors match exactly
- Test in browser console: `document.querySelector('your-selector')`

### "All credentials blocked"
- Site may have strong bot detection
- Try with different profiles
- Add longer delays between attempts
- Enable "Patch TLS" in advanced settings

### "Success selector never appears"
- Page might load dynamically
- Try increasing post-submit timeout (default 8s)
- Check if success is a URL change instead
- Look at the screenshot to verify actual result

### "CAPTCHA blocks everything"
- Manifold doesn't auto-solve CAPTCHAs (by design)
- Can manually solve when run pauses
- Future version may add Anti-CAPTCHA API integration

## Next Steps

- **Advanced**: See [AUTOMATION.md](AUTOMATION.md) for full guide
- **Features**: See [FEATURES.md](FEATURES.md) for detailed docs
- **Profiles**: Create custom fingerprint profiles in **Fingerprint** tab
- **Proxies**: Add proxies in **Proxies** tab for rotation
- **History**: View past runs in **History** tab

## Common Mistakes to Avoid

❌ **Using selectors that are too generic** → `button` (too many buttons!)
✅ **Use specific selectors** → `button[type="submit"].login-btn`

❌ **Forgetting success indicator** → Run can't tell if login worked
✅ **Always set success selector** → `.dashboard`, `.account`, or page URL

❌ **Using browser inspect classes** → They may not exist in headless mode
✅ **Use form element names** → `input[name="email"]`, `input[id="password"]`

❌ **Importing same credentials twice** → Gets confusing
✅ **Clean import → deduplicate**

❌ **Launching without selecting profiles** → Can't start
✅ **Always select ≥1 profile**

## Getting Help

1. Check **AUTOMATION.md** for detailed walkthroughs
2. Check **FEATURES.md** for complete feature list
3. Look at **History** tab to review past runs
4. Check the **Trace** tab to see what the browser is doing in real-time
5. Enable **Advanced** settings to tune timeouts and retry limits

---

**You're ready to start!** Go to **Automation** tab and launch your first run! 🚀