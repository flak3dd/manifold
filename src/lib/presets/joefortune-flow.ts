/**
 * JoeFortune Test Flow Preset
 *
 * Pre-configured automation flow for https://joefortunepokies.win
 * with Australian mobile proxy settings via AnyIP.io
 *
 * IMPORTANT: Playwright Chromium does NOT support SOCKS5 proxy authentication.
 * To use the proxy, you have the following options:
 *
 * 1. Use a local proxy forwarder (e.g., proxychains, redsocks)
 * 2. Use the Tauri backend which can handle SOCKS5 auth
 * 3. Run without proxy for testing (will fall back automatically)
 *
 * The actual login page URL is: https://www.joefortunepokies.win/login
 * (The script navigates there from the landing page)
 *
 * Usage:
 *   import { joefortuneFlowPreset, applyJoeFortuneFlow } from '$lib/presets/joefortune-flow';
 */

import type { AddProxyPayload } from "$lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FlowPreset {
  name: string;
  description: string;
  targetUrl: string;
  proxy: ProxyPreset;
  locale: LocalePreset;
  formConfig: FormConfigPreset;
  runConfig: RunConfigPreset;
}

export interface ProxyPreset {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  proxyType: "socks5" | "http" | "https";
  country: string;
}

export interface LocalePreset {
  locale: string;
  timezoneId: string;
  acceptLanguage: string;
}

export interface FormConfigPreset {
  username_selector?: string;
  password_selector?: string;
  submit_selector?: string;
  success_selector?: string;
  failure_selector?: string;
  captcha_selector?: string;
  consent_selector?: string;
  totp_selector?: string;
  post_submit_timeout_ms: number;
  page_load_timeout_ms: number;
  export_session_on_success: boolean;
}

