// ── Manifold platform preset registry ────────────────────────────────────────
//
// Each entry describes a known target platform and carries:
//   • Domain matching patterns (for auto-detect from URL)
//   • Fingerprint hints (applied when "Optimize for this target" is checked)
//   • Behavioral profile recommendation
//   • Risk signals (used for the real-time threat score in the right pane)
//   • Suggested proxy geo
//   • Automation snippet stubs
//
// Presets are intentionally conservative — operators can always tune further.

import type { PlatformPreset, AutomationSnippet } from "$lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Platform presets
// ─────────────────────────────────────────────────────────────────────────────

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    id: "shopify",
    label: "Shopify",
    domains: [
      "shopify.com",
      "myshopify.com",
      "shop.app",
      "shopifycloud.com",
      "shopifysvc.com",
    ],
    fp_hints: {
      canvas_noise: 0.04,
      webgl_noise: 0.04,
      audio_noise: 0.003,
      hardware_concurrency: 8,
      device_memory: 8,
      font_subset_size: "reduced",
      ua_mobile: false,
      webrtc_mode: "fake_mdns",
    },
    behavior_profile: "normal",
    suggested_geo: "US",
    risk_signals: ["hCaptcha", "Shopify Fraud Filter", "Signifyd", "TLS-JA3"],
    snippet_ids: [
      "shopify-login",
      "shopify-add-to-cart",
      "shopify-checkout-eu",
      "shopify-product-view",
    ],
    threat_level: "medium",
  },
  {
    id: "tiktok",
    label: "TikTok",
    domains: ["tiktok.com", "tiktokv.com", "musical.ly", "tiktokcdn.com"],
    fp_hints: {
      canvas_noise: 0.12,
      webgl_noise: 0.1,
      audio_noise: 0.008,
      hardware_concurrency: 4,
      device_memory: 4,
      font_subset_size: "paranoid",
      ua_mobile: true,
      webrtc_mode: "block",
    },
    behavior_profile: "fast",
    suggested_geo: "US",
    risk_signals: [
      "Arkose Labs",
      "TikTok Risk Engine",
      "Device Fingerprint SDK",
      "Canvas entropy check",
    ],
    snippet_ids: ["tiktok-login", "tiktok-follow", "tiktok-like-scroll"],
    threat_level: "high",
  },
  {
    id: "instagram",
    label: "Instagram",
    domains: ["instagram.com", "instagr.am", "cdninstagram.com"],
    fp_hints: {
      canvas_noise: 0.1,
      webgl_noise: 0.08,
      audio_noise: 0.006,
      hardware_concurrency: 4,
      device_memory: 4,
      font_subset_size: "paranoid",
      ua_mobile: true,
      webrtc_mode: "block",
    },
    behavior_profile: "cautious",
    suggested_geo: "US",
    risk_signals: [
      "Meta Integrity Check",
      "Device Trust Score",
      "Behavioral biometrics",
      "IP reputation",
    ],
    snippet_ids: ["instagram-login", "instagram-follow", "instagram-dm"],
    threat_level: "critical",
  },
  {
    id: "amazon",
    label: "Amazon",
    domains: [
      "amazon.com",
      "amazon.co.uk",
      "amazon.co.jp",
      "amazon.de",
      "amazon.fr",
      "amazon.ca",
      "amazon.com.au",
    ],
    fp_hints: {
      canvas_noise: 0.05,
      webgl_noise: 0.04,
      audio_noise: 0.003,
      hardware_concurrency: 8,
      device_memory: 8,
      font_subset_size: "reduced",
      ua_mobile: false,
      webrtc_mode: "fake_mdns",
    },
    behavior_profile: "normal",
    suggested_geo: "US",
    risk_signals: [
      "AWS WAF",
      "FingerprintJS Pro",
      "TLS-JA3",
      "Cookie integrity",
    ],
    snippet_ids: ["amazon-login", "amazon-add-to-cart", "amazon-checkout"],
    threat_level: "medium",
  },
  {
    id: "cloudflare",
    label: "Cloudflare (generic)",
    domains: ["cloudflare.com"],
    fp_hints: {
      canvas_noise: 0.14,
      webgl_noise: 0.12,
      audio_noise: 0.009,
      hardware_concurrency: 4,
      device_memory: 8,
      font_subset_size: "paranoid",
      ua_mobile: false,
      webrtc_mode: "block",
    },
    behavior_profile: "cautious",
    suggested_geo: "US",
    risk_signals: [
      "Cloudflare Turnstile",
      "CF-Challenge",
      "TLS-JA3",
      "HTTP/2 fingerprint",
      "Mouse entropy",
    ],
    snippet_ids: ["cf-turnstile-bypass", "cf-challenge-solver"],
    threat_level: "critical",
  },
  {
    id: "google",
    label: "Google / reCAPTCHA",
    domains: [
      "google.com",
      "accounts.google.com",
      "google.co.uk",
      "google.de",
      "recaptcha.net",
    ],
    fp_hints: {
      canvas_noise: 0.08,
      webgl_noise: 0.07,
      audio_noise: 0.005,
      hardware_concurrency: 8,
      device_memory: 8,
      font_subset_size: "reduced",
      ua_mobile: false,
      webrtc_mode: "fake_mdns",
    },
    behavior_profile: "cautious",
    suggested_geo: "US",
    risk_signals: [
      "reCAPTCHA v3",
      "Google Account integrity",
      "Behavioral biometrics",
      "Device trust",
    ],
    snippet_ids: ["google-login", "google-2fa"],
    threat_level: "high",
  },
  {
    id: "twitter",
    label: "X / Twitter",
    domains: ["twitter.com", "x.com", "t.co"],
    fp_hints: {
      canvas_noise: 0.09,
      webgl_noise: 0.07,
      audio_noise: 0.005,
      hardware_concurrency: 4,
      device_memory: 4,
      font_subset_size: "reduced",
      ua_mobile: false,
      webrtc_mode: "fake_mdns",
    },
    behavior_profile: "normal",
    suggested_geo: "US",
    risk_signals: ["Twitter Bot Detection", "ArkoseLabs", "IP reputation"],
    snippet_ids: ["twitter-login", "twitter-follow", "twitter-post"],
    threat_level: "high",
  },
  {
    id: "facebook",
    label: "Facebook",
    domains: ["facebook.com", "fb.com", "fbcdn.net"],
    fp_hints: {
      canvas_noise: 0.11,
      webgl_noise: 0.09,
      audio_noise: 0.007,
      hardware_concurrency: 4,
      device_memory: 4,
      font_subset_size: "paranoid",
      ua_mobile: false,
      webrtc_mode: "block",
    },
    behavior_profile: "cautious",
    suggested_geo: "US",
    risk_signals: [
      "Meta Integrity",
      "FBQ pixel entropy",
      "Device fingerprint SDK",
      "Behavioral biometrics",
    ],
    snippet_ids: ["facebook-login", "facebook-post"],
    threat_level: "critical",
  },
  {
    id: "ebay",
    label: "eBay",
    domains: ["ebay.com", "ebay.co.uk", "ebay.de", "ebay.com.au"],
    fp_hints: {
      canvas_noise: 0.04,
      webgl_noise: 0.03,
      audio_noise: 0.002,
      hardware_concurrency: 8,
      device_memory: 8,
      font_subset_size: "reduced",
      ua_mobile: false,
      webrtc_mode: "fake_mdns",
    },
    behavior_profile: "normal",
    suggested_geo: "US",
    risk_signals: ["eBay Fraud Engine", "TLS-JA3", "IP reputation"],
    snippet_ids: ["ebay-login", "ebay-bid", "ebay-buy-now"],
    threat_level: "medium",
  },
  {
    id: "stripe",
    label: "Stripe",
    domains: ["stripe.com", "checkout.stripe.com"],
    fp_hints: {
      canvas_noise: 0.03,
      webgl_noise: 0.02,
      audio_noise: 0.001,
      hardware_concurrency: 8,
      device_memory: 8,
      font_subset_size: "full",
      ua_mobile: false,
      webrtc_mode: "fake_mdns",
    },
    behavior_profile: "normal",
    suggested_geo: "US",
    risk_signals: [
      "Stripe Radar",
      "FingerprintJS Pro",
      "Behavioral scoring",
      "3DS2 device fingerprint",
    ],
    snippet_ids: ["stripe-checkout"],
    threat_level: "high",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Quick preset buttons — shown in Fingerprint tab and context-suggested
// ─────────────────────────────────────────────────────────────────────────────

export interface QuickPreset {
  id: string;
  label: string;
  emoji: string;
  description: string;
  /** Partial overrides applied to a Fingerprint object */
  overrides: {
    canvas_noise?: number;
    webgl_noise?: number;
    audio_noise?: number;
    hardware_concurrency?: number;
    device_memory?: number;
    ua_mobile?: boolean;
    webrtc_mode?: import("$lib/types").WebRtcMode;
  };
  behavior_profile: import("$lib/types").BehaviorProfile;
}

export const QUICK_PRESETS: QuickPreset[] = [
  {
    id: "shopify-safe",
    label: "Shopify safe",
    emoji: "🛒",
    description:
      "Balanced noise, desktop Chrome, US geo. Passes Signifyd + hCaptcha.",
    overrides: {
      canvas_noise: 0.04,
      webgl_noise: 0.04,
      audio_noise: 0.003,
      hardware_concurrency: 8,
      device_memory: 8,
      ua_mobile: false,
      webrtc_mode: "fake_mdns",
    },
    behavior_profile: "normal",
  },
  {
    id: "tiktok-aggressive",
    label: "TikTok aggressive",
    emoji: "🎵",
    description:
      "High noise, mobile UA, WebRTC blocked. Defeats Arkose + TikTok Risk Engine.",
    overrides: {
      canvas_noise: 0.13,
      webgl_noise: 0.11,
      audio_noise: 0.009,
      hardware_concurrency: 4,
      device_memory: 4,
      ua_mobile: true,
      webrtc_mode: "block",
    },
    behavior_profile: "fast",
  },
  {
    id: "cloudflare-paranoid",
    label: "Cloudflare paranoid",
    emoji: "🛡️",
    description:
      "Maximum noise on all surfaces, slow cautious behaviour. For CF Turnstile + Challenge pages.",
    overrides: {
      canvas_noise: 0.15,
      webgl_noise: 0.13,
      audio_noise: 0.01,
      hardware_concurrency: 4,
      device_memory: 8,
      ua_mobile: false,
      webrtc_mode: "block",
    },
    behavior_profile: "cautious",
  },
  {
    id: "instagram-mobile",
    label: "Instagram mobile",
    emoji: "📸",
    description:
      "Mobile UA + paranoid font subset + blocked WebRTC. Mimics iOS Chrome.",
    overrides: {
      canvas_noise: 0.1,
      webgl_noise: 0.08,
      audio_noise: 0.006,
      hardware_concurrency: 4,
      device_memory: 4,
      ua_mobile: true,
      webrtc_mode: "block",
    },
    behavior_profile: "cautious",
  },
  {
    id: "blank-canvas",
    label: "Blank canvas",
    emoji: "⬜",
    description:
      "Zero noise on all surfaces. Use only behind trusted residential proxies.",
    overrides: {
      canvas_noise: 0.0,
      webgl_noise: 0.0,
      audio_noise: 0.0,
      ua_mobile: false,
      webrtc_mode: "passthrough",
    },
    behavior_profile: "fast",
  },
  {
    id: "ja4-paranoid",
    label: "JA4-Paranoid",
    emoji: "🔐",
    description:
      "TLS bridge enabled for seed-controlled JA4 fingerprints. Maximum entropy for Akamai/DataDome.",
    overrides: {
      canvas_noise: 0.12,
      webgl_noise: 0.1,
      audio_noise: 0.008,
      hardware_concurrency: 8,
      device_memory: 8,
      ua_mobile: false,
      webrtc_mode: "fake_mdns",
    },
    behavior_profile: "normal",
    tls_bridge: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Automation snippet library
// ─────────────────────────────────────────────────────────────────────────────

export const AUTOMATION_SNIPPETS: AutomationSnippet[] = [
  {
    id: "shopify-login",
    name: "Shopify — Login",
    description:
      "Navigate to the account login page, fill credentials, submit.",
    platforms: ["shopify"],
    tags: ["login", "auth"],
    code: `// Shopify login flow
const TARGET = page.url().includes('myshopify') ? page.url().split('/')[2] : 'your-store.myshopify.com';
await human.pageLoadPause();
await human.randomPremove();
await human.click('form[action*="login"] [name="customer[email]"]');
await human.type('form[action*="login"] [name="customer[email]"]', CREDENTIALS.email);
await human.type('form[action*="login"] [name="customer[password]"]', CREDENTIALS.password);
await human.click('[type="submit"]');
await page.waitForNavigation({ waitUntil: 'domcontentloaded' });`,
    created_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "shopify-add-to-cart",
    name: "Shopify — Add to Cart + Checkout (EU)",
    description:
      "Find a product, add it to cart, begin checkout with EU address.",
    platforms: ["shopify"],
    tags: ["checkout", "cart", "eu"],
    code: `// Shopify add-to-cart flow (EU)
await human.pageLoadPause();
await human.randomPremove();
await human.scrollPage(300);
await human.click('[name="add"]');
await page.waitForSelector('.cart-notification', { timeout: 5000 }).catch(() => {});
await human.click('a[href="/checkout"]');
await page.waitForURL('**/checkouts/**');
await human.pageLoadPause();`,
    created_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "shopify-product-view",
    name: "Shopify — Product Browse + Wishlist",
    description: "Scroll product listings, hover items, view details.",
    platforms: ["shopify"],
    tags: ["browse", "wishlist"],
    code: `// Shopify product browse
await human.pageLoadPause();
await human.randomPremove();
for (let i = 0; i < 3; i++) {
  await human.scrollPage(400 + Math.random() * 300);
  await page.waitForTimeout(800 + Math.random() * 1200);
}
const cards = await page.$$('.product-card a, .grid__item a');
if (cards.length) {
  await human.hover(cards[Math.floor(Math.random() * Math.min(cards.length, 6))]);
  await page.waitForTimeout(600);
}`,
    created_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "tiktok-login",
    name: "TikTok — Login (email)",
    description: "Open login modal, select email mode, fill credentials.",
    platforms: ["tiktok"],
    tags: ["login", "auth"],
    code: `// TikTok login — email path
await human.pageLoadPause();
await human.randomPremove();
await human.click('[data-e2e="login-button"], .login-button');
await page.waitForSelector('[data-e2e="modal-title"]', { timeout: 8000 });
await human.click('[href*="email"]');
await human.type('[name="email"], [type="email"]', CREDENTIALS.email);
await human.type('[type="password"]', CREDENTIALS.password);
await human.click('[data-e2e="login-button-enabled"], [type="submit"]');`,
    created_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "tiktok-like-scroll",
    name: "TikTok — Like + Scroll Feed",
    description: "Scroll the for-you feed and like N videos with human timing.",
    platforms: ["tiktok"],
    tags: ["engagement", "feed", "scroll"],
    code: `// TikTok feed engagement
await human.pageLoadPause();
const N = 5;
for (let i = 0; i < N; i++) {
  await human.scrollPage(window.innerHeight);
  await page.waitForTimeout(2000 + Math.random() * 3000);
  const like = await page.$('[data-e2e="like-icon"], .like-button');
  if (like && Math.random() > 0.4) {
    await human.click(like);
    await page.waitForTimeout(400 + Math.random() * 800);
  }
}`,
    created_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "instagram-login",
    name: "Instagram — Login",
    description: "Fill IG login form with human typing + handle 2FA prompt.",
    platforms: ["instagram"],
    tags: ["login", "auth", "2fa"],
    code: `// Instagram login
await human.pageLoadPause();
await human.randomPremove();
await human.type('[name="username"]', CREDENTIALS.email);
await human.type('[name="password"]', CREDENTIALS.password);
await human.click('[type="submit"]');
await page.waitForTimeout(3000);
// Handle "Save login info?" dialog
const save = await page.$('[type="button"]');
if (save) { await human.click(save); }`,
    created_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "google-login",
    name: "Google — Login + 2FA",
    description:
      "Navigate accounts.google.com, fill email then password, handle TOTP.",
    platforms: ["google"],
    tags: ["login", "auth", "2fa", "totp"],
    code: `// Google login flow
await page.goto('https://accounts.google.com');
await human.pageLoadPause();
await human.type('[type="email"]', CREDENTIALS.email);
await human.press('Enter');
await page.waitForSelector('[type="password"]', { timeout: 8000 });
await human.pageLoadPause();
await human.type('[type="password"]', CREDENTIALS.password);
await human.press('Enter');
await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });`,
    created_at: "2025-01-01T00:00:00Z",
  },
  {
    id: "amazon-add-to-cart",
    name: "Amazon — Add to Cart",
    description: "Search for a product, open listing, add to cart.",
    platforms: ["amazon"],
    tags: ["cart", "search"],
    code: `// Amazon add-to-cart
await human.pageLoadPause();
await human.randomPremove();
await human.click('#add-to-cart-button');
await page.waitForSelector('#attachSiNAHCoreCXNewSideSheet_feature_div, #huc-v2-order-row-confirm-text', { timeout: 6000 }).catch(() => {});`,
    created_at: "2025-01-01T00:00:00Z",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve a PlatformPreset from a URL or domain string.
 *  Returns null if no known platform matches. */
export function resolvePlatform(url: string): PlatformPreset | null {
  let hostname = url;
  try {
    hostname = new URL(url.startsWith("http") ? url : `https://${url}`)
      .hostname;
  } catch {
    // url is already a bare hostname
  }

  // Strip www. prefix
  const bare = hostname.replace(/^www\./, "");

  for (const preset of PLATFORM_PRESETS) {
    for (const domain of preset.domains) {
      if (bare === domain || bare.endsWith(`.${domain}`)) {
        return preset;
      }
    }
  }
  return null;
}

/** Auto-complete suggestions for Target URL field. */
export const TARGET_SUGGESTIONS: string[] = [
  "https://shopify.com",
  "https://tiktok.com",
  "https://instagram.com",
  "https://accounts.google.com",
  "https://amazon.com",
  "https://amazon.co.jp",
  "https://amazon.co.uk",
  "https://facebook.com",
  "https://twitter.com",
  "https://x.com",
  "https://ebay.com",
  "https://stripe.com",
  "https://cloudflare.com",
];

/** Target tags available in the UI tag picker */
export const TARGET_TAG_OPTIONS = [
  { value: "login-heavy", label: "Login heavy", emoji: "🔐" },
  { value: "checkout-flow", label: "Checkout flow", emoji: "💳" },
  { value: "infinite-scroll", label: "Infinite scroll", emoji: "♾️" },
  { value: "mfa-required", label: "MFA required", emoji: "📱" },
  { value: "rate-limit-sensitive", label: "Rate limit sensitive", emoji: "⏱️" },
  { value: "captcha-hcaptcha", label: "hCaptcha", emoji: "🤖" },
  { value: "captcha-arkose", label: "Arkose", emoji: "🔒" },
  { value: "captcha-recaptcha", label: "reCAPTCHA", emoji: "🔒" },
  { value: "payment-form", label: "Payment form", emoji: "💰" },
  { value: "age-verification", label: "Age verification", emoji: "🪪" },
] as const;

/** Common screen presets for the Base tab */
export const SCREEN_PRESETS = [
  { label: "1920 × 1080  16:9", w: 1920, h: 1080 },
  { label: "2560 × 1440  16:9", w: 2560, h: 1440 },
  { label: "1440 × 900   16:10", w: 1440, h: 900 },
  { label: "1280 × 800   16:10", w: 1280, h: 800 },
  { label: "1366 × 768   ~16:9", w: 1366, h: 768 },
  { label: "3840 × 2160  4K", w: 3840, h: 2160 },
  { label: "390 × 844    Mobile", w: 390, h: 844 },
  { label: "412 × 915    Mobile", w: 412, h: 915 },
] as const;

/** OS / browser combinations with canonical UA seeds */
export const OS_OPTIONS = [
  {
    value: "windows11",
    label: "Windows 11",
    platform: "Win32",
    ua_platform: "Windows",
  },
  {
    value: "macos",
    label: "macOS Ventura",
    platform: "MacIntel",
    ua_platform: "macOS",
  },
  {
    value: "android14",
    label: "Android 14",
    platform: "Linux armv8",
    ua_platform: "Android",
  },
] as const;

export const BROWSER_OPTIONS = [
  { value: "chrome132", label: "Chrome 132" },
  { value: "firefox135", label: "Firefox 135" },
  { value: "edge132", label: "Edge 132" },
] as const;

/** Related domain suggestions shown in Clone with variation → Switch target */
export const RELATED_DOMAINS: Record<string, string[]> = {
  "shopify.com": ["shopify.com/login", "shop.app", "myshopify.com"],
  "tiktok.com": ["tiktok.com/foryou", "tiktok.com/live"],
  "instagram.com": ["instagram.com/explore", "instagram.com/reels"],
  "google.com": ["accounts.google.com", "myaccount.google.com"],
  "amazon.com": ["amazon.com/gp/cart", "amazon.com/gp/buy"],
  "facebook.com": ["facebook.com/login", "m.facebook.com"],
};
