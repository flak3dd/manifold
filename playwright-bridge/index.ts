// ── Manifold Playwright Bridge ────────────────────────────────────────────────
//
// Entry point for the bridge process. Reads MANIFOLD_LAUNCH_CONFIG from the
// environment, launches a hardened Chromium instance with all evasions applied,
// and exposes a WebSocket server for the frontend / automation runner.
//
// Lifecycle:
//   1. Parse MANIFOLD_LAUNCH_CONFIG (JSON)
//   2. Build EvasionConfig from profile fingerprint
//   3. Launch Chromium (with proxy, viewport, locale, timezone)
//   4. Apply all evasions (init scripts + header route interceptor)
//   5. Install HAR capture route
//   6. Navigate to initial URL
//   7. Start WebSocket server
//   8. Broadcast "ready" to the first client that connects
//   9. Dispatch incoming ClientMessages → page actions
//  10. Push ServerMessages back to all connected clients
//
// Usage:
//   MANIFOLD_LAUNCH_CONFIG='{"profile":{...},"proxy":null,"url":"https://example.com","wsPort":8766}' \
//   tsx playwright-bridge/index.ts

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { WebSocketServer } from "ws";
import type { WebSocket as WsSocket } from "ws";
import type {
  Browser,
  BrowserContext,
  Page,
  Route,
  Request as PwRequest,
} from "playwright";

// ── Enable Stealth Plugin for anti-detection ──────────────────────────────────
chromium.use(StealthPlugin());

import type {
  LaunchConfig,
  ClientMessage,
  ServerMessage,
  HarEntry,
  EntropyLog,
  EvasionConfig,
} from "./types.js";

import { applyAllEvasions, buildEvasionConfig } from "../evasions/index.js";

import { HumanBehaviorMiddleware } from "../human/index.js";

import { LoginRunner } from "./login-runner.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_WS_PORT = 8766;
const ENTROPY_SCRIPT_INTERVAL_MS = 30_000; // capture entropy every 30 s

// ── Parse launch config ───────────────────────────────────────────────────────

function parseLaunchConfig(): LaunchConfig {
  const raw = process.env["MANIFOLD_LAUNCH_CONFIG"];
  if (!raw) {
    // Default config for dev mode
    return {
      profile: {
        id: "dev",
        name: "Dev Profile",
        status: "idle" as const,
        fingerprint: {
          seed: 12345,
          canvas_noise: 0.1,
          webgl_vendor: "Intel Inc.",
          webgl_renderer: "Intel(R) UHD Graphics",
          webgl_noise: 0.1,
          audio_noise: 0.1,
          font_subset: ["Arial", "Helvetica"],
          user_agent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          platform: "Win32",
          accept_language: "en-US,en;q=0.9",
          hardware_concurrency: 8,
          device_memory: 8,
          screen_width: 1920,
          screen_height: 1080,
          viewport_width: 1920,
          viewport_height: 1080,
          color_depth: 24,
          pixel_ratio: 1,
          webrtc_mode: "block" as const,
          webrtc_fake_mdns: null,
          webrtc_fake_ip: null,
          timezone: "America/New_York",
          locale: "en-US",
          ua_brands: [{ brand: "Google Chrome", version: "120" }],
          ua_mobile: false,
          ua_platform: "Windows",
          ua_platform_version: "10.0.0",
          ua_architecture: "x86",
          ua_bitness: "64",
          permissions: { geolocation: "prompt" },
        },
        human: {
          profile: "normal" as const,
          mouse: {
            base_speed_px_per_sec: 500,
            speed_jitter: 0.1,
            curve_scatter: 5,
            overshoot_prob: 0.1,
            overshoot_max_px: 10,
            pre_click_pause_max_ms: 100,
            micro_jitter_prob: 0.05,
          },
          typing: {
            base_wpm: 60,
            wpm_jitter: 0.1,
            burst_min_chars: 5,
            burst_max_chars: 10,
            pause_min_ms: 50,
            pause_max_ms: 200,
            typo_rate: 0.01,
            typo_correct_min_ms: 100,
            typo_correct_max_ms: 300,
            double_tap_rate: 0.02,
            think_before_long_fields: true,
            think_pause_min_ms: 500,
            think_pause_max_ms: 2000,
          },
          scroll: {
            initial_velocity_px: 100,
            momentum_decay: 0.9,
            min_velocity_px: 10,
            tick_min_ms: 10,
            tick_max_ms: 50,
            overshoot_prob: 0.05,
            overshoot_max_px: 5,
          },
          macro_b: {
            page_load_pause_min_ms: 2000,
            page_load_pause_max_ms: 5000,
            inter_action_min_ms: 1000,
            inter_action_max_ms: 3000,
            idle_pause_prob: 0.1,
            idle_pause_min_ms: 500,
            idle_pause_max_ms: 2000,
            random_premove_prob: 0.05,
          },
        },
        proxy_id: null,
        notes: "",
        tags: [],
        created_at: new Date().toISOString(),
        last_used: null,
        data_dir: "",
      },
      proxy: null,
      url: "https://www.google.com",
      wsPort: 8766,
    };
  }
  try {
    return JSON.parse(raw) as LaunchConfig;
  } catch (e) {
    throw new Error(`Failed to parse MANIFOLD_LAUNCH_CONFIG: ${String(e)}`);
  }
}

