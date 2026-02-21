// ── Manifold evasions — barrel export ────────────────────────────────────────
//
// Re-exports every evasion factory and provides the convenience helper
// `applyAllEvasions(page, cfg)` that:
//
//   1. Adds all JavaScript init scripts as Playwright addInitScript() calls
//      (these run in every frame before any page script).
//   2. Installs the Client-Hints route interceptor so Sec-CH-UA* request
//      headers stay consistent with the JS-level navigator.userAgentData.
//
// Init-script execution order (matters — later scripts may depend on earlier):
//
//   1. navigator   — hardwareConcurrency, deviceMemory, permissions, webdriver
//   2. clientHints — userAgentData, screen, outerWidth/Height, matchMedia
//   3. canvas      — getImageData / toDataURL / toBlob noise (2D)
//   4. webgl       — getParameter vendor/renderer, readPixels noise, extensions
//   5. audio       — AudioBuffer.getChannelData, AnalyserNode, startRendering
//   6. fonts       — FontFaceSet filtering, measureText noise, fontFamily hooks
//   7. webrtc      — RTCPeerConnection masking / mDNS candidate rewriting
//
// All scripts are idempotent: a `__m_*_patched__` guard prevents double-
// application if addInitScript is somehow called twice.
//
// Usage in the bridge session bootstrap:
//
//   import { applyAllEvasions } from '../evasions/index.js';
//   const page = await context.newPage();
//   await applyAllEvasions(page, cfg);

import type { Page } from "playwright";
import type { EvasionConfig } from "./types.js";

export { canvasEvasion } from "./canvas.js";
export { webglEvasion } from "./webgl.js";
export { audioEvasion } from "./audio.js";
export { fontsEvasion } from "./fonts.js";
export { webrtcEvasion } from "./webrtc.js";
export { clientHintsEvasion, installClientHintsRoute } from "./client-hints.js";
export { navigatorEvasion } from "./navigator.js";
export {
  installTlsGreaseRoute,
  buildJa4hPartial,
  CHROME_H2_SETTINGS_REFERENCE,
} from "./tls-grease.js";
export type { TlsGreaseOptions, Ja4hFields } from "./tls-grease.js";
export type { EvasionConfig } from "./types.js";

import { canvasEvasion } from "./canvas.js";
import { webglEvasion } from "./webgl.js";
import { audioEvasion } from "./audio.js";
import { fontsEvasion } from "./fonts.js";
import { webrtcEvasion } from "./webrtc.js";
import { clientHintsEvasion, installClientHintsRoute } from "./client-hints.js";
import { navigatorEvasion } from "./navigator.js";
import { installTlsGreaseRoute } from "./tls-grease.js";
import { applyTlsBridge, generateJa4Hash } from "./tls-bridge.js";

// ── Init-script registry ──────────────────────────────────────────────────────
//
// Each entry: { name, build }
//   name  — used in log messages and for the disabled-script sentinel check
//   build — (cfg: EvasionConfig) => string   returns the JS init script

type InitScriptEntry = {
  name: string;
  build: (cfg: EvasionConfig) => string;
};

const INIT_SCRIPTS: InitScriptEntry[] = [
  { name: "navigator", build: navigatorEvasion },
  { name: "clientHints", build: clientHintsEvasion },
  { name: "canvas", build: canvasEvasion },
  { name: "webgl", build: webglEvasion },
  { name: "audio", build: audioEvasion },
  { name: "fonts", build: fontsEvasion },
  { name: "webrtc", build: webrtcEvasion },
];

// ── Disabled-script sentinel ──────────────────────────────────────────────────
//
// Evasion factories return a comment-only string to signal "this evasion is
// intentionally disabled for this config" (e.g. canvas noise = 0).
// We detect this by checking for the /* … disabled … */ pattern.

function isDisabledScript(script: string): boolean {
  return /^\/\*.*disabled.*\*\/\s*$/i.test(script.trim());
}

// ── applyAllEvasions ──────────────────────────────────────────────────────────

/**
 * Apply all Manifold evasions to a Playwright `Page`.
 *
 * - Registers every JS init script via `page.addInitScript()` so they run
 *   before any page script in every frame and popup.
 * - Installs the Client-Hints route interceptor via `page.route()`.
 * - Installs the TLS-GREASE / JA4H header-diversity interceptor.
 * - If TLS bridge is enabled, configures proxy routing for JA4 control.
 *
 * Call this once per page, immediately after `context.newPage()`, before
 * navigating anywhere.
 *
 * @param page  Playwright Page instance.
 * @param cfg   Populated EvasionConfig (built from the active Profile).
 * @param options Additional options for TLS bridge configuration.
 */
