/**
 * Test Login Credentials - Multi-Attempt Error Recording with Humanization
 *
 * This script tests login credentials against the target site,
 * clicking the login button 4 times for each credential pair
 * and recording the error message each time.
 *
 * Uses HumanBehaviorMiddleware for human-like mouse movements and typing
 * to avoid bot detection.
 *
 * IP rotation options:
 *   - --nord: use NordVPN CLI (nordvpn disconnect/connect) for new IP per credential
 *   - NORD_ROTATION=1 (env): same as --nord (works on bash; use --nord on PowerShell)
 *   - PROXY_* env vars: use HTTP proxy with session-based rotation
 *
 * Options:
 *   --nord              NordVPN rotation
 *   --nord-country X    Nord country (default Australia)
 *   --clicks N          Login button clicks per credential (default 4, use 1 for fast)
 *   --delay N           Delay between clicks in ms (default 2000)
 *
 * Usage:
 *   npx tsx scripts/test-login-credentials.ts
 *   npm run automation:test -- --nord --clicks 1
 *   npx tsx scripts/test-login-credentials.ts --clicks 1 --delay 500 "email@test.com" "password123"
 */

import { execSync } from "node:child_process";

// Parse CLI args early
const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--nord")) {
  process.env.NORD_ROTATION = "1";
}
const nordIdx = rawArgs.indexOf("--nord-country");
if (nordIdx >= 0 && rawArgs[nordIdx + 1]) {
  process.env.NORD_COUNTRY = rawArgs[nordIdx + 1];
}
const clicksIdx = rawArgs.indexOf("--clicks");
const CLICKS_ARG = clicksIdx >= 0 && rawArgs[clicksIdx + 1] ? Number(rawArgs[clicksIdx + 1]) : null;
const delayIdx = rawArgs.indexOf("--delay");
const DELAY_ARG = delayIdx >= 0 && rawArgs[delayIdx + 1] ? Number(rawArgs[delayIdx + 1]) : null;
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { HumanBehaviorMiddleware } from "../human/index.js";
import type { HumanBehavior } from "../playwright-bridge/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const TARGET_URL = "https://joefortunepokies.win";
const LOGIN_URL = "https://www.joefortunepokies.win/login";

// Nord CLI rotation (nordvpn disconnect → connect for new IP per credential)
const USE_NORD_ROTATION =
  process.env.NORD_ROTATION === "1" || process.env.NORD_ROTATION === "true";
const NORD_COUNTRY = (process.env.NORD_COUNTRY ?? "Australia").trim();

// Proxy configuration (used only when USE_NORD_ROTATION is false)
type ProxyEnvConfig = {
  server: string;
  username: string;
  password: string;
  host: string;
  port: number;
};

function readProxyFromEnv(): ProxyEnvConfig | null {
  const host = (process.env.PROXY_HOST ?? "").trim();
  const port = Number.parseInt(process.env.PROXY_PORT ?? "", 10);
  const username = (process.env.PROXY_USERNAME ?? "").trim();
  const password = (process.env.PROXY_PASSWORD ?? "").trim();
  const scheme = (process.env.PROXY_SCHEME ?? "http").trim();

  if (!host && !process.env.PROXY_PORT && !username && !password) return null;

  if (!host || !Number.isFinite(port) || port < 1 || port > 65535 || !username || !password) {
    throw new Error(
      "Invalid proxy env vars. Set: PROXY_HOST, PROXY_PORT, PROXY_USERNAME, PROXY_PASSWORD (optional PROXY_SCHEME=http|https|socks5).",
    );
  }

  return {
    server: `${scheme}://${host}:${port}`,
    username,
    password,
    host,
    port,
  };
}

const PROXY_CONFIG = readProxyFromEnv();
const USE_PROXY = !USE_NORD_ROTATION && PROXY_CONFIG !== null;

// Generate a unique session ID for proxy rotation
function generateProxySession(): string {
  return Math.random().toString(36).substring(2, 10);
}

