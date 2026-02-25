// ── Manifold — canonical frontend types ──────────────────────────────────────
//
// Single source of truth for every interface used across the Svelte UI.
// Mirrors the Rust structs in src-tauri/src/ (serde_json serialisation).

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

export type ProfileStatus = "idle" | "running" | "error";
export type ProxyType = "http" | "https" | "socks5";
export type WebRtcMode = "block" | "fake_mdns" | "passthrough";
export type BehaviorProfile = "bot" | "fast" | "normal" | "cautious";
export type FontSubset = "full" | "reduced" | "paranoid";
export type RotationPolicy = "manual" | "interval" | "on_ban" | "poisson";

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint
// ─────────────────────────────────────────────────────────────────────────────

export interface UaBrand {
  brand: string;
  version: string;
}

export interface Fingerprint {
  seed: number;

  // Canvas
  canvas_noise: number; // 0.0 – 1.0

  // WebGL
  webgl_vendor: string;
  webgl_renderer: string;
  webgl_noise: number; // 0.0 – 1.0

  // Audio
  audio_noise: number; // 0.0 – 1.0

  // Fonts
  font_subset: string[];

  // Navigator
  user_agent: string;
  platform: string; // "Win32" | "MacIntel" | "Linux x86_64"
  accept_language: string;
  hardware_concurrency: number; // 2 | 4 | 8 | 16
  device_memory: number; // 0.5 | 1 | 2 | 4 | 8

  // Screen
  screen_width: number;
  screen_height: number;
  viewport_width: number;
  viewport_height: number;
  color_depth: number; // 24 | 30
  pixel_ratio: number; // 1.0 | 1.25 | 1.5 | 2.0

  // WebRTC
  webrtc_mode: WebRtcMode;
  webrtc_fake_mdns: string | null;
  webrtc_fake_ip: string | null;

  // Locale
  timezone: string; // IANA e.g. "America/New_York"
  locale: string; // BCP-47 e.g. "en-US"

  // UA-CH
  ua_brands: UaBrand[];
  ua_mobile: boolean;
  ua_platform: string;
  ua_platform_version: string;
  ua_architecture: string;
  ua_bitness: string;

  // Permissions
  permissions: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Human behaviour
// ─────────────────────────────────────────────────────────────────────────────

export interface MouseConfig {
  base_speed_px_per_sec: number;
  speed_jitter: number;
  curve_scatter: number;
  overshoot_prob: number;
  overshoot_max_px: number;
  pre_click_pause_max_ms: number;
  micro_jitter_prob: number;
}

export interface TypingConfig {
  base_wpm: number;
  wpm_jitter: number;
  burst_min_chars: number;
  burst_max_chars: number;
  pause_min_ms: number;
  pause_max_ms: number;
  typo_rate: number;
  typo_correct_min_ms: number;
  typo_correct_max_ms: number;
  double_tap_rate: number;
  think_before_long_fields: boolean;
  think_pause_min_ms: number;
  think_pause_max_ms: number;
}

export interface ScrollConfig {
  initial_velocity_px: number;
  momentum_decay: number;
  min_velocity_px: number;
  tick_min_ms: number;
  tick_max_ms: number;
  overshoot_prob: number;
  overshoot_max_px: number;
}

export interface MacroBehavior {
  page_load_pause_min_ms: number;
  page_load_pause_max_ms: number;
  inter_action_min_ms: number;
  inter_action_max_ms: number;
  idle_pause_prob: number;
  idle_pause_min_ms: number;
  idle_pause_max_ms: number;
  random_premove_prob: number;
}

export interface HumanBehavior {
  profile: BehaviorProfile;
  mouse: MouseConfig;
  typing: TypingConfig;
  scroll: ScrollConfig;
  macro_b: MacroBehavior;
}

// ─────────────────────────────────────────────────────────────────────────────
// Target
// ─────────────────────────────────────────────────────────────────────────────

/** Per-profile target context — what site / task this profile is built for. */
export interface ProfileTarget {
  /** Canonical URL or domain, e.g. "https://shopify.com" */
  url: string;
  /** Human-readable platform label resolved from url, e.g. "Shopify" */
  platform: string | null;
  /** Free-form operator annotations */
  tags: TargetTag[];
  /** When true, fingerprint + proxy geo were auto-tuned for this target */
  optimized: boolean;
  /** Suggested automation snippet IDs for this target */
  snippet_ids: string[];
}

export type TargetTag =
  | "login-heavy"
  | "checkout-flow"
  | "infinite-scroll"
  | "mfa-required"
  | "rate-limit-sensitive"
  | "captcha-hcaptcha"
  | "captcha-arkose"
  | "captcha-recaptcha"
  | "payment-form"
  | "age-verification"
  | string; // allow custom tags

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  name: string;
  fingerprint: Fingerprint;
  human: HumanBehavior;
  proxy_id: string | null;
  /** Serialised ProfileTarget JSON stored in notes field */
  notes: string;
  tags: string[];
  status: ProfileStatus;
  created_at: string; // ISO timestamp
  last_used: string | null;
  data_dir: string;
  /** Aggression level (0-3) for scaling noise amplitudes */
  aggression?: number;
  /** Enable TLS bridge for JA4 fingerprinting control */
  tls_bridge?: boolean;
  // Derived client-side (not persisted separately)
  target?: ProfileTarget;
}