export async function applyAllEvasions(
  page: Page,
  cfg: EvasionConfig,
  options?: {
    tlsBridgePort?: number;
    tlsBridgeEnabled?: boolean;
  },
): Promise<void> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  // 1. Register JS init scripts in declaration order
  for (const { name, build } of INIT_SCRIPTS) {
    let script: string;
    try {
      script = build(cfg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[manifold/evasions] Failed to build init script "${name}": ${msg}`,
      );
      failed.push(name);
      continue;
    }

    if (isDisabledScript(script)) {
      skipped.push(name);
      continue;
    }

    try {
      await page.addInitScript({ content: script });
      applied.push(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[manifold/evasions] Failed to add init script "${name}": ${msg}`,
      );
      failed.push(name);
    }
  }

  // 2. Install Playwright-level route interceptor for Client-Hint request headers
  try {
    await installClientHintsRoute(page, cfg);
    applied.push("clientHintsRoute");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[manifold/evasions] Failed to install Client-Hints route: ${msg}`,
    );
    failed.push("clientHintsRoute");
  }

  // 3. Install TLS-GREASE / JA4H header-diversity route interceptor
  try {
    await installTlsGreaseRoute(page, cfg, {
      seed: cfg.seed,
      injectPriority: true,
      suppressAltSvc: false,
    });
    applied.push("tlsGreaseRoute");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[manifold/evasions] Failed to install TLS-GREASE route: ${msg}`,
    );
    failed.push("tlsGreaseRoute");
  }

  // 4. Apply TLS bridge for JA4 fingerprinting control (if enabled)
  if (options?.tlsBridgeEnabled && options?.tlsBridgePort) {
    try {
      const context = page.context();
      await applyTlsBridge(context, {
        port: options.tlsBridgePort,
        seed: cfg.seed,
        debug: process.env.MANIFOLD_DEBUG === "1",
      });

      const ja4Hash = generateJa4Hash(cfg.seed);
      console.info(
        `[manifold/evasions] TLS bridge active: JA4 hash ${ja4Hash}`,
      );
      applied.push("tlsBridge");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[manifold/evasions] Failed to apply TLS bridge: ${msg}`);
      failed.push("tlsBridge");
    }
  }

  // 5. Summary log (useful for debugging; silent in production)
  if (process.env.MANIFOLD_DEBUG === "1") {
    console.info(
      `[manifold/evasions] applied=${applied.join(",")} ` +
        `skipped=${skipped.join(",") || "none"} ` +
        `failed=${failed.join(",") || "none"}`,
    );
  }
}

// ── buildEvasionConfig ────────────────────────────────────────────────────────
//
// Convenience adapter: converts a `Profile` (from playwright-bridge/types.ts)
// into the flat `EvasionConfig` shape that all evasion factories expect.

import type { Profile } from "../playwright-bridge/types.js";

export function buildEvasionConfig(profile: Profile): EvasionConfig {
  const fp = profile.fingerprint;

  return {
    seed: fp.seed,

    canvas: {
      noiseLevel: fp.canvas_noise,
    },

    webgl: {
      vendor: fp.webgl_vendor,
      renderer: fp.webgl_renderer,
      noiseLevel: fp.webgl_noise,
    },

    audio: {
      noiseLevel: fp.audio_noise,
    },

    fonts: {
      subset: fp.font_subset,
    },

    navigator: {
      userAgent: fp.user_agent,
      platform: fp.platform,
      hardwareConcurrency: fp.hardware_concurrency,
      deviceMemory: fp.device_memory,
      languages: fp.accept_language
        .split(",")
        .map((l) => l.trim().split(";")[0].trim()),
    },

    screen: {
      width: fp.screen_width,
      height: fp.screen_height,
      availWidth: fp.screen_width,
      availHeight: fp.screen_height - 40, // subtract typical taskbar height
      colorDepth: fp.color_depth,
      pixelRatio: fp.pixel_ratio,
      viewportWidth: fp.viewport_width,
      viewportHeight: fp.viewport_height,
    },

    webrtc: {
      mode: fp.webrtc_mode,
      fakeMdns: fp.webrtc_fake_mdns,
      fakeIp: fp.webrtc_fake_ip,
    },

    uaCh: {
      brands: fp.ua_brands,
      mobile: fp.ua_mobile,
      platform: fp.ua_platform,
      platformVersion: fp.ua_platform_version,
      architecture: fp.ua_architecture,
      bitness: fp.ua_bitness,
    },

    permissions: fp.permissions,

    headers: {
      acceptLanguage: fp.accept_language,
    },
  };
}