// Get proxy config with rotated session
function getRotatedProxyConfig(sessionId: string) {
  if (!PROXY_CONFIG) {
    throw new Error("getRotatedProxyConfig called without PROXY_CONFIG");
  }
  return {
    server: PROXY_CONFIG.server,
    username: `${PROXY_CONFIG.username},session_${sessionId}`,
    password: PROXY_CONFIG.password,
  };
}

// ── Nord CLI rotation ────────────────────────────────────────────────────────

async function nordRotate(): Promise<string | null> {
  if (!USE_NORD_ROTATION) return null;

  const t0 = Date.now();
  let nordCli = "nordvpn";

  try {
    // Try to find nordvpn in PATH or common Windows paths
    try {
      execSync("nordvpn --version", { stdio: "pipe" });
    } catch {
      const winPaths = [
        process.env["ProgramFiles"] + "\\NordVPN\\NordVPN.exe",
        process.env["ProgramFiles(x86)"] + "\\NordVPN\\NordVPN.exe",
      ].filter(Boolean);
      for (const p of winPaths) {
        try {
          execSync(`"${p}" --version`, { stdio: "pipe" });
          nordCli = `"${p}"`;
          break;
        } catch {
          /* try next */
        }
      }
    }

    const isWin = process.platform === "win32";
    if (isWin) {
      execSync(`${nordCli} -d`, { stdio: "pipe", timeout: 15_000 });
    } else {
      execSync(`${nordCli} disconnect`, { stdio: "pipe", timeout: 15_000 });
    }
    await new Promise((r) => setTimeout(r, 2500));

    const countryArg = NORD_COUNTRY ? (isWin ? `-g "${NORD_COUNTRY}"` : `--group "${NORD_COUNTRY}"`) : "";
    if (isWin) {
      execSync(`${nordCli} -c ${countryArg}`.trim(), { stdio: "pipe", timeout: 30_000 });
    } else {
      execSync(`${nordCli} connect ${countryArg}`.trim(), { stdio: "pipe", timeout: 30_000 });
    }
    await new Promise((r) => setTimeout(r, 1500));

    return `${NORD_COUNTRY} @ ${Date.now() - t0}ms`;
  } catch (e) {
    console.warn("[nord] Rotation failed:", e);
    return null;
  }
}

// Number of login button clicks per credential pair (--clicks N, default 4)
const CLICKS_PER_CREDENTIAL = CLICKS_ARG != null && CLICKS_ARG >= 1 ? CLICKS_ARG : 4;

// Delay between clicks (ms) (--delay N, default 2000)
const CLICK_DELAY_MS = DELAY_ARG != null && DELAY_ARG >= 0 ? DELAY_ARG : 2000;

// Test credentials - add your credential pairs here
const TEST_CREDENTIALS: Array<{
  email: string;
  password: string;
  label?: string;
}> = [
  {
    email: "test@example.com",
    password: "TestPassword123",
    label: "Test Account 1",
  },
  { email: "user@test.com", password: "Password456", label: "Test Account 2" },
  {
    email: "invalid@email.com",
    password: "wrongpass",
    label: "Invalid Credentials",
  },
];

// Form selectors (detected from previous scrape)
const SELECTORS = {
  emailInput: 'input[type="email"]',
  passwordInput: 'input[type="password"]',
  submitButton: "#loginSubmit",
  errorMessage: [
    ".ol-alert__description", // Primary error selector for this site
    ".ol-alert__title",
    ".ol-alert",
    '[class*="alert__description"]',
    '[class*="error"]',
    '[class*="Error"]',
    '[data-testid*="error"]',
    ".error-message",
    ".login-error",
    '[role="alert"]',
    ".alert-danger",
    ".alert-error",
    ".form-error",
    ".validation-error",
    'div[class*="invalid"]',
    'span[class*="error"]',
    'p[class*="error"]',
  ],
  consentBanner:
    '[id*="cookie"] button, [class*="cookie"] button, [class*="consent"] button',
};

