/**
 * Test Proxy Connection
 *
 * This script verifies that the proxy configuration is working correctly
 * and can be loaded/rotated properly.
 *
 * Usage:
 *   npx tsx scripts/test-proxy-connection.ts
 */

import { chromium, type Browser, type BrowserContext } from "playwright";

// ─────────────────────────────────────────────────────────────────────────────
// Proxy Configuration (via env)
// ─────────────────────────────────────────────────────────────────────────────

type ProxyEnvConfig = {
  scheme: "http" | "https" | "socks5";
  host: string;
  port: number;
  username: string;
  password: string;
};

function readProxyFromEnv(): ProxyEnvConfig {
  const scheme = (process.env.PROXY_SCHEME ?? "http") as ProxyEnvConfig["scheme"];
  const host = (process.env.PROXY_HOST ?? "").trim();
  const port = Number.parseInt(process.env.PROXY_PORT ?? "", 10);
  const username = (process.env.PROXY_USERNAME ?? "").trim();
  const password = (process.env.PROXY_PASSWORD ?? "").trim();

  if (!host || !Number.isFinite(port) || port < 1 || port > 65535 || !username || !password) {
    throw new Error(
      "Missing proxy env vars. Set: PROXY_HOST, PROXY_PORT, PROXY_USERNAME, PROXY_PASSWORD (and optional PROXY_SCHEME=http|https|socks5).",
    );
  }

  return { scheme, host, port, username, password };
}

const PROXY_CONFIG = readProxyFromEnv();

// Test URLs for IP verification
const IP_CHECK_URLS = [
  "https://api.ipify.org?format=json",
  "https://ipinfo.io/json",
  "https://httpbin.org/ip",
];

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
  return Math.random().toString(36).substring(2, 10);
}

function buildProxyUrl(sessionId?: string): string {
  const username = sessionId
    ? `${PROXY_CONFIG.username},session_${sessionId}`
    : PROXY_CONFIG.username;
  void username; // username is applied via Playwright proxy auth object
  return `${PROXY_CONFIG.scheme}://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`;
}

