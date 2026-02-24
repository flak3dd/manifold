// @ts-nocheck
// (Node.js types resolve after `npm install` — @types/node and @types/ws are in devDependencies)

// ── Manifold scraper — Playwright + WebSocket server ──
//
// Run with:  npx tsx scripts/scraper.ts
//
// The frontend connects to ws://localhost:8765 and sends scrape requests
// AND url_test requests.
// This script fulfils them using Playwright (with stealth) and sends results back.

import { WebSocketServer, WebSocket } from "ws";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WsScrapeRequest {
  type: "scrape";
  sourceId: string;
  url: string;
  selector: string;
}

interface WsPingMessage {
  type: "ping";
}

interface WsUrlTestRequest {
  type: "url_test";
  testId: string;
  url: string;
  username?: string;
  password?: string;
}

interface WsScrapeFormRequest {
  type: "scrape_form";
  requestId: string;
  url: string;
  timeout?: number;
}

type WsClientMessage =
  | WsScrapeRequest
  | WsPingMessage
  | WsUrlTestRequest
  | WsScrapeFormRequest;

interface UrlTestResult {
  name: string;
  status: "PASS" | "WARN" | "FAIL" | "INFO";
  detail: string;
  durationMs?: number;
}

interface UrlTestDetectedForm {
  action: string;
  method: string;
  fields: {
    tag: string;
    type: string;
    name: string;
    id: string;
    placeholder: string;
    required: boolean;
    autocomplete: string;
    label: string;
  }[];
  submitButtons: string[];
  formType: string;
  formIndex: number;
}

interface UrlTestLoginResult {
  attempted: boolean;
  navigatedToLogin: boolean;
  loginUrl?: string;
  usernameFieldFound: boolean;
  passwordFieldFound: boolean;
  submitButtonFound: boolean;
  submitted: boolean;
  postSubmitUrl?: string;
  outcomeGuess?: string;
  detail: string;
  screenshot?: string; // post-login
  /** Actual CSS selector the scraper resolved for the username/email field */
  usernameSelector?: string;
  /** Actual CSS selector the scraper resolved for the password field */
  passwordSelector?: string;
  /** Actual CSS selector the scraper resolved for the submit button */
  submitSelector?: string;

  // ── Extended login-flow detection ─────────────────────────────────
  /** Screenshot of the login form before credentials were submitted */
  preLoginScreenshot?: string;
  /** Page title after login attempt */
  postLoginPageTitle?: string;
  /** Whether the URL changed after submitting the form */
  urlChanged?: boolean;

  /** CSS selector for success indicators detected post-login */
  successSelector?: string;
  /** Human-readable list of success signals found */
  successSignals?: string[];

  /** CSS selector for failure / error indicators detected post-login */
  failureSelector?: string;
  /** Human-readable list of failure signals found */
  failureSignals?: string[];

  /** CSS selector for CAPTCHA elements detected on the login page */
  captchaSelector?: string;
  /** CAPTCHA provider names found on the login page */
  captchaProviders?: string[];

  /** CSS selector for a consent / cookie banner detected on the login page */
  consentSelector?: string;
  /** Whether a consent banner was auto-dismissed */
  consentDismissed?: boolean;

  /** CSS selector for a TOTP / 2FA input that appeared after login */
  totpSelector?: string;
  /** Whether the login flow is multi-step (username first, then password) */
  isMultiStep?: boolean;
  /** Detail about the multi-step flow if detected */
  multiStepDetail?: string;

  /** Rate-limit or lockout signals detected after submit */
  rateLimitSignals?: string[];
}

interface ScrapedFormSelectors {
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
  mfaType?:
    | "totp"
    | "sms"
    | "email"
    | "push"
    | "security_key"
    | "unknown";
  error?: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = 8765;
const MAX_BODY_LINES = 300;
const PAGE_TIMEOUT_MS = 30_000;
const URL_TEST_TIMEOUT_MS = 45_000;
const MAX_CONCURRENT = 4;

// ── Setup stealth ─────────────────────────────────────────────────────────────

chromium.use(StealthPlugin());

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(socket: WebSocket, msg: object): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function log(label: string, ...args: unknown[]): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 23);
  console.log(`[${ts}] [${label}]`, ...args);
}

function cleanLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) =>
      l
        .replace(/\t/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter((l) => l.length > 0);
}

// ── Core scrape function ──────────────────────────────────────────────────────

async function scrape(
  sourceId: string,
  url: string,
  selector: string,
  socket: WebSocket,
): Promise<void> {
  send(socket, { type: "status", sourceId, status: "scraping" });
  log("scrape", `START  ${url}  selector="${selector || "(none)"}"`);

  const t0 = Date.now();

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });

    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font", "stylesheet"].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS,
    });

    await page.waitForTimeout(800);

    let content: string[];

    if (selector.trim()) {
      content = await page.evaluate((sel: string) => {
        const elements = Array.from(document.querySelectorAll(sel));
        return elements
          .map(
            (el) =>
              (el as HTMLElement).innerText?.trim() ??
              el.textContent?.trim() ??
              "",
          )
          .filter((t) => t.length > 0);
      }, selector.trim());
    } else {
      const raw = await page.evaluate(() => {
        const cloned = document.body.cloneNode(true) as HTMLElement;
        cloned
          .querySelectorAll("script, style, noscript, svg")
          .forEach((n) => n.remove());
        return cloned.innerText ?? cloned.textContent ?? "";
      });
      content = cleanLines(raw).slice(0, MAX_BODY_LINES);
    }

    const durationMs = Date.now() - t0;
    log("scrape", `DONE   ${url}  ${content.length} lines  ${durationMs}ms`);

    send(socket, { type: "result", sourceId, content, durationMs });
  } catch (err: unknown) {
    const durationMs = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    log("scrape", `ERROR  ${url}  ${message}  ${durationMs}ms`);
    send(socket, { type: "error", sourceId, message });
  } finally {
    await browser.close();
  }
}

// ── URL Test runner ───────────────────────────────────────────────────────────