// ─────────────────────────────────────────────────────────────────────────────
// Human Behavior Configuration - "normal" profile for realistic behavior
// ─────────────────────────────────────────────────────────────────────────────

const HUMAN_CONFIG: HumanBehavior = {
  profile: "normal",
  mouse: {
    base_speed_px_per_sec: 450,
    speed_jitter: 0.25,
    curve_scatter: 0.15,
    overshoot_prob: 0.12,
    overshoot_max_px: 8,
    pre_click_pause_max_ms: 120,
    micro_jitter_prob: 0.3,
  },
  typing: {
    base_wpm: 55,
    wpm_jitter: 0.2,
    burst_min_chars: 3,
    burst_max_chars: 8,
    pause_min_ms: 80,
    pause_max_ms: 250,
    typo_rate: 0.02,
    typo_correct_min_ms: 100,
    typo_correct_max_ms: 300,
    double_tap_rate: 0.01,
    think_before_long_fields: true,
    think_pause_min_ms: 200,
    think_pause_max_ms: 600,
  },
  scroll: {
    initial_velocity_px: 400,
    momentum_decay: 0.92,
    min_velocity_px: 20,
    tick_min_ms: 12,
    tick_max_ms: 24,
    overshoot_prob: 0.08,
    overshoot_max_px: 30,
  },
  macro_b: {
    page_load_pause_min_ms: 800,
    page_load_pause_max_ms: 2500,
    inter_action_min_ms: 150,
    inter_action_max_ms: 500,
    idle_pause_prob: 0.05,
    idle_pause_min_ms: 500,
    idle_pause_max_ms: 2000,
    random_premove_prob: 0.1,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LoginAttempt {
  attemptNumber: number;
  timestamp: string;
  errorMessage: string | null;
  errorSelector: string | null;
  pageUrl: string;
  screenshotPath: string | null;
}

interface CredentialTestResult {
  email: string;
  label: string;
  attempts: LoginAttempt[];
  totalAttempts: number;
  uniqueErrors: string[];
  success: boolean;
  proxySession: string;
}

interface TestSummary {
  targetUrl: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  totalCredentialPairs: number;
  totalAttempts: number;
  results: CredentialTestResult[];
  proxySessions: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function log(
  message: string,
  level: "info" | "warn" | "error" | "success" = "info",
): void {
  const timestamp = new Date().toISOString();
  const prefix = { info: "📋", warn: "⚠️", error: "❌", success: "✅" }[level];
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

function generateSessionId(): string {
  const rand = Math.random().toString(36).substring(2, 10);
  return `login_test_${rand}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────────────────

async function dismissCookieConsent(
  page: Page,
  human: HumanBehaviorMiddleware,
): Promise<boolean> {
  try {
    const consentBtn = await page.$(SELECTORS.consentBanner);
    if (consentBtn) {
      // Use human-like click for consent
      await human.click(SELECTORS.consentBanner);
      await sleep(randomInRange(300, 600));
      log("Dismissed cookie consent banner (human click)");
      return true;
    }
  } catch (e) {
    // Try fallback direct click
    try {
      const consentBtn = await page.$(SELECTORS.consentBanner);
      if (consentBtn) {
        await consentBtn.click();
        await sleep(500);
        log("Dismissed cookie consent banner (fallback)");
        return true;
      }
    } catch {
      // Ignore consent errors
    }
  }
  return false;
}

async function extractErrorMessage(
  page: Page,
): Promise<{ message: string | null; selector: string | null }> {
  for (const selector of SELECTORS.errorMessage) {
    try {
      const elements = await page.$$(selector);
      for (const el of elements) {
        const isVisible = await el.isVisible();
        if (isVisible) {
          const text = await el.textContent();
          if (text && text.trim().length > 0) {
            // Filter out non-error text
            const trimmed = text.trim();
            if (
              trimmed.length > 2 &&
              trimmed.length < 500 &&
              !trimmed.toLowerCase().includes("welcome") &&
              !trimmed.toLowerCase().includes("join now")
            ) {
              return { message: trimmed, selector };
            }
          }
        }
      }
    } catch (e) {
      // Continue to next selector
    }
  }

  // Also check for any aria-live regions with error content
  try {
    const ariaLive = await page.$$(
      '[aria-live="polite"], [aria-live="assertive"]',
    );
    for (const el of ariaLive) {
      const text = await el.textContent();
      if (
        text &&
        text.trim().length > 0 &&
        text.toLowerCase().includes("error")
      ) {
        return { message: text.trim(), selector: "[aria-live]" };
      }
    }
  } catch (e) {
    // Ignore
  }

  // Check for toast notifications
  try {
    const toasts = await page.$$(
      '[class*="toast"], [class*="Toast"], [class*="notification"]',
    );
    for (const el of toasts) {
      const isVisible = await el.isVisible();
      if (isVisible) {
        const text = await el.textContent();
        if (text && text.trim().length > 0) {
          return { message: text.trim(), selector: "[toast/notification]" };
        }
      }
    }
  } catch (e) {
    // Ignore
  }

  return { message: null, selector: null };
}

async function waitForErrorOrChange(
  page: Page,
  timeoutMs: number = 5000,
): Promise<void> {
  const startUrl = page.url();

  try {
    await Promise.race([
      // Wait for any error element to appear
      page.waitForSelector(SELECTORS.errorMessage.join(", "), {
        timeout: timeoutMs,
        state: "visible",
      }),
      // Or wait for URL change (redirect)
      page.waitForURL((url) => url.toString() !== startUrl, {
        timeout: timeoutMs,
      }),
      // Or just wait the timeout
      page.waitForTimeout(timeoutMs),
    ]);
  } catch (e) {
    // Timeout is expected, continue
  }
}

async function humanRandomMouseMovement(
  page: Page,
  human: HumanBehaviorMiddleware,
): Promise<void> {
  // Perform random pre-move to simulate human looking around the page
  try {
    await human.randomPremove();
  } catch (e) {
    // Ignore premove errors
  }
}

async function testCredentialPair(
  browser: Browser,
  email: string,
  password: string,
  label: string,
  sessionId: string,
  credIndex: number,
): Promise<CredentialTestResult> {
  // Rotate IP for this credential pair: Nord CLI, proxy session, or direct
  let proxySession: string;
  if (USE_NORD_ROTATION) {
    log(`Rotating NordVPN (${NORD_COUNTRY})...`);
    const nordResult = await nordRotate();
    proxySession = nordResult ?? `nord-fail-${Date.now()}`;
    if (nordResult) {
      log(`NordVPN rotated: ${nordResult}`, "success");
    }
  } else if (USE_PROXY) {
    proxySession = generateProxySession();
  } else {
    proxySession = "direct";
  }
  const rotatedProxy = USE_PROXY ? getRotatedProxyConfig(proxySession) : null;

  const result: CredentialTestResult = {
    email,
    label,
    attempts: [],
    totalAttempts: CLICKS_PER_CREDENTIAL,
    uniqueErrors: [],
    success: false,
    proxySession,
  };

  log(`\n${"─".repeat(70)}`);
  log(`Testing: ${label} (${email})`);
  log(
    `IP: ${
      USE_NORD_ROTATION
        ? `NordVPN (${NORD_COUNTRY})`
        : USE_PROXY
          ? `Proxy Session ${proxySession}`
          : "Direct (no rotation)"
    }`,
  );
  log(`Using HUMANIZED interactions to avoid bot detection`);
  log(`${"─".repeat(70)}`);

  // Create new context (proxy only when not using Nord rotation)
  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    ...(USE_PROXY && rotatedProxy && {
      proxy: {
        server: rotatedProxy.server,
        username: rotatedProxy.username,
        password: rotatedProxy.password,
      },
    }),
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: {
      "Accept-Language": "en-AU,en;q=0.9",
    },
  };

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  // Initialize HumanBehaviorMiddleware with a unique seed per credential
  const humanSeed = Date.now() + credIndex * 1000;
  const human = new HumanBehaviorMiddleware(page, HUMAN_CONFIG, humanSeed);

  log(
    `New browser context created (${USE_NORD_ROTATION ? "NordVPN" : USE_PROXY ? "proxy" : "direct"})`,
  );
  log(`Human behavior middleware initialized (seed: ${humanSeed})`);

  // Navigate to login page
  try {
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Human-like page load pause
    await human.pageLoadPause();
    log(`Page loaded, performed human-like pause`);

    // Random mouse movement to simulate looking at page
    await humanRandomMouseMovement(page, human);

    await dismissCookieConsent(page, human);
  } catch (e) {
    log(`Failed to navigate to login page: ${e}`, "error");
    await context.close();
    return result;
  }

  // Clear and fill email field with human-like typing
  try {
    const emailField = await page.waitForSelector(SELECTORS.emailInput, {
      timeout: 10000,
    });
    if (emailField) {
      log(`Typing email with human-like behavior...`);
      await human.type(SELECTORS.emailInput, email);

      // Verify email was entered correctly
      let emailValue = await emailField.inputValue();
      let retries = 0;
      while ((!emailValue || emailValue !== email) && retries < 3) {
        log(
          `Email field verification failed, retrying... (attempt ${retries + 1})`,
          "warn",
        );
        await emailField.click();
        await page.keyboard.press("Control+a");
        await sleep(100);
        await page.keyboard.press("Backspace");
        await sleep(200);
        // Use direct fill as fallback for reliability
        await emailField.fill(email);
        await sleep(300);
        emailValue = await emailField.inputValue();
        retries++;
      }

      if (emailValue === email) {
        log(`Entered email: ${email} (verified)`);
      } else {
        log(`Warning: Email may not be fully entered: "${emailValue}"`, "warn");
      }
    }
  } catch (e) {
    log(`Failed to fill email field: ${e}`, "error");
    await context.close();
    return result;
  }

  // Small pause between fields like a human would
  await sleep(randomInRange(300, 800));

  // Clear and fill password field with human-like typing
  try {
    const passwordField = await page.waitForSelector(SELECTORS.passwordInput, {
      timeout: 10000,
    });
    if (passwordField) {
      log(`Typing password with human-like behavior...`);
      await human.type(SELECTORS.passwordInput, password);

      // Verify password was entered correctly
      let passValue = await passwordField.inputValue();
      let retries = 0;
      while (
        (!passValue || passValue.length !== password.length) &&
        retries < 3
      ) {
        log(
          `Password field verification failed, retrying... (attempt ${retries + 1})`,
          "warn",
        );
        await passwordField.click();
        await page.keyboard.press("Control+a");
        await sleep(100);
        await page.keyboard.press("Backspace");
        await sleep(200);
        // Use direct fill as fallback for reliability
        await passwordField.fill(password);
        await sleep(300);
        passValue = await passwordField.inputValue();
        retries++;
      }

      if (passValue && passValue.length === password.length) {
        log(`Entered password: ${"*".repeat(password.length)} (verified)`);
      } else {
        log(`Warning: Password may not be fully entered`, "warn");
      }
    }
  } catch (e) {
    log(`Failed to fill password field: ${e}`, "error");
    await context.close();
    return result;
  }

  // Perform 4 login button clicks
  for (let attempt = 1; attempt <= CLICKS_PER_CREDENTIAL; attempt++) {
    log(`\n  ▶ Attempt ${attempt}/${CLICKS_PER_CREDENTIAL}`);

    const attemptResult: LoginAttempt = {
      attemptNumber: attempt,
      timestamp: new Date().toISOString(),
      errorMessage: null,
      errorSelector: null,
      pageUrl: page.url(),
      screenshotPath: null,
    };

    try {
      // Verify fields are filled before clicking submit
      const emailField = await page.$(SELECTORS.emailInput);
      const passwordField = await page.$(SELECTORS.passwordInput);

      if (emailField && passwordField) {
        const emailValue = await emailField.inputValue();
        const passValue = await passwordField.inputValue();

        // Re-fill if empty
        if (!emailValue || emailValue.trim() === "") {
          log(`    Email field empty, re-filling...`, "warn");
          await emailField.click();
          await sleep(100);
          await emailField.fill(email);
          await sleep(200);
        }

        if (!passValue || passValue.trim() === "") {
          log(`    Password field empty, re-filling...`, "warn");
          await passwordField.click();
          await sleep(100);
          await passwordField.fill(password);
          await sleep(200);
        }
      }

      // Human-like click on the login button
      const submitBtn = await page.$(SELECTORS.submitButton);
      if (submitBtn) {
        log(`    Clicking login button (human-like)...`);
        await human.click(SELECTORS.submitButton);
        log(`    Clicked login button with humanized movement`);
      } else {
        // Try alternative submit methods with human click
        const altSelector =
          'button[type="submit"], button:has-text("Login"), button:has-text("LOG IN")';
        const altSubmit = await page.$(altSelector);
        if (altSubmit) {
          await human.click(altSelector);
          log(`    Clicked alternative submit button (humanized)`);
        } else {
          log(`    Could not find submit button`, "warn");
        }
      }

      // Wait for error message or page change
      await waitForErrorOrChange(page, 3000);

      // Extract error message
      const { message, selector } = await extractErrorMessage(page);
      attemptResult.errorMessage = message;
      attemptResult.errorSelector = selector;
      attemptResult.pageUrl = page.url();

      if (message) {
        log(`    Error detected: "${message}"`, "warn");
        if (!result.uniqueErrors.includes(message)) {
          result.uniqueErrors.push(message);
        }
      } else {
        // Check if we successfully logged in (URL changed to dashboard/account)
        const currentUrl = page.url();
        if (
          currentUrl.includes("dashboard") ||
          currentUrl.includes("account") ||
          currentUrl.includes("lobby") ||
          currentUrl.includes("profile")
        ) {
          log(
            `    Login appears successful! Redirected to: ${currentUrl}`,
            "success",
          );
          result.success = true;
          attemptResult.errorMessage = "LOGIN_SUCCESS";
        } else {
          log(`    No error message detected`);
        }
      }

      // Take screenshot
      try {
        const screenshotPath = `screenshot-${sessionId}-${email.replace(/[^a-zA-Z0-9]/g, "_")}-attempt${attempt}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: false });
        attemptResult.screenshotPath = screenshotPath;
        log(`    Screenshot: ${screenshotPath}`);
      } catch (e) {
        log(`    Could not save screenshot`, "warn");
      }

      result.attempts.push(attemptResult);

      // Wait before next attempt (unless it's the last one)
      if (attempt < CLICKS_PER_CREDENTIAL) {
        // Human-like delay with some randomness
        const delay = randomInRange(CLICK_DELAY_MS - 500, CLICK_DELAY_MS + 500);
        await sleep(delay);

        // Occasionally do a random mouse movement between attempts
        if (Math.random() < 0.3) {
          await humanRandomMouseMovement(page, human);
        }

        // Re-fill credentials if they were cleared (use direct fill for reliability)
        try {
          const emailField = await page.$(SELECTORS.emailInput);
          if (emailField) {
            const currentValue = await emailField.inputValue();
            if (!currentValue || currentValue !== email) {
              log(`    Re-filling email field...`);
              await emailField.click();
              await sleep(100);
              await page.keyboard.press("Control+a");
              await sleep(50);
              await page.keyboard.press("Backspace");
              await sleep(100);
              await emailField.fill(email);
              await sleep(200);
            }
          }
          const passwordField = await page.$(SELECTORS.passwordInput);
          if (passwordField) {
            const currentValue = await passwordField.inputValue();
            if (!currentValue || currentValue.length !== password.length) {
              log(`    Re-filling password field...`);
              await passwordField.click();
              await sleep(100);
              await page.keyboard.press("Control+a");
              await sleep(50);
              await page.keyboard.press("Backspace");
              await sleep(100);
              await passwordField.fill(password);
              await sleep(200);
            }
          }
        } catch (e) {
          // Ignore re-fill errors
        }
      }
    } catch (e) {
      log(`    Attempt ${attempt} failed: ${e}`, "error");
      attemptResult.errorMessage = `EXCEPTION: ${e}`;
      result.attempts.push(attemptResult);
    }
  }

  // Close the context after testing this credential pair
  await context.close();
  log(`Browser context closed for credential pair`);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Test Runner
