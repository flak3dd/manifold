// ── Manifold playwright-bridge types ─────────────────────────────────────────

// ── Global Window extension ───────────────────────────────────────────────────

declare global {
  interface Window {
    __manifold_last_status?: number;
  }
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

export interface UaBrand {
  brand: string;
  version: string;
}

export type WebRtcMode = "block" | "fake_mdns" | "passthrough";

export interface Fingerprint {
  seed: number;
  // Canvas
  canvas_noise: number;
  // WebGL
  webgl_vendor: string;
  webgl_renderer: string;
  webgl_noise: number;
  // Audio
  audio_noise: number;
  // Fonts
  font_subset: string[];
  // Navigator
  user_agent: string;
  platform: string;
  accept_language: string;
  hardware_concurrency: number;
  device_memory: number;
  // Screen
  screen_width: number;
  screen_height: number;
  viewport_width: number;
  viewport_height: number;
  color_depth: number;
  pixel_ratio: number;
  // WebRTC
  webrtc_mode: WebRtcMode;
  webrtc_fake_mdns: string | null;
  webrtc_fake_ip: string | null;
  // Locale
  timezone: string;
  locale: string;
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

// ── Human behavior ────────────────────────────────────────────────────────────

export type BehaviorProfile = "bot" | "fast" | "normal" | "cautious";

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

// ── Profile ───────────────────────────────────────────────────────────────────

export type ProfileStatus = "idle" | "running" | "error";

export interface Profile {
  id: string;
  name: string;
  fingerprint: Fingerprint;
  human: HumanBehavior;
  proxy_id: string | null;
  notes: string;
  tags: string[];
  status: ProfileStatus;
  created_at: string;
  last_used: string | null;
  data_dir: string;
  /** Enable TLS bridge for JA4 fingerprinting control */
  tls_bridge?: boolean;
}

// ── Proxy ─────────────────────────────────────────────────────────────────────

export type ProxyType = "http" | "https" | "socks5";

export interface ProxyConfig {
  server: string; // e.g. "http://host:port" or "socks5://host:port"
  username?: string;
  password?: string;
}

// ── Launch config (env var MANIFOLD_LAUNCH_CONFIG) ────────────────────────────

export interface LaunchConfig {
  profile: Profile;
  proxy: ProxyConfig | null;
  url: string;
  wsPort: number;
  /** TLS bridge port when profile.tls_bridge is enabled */
  tlsBridgePort?: number;
}

// ── WebSocket protocol ────────────────────────────────────────────────────────
//
// Direction: Client (frontend / automation script) → Bridge (Node.js)

export type ClientMessage =
  | { type: "ping" }
  | { type: "screenshot"; sessionId: string }
  | { type: "navigate"; sessionId: string; url: string }
  | { type: "execute"; sessionId: string; script: string }
  | { type: "click"; sessionId: string; selector: string }
  | { type: "type"; sessionId: string; selector: string; text: string }
  | { type: "scroll"; sessionId: string; selector: string; deltaY: number }
  | { type: "extract"; sessionId: string; selector: string }
  | { type: "har_export"; sessionId: string }
  | { type: "stop"; sessionId: string }
  // ── Form scraping ─────────────────────────────────────────────────────────
  | { type: "scrape_form"; url: string; timeout?: number }
  // ── Login automation ──────────────────────────────────────────────────────
  | {
      type: "login_start";
      run: import("./login-types.js").LoginRun;
      profiles: Profile[];
      proxies: LoginProxyInfo[];
    }
  | { type: "login_pause" }
  | { type: "login_resume" }
  | { type: "login_abort" };

/** Slim proxy descriptor sent with login_start so the runner can open browsers. */
export interface LoginProxyInfo {
  id: string;
  server: string; // e.g. "http://host:port"
  username?: string;
  password?: string;
  healthy: boolean;
}

// Direction: Bridge → Client

export interface ScrapedFormResult {
  confidence: number;
  username_selector?: string;
  password_selector?: string;
  submit_selector?: string;
  success_selector?: string;
  failure_selector?: string;
  captcha_selector?: string;
  consent_selector?: string;
  totp_selector?: string;
  mfa_selector?: string;
  is_spa: boolean;
  spa_framework?: string;
  has_captcha: boolean;
  captcha_providers: string[];
  has_mfa: boolean;
  mfa_type?: string;
  details: string[];
  error?: string;
}

export type ServerMessage =
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
  | { type: "har_export"; sessionId: string; har: string } // JSON HAR
  | { type: "entropy"; sessionId: string; log: EntropyLog }
  | { type: "scrape_form_result"; result: ScrapedFormResult }
  | { type: "error"; sessionId: string; error: string }
  | { type: "stopped"; sessionId: string }
  // ── Login automation ──────────────────────────────────────────────────────
  | {
      type: "login_attempt_start";
      run_id: string;
      credential_id: string;
      profile_id: string;
    }
  | {
      type: "login_attempt_result";
      run_id: string;
      result: import("./login-types.js").AttemptResult;
    }
  | {
      type: "login_rotation";
      run_id: string;
      event: import("./login-types.js").RotationEvent;
    }
  | {
      type: "login_run_complete";
      run_id: string;
      stats: import("./login-types.js").RunStats;
    }
  | { type: "login_run_paused"; run_id: string }
  | { type: "login_run_aborted"; run_id: string }
  | { type: "login_error"; run_id: string; message: string };

// ── Session / recording ───────────────────────────────────────────────────────

export interface SessionEvent {
  ts: number;
  type:
    | "navigate"
    | "click"
    | "type"
    | "scroll"
    | "extract"
    | "execute"
    | "screenshot"
    | "entropy"
    | "error";
  data: Record<string, unknown>;
}

/** Fingerprint self-measurement snapshot taken by running detection scripts
 *  inside the launched page. Used for the "entropy log" in HAR exports. */
export interface EntropyLog {
  ts: number;
  canvas_hash: string;
  webgl_hash: string;
  audio_hash: string;
  font_count: number;
  screen: { width: number; height: number; pixelRatio: number };
  navigator: {
    userAgent: string;
    platform: string;
    hardwareConcurrency: number;
    deviceMemory: number | undefined;
    languages: string[];
    webdriver: boolean;
  };
  webrtc_leak: boolean;
  timezone: string;
}

/** Compact HAR-compatible request record. */
export interface HarEntry {
  ts: number;
  method: string;
  url: string;
  status: number;
  statusText: string;
  requestHeaders: Array<{ name: string; value: string }>;
  responseHeaders: Array<{ name: string; value: string }>;
  mimeType: string;
  bodySize: number;
  time: number;
}

export interface SessionRecording {
  sessionId: string;
  profileId: string;
  startedAt: number;
  endedAt: number | null;
  events: SessionEvent[];
  har: HarEntry[];
  entropy: EntropyLog[];
}

// ── Evasion init-script config ────────────────────────────────────────────────
//
// The bridge serialises this object and injects it as the *first* init script
// so all evasion modules can read it from window.__M__.

export interface EvasionConfig {
  seed: number;
  canvas: { noiseLevel: number };
  webgl: { vendor: string; renderer: string; noiseLevel: number };
  audio: { noiseLevel: number };
  fonts: { subset: string[] };
  navigator: {
    userAgent: string;
    platform: string;
    hardwareConcurrency: number;
    deviceMemory: number;
    languages: string[];
  };
  screen: {
    width: number;
    height: number;
    availWidth: number;
    availHeight: number;
    colorDepth: number;
    pixelRatio: number;
    viewportWidth: number;
    viewportHeight: number;
  };
  webrtc: {
    mode: WebRtcMode;
    fakeMdns: string | null;
    fakeIp: string | null;
  };
  uaCh: {
    brands: UaBrand[];
    mobile: boolean;
    platform: string;
    platformVersion: string;
    architecture: string;
    bitness: string;
  };
  permissions: Record<string, string>;
  headers: {
    acceptLanguage: string;
  };
}
