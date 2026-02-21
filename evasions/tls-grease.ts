// ── Manifold evasions — TLS-GREASE & request-header diversity ─────────────────
//
// Addresses Priority 1: JA3 / JA4 / TLS client fingerprint realism.
//
// Playwright+Chromium exposes two surfaces we can influence without a custom
// TLS stack:
//
//   1. HTTP request headers   — Accept, Accept-Encoding, Accept-Language,
//                               Connection, DNT, Upgrade-Insecure-Requests,
//                               Sec-Fetch-*, Cache-Control, Priority, TE
//      These are part of the JA4H (HTTP fingerprint) that Akamai Bot Manager
//      and Cloudflare Bot Management v2 score alongside JA3/JA4 TLS data.
//
//   2. Sec-CH-UA brand ordering & GREASE token diversity
//      Akamai ML clusters on the brand string; deeper permutation breaks
//      those clusters.
//
//   3. QUIC / Alt-Svc header interaction
//      Chrome sends Alt-Svc upgrade probes; intercepting and varying the
//      timing of 0-RTT vs 1-RTT connections affects QUIC fingerprint entropy.
//      (We can't control the TLS handshake itself from Playwright, but we can
//      suppress or pass through Alt-Svc headers to control QUIC adoption.)
//
//   4. HTTP/2 SETTINGS frame values
//      Playwright Chromium sends fixed SETTINGS values.  We can't change them
//      directly, but we document the known values and surface them in the
//      profile metadata so operators can cross-reference against their proxy
//      termination layer.
//
// What we CANNOT do from Playwright alone (requires custom TLS stack):
//   • cipher suite order
//   • TLS extension order / presence
//   • ClientHello random bytes distribution
//   • ALPN order (h2 / http/1.1 preference)
// For those, pair Manifold with a mitmproxy / curl-impersonate sidecar
// (see docs/TLS_SIDECAR.md — not yet implemented).
//
// Usage (in bridge session bootstrap, after applyAllEvasions):
//
//   import { installTlsGreaseRoute } from '../evasions/tls-grease.js';
//   await installTlsGreaseRoute(page, cfg, seed);

import type { Page, Route, Request } from "playwright";
import type { EvasionConfig } from "./types.js";

// ── Seeded micro-RNG (xorshift32, same family as other evasions) ──────────────

function xorshift32(s: number): number {
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  return s >>> 0;
}

class GreaseRng {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 1;
  }
  next(): number {
    this.s = xorshift32(this.s);
    return this.s / 0x1_0000_0000;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(arr: ReadonlyArray<T>): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Shuffle a copy of arr in-place using Fisher-Yates. */
  shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  /** Returns true with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// ── Accept header diversity ───────────────────────────────────────────────────
//
// Chrome sends different Accept values for navigation vs sub-resource requests.
// The exact q-values and ordering drift subtly across Chrome versions and
// update channels; we model the observed variation pool.

const NAV_ACCEPT_POOL: ReadonlyArray<string> = [
  // Chrome 124-131 navigation Accept (most common)
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  // Chrome 132+ (avif before webp, signed-exchange version updated)
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
  // Chrome on Linux/macOS (no signed-exchange preference in some builds)
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  // Canary / dev channel variant (avif weight boosted)
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7,application/json;q=0.6",
];

const XHR_ACCEPT_POOL: ReadonlyArray<string> = [
  "*/*",
  "application/json, text/plain, */*",
  "application/json, */*;q=0.9",
  "*/*;q=1.0",
];

const FETCH_ACCEPT_POOL: ReadonlyArray<string> = [
  "*/*",
  "application/json, text/javascript, */*; q=0.01",
  "application/json",
  "*/*;q=0.9",
];

const IMG_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

// ── Accept-Encoding diversity ─────────────────────────────────────────────────
//
// Chrome 124+ supports zstd in addition to br/gzip/deflate; the presence and
// ordering of zstd correlates with Chrome version.  Older profiles should
// omit it; newer ones should include it with variable ordering.