// ── Entropy capture script ────────────────────────────────────────────────────
//
// Runs inside the page context and returns an EntropyLog snapshot.

const ENTROPY_SCRIPT = /* js */ `(function () {
  'use strict';

  // ── Canvas hash ─────────────────────────────────────────────────────────
  function canvasHash() {
    try {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 50;
      const ctx = c.getContext('2d');
      if (!ctx) return 'n/a';
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('manifold', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('manifold', 4, 17);
      const data = c.toDataURL();
      let h = 0;
      for (let i = 0; i < data.length; i++) {
        h = (Math.imul(31, h) + data.charCodeAt(i)) | 0;
      }
      return (h >>> 0).toString(16).padStart(8, '0');
    } catch (_) { return 'err'; }
  }

  // ── WebGL hash ──────────────────────────────────────────────────────────
  function webglHash() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return 'n/a';
      const vendor   = gl.getParameter(gl.VENDOR);
      const renderer = gl.getParameter(gl.RENDERER);
      const raw = vendor + '|' + renderer;
      let h = 0;
      for (let i = 0; i < raw.length; i++) {
        h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
      }
      return (h >>> 0).toString(16).padStart(8, '0');
    } catch (_) { return 'err'; }
  }

  // ── Audio hash ──────────────────────────────────────────────────────────
  function audioHash() {
    try {
      const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 10000;
      const comp = ctx.createDynamicsCompressor();
      ['threshold','knee','ratio','reduction','attack','release'].forEach(k => {
        if (comp[k] !== undefined) comp[k].value = comp[k].defaultValue ?? comp[k].value;
      });
      osc.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
      // synchronous approximation — real fingerprint uses renderedBuffer
      const fingerprint = String(comp.knee.value) + comp.threshold.value;
      let h = 0;
      for (let i = 0; i < fingerprint.length; i++) {
        h = (Math.imul(31, h) + fingerprint.charCodeAt(i)) | 0;
      }
      return (h >>> 0).toString(16).padStart(8, '0');
    } catch (_) { return 'err'; }
  }

  // ── Font count ──────────────────────────────────────────────────────────
  function fontCount() {
    try {
      if (document.fonts && typeof document.fonts.size === 'number') {
        return document.fonts.size;
      }
    } catch (_) {}
    return -1;
  }

  // ── WebRTC leak check ───────────────────────────────────────────────────
  // Returns true if a non-mDNS host candidate is emitted within 500 ms.
  // We skip the async check here and just report whether RTCPeerConnection exists.
  function webrtcLeak() {
    try {
      return typeof RTCPeerConnection !== 'undefined' &&
             RTCPeerConnection.toString().includes('[native code]');
    } catch (_) { return false; }
  }

  return {
    ts: Date.now(),
    canvas_hash: canvasHash(),
    webgl_hash:  webglHash(),
    audio_hash:  audioHash(),
    font_count:  fontCount(),
    screen: {
      width:      screen.width,
      height:     screen.height,
      pixelRatio: window.devicePixelRatio,
    },
    navigator: {
      userAgent:           navigator.userAgent,
      platform:            navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory:        navigator.deviceMemory,
      languages:           Array.from(navigator.languages),
      webdriver:           navigator.webdriver,
    },
    webrtc_leak: webrtcLeak(),
    timezone:    Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
})()`;

