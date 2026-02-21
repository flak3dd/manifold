/**
 * Form Scraper Utility
 *
 * Automatically detects and extracts form selectors from a target URL.
 * Uses headless browser automation to identify login form elements.
 */

import type { LoginFormConfig } from "../../playwright-bridge/login-types";

export interface FormScraperOptions {
  url: string;
  timeout?: number;
  headless?: boolean;
}

export interface ScrapedFormSelectors {
  url: string;
  username_selector?: string;
  password_selector?: string;
  submit_selector?: string;
  success_selector?: string;
  failure_selector?: string;
  captcha_selector?: string;
  consent_selector?: string;
  totp_selector?: string;
  mfa_selector?: string;
  confidence: number;
  details: string[];
  isSPA?: boolean;
  spaFramework?: string;
  hasCaptcha?: boolean;
  captchaProviders?: string[];
  hasMFA?: boolean;
  mfaType?: 'totp' | 'sms' | 'email' | 'push' | 'security_key' | 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Selector detection patterns
// ─────────────────────────────────────────────────────────────────────────────

const SELECTOR_PATTERNS = {
  username: [
    'input[type="email"]',
    'input[type="text"][name*="user"]',
    'input[type="text"][name*="email"]',
    'input[type="text"][name*="account"]',
    'input[type="text"][placeholder*="email"]',
    'input[type="text"][placeholder*="user"]',
    'input[type="email"][placeholder*="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[name="user"]',
    'input[id*="email"]',
    'input[id*="username"]',
  ],

  password: [
    'input[type="password"]',
    'input[type="password"][name*="pass"]',
    'input[type="password"][placeholder*="pass"]',
    'input[name="password"]',
    'input[id*="password"]',
  ],

  submit: [
    'button[type="submit"]',
    'button:contains("Sign in")',
    'button:contains("Login")',
    'button:contains("Submit")',
    'button[name*="submit"]',
    'input[type="submit"]',
    'button[class*="submit"]',
    'button[class*="login"]',
    'button[class*="signin"]',
    'button[aria-label*="sign in"]',
    'button[aria-label*="login"]',
  ],

  success: [
    '[class*="dashboard"]',
    '[class*="home"]',
    '[class*="account"]',
    '[data-testid*="profile"]',
    'a[href*="dashboard"]',
    'a[href*="home"]',
    '.profile-avatar',
    '.user-avatar',
    '[aria-label*="logout"]',
    '[aria-label*="profile"]',
  ],

  failure: [
    '[class*="error"]',
    '[class*="invalid"]',
    '[class*="wrong"]',
    '[role="alert"]',
    '.error-message',
    '.invalid-credentials',
    '[data-testid*="error"]',
  ],

  captcha: [
    '[class*="captcha"]',
    '[class*="recaptcha"]',
    '[class*="hcaptcha"]',
    '[data-testid*="captcha"]',
    'iframe[src*="captcha"]',
    'iframe[src*="recaptcha"]',
    'iframe[src*="arkose"]',
  ],

  consent: [
    '[class*="cookie"]',
    '[class*="consent"]',
    '[class*="banner"]',
    'button:contains("Accept")',
    'button:contains("Agree")',
    '[role="dialog"]',
  ],

  totp: [
    'input[placeholder*="code"]',
    'input[placeholder*="OTP"]',
    'input[placeholder*="2FA"]',
    'input[name*="code"]',
    'input[name*="otp"]',
    'input[id*="totp"]',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Tauri-based form scraper
// ─────────────────────────────────────────────────────────────────────────────

function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

let invokeCache: typeof import("@tauri-apps/api/core").invoke | null = null;

async function getInvoke() {
  if (invokeCache) return invokeCache;

  if (!isTauriAvailable()) {
    return null;
  }

  try {
    const tauriCore = await import("@tauri-apps/api/core");
    invokeCache = tauriCore.invoke;
    return invokeCache;
  } catch (e) {
    console.warn("[formScraper] Failed to import Tauri API:", e);
    return null;
  }
}

async function safeInvoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    console.warn(`[formScraper] Tauri unavailable, skipping command: ${cmd}`);
    return null;
  }
  return invoke<T>(cmd, args ?? {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Form detection algorithm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score a selector based on how well it matches the element
 */
function scoreSelector(
  element: Element,
  patterns: string[],
  selectorType: string,
): number {
  let score = 0;

  // Check tag name
  if (element.tagName.toLowerCase() === "input") score += 20;
  if (element.tagName.toLowerCase() === "button") score += 10;

  // Check type attribute
  const type = element.getAttribute("type")?.toLowerCase() || "";
  if (selectorType === "password" && type === "password") score += 30;
  if (selectorType === "username" && type === "email") score += 25;
  if (selectorType === "submit" && type === "submit") score += 30;

  // Check name attribute
  const name = element.getAttribute("name")?.toLowerCase() || "";
  if (selectorType === "username" && name.includes("user")) score += 15;
  if (selectorType === "username" && name.includes("email")) score += 15;
  if (selectorType === "password" && name.includes("pass")) score += 15;
  if (selectorType === "submit" && name.includes("submit")) score += 15;

  // Check id attribute
  const id = element.getAttribute("id")?.toLowerCase() || "";
  if (selectorType === "username" && id.includes("user")) score += 10;
  if (selectorType === "password" && id.includes("pass")) score += 10;

  // Check placeholder
  const placeholder = element.getAttribute("placeholder")?.toLowerCase() || "";
  if (selectorType === "username" && placeholder.includes("user")) score += 10;
  if (selectorType === "username" && placeholder.includes("email")) score += 10;
  if (selectorType === "password" && placeholder.includes("pass")) score += 10;

  // Check aria-label
  const ariaLabel = element.getAttribute("aria-label")?.toLowerCase() || "";
  if (selectorType === "submit" && ariaLabel.includes("sign")) score += 10;
  if (selectorType === "submit" && ariaLabel.includes("login")) score += 10;

  // Check class
  const classList = element.className.toLowerCase();
  if (selectorType === "password" && classList.includes("pass")) score += 8;
  if (selectorType === "submit" && classList.includes("submit")) score += 8;
  if (selectorType === "submit" && classList.includes("login")) score += 8;

  // Check if element is visible and enabled
  const style = window.getComputedStyle(element);
  if (style.display !== "none" && style.visibility !== "hidden") score += 5;

  if (!(element as HTMLInputElement).disabled) score += 5;

  return score;
}

/**
 * Generate a CSS selector for an element
 */
function generateSelector(element: Element): string {
  // Try ID first (most specific)
  if (element.id) {
    return `#${element.id}`;
  }

  // Build a selector from tag + classes
  let selector = element.tagName.toLowerCase();

  if (element.className) {
    const classes = element.className
      .split(" ")
      .filter((c) => c.length > 0)
      .map((c) => `.${c}`)
      .join("");
    selector += classes;
  }

  // Add name attribute if present
  if (element.getAttribute("name")) {
    selector = `${selector}[name="${element.getAttribute("name")}"]`;
  }

  // Add type attribute if input
  if (element.tagName.toLowerCase() === "input") {
    const type = element.getAttribute("type");
    if (type) {
      selector = `input[type="${type}"]`;
    }
  }

  return selector;
}

/**
 * Detect form selectors from a URL using Tauri headless browser
 * Falls back to client-side detection if Tauri is unavailable
 */
export async function scrapeFormSelectors(
  options: FormScraperOptions & { waitForSPA?: boolean; detectCaptcha?: boolean; detectMFA?: boolean } = {},
): Promise<ScrapedFormSelectors> {
  const timeout = options.timeout || 15000;
  const details: string[] = [];

  // Check Tauri availability
  const tauriAvailable = isTauriAvailable();
  console.log("[formScraper] Tauri available:", tauriAvailable);
  console.log("[formScraper] Target URL:", options.url);
  console.log("[formScraper] Timeout:", timeout, "ms");
  console.log("[formScraper] Options:", { waitForSPA: options.waitForSPA, detectCaptcha: options.detectCaptcha, detectMFA: options.detectMFA });

  // Try Tauri-based scraping first (most reliable for dynamic content)
  if (tauriAvailable) {
    try {
      console.log("[formScraper] Attempting Tauri-based form scraping...");
      const result = await safeInvoke<ScrapedFormSelectors>(
        "scrape_form_selectors",
        {
          url: options.url,
          timeout,
          wait_for_spa: options.waitForSPA ?? true,
          detect_captcha: options.detectCaptcha ?? true,
          detect_mfa: options.detectMFA ?? true,
        },
      );

      if (result && result.confidence > 0) {
        console.log("[formScraper] ✅ Successfully scraped selectors using Tauri");
        console.log("[formScraper] Confidence:", result.confidence);
        console.log("[formScraper] Detected fields:", {
          username: result.username_selector ? "✓" : "✗",
          password: result.password_selector ? "✓" : "✗",
          submit: result.submit_selector ? "✓" : "✗",
          success: result.success_selector ? "✓" : "✗",
          captcha: result.captcha_selector ? "✓" : "✗",
          mfa: result.mfa_selector ? "✓" : "✗",
        });
        return result;
      } else if (result) {
        details.push("Tauri scraping returned low confidence result");
        console.warn("[formScraper] Tauri scraping succeeded but confidence is low:", result.confidence);
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.warn("[formScraper] Tauri scraping failed:", errorMsg);
      details.push(`Tauri scraping error: ${errorMsg}`);
    }
  } else {
    console.log("[formScraper] ℹ️ Tauri bridge not available, skipping Tauri scraping");
    details.push("Tauri bridge not available (backend scraping disabled)");
  }

  // Fallback 1: playwright bridge WebSocket (works when npm run bridge is running)
  try {
    console.log("[formScraper] Attempting playwright bridge form scraping...");
    const bridgeResult = await scrapeViaPlaywrightBridge(options.url, timeout);
    if (bridgeResult && bridgeResult.confidence > 0) {
      console.log("[formScraper] ✅ Playwright bridge scraping succeeded, confidence:", bridgeResult.confidence);
      details.push("Detected using playwright bridge (real browser)");
      return {
        ...bridgeResult,
        details: [...details, ...(bridgeResult.details ?? [])],
      };
    } else if (bridgeResult?.error) {
      console.warn("[formScraper] Playwright bridge returned error:", bridgeResult.error);
      details.push(`Playwright bridge error: ${bridgeResult.error}`);
    } else {
      console.warn("[formScraper] Playwright bridge returned low/zero confidence");
      details.push("Playwright bridge returned low confidence");
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.warn("[formScraper] Playwright bridge not available:", errorMsg);
    details.push(`Playwright bridge not available: ${errorMsg}`);
  }

  // Fallback 2: client-side detection (for same-origin pages)
  try {
    console.log("[formScraper] Attempting client-side form detection...");
    const frame = await detectFormInFrame(options.url);
    if (frame && frame.confidence > 0) {
      console.log("[formScraper] ✅ Client-side detection succeeded");
      console.log("[formScraper] Confidence:", frame.confidence);
      details.push("Detected using client-side form analysis");
      return {
        ...frame,
        details,
      };
    } else {
      console.warn("[formScraper] Client-side detection returned low/zero confidence");
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.warn("[formScraper] Client-side detection failed:", errorMsg);
    details.push(`Client-side detection error: ${errorMsg}`);
  }

  // Return empty result with detailed explanation
  console.error("[formScraper] ❌ All detection methods failed");
  return {
    confidence: 0,
    details: [
      ...details,
      "",
      "❌ Unable to automatically detect form selectors",
      "",
      "Possible reasons:",
      "• Tauri app not running (run: npm run tauri dev)",
      "• Playwright bridge not running (run: npm run bridge)",
      "• Page uses complex JavaScript frameworks (React, Vue, Angular)",
      "• Form is hidden behind modal or requires interaction",
      "• Page requires authentication or session cookies",
      "• Target URL is incorrect or page doesn't exist",
      "",
      "Solutions:",
      "1. Run the full app: npm run tauri dev",
      "2. Or start the bridge separately: npm run bridge",
      "3. Use browser DevTools Inspector to find selectors manually",
      "4. Try with a different URL format (www vs non-www, http vs https)",
      "5. Check browser console (F12) for detailed error messages",
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Playwright bridge WebSocket fallback
// ─────────────────────────────────────────────────────────────────────────────

const BRIDGE_WS_PORT = 8766;

async function scrapeViaPlaywrightBridge(
  url: string,
  timeout: number,
): Promise<ScrapedFormSelectors | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error("Playwright bridge scrape timed out"));
      }
    }, timeout);

    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://localhost:${BRIDGE_WS_PORT}`);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
      return;
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "scrape_form", url, timeout }));
    };

    ws.onmessage = (event: MessageEvent) => {
      if (settled) return;
      try {
        const msg = JSON.parse(event.data as string) as { type: string; result?: ScrapedFormSelectors };
        if (msg.type === "scrape_form_result") {
          settled = true;
          clearTimeout(timer);
          ws.close();
          resolve(msg.result ?? null);
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Cannot connect to playwright bridge on port ${BRIDGE_WS_PORT}`));
      }
    };

    ws.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Playwright bridge connection closed unexpectedly`));
      }
    };
  });
}

