// ── Manifold TLS Bridge — JA4 Fingerprinting Control ──────────────────────────
//
// Routes Playwright traffic through a local TLS proxy that applies seed-controlled
// JA4 fingerprints, breaking Akamai/DataDome clustering by:
//
//  1. Permuting cipher suite order per seed
//  2. Controlling TLS extension order
//  3. Injecting GREASE values for entropy
//  4. Manipulating HTTP/2 SETTINGS frames
//
// Usage: Set profile.tls_bridge=true, then Playwright will proxy through
// http://127.0.0.1:{port} instead of connecting directly.

import type { BrowserContext } from "playwright";

/** Configuration for TLS bridge integration */
export interface TlsBridgeConfig {
  /** Bridge server port */
  port: number;
  /** Profile seed for JA4 generation */
  seed: number;
  /** Enable verbose logging */
  debug?: boolean;
}

/**
 * Configure Playwright context to route traffic through TLS bridge.
 *
 * Call this immediately after browser.newContext() but before any navigation.
 * The bridge must already be running on the specified port.
 */
export async function applyTlsBridge(
  context: BrowserContext,
  config: TlsBridgeConfig,
): Promise<void> {
  const { port, seed, debug = false } = config;

  if (debug) {
    console.info(
      `[tls-bridge] Applying JA4 control via proxy port ${port} (seed: ${seed})`,
    );
  }

  // Set proxy to our local bridge server
  await context.setProxy({
    server: `http://127.0.0.1:${port}`,
  });
}

/**
 * Utility to generate JA4 hash from seed (matches Rust implementation)
 */
export function generateJa4Hash(seed: number): string {
  // Simple hash function matching Rust side
  let h = seed >>> 0;
  for (let i = 0; i < 32; i++) {
    h = ((h >>> 1) ^ (h * 0x9e3779b9)) >>> 0;
  }
  return h.toString(16).padStart(16, "0");
}

export type { TlsBridgeConfig };