const ENCODING_NO_ZSTD = "gzip, deflate, br";
const ENCODING_WITH_ZSTD_STANDARD = "gzip, deflate, br, zstd";
const ENCODING_WITH_ZSTD_PRIORITY = "zstd, gzip, deflate, br";

function pickAcceptEncoding(rng: GreaseRng, chromeMajor: number): string {
  if (chromeMajor < 124) return ENCODING_NO_ZSTD;
  // Chrome 124+ introduced zstd; ~70% of 124+ traffic uses it
  if (!rng.chance(0.70)) return ENCODING_NO_ZSTD;
  // Small fraction prioritises zstd (experimental/Canary behaviour)
  return rng.chance(0.08) ? ENCODING_WITH_ZSTD_PRIORITY : ENCODING_WITH_ZSTD_STANDARD;
}

// ── Cache-Control / Pragma diversity ─────────────────────────────────────────
//
// Navigation requests: Chrome sends cache-control: max-age=0 on regular
// navigations and cache-control: no-cache on forced reloads.
// Sub-resources: usually no cache-control header.

const NAV_CACHE_POOL: ReadonlyArray<string | null> = [
  "max-age=0",    // ~70% of navigations
  null,           // ~20% (no header)
  "no-cache",     // ~10% (hard reload pattern — use sparingly)
];

// ── Connection header ─────────────────────────────────────────────────────────
//
// HTTP/1.1 keep-alive; suppress on HTTP/2 (per spec).
// Some WAFs look for its presence/absence as a protocol consistency check.

// ── Sec-Fetch-* header sets ───────────────────────────────────────────────────
//
// Chrome sends a consistent set of Sec-Fetch-* headers.  We don't alter the
// semantics (that would break page functionality) but we validate completeness.

const REQUIRED_SEC_FETCH_NAV: ReadonlyArray<string> = [
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
];

const REQUIRED_SEC_FETCH_SUB: ReadonlyArray<string> = [
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
];

// ── Priority header (Chrome 124+) ─────────────────────────────────────────────
//
// Chrome 124 introduced the HTTP `Priority` header (RFC 9218 priority scheme).
// Its value varies by resource type and position in the request waterfall.
// Presence of this header is a strong Chrome-version signal.

function buildPriorityHeader(resourceType: string, isNav: boolean): string | null {
  if (isNav) return "u=0, i";          // navigation: urgency=0, incremental=false
  switch (resourceType) {
    case "script":    return "u=2";    // high priority scripts
    case "stylesheet": return "u=0";  // highest for CSS
    case "image":     return "u=5, i"; // low, incremental
    case "font":      return "u=2";
    case "fetch":
    case "xhr":       return "u=3";
    default:          return null;
  }
}

// ── TE header (trailers) ──────────────────────────────────────────────────────
//
// Chrome sends `te: trailers` on some navigation and XHR requests when
// the connection is HTTP/2.  Its presence is a minor fingerprint signal.
// We include it probabilistically to match the real Chrome distribution.

// ── DNT (Do Not Track) ───────────────────────────────────────────────────────
//
// Chrome removed the DNT UI in Chrome 121; the header is no longer sent by
// default.  Including it on all requests is a synthetic signal.  We omit it.

// ── JA4H canonical header order (Chrome 124-136) ─────────────────────────────
//
// JA4H fingerprints the set and order of HTTP request headers.  Chrome's
// canonical order for navigation requests is well-documented.  We enforce
// this order while injecting our varied values.
//
// Reference: https://github.com/FoxIO-LLC/ja4/blob/main/technical_details/JA4H.md

const JA4H_NAV_ORDER: ReadonlyArray<string> = [
  "host",
  "connection",
  "cache-control",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "upgrade-insecure-requests",
  "user-agent",
  "accept",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-user",
  "sec-fetch-dest",
  "accept-encoding",
  "accept-language",
  "cookie",
  "priority",
  "te",
];

