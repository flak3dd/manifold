// ── Manifold Functionality Test — Live URL ──────────────────────────────────
//
// Run with:  npx tsx scripts/functionality-test.ts
//
// Tests a live URL (default: https://joefortunepokies.win) for:
//   1. Page reachability & load performance
//   2. SSL / security headers
//   3. Registration form detection & field inventory
//   4. Login form detection
//   5. CAPTCHA / WAF / bot-protection signals
//   6. Navigation links & SPA detection
//   7. Cookie & tracker inventory
//   8. Screenshot capture
//   9. Responsive viewport check
//  10. Summary report with pass/warn/fail verdicts

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ──────────────────────────────────────────────────────────────────

const TARGET_URL = process.argv[2] || "https://joefortunepokies.win";
const PAGE_TIMEOUT_MS = 45_000;
const SCREENSHOT_DIR = path.resolve(__dirname, "..", "test-results");
const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "mobile", width: 375, height: 812 },
];

// ── Types ───────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  status: "PASS" | "WARN" | "FAIL" | "INFO";
  detail: string;
  durationMs?: number;
}

interface FormField {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  required: boolean;
  autocomplete: string;
  label: string;
}

interface DetectedForm {
  action: string;
  method: string;
  fields: FormField[];
  submitButtons: string[];
  formIndex: number;
}

// ── Stealth setup ───────────────────────────────────────────────────────────

chromium.use(StealthPlugin());

// ── Helpers ─────────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

function log(label: string, ...args: unknown[]): void {
  console.log(`[${ts()}] [${label}]`, ...args);
}