export interface CreateProfilePayload {
  name: string;
  seed?: number;
  proxy_id?: string;
  notes?: string;
  tags?: string[];
  behavior_profile?: BehaviorProfile;
}

export interface UpdateProfilePayload {
  name?: string;
  fingerprint?: Fingerprint;
  human?: HumanBehavior;
  proxy_id?: string | null;
  notes?: string;
  tags?: string[];
  behavior_profile?: BehaviorProfile;
  tls_bridge?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proxy
// ─────────────────────────────────────────────────────────────────────────────

export interface Proxy {
  id: string;
  name: string;
  proxy_type: ProxyType;
  host: string;
  port: number;
  username: string | null;
  /** Backend never serialises this (encrypted at rest, skipped via serde).
   *  Populated client-side when a proxy is added in the current session so
   *  the automation bridge can configure authenticated proxies. */
  password: string | null;
  country: string | null;
  healthy: boolean;
  latency_ms: number | null;
  last_checked: string | null;
  rotation_policy?: ProxyRotationPolicy;
}

export interface ProxyHealth {
  id: string;
  healthy: boolean;
  latency_ms: number | null;
  error: string | null;
  checked_at: string;
}

export interface AddProxyPayload {
  name: string;
  proxy_type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
  country?: string;
}

export interface UpdateProxyPayload {
  name?: string;
  proxy_type?: ProxyType;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  country?: string;
}

/** BrightData/Luminati zone configuration — UI-level, not persisted directly */
export interface BrightDataConfig {
  customer_id: string;
  zone: string;
  country: string;
  mode: "sticky" | "rotating";
  session_id?: string; // auto-generated when mode = sticky
}

/** Proxy rotation policy attached per-profile */
export interface ProxyRotationPolicy {
  mode: RotationPolicy;
  interval_min?: number; // minutes — only for mode = interval
  proxy_ids: string[]; // ordered pool for round-robin
  current_index: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions & HAR
// ─────────────────────────────────────────────────────────────────────────────

export interface HarEntry {
  ts: number; // epoch ms
  method: string;
  url: string;
  status: number;
  status_text: string;
  request_headers: Array<{ name: string; value: string }>;
  response_headers: Array<{ name: string; value: string }>;
  mime_type: string;
  body_size: number; // bytes, -1 if unknown
  time_ms: number; // round-trip duration
}

export interface EntropyLog {
  ts: number;
  canvas_hash: string;
  webgl_hash: string;
  audio_hash: string;
  font_count: number;
  screen: {
    width: number;
    height: number;
    pixelRatio: number;
    colorDepth: number;
  };
  navigator: {
    userAgent: string;
    platform: string;
    hardwareConcurrency: number;
    deviceMemory: number | undefined;
    languages: string[];
    webdriver: boolean;
  };
  webgl: {
    vendor: string;
    renderer: string;
  };
  webrtc_ips: string[];
  webrtc_leak: boolean;
  timezone: string;
}

export type SessionEventType =
  | "navigate"
  | "click"
  | "type"
  | "scroll"
  | "extract"
  | "execute"
  | "screenshot"
  | "entropy"
  | "error";

export interface SessionEvent {
  ts: number;
  type: SessionEventType;
  data: Record<string, unknown>;
}

export interface Session {
  id: string;
  profile_id: string;
  started_at: number;
  ended_at: number | null;
  events: SessionEvent[];
  har: HarEntry[];
  entropy: EntropyLog[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Bridge WebSocket protocol (port 8766)
// ─────────────────────────────────────────────────────────────────────────────

export type BridgeClientMsg =
  | { type: "ping" }
  | { type: "navigate"; sessionId: string; url: string }
  | { type: "screenshot"; sessionId: string }
  | { type: "execute"; sessionId: string; script: string }
  | { type: "click"; sessionId: string; selector: string }
  | { type: "type"; sessionId: string; selector: string; text: string }
  | { type: "scroll"; sessionId: string; selector: string; deltaY: number }
  | { type: "extract"; sessionId: string; selector: string }
  | { type: "har_export"; sessionId: string }
  | { type: "stop"; sessionId: string };

export type BridgeServerMsg =
  | { type: "pong" }
  | { type: "ready"; sessionId: string; wsPort: number }
  | {
      type: "log";
      sessionId: string;
      level: "info" | "warn" | "error";
      message: string;
    }
  | { type: "screenshot"; sessionId: string; data: string } // base64 PNG
  | { type: "navigate_done"; sessionId: string; url: string; status: number }
  | { type: "execute_result"; sessionId: string; value: unknown }
  | { type: "extract_result"; sessionId: string; items: string[] }
  | { type: "har_export"; sessionId: string; har: string } // JSON HAR blob
  | { type: "entropy"; sessionId: string; log: EntropyLog }
  | { type: "error"; sessionId: string; error: string }
  | { type: "stopped"; sessionId: string };

// ─────────────────────────────────────────────────────────────────────────────
// Automation library
// ─────────────────────────────────────────────────────────────────────────────

export type AutomationMode = "oneshot" | "sequence" | "repl";

export interface AutomationSnippet {
  id: string;
  name: string;
  description: string;
  /** Platform keys this snippet is tagged for, e.g. ["shopify", "generic"] */
  platforms: string[];
  /** Tags like ["login", "checkout", "2fa"] */
  tags: string[];
  /** TypeScript / JavaScript body — executed in Node.js context with (page, human) */
  code: string;
  created_at: string;
}

export interface AutomationRun {
  snippet_id: string;
  profile_ids: string[];
  status: "queued" | "running" | "done" | "error";
  results: AutomationRunResult[];
  started_at: number;
  ended_at: number | null;
}

export interface AutomationRunResult {
  profile_id: string;
  target_url: string | null;
  status: "queued" | "running" | "success" | "failed";
  step: number;
  total_steps: number;
  error: string | null;
  session_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform presets (client-side constant data)
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformPreset {
  id: string;
  label: string;
  domains: string[];
  /** Partial fingerprint overrides when "Optimize for this target" is checked */
  fp_hints: {
    canvas_noise?: number;
    webgl_noise?: number;
    audio_noise?: number;
    hardware_concurrency?: number;
    device_memory?: number;
    font_subset_size?: FontSubset;
    ua_mobile?: boolean;
    webrtc_mode?: WebRtcMode;
  };
  behavior_profile: BehaviorProfile;
  suggested_geo: string; // ISO-3166-1 alpha-2
  risk_signals: string[]; // e.g. ["hCaptcha", "Arkose", "TLS fingerprint"]
  snippet_ids: string[];
  /** Displayed risk level indicator */
  threat_level: "low" | "medium" | "high" | "critical";
}

// ─────────────────────────────────────────────────────────────────────────────
// Control Room / global monitoring
// ─────────────────────────────────────────────────────────────────────────────

export type EmergencyRotateMode =
  | "proxies_only"
  | "proxies_and_fingerprint"
  | "proxies_fingerprint_and_targets";

export interface GlobalStats {
  profiles_total: number;
  profiles_running: number;
  profiles_error: number;
  proxies_healthy: number;
  proxies_total: number;
  target_distribution: Array<{ platform: string; count: number }>;
  entropy_drift: number | null; // 0–1 score; null = not yet measured
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy scraper types (kept for backward compat with scraper route)
// ─────────────────────────────────────────────────────────────────────────────

export type SourceStatus = "idle" | "scraping" | "success" | "error";

export interface Source {
  id: string;
  name: string;
  url: string;
  selector: string;
  interval: number;
  createdAt: string;
  lastScraped: string | null;
  status: SourceStatus;
  error: string | null;
}

export interface ScrapeResult {
  id: string;
  sourceId: string;
  url: string;
  content: string[];
  timestamp: string;
  durationMs: number;
}

// ── URL Test types ────────────────────────────────────────────────────────────

export type UrlTestStatus = "PASS" | "WARN" | "FAIL" | "INFO";

export interface UrlTestResult {
  name: string;
  status: UrlTestStatus;
  detail: string;
  durationMs?: number;
}

export interface UrlTestFormField {
  tag: string;
  type: string;
  name: string;
  id: string;
  placeholder: string;
  required: boolean;
  autocomplete: string;
  label: string;
}

export interface UrlTestDetectedForm {
  action: string;
  method: string;
  fields: UrlTestFormField[];
  submitButtons: string[];
  formType: string;
  formIndex: number;
}

export interface UrlTestScreenshots {
  desktop?: string; // base64 PNG
  tablet?: string; // base64 PNG
  mobile?: string; // base64 PNG
}

export interface UrlTestSummary {
  pass: number;
  warn: number;
  fail: number;
  info: number;
}

export interface UrlTestLoginResult {
  attempted: boolean;
  navigatedToLogin: boolean;
  loginUrl?: string;
  usernameFieldFound: boolean;
  passwordFieldFound: boolean;
  submitButtonFound: boolean;
  submitted: boolean;
  postSubmitUrl?: string;
  outcomeGuess?:
    | "success"
    | "wrong_credentials"
    | "captcha_block"
    | "rate_limited"
    | "2fa_required"
    | "error"
    | "unknown";
  detail: string;
  screenshot?: string; // base64 PNG — post-login
  /** Actual CSS selector the scraper resolved for the username/email field */
  usernameSelector?: string;
  /** Actual CSS selector the scraper resolved for the password field */
  passwordSelector?: string;
  /** Actual CSS selector the scraper resolved for the submit button */
  submitSelector?: string;

  // ── Extended login-flow detection ───────────────────────────────────
  /** Screenshot of the login form before credentials were submitted */
  preLoginScreenshot?: string; // base64 PNG
  /** Page title after login attempt */
  postLoginPageTitle?: string;
  /** Whether the URL changed after submitting the form */
  urlChanged?: boolean;

  /** CSS selector for success indicators detected post-login (dashboard, profile, logout link…) */
  successSelector?: string;
  /** Human-readable list of success signals found */
  successSignals?: string[];

  /** CSS selector for failure / error indicators detected post-login */
  failureSelector?: string;
  /** Human-readable list of failure signals found */
  failureSignals?: string[];

  /** CSS selector for CAPTCHA elements detected on the login page */
  captchaSelector?: string;
  /** CAPTCHA provider names found on the login page (reCAPTCHA, hCaptcha, etc.) */
  captchaProviders?: string[];

  /** CSS selector for a consent / cookie banner detected on the login page */
  consentSelector?: string;
  /** Whether a consent banner was auto-dismissed */
  consentDismissed?: boolean;

  /** CSS selector for a TOTP / 2FA input that appeared after login */
  totpSelector?: string;
  /** Whether the login flow is multi-step (e.g. username first, then password on next page) */
  isMultiStep?: boolean;
  /** Detail about the multi-step flow if detected */
  multiStepDetail?: string;

  /** Rate-limit or lockout signals detected after submit */
  rateLimitSignals?: string[];
}

// ── Login form selector scrape (scraper WS) ───────────────────────────────────

export interface ScrapedFormSelectors {
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

// ── WebSocket message types ───────────────────────────────────────────────────

export type WsClientMessage =
  | { type: "scrape"; sourceId: string; url: string; selector: string }
  | { type: "ping" }
  | { type: "scrape_form"; requestId: string; url: string; timeout?: number }
  | {
      type: "url_test";
      testId: string;
      url: string;
      username?: string;
      password?: string;
    };

export type WsServerMessage =
  | { type: "status"; sourceId: string; status: "scraping" }
  | { type: "result"; sourceId: string; content: string[]; durationMs: number }
  | { type: "error"; sourceId: string; message: string }
  | { type: "pong" }
  | { type: "scrape_form_result"; requestId: string; result: ScrapedFormSelectors }
  | {
      type: "url_test_progress";
      testId: string;
      testName: string;
      testIndex: number;
      totalTests: number;
      status: "running" | "done";
    }
  | {
      type: "url_test_result";
      testId: string;
      result: UrlTestResult;
    }
  | {
      type: "url_test_forms";
      testId: string;
      forms: UrlTestDetectedForm[];
    }
  | {
      type: "url_test_login";
      testId: string;
      login: UrlTestLoginResult;
    }
  | {
      type: "url_test_complete";
      testId: string;
      summary: UrlTestSummary;
      overallStatus: UrlTestStatus;
      durationMs: number;
      screenshots: UrlTestScreenshots;
    }
  | {
      type: "url_test_error";
      testId: string;
      message: string;
    };

export type AddSourcePayload = Pick<
  Source,
  "name" | "url" | "selector" | "interval"
>;

export interface Toast {
  id: string;
  message: string;
  type: "info" | "success" | "error" | "warning";
}
