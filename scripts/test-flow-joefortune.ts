/**
 * Test Flow: JoeFortune Pokies
 *
 * This script creates a test automation flow that:
 * 1. Runs the form scraper on https://joefortunepokies.win
 * 2. Places scraped results into automation configuration
 * 3. Runs random Australian profiles with the specified proxy
 *
 * Proxy: provided via env (optional)
 *
 * Usage:
 *   npx tsx scripts/test-flow-joefortune.ts
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const TARGET_URL = "https://joefortunepokies.win";

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

  // If nothing set, run without proxy.
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
const USE_PROXY = PROXY_CONFIG !== null;

// Australian locale settings for profile consistency
const AU_LOCALE_CONFIG = {
  locale: "en-AU",
  timezoneId: "Australia/Sydney",
  acceptLanguage: "en-AU,en;q=0.9",
};

// Random Australian profile pool
const AU_PROFILES = [
  { name: "AU-Sydney-1", timezone: "Australia/Sydney" },
  { name: "AU-Melbourne-1", timezone: "Australia/Melbourne" },
  { name: "AU-Brisbane-1", timezone: "Australia/Brisbane" },
  { name: "AU-Perth-1", timezone: "Australia/Perth" },
  { name: "AU-Adelaide-1", timezone: "Australia/Adelaide" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ScrapedFormConfig {
  url: string;
  username_selector: string;
  password_selector: string;
  submit_selector: string;
  success_selector?: string;
  failure_selector?: string;
  captcha_selector?: string;
  consent_selector?: string;
  totp_selector?: string;
  confidence: number;
  details: string[];
}

interface AutomationConfig {
  form: ScrapedFormConfig;
  profile: (typeof AU_PROFILES)[0];
  proxy: typeof PROXY_CONFIG;
}

interface FlowResult {
  success: boolean;
  scrapeResult?: ScrapedFormConfig;
  automationConfig?: AutomationConfig;
  error?: string;
  screenshots: string[];
  logs: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function log(message: string, level: "info" | "warn" | "error" = "info"): void {
  const timestamp = new Date().toISOString();
  const prefix = { info: "📋", warn: "⚠️", error: "❌" }[level];
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

function selectRandomProfile(): (typeof AU_PROFILES)[0] {
  const index = Math.floor(Math.random() * AU_PROFILES.length);
  return AU_PROFILES[index];
}

function generateSessionId(): string {
  return `au_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Form Scraper
// ─────────────────────────────────────────────────────────────────────────────

async function dismissCookieConsent(page: Page): Promise<boolean> {
  const consentSelectors = [
    '[id*="cookie"] button',
    '[class*="cookie"] button',
    '[class*="consent"] button',
    'button:has-text("Accept")',
    'button:has-text("agree")',
    'button:has-text("OK")',
    '[aria-label*="cookie" i] button',
    '[aria-label*="accept" i]',
    ".cookie-banner button",
    "#cookie-notice button",
    ".gdpr button",
  ];

  for (const selector of consentSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        await page.waitForTimeout(500);
        log("Dismissed cookie consent banner");
        return true;
      }
    } catch {
      // Continue trying other selectors
    }
  }
  return false;
}

async function findAndClickLoginLink(page: Page): Promise<boolean> {
  const loginLinkSelectors = [
    'a:has-text("Login")',
    'a:has-text("Log in")',
    'a:has-text("Sign in")',
    'a:has-text("Sign In")',
    'button:has-text("Login")',
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    '[href*="login"]',
    '[href*="signin"]',
    '[href*="sign-in"]',
    '[href*="auth"]',
    '[class*="login"] a',
    '[class*="signin"] a',
    '[id*="login"]',
    '[data-testid*="login"]',
    'nav a:has-text("Login")',
    'header a:has-text("Login")',
  ];

  for (const selector of loginLinkSelectors) {
    try {
      const link = page.locator(selector).first();
      if (await link.isVisible({ timeout: 1000 })) {
        log(`Found login link: ${selector}`);
        await link.click();
        await page.waitForTimeout(2000);
        // Wait for navigation or modal
        try {
          await page.waitForLoadState("networkidle", { timeout: 5000 });
        } catch {
          // Modal might have appeared instead of navigation
        }
        return true;
      }
    } catch {
      // Continue trying other selectors
    }
  }
  return false;
}

async function checkForLoginModal(page: Page): Promise<boolean> {
  const modalSelectors = [
    '[role="dialog"]',
    ".modal",
    '[class*="modal"]',
    '[class*="popup"]',
    '[class*="overlay"]',
    '[class*="dialog"]',
    ".login-modal",
    "#login-modal",
  ];

  for (const selector of modalSelectors) {
    try {
      const modal = page.locator(selector).first();
      if (await modal.isVisible({ timeout: 1000 })) {
        // Check if modal contains password field
        const hasPassword = await modal
          .locator('input[type="password"]')
          .isVisible({ timeout: 500 });
        if (hasPassword) {
          log(`Found login modal: ${selector}`);
          return true;
        }
      }
    } catch {
      // Continue
    }
  }
  return false;
}

async function scrapeFormSelectors(
  page: Page,
  url: string,
): Promise<ScrapedFormConfig> {
  const details: string[] = [];

  log(`Navigating to ${url}...`);

  try {
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    details.push(`Successfully loaded ${url}`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    details.push(`Navigation error: ${error}`);
    // Try with domcontentloaded fallback
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      details.push("Fallback navigation succeeded (domcontentloaded)");
    } catch {
      throw new Error(`Failed to load page: ${error}`);
    }
  }

  // Wait for potential SPA hydration
  await page.waitForTimeout(2000);
  details.push("Waited for SPA hydration");

  // Step 1: Dismiss cookie consent if present
  const dismissedConsent = await dismissCookieConsent(page);
  if (dismissedConsent) {
    details.push("Dismissed cookie consent banner");
    await page.waitForTimeout(1000);
  }

  // Step 2: Check if we're already on a login page
  let hasLoginForm = await page
    .locator('input[type="password"]')
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  if (!hasLoginForm) {
    details.push("No login form on landing page, searching for login link...");

    // Step 3: Try to find and click login link
    const foundLoginLink = await findAndClickLoginLink(page);
    if (foundLoginLink) {
      details.push("Clicked login link, waiting for form...");
      await page.waitForTimeout(2000);

      // Check for modal
      const hasModal = await checkForLoginModal(page);
      if (hasModal) {
        details.push("Login modal detected");
      }

      hasLoginForm = await page
        .locator('input[type="password"]')
        .isVisible({ timeout: 3000 })
        .catch(() => false);
    }
  }

  if (hasLoginForm) {
    details.push("Login form found on page");
  } else {
    details.push(
      "Warning: No password field found - site may require different approach",
    );
  }

  // Detect form selectors (with enhanced detection for various site structures)
  const formConfig = await page.evaluate(() => {
    const result = {
      username_selector: "",
      password_selector: "",
      submit_selector: "",
      success_selector: "",
      failure_selector: "",
      captcha_selector: "",
      consent_selector: "",
    };

    // Username/Email field detection (expanded for gambling/gaming sites)
    const usernameSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[name="login"]',
      'input[name="user"]',
      'input[name="userId"]',
      'input[name="account"]',
      'input[id*="email"]',
      'input[id*="username"]',
      'input[id*="login"]',
      'input[id*="user"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="username" i]',
      'input[placeholder*="user" i]',
      'input[autocomplete="email"]',
      'input[autocomplete="username"]',
      // Modal/form specific
      '[role="dialog"] input[type="text"]',
      '.modal input[type="text"]',
      '.login-form input[type="text"]',
      'form input[type="text"]:first-of-type',
      // Data attribute patterns
      '[data-testid*="email"]',
      '[data-testid*="username"]',
    ];

    for (const selector of usernameSelectors) {
      const el = document.querySelector(selector);
      if (el && (el as HTMLInputElement).offsetParent !== null) {
        result.username_selector = selector;
        break;
      }
    }

    // Password field detection (expanded)
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[name="pass"]',
      'input[name="pwd"]',
      'input[id*="password"]',
      'input[id*="pass"]',
      'input[autocomplete="current-password"]',
      'input[autocomplete="new-password"]',
      // Modal/form specific
      '[role="dialog"] input[type="password"]',
      '.modal input[type="password"]',
      '.login-form input[type="password"]',
      '[data-testid*="password"]',
    ];

    for (const selector of passwordSelectors) {
      const el = document.querySelector(selector);
      if (el && (el as HTMLInputElement).offsetParent !== null) {
        result.password_selector = selector;
        break;
      }
    }

    // Submit button detection (expanded for various site patterns)
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[class*="login"]',
      'button[class*="submit"]',
      'button[class*="signin"]',
      'button[class*="btn-primary"]',
      'button[id*="login"]',
      'button[id*="submit"]',
      'button[id*="signin"]',
      '[role="button"][class*="login"]',
      // Modal/form specific
      '[role="dialog"] button[type="submit"]',
      '.modal button[type="submit"]',
      ".login-form button",
      'form button:not([type="button"])',
      // Data attributes
      '[data-testid*="login"]',
      '[data-testid*="submit"]',
      // Common patterns
      ".btn-login",
      ".login-btn",
      ".submit-btn",
    ];

    // First try to find buttons with specific text
    const loginTextPatterns = [
      "login",
      "log in",
      "sign in",
      "signin",
      "submit",
      "enter",
    ];
    const allButtons = Array.from(
      document.querySelectorAll(
        'button, input[type="submit"], [role="button"]',
      ),
    );
    for (const btn of allButtons) {
      const text = (btn.textContent || "").toLowerCase().trim();
      const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
      for (const pattern of loginTextPatterns) {
        if (
          (text.includes(pattern) || ariaLabel.includes(pattern)) &&
          (btn as HTMLElement).offsetParent !== null
        ) {
          if (btn.id) {
            result.submit_selector = `#${btn.id}`;
          } else if (btn.className) {
            const cls = (btn.className as string)
              .split(" ")
              .filter((c) => c.length > 0)[0];
            if (cls) result.submit_selector = `.${cls}`;
          }
          if (result.submit_selector) break;
        }
      }
      if (result.submit_selector) break;
    }

    // If text-based detection didn't work, try selectors
    if (!result.submit_selector) {
      for (const selector of submitSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && (el as HTMLElement).offsetParent !== null) {
            result.submit_selector = selector;
            break;
          }
        } catch {
          // Some selectors may not be valid for querySelector
          continue;
        }
      }
    }

    // Fallback: Find any visible button in a form
    if (!result.submit_selector) {
      const forms = Array.from(document.querySelectorAll("form"));
      for (const form of forms) {
        const btn = form.querySelector('button, input[type="submit"]');
        if (btn && (btn as HTMLElement).offsetParent !== null) {
          if (btn.id) {
            result.submit_selector = `#${btn.id}`;
          } else if (btn.className) {
            const cls = btn.className.split(" ")[0];
            result.submit_selector = `.${cls}`;
          }
          break;
        }
      }
    }

    // CAPTCHA detection
    const captchaIndicators = [
      ".g-recaptcha",
      "[data-sitekey]",
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      ".h-captcha",
      '[data-callback*="captcha"]',
      "#captcha",
      ".captcha",
    ];

    for (const selector of captchaIndicators) {
      const el = document.querySelector(selector);
      if (el) {
        result.captcha_selector = selector;
        break;
      }
    }

    // Consent/Cookie banner detection
    const consentSelectors = [
      '[class*="cookie"] button',
      '[class*="consent"] button',
      '[id*="cookie"] button',
      '[aria-label*="cookie" i] button',
      '[aria-label*="accept" i]',
      'button:has-text("accept")',
      'button:has-text("agree")',
    ];

    for (const selector of consentSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && (el as HTMLElement).offsetParent !== null) {
          result.consent_selector = selector;
          break;
        }
      } catch {
        continue;
      }
    }

    // Success indicator detection
    const successIndicators = [
      '[class*="dashboard"]',
      '[class*="welcome"]',
      '[class*="logout"]',
      'a[href*="logout"]',
      'button:has-text("logout")',
      '[class*="account"]',
      '[class*="profile"]',
    ];

    for (const selector of successIndicators) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          result.success_selector = selector;
          break;
        }
      } catch {
        continue;
      }
    }

    // Failure/Error indicator detection
    const failureIndicators = [
      '[class*="error"]',
      '[class*="alert"]',
      '[class*="invalid"]',
      '[role="alert"]',
      ".error-message",
      ".login-error",
      '[class*="fail"]',
    ];

    for (const selector of failureIndicators) {
      const el = document.querySelector(selector);
      if (el) {
        result.failure_selector = selector;
        break;
      }
    }

    return result;
  });

  // Get the current URL (may have changed after login link click)
  const finalUrl = page.url();
  if (finalUrl !== url) {
    details.push(`Navigated to: ${finalUrl}`);
  }

  // Calculate confidence score
  let confidence = 0;
  if (formConfig.username_selector) {
    confidence += 30;
    details.push(`✓ Username field: ${formConfig.username_selector}`);
  } else {
    details.push("✗ Username field not found");
  }

  if (formConfig.password_selector) {
    confidence += 30;
    details.push(`✓ Password field: ${formConfig.password_selector}`);
  } else {
    details.push("✗ Password field not found");
  }

  if (formConfig.submit_selector) {
    confidence += 25;
    details.push(`✓ Submit button: ${formConfig.submit_selector}`);
  } else {
    details.push("✗ Submit button not found");
  }

  if (formConfig.captcha_selector) {
    confidence += 5;
    details.push(`⚠ CAPTCHA detected: ${formConfig.captcha_selector}`);
  }

  if (formConfig.consent_selector) {
    confidence += 5;
    details.push(`ℹ Consent banner: ${formConfig.consent_selector}`);
  }

  if (formConfig.success_selector) {
    confidence += 3;
    details.push(`ℹ Success indicator: ${formConfig.success_selector}`);
  }

  if (formConfig.failure_selector) {
    confidence += 2;
    details.push(`ℹ Failure indicator: ${formConfig.failure_selector}`);
  }

  return {
    url: finalUrl,
    ...formConfig,
    confidence,
    details,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Automation Runner
// ─────────────────────────────────────────────────────────────────────────────

async function runAutomation(
  browser: Browser,
  config: AutomationConfig,
): Promise<{ success: boolean; logs: string[]; screenshot?: Buffer }> {
  const logs: string[] = [];
  const sessionId = generateSessionId();

  logs.push(`Session ID: ${sessionId}`);
  logs.push(`Profile: ${config.profile.name}`);
  logs.push(`Timezone: ${config.profile.timezone}`);
  logs.push(`Proxy: ${config.proxy.server}`);

  // Build context options with HTTP proxy
  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    proxy: {
      server: config.proxy.server,
      username: config.proxy.username,
      password: config.proxy.password,
    },
    locale: AU_LOCALE_CONFIG.locale,
    timezoneId: config.profile.timezone,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    extraHTTPHeaders: {
      "Accept-Language": AU_LOCALE_CONFIG.acceptLanguage,
    },
  };

  const context = await browser.newContext(contextOptions);

  const page = await context.newPage();
  let screenshot: Buffer | undefined;

  try {
    logs.push(`Navigating to ${config.form.url}...`);

    await page.goto(config.form.url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    logs.push("Page loaded successfully");

    // Handle consent banner if detected
    if (config.form.consent_selector) {
      try {
        const consentBtn = page.locator(config.form.consent_selector).first();
        if (await consentBtn.isVisible({ timeout: 3000 })) {
          await consentBtn.click();
          logs.push("Dismissed consent banner");
          await page.waitForTimeout(1000);
        }
      } catch {
        logs.push("No consent banner interaction needed");
      }
    }

    // Take screenshot of login page
    screenshot = await page.screenshot({ fullPage: false });
    logs.push("Captured login page screenshot");

    // Verify form elements are present
    const formStatus = {
      username: false,
      password: false,
      submit: false,
    };

    if (config.form.username_selector) {
      try {
        const el = page.locator(config.form.username_selector).first();
        formStatus.username = await el.isVisible({ timeout: 5000 });
        logs.push(`Username field visible: ${formStatus.username}`);
      } catch {
        logs.push("Username field not accessible");
      }
    }

    if (config.form.password_selector) {
      try {
        const el = page.locator(config.form.password_selector).first();
        formStatus.password = await el.isVisible({ timeout: 5000 });
        logs.push(`Password field visible: ${formStatus.password}`);
      } catch {
        logs.push("Password field not accessible");
      }
    }

    if (config.form.submit_selector) {
      try {
        const el = page.locator(config.form.submit_selector).first();
        formStatus.submit = await el.isVisible({ timeout: 5000 });
        logs.push(`Submit button visible: ${formStatus.submit}`);
      } catch {
        logs.push("Submit button not accessible");
      }
    }

    // Report CAPTCHA if detected
    if (config.form.captcha_selector) {
      try {
        const captcha = page.locator(config.form.captcha_selector).first();
        const hasCaptcha = await captcha.isVisible({ timeout: 2000 });
        if (hasCaptcha) {
          logs.push(
            "⚠️ CAPTCHA detected on page - manual intervention may be required",
          );
        }
      } catch {
        // No captcha visible
      }
    }

    const allFieldsFound =
      formStatus.username && formStatus.password && formStatus.submit;
    logs.push(`Form validation: ${allFieldsFound ? "PASS" : "PARTIAL"}`);

    return {
      success: allFieldsFound,
      logs,
      screenshot,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logs.push(`Error: ${error}`);

    // Try to capture error screenshot
    try {
      screenshot = await page.screenshot({ fullPage: false });
    } catch {
      // Ignore screenshot errors
    }

    return {
      success: false,
      logs,
      screenshot,
    };
  } finally {
    await context.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Flow
// ─────────────────────────────────────────────────────────────────────────────

async function runTestFlow(): Promise<FlowResult> {
  const result: FlowResult = {
    success: false,
    screenshots: [],
    logs: [],
  };

  log(
    "═══════════════════════════════════════════════════════════════════════",
  );
  log("Test Flow: JoeFortune Pokies");
  log(
    "═══════════════════════════════════════════════════════════════════════",
  );
  log(`Target URL: ${TARGET_URL}`);
  log(
    `Proxy: ${
      USE_PROXY && PROXY_CONFIG ? `${PROXY_CONFIG.host}:${PROXY_CONFIG.port}` : "None"
    }`,
  );
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
    result.logs.push("Browser launched");

    // Select random AU profile
    const selectedProfile = selectRandomProfile();
    log(
      `Selected profile: ${selectedProfile.name} (${selectedProfile.timezone})`,
    );
    result.logs.push(`Profile: ${selectedProfile.name}`);

    // Create context with proxy for scraping
    log("");
    log(
      "─── PHASE 1: Form Scraping ───────────────────────────────────────────",
    );

    // Build context options (proxy optional)
    if (USE_PROXY && PROXY_CONFIG) {
      log("Configuring proxy...");
      log(`Proxy server: ${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`);
    } else {
      log("Configuring context (no proxy)...");
    }

    const contextOptions: Parameters<typeof browser.newContext>[0] = {
      ...(USE_PROXY && PROXY_CONFIG
        ? {
            proxy: {
              server: PROXY_CONFIG.server,
              username: PROXY_CONFIG.username,
              password: PROXY_CONFIG.password,
            },
          }
        : {}),
      locale: AU_LOCALE_CONFIG.locale,
      timezoneId: selectedProfile.timezone,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: {
        "Accept-Language": AU_LOCALE_CONFIG.acceptLanguage,
      },
    };

    const scrapeContext = await browser.newContext(contextOptions);
    log(
      USE_PROXY && PROXY_CONFIG
        ? "Browser context created with proxy"
        : "Browser context created (no proxy)",
    );

    const scrapePage = await scrapeContext.newPage();

    // Run form scraper
    log(`Scraping form selectors from ${TARGET_URL}...`);
    const scrapeResult = await scrapeFormSelectors(scrapePage, TARGET_URL);
    result.scrapeResult = scrapeResult;

    log("");
    log("Scrape Results:");
    log(`  Confidence: ${scrapeResult.confidence}%`);
    for (const detail of scrapeResult.details) {
      log(`  ${detail}`);
    }

    // Take screenshot of scraped page
    try {
      const screenshotPath = `screenshot-scrape-${Date.now()}.png`;
      await scrapePage.screenshot({ path: screenshotPath, fullPage: false });
      result.screenshots.push(screenshotPath);
      log(`Screenshot saved: ${screenshotPath}`);
    } catch (e) {
      log("Could not save screenshot", "warn");
    }

    await scrapeContext.close();

    // Phase 2: Configure Automation
    log("");
    log(
      "─── PHASE 2: Automation Configuration ────────────────────────────────",
    );

    const automationConfig: AutomationConfig = {
      form: scrapeResult,
      profile: selectedProfile,
      proxy: PROXY_CONFIG,
    };
    result.automationConfig = automationConfig;

    log("Automation config prepared:");
    log(`  URL: ${automationConfig.form.url}`);
    log(
      `  Username Selector: ${automationConfig.form.username_selector || "Not detected"}`,
    );
    log(
      `  Password Selector: ${automationConfig.form.password_selector || "Not detected"}`,
    );
    log(
      `  Submit Selector: ${automationConfig.form.submit_selector || "Not detected"}`,
    );
    log(`  Profile: ${automationConfig.profile.name}`);
    log(
      `  Proxy: ${
        USE_PROXY && PROXY_CONFIG ? `${PROXY_CONFIG.host}:${PROXY_CONFIG.port}` : "None"
      }`,
    );

    // Phase 3: Run Automation Test
    log("");
    log(
      "─── PHASE 3: Automation Test Run ─────────────────────────────────────",
    );

    // Lower threshold since we now try to navigate to login page
    if (scrapeResult.confidence >= 30) {
      log("Running automation with scraped configuration...");

      const automationResult = await runAutomation(browser, automationConfig);

      log("");
      log("Automation Logs:");
      for (const logEntry of automationResult.logs) {
        log(`  ${logEntry}`);
        result.logs.push(logEntry);
      }

      if (automationResult.screenshot) {
        const screenshotPath = `screenshot-automation-${Date.now()}.png`;
        const fs = await import("fs");
        fs.writeFileSync(screenshotPath, automationResult.screenshot);
        result.screenshots.push(screenshotPath);
        log(`Screenshot saved: ${screenshotPath}`);
      }

      result.success = automationResult.success;
    } else {
      log(
        `Scrape confidence too low (${scrapeResult.confidence}%), skipping automation test`,
        "warn",
      );
      result.logs.push("Skipped automation due to low scrape confidence");
      result.success = false;
    }

    // Final Summary
    log("");
    log(
      "═══════════════════════════════════════════════════════════════════════",
    );
    log("FLOW COMPLETE");
    log(
      "═══════════════════════════════════════════════════════════════════════",
    );
    log(`Result: ${result.success ? "✅ SUCCESS" : "⚠️ PARTIAL/FAILED"}`);
    log(`Scrape Confidence: ${scrapeResult.confidence}%`);
    log(`Screenshots Captured: ${result.screenshots.length}`);
    log("");

    // Output JSON config for use in Manifold UI
    log(
      "─── Export Config (for Manifold Automation page) ────────────────────",
    );
    const exportConfig = {
      url: scrapeResult.url,
      username_selector: scrapeResult.username_selector,
      password_selector: scrapeResult.password_selector,
      submit_selector: scrapeResult.submit_selector,
      success_selector: scrapeResult.success_selector,
      failure_selector: scrapeResult.failure_selector,
      captcha_selector: scrapeResult.captcha_selector,
      consent_selector: scrapeResult.consent_selector,
      post_submit_timeout_ms: 8000,
      page_load_timeout_ms: 15000,
      export_session_on_success: true,
    };
    console.log(JSON.stringify(exportConfig, null, 2));

    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log(`Flow error: ${error}`, "error");
    result.error = error;
    result.logs.push(`Error: ${error}`);
    return result;
  } finally {
    if (browser) {
      await browser.close();
      log("Browser closed");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

runTestFlow()
  .then((result) => {
    process.exit(result.success ? 0 : 1);
  })
  .catch((e) => {
    console.error("Unhandled error:", e);
    process.exit(1);
  });