/**
 * Client-side form detection (for same-origin pages)
 */
async function detectFormInFrame(
  url: string,
): Promise<ScrapedFormSelectors | null> {
  try {
    console.log("[detectFormInFrame] Fetching page:", url);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    console.log("[detectFormInFrame] Page fetched, size:", html.length, "bytes");

    // Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    if (doc.documentElement.tagName === "parsererror") {
      throw new Error("HTML parsing failed (invalid markup)");
    }

    console.log("[detectFormInFrame] HTML parsed successfully");

    const selectors: Partial<ScrapedFormSelectors> = {};
    const scores: Record<string, number> = {};
    const details: string[] = [];

    // Detect SPA framework
    const spaDetection = detectSPA(doc);
    if (spaDetection.isSPA) {
      const msg = `Detected SPA framework: ${spaDetection.framework || 'unknown'}`;
      details.push(msg);
      console.log("[detectFormInFrame]", msg);
    }

    // Detect CAPTCHA
    const captchaDetection = detectCaptcha(doc);
    if (captchaDetection.hasCaptcha) {
      selectors.captcha_selector = captchaDetection.selectors[0];
      const msg = `Detected CAPTCHA providers: ${captchaDetection.providers.join(', ')}`;
      details.push(msg);
      console.log("[detectFormInFrame]", msg);
    }

    // Detect MFA
    const mfaDetection = detectMFA(doc);
    if (mfaDetection.hasMFA) {
      if (mfaDetection.selector) {
        selectors.mfa_selector = mfaDetection.selector;
      }
      if (mfaDetection.type === 'totp') {
        selectors.totp_selector = mfaDetection.selector;
      }
      const msg = `Detected MFA/2FA form (type: ${mfaDetection.type || 'unknown'})`;
      details.push(msg);
      console.log("[detectFormInFrame]", msg);
    }

    // Detect each field type
    for (const [fieldType, patterns] of Object.entries(SELECTOR_PATTERNS)) {
      let bestElement: Element | null = null;
      let bestScore = 0;
      let bestSelector = "";

      // Try to find matching elements
      const allElements = doc.querySelectorAll("input, button, [role='button']");

      for (const element of allElements) {
        const score = scoreSelector(element, patterns, fieldType);

        if (score > bestScore) {
          bestScore = score;
          bestElement = element;
          bestSelector = generateSelector(element);
        }
      }

      if (bestElement && bestScore > 0) {
        const key = `${fieldType}_selector` as keyof ScrapedFormSelectors;
        selectors[key] = bestSelector;
        scores[fieldType] = bestScore;
        details.push(
          `${fieldType}: "${bestSelector}" (score: ${bestScore})`,
        );
      }
    }

    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    const maxPossibleScore = Object.keys(SELECTOR_PATTERNS).length * 30;
    const confidence = Math.min(100, Math.round((totalScore / maxPossibleScore) * 100));

    return {
      url,
      ...selectors,
      confidence,
      details,
      isSPA: spaDetection.isSPA,
      spaFramework: spaDetection.framework,
      hasCaptcha: captchaDetection.hasCaptcha,
      captchaProviders: captchaDetection.providers,
      hasMFA: mfaDetection.hasMFA,
      mfaType: mfaDetection.type,
    } as ScrapedFormSelectors;
  } catch (e) {
    console.error("[formScraper] Client-side detection error:", e);
    return null;
  }
}