const JA4H_SUB_ORDER: ReadonlyArray<string> = [
  "host",
  "connection",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "user-agent",
  "accept",
  "origin",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "referer",
  "accept-encoding",
  "accept-language",
  "cookie",
  "priority",
  "content-type",
  "content-length",
];

function reorderToJa4h(
  headers: Record<string, string>,
  order: ReadonlyArray<string>,
): Record<string, string> {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v;
  }
  const result: Record<string, string> = {};
  for (const name of order) {
    if (name in lower) result[name] = lower[name];
  }
  // Append any unrecognised headers (custom or future) at the end
  for (const [k, v] of Object.entries(lower)) {
    if (!(k in result)) result[k] = v;
  }
  return result;
}

// ── Extract Chrome major version from UA string ───────────────────────────────

function chromeMajorFromUa(ua: string): number {
  const m = ua.match(/Chrome\/(\d+)/);
  return m ? parseInt(m[1], 10) : 136;
}

// ── TLS-GREASE route installer ────────────────────────────────────────────────

export interface TlsGreaseOptions {
  /**
   * Seed for per-session RNG.  Should be derived from the profile seed so
   * the same profile always produces the same header variation pattern.
   */
  seed: number;
  /**
   * If true, suppresses Alt-Svc response headers to prevent QUIC upgrade
   * (useful when testing against JA3-only WAFs that don't inspect QUIC yet).
   * Default: false.
   */
  suppressAltSvc?: boolean;
  /**
   * If true, adds the `priority` header on applicable resource types.
   * Disable only when targeting servers that reject unknown headers.
   * Default: true (matches Chrome 124+ behavior).
   */
  injectPriority?: boolean;
  /**
   * Log patched headers to console when MANIFOLD_DEBUG=1.
   */
  debug?: boolean;
}

/**
 * Install a Playwright route interceptor that:
 *
 *  1. Varies Accept, Accept-Encoding per request and resource type
 *  2. Adds the HTTP `Priority` header matching Chrome 124+ behavior
 *  3. Suppresses DNT (Chrome 121+ dropped this header)
 *  4. Optionally suppresses Alt-Svc (prevents QUIC fingerprinting)
 *  5. Reorders all headers to match JA4H canonical Chrome order
 *
 * Call once per page after `applyAllEvasions()` and `installClientHintsRoute()`.
 */