function buildProxyAuth(sessionId?: string): {
  server: string;
  username: string;
  password: string;
} {
  const username = sessionId
    ? `${PROXY_CONFIG.username},session_${sessionId}`
    : PROXY_CONFIG.username;
  return {
    server: `${PROXY_CONFIG.scheme}://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`,
    username,
    password: PROXY_CONFIG.password,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// IP Check Functions
// ─────────────────────────────────────────────────────────────────────────────

async function getIPWithProxy(
  browser: Browser,
  proxyAuth: ReturnType<typeof buildProxyAuth>,
  label: string,
): Promise<{ ip: string | null; country?: string; error?: string }> {
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({
      proxy: proxyAuth,
      locale: "en-AU",
      timezoneId: "Australia/Sydney",
    });

    const page = await context.newPage();

    // Try each IP check URL
    for (const url of IP_CHECK_URLS) {
      try {
        log(`  [${label}] Checking IP via ${new URL(url).hostname}...`);
        const response = await page.goto(url, {
          timeout: 30000,
          waitUntil: "domcontentloaded",
        });

        if (response && response.ok()) {
          const text = await page.textContent("body");
          if (text) {
            try {
              const json = JSON.parse(text.trim());
              const ip = json.ip || json.origin || null;
              const country = json.country || json.country_code || undefined;
              return { ip, country };
            } catch {
              // Not JSON, try to extract IP from text
              const ipMatch = text.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
              if (ipMatch) {
                return { ip: ipMatch[0] };
              }
            }
          }
        }
      } catch (e) {
        log(`  [${label}] Failed with ${new URL(url).hostname}: ${e}`, "warn");
        continue;
      }
    }

    return { ip: null, error: "All IP check services failed" };
  } catch (e) {
    return { ip: null, error: String(e) };
  } finally {
    if (context) {
      await context.close();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Test
// ─────────────────────────────────────────────────────────────────────────────

async function testProxyConnection(): Promise<void> {
  log("═".repeat(70));
  log("PROXY CONNECTION TEST");
  log("═".repeat(70));
  log(`Host: ${PROXY_CONFIG.host}`);
  log(`Port: ${PROXY_CONFIG.port}`);
  log(`Auth: enabled (credentials provided via env)`);
  log("");

  let browser: Browser | null = null;

  try {
    log("Launching browser...");
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });

    // Test 1: Basic proxy connection (no session)
    log("\n─── Test 1: Basic Proxy Connection ───");
    const basicProxy = buildProxyAuth();
    log(`Proxy URL: ${basicProxy.server}`);

    const basicResult = await getIPWithProxy(browser, basicProxy, "Basic");
    if (basicResult.ip) {
      log(`IP Address: ${basicResult.ip}`, "success");
      if (basicResult.country) {
        log(`Country: ${basicResult.country}`, "success");
      }
    } else {
      log(`Failed: ${basicResult.error}`, "error");
    }

    // Test 2: Proxy with session rotation
    log("\n─── Test 2: Session Rotation Test ───");
    const sessions: Array<{
      sessionId: string;
      ip: string | null;
      country?: string;
    }> = [];

    for (let i = 1; i <= 3; i++) {
      const sessionId = generateSessionId();
      const rotatedProxy = buildProxyAuth(sessionId);

      log(`\nSession ${i}: ${sessionId}`);

      const result = await getIPWithProxy(
        browser,
        rotatedProxy,
        `Session-${i}`,
      );
      sessions.push({ sessionId, ip: result.ip, country: result.country });

      if (result.ip) {
        log(`IP Address: ${result.ip}`, "success");
        if (result.country) {
          log(`Country: ${result.country}`, "success");
        }
      } else {
        log(`Failed: ${result.error}`, "error");
      }

      // Brief pause between sessions
      if (i < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Summary
    log("\n" + "═".repeat(70));
    log("SUMMARY");
    log("═".repeat(70));

    const successfulSessions = sessions.filter((s) => s.ip !== null);
    const uniqueIPs = new Set(successfulSessions.map((s) => s.ip));

    log(`Successful connections: ${successfulSessions.length}/3`);
    log(`Unique IPs obtained: ${uniqueIPs.size}`);

    if (uniqueIPs.size > 1) {
      log("Proxy rotation is WORKING - different IPs per session", "success");
    } else if (uniqueIPs.size === 1) {
      log(
        "Proxy connected but rotation may not be working (same IP)",
        "warn",
      );
    } else {
      log("Proxy connection FAILED", "error");
    }

    log("\nIP List:");
    sessions.forEach((s, i) => {
      const status = s.ip ? "✅" : "❌";
      log(
        `  ${status} Session ${i + 1} (${s.sessionId}): ${s.ip || "FAILED"} ${s.country ? `(${s.country})` : ""}`,
      );
    });

    // Test 3: Verify proxy works with target site
    log("\n─── Test 3: Target Site Accessibility ───");
    const targetProxy = buildProxyAuth(generateSessionId());
    const targetContext = await browser.newContext({
      proxy: targetProxy,
      locale: "en-AU",
      timezoneId: "Australia/Sydney",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });

    try {
      const targetPage = await targetContext.newPage();
      log("Connecting to https://joefortunepokies.win ...");

      const response = await targetPage.goto("https://joefortunepokies.win", {
        timeout: 45000,
        waitUntil: "domcontentloaded",
      });

      if (response) {
        log(`Status: ${response.status()} ${response.statusText()}`, "success");
        const title = await targetPage.title();
        log(`Page Title: ${title}`, "success");
        log("Target site accessible via proxy", "success");
      } else {
        log("No response from target site", "error");
      }
    } catch (e) {
      log(`Target site error: ${e}`, "error");
    } finally {
      await targetContext.close();
    }

    log("\n" + "═".repeat(70));
    log("PROXY TEST COMPLETE");
    log("═".repeat(70));
  } catch (e) {
    log(`Fatal error: ${e}`, "error");
  } finally {
    if (browser) {
      await browser.close();
      log("Browser closed");
    }
  }
}

// Run the test
testProxyConnection()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
  });
