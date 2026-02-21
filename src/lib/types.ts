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

export type WsClientMessage =
  | { type: "scrape"; sourceId: string; url: string; selector: string }
  | { type: "ping" };

export type WsServerMessage =
  | { type: "status"; sourceId: string; status: "scraping" }
  | { type: "result"; sourceId: string; content: string[]; durationMs: number }
  | { type: "error"; sourceId: string; message: string }
  | { type: "pong" };

export type AddSourcePayload = Pick<
  Source,
  "name" | "url" | "selector" | "interval"
>;

export interface Toast {
  id: string;
  message: string;
  type: "info" | "success" | "error" | "warning";
}