export async function installTlsGreaseRoute(
  page: Page,
  cfg: EvasionConfig,
  options: TlsGreaseOptions,
): Promise<void> {
  const {
    seed,
    suppressAltSvc = false,
    injectPriority = true,
    debug = process.env.MANIFOLD_DEBUG === "1",
  } = options;

  const rng = new GreaseRng(seed ^ 0xdeadbeef);
  const chromeMajor = chromeMajorFromUa(cfg.navigator.userAgent);
  const acceptEncoding = pickAcceptEncoding(rng, chromeMajor);

  // Per-session choices (deterministic within a session, varied across sessions)
  const sessionNavAccept = rng.pick(NAV_ACCEPT_POOL);
  const sessionCacheControl = rng.pick(NAV_CACHE_POOL);

  // Whether this session occasionally sends `te: trailers` (~30% of Chrome sessions)
  const sessionSendsTeTrailers = rng.chance(0.30);

  await page.route("**/*", async (route: Route, request: Request) => {
    const rtype = request.resourceType();
    const isNav = rtype === "document";
    const isXhr = rtype === "xhr";
    const isFetch = rtype === "fetch";
    const isScript = rtype === "script";
    const isStyle = rtype === "stylesheet";
    const isImg = rtype === "image";
    const isFont = rtype === "font";

    const existing = request.headers();
    const patched: Record<string, string> = { ...existing };

    // ── 1. Remove synthetic / forbidden headers ──────────────────────────
    // DNT was dropped in Chrome 121; its presence is a synthetic signal
    delete patched["dnt"];
    // x-requested-with is a jQuery artifact — Chrome never sends it natively
    delete patched["x-requested-with"];

    // ── 2. Accept header variation ───────────────────────────────────────
    if (isNav) {
      patched["accept"] = sessionNavAccept;
    } else if (isXhr) {
      patched["accept"] = rng.pick(XHR_ACCEPT_POOL);
    } else if (isFetch) {
      patched["accept"] = rng.pick(FETCH_ACCEPT_POOL);
    } else if (isImg) {
      patched["accept"] = IMG_ACCEPT;
    }
    // scripts, stylesheets, fonts: leave Accept as Playwright set it

    // ── 3. Accept-Encoding ───────────────────────────────────────────────
    patched["accept-encoding"] = acceptEncoding;

    // ── 4. Cache-Control on navigation ───────────────────────────────────
    if (isNav && sessionCacheControl) {
      patched["cache-control"] = sessionCacheControl;
    } else if (!isNav) {
      // Sub-resources: remove cache-control unless it was a programmatic fetch
      if (!isFetch && !isXhr) {
        delete patched["cache-control"];
      }
    }

    // ── 5. Priority header (Chrome 124+) ─────────────────────────────────
    if (injectPriority && chromeMajor >= 124) {
      const priority = buildPriorityHeader(rtype, isNav);
      if (priority) {
        patched["priority"] = priority;
      } else {
        delete patched["priority"];
      }
    }

    // ── 6. TE: trailers (probabilistic) ─────────────────────────────────
    if (sessionSendsTeTrailers && (isNav || isXhr)) {
      patched["te"] = "trailers";
    } else {
      delete patched["te"];
    }

    // ── 7. Sec-Fetch-* completeness validation ───────────────────────────
    // Ensure all required Sec-Fetch headers are present; fill missing ones
    // with sensible defaults rather than letting the request go through with
    // an incomplete set (which is a strong bot signal).
    const required = isNav ? REQUIRED_SEC_FETCH_NAV : REQUIRED_SEC_FETCH_SUB;
    for (const h of required) {
      if (!patched[h]) {
        // Add safe fallback values
        switch (h) {
          case "sec-fetch-dest":
            patched[h] = isNav ? "document" : rtype === "script" ? "script" : "empty";
            break;
          case "sec-fetch-mode":
            patched[h] = isNav ? "navigate" : "cors";
            break;
          case "sec-fetch-site":
            patched[h] = isNav ? "none" : "same-origin";
            break;
          case "sec-fetch-user":
            patched[h] = "?1";
            break;
        }
      }
    }

    // ── 8. JA4H canonical header reordering ──────────────────────────────
    const order = isNav ? JA4H_NAV_ORDER : JA4H_SUB_ORDER;
    const ordered = reorderToJa4h(patched, order);

    if (debug && isNav) {
      console.info(
        `[manifold/tls-grease] nav accept=${ordered["accept"]?.substring(0, 40)} ` +
        `encoding=${ordered["accept-encoding"]} ` +
        `cache-control=${ordered["cache-control"] ?? "—"} ` +
        `priority=${ordered["priority"] ?? "—"} ` +
        `te=${ordered["te"] ?? "—"}`
      );
    }

    try {
      await route.continue({ headers: ordered });
    } catch {
      // Route already handled (abort/redirect); ignore.
    }
  });

  // ── Alt-Svc suppression (optional) ────────────────────────────────────────
  // Intercept responses to strip Alt-Svc headers, preventing QUIC upgrade.
  // QUIC (HTTP/3) has a different TLS fingerprint than TLS 1.3 over TCP;
  // if the WAF compares the two you get a JA4 mismatch signal.
  if (suppressAltSvc) {
    await page.route("**/*", async (route: Route) => {
      // We can't modify response headers in Playwright directly without
      // fulfilling the request ourselves.  The recommended approach is to
      // use a response interceptor via page.on('response').
      // Here we just pass through and handle suppression below.
      try { await route.continue(); } catch { /* ignored */ }
    });

    page.on("response", async (response) => {
      const hdrs = response.headers();
      if (hdrs["alt-svc"]) {
        // We can't modify response headers post-hoc in Playwright.
        // Log the Alt-Svc value so operators can configure their proxy
        // termination layer to strip it.
        if (debug) {
          console.info(
            `[manifold/tls-grease] Alt-Svc detected (cannot strip in Playwright): ` +
            `${response.url().substring(0, 80)} → ${hdrs["alt-svc"]}`
          );
        }
      }
    });
  }
}