async function runUrlTest(
  testId: string,
  targetUrl: string,
  username: string | undefined,
  password: string | undefined,
  socket: WebSocket,
): Promise<void> {
  const allStart = Date.now();
  const results: UrlTestResult[] = [];
  const detectedForms: UrlTestDetectedForm[] = [];
  const screenshots: { desktop?: string; tablet?: string; mobile?: string } =
    {};
  const hasLogin = !!(username && password);
  const totalTests = hasLogin ? 15 : 14;
  let testIndex = 0;

  function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);
      p.then((v) => {
        clearTimeout(timer);
        resolve(v);
      }).catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  function progress(name: string, status: "running" | "done" = "running") {
    send(socket, {
      type: "url_test_progress",
      testId,
      testName: name,
      testIndex,
      totalTests,
      status,
    });
  }

  function pushResult(r: UrlTestResult) {
    results.push(r);
    send(socket, { type: "url_test_result", testId, result: r });
  }

  function finalize() {
    const summary = { pass: 0, warn: 0, fail: 0, info: 0 };
    for (const r of results) {
      if (r.status === "PASS") summary.pass++;
      else if (r.status === "WARN") summary.warn++;
      else if (r.status === "FAIL") summary.fail++;
      else summary.info++;
    }
    const overallStatus =
      summary.fail > 0 ? "FAIL" : summary.warn > 3 ? "WARN" : "PASS";
    const durationMs = Date.now() - allStart;
    log(
      "url_test",
      `DONE  testId=${testId}  ${summary.pass}P/${summary.warn}W/${summary.fail}F/${summary.info}I  ${durationMs}ms`,
    );
    send(socket, {
      type: "url_test_complete",
      testId,
      summary,
      overallStatus,
      durationMs,
      screenshots,
    });
  }

  log(
    "url_test",
    `START  testId=${testId}  url=${targetUrl}  login=${hasLogin}`,
  );

  let browser: any = null;
  try {
    // If Playwright is missing / cannot launch, we want to fail fast and send
    // a url_test_error instead of hanging forever (no UI progress).
    testIndex = 0;
    progress("Starting headless browser");

    browser = await withTimeout(
      chromium.launch({
        headless: true,
        // Playwright supports a launch timeout, but this extra guard protects
        // against any edge-case hangs.
        timeout: URL_TEST_TIMEOUT_MS,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1440,900",
        ],
      }),
      URL_TEST_TIMEOUT_MS,
      "Browser launch",
    );
    progress("Starting headless browser", "done");

    const context = await withTimeout(
      browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
      locale: "en-AU",
      timezoneId: "Australia/Sydney",
      colorScheme: "light",
      ignoreHTTPSErrors: false,
      extraHTTPHeaders: { "Accept-Language": "en-AU,en;q=0.9" },
      }),
      URL_TEST_TIMEOUT_MS,
      "Browser context init",
    );

    const page = await withTimeout(
      context.newPage(),
      URL_TEST_TIMEOUT_MS,
      "New page",
    );
    // Ensure any future waits can't hang forever.
    page.setDefaultTimeout(URL_TEST_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(URL_TEST_TIMEOUT_MS);

    const networkRequests: {
      url: string;
      resourceType: string;
      status?: number;
      failed?: boolean;
    }[] = [];
    const consoleMessages: { type: string; text: string }[] = [];

    page.on("request", (req) => {
      networkRequests.push({
        url: req.url(),
        resourceType: req.resourceType(),
      });
    });
    page.on("response", (res) => {
      const entry = networkRequests.find(
        (r) => r.url === res.url() && !r.status,
      );
      if (entry) entry.status = res.status();
    });
    page.on("requestfailed", (req) => {
      const entry = networkRequests.find(
        (r) => r.url === req.url() && !r.status && !r.failed,
      );
      if (entry) entry.failed = true;
    });
    page.on("console", (msg) => {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    });

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 1: Page Load & Reachability
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 0;
    progress("Page Load & Reachability");
    let pageLoadOk = false;
    {
      const t0 = Date.now();
      try {
        const response = await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: URL_TEST_TIMEOUT_MS,
        });
        const elapsed = Date.now() - t0;
        const status = response?.status() ?? 0;
        const statusText = response?.statusText() ?? "unknown";
        if (status >= 200 && status < 400) {
          pageLoadOk = true;
          pushResult({
            name: "Page Load",
            status: elapsed > 10_000 ? "WARN" : "PASS",
            detail: `HTTP ${status} ${statusText} in ${elapsed}ms`,
            durationMs: elapsed,
          });
        } else {
          pushResult({
            name: "Page Load",
            status: "FAIL",
            detail: `HTTP ${status} ${statusText} in ${elapsed}ms`,
            durationMs: elapsed,
          });
        }
        await page.waitForTimeout(3000);
      } catch (e) {
        const elapsed = Date.now() - t0;
        pushResult({
          name: "Page Load",
          status: "FAIL",
          detail: `Failed: ${String(e).slice(0, 300)}`,
          durationMs: elapsed,
        });
      }
    }
    progress("Page Load & Reachability", "done");

    if (!pageLoadOk) {
      finalize();
      return;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 2: SSL & Security Headers
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 1;
    progress("SSL & Security Headers");
    {
      try {
        const resp = await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: URL_TEST_TIMEOUT_MS,
        });
        const headers = resp?.headers() ?? {};
        const secHeaders: Record<string, string | undefined> = {
          "content-security-policy": headers["content-security-policy"],
          "strict-transport-security": headers["strict-transport-security"],
          "x-frame-options": headers["x-frame-options"],
          "x-content-type-options": headers["x-content-type-options"],
          "x-xss-protection": headers["x-xss-protection"],
          "referrer-policy": headers["referrer-policy"],
        };
        const present = Object.entries(secHeaders).filter(([, v]) => v);
        const missing = Object.entries(secHeaders)
          .filter(([, v]) => !v)
          .map(([k]) => k);
        const isHttps = targetUrl.startsWith("https://");
        pushResult({
          name: "SSL/HTTPS",
          status: isHttps ? "PASS" : "WARN",
          detail: isHttps
            ? "Site served over HTTPS"
            : "Site NOT served over HTTPS",
        });
        pushResult({
          name: "Security Headers",
          status:
            present.length >= 3
              ? "PASS"
              : present.length >= 1
                ? "WARN"
                : "INFO",
          detail: `Present: ${present.map(([k]) => k).join(", ") || "none"} | Missing: ${missing.join(", ") || "none"}`,
        });
      } catch (e) {
        pushResult({
          name: "Security Headers",
          status: "WARN",
          detail: `Could not fetch headers: ${String(e).slice(0, 200)}`,
        });
      }
    }
    progress("SSL & Security Headers", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 3: WAF / Bot Protection / CAPTCHA
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 2;
    progress("WAF / Bot Protection / CAPTCHA");
    {
      const t0 = Date.now();
      const detection = await page.evaluate(() => {
        const html = document.documentElement.innerHTML.toLowerCase();
        const bodyText = (document.body?.innerText || "").toLowerCase();
        const captchaProviders: string[] = [];
        if (html.includes("recaptcha") || html.includes("grecaptcha"))
          captchaProviders.push("reCAPTCHA");
        if (html.includes("hcaptcha")) captchaProviders.push("hCaptcha");
        if (html.includes("cf-turnstile") || html.includes("turnstile"))
          captchaProviders.push("Cloudflare Turnstile");
        if (html.includes("funcaptcha") || html.includes("arkoselabs"))
          captchaProviders.push("FunCaptcha/Arkose");
        if (html.includes("geetest")) captchaProviders.push("GeeTest");
        const wafSignals: string[] = [];
        if (html.includes("cloudflare") || html.includes("cf-ray"))
          wafSignals.push("Cloudflare");
        if (html.includes("akamai") || html.includes("_abck"))
          wafSignals.push("Akamai");
        if (html.includes("imperva") || html.includes("incapsula"))
          wafSignals.push("Imperva/Incapsula");
        if (html.includes("datadome")) wafSignals.push("DataDome");
        if (html.includes("perimeterx") || html.includes("px-captcha"))
          wafSignals.push("PerimeterX");
        const botDetection: string[] = [];
        if (html.includes("fingerprintjs") || html.includes("fpjs"))
          botDetection.push("FingerprintJS");
        if (html.includes("bot-detect") || html.includes("botdetect"))
          botDetection.push("BotDetect");
        if (html.includes("distil") || html.includes("distilnetworks"))
          botDetection.push("Distil Networks");
        const isChallengePage =
          bodyText.includes("checking your browser") ||
          bodyText.includes("just a moment") ||
          bodyText.includes("verifying you are human") ||
          bodyText.includes("access denied") ||
          bodyText.includes("error 1020") ||
          bodyText.includes("403 forbidden");
        return { captchaProviders, wafSignals, botDetection, isChallengePage };
      });
      const elapsed = Date.now() - t0;
      pushResult({
        name: "CAPTCHA Detection",
        status: detection.captchaProviders.length > 0 ? "WARN" : "PASS",
        detail:
          detection.captchaProviders.length > 0
            ? `Detected: ${detection.captchaProviders.join(", ")}`
            : "No CAPTCHA providers detected",
        durationMs: elapsed,
      });
      pushResult({
        name: "WAF Detection",
        status: detection.wafSignals.length > 0 ? "INFO" : "PASS",
        detail:
          detection.wafSignals.length > 0
            ? `Signals: ${detection.wafSignals.join(", ")}`
            : "No WAF signals detected",
      });
      pushResult({
        name: "Bot Detection Libraries",
        status: detection.botDetection.length > 0 ? "WARN" : "PASS",
        detail:
          detection.botDetection.length > 0
            ? `Detected: ${detection.botDetection.join(", ")}`
            : "No bot detection libraries found",
      });
      pushResult({
        name: "Challenge Page",
        status: detection.isChallengePage ? "FAIL" : "PASS",
        detail: detection.isChallengePage
          ? "Page appears to be a bot challenge / block page"
          : "No challenge page detected \u2014 site loaded normally",
      });
    }
    progress("WAF / Bot Protection / CAPTCHA", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 4: Form Detection & Field Inventory
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 3;
    progress("Form Detection & Field Inventory");
    {
      const t0 = Date.now();
      const forms: UrlTestDetectedForm[] = await page.evaluate(() => {
        const allForms = Array.from(document.querySelectorAll("form"));
        return allForms.map((form, i) => {
          const inputs = Array.from(
            form.querySelectorAll("input, select, textarea"),
          );
          const fields = inputs.map((el) => {
            const input = el as HTMLInputElement;
            let labelText = "";
            if (input.id) {
              const lbl = document.querySelector(`label[for="${input.id}"]`);
              if (lbl) labelText = (lbl as HTMLElement).innerText?.trim() || "";
            }
            if (!labelText) {
              const parent = input.closest("label");
              if (parent)
                labelText =
                  (parent as HTMLElement).innerText?.trim().split("\n")[0] ||
                  "";
            }
            return {
              tag: el.tagName.toLowerCase(),
              type: input.type || "text",
              name: input.name || "",
              id: input.id || "",
              placeholder: input.placeholder || "",
              required:
                input.required ||
                input.getAttribute("aria-required") === "true",
              autocomplete: input.autocomplete || "",
              label: labelText.slice(0, 80),
            };
          });
          const buttons = Array.from(
            form.querySelectorAll(
              'button, input[type="submit"], [role="button"]',
            ),
          );
          const submitButtons = buttons.map(
            (b) =>
              (b as HTMLElement).innerText?.trim() ||
              (b as HTMLInputElement).value ||
              b.getAttribute("aria-label") ||
              "unknown",
          );
          const fieldText = fields
            .map((f) =>
              `${f.name} ${f.id} ${f.placeholder} ${f.label} ${f.autocomplete}`.toLowerCase(),
            )
            .join(" ");
          const hasEmail =
            fieldText.includes("email") || fieldText.includes("e-mail");
          const hasPassword =
            fieldText.includes("password") ||
            fieldText.includes("pin") ||
            fields.some((f) => f.type === "password");
          const hasName =
            fieldText.includes("first") ||
            fieldText.includes("last") ||
            fieldText.includes("name");
          const hasDob =
            fieldText.includes("birth") || fieldText.includes("dob");
          const hasPhone =
            fieldText.includes("phone") ||
            fieldText.includes("mobile") ||
            fieldText.includes("tel");
          const isReg =
            hasEmail && hasPassword && (hasName || hasDob || hasPhone);
          const isLogin =
            hasEmail && hasPassword && !hasName && !hasDob && !hasPhone;
          const formType = isReg
            ? "REGISTRATION"
            : isLogin
              ? "LOGIN"
              : "UNKNOWN";
          return {
            action: form.action || "",
            method: (form.method || "GET").toUpperCase(),
            fields,
            submitButtons,
            formType,
            formIndex: i,
          };
        });
      });
      const elapsed = Date.now() - t0;

      if (forms.length === 0) {
        pushResult({
          name: "Form Detection",
          status: "WARN",
          detail: "No <form> elements found on page",
          durationMs: elapsed,
        });
      } else {
        pushResult({
          name: "Form Detection",
          status: "PASS",
          detail: `Found ${forms.length} form(s) on page`,
          durationMs: elapsed,
        });
        for (const form of forms) {
          const fieldSummary = form.fields
            .map(
              (f) => `${f.type}[name=${f.name || "?"}]${f.required ? "*" : ""}`,
            )
            .join(", ");
          pushResult({
            name: `Form #${form.formIndex} (${form.formType})`,
            status: "INFO",
            detail: `Method: ${form.method} | Fields: ${form.fields.length} | Submits: [${form.submitButtons.join(", ")}] | ${fieldSummary}`,
          });
          if (form.formType === "REGISTRATION") {
            const ft = form.fields
              .map((f) =>
                `${f.name} ${f.id} ${f.placeholder} ${f.label} ${f.autocomplete}`.toLowerCase(),
              )
              .join(" ");
            const parts: string[] = [];
            if (ft.includes("name") || ft.includes("first"))
              parts.push("Name \u2713");
            if (ft.includes("birth") || ft.includes("dob"))
              parts.push("DOB \u2713");
            if (ft.includes("email")) parts.push("Email \u2713");
            if (
              ft.includes("password") ||
              ft.includes("pin") ||
              form.fields.some((f) => f.type === "password")
            )
              parts.push("Password/PIN \u2713");
            if (ft.includes("phone") || ft.includes("mobile"))
              parts.push("Phone \u2713");
            if (ft.includes("postal") || ft.includes("zip"))
              parts.push("Postal \u2713");
            const reqCount = form.fields.filter((f) => f.required).length;
            pushResult({
              name: "Registration Form Analysis",
              status: "PASS",
              detail: `Detected: ${parts.join(" | ")} | Required: ${reqCount}/${form.fields.length} fields`,
            });
          }
        }
        detectedForms.push(...forms);
        send(socket, { type: "url_test_forms", testId, forms });
      }
    }
    progress("Form Detection & Field Inventory", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 5: Standalone Input Detection
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 4;
    progress("Standalone Input Detection");
    {
      const standaloneInputs = await page.evaluate(() => {
        const allInputs = Array.from(
          document.querySelectorAll("input, select, textarea"),
        );
        const formInputs = Array.from(
          document.querySelectorAll("form input, form select, form textarea"),
        );
        return {
          total: allInputs.length,
          inForms: formInputs.length,
          standalone: allInputs.length - formInputs.length,
        };
      });
      pushResult({
        name: "Input Elements",
        status: "INFO",
        detail: `Total: ${standaloneInputs.total} | In forms: ${standaloneInputs.inForms} | Standalone: ${standaloneInputs.standalone}`,
      });
    }
    progress("Standalone Input Detection", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 6: Navigation & SPA Detection
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 5;
    progress("Navigation & SPA Detection");
    {
      const navData = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const scripts = Array.from(
          document.querySelectorAll("script[src]"),
        ).map((s) => (s as HTMLScriptElement).src);
        const isSPA =
          !!document.querySelector(
            "[data-reactroot], #__next, #__nuxt, #app[data-v-], [data-svelte]",
          ) ||
          html.includes("__NEXT_DATA__") ||
          html.includes("__NUXT__") ||
          scripts.some((s) => /react|vue|angular|svelte|next|nuxt/i.test(s));
        const framework: string[] = [];
        if (
          html.includes("__NEXT_DATA__") ||
          scripts.some((s) => /next/i.test(s))
        )
          framework.push("Next.js");
        if (html.includes("__NUXT__") || scripts.some((s) => /nuxt/i.test(s)))
          framework.push("Nuxt");
        if (
          scripts.some((s) => /react/i.test(s)) ||
          document.querySelector("[data-reactroot]")
        )
          framework.push("React");
        if (scripts.some((s) => /vue/i.test(s)) || html.includes("data-v-"))
          framework.push("Vue");
        if (scripts.some((s) => /angular/i.test(s))) framework.push("Angular");
        if (
          scripts.some((s) => /svelte/i.test(s)) ||
          document.querySelector("[data-svelte]")
        )
          framework.push("Svelte");
        const links = Array.from(document.querySelectorAll("a[href]"))
          .map((a) => ({
            text: (a as HTMLAnchorElement).innerText?.trim().slice(0, 50) || "",
            href: (a as HTMLAnchorElement).href,
          }))
          .filter((l) => l.text.length > 0);
        const navLinks = links.filter((l) =>
          /login|sign.?in|register|sign.?up|join|account|log.?in|create/i.test(
            l.text,
          ),
        );
        return {
          isSPA,
          framework:
            framework.length > 0
              ? framework.join(", ")
              : "None detected / Server-rendered",
          totalLinks: links.length,
          navLinks,
          externalScripts: scripts.length,
        };
      });
      pushResult({
        name: "SPA Detection",
        status: "INFO",
        detail: `SPA: ${navData.isSPA ? "Yes" : "No"} | Framework: ${navData.framework}`,
      });
      pushResult({
        name: "Page Links",
        status: navData.totalLinks > 0 ? "PASS" : "WARN",
        detail: `Total: ${navData.totalLinks} | External scripts: ${navData.externalScripts}`,
      });
      if (navData.navLinks.length > 0) {
        const linkInfo = navData.navLinks
          .map((l: any) => `"${l.text}" -> ${l.href}`)
          .join(" | ");
        pushResult({
          name: "Auth-Related Links",
          status: "PASS",
          detail: linkInfo,
        });
      } else {
        pushResult({
          name: "Auth-Related Links",
          status: "INFO",
          detail: "No login/register/join links found in page anchors",
        });
      }
    }
    progress("Navigation & SPA Detection", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 7: Cookies & Trackers
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 6;
    progress("Cookies & Trackers");
    {
      const cookies = await context.cookies();
      const cookieNames = cookies.map((c: any) => c.name as string);
      const trackerPatterns: { name: string; pattern: RegExp }[] = [
        { name: "Google Analytics", pattern: /^_ga|^_gid|^_gat/i },
        { name: "Google Tag Manager", pattern: /^_gcl|^_gtm/i },
        { name: "Facebook Pixel", pattern: /^_fbp|^_fbc/i },
        { name: "Hotjar", pattern: /^_hj/i },
        { name: "Cloudflare", pattern: /^__cf|^cf_/i },
        { name: "Session", pattern: /sess|session|PHPSESSID|JSESSIONID/i },
      ];
      const detectedTrackers: string[] = [];
      for (const { name, pattern } of trackerPatterns) {
        if (cookieNames.some((cn: string) => pattern.test(cn)))
          detectedTrackers.push(name);
      }
      pushResult({
        name: "Cookies",
        status: "INFO",
        detail: `Total: ${cookies.length} | Names: ${cookieNames.slice(0, 15).join(", ")}${cookies.length > 15 ? " (+" + (cookies.length - 15) + " more)" : ""}`,
      });
      pushResult({
        name: "Trackers Detected",
        status: "INFO",
        detail:
          detectedTrackers.length > 0
            ? detectedTrackers.join(", ")
            : "None identified",
      });
    }
    progress("Cookies & Trackers", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 8: Page Content & Key Elements
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 7;
    progress("Page Content & Key Elements");
    {
      const content = await page.evaluate(() => {
        const title = document.title || "";
        const metaDesc =
          (
            document.querySelector(
              'meta[name="description"]',
            ) as HTMLMetaElement
          )?.content || "";
        const h1s = Array.from(document.querySelectorAll("h1")).map((h) =>
          (h as HTMLElement).innerText?.trim().slice(0, 100),
        );
        const images = document.querySelectorAll("img").length;
        const bodyLength = document.body?.innerText?.length || 0;
        return { title, metaDesc, h1s, images, bodyLength };
      });
      pushResult({
        name: "Page Title",
        status: content.title ? "PASS" : "WARN",
        detail: content.title || "(empty)",
      });
      pushResult({
        name: "Meta Description",
        status: content.metaDesc ? "PASS" : "INFO",
        detail: content.metaDesc ? content.metaDesc.slice(0, 150) : "(not set)",
      });
      if (content.h1s.length > 0) {
        pushResult({
          name: "H1 Headings",
          status: "INFO",
          detail: content.h1s.join(" | "),
        });
      }
      pushResult({
        name: "Media Assets",
        status: "INFO",
        detail: `Images: ${content.images}`,
      });
      pushResult({
        name: "Body Content",
        status: content.bodyLength > 500 ? "PASS" : "WARN",
        detail: `${content.bodyLength.toLocaleString()} characters of visible text`,
      });
    }
    progress("Page Content & Key Elements", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 9: Network Analysis
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 8;
    progress("Network Analysis");
    {
      const totalReqs = networkRequests.length;
      const failedReqs = networkRequests.filter((r) => r.failed);
      const byType: Record<string, number> = {};
      for (const r of networkRequests) {
        byType[r.resourceType] = (byType[r.resourceType] || 0) + 1;
      }
      const typeBreakdown = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `${t}:${c}`)
        .join(", ");
      pushResult({
        name: "Network Requests",
        status: failedReqs.length > 10 ? "WARN" : "PASS",
        detail: `Total: ${totalReqs} | Failed: ${failedReqs.length} | ${typeBreakdown}`,
      });
      const targetHost = new URL(targetUrl).hostname;
      const thirdParty = new Set<string>();
      for (const r of networkRequests) {
        try {
          const host = new URL(r.url).hostname;
          if (host !== targetHost && !host.endsWith("." + targetHost)) {
            thirdParty.add(host);
          }
        } catch {
          /* skip */
        }
      }
      const tpList = Array.from(thirdParty).sort();
      pushResult({
        name: "Third-Party Domains",
        status: "INFO",
        detail: `${tpList.length} domain(s): ${tpList.slice(0, 10).join(", ")}${tpList.length > 10 ? " (+" + (tpList.length - 10) + " more)" : ""}`,
      });
    }
    progress("Network Analysis", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 10: Console Errors
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 9;
    progress("Console Errors");
    {
      const errors = consoleMessages.filter((m) => m.type === "error");
      const warnings = consoleMessages.filter((m) => m.type === "warning");
      pushResult({
        name: "Console Errors",
        status:
          errors.length > 5 ? "WARN" : errors.length > 0 ? "INFO" : "PASS",
        detail: `Errors: ${errors.length} | Warnings: ${warnings.length} | Total: ${consoleMessages.length}`,
      });
      if (errors.length > 0) {
        pushResult({
          name: "Top Console Errors",
          status: "INFO",
          detail: errors
            .slice(0, 3)
            .map((e) => e.text.slice(0, 120))
            .join(" || "),
        });
      }
    }
    progress("Console Errors", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 11: Bot-Detection Evasion Check
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 10;
    progress("Bot-Detection Evasion Check");
    {
      const evasion = await page.evaluate(() => {
        const nav = navigator as any;
        return {
          webdriver: nav.webdriver,
          platform: nav.platform,
          hardwareConcurrency: nav.hardwareConcurrency,
          deviceMemory: nav.deviceMemory,
          languages: nav.languages ? Array.from(nav.languages) : [],
          maxTouchPoints: nav.maxTouchPoints,
          hasChromiumAutomation: !!(window as any)
            .cdc_adoQpoasnfa76pfcZLmcfl_Array,
          hasPlaywrightBinding:
            typeof (window as any).__playwright !== "undefined",
        };
      });
      pushResult({
        name: "navigator.webdriver",
        status:
          evasion.webdriver === false || evasion.webdriver === undefined
            ? "PASS"
            : "WARN",
        detail: `webdriver=${evasion.webdriver}`,
      });
      pushResult({
        name: "Stealth Fingerprint",
        status: "INFO",
        detail: `platform=${evasion.platform} | cores=${evasion.hardwareConcurrency} | memory=${evasion.deviceMemory}GB | languages=${(evasion.languages as string[]).join(",")} | touchPoints=${evasion.maxTouchPoints}`,
      });
      pushResult({
        name: "Automation Markers",
        status:
          !evasion.hasChromiumAutomation && !evasion.hasPlaywrightBinding
            ? "PASS"
            : "FAIL",
        detail: `Chromium CDC: ${evasion.hasChromiumAutomation} | Playwright binding: ${evasion.hasPlaywrightBinding}`,
      });
    }
    progress("Bot-Detection Evasion Check", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 12: Screenshots (Desktop, Tablet, Mobile)
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 11;
    progress("Screenshots");
    {
      const viewports = [
        { label: "desktop" as const, width: 1440, height: 900 },
        { label: "tablet" as const, width: 768, height: 1024 },
        { label: "mobile" as const, width: 375, height: 812 },
      ];
      let captured = 0;
      for (const vp of viewports) {
        try {
          await page.setViewportSize({
            width: vp.width,
            height: vp.height,
          });
          await page.waitForTimeout(400);
          const buf = await page.screenshot({ fullPage: false });
          screenshots[vp.label] = buf.toString("base64");
          captured++;
        } catch {
          /* skip */
        }
      }
      pushResult({
        name: "Screenshots",
        status: captured === viewports.length ? "PASS" : "WARN",
        detail: `Captured ${captured}/${viewports.length} viewports`,
      });
    }
    progress("Screenshots", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 13: Login Page Navigation Check
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 12;
    progress("Login Page Navigation");
    {
      await page.setViewportSize({ width: 1440, height: 900 });
      const loginSelector = await page.evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll("a, button, [role='button'], span"),
        );
        for (const el of candidates) {
          const text = ((el as HTMLElement).innerText || "")
            .trim()
            .toLowerCase();
          if (/^(log\s*in|sign\s*in|login)$/i.test(text)) {
            if ((el as HTMLElement).id) return "#" + (el as HTMLElement).id;
            if (
              el.tagName === "A" &&
              (el as HTMLAnchorElement).getAttribute("href")
            )
              return (
                'a[href="' +
                (el as HTMLAnchorElement).getAttribute("href") +
                '"]'
              );
            return null;
          }
        }
        return null;
      });
      if (loginSelector) {
        try {
          const t0 = Date.now();
          await page.click(loginSelector, { timeout: 10000 });
          await page.waitForTimeout(4000);
          const elapsed = Date.now() - t0;
          const newUrl = page.url();
          pushResult({
            name: "Login Navigation",
            status: "PASS",
            detail: `Clicked login link -> ${newUrl} (${elapsed}ms)`,
            durationMs: elapsed,
          });
          const hasLoginForm = await page.evaluate(() => {
            return (
              document.querySelectorAll('input[type="password"]').length > 0
            );
          });
          pushResult({
            name: "Login Form Present",
            status: hasLoginForm ? "PASS" : "INFO",
            detail: hasLoginForm
              ? "Password field detected on login page"
              : "No password field found after login click",
          });
          await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: URL_TEST_TIMEOUT_MS,
          });
          await page.waitForTimeout(4000);
        } catch (e) {
          pushResult({
            name: "Login Navigation",
            status: "WARN",
            detail: `Could not click login link: ${String(e).slice(0, 200)}`,
          });
        }
      } else {
        pushResult({
          name: "Login Navigation",
          status: "INFO",
          detail:
            "No distinct login link/button found (registration form may be inline on homepage)",
        });
      }
    }
    progress("Login Page Navigation", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 14: JavaScript Execution & Page Interactivity
    // ══════════════════════════════════════════════════════════════════════
    testIndex = 13;
    progress("JS Execution & Interactivity");
    {
      const jsCheck = await page.evaluate(() => {
        try {
          const mathOk = Math.random() >= 0;
          const dateOk = new Date().getTime() > 0;
          const jsonOk = JSON.parse('{"ok":true}').ok === true;
          const testDiv = document.createElement("div");
          testDiv.id = "__manifold_test__";
          testDiv.style.display = "none";
          document.body.appendChild(testDiv);
          const domOk = !!document.getElementById("__manifold_test__");
          testDiv.remove();
          let storageOk = false;
          try {
            localStorage.setItem("__manifold_test__", "1");
            storageOk = localStorage.getItem("__manifold_test__") === "1";
            localStorage.removeItem("__manifold_test__");
          } catch {
            storageOk = false;
          }
          const fetchOk = typeof fetch === "function";
          const wsOk = typeof WebSocket === "function";
          return { mathOk, dateOk, jsonOk, domOk, storageOk, fetchOk, wsOk };
        } catch (e) {
          return { error: String(e) };
        }
      });
      if ("error" in jsCheck) {
        pushResult({
          name: "JS Execution",
          status: "FAIL",
          detail: `Error: ${(jsCheck as any).error}`,
        });
      } else {
        const checks = jsCheck as Record<string, boolean>;
        const allOk = Object.values(checks).every(Boolean);
        const details = Object.entries(checks)
          .map(([k, v]) => `${k}:${v ? "\u2713" : "\u2717"}`)
          .join(" ");
        pushResult({
          name: "JS Execution",
          status: allOk ? "PASS" : "WARN",
          detail: details,
        });
      }
    }
    progress("JS Execution & Interactivity", "done");

    // ══════════════════════════════════════════════════════════════════════
    //  TEST 15 (Optional): Live Login Test
    // ══════════════════════════════════════════════════════════════════════
    if (hasLogin) {
      testIndex = 14;
      progress("Live Login Test");
      const loginResult: UrlTestLoginResult = {
        attempted: true,
        navigatedToLogin: false,
        usernameFieldFound: false,
        passwordFieldFound: false,
        submitButtonFound: false,
        submitted: false,
        detail: "",
      };

      try {
        // Try to find the login page — either already on it or navigate via link
        let onLoginPage = false;

        // Check if current page has a password field already
        const hasPasswordOnCurrent = await page.evaluate(() => {
          return document.querySelectorAll('input[type="password"]').length > 0;
        });

        if (hasPasswordOnCurrent) {
          onLoginPage = true;
          loginResult.navigatedToLogin = true;
          loginResult.loginUrl = page.url();
        } else {
          // Look for login link and click it
          const loginLink = await page.evaluate(() => {
            const candidates = Array.from(
              document.querySelectorAll("a, button, [role='button'], span"),
            );
            for (const el of candidates) {
              const text = ((el as HTMLElement).innerText || "")
                .trim()
                .toLowerCase();
              if (/^(log\s*in|sign\s*in|login)$/i.test(text)) {
                if ((el as HTMLElement).id) return "#" + (el as HTMLElement).id;
                if (
                  el.tagName === "A" &&
                  (el as HTMLAnchorElement).getAttribute("href")
                )
                  return (
                    'a[href="' +
                    (el as HTMLAnchorElement).getAttribute("href") +
                    '"]'
                  );
              }
            }
            return null;
          });

          if (loginLink) {
            await page.click(loginLink, { timeout: 10000 });
            await page.waitForTimeout(5000);
            loginResult.navigatedToLogin = true;
            loginResult.loginUrl = page.url();
            onLoginPage = true;
          }
        }

        if (!onLoginPage) {
          loginResult.detail = "Could not find or navigate to login page";
          pushResult({
            name: "Live Login Test",
            status: "WARN",
            detail: loginResult.detail,
          });
        } else {
          // ── Detect consent / cookie banners on the login page ────────
          const consentDetection = await page.evaluate(() => {
            const selectors = [
              // Common cookie consent button selectors
              '[id*="cookie"] button[class*="accept"]',
              '[id*="cookie"] button[class*="agree"]',
              '[class*="cookie"] button[class*="accept"]',
              '[class*="cookie"] button[class*="agree"]',
              '[id*="consent"] button',
              '[class*="consent"] button[class*="accept"]',
              '[class*="consent"] button[class*="agree"]',
              'button[id*="accept-cookie"]',
              'button[id*="acceptCookie"]',
              "#onetrust-accept-btn-handler",
              ".onetrust-close-btn-handler",
              "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
              '[data-cookiefirst-action="accept"]',
              "#cookie-accept",
              ".cookie-accept",
              ".js-cookie-accept",
              "#gdpr-accept",
              ".gdpr-accept",
              // Generic "accept all" / "I agree" buttons
              'button[class*="accept-all"]',
              'button[class*="acceptAll"]',
            ];
            // Also look for buttons by text content
            const allButtons = Array.from(
              document.querySelectorAll("button, a.btn, [role='button']"),
            );
            const textMatches = allButtons.filter((btn) => {
              const text = ((btn as HTMLElement).innerText || "")
                .trim()
                .toLowerCase();
              return (
                /^(accept(\s+all)?|i agree|agree|got it|allow(\s+all)?|ok(ay)?|dismiss)$/i.test(
                  text,
                ) &&
                // must be visible
                (btn as HTMLElement).offsetParent !== null
              );
            });

            let foundSelector: string | null = null;
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && (el as HTMLElement).offsetParent !== null) {
                foundSelector = sel;
                break;
              }
            }
            if (!foundSelector && textMatches.length > 0) {
              const btn = textMatches[0] as HTMLElement;
              if (btn.id) foundSelector = "#" + btn.id;
              else if (btn.className) {
                const cls = btn.className
                  .toString()
                  .split(/\s+/)
                  .filter((c) => c.length > 0 && c.length < 40)[0];
                if (cls) foundSelector = "." + cls;
              }
            }

            // Also detect the banner container itself
            const bannerSelectors = [
              "#onetrust-banner-sdk",
              "#CybotCookiebotDialog",
              '[class*="cookie-banner"]',
              '[class*="cookieBanner"]',
              '[id*="cookie-banner"]',
              '[class*="consent-banner"]',
              '[class*="gdpr"]',
              '[id*="gdpr"]',
            ];
            let hasBanner = false;
            for (const sel of bannerSelectors) {
              const el = document.querySelector(sel);
              if (el && (el as HTMLElement).offsetParent !== null) {
                hasBanner = true;
                break;
              }
            }
            if (!hasBanner && textMatches.length > 0) hasBanner = true;

            return { selector: foundSelector, hasBanner };
          });

          if (consentDetection.selector) {
            loginResult.consentSelector = consentDetection.selector;
            // Try to auto-dismiss
            try {
              await page.click(consentDetection.selector, { timeout: 5000 });
              await page.waitForTimeout(1500);
              loginResult.consentDismissed = true;
              pushResult({
                name: "Login: Consent Banner",
                status: "INFO",
                detail: `Dismissed consent banner via ${consentDetection.selector}`,
              });
            } catch {
              loginResult.consentDismissed = false;
              pushResult({
                name: "Login: Consent Banner",
                status: "WARN",
                detail: `Consent banner detected (${consentDetection.selector}) but could not dismiss`,
              });
            }
          } else if (consentDetection.hasBanner) {
            pushResult({
              name: "Login: Consent Banner",
              status: "WARN",
              detail:
                "Cookie/consent banner detected but no dismiss button found",
            });
          }

          // ── Detect CAPTCHA on the login page ────────────────────────
          const loginPageCaptcha = await page.evaluate(() => {
            const html = document.documentElement.innerHTML.toLowerCase();
            const providers: string[] = [];
            const selectors: string[] = [];

            if (html.includes("recaptcha") || html.includes("grecaptcha")) {
              providers.push("reCAPTCHA");
              if (document.querySelector(".g-recaptcha"))
                selectors.push(".g-recaptcha");
              if (document.querySelector("[data-sitekey]"))
                selectors.push("[data-sitekey]");
              if (document.querySelector("#recaptcha"))
                selectors.push("#recaptcha");
            }
            if (html.includes("hcaptcha")) {
              providers.push("hCaptcha");
              if (document.querySelector(".h-captcha"))
                selectors.push(".h-captcha");
            }
            if (html.includes("cf-turnstile") || html.includes("turnstile")) {
              providers.push("Cloudflare Turnstile");
              if (document.querySelector(".cf-turnstile"))
                selectors.push(".cf-turnstile");
            }
            if (html.includes("funcaptcha") || html.includes("arkoselabs")) {
              providers.push("FunCaptcha/Arkose");
              if (document.querySelector("#FunCaptcha"))
                selectors.push("#FunCaptcha");
            }
            if (html.includes("geetest")) {
              providers.push("GeeTest");
              if (document.querySelector(".geetest_holder"))
                selectors.push(".geetest_holder");
            }

            return {
              providers,
              selector: selectors.length > 0 ? selectors.join(", ") : null,
            };
          });

          if (loginPageCaptcha.providers.length > 0) {
            loginResult.captchaProviders = loginPageCaptcha.providers;
            loginResult.captchaSelector =
              loginPageCaptcha.selector ?? undefined;
            pushResult({
              name: "Login: CAPTCHA",
              status: "WARN",
              detail: `CAPTCHA on login page: ${loginPageCaptcha.providers.join(", ")}${loginPageCaptcha.selector ? ` (${loginPageCaptcha.selector})` : ""}`,
            });
          }

          // ── Detect multi-step login (username first, no password visible) ─
          const multiStepCheck = await page.evaluate(() => {
            const pwFields = document.querySelectorAll(
              'input[type="password"]',
            );
            const emailFields = document.querySelectorAll(
              'input[type="email"], input[autocomplete="username"], input[autocomplete="email"], input[type="text"][name*="user"], input[type="text"][name*="email"]',
            );
            const visiblePw = Array.from(pwFields).filter(
              (el) => (el as HTMLElement).offsetParent !== null,
            );
            const visibleEmail = Array.from(emailFields).filter(
              (el) => (el as HTMLElement).offsetParent !== null,
            );
            return {
              visibleEmailCount: visibleEmail.length,
              visiblePwCount: visiblePw.length,
            };
          });

          const isMultiStep =
            multiStepCheck.visibleEmailCount > 0 &&
            multiStepCheck.visiblePwCount === 0;
          loginResult.isMultiStep = isMultiStep;

          // Find username/email field
          const usernameSelector = await page.evaluate(() => {
            const el =
              document.querySelector('input[type="email"]') ||
              document.querySelector('input[autocomplete="username"]') ||
              document.querySelector('input[autocomplete="email"]') ||
              document.querySelector('input[type="text"][name*="user"]') ||
              document.querySelector('input[type="text"][name*="email"]') ||
              document.querySelector('input[type="text"][name*="login"]');
            if (!el) return null;
            if (el.id) return "#" + el.id;
            if ((el as HTMLInputElement).name)
              return '[name="' + (el as HTMLInputElement).name + '"]';
            return 'input[type="email"], input[type="text"]';
          });

          let passwordSelector = await page.evaluate(() => {
            const el = document.querySelector('input[type="password"]');
            if (!el) return null;
            if (el.id) return "#" + el.id;
            if ((el as HTMLInputElement).name)
              return '[name="' + (el as HTMLInputElement).name + '"]';
            return 'input[type="password"]';
          });

          const submitBtnSelector = await page.evaluate(() => {
            const candidates = Array.from(
              document.querySelectorAll(
                'button[type="submit"], button, input[type="submit"]',
              ),
            );
            for (const el of candidates) {
              const text = ((el as HTMLElement).innerText || "")
                .trim()
                .toLowerCase();
              if (/log\s*in|sign\s*in|submit|continue|enter|next/i.test(text)) {
                if (el.id) return "#" + el.id;
                if ((el as HTMLInputElement).name)
                  return '[name="' + (el as HTMLInputElement).name + '"]';
                return (
                  el.tagName.toLowerCase() +
                  '[type="' +
                  ((el as HTMLInputElement).type || "submit") +
                  '"]'
                );
              }
            }
            // Fallback: first submit button
            const first = document.querySelector(
              'button[type="submit"], input[type="submit"]',
            );
            if (first) {
              if (first.id) return "#" + first.id;
              return first.tagName.toLowerCase() + '[type="submit"]';
            }
            return null;
          });

          loginResult.usernameFieldFound = !!usernameSelector;
          loginResult.passwordFieldFound = !!passwordSelector;
          loginResult.submitButtonFound = !!submitBtnSelector;
          loginResult.usernameSelector = usernameSelector ?? undefined;
          loginResult.passwordSelector = passwordSelector ?? undefined;
          loginResult.submitSelector = submitBtnSelector ?? undefined;

          // ── Handle multi-step: fill username, submit, wait for password ──
          if (isMultiStep && usernameSelector && !passwordSelector) {
            loginResult.multiStepDetail =
              "Multi-step login detected — username page shown first";
            pushResult({
              name: "Login: Multi-Step",
              status: "INFO",
              detail: loginResult.multiStepDetail,
            });

            // Fill username and submit to advance to password step
            await page.click(usernameSelector);
            await page.fill(usernameSelector, username!);
            await page.waitForTimeout(1000);

            if (submitBtnSelector) {
              await page.click(submitBtnSelector);
              // Wait for password field to appear (navigation or dynamic reveal)
              try {
                await page
                  .waitForSelector('input[type="password"]', { timeout: 12000 })
                  .catch(() => {});
                await page.waitForTimeout(2000);
              } catch {
                // continue anyway
              }

              // Re-detect password field on the new page/state
              passwordSelector = await page.evaluate(() => {
                const el = document.querySelector('input[type="password"]');
                if (!el) return null;
                if (el.id) return "#" + el.id;
                if ((el as HTMLInputElement).name)
                  return '[name="' + (el as HTMLInputElement).name + '"]';
                return 'input[type="password"]';
              });
              loginResult.passwordFieldFound = !!passwordSelector;
              loginResult.passwordSelector = passwordSelector ?? undefined;

              if (passwordSelector) {
                loginResult.multiStepDetail +=
                  " → password field appeared on step 2";
                pushResult({
                  name: "Login: Multi-Step (Step 2)",
                  status: "PASS",
                  detail: `Password field appeared after username submit: ${passwordSelector}`,
                });
              } else {
                loginResult.multiStepDetail +=
                  " → password field NOT found on step 2";
                pushResult({
                  name: "Login: Multi-Step (Step 2)",
                  status: "WARN",
                  detail:
                    "Password field did not appear after submitting username",
                });
              }
            }
          }

          // ── Pre-login screenshot ──────────────────────────────────────
          try {
            const preBuf = await page.screenshot({ fullPage: false });
            loginResult.preLoginScreenshot = preBuf.toString("base64");
          } catch {
            /* skip */
          }

          const preSubmitUrl = page.url();

          if (
            usernameSelector &&
            passwordSelector &&
            !(isMultiStep && !passwordSelector)
          ) {
            // Fill credentials (skip username if multi-step already filled it)
            if (!isMultiStep) {
              await page.click(usernameSelector);
              await page.fill(usernameSelector, username!);
              await page.waitForTimeout(1000);
            }
            await page.click(passwordSelector);
            await page.fill(passwordSelector, password!);
            await page.waitForTimeout(1000);

            if (submitBtnSelector) {
              await page.click(submitBtnSelector);
              loginResult.submitted = true;

              // Wait for navigation or outcome
              await page
                .waitForNavigation({
                  waitUntil: "domcontentloaded",
                  timeout: 15_000,
                })
                .catch(() => {});
              await page.waitForTimeout(4000);

              loginResult.postSubmitUrl = page.url();
              loginResult.urlChanged =
                loginResult.postSubmitUrl !== preSubmitUrl;
              loginResult.postLoginPageTitle = await page
                .title()
                .catch(() => "");

              // ── Detect success indicators ─────────────────────────────
              const successDetection = await page.evaluate(() => {
                const signals: string[] = [];
                const selectorCandidates: string[] = [];
                const bodyText = (document.body?.innerText || "").toLowerCase();
                const url = window.location.href.toLowerCase();

                // Text-based signals
                if (bodyText.includes("dashboard"))
                  signals.push("'dashboard' text found");
                if (bodyText.includes("welcome back"))
                  signals.push("'welcome back' text found");
                if (bodyText.includes("my account"))
                  signals.push("'my account' text found");
                if (bodyText.includes("my profile"))
                  signals.push("'my profile' text found");
                if (bodyText.includes("settings"))
                  signals.push("'settings' link found");

                // Logout / sign out link = strong success signal
                const logoutEl =
                  document.querySelector('a[href*="logout"]') ||
                  document.querySelector('a[href*="signout"]') ||
                  document.querySelector('a[href*="sign-out"]') ||
                  document.querySelector('a[href*="log-out"]') ||
                  document.querySelector('button[class*="logout"]');
                if (logoutEl) {
                  signals.push("logout/sign-out element found");
                  const le = logoutEl as HTMLElement;
                  if (le.id) selectorCandidates.push("#" + le.id);
                  else if (logoutEl.tagName === "A")
                    selectorCandidates.push(
                      'a[href*="' +
                        ((logoutEl as HTMLAnchorElement)
                          .getAttribute("href")
                          ?.match(/(log.?out|sign.?out)/i)?.[0] || "logout") +
                        '"]',
                    );
                }

                // Dashboard / profile / feed container
                const dashboardEl =
                  document.querySelector('[class*="dashboard"]') ||
                  document.querySelector('[id*="dashboard"]') ||
                  document.querySelector('[class*="feed"]') ||
                  document.querySelector('[class*="home-content"]') ||
                  document.querySelector("#main-content");
                if (dashboardEl) {
                  const de = dashboardEl as HTMLElement;
                  if (de.id) selectorCandidates.push("#" + de.id);
                  else {
                    const cls = de.className
                      .toString()
                      .split(/\s+/)
                      .filter((c) => c.length > 2 && c.length < 40)[0];
                    if (cls) selectorCandidates.push("." + cls);
                  }
                }

                // URL signals
                if (
                  !url.includes("login") &&
                  !url.includes("signin") &&
                  !url.includes("auth")
                ) {
                  signals.push("URL no longer contains login/signin/auth");
                }

                return {
                  signals,
                  selector:
                    selectorCandidates.length > 0
                      ? selectorCandidates.join(", ")
                      : null,
                };
              });

              if (successDetection.signals.length > 0) {
                loginResult.successSignals = successDetection.signals;
                loginResult.successSelector =
                  successDetection.selector ?? undefined;
              }

              // ── Detect failure / error indicators ───────────────────────
              const failureDetection = await page.evaluate(() => {
                const signals: string[] = [];
                const selectorCandidates: string[] = [];
                const bodyText = (document.body?.innerText || "").toLowerCase();

                // Error text patterns
                if (bodyText.includes("invalid"))
                  signals.push("'invalid' text found");
                if (bodyText.includes("incorrect"))
                  signals.push("'incorrect' text found");
                if (bodyText.includes("wrong password"))
                  signals.push("'wrong password' text found");
                if (bodyText.includes("doesn't match"))
                  signals.push("'doesn't match' text found");
                if (bodyText.includes("not recognized"))
                  signals.push("'not recognized' text found");
                if (bodyText.includes("account not found"))
                  signals.push("'account not found' text found");
                if (
                  bodyText.includes("try again") &&
                  !bodyText.includes("dashboard")
                )
                  signals.push("'try again' text found");

                // Error elements
                const errorEl =
                  document.querySelector('[class*="error-message"]') ||
                  document.querySelector('[class*="error_message"]') ||
                  document.querySelector('[class*="errorMessage"]') ||
                  document.querySelector('[class*="alert-danger"]') ||
                  document.querySelector('[class*="login-error"]') ||
                  document.querySelector('[class*="loginError"]') ||
                  document.querySelector('[role="alert"]') ||
                  document.querySelector('[class*="form-error"]') ||
                  document.querySelector('[class*="field-error"]') ||
                  document.querySelector('[class*="invalid-feedback"]');
                if (errorEl) {
                  const ee = errorEl as HTMLElement;
                  const errText = ee.innerText?.trim().slice(0, 100);
                  if (errText) signals.push(`error element: "${errText}"`);
                  if (ee.id) selectorCandidates.push("#" + ee.id);
                  else {
                    const cls = ee.className
                      .toString()
                      .split(/\s+/)
                      .filter((c) => c.length > 2 && c.length < 40)[0];
                    if (cls) selectorCandidates.push("." + cls);
                  }
                }

                // Also check role="alert" specifically
                const alertEls = document.querySelectorAll('[role="alert"]');
                if (
                  alertEls.length > 0 &&
                  !selectorCandidates.includes('[role="alert"]')
                ) {
                  selectorCandidates.push('[role="alert"]');
                }

                return {
                  signals,
                  selector:
                    selectorCandidates.length > 0
                      ? selectorCandidates.join(", ")
                      : null,
                };
              });

              if (failureDetection.signals.length > 0) {
                loginResult.failureSignals = failureDetection.signals;
                loginResult.failureSelector =
                  failureDetection.selector ?? undefined;
              }

              // ── Detect TOTP / 2FA fields that appeared after submit ─────
              const totpDetection = await page.evaluate(() => {
                const candidates = [
                  'input[name*="otp"]',
                  'input[name*="totp"]',
                  'input[name*="2fa"]',
                  'input[name*="mfa"]',
                  'input[name*="code"]',
                  'input[name*="token"]',
                  'input[autocomplete="one-time-code"]',
                  'input[inputmode="numeric"][maxlength="6"]',
                  'input[type="tel"][maxlength="6"]',
                  'input[type="number"][maxlength="6"]',
                ];
                for (const sel of candidates) {
                  const el = document.querySelector(sel);
                  if (el && (el as HTMLElement).offsetParent !== null) {
                    // Refine selector
                    if ((el as HTMLElement).id)
                      return "#" + (el as HTMLElement).id;
                    if ((el as HTMLInputElement).name)
                      return (
                        'input[name="' + (el as HTMLInputElement).name + '"]'
                      );
                    return sel;
                  }
                }
                // Check for 2FA-related text
                const bodyText = (document.body?.innerText || "").toLowerCase();
                if (
                  bodyText.includes("verification code") ||
                  bodyText.includes("authenticator") ||
                  bodyText.includes("two-factor") ||
                  bodyText.includes("2-step") ||
                  bodyText.includes("enter the code") ||
                  bodyText.includes("security code")
                ) {
                  // Page mentions 2FA but we couldn't find a specific input
                  return "__2fa_text_detected__";
                }
                return null;
              });

              if (totpDetection) {
                if (totpDetection === "__2fa_text_detected__") {
                  pushResult({
                    name: "Login: 2FA/TOTP",
                    status: "WARN",
                    detail:
                      "2FA/verification text detected on page but no specific input field found",
                  });
                } else {
                  loginResult.totpSelector = totpDetection;
                  pushResult({
                    name: "Login: 2FA/TOTP",
                    status: "INFO",
                    detail: `2FA/TOTP input detected: ${totpDetection}`,
                  });
                }
              }

              // ── Detect rate-limit / lockout signals ─────────────────────
              const rateLimitDetection = await page.evaluate(() => {
                const bodyText = (document.body?.innerText || "").toLowerCase();
                const signals: string[] = [];
                if (bodyText.includes("too many"))
                  signals.push("'too many attempts' text");
                if (bodyText.includes("rate limit"))
                  signals.push("'rate limit' text");
                if (bodyText.includes("temporarily locked"))
                  signals.push("'temporarily locked' text");
                if (bodyText.includes("account locked"))
                  signals.push("'account locked' text");
                if (bodyText.includes("try again later"))
                  signals.push("'try again later' text");
                if (bodyText.includes("blocked"))
                  signals.push("'blocked' text");
                if (bodyText.includes("suspended"))
                  signals.push("'suspended' text");
                return signals;
              });

              if (rateLimitDetection.length > 0) {
                loginResult.rateLimitSignals = rateLimitDetection;
                pushResult({
                  name: "Login: Rate Limit / Lockout",
                  status: "WARN",
                  detail: `Signals detected: ${rateLimitDetection.join(", ")}`,
                });
              }

              // ── Detect post-submit CAPTCHA ──────────────────────────────
              const postCaptcha = await page.evaluate(() => {
                const html = document.documentElement.innerHTML.toLowerCase();
                const providers: string[] = [];
                if (html.includes("recaptcha") || html.includes("grecaptcha"))
                  providers.push("reCAPTCHA");
                if (html.includes("hcaptcha")) providers.push("hCaptcha");
                if (html.includes("cf-turnstile") || html.includes("turnstile"))
                  providers.push("Cloudflare Turnstile");
                return providers;
              });
              // Only report if CAPTCHA appeared after submit and wasn't there before
              if (
                postCaptcha.length > 0 &&
                (!loginResult.captchaProviders ||
                  loginResult.captchaProviders.length === 0)
              ) {
                loginResult.captchaProviders = postCaptcha;
                pushResult({
                  name: "Login: Post-Submit CAPTCHA",
                  status: "WARN",
                  detail: `CAPTCHA appeared after login submit: ${postCaptcha.join(", ")}`,
                });
              }

              // ── Guess overall outcome ───────────────────────────────────
              let outcome: string;
              if (rateLimitDetection.length > 0) {
                outcome = "rate_limited";
              } else if (
                postCaptcha.length > 0 &&
                (!loginResult.captchaProviders ||
                  loginResult.captchaProviders.length === 0)
              ) {
                outcome = "captcha_block";
              } else if (
                totpDetection &&
                totpDetection !== "__2fa_text_detected__"
              ) {
                outcome = "success"; // got past password, needs 2FA = creds were valid
              } else if (successDetection.signals.length >= 2) {
                outcome = "success";
              } else if (failureDetection.signals.length > 0) {
                outcome = "wrong_credentials";
              } else if (
                loginResult.urlChanged &&
                successDetection.signals.length > 0
              ) {
                outcome = "success";
              } else if (loginResult.urlChanged) {
                outcome = "unknown";
              } else {
                outcome = "unknown";
              }

              loginResult.outcomeGuess = outcome;
              loginResult.detail = `Submitted credentials -> ${loginResult.postSubmitUrl} | Outcome: ${outcome}`;
              if (successDetection.signals.length > 0) {
                loginResult.detail += ` | Success signals: ${successDetection.signals.join("; ")}`;
              }
              if (failureDetection.signals.length > 0) {
                loginResult.detail += ` | Failure signals: ${failureDetection.signals.join("; ")}`;
              }
            } else {
              loginResult.detail =
                "Found username+password fields but no submit button";
            }
          } else {
            const missing: string[] = [];
            if (!usernameSelector) missing.push("username field");
            if (!passwordSelector) missing.push("password field");
            loginResult.detail = `Missing: ${missing.join(", ")} on login page`;
          }

          // ── Post-login screenshot ─────────────────────────────────────
          try {
            const buf = await page.screenshot({ fullPage: false });
            loginResult.screenshot = buf.toString("base64");
          } catch {
            /* skip */
          }

          const loginStatus: UrlTestResult["status"] = loginResult.submitted
            ? loginResult.outcomeGuess === "success"
              ? "PASS"
              : loginResult.outcomeGuess === "wrong_credentials"
                ? "INFO"
                : "WARN"
            : "WARN";

          pushResult({
            name: "Live Login Test",
            status: loginStatus,
            detail: loginResult.detail,
          });
        }
      } catch (e) {
        loginResult.detail = `Login test error: ${String(e).slice(0, 300)}`;
        pushResult({
          name: "Live Login Test",
          status: "FAIL",
          detail: loginResult.detail,
        });
      }

      send(socket, { type: "url_test_login", testId, login: loginResult });
      progress("Live Login Test", "done");
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Finalize
    // ══════════════════════════════════════════════════════════════════════
    finalize();
  } catch (e) {
    log("url_test", `FATAL  testId=${testId}  ${String(e)}`);
    send(socket, {
      type: "url_test_error",
      testId,
      message: `URL test failed: ${String(e).slice(0, 500)}`,
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}

// ── Form selector scrape runner ───────────────────────────────────────────────

async function runScrapeForm(
  requestId: string,
  targetUrl: string,
  timeoutMs: number,
  socket: WebSocket,
): Promise<void> {
  const details: string[] = [];
  const t0 = Date.now();
  let browser: any = null;

  function done(result: ScrapedFormSelectors) {
    send(socket, { type: "scrape_form_result", requestId, result });
  }

  function guessSelector(el: any): string | undefined {
    if (!el) return undefined;
    if (el.id) return `#${el.id}`;
    const tag = el.tag?.toLowerCase?.() ?? el.tagName?.toLowerCase?.() ?? "input";
    const type = el.type ? `[type="${el.type}"]` : "";
    const name = el.name ? `[name="${el.name}"]` : "";
    if (tag && (name || type)) return `${tag}${type}${name}`;
    return tag;
  }

  try {
    browser = await chromium.launch({
      headless: true,
      timeout: timeoutMs,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1440,900",
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Give SPAs a breath to render the login form.
    await page.waitForTimeout(1200);

    // If the login form is hidden behind a modal/menu, try to open it.
    // Best-effort; ignore failures.
    try {
      const pwCount = await page.locator('input[type="password"]').count();
      if (pwCount === 0) {
        const trigger = page
          .locator("button, a, [role='button']")
          .filter({ hasText: /log in|login|sign in|sign-in|account/i })
          .first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 1500 });
          await page.waitForTimeout(900);
        }
      }
    } catch {
      /* ignore */
    }

    // Avoid passing a compiled function into evaluate (tsx/esbuild can inject helpers
    // like `__name(...)` that don't exist in the browser context).
    const SCRAPE_FORM_EVAL_FN: any = new Function(`
      return (() => {
        function isVisible(el) {
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
          const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
          if (!rect) return true;
          if (rect.width > 0 && rect.height > 0) return true;
          const tag = (el.tagName || "").toLowerCase();
          return tag === "input" || tag === "textarea";
        }

        function queryAllDeep(selector) {
          const out = [];
          const queue = [document];
          const seen = new Set();
          while (queue.length) {
            const root = queue.shift();
            try {
              out.push(...Array.from(root.querySelectorAll(selector)));
            } catch {}
            const elems = Array.from(root.querySelectorAll("*"));
            for (const el of elems) {
              const sr = el.shadowRoot;
              if (sr && !seen.has(sr)) {
                seen.add(sr);
                queue.push(sr);
              }
            }
            if (out.length > 5000) break;
          }
          return out;
        }

        function pickBest(els, score) {
          let best = null;
          let bestScore = -1;
          for (const el of els) {
            const s = score(el);
            if (s > bestScore) {
              bestScore = s;
              best = el;
            }
          }
          return best;
        }

        function cssFor(el) {
          if (!el) return undefined;
          const id = el.id;
          if (id) return "#" + CSS.escape(id);
          const tag = (el.tagName || "div").toLowerCase();
          const name = el.getAttribute && el.getAttribute("name");
          const aria = el.getAttribute && el.getAttribute("aria-label");
          const ph = el.getAttribute && el.getAttribute("placeholder");
          const type = el.getAttribute && el.getAttribute("type");
          const ac = el.getAttribute && el.getAttribute("autocomplete");
          if (name) return tag + "[name=\\"" + CSS.escape(name) + "\\"]";
          if (ac && tag === "input") return "input[autocomplete=\\"" + CSS.escape(ac) + "\\"]";
          if (type && tag === "input") return "input[type=\\"" + CSS.escape(type) + "\\"]";
          if (aria) return tag + "[aria-label=\\"" + CSS.escape(aria) + "\\"]";
          if (ph && tag === "input") return "input[placeholder=\\"" + CSS.escape(ph) + "\\"]";
          const cls = (el.className && el.className.toString && el.className.toString().trim()) || "";
          const first = cls.split(/\\s+/g).filter(Boolean)[0];
          if (first) return tag + "." + CSS.escape(first);
          return tag;
        }

        const inputs = queryAllDeep("input, textarea, [contenteditable='true']").filter(isVisible);
        const buttons = queryAllDeep("button, input[type='submit'], a, [role='button']").filter(isVisible);

        const username = pickBest(inputs, (el) => {
          const tag = (el.tagName || "").toLowerCase();
          const t = ((el.getAttribute && el.getAttribute("type")) || "").toLowerCase();
          const n = ((el.getAttribute && el.getAttribute("name")) || "").toLowerCase();
          const i = ((el.getAttribute && el.getAttribute("id")) || "").toLowerCase();
          const p = ((el.getAttribute && el.getAttribute("placeholder")) || "").toLowerCase();
          const a = ((el.getAttribute && el.getAttribute("aria-label")) || "").toLowerCase();
          const ac = ((el.getAttribute && el.getAttribute("autocomplete")) || "").toLowerCase();
          const im = ((el.getAttribute && el.getAttribute("inputmode")) || "").toLowerCase();
          let s = 0;
          if (tag === "textarea") s -= 5;
          if (t === "email") s += 60;
          if (im === "email") s += 20;
          if (t === "text" || t === "") s += 20;
          if (ac.includes("username") || ac.includes("email")) s += 45;
          if (n.includes("email") || i.includes("email") || p.includes("email") || a.includes("email")) s += 40;
          if (n.includes("user") || i.includes("user") || p.includes("user") || a.includes("user")) s += 25;
          if (n.includes("login") || i.includes("login")) s += 10;
          return s;
        });

        const password = pickBest(inputs, (el) => {
          const tag = (el.tagName || "").toLowerCase();
          const t = ((el.getAttribute && el.getAttribute("type")) || "").toLowerCase();
          const n = ((el.getAttribute && el.getAttribute("name")) || "").toLowerCase();
          const i = ((el.getAttribute && el.getAttribute("id")) || "").toLowerCase();
          const p = ((el.getAttribute && el.getAttribute("placeholder")) || "").toLowerCase();
          const a = ((el.getAttribute && el.getAttribute("aria-label")) || "").toLowerCase();
          const ac = ((el.getAttribute && el.getAttribute("autocomplete")) || "").toLowerCase();
          let s = 0;
          if (tag === "textarea") s -= 10;
          if (t === "password") s += 90;
          if (ac.includes("current-password") || ac.includes("new-password")) s += 55;
          if (n.includes("pass") || i.includes("pass") || p.includes("pass") || a.includes("pass")) s += 25;
          return s;
        });

        const submit = pickBest(buttons, (el) => {
          const tag = (el.tagName || "").toLowerCase();
          const t = ((el.getAttribute && el.getAttribute("type")) || "").toLowerCase();
          const txt = ((el.textContent || "") + "").toLowerCase();
          const aria = ((el.getAttribute && el.getAttribute("aria-label")) || "").toLowerCase();
          let s = 0;
          if (t === "submit") s += 55;
          if (tag === "button") s += 20;
          if (tag === "a") s += 10;
          if (/sign in|log in|login|submit|continue|next/.test(txt)) s += 35;
          if (/sign in|log in|login/.test(aria)) s += 15;
          return s;
        });

        const captchaEl =
          document.querySelector("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='turnstile']") ||
          document.querySelector("[class*='captcha'], [class*='recaptcha'], [class*='hcaptcha'], .cf-turnstile");

        const totpEl =
          document.querySelector("input[autocomplete='one-time-code']") ||
          document.querySelector("input[name*='otp' i], input[id*='otp' i], input[placeholder*='code' i]");

        const isSPA = !!(document.querySelector("#__next") || document.querySelector("#root"));

        const uSel = cssFor(username);
        const pSel = cssFor(password);
        const sSel = cssFor(submit);
        const cSel = cssFor(captchaEl);
        const tSel = cssFor(totpEl);

        let confidence = 0;
        if (uSel) confidence += 35;
        if (pSel) confidence += 35;
        if (sSel) confidence += 25;
        if (uSel && pSel) confidence += 5;
        if (uSel && pSel && sSel) confidence += 5;

        const d = [];
        d.push("frame_url=" + window.location.href);
        d.push("candidates: inputs=" + inputs.length + " buttons=" + buttons.length);
        if (!uSel) d.push("username not detected");
        if (!pSel) d.push("password not detected");
        if (!sSel) d.push("submit not detected");

        return {
          url: window.location.href,
          username_selector: uSel,
          password_selector: pSel,
          submit_selector: sSel,
          captcha_selector: cSel,
          totp_selector: tSel,
          confidence,
          details: d,
          isSPA,
          hasCaptcha: !!captchaEl,
          hasMFA: !!totpEl,
        };
      })();
    `);

    async function evalFrame(frame: any): Promise<ScrapedFormSelectors> {
      return (await frame.evaluate(SCRAPE_FORM_EVAL_FN)) as ScrapedFormSelectors;
    }

    const frames = page.frames();
    const framesToEval = frames.length > 0 ? frames : [page.mainFrame()];
    const frameResults: ScrapedFormSelectors[] = [];
    for (const f of framesToEval) {
      try {
        frameResults.push(await evalFrame(f));
      } catch (e) {
        frameResults.push({
          url: typeof f?.url === "function" ? f.url() : targetUrl,
          confidence: 0,
          details: [`frame eval failed: ${String(e).slice(0, 200)}`],
          error: String(e),
        } as any);
      }
    }

    details.push(
      `frames=${frames.length} evaluated=${framesToEval.length} results=${frameResults.length}`,
    );

    for (let i = 0; i < frameResults.length; i++) {
      const r = frameResults[i];
      details.push(
        `frame[${i}] conf=${r.confidence} u=${r.username_selector ? "y" : "n"} p=${r.password_selector ? "y" : "n"} s=${r.submit_selector ? "y" : "n"}`,
      );
    }

    const result =
      frameResults.length > 0
        ? frameResults.reduce((best, cur) => {
            // Prefer higher confidence. If tied, prefer the one with more selectors.
            if (cur.confidence > best.confidence) return cur;
            if (cur.confidence < best.confidence) return best;
            const bestCount =
              (best.username_selector ? 1 : 0) +
              (best.password_selector ? 1 : 0) +
              (best.submit_selector ? 1 : 0);
            const curCount =
              (cur.username_selector ? 1 : 0) +
              (cur.password_selector ? 1 : 0) +
              (cur.submit_selector ? 1 : 0);
            if (curCount > bestCount) return cur;
            return best;
          })
        : ({
            url: targetUrl,
            confidence: 0,
            details: ["no frames evaluated (unexpected)"],
          } as ScrapedFormSelectors);

    const elapsed = Date.now() - t0;
    details.push(`Scraped in ${elapsed}ms`);
    result.details = [...details, ...(result.details ?? [])];
    done(result);
  } catch (e) {
    done({
      url: targetUrl,
      confidence: 0,
      details: [`Scrape failed: ${String(e).slice(0, 300)}`],
      error: String(e),
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });

log("server", `Manifold scraper listening on ws://localhost:${PORT}`);

wss.on("connection", (socket: WebSocket, req) => {
  const clientAddr = req.socket.remoteAddress ?? "unknown";
  log("connect", `Client connected  addr=${clientAddr}`);

  let activeScrapes = 0;
  const queue: (() => Promise<void>)[] = [];

  async function processQueue(): Promise<void> {
    while (queue.length > 0 && activeScrapes < MAX_CONCURRENT) {
      const task = queue.shift()!;
      activeScrapes++;
      task().finally(() => {
        activeScrapes--;
        processQueue();
      });
    }
  }

  function enqueue(req: WsScrapeRequest): void {
    queue.push(() => scrape(req.sourceId, req.url, req.selector, socket));
    processQueue();
  }

  socket.on("message", (data: Buffer | string) => {
    let msg: WsClientMessage;

    try {
      msg = JSON.parse(data.toString()) as WsClientMessage;
    } catch {
      log("warn", "Received non-JSON message, ignoring.");
      return;
    }

    if (msg.type === "ping") {
      send(socket, { type: "pong" });
      return;
    }

    if (msg.type === "url_test") {
      if (!msg.url) {
        send(socket, {
          type: "url_test_error",
          testId: msg.testId,
          message: "Missing required field: url",
        });
        return;
      }
      try {
        new URL(msg.url);
      } catch {
        send(socket, {
          type: "url_test_error",
          testId: msg.testId,
          message: `Invalid URL: "${msg.url}"`,
        });
        return;
      }
      // Run url test (non-blocking)
      runUrlTest(msg.testId, msg.url, msg.username, msg.password, socket).catch(
        (e) => {
          send(socket, {
            type: "url_test_error",
            testId: msg.testId,
            message: String(e),
          });
        },
      );
      return;
    }

    if (msg.type === "scrape_form") {
      if (!msg.url) {
        send(socket, {
          type: "scrape_form_result",
          requestId: msg.requestId,
          result: {
            url: "",
            confidence: 0,
            details: ["Missing required field: url"],
            error: "Missing url",
          },
        });
        return;
      }
      // Run scrape (non-blocking)
      runScrapeForm(msg.requestId, msg.url, msg.timeout ?? 15_000, socket).catch(
        (e) => {
          send(socket, {
            type: "scrape_form_result",
            requestId: msg.requestId,
            result: {
              url: msg.url,
              confidence: 0,
              details: [`Scrape failed: ${String(e).slice(0, 300)}`],
              error: String(e),
            },
          });
        },
      );
      return;
    }

    if (msg.type === "scrape") {
      if (!msg.url) {
        send(socket, {
          type: "error",
          sourceId: msg.sourceId,
          message: "Missing required field: url",
        });
        return;
      }

      try {
        new URL(msg.url);
      } catch {
        send(socket, {
          type: "error",
          sourceId: msg.sourceId,
          message: `Invalid URL: "${msg.url}"`,
        });
        return;
      }

      enqueue(msg);
    }
  });

  socket.on("close", (code, reason) => {
    log(
      "disconnect",
      `Client disconnected  addr=${clientAddr}  code=${code}  reason=${reason.toString() || "(none)"}`,
    );
  });

  socket.on("error", (err) => {
    log("error", `Socket error  addr=${clientAddr}  ${err.message}`);
  });
});

wss.on("error", (err) => {
  log("fatal", `WebSocket server error: ${err.message}`);
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  log("shutdown", `Received ${signal}, closing server...`);
  wss.close(() => {
    log("shutdown", "Server closed.");
    process.exit(0);
  });
  // Force exit after 5 seconds if connections don't drain
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