/**
 * Validate scraped selectors by checking if they exist on the page
 */
export async function validateSelectors(
  url: string,
  selectors: Partial<ScrapedFormSelectors>,
): Promise<{ valid: boolean; missing: string[] }> {
  const missing: string[] = [];

  try {
    const response = await fetch(url);
    const html = await response.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    if (doc.documentElement.tagName === "parsererror") {
      return { valid: false, missing: ["Invalid HTML"] };
    }

    // Check each selector
    for (const [key, selector] of Object.entries(selectors)) {
      if (!selector || typeof selector !== "string") continue;
      if (key === "confidence" || key === "details") continue;

      try {
        const elements = doc.querySelectorAll(selector);
        if (elements.length === 0) {
          missing.push(`${key}: "${selector}" not found`);
        }
      } catch (e) {
        missing.push(`${key}: Invalid selector "${selector}"`);
      }
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  } catch (e) {
    return {
      valid: false,
      missing: [`Validation error: ${e}`],
    };
  }
}

/**
 * Convert scraped selectors to LoginFormConfig
 */
export function selectorsToFormConfig(
  url: string,
  selectors: ScrapedFormSelectors,
): Partial<LoginFormConfig> {
  return {
    url,
    username_selector: selectors.username_selector,
    password_selector: selectors.password_selector,
    submit_selector: selectors.submit_selector,
    success_selector: selectors.success_selector,
    failure_selector: selectors.failure_selector,
    captcha_selector: selectors.captcha_selector,
    consent_selector: selectors.consent_selector,
    totp_selector: selectors.totp_selector,
  };
}

/**
 * Detect if page is a Single Page Application (SPA)
 */
function detectSPA(doc: Document): { isSPA: boolean; framework?: string } {
  const html = doc.documentElement.outerHTML;
  const body = doc.body?.outerHTML || '';

  // Check for SPA framework indicators
  const frameworks: Record<string, RegExp[]> = {
    react: [
      /data-reactroot/,
      /data-react-root/,
      /__REACT_/,
      /react-dom/,
    ],
    vue: [
      /data-v-[a-f0-9]+/,
      /v-app/,
      /__vue__/,
      /vue@/,
    ],
    angular: [
      /ng-app/,
      /ng-controller/,
      /\[ng-/,
      /angular\.js/,
      /ng-version/,
    ],
    svelte: [
      /svelte-/,
      /__svelte/,
    ],
    ember: [
      /ember-application/,
      /ember-view/,
    ],
    next: [
      /__NEXT_DATA__/,
      /next\/link/,
    ],
    nuxt: [
      /__NUXT__/,
      /nuxt-link/,
    ],
  };

  for (const [framework, patterns] of Object.entries(frameworks)) {
    for (const pattern of patterns) {
      if (pattern.test(html) || pattern.test(body)) {
        return { isSPA: true, framework };
      }
    }
  }

  // Check for common SPA indicators
  const spaIndicators = [
    'id="app"',
    'id="root"',
    'id="spa"',
    'class="container"',
    'data-app',
  ];

  for (const indicator of spaIndicators) {
    if (html.includes(indicator) && body.length > 500) {
      return { isSPA: true };
    }
  }

  return { isSPA: false };
}

/**
 * Detect CAPTCHA presence and providers
 */
function detectCaptcha(doc: Document): {
  hasCaptcha: boolean;
  providers: string[];
  selectors: string[];
} {
  const captchaProviders: Record<string, string[]> = {
    recaptcha: [
      '.g-recaptcha',
      '[data-sitekey]',
      'iframe[src*="recaptcha"]',
      'script[src*="recaptcha"]',
      '__recaptcha_api',
    ],
    hcaptcha: [
      '.h-captcha',
      '[data-sitekey*="hcaptcha"]',
      'iframe[src*="hcaptcha"]',
      'script[src*="hcaptcha"]',
    ],
    arkose: [
      '[data-arkose]',
      '.arkose-container',
      'iframe[src*="arkose"]',
      'script[src*="arkose"]',
    ],
    geetest: [
      '#geetest',
      '.geetest_holder',
      'iframe[src*="geetest"]',
      'script[src*="geetest"]',
    ],
    cloudflare: [
      '.cf-turnstile',
      '[data-sitekey*="cloudflare"]',
      'iframe[src*="challenges.cloudflare"]',
    ],
    funcaptcha: [
      '.funcaptcha-widget',
      '[data-public-key]',
      'iframe[src*="funcaptcha"]',
    ],
  };

  const detected: string[] = [];
  const selectors: string[] = [];

  for (const [provider, patterns] of Object.entries(captchaProviders)) {
    for (const pattern of patterns) {
      try {
        const elements = doc.querySelectorAll(pattern);
        if (elements.length > 0) {
          if (!detected.includes(provider)) {
            detected.push(provider);
          }
          if (!selectors.includes(pattern)) {
            selectors.push(pattern);
          }
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
  }

  return {
    hasCaptcha: detected.length > 0,
    providers: detected,
    selectors,
  };
}

/**
 * Detect MFA/2FA form presence and type
 */
function detectMFA(doc: Document): {
  hasMFA: boolean;
  type?: string;
  selector?: string;
} {
  const mfaPatterns: Record<string, string[]> = {
    totp: [
      'input[name*="code"]',
      'input[placeholder*="code"]',
      'input[placeholder*="OTP"]',
      'input[placeholder*="authenticator"]',
      'input[id*="totp"]',
      'input[id*="mfa-code"]',
      'input[name="mfa_code"]',
    ],
    sms: [
      'input[placeholder*="SMS"]',
      'input[placeholder*="text message"]',
      'input[name*="sms"]',
      'input[id*="sms-code"]',
      'button:contains("Send SMS")',
      'button:contains("text message")',
    ],
    email: [
      'input[placeholder*="email code"]',
      'input[name*="email"]',
      'input[id*="email-code"]',
      'button:contains("Send email")',
      'button:contains("email code")',
    ],
    push: [
      'button:contains("Send push")',
      'button:contains("approve")',
      '[class*="push"]',
      'input[placeholder*="approve"]',
      'button[aria-label*="approve"]',
    ],
    security_key: [
      'button:contains("security key")',
      'button:contains("use security key")',
      '[class*="security-key"]',
      '[class*="webauthn"]',
      'input[type="hidden"][name*="credential"]',
    ],
  };

  // Check for MFA indicators in page structure
  const pageText = doc.body?.textContent?.toLowerCase() || '';
  const mfaKeywords = [
    'two-factor',
    '2fa',
    '2-factor',
    'two factor',
    'mfa',
    'multi-factor',
    'authenticator',
    'verification code',
    'security code',
  ];

  let mfaPresent = false;
  for (const keyword of mfaKeywords) {
    if (pageText.includes(keyword)) {
      mfaPresent = true;
      break;
    }
  }

  if (!mfaPresent) {
    return { hasMFA: false };
  }

  // Detect MFA type
  for (const [type, patterns] of Object.entries(mfaPatterns)) {
    for (const pattern of patterns) {
      try {
        const elements = doc.querySelectorAll(pattern);
        if (elements.length > 0) {
          return {
            hasMFA: true,
            type,
            selector: pattern,
          };
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
  }

  return {
    hasMFA: true,
    type: 'unknown',
  };
}

/**
 * Common preset configurations for known sites
 */
export const FORM_PRESETS: Record<string, Partial<LoginFormConfig>> = {
  "shopify.com": {
    username_selector: 'input[name="account"]',
    password_selector: 'input[name="password"]',
    submit_selector: 'button[type="submit"]',
    success_selector: '[data-testid="polaris-skeleton"] > div',
  },
  "accounts.google.com": {
    username_selector: 'input[type="email"]',
    password_selector: 'input[type="password"]',
    submit_selector: '#signIn',
    success_selector: '[role="main"]',
  },
  "instagram.com": {
    username_selector: 'input[name="username"]',
    password_selector: 'input[name="password"]',
    submit_selector: 'button[type="submit"]',
    success_selector: 'a[href="/accounts/login/"]',
  },
  "twitter.com": {
    username_selector: 'input[placeholder="Phone, email, or username"]',
    password_selector: 'input[placeholder="Password"]',
    submit_selector: 'button[type="submit"]',
    success_selector: '[role="grid"]',
  },
  "amazon.com": {
    username_selector: '#ap_email',
    password_selector: '#ap_password',
    submit_selector: '#signInSubmit',
    success_selector: '[data-component-type="s-search-result"]',
  },
  "linkedin.com": {
    username_selector: '#username',
    password_selector: '#password',
    submit_selector: 'button[type="submit"]',
    success_selector: '[data-test-id="global-nav"]',
  },
};

/**
 * Get preset for a URL or scrape if not available
 */
export async function getFormConfig(url: string): Promise<Partial<LoginFormConfig>> {
  // Check if we have a preset
  for (const [domain, preset] of Object.entries(FORM_PRESETS)) {
    if (url.includes(domain)) {
      return preset;
    }
  }

  // Scrape the form
  const selectors = await scrapeFormSelectors({ url });
  return selectorsToFormConfig(url, selectors);
}