function badge(status: TestResult["status"]): string {
  switch (status) {
    case "PASS":
      return "✅ PASS";
    case "WARN":
      return "⚠️  WARN";
    case "FAIL":
      return "❌ FAIL";
    case "INFO":
      return "ℹ️  INFO";
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const results: TestResult[] = [];
  const allStart = Date.now();

  log("init", `Manifold Functionality Test`);
  log("init", `Target URL: ${TARGET_URL}`);
  log("init", `Timestamp:  ${new Date().toISOString()}`);
  console.log("─".repeat(72));

  ensureDir(SCREENSHOT_DIR);

  // ── Launch browser ────────────────────────────────────────────────────

  log("browser", "Launching stealth Chromium…");
  const browser = await chromium.launch({
    headless: true,
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
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
    colorScheme: "light",
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: {
      "Accept-Language": "en-AU,en;q=0.9",
    },
  });

  const page = await context.newPage();

  // Collect network events for analysis
  const networkRequests: {
    url: string;
    resourceType: string;
    status?: number;
    failed?: boolean;
  }[] = [];
  const consoleMessages: { type: string; text: string }[] = [];

  page.on("request", (req) => {
    networkRequests.push({ url: req.url(), resourceType: req.resourceType() });
  });

  page.on("response", (res) => {
    const entry = networkRequests.find((r) => r.url === res.url() && !r.status);
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

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 1: Page Load & Reachability
  // ════════════════════════════════════════════════════════════════════════

  log("test", "1 — Page Load & Reachability");
  let pageLoadOk = false;
  {
    const t0 = Date.now();
    try {
      const response = await page.goto(TARGET_URL, {
        waitUntil: "domcontentloaded",
        timeout: PAGE_TIMEOUT_MS,
      });
      const elapsed = Date.now() - t0;
      const status = response?.status() ?? 0;
      const statusText = response?.statusText() ?? "unknown";

      if (status >= 200 && status < 400) {
        pageLoadOk = true;
        results.push({
          name: "Page Load",
          status: elapsed > 10_000 ? "WARN" : "PASS",
          detail: `HTTP ${status} ${statusText} in ${elapsed}ms`,
          durationMs: elapsed,
        });
      } else {
        results.push({
          name: "Page Load",
          status: "FAIL",
          detail: `HTTP ${status} ${statusText} in ${elapsed}ms`,
          durationMs: elapsed,
        });
      }

      // Wait a bit extra for JS rendering
      await page.waitForTimeout(3000);
    } catch (e) {
      const elapsed = Date.now() - t0;
      results.push({
        name: "Page Load",
        status: "FAIL",
        detail: `Failed: ${String(e).slice(0, 300)}`,
        durationMs: elapsed,
      });
    }
  }

  if (!pageLoadOk) {
    log("abort", "Page did not load — skipping remaining tests.");
    printReport(results, Date.now() - allStart);
    await browser.close();
    return;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 2: SSL & Security Headers
  // ════════════════════════════════════════════════════════════════════════

  log("test", "2 — SSL & Security Headers");
  {
    try {
      const resp = await page.goto(TARGET_URL, {
        waitUntil: "domcontentloaded",
        timeout: PAGE_TIMEOUT_MS,
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

      const isHttps = TARGET_URL.startsWith("https://");
      results.push({
        name: "SSL/HTTPS",
        status: isHttps ? "PASS" : "WARN",
        detail: isHttps
          ? "Site served over HTTPS"
          : "Site NOT served over HTTPS",
      });

      results.push({
        name: "Security Headers",
        status:
          present.length >= 3 ? "PASS" : present.length >= 1 ? "WARN" : "INFO",
        detail: `Present: ${present.map(([k]) => k).join(", ") || "none"} | Missing: ${missing.join(", ") || "none"}`,
      });
    } catch (e) {
      results.push({
        name: "Security Headers",
        status: "WARN",
        detail: `Could not fetch headers: ${String(e).slice(0, 200)}`,
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 3: WAF / Bot Protection / CAPTCHA Detection
  // ════════════════════════════════════════════════════════════════════════

  log("test", "3 — WAF / Bot Protection / CAPTCHA Detection");
  {
    const t0 = Date.now();
    const detection = await page.evaluate(() => {
      const html = document.documentElement.innerHTML.toLowerCase();
      const bodyText = (document.body?.innerText || "").toLowerCase();

      // CAPTCHA
      const captchaProviders: string[] = [];
      if (html.includes("recaptcha") || html.includes("grecaptcha"))
        captchaProviders.push("reCAPTCHA");
      if (html.includes("hcaptcha")) captchaProviders.push("hCaptcha");
      if (html.includes("cf-turnstile") || html.includes("turnstile"))
        captchaProviders.push("Cloudflare Turnstile");
      if (html.includes("funcaptcha") || html.includes("arkoselabs"))
        captchaProviders.push("FunCaptcha/Arkose");
      if (html.includes("geetest")) captchaProviders.push("GeeTest");

      // WAF
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
      if (html.includes("sucuri")) wafSignals.push("Sucuri");
      if (html.includes("aws-waf") || html.includes("awswaf"))
        wafSignals.push("AWS WAF");

      // Bot detection libraries
      const botDetection: string[] = [];
      if (html.includes("fingerprintjs") || html.includes("fpjs"))
        botDetection.push("FingerprintJS");
      if (html.includes("bot-detect") || html.includes("botdetect"))
        botDetection.push("BotDetect");
      if (html.includes("distil") || html.includes("distilnetworks"))
        botDetection.push("Distil Networks");

      // Challenge pages
      const isChallengePage =
        bodyText.includes("checking your browser") ||
        bodyText.includes("just a moment") ||
        bodyText.includes("please wait") ||
        bodyText.includes("verifying you are human") ||
        bodyText.includes("access denied") ||
        bodyText.includes("error 1020") ||
        bodyText.includes("403 forbidden");

      return { captchaProviders, wafSignals, botDetection, isChallengePage };
    });

    const elapsed = Date.now() - t0;

    results.push({
      name: "CAPTCHA Detection",
      status: detection.captchaProviders.length > 0 ? "WARN" : "PASS",
      detail:
        detection.captchaProviders.length > 0
          ? `Detected: ${detection.captchaProviders.join(", ")}`
          : "No CAPTCHA providers detected",
      durationMs: elapsed,
    });

    results.push({
      name: "WAF Detection",
      status: detection.wafSignals.length > 0 ? "INFO" : "PASS",
      detail:
        detection.wafSignals.length > 0
          ? `Signals: ${detection.wafSignals.join(", ")}`
          : "No WAF signals detected",
    });

    results.push({
      name: "Bot Detection Libraries",
      status: detection.botDetection.length > 0 ? "WARN" : "PASS",
      detail:
        detection.botDetection.length > 0
          ? `Detected: ${detection.botDetection.join(", ")}`
          : "No bot detection libraries found",
    });

    results.push({
      name: "Challenge Page",
      status: detection.isChallengePage ? "FAIL" : "PASS",
      detail: detection.isChallengePage
        ? "Page appears to be a bot challenge / block page"
        : "No challenge page detected — site loaded normally",
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 4: Registration Form Detection & Field Inventory
  // ════════════════════════════════════════════════════════════════════════

  log("test", "4 — Registration Form Detection & Field Inventory");
  {
    const t0 = Date.now();
    const forms: DetectedForm[] = await page.evaluate(() => {
      const allForms = Array.from(document.querySelectorAll("form"));
      return allForms.map((form, i) => {
        const inputs = Array.from(
          form.querySelectorAll("input, select, textarea"),
        );
        const fields = inputs.map((el) => {
          const input = el as HTMLInputElement;
          // Try to find associated label
          let labelText = "";
          if (input.id) {
            const lbl = document.querySelector(`label[for="${input.id}"]`);
            if (lbl) labelText = (lbl as HTMLElement).innerText?.trim() || "";
          }
          if (!labelText) {
            const parent = input.closest("label");
            if (parent)
              labelText =
                (parent as HTMLElement).innerText?.trim().split("\n")[0] || "";
          }
          return {
            tag: el.tagName.toLowerCase(),
            type: input.type || "text",
            name: input.name || "",
            id: input.id || "",
            placeholder: input.placeholder || "",
            required:
              input.required || input.getAttribute("aria-required") === "true",
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

        return {
          action: form.action || "",
          method: (form.method || "GET").toUpperCase(),
          fields,
          submitButtons,
          formIndex: i,
        };
      });
    });

    const elapsed = Date.now() - t0;

    if (forms.length === 0) {
      results.push({
        name: "Form Detection",
        status: "WARN",
        detail: "No <form> elements found on page",
        durationMs: elapsed,
      });
    } else {
      results.push({
        name: "Form Detection",
        status: "PASS",
        detail: `Found ${forms.length} form(s) on page`,
        durationMs: elapsed,
      });

      for (const form of forms) {
        const fieldSummary = form.fields
          .map(
            (f) =>
              `${f.type}[name=${f.name || "?"},id=${f.id || "?"}]${f.required ? "*" : ""}`,
          )
          .join(", ");

        // Classify the form
        const fieldNames = form.fields.map((f) =>
          `${f.name} ${f.id} ${f.placeholder} ${f.label} ${f.autocomplete}`.toLowerCase(),
        );
        const allFieldText = fieldNames.join(" ");
        const hasEmail =
          allFieldText.includes("email") || allFieldText.includes("e-mail");
        const hasPassword =
          allFieldText.includes("password") ||
          allFieldText.includes("pin") ||
          form.fields.some((f) => f.type === "password");
        const hasName =
          allFieldText.includes("first") ||
          allFieldText.includes("last") ||
          allFieldText.includes("name");
        const hasDob =
          allFieldText.includes("birth") ||
          allFieldText.includes("dob") ||
          allFieldText.includes("date");
        const hasPhone =
          allFieldText.includes("phone") ||
          allFieldText.includes("mobile") ||
          allFieldText.includes("tel");
        const hasPostal =
          allFieldText.includes("postal") ||
          allFieldText.includes("zip") ||
          allFieldText.includes("postcode");

        const isRegistration =
          hasEmail && hasPassword && (hasName || hasDob || hasPhone);
        const isLogin =
          hasEmail && hasPassword && !hasName && !hasDob && !hasPhone;

        const formType = isRegistration
          ? "REGISTRATION"
          : isLogin
            ? "LOGIN"
            : "UNKNOWN";

        results.push({
          name: `Form #${form.formIndex} (${formType})`,
          status: "INFO",
          detail: `Method: ${form.method} | Fields: ${form.fields.length} | Submits: [${form.submitButtons.join(", ")}] | ${fieldSummary}`,
        });

        // Detailed field report for registration forms
        if (isRegistration) {
          const fieldDetails: string[] = [];
          if (hasName) fieldDetails.push("Name fields ✓");
          if (hasDob) fieldDetails.push("Date of Birth ✓");
          if (hasEmail) fieldDetails.push("Email ✓");
          if (hasPassword) fieldDetails.push("Password/PIN ✓");
          if (hasPhone) fieldDetails.push("Phone/Mobile ✓");
          if (hasPostal) fieldDetails.push("Postal Code ✓");
          const requiredCount = form.fields.filter((f) => f.required).length;

          results.push({
            name: "Registration Form Analysis",
            status: "PASS",
            detail: `Detected: ${fieldDetails.join(" | ")} | Required: ${requiredCount}/${form.fields.length} fields`,
          });
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 5: Standalone Input Detection (outside <form>)
  // ════════════════════════════════════════════════════════════════════════

  log("test", "5 — Standalone Input Detection");
  {
    const standaloneInputs = await page.evaluate(() => {
      const allInputs = Array.from(
        document.querySelectorAll("input, select, textarea"),
      );
      const formInputs = Array.from(
        document.querySelectorAll("form input, form select, form textarea"),
      );
      const standaloneCount = allInputs.length - formInputs.length;
      const standalone = allInputs.filter((el) => !el.closest("form"));
      return {
        total: allInputs.length,
        inForms: formInputs.length,
        standalone: standaloneCount,
        standaloneDetails: standalone.slice(0, 15).map((el) => {
          const input = el as HTMLInputElement;
          return `${el.tagName.toLowerCase()}[type=${input.type || "text"}, name=${input.name || "?"}, id=${input.id || "?"}]`;
        }),
      };
    });

    results.push({
      name: "Input Elements",
      status: "INFO",
      detail: `Total: ${standaloneInputs.total} | In forms: ${standaloneInputs.inForms} | Standalone: ${standaloneInputs.standalone}`,
    });

    if (standaloneInputs.standalone > 0) {
      results.push({
        name: "Standalone Inputs",
        status: "INFO",
        detail: standaloneInputs.standaloneDetails.join("; "),
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 6: Navigation Links & SPA Detection
  // ════════════════════════════════════════════════════════════════════════

  log("test", "6 — Navigation & SPA Detection");
  {
    const navData = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const scripts = Array.from(document.querySelectorAll("script[src]")).map(
        (s) => (s as HTMLScriptElement).src,
      );
      const isSPA =
        !!document.querySelector(
          "[data-reactroot], [data-react-root], #__next, #__nuxt, #app[data-v-], [data-svelte]",
        ) ||
        html.includes("__NEXT_DATA__") ||
        html.includes("__NUXT__") ||
        html.includes("window.__remixContext") ||
        scripts.some((s) =>
          /react|vue|angular|svelte|next|nuxt|remix/i.test(s),
        );

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
        /login|sign.?in|register|sign.?up|join|account|my.?account|log.?in|create/i.test(
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

    results.push({
      name: "SPA Detection",
      status: "INFO",
      detail: `SPA: ${navData.isSPA ? "Yes" : "No"} | Framework: ${navData.framework}`,
    });

    results.push({
      name: "Page Links",
      status: navData.totalLinks > 0 ? "PASS" : "WARN",
      detail: `Total: ${navData.totalLinks} | External scripts: ${navData.externalScripts}`,
    });

    if (navData.navLinks.length > 0) {
      const linkInfo = navData.navLinks
        .map((l) => `"${l.text}" → ${l.href}`)
        .join(" | ");
      results.push({
        name: "Auth-Related Links",
        status: "PASS",
        detail: linkInfo,
      });
    } else {
      results.push({
        name: "Auth-Related Links",
        status: "INFO",
        detail: "No login/register/join links found in page anchors",
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 7: Cookies & Trackers
  // ════════════════════════════════════════════════════════════════════════

  log("test", "7 — Cookies & Trackers");
  {
    const cookies = await context.cookies();
    const cookieNames = cookies.map((c) => c.name);

    // Known tracker/analytics cookies
    const trackerPatterns: { name: string; pattern: RegExp }[] = [
      { name: "Google Analytics", pattern: /^_ga|^_gid|^_gat/i },
      { name: "Google Tag Manager", pattern: /^_gcl|^_gtm/i },
      { name: "Facebook Pixel", pattern: /^_fbp|^_fbc/i },
      { name: "Hotjar", pattern: /^_hj/i },
      { name: "Segment", pattern: /^ajs_/i },
      { name: "Cloudflare", pattern: /^__cf|^cf_/i },
      { name: "Session", pattern: /sess|session|PHPSESSID|JSESSIONID/i },
    ];

    const detectedTrackers: string[] = [];
    for (const { name, pattern } of trackerPatterns) {
      if (cookieNames.some((cn) => pattern.test(cn))) {
        detectedTrackers.push(name);
      }
    }

    results.push({
      name: "Cookies",
      status: "INFO",
      detail: `Total: ${cookies.length} | Names: ${cookieNames.slice(0, 20).join(", ")}${cookies.length > 20 ? ` (+${cookies.length - 20} more)` : ""}`,
    });

    results.push({
      name: "Trackers Detected",
      status: "INFO",
      detail:
        detectedTrackers.length > 0
          ? detectedTrackers.join(", ")
          : "None identified",
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 8: Page Content & Key Elements
  // ════════════════════════════════════════════════════════════════════════

  log("test", "8 — Page Content & Key Elements");
  {
    const content = await page.evaluate(() => {
      const title = document.title || "";
      const metaDesc =
        (document.querySelector('meta[name="description"]') as HTMLMetaElement)
          ?.content || "";
      const h1s = Array.from(document.querySelectorAll("h1")).map((h) =>
        (h as HTMLElement).innerText?.trim().slice(0, 100),
      );
      const h2s = Array.from(document.querySelectorAll("h2")).map((h) =>
        (h as HTMLElement).innerText?.trim().slice(0, 100),
      );
      const iframes = Array.from(document.querySelectorAll("iframe")).map(
        (f) => ({
          src: f.src || f.getAttribute("data-src") || "",
          title: f.title || "",
        }),
      );
      const images = document.querySelectorAll("img").length;
      const videos = document.querySelectorAll("video").length;
      const bodyLength = document.body?.innerText?.length || 0;

      return { title, metaDesc, h1s, h2s, iframes, images, videos, bodyLength };
    });

    results.push({
      name: "Page Title",
      status: content.title ? "PASS" : "WARN",
      detail: content.title || "(empty)",
    });

    results.push({
      name: "Meta Description",
      status: content.metaDesc ? "PASS" : "INFO",
      detail: content.metaDesc ? content.metaDesc.slice(0, 150) : "(not set)",
    });

    if (content.h1s.length > 0) {
      results.push({
        name: "H1 Headings",
        status: "INFO",
        detail: content.h1s.join(" | "),
      });
    }

    if (content.h2s.length > 0) {
      results.push({
        name: "H2 Headings",
        status: "INFO",
        detail:
          content.h2s.slice(0, 8).join(" | ") +
          (content.h2s.length > 8 ? ` (+${content.h2s.length - 8} more)` : ""),
      });
    }

    results.push({
      name: "Media Assets",
      status: "INFO",
      detail: `Images: ${content.images} | Videos: ${content.videos} | Iframes: ${content.iframes.length}`,
    });

    results.push({
      name: "Body Content",
      status: content.bodyLength > 500 ? "PASS" : "WARN",
      detail: `${content.bodyLength.toLocaleString()} characters of visible text`,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 9: Network Analysis
  // ════════════════════════════════════════════════════════════════════════

  log("test", "9 — Network Analysis");
  {
    const totalRequests = networkRequests.length;
    const failedRequests = networkRequests.filter((r) => r.failed);
    const byType: Record<string, number> = {};
    for (const r of networkRequests) {
      byType[r.resourceType] = (byType[r.resourceType] || 0) + 1;
    }

    const typeBreakdown = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t}:${c}`)
      .join(", ");

    results.push({
      name: "Network Requests",
      status: failedRequests.length > 10 ? "WARN" : "PASS",
      detail: `Total: ${totalRequests} | Failed: ${failedRequests.length} | ${typeBreakdown}`,
    });

    // Check for third-party domains
    const targetHost = new URL(TARGET_URL).hostname;
    const thirdParty = new Set<string>();
    for (const r of networkRequests) {
      try {
        const host = new URL(r.url).hostname;
        if (host !== targetHost && !host.endsWith(`.${targetHost}`)) {
          thirdParty.add(host);
        }
      } catch {
        /* skip malformed URLs */
      }
    }

    const thirdPartyList = Array.from(thirdParty).sort();
    results.push({
      name: "Third-Party Domains",
      status: "INFO",
      detail: `${thirdPartyList.length} domain(s): ${thirdPartyList.slice(0, 15).join(", ")}${thirdPartyList.length > 15 ? ` (+${thirdPartyList.length - 15} more)` : ""}`,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 10: Console Errors
  // ════════════════════════════════════════════════════════════════════════

  log("test", "10 — Console Errors");
  {
    const errors = consoleMessages.filter((m) => m.type === "error");
    const warnings = consoleMessages.filter((m) => m.type === "warning");

    results.push({
      name: "Console Errors",
      status: errors.length > 5 ? "WARN" : errors.length > 0 ? "INFO" : "PASS",
      detail: `Errors: ${errors.length} | Warnings: ${warnings.length} | Total messages: ${consoleMessages.length}`,
    });

    if (errors.length > 0) {
      const topErrors = errors.slice(0, 5).map((e) => e.text.slice(0, 120));
      results.push({
        name: "Top Console Errors",
        status: "INFO",
        detail: topErrors.join(" ‖ "),
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 11: Bot-Detection Evasion Check (navigator properties)
  // ════════════════════════════════════════════════════════════════════════

  log("test", "11 — Bot-Detection Evasion Check");
  {
    const evasion = await page.evaluate(() => {
      const nav = navigator as any;
      return {
        webdriver: nav.webdriver,
        languages: nav.languages ? Array.from(nav.languages) : [],
        platform: nav.platform,
        hardwareConcurrency: nav.hardwareConcurrency,
        deviceMemory: nav.deviceMemory,
        userAgent: nav.userAgent,
        cookieEnabled: nav.cookieEnabled,
        doNotTrack: nav.doNotTrack,
        pdfViewerEnabled: nav.pdfViewerEnabled,
        maxTouchPoints: nav.maxTouchPoints,
        // Check for automation markers
        hasChromiumAutomation: !!(window as any)
          .cdc_adoQpoasnfa76pfcZLmcfl_Array,
        hasPlaywrightBinding:
          typeof (window as any).__playwright !== "undefined",
      };
    });

    results.push({
      name: "navigator.webdriver",
      status:
        evasion.webdriver === false || evasion.webdriver === undefined
          ? "PASS"
          : "WARN",
      detail: `webdriver=${evasion.webdriver}`,
    });

    results.push({
      name: "Stealth Fingerprint",
      status: "INFO",
      detail: `platform=${evasion.platform} | cores=${evasion.hardwareConcurrency} | memory=${evasion.deviceMemory}GB | languages=${(evasion.languages as string[]).join(",")} | touchPoints=${evasion.maxTouchPoints}`,
    });

    results.push({
      name: "Automation Markers",
      status:
        !evasion.hasChromiumAutomation && !evasion.hasPlaywrightBinding
          ? "PASS"
          : "FAIL",
      detail: `Chromium CDC: ${evasion.hasChromiumAutomation} | Playwright binding: ${evasion.hasPlaywrightBinding}`,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 12: Screenshots (Desktop, Tablet, Mobile)
  // ════════════════════════════════════════════════════════════════════════

  log("test", "12 — Screenshots");
  {
    const screenshotPaths: string[] = [];
    for (const vp of VIEWPORTS) {
      try {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(500);
        const filePath = path.join(
          SCREENSHOT_DIR,
          `functionality-${vp.label}-${vp.width}x${vp.height}.png`,
        );
        await page.screenshot({ path: filePath, fullPage: false });
        screenshotPaths.push(filePath);
        log("screenshot", `Saved ${vp.label} → ${filePath}`);
      } catch (e) {
        log("screenshot", `Failed ${vp.label}: ${String(e).slice(0, 100)}`);
      }
    }

    results.push({
      name: "Screenshots",
      status: screenshotPaths.length === VIEWPORTS.length ? "PASS" : "WARN",
      detail: `Captured ${screenshotPaths.length}/${VIEWPORTS.length}: ${screenshotPaths.map((p) => path.basename(p)).join(", ")}`,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 13: Login Page Navigation Check
  // ════════════════════════════════════════════════════════════════════════

  log("test", "13 — Login Page Navigation Check");
  {
    // Reset viewport to desktop
    await page.setViewportSize({ width: 1440, height: 900 });

    // Try to find and click a "Login" or "Sign In" link/button
    const loginSelector = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll("a, button, [role='button'], span"),
      );
      for (const el of candidates) {
        const text = ((el as HTMLElement).innerText || "").trim().toLowerCase();
        if (/^(log\s*in|sign\s*in|login)$/i.test(text)) {
          // Build a best-effort selector
          if ((el as HTMLElement).id) return `#${(el as HTMLElement).id}`;
          if (el.tagName === "A" && (el as HTMLAnchorElement).href)
            return `a[href="${(el as HTMLAnchorElement).getAttribute("href")}"]`;
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

        results.push({
          name: "Login Navigation",
          status: "PASS",
          detail: `Clicked login link → ${newUrl} (${elapsed}ms)`,
          durationMs: elapsed,
        });

        // Check if a login form appeared
        const hasLoginForm = await page.evaluate(() => {
          const inputs = Array.from(
            document.querySelectorAll(
              'input[type="email"], input[type="text"], input[type="password"]',
            ),
          );
          const passwordFields = inputs.filter(
            (i) => (i as HTMLInputElement).type === "password",
          );
          return passwordFields.length > 0;
        });

        results.push({
          name: "Login Form Present",
          status: hasLoginForm ? "PASS" : "INFO",
          detail: hasLoginForm
            ? "Password field detected on login page"
            : "No password field found after login click",
        });

        // Navigate back to homepage for remaining checks
        await page.goto(TARGET_URL, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_TIMEOUT_MS,
        });
        await page.waitForTimeout(4000);
      } catch (e) {
        results.push({
          name: "Login Navigation",
          status: "WARN",
          detail: `Could not click login link: ${String(e).slice(0, 200)}`,
        });
      }
    } else {
      results.push({
        name: "Login Navigation",
        status: "INFO",
        detail:
          "No distinct login link/button found (registration form may be inline on homepage)",
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TEST 14: JavaScript Execution & Page Interactivity
  // ════════════════════════════════════════════════════════════════════════

  log("test", "14 — JavaScript Execution & Page Interactivity");
  {
    const jsCheck = await page.evaluate(
      ():
        | { success: true; checks: Record<string, boolean> }
        | { success: false; error: string } => {
        try {
          // Basic JS execution
          const mathOk = Math.random() >= 0;
          const dateOk = new Date().getTime() > 0;
          const jsonOk = JSON.parse('{"ok":true}').ok === true;

          // DOM manipulation
          const testDiv = document.createElement("div");
          testDiv.id = "__manifold_test__";
          testDiv.style.display = "none";
          document.body.appendChild(testDiv);
          const domOk = !!document.getElementById("__manifold_test__");
          testDiv.remove();

          // LocalStorage
          let storageOk = false;
          try {
            localStorage.setItem("__manifold_test__", "1");
            storageOk = localStorage.getItem("__manifold_test__") === "1";
            localStorage.removeItem("__manifold_test__");
          } catch {
            storageOk = false;
          }

          // Fetch API available
          const fetchOk = typeof fetch === "function";

          // WebSocket available
          const wsOk = typeof WebSocket === "function";

          return {
            success: true,
            checks: { mathOk, dateOk, jsonOk, domOk, storageOk, fetchOk, wsOk },
          };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    );

    if (!jsCheck.success) {
      results.push({
        name: "JS Execution",
        status: "FAIL",
        detail: `Error: ${jsCheck.error}`,
      });
    } else {
      const checks = jsCheck.checks;
      const allOk = Object.values(checks).every(Boolean);
      const details = Object.entries(checks)
        .map(([k, v]) => `${k}:${v ? "✓" : "✗"}`)
        .join(" ");
      results.push({
        name: "JS Execution",
        status: allOk ? "PASS" : "WARN",
        detail: details,
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Cleanup & Report
  // ════════════════════════════════════════════════════════════════════════

  await browser.close();
  log("browser", "Closed.");

  const totalDuration = Date.now() - allStart;
  printReport(results, totalDuration);
}

// ── Report Printer ──────────────────────────────────────────────────────────

function printReport(results: TestResult[], totalDurationMs: number): void {
  console.log("\n");
  console.log("═".repeat(72));
  console.log("  MANIFOLD FUNCTIONALITY TEST REPORT");
  console.log("═".repeat(72));
  console.log(`  Target:   ${TARGET_URL}`);
  console.log(`  Duration: ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Tests:    ${results.length}`);
  console.log("─".repeat(72));

  const maxNameLen = Math.max(...results.map((r) => r.name.length), 10);

  for (const r of results) {
    const padded = r.name.padEnd(maxNameLen + 2);
    const dur = r.durationMs ? ` (${r.durationMs}ms)` : "";
    console.log(`  ${badge(r.status)}  ${padded} ${r.detail}${dur}`);
  }

  console.log("─".repeat(72));

  // Summary counts
  const counts = { PASS: 0, WARN: 0, FAIL: 0, INFO: 0 };
  for (const r of results) counts[r.status]++;

  console.log(
    `  Summary: ✅ ${counts.PASS} passed | ⚠️  ${counts.WARN} warnings | ❌ ${counts.FAIL} failed | ℹ️  ${counts.INFO} info`,
  );

  const overallStatus =
    counts.FAIL > 0 ? "FAIL" : counts.WARN > 3 ? "WARN" : "PASS";
  console.log(`  Overall:  ${badge(overallStatus)}`);
  console.log("═".repeat(72));
  console.log("");

  // Save JSON report
  const reportPath = path.join(SCREENSHOT_DIR, "functionality-report.json");
  const report = {
    url: TARGET_URL,
    timestamp: new Date().toISOString(),
    durationMs: totalDurationMs,
    summary: counts,
    overallStatus,
    results,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`  📄 JSON report saved: ${reportPath}`);
  console.log(`  📸 Screenshots saved: ${SCREENSHOT_DIR}`);
  console.log("");
}

// ── Entry Point ─────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