export interface RunConfigPreset {
  rotate_every_attempt: number;
  soft_signal_threshold: number;
  max_retries: number;
  mode: "sequential" | "parallel";
  concurrency: number;
  launch_delay_ms: number;
  domain_aware_noise: boolean;
  patch_tls: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proxy Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AnyIP.io proxy configuration for Australian mobile IPs
 *
 * Raw string: portal.anyip.io:1080:user_375050,type_mobile,country_AU:Plentyon1
 * Format: host:port:username:password
 *   - Host: portal.anyip.io
 *   - Port: 1080
 *   - Username: user_375050,type_mobile,country_AU
 *   - Password: Plentyon1
 */
/**
 * Proxy string format: portal.anyip.io:1080:user_375050,type_mobile,country_AU:Plentyon1
 * Parsed as: host:port:username:password
 */
export const ANYIP_AU_MOBILE_PROXY: ProxyPreset = {
  name: "AnyIP AU Mobile",
  host: "portal.anyip.io",
  port: 1080,
  username: "user_375050,type_mobile,country_AU",
  password: "Plentyon1",
  proxyType: "http",
  country: "AU",
};

// Raw proxy string for reference
export const ANYIP_AU_MOBILE_PROXY_STRING =
  "portal.anyip.io:1080:user_375050,type_mobile,country_AU:Plentyon1";

// ─────────────────────────────────────────────────────────────────────────────
// Australian Locale Settings
// ─────────────────────────────────────────────────────────────────────────────

export const AU_LOCALE_PRESETS: LocalePreset[] = [
  {
    locale: "en-AU",
    timezoneId: "Australia/Sydney",
    acceptLanguage: "en-AU,en;q=0.9",
  },
  {
    locale: "en-AU",
    timezoneId: "Australia/Melbourne",
    acceptLanguage: "en-AU,en;q=0.9",
  },
  {
    locale: "en-AU",
    timezoneId: "Australia/Brisbane",
    acceptLanguage: "en-AU,en;q=0.9",
  },
  {
    locale: "en-AU",
    timezoneId: "Australia/Perth",
    acceptLanguage: "en-AU,en;q=0.9,en-GB;q=0.8",
  },
  {
    locale: "en-AU",
    timezoneId: "Australia/Adelaide",
    acceptLanguage: "en-AU,en;q=0.9",
  },
];

/**
 * Get a random Australian locale preset
 */
export function getRandomAuLocale(): LocalePreset {
  const index = Math.floor(Math.random() * AU_LOCALE_PRESETS.length);
  return AU_LOCALE_PRESETS[index];
}

// ─────────────────────────────────────────────────────────────────────────────
// JoeFortune Flow Preset
// ─────────────────────────────────────────────────────────────────────────────

export const joefortuneFlowPreset: FlowPreset = {
  name: "JoeFortune Pokies Test",
  description:
    "Automation test flow for joefortunepokies.win with AU mobile proxy",
  targetUrl: "https://www.joefortunepokies.win/login",

  proxy: ANYIP_AU_MOBILE_PROXY,

  locale: AU_LOCALE_PRESETS[0], // Sydney default

  formConfig: {
    // Auto-detected selectors from scraper run (97% confidence)
    username_selector: 'input[type="email"]',
    password_selector: 'input[type="password"]',
    submit_selector: "#loginSubmit",
    success_selector: undefined,
    failure_selector: '[class*="error"]',
    captcha_selector: 'iframe[src*="recaptcha"]',
    consent_selector: '[id*="cookie"] button',
    totp_selector: undefined,
    post_submit_timeout_ms: 8000,
    page_load_timeout_ms: 15000,
    export_session_on_success: true,
  },

  runConfig: {
    rotate_every_attempt: 3,
    soft_signal_threshold: 2,
    max_retries: 2,
    mode: "sequential",
    concurrency: 1,
    launch_delay_ms: 2000,
    domain_aware_noise: true,
    patch_tls: false,
  },
};

// Landing page URL (will redirect to login page above)
export const JOEFORTUNE_LANDING_URL = "https://joefortunepokies.win";

// Detected site characteristics
export const JOEFORTUNE_SITE_INFO = {
  hasRecaptcha: true,
  hasCookieConsent: true,
  loginPageUrl: "https://www.joefortunepokies.win/login",
  landingPageUrl: "https://joefortunepokies.win",
  detectedSelectors: {
    username: 'input[type="email"]',
    password: 'input[type="password"]',
    submit: "#loginSubmit",
    failure: '[class*="error"]',
    captcha: 'iframe[src*="recaptcha"]',
    consent: '[id*="cookie"] button',
  },
  scrapeConfidence: 97,
  lastVerified: "2026-02-21",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert proxy preset to AddProxyPayload for the proxy store
 */
export function proxyPresetToPayload(preset: ProxyPreset): AddProxyPayload {
  return {
    name: preset.name,
    proxy_type: preset.proxyType,
    host: preset.host,
    port: preset.port,
    username: preset.username,
    password: preset.password,
    country: preset.country,
  };
}

/**
 * Generate a unique session ID for tracking
 */
export function generateFlowSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `jf_${timestamp}_${random}`;
}

/**
 * Get the proxy server URL string for automation
 */
export function getProxyServerUrl(preset: ProxyPreset): string {
  return `${preset.proxyType}://${preset.host}:${preset.port}`;
}

/**
 * Get full proxy auth string
 */
export function getProxyAuthString(preset: ProxyPreset): string {
  return `${preset.host}:${preset.port}:${preset.username}:${preset.password}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow Application
// ─────────────────────────────────────────────────────────────────────────────

export interface ApplyFlowResult {
  targetUrl: string;
  proxyPayload: AddProxyPayload;
  locale: LocalePreset;
  formConfig: FormConfigPreset;
  runConfig: RunConfigPreset;
  sessionId: string;
}

/**
 * Prepare the JoeFortune flow for application to the automation page
 *
 * @param useRandomLocale - If true, selects a random AU locale; otherwise uses Sydney
 * @returns Configuration ready to be applied to automation stores
 */
export function applyJoeFortuneFlow(useRandomLocale = true): ApplyFlowResult {
  const preset = joefortuneFlowPreset;
  const locale = useRandomLocale ? getRandomAuLocale() : preset.locale;

  return {
    targetUrl: preset.targetUrl,
    proxyPayload: proxyPresetToPayload(preset.proxy),
    locale,
    formConfig: { ...preset.formConfig },
    runConfig: { ...preset.runConfig },
    sessionId: generateFlowSessionId(),
  };
}

/**
 * Create flow config with custom credentials
 */
export function createJoeFortuneFlowWithCreds(
  credentials: Array<{
    username: string;
    password: string;
    extras?: Record<string, string>;
  }>,
): ApplyFlowResult & { credentials: typeof credentials } {
  const flow = applyJoeFortuneFlow(true);
  return {
    ...flow,
    credentials,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Export all presets
// ─────────────────────────────────────────────────────────────────────────────

export const flowPresets = {
  joefortune: joefortuneFlowPreset,
} as const;

export const proxyPresets = {
  anyipAuMobile: ANYIP_AU_MOBILE_PROXY,
} as const;

export const localePresets = {
  australia: AU_LOCALE_PRESETS,
} as const;

export const siteInfo = {
  joefortune: JOEFORTUNE_SITE_INFO,
} as const;