// ── Bridge session ────────────────────────────────────────────────────────────

interface BridgeSession {
  sessionId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  human: HumanBehaviorMiddleware;
  harEntries: HarEntry[];
  entropyLogs: EntropyLog[];
  entropyTimer: ReturnType<typeof setInterval> | null;
  alive: boolean;
}

// ── Broadcast helper ──────────────────────────────────────────────────────────

function broadcast(clients: Set<WsSocket>, msg: ServerMessage): void {
  const frame = JSON.stringify(msg);
  for (const ws of Array.from(clients)) {
    if (ws.readyState === ws.OPEN) {
      ws.send(frame);
    }
  }
}

function send(ws: WsSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── HAR route handler ─────────────────────────────────────────────────────────

function installHarCapture(page: Page, harEntries: HarEntry[]): void {
  page.on("request", (req) => {
    // Tag request start time (ms since epoch)
    (req as unknown as Record<string, unknown>)["_manifoldTs"] = Date.now();
  });

  page.on("response", async (res) => {
    const req = res.request();
    const startTs: number =
      ((req as unknown as Record<string, unknown>)["_manifoldTs"] as number) ??
      Date.now();
    const time = Date.now() - startTs;

    const reqHeaders = Object.entries(req.headers()).map(([name, value]) => ({
      name,
      value,
    }));
    const resHeaders = Object.entries(res.headers()).map(([name, value]) => ({
      name,
      value,
    }));

    let bodySize = -1;
    try {
      const body = await res.body();
      bodySize = body.byteLength;
    } catch {
      // body might be unavailable for some resource types
    }

    const entry: HarEntry = {
      ts: startTs,
      method: req.method(),
      url: req.url(),
      status: res.status(),
      statusText: res.statusText(),
      requestHeaders: reqHeaders,
      responseHeaders: resHeaders,
      mimeType: res.headers()["content-type"] ?? "application/octet-stream",
      bodySize,
      time,
    };

    harEntries.push(entry);

    // Keep a rolling window of 2 000 entries to avoid unbounded memory
    if (harEntries.length > 2_000) {
      harEntries.splice(0, harEntries.length - 2_000);
    }
  });
}

// ── Entropy capture ───────────────────────────────────────────────────────────

async function captureEntropy(
  session: BridgeSession,
  clients: Set<WsSocket>,
): Promise<void> {
  try {
    const snap = (await session.page.evaluate(ENTROPY_SCRIPT)) as EntropyLog;
    session.entropyLogs.push(snap);
    broadcast(clients, {
      type: "entropy",
      sessionId: session.sessionId,
      log: snap,
    });
  } catch (e) {
    // Page may have navigated; non-fatal
    console.warn("[bridge] entropy capture failed:", String(e).slice(0, 120));
  }
}

// ── Launch browser session ────────────────────────────────────────────────────

async function launchSession(cfg: LaunchConfig): Promise<BridgeSession> {
  const { profile, proxy, url } = cfg;
  const fp = profile.fingerprint;
  const evasionCfg: EvasionConfig = buildEvasionConfig(profile);
  const sessionId = crypto.randomUUID();

  // ── Chromium launch args (enhanced anti-detection) ──────────────────────
  const launchArgs: string[] = [
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
    "--disable-infobars",
    "--disable-notifications",
    `--lang=${fp.locale.replace("_", "-")}`,
    `--window-size=${fp.screen_width},${fp.screen_height}`,
  ];

  const browser = await chromium.launch({
    headless: false,
    args: launchArgs,
    ignoreDefaultArgs: ["--enable-automation"],
  });

  // ── Browser context ─────────────────────────────────────────────────────
  const contextOptions: Parameters<Browser["newContext"]>[0] = {
    viewport: {
      width: fp.viewport_width,
      height: fp.viewport_height,
    },
    deviceScaleFactor: fp.pixel_ratio,
    userAgent: fp.user_agent,
    locale: fp.locale.replace("_", "-"),
    timezoneId: fp.timezone,
    colorScheme: "dark",
    acceptDownloads: true,
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: {
      "Accept-Language": fp.accept_language,
    },
  };

  if (proxy) {
    contextOptions.proxy = {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
    };
  }

  const context = await browser.newContext(contextOptions);

  // Block known tracking / analytics that inflate bot scores
  await context.route(
    /google-analytics\.com|doubleclick\.net|googlesyndication\.com|scorecardresearch\.com|quantserve\.com|hotjar\.com|mouseflow\.com|fullstory\.com/,
    (route) => route.abort(),
  );

  const page = await context.newPage();

  // ── Apply evasions ──────────────────────────────────────────────────────
  await applyAllEvasions(page, evasionCfg);

  // ── Additional anti-detection: intercept and handle automation markers ──
  page.on("response", (res) => {
    if (res.status() === 429 || res.status() === 403) {
      page
        .evaluate((s: number) => {
          (window as any).__manifold_last_status = s;
        }, res.status())
        .catch(() => {});
    }
  });

  // ── HAR capture ─────────────────────────────────────────────────────────
  const harEntries: HarEntry[] = [];
  installHarCapture(page, harEntries);

  // ── Human behavior middleware ────────────────────────────────────────────
  const human = new HumanBehaviorMiddleware(page, profile.human, fp.seed);

  // ── Initial navigation ──────────────────────────────────────────────────
  const targetUrl = url && url !== "about:blank" ? url : undefined;
  if (targetUrl) {
    try {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } catch (e) {
      console.warn(
        "[bridge] initial navigation failed:",
        String(e).slice(0, 120),
      );
    }
  }

  return {
    sessionId,
    browser,
    context,
    page,
    human,
    harEntries,
    entropyLogs: [],
    entropyTimer: null,
    alive: true,
  };
}

// ── Message dispatcher ────────────────────────────────────────────────────────

async function dispatch(
  ws: WsSocket,
  clients: Set<WsSocket>,
  msg: ClientMessage,
  session: BridgeSession,
  loginRunnerRef: { current: LoginRunner | null },
): Promise<void> {
  const { page, human, sessionId } = session;

  switch (msg.type) {
    // ── Ping ──────────────────────────────────────────────────────────────
    case "ping": {
      send(ws, { type: "pong" });
      return;
    }

    // ── Navigate ──────────────────────────────────────────────────────────
    case "navigate": {
      try {
        const resp = await page.goto(msg.url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        broadcast(clients, {
          type: "navigate_done",
          sessionId,
          url: page.url(),
          status: resp?.status() ?? 200,
        });
      } catch (e) {
        send(ws, {
          type: "error",
          sessionId,
          error: `navigate failed: ${String(e).slice(0, 200)}`,
        });
      }
      return;
    }

    // ── Screenshot ────────────────────────────────────────────────────────
    case "screenshot": {
      try {
        const buf = await page.screenshot({ type: "png" });
        const data = buf.toString("base64");
        send(ws, { type: "screenshot", sessionId, data });
      } catch (e) {
        send(ws, {
          type: "error",
          sessionId,
          error: `screenshot failed: ${String(e).slice(0, 200)}`,
        });
      }
      return;
    }

    // ── Execute arbitrary script ──────────────────────────────────────────
    case "execute": {
      try {
        // Scripts run in Node.js context via Function constructor so they
        // can use the full `page` / `human` API surface.
        // The script receives (page, human) as named parameters.
        const AsyncFn = Object.getPrototypeOf(async function () {})
          .constructor as {
          new (...args: string[]): (...a: unknown[]) => Promise<unknown>;
        };
        const fn = new AsyncFn("page", "human", msg.script);
        const value = await fn(page, human);
        broadcast(clients, { type: "execute_result", sessionId, value });
      } catch (e) {
        send(ws, {
          type: "error",
          sessionId,
          error: `execute failed: ${String(e).slice(0, 400)}`,
        });
      }
      return;
    }

    // ── Human click ───────────────────────────────────────────────────────
    case "click": {
      try {
        await human.click(msg.selector);
        broadcast(clients, {
          type: "log",
          sessionId,
          level: "info",
          message: `Clicked: ${msg.selector}`,
        });
      } catch (e) {
        send(ws, {
          type: "error",
          sessionId,
          error: `click failed: ${String(e).slice(0, 200)}`,
        });
      }
      return;
    }

    // ── Human type ────────────────────────────────────────────────────────
    case "type": {
      try {
        await human.type(msg.selector, msg.text);
        broadcast(clients, {
          type: "log",
          sessionId,
          level: "info",
          message: `Typed into: ${msg.selector}`,
        });
      } catch (e) {
        send(ws, {
          type: "error",
          sessionId,
          error: `type failed: ${String(e).slice(0, 200)}`,
        });
      }
      return;
    }

    // ── Human scroll ──────────────────────────────────────────────────────
    case "scroll": {
      try {
        if (msg.selector) {
          await human.scrollElement(msg.selector, msg.deltaY);
        } else {
          await human.scrollPage(msg.deltaY);
        }
        broadcast(clients, {
          type: "log",
          sessionId,
          level: "info",
          message: `Scrolled ${msg.deltaY > 0 ? "↓" : "↑"} on: ${msg.selector || "page"}`,
        });
      } catch (e) {
        send(ws, {
          type: "error",
          sessionId,
          error: `scroll failed: ${String(e).slice(0, 200)}`,
        });
      }
      return;
    }

    // ── Extract text content ──────────────────────────────────────────────
    case "extract": {
      try {
        const items = await page.$$eval(msg.selector, (els) =>
          els.map(
            (el) => (el as HTMLElement).innerText ?? el.textContent ?? "",
          ),
        );
        send(ws, { type: "extract_result", sessionId, items });
      } catch (e) {
        send(ws, {
          type: "error",
          sessionId,
          error: `extract failed: ${String(e).slice(0, 200)}`,
        });
      }
      return;
    }

    // ── HAR export ────────────────────────────────────────────────────────
    case "har_export": {
      try {
        const har = buildHar(session);
        send(ws, { type: "har_export", sessionId, har: JSON.stringify(har) });
      } catch (e) {
        send(ws, {
          type: "error",
          sessionId,
          error: `har_export failed: ${String(e).slice(0, 200)}`,
        });
      }
      return;
    }

    // ── Stop session ──────────────────────────────────────────────────────
    case "stop": {
      await teardown(session, clients);
      return;
    }

    // ── Form scraping ─────────────────────────────────────────────────────
    case "scrape_form": {
      const scrapeUrl = msg.url;
      const scrapeTimeout = msg.timeout ?? 15000;
      let scrapePage: import("playwright").Page | null = null;
      try {
        const context = page.context();
        scrapePage = await context.newPage();
        await scrapePage.goto(scrapeUrl, {
          waitUntil: "domcontentloaded",
          timeout: scrapeTimeout,
        });

        // Run form-detection logic inside the browser JS context
        const result = await scrapePage.evaluate(() => {
          function scoreEl(el: Element, hints: string[]): number {
            let s = 0;
            const attrs = [
              (el as HTMLElement).id ?? "",
              el.getAttribute("name") ?? "",
              el.getAttribute("type") ?? "",
              el.getAttribute("placeholder") ?? "",
              el.getAttribute("autocomplete") ?? "",
              el.getAttribute("aria-label") ?? "",
              el.className ?? "",
            ]
              .join(" ")
              .toLowerCase();
            for (const h of hints) if (attrs.includes(h)) s += 10;
            return s;
          }

          function bestSelector(el: Element): string {
            if (el.id) return `#${el.id}`;
            if (el.getAttribute("name"))
              return `[name="${el.getAttribute("name")}"]`;
            if (el.getAttribute("type"))
              return `${el.tagName.toLowerCase()}[type="${el.getAttribute("type")}"]`;
            return el.tagName.toLowerCase();
          }

          function findBest(
            hints: string[],
            tags = "input,button,select",
          ): string | undefined {
            let best: Element | null = null;
            let bestScore = 0;
            document.querySelectorAll(tags).forEach((el) => {
              const s = scoreEl(el, hints);
              if (s > bestScore) {
                bestScore = s;
                best = el;
              }
            });
            return best && bestScore > 0 ? bestSelector(best) : undefined;
          }

          const usernameHints = [
            "email",
            "user",
            "login",
            "username",
            "account",
            "identifier",
          ];
          const passwordHints = ["password", "passwd", "pass", "secret"];
          const submitHints = [
            "submit",
            "login",
            "sign in",
            "signin",
            "continue",
            "next",
            "log in",
          ];
          const successHints = [
            "dashboard",
            "welcome",
            "account",
            "profile",
            "logout",
            "sign out",
          ];
          const captchaHints = [
            "captcha",
            "recaptcha",
            "hcaptcha",
            "cf-turnstile",
          ];
          const totpHints = [
            "otp",
            "totp",
            "2fa",
            "mfa",
            "verification",
            "code",
            "token",
            "authenticator",
          ];

          const usernameEl =
            document.querySelector('input[type="email"]') ||
            document.querySelector('input[type="text"][name*="user"]') ||
            document.querySelector('input[type="text"][name*="email"]') ||
            document.querySelector('input[autocomplete="username"]') ||
            document.querySelector('input[autocomplete="email"]');

          const passwordEl = document.querySelector('input[type="password"]');

          const username_selector = usernameEl
            ? bestSelector(usernameEl)
            : findBest(usernameHints);
          const password_selector = passwordEl
            ? bestSelector(passwordEl)
            : findBest(passwordHints);
          const submit_selector = findBest(
            submitHints,
            "button,input[type='submit'],a",
          );
          const success_selector = findBest(
            successHints,
            "a,button,nav,header",
          );
          const captcha_selector = findBest(captchaHints, "div,iframe,script");
          const totp_selector = findBest(totpHints);

          const html = document.documentElement.innerHTML.toLowerCase();
          const is_spa = !!(
            document.querySelector(
              "[data-reactroot],[data-reactid],#__next,#__nuxt,#app[data-v-]",
            ) ||
            html.includes("_next/static") ||
            html.includes("__NUXT__") ||
            html.includes("ng-version")
          );
          const has_captcha = !!(
            html.includes("recaptcha") ||
            html.includes("hcaptcha") ||
            html.includes("cf-turnstile") ||
            html.includes("arkose")
          );
          const has_mfa = !!(
            html.includes("two-factor") ||
            html.includes("2fa") ||
            html.includes("authenticator") ||
            html.includes("verification code")
          );

          let confidence = 0;
          if (username_selector) confidence += 30;
          if (password_selector) confidence += 30;
          if (submit_selector) confidence += 25;
          if (success_selector) confidence += 10;
          if (username_selector && password_selector && submit_selector)
            confidence += 5;

          const details: string[] = [];
          if (username_selector)
            details.push(`username: "${username_selector}"`);
          if (password_selector)
            details.push(`password: "${password_selector}"`);
          if (submit_selector) details.push(`submit: "${submit_selector}"`);
          if (is_spa) details.push("SPA detected");
          if (has_captcha) details.push("CAPTCHA detected");
          if (has_mfa) details.push("MFA detected");

          return {
            confidence,
            username_selector,
            password_selector,
            submit_selector,
            success_selector,
            captcha_selector,
            totp_selector,
            is_spa,
            spa_framework: undefined as string | undefined,
            has_captcha,
            captcha_providers: has_captcha ? ["detected"] : ([] as string[]),
            has_mfa,
            mfa_type: undefined as string | undefined,
            details,
          };
        });

        send(ws, { type: "scrape_form_result", result });
      } catch (e) {
        send(ws, {
          type: "scrape_form_result",
          result: {
            confidence: 0,
            is_spa: false,
            has_captcha: false,
            captcha_providers: [],
            has_mfa: false,
            details: [],
            error: `scrape_form failed: ${String(e).slice(0, 300)}`,
          },
        });
      } finally {
        if (scrapePage && !scrapePage.isClosed()) await scrapePage.close();
      }
      return;
    }

    // ── Login automation ──────────────────────────────────────────────────
    case "login_start": {
      const broadcastFn = (payload: object) => {
        broadcast(clients, payload as Parameters<typeof broadcast>[1]);
      };

      loginRunnerRef.current = new LoginRunner(
        msg.profiles,
        msg.proxies,
        broadcastFn,
      );
      loginRunnerRef.current.start(msg.run).catch((e: unknown) => {
        broadcast(clients, {
          type: "login_error",
          run_id: msg.run.id,
          message: String(e),
        });
      });
      return;
    }

    case "login_pause": {
      loginRunnerRef.current?.pause();
      return;
    }

    case "login_resume": {
      loginRunnerRef.current?.resume();
      return;
    }

    case "login_abort": {
      loginRunnerRef.current?.abort();
      return;
    }

    default: {
      send(ws, {
        type: "error",
        sessionId,
        error: `Unknown message type: ${(msg as { type: string }).type}`,
      });
    }
  }
}

// ── HAR builder (HAR 1.2 format) ─────────────────────────────────────────────

function buildHar(session: BridgeSession): object {
  const { harEntries, sessionId } = session;

  const entries = harEntries.map((e) => ({
    startedDateTime: new Date(e.ts).toISOString(),
    time: e.time,
    request: {
      method: e.method,
      url: e.url,
      httpVersion: "HTTP/2",
      headers: e.requestHeaders,
      queryString: [],
      cookies: [],
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: e.status,
      statusText: e.statusText,
      httpVersion: "HTTP/2",
      headers: e.responseHeaders,
      cookies: [],
      content: {
        size: e.bodySize,
        mimeType: e.mimeType,
      },
      redirectURL: "",
      headersSize: -1,
      bodySize: e.bodySize,
    },
    cache: {},
    timings: {
      send: 0,
      wait: e.time,
      receive: 0,
    },
  }));

  return {
    log: {
      version: "1.2",
      creator: { name: "Manifold", version: "0.1.0" },
      comment: `Session ${sessionId}`,
      entries,
    },
  };
}

// ── Teardown ──────────────────────────────────────────────────────────────────

async function teardown(
  session: BridgeSession,
  clients: Set<WsSocket>,
): Promise<void> {
  if (!session.alive) return;
  session.alive = false;

  if (session.entropyTimer) {
    clearInterval(session.entropyTimer);
    session.entropyTimer = null;
  }

  broadcast(clients, { type: "stopped", sessionId: session.sessionId });

  try {
    await session.context.close();
  } catch {
    // ignore
  }
  try {
    await session.browser.close();
  } catch {
    // ignore
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Parse config
  const cfg = parseLaunchConfig();
  const wsPort = cfg.wsPort ?? DEFAULT_WS_PORT;

  console.log(`[bridge] starting — profile=${cfg.profile.id} port=${wsPort}`);

  // 2. Launch browser session
  let session: BridgeSession;
  const loginRunnerRef: { current: LoginRunner | null } = { current: null };
  try {
    session = await launchSession(cfg);
    console.log(`[bridge] session=${session.sessionId} launched`);
  } catch (e) {
    console.error("[bridge] failed to launch browser:", e);
    process.exit(1);
  }

  // 3. Start WebSocket server
  const wss = new WebSocketServer({ port: wsPort });
  const clients = new Set<WsSocket>();

  console.log(
    `[bridge] WebSocket server listening on ws://localhost:${wsPort}`,
  );

  // 4. Start periodic entropy capture
  session.entropyTimer = setInterval(async () => {
    if (!session.alive) return;
    await captureEntropy(session, clients);
  }, ENTROPY_SCRIPT_INTERVAL_MS);

  // Also capture entropy once on first page load (with a slight delay)
  setTimeout(() => captureEntropy(session, clients), 3_000);

  // 5. Handle connections
  wss.on("connection", (ws: WsSocket) => {
    clients.add(ws);
    console.log(`[bridge] client connected (total=${clients.size})`);

    // Announce ready state
    send(ws, {
      type: "ready",
      sessionId: session.sessionId,
      wsPort,
    });

    // Send current URL as a navigate_done so the UI syncs immediately
    const currentUrl = session.page.url();
    if (currentUrl && currentUrl !== "about:blank") {
      send(ws, {
        type: "navigate_done",
        sessionId: session.sessionId,
        url: currentUrl,
        status: 200,
      });
    }

    ws.on("message", async (raw: Buffer | string) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send(ws, {
          type: "error",
          sessionId: session.sessionId,
          error: "Malformed JSON frame",
        });
        return;
      }

      if (!session.alive) {
        send(ws, {
          type: "error",
          sessionId: session.sessionId,
          error: "Session has already been stopped",
        });
        return;
      }

      await dispatch(ws, clients, msg, session, loginRunnerRef);
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`[bridge] client disconnected (total=${clients.size})`);
    });

    ws.on("error", (err) => {
      console.warn("[bridge] ws error:", String(err).slice(0, 120));
      clients.delete(ws);
    });
  });

  // 6. Forward page console messages to all clients
  session.page.on("console", (msg) => {
    if (!session.alive || clients.size === 0) return;
    const level = msg.type() as "info" | "warn" | "error";
    broadcast(clients, {
      type: "log",
      sessionId: session.sessionId,
      level: ["info", "warn", "error"].includes(level) ? level : "info",
      message: `[page:${msg.type()}] ${msg.text().slice(0, 400)}`,
    });
  });

  // 7. Forward page crashes / close
  session.page.on("crash", () => {
    broadcast(clients, {
      type: "error",
      sessionId: session.sessionId,
      error: "Page crashed",
    });
    void teardown(session, clients);
  });

  session.page.on("close", () => {
    if (!session.alive) return;
    broadcast(clients, {
      type: "stopped",
      sessionId: session.sessionId,
    });
    session.alive = false;
  });

  // 8. Graceful shutdown on SIGINT / SIGTERM
  async function shutdown(signal: string): Promise<void> {
    console.log(`[bridge] received ${signal} — shutting down`);
    await teardown(session, clients);
    wss.close(() => {
      console.log("[bridge] WebSocket server closed");
      process.exit(0);
    });
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // 9. Emit process-level ready signal (read by Tauri sidecar manager)
  process.stdout.write("BRIDGE_READY\n");
}

main().catch((e) => {
  console.error("[bridge] fatal:", e);
  process.exit(1);
});