// ─────────────────────────────────────────────────────────────────────────────

async function runLoginCredentialTests(): Promise<TestSummary> {
  const startTime = new Date();
  const sessionId = generateSessionId();

  const summary: TestSummary = {
    targetUrl: TARGET_URL,
    startTime: startTime.toISOString(),
    endTime: "",
    durationMs: 0,
    totalCredentialPairs: TEST_CREDENTIALS.length,
    totalAttempts: TEST_CREDENTIALS.length * CLICKS_PER_CREDENTIAL,
    results: [],
    proxySessions: [],
  };

  log("═".repeat(70));
  log("LOGIN CREDENTIAL TEST - Multi-Attempt Error Recording");
  log("═".repeat(70));
  log(`Target URL: ${TARGET_URL}`);
  log(`Login URL: ${LOGIN_URL}`);
  log(`Session ID: ${sessionId}`);
  log(`Credential pairs to test: ${TEST_CREDENTIALS.length}`);
  log(`Clicks per credential: ${CLICKS_PER_CREDENTIAL}`);
  log(`Total attempts: ${summary.totalAttempts}`);
  log(
    `IP rotation: ${
      USE_NORD_ROTATION
        ? `NordVPN CLI (${NORD_COUNTRY})`
        : USE_PROXY && PROXY_CONFIG
          ? `Proxy ${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`
          : "None"
    }`,
  );
  log(
    `Rotation: ${
      USE_NORD_ROTATION || USE_PROXY
        ? "ENABLED (new IP per credential pair)"
        : "N/A"
    }`,
  );
  log(`Humanization: ENABLED (HumanBehaviorMiddleware)`);
  log(`  - Mouse: Bézier curves, overshoot, micro-jitter`);
  log(
    `  - Typing: ${HUMAN_CONFIG.typing.base_wpm} WPM base, bursts, pauses, typo simulation`,
  );
  log(`  - Behavior: Random pre-moves, idle pauses, page load delays`);
  log("");

  let browser: Browser | null = null;

  try {
    // Launch browser
    log("Launching browser...");
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    // Test each credential pair with rotated proxy
    for (let i = 0; i < TEST_CREDENTIALS.length; i++) {
      const cred = TEST_CREDENTIALS[i];
      const label = cred.label || `Credential ${i + 1}`;

      log(
        `\n[${i + 1}/${TEST_CREDENTIALS.length}] Testing credential pair (${USE_NORD_ROTATION ? "NordVPN" : "proxy"} rotation)...`,
      );

      const result = await testCredentialPair(
        browser,
        cred.email,
        cred.password,
        label,
        sessionId,
        i,
      );
      summary.results.push(result);
      summary.proxySessions.push(result.proxySession);

      // Brief pause between credential pairs for rotation cooldown
      if (i < TEST_CREDENTIALS.length - 1) {
        const cooldownMs = USE_NORD_ROTATION ? 3000 : 2000;
        log(
          `Waiting ${cooldownMs}ms before next credential pair (cooldown)...`,
        );
        await sleep(cooldownMs);
      }
    }
  } catch (e) {
    log(`Test execution error: ${e}`, "error");
  } finally {
    if (browser) {
      await browser.close();
      log("\nBrowser closed");
    }
  }

  // Finalize summary
  const endTime = new Date();
  summary.endTime = endTime.toISOString();
  summary.durationMs = endTime.getTime() - startTime.getTime();

  // Print summary report
  printSummaryReport(summary);

  // Save JSON report
  const fs = await import("fs");
  const reportPath = `login-test-report-${sessionId}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  log(`\n📄 JSON report saved: ${reportPath}`);

  return summary;
}

function printSummaryReport(summary: TestSummary): void {
  log("\n" + "═".repeat(70));
  log("TEST SUMMARY REPORT");
  log("═".repeat(70));
  log(`Duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
  log(`Total credential pairs: ${summary.totalCredentialPairs}`);
  log(`Total login attempts: ${summary.totalAttempts}`);
  log(`Humanization: ENABLED`);
  log("");

  for (const result of summary.results) {
    log(`\n┌─ ${result.label} (${result.email})`);
    log(`│  Proxy Session: ${result.proxySession}`);
    log(`│  Attempts: ${result.attempts.length}/${result.totalAttempts}`);
    log(`│  Success: ${result.success ? "✅ YES" : "❌ NO"}`);
    log(`│  Unique errors found: ${result.uniqueErrors.length}`);

    if (result.uniqueErrors.length > 0) {
      log(`│  Error messages:`);
      for (const err of result.uniqueErrors) {
        log(`│    • "${err}"`);
      }
    }

    log(`│`);
    log(`│  Attempt Details:`);
    for (const attempt of result.attempts) {
      const status = attempt.errorMessage
        ? attempt.errorMessage === "LOGIN_SUCCESS"
          ? "✅"
          : "⚠️"
        : "ℹ️";
      log(
        `│    ${status} Attempt #${attempt.attemptNumber}: ${attempt.errorMessage || "No error message detected"}`,
      );
    }
    log(`└${"─".repeat(68)}`);
  }

  // Overall statistics
  const totalErrors = summary.results.reduce(
    (sum, r) => sum + r.uniqueErrors.length,
    0,
  );
  const successfulLogins = summary.results.filter((r) => r.success).length;

  log("\n" + "─".repeat(70));
  log("OVERALL STATISTICS");
  log("─".repeat(70));
  log(`Successful logins: ${successfulLogins}/${summary.totalCredentialPairs}`);
  log(`Total unique errors collected: ${totalErrors}`);
  log(
    `Sessions used: ${summary.totalCredentialPairs} (one per credential pair)`,
  );
  log(`Humanization: All interactions used human-like behavior`);

  // Collect all unique errors across all tests
  const allUniqueErrors = new Set<string>();
  for (const result of summary.results) {
    for (const err of result.uniqueErrors) {
      allUniqueErrors.add(err);
    }
  }

  if (allUniqueErrors.size > 0) {
    log(`\nAll unique error messages encountered:`);
    let i = 1;
    for (const err of allUniqueErrors) {
      log(`  ${i}. "${err}"`);
      i++;
    }
  }

  log("\n" + "═".repeat(70));
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

// Check for command line arguments for custom credentials (exclude flags)
const credArgs: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--nord") continue;
  if (rawArgs[i] === "--nord-country" || rawArgs[i] === "--clicks" || rawArgs[i] === "--delay") {
    i++;
    continue;
  }
  credArgs.push(rawArgs[i]);
}
if (credArgs.length >= 2) {
  TEST_CREDENTIALS.length = 0; // Clear default credentials
  TEST_CREDENTIALS.push({
    email: credArgs[0],
    password: credArgs[1],
    label: credArgs[2] || "Custom Credential",
  });
}

runLoginCredentialTests()
  .then((summary) => {
    const exitCode = summary.results.some((r) => r.success) ? 0 : 1;
    process.exit(exitCode);
  })
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
  });