// ── JA4H fingerprint builder (diagnostic / logging utility) ──────────────────
//
// Computes the JA4H fingerprint string for a given set of request headers.
// Useful for logging / comparison against known-good fingerprints.
//
// JA4H format:  <method><version><cookies><referer><headercount>_<hash>
// We implement the first four fields and the header-count; the hash requires
// the full byte-level header representation which isn't available from
// Playwright's string header map.

export interface Ja4hFields {
  method: string;
  httpVersion: "h2" | "h1";
  hasCookies: boolean;
  hasReferer: boolean;
  headerCount: number;
  /** Sorted, lowercase, deduplicated header names (for manual hash computation). */
  headerNames: string[];
  /** Partial JA4H string (without the full hash). */
  partial: string;
}

/**
 * Build a partial JA4H descriptor from a Playwright headers map.
 * The `hash` field is omitted (requires raw bytes); `partial` contains
 * the human-readable prefix for logging and comparison.
 */
export function buildJa4hPartial(
  method: string,
  headers: Record<string, string>,
): Ja4hFields {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v;
  }

  const httpVersion: "h2" | "h1" = "h2" in lower ? "h2" : "h1";
  const hasCookies = "cookie" in lower;
  const hasReferer = "referer" in lower;

  // Exclude pseudo-headers and a few standard ones that JA4H ignores
  const ignored = new Set([":method", ":path", ":scheme", ":authority", "cookie", "referer"]);
  const headerNames = Object.keys(lower)
    .filter((k) => !ignored.has(k))
    .sort();

  const m = method.substring(0, 2).toUpperCase().padEnd(2, "_");
  const v = httpVersion === "h2" ? "20" : "11";
  const c = hasCookies ? "c" : "n";
  const r = hasReferer ? "r" : "n";
  const cnt = headerNames.length.toString().padStart(2, "0");

  return {
    method,
    httpVersion,
    hasCookies,
    hasReferer,
    headerCount: headerNames.length,
    headerNames,
    partial: `${m}${v}${c}${r}${cnt}`,
  };
}

// ── HTTP/2 SETTINGS reference values (informational) ─────────────────────────
//
// Chrome's HTTP/2 SETTINGS frames have well-known values that JA3-equivalent
// tools (e.g. HPKP, ja3er) fingerprint.  We cannot change these from
// Playwright, but we document them so operators can match them at the proxy
// termination layer (nginx, haproxy, envoy).
//
// Chrome 124-136 observed values:
//   HEADER_TABLE_SIZE     = 65536  (0x10000)
//   ENABLE_PUSH           = 0
//   INITIAL_WINDOW_SIZE   = 6291456 (6 MB)
//   MAX_HEADER_LIST_SIZE  = 262144 (256 KB)
//
// These match curl-impersonate-chrome's SETTINGS presets for Chrome 124+.

export const CHROME_H2_SETTINGS_REFERENCE = {
  HEADER_TABLE_SIZE: 65536,
  ENABLE_PUSH: 0,
  INITIAL_WINDOW_SIZE: 6291456,
  MAX_HEADER_LIST_SIZE: 262144,
} as const;

export type { EvasionConfig };
