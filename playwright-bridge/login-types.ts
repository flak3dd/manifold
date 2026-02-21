// ── Manifold login automation types ──────────────────────────────────────────
//
// All types used by the login runner, credential manager, rotation engine,
// and the frontend automation UI.

// ─────────────────────────────────────────────────────────────────────────────
// Credentials
// ─────────────────────────────────────────────────────────────────────────────

export interface CredentialPair {
  id: string; // uuid, assigned on import
  username: string;
  password: string;
  /** Optional extra fields (e.g. TOTP seed, security answers, phone) */
  extras: Record<string, string>;
  /** Bookkeeping — set by the runner */
  status: CredentialStatus;
  /** Profile ID that was used for the last attempt */
  profile_id: string | null;
  /** ISO timestamp of last attempt */
  last_attempt: string | null;
  /** Number of attempts made */
  attempts: number;
}

export type CredentialStatus =
  | "pending" // not yet attempted
  | "running" // currently in flight
  | "success" // login confirmed
  | "failed" // wrong creds (hard fail — do not retry)
  | "soft_blocked" // rate-limited / CAPTCHA — rotate and retry
  | "hard_blocked" // account locked / banned — skip
  | "error" // unexpected error — may retry
  | "skipped"; // manually skipped

// ─────────────────────────────────────────────────────────────────────────────
// Login form descriptor
// ─────────────────────────────────────────────────────────────────────────────

export interface LoginFormConfig {
  /** URL of the login page */
  url: string;

  /** CSS / XPath selector for the username / email field */
  username_selector: string;

  /** CSS / XPath selector for the password field */
  password_selector: string;

  /** CSS / XPath selector for the submit button */
  submit_selector: string;

  /**
   * Optional: selector to wait for after submit that confirms success.
   * E.g. a dashboard element, avatar, logout link.
   */
  success_selector?: string;

  /**
   * Optional: selector that indicates failure (wrong password banner, etc.).
   * If present and found after submit, marks credential as "failed".
   */
  failure_selector?: string;

  /**
   * Optional: selector for a CAPTCHA challenge widget.
   * If found, the run pauses or triggers a rotation.
   */
  captcha_selector?: string;

  /**
   * Optional: selector for a cookie/consent banner to dismiss before
   * attempting login (clicked automatically).
   */
  consent_selector?: string;

  /**
   * Optional: selector for a TOTP / 2FA code input that appears after
   * password submission.  Requires `extras.totp_seed` on the credential.
   */
  totp_selector?: string;

  /**
   * How long (ms) to wait for the success / failure selector after submit.
   * Defaults to 20 000.
   */
  post_submit_timeout_ms?: number;

  /**
   * How long (ms) to wait for the login page to load initially.
   * Defaults to 30 000.
   */
  page_load_timeout_ms?: number;

  /**
   * If true, session state (cookies + localStorage + IndexedDB) is exported
   * after every successful login and stored alongside the credential result.
   */
  export_session_on_success?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain anti-bot threat profile
// ─────────────────────────────────────────────────────────────────────────────

export type ThreatLevel = "low" | "medium" | "high" | "paranoid";

export interface DomainProfile {
  hostname: string;
  threat_level: ThreatLevel;

  /** Recommended canvas noise level (0.0 – 1.0) */
  canvas_noise: number;
  /** Recommended WebGL noise level */
  webgl_noise: number;
  /** Recommended audio noise level */
  audio_noise: number;
  /** Font subset strategy */
  font_subset: "full" | "reduced" | "paranoid";

  /** Whether to spoof hardware concurrency */
  spoof_hw_concurrency: boolean;
  /** Whether to spoof device memory */
  spoof_device_memory: boolean;

  /** Typing speed factor (1.0 = normal, 0.6 = slower/more cautious) */
  typing_speed_factor: number;
  /** Mouse speed factor */
  mouse_speed_factor: number;

  /** Known CAPTCHA providers present on this domain */
  captcha_providers: CaptchaProvider[];

  /** Known WAF / bot-detection stack signals */
  waf_signals: WafSignal[];

  /** Minimum delay between attempts on this domain (ms) */
  min_attempt_gap_ms: number;

  /** How many attempts before forcing a proxy + fingerprint rotation */
  rotate_after_n_attempts: number;

  /** Whether the domain uses TLS fingerprinting (JA3/JA4) */
  tls_fingerprint_sensitive: boolean;

  /** Whether to apply stealth-grade TLS args to Chromium */
  patch_tls: boolean;
}

export type CaptchaProvider =
  | "recaptcha_v2"
  | "recaptcha_v3"
  | "hcaptcha"
  | "arkose_labs"
  | "cloudflare_turnstile"
  | "geetest"
  | "custom";

export type WafSignal =
  | "cloudflare"
  | "akamai"
  | "imperva"
  | "datadome"
  | "perimeterx"
  | "shape"
  | "distil"
  | "kasada"
  | "custom";

// ─────────────────────────────────────────────────────────────────────────────
// Rotation signals (soft detection triggers)
// ─────────────────────────────────────────────────────────────────────────────

export type RotationTrigger =
  | "captcha_detected" // CAPTCHA widget appeared
  | "rate_limit_429" // HTTP 429 response
  | "rate_limit_response" // 200 with embedded rate-limit message
  | "account_locked_signal" // page indicates account is locked
  | "ip_block_signal" // "Your IP has been blocked" type message
  | "redirect_to_verify" // redirected to email/phone verification
  | "anomaly_score_high" // entropy score dropped below threshold
  | "consecutive_failures" // N hard failures in a row
  | "waf_challenge" // WAF JS challenge page detected
  | "manual"; // operator triggered

export interface RotationEvent {
  ts: number;
  trigger: RotationTrigger;
  credential_id: string | null;
  old_profile_id: string;
  new_profile_id: string;
  old_proxy_id: string | null;
  new_proxy_id: string | null;
  details: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session state (cookies + localStorage + IndexedDB snapshot)
// ─────────────────────────────────────────────────────────────────────────────

export interface CookieRecord {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number; // Unix timestamp, -1 = session
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None" | "";
}

export interface SessionState {
  credential_id: string;
  profile_id: string;
  captured_at: string; // ISO timestamp
  url: string; // URL at capture time
  cookies: CookieRecord[];
  local_storage: Record<string, string>;
  session_storage: Record<string, string>;
  indexed_db: IndexedDbSnapshot[];
}

export interface IndexedDbSnapshot {
  db_name: string;
  version: number;
  stores: IndexedDbStore[];
}

export interface IndexedDbStore {
  name: string;
  /** Raw JSON-serialisable records */
  records: unknown[];
}

// ─────────────────────────────────────────────────────────────────────────────
// TLS / browser fingerprint patching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extra Chromium launch args that move the TLS ClientHello fingerprint
 * closer to a real user browser (reduces JA3 / JA4 distinctiveness).
 *
 * These are applied on top of the base launch args when
 * `DomainProfile.patch_tls` is true.
 */
export const TLS_PATCH_ARGS: string[] = [
  // Disable QUIC so TLS 1.3 over TCP is used — more consistent JA3
  "--disable-quic",
  // Force TLS 1.3 cipher suite order matching Chrome stable
  "--ssl-version-min=tls1.2",
  // Disable http2 to prevent ALPN negotiation fingerprint
  // (comment out if the target site requires h2)
  // "--disable-http2",
  // Randomise TLS extension order (Chromium 112+)
  "--enable-features=TLSRandomizeExtensions",
  // Disable CECPQ2 (post-quantum) — not present in all Chrome stable builds
  "--disable-features=PostQuantumCECPQ2",
  // Use a real cipher list (not the reduced "automated" list)
  "--cipher-suite-blacklist=",
  // Disable automation-specific DevTools protocol headers
  "--disable-blink-features=AutomationControlled",
];

// ─────────────────────────────────────────────────────────────────────────────
// Run configuration
// ─────────────────────────────────────────────────────────────────────────────

export type RunMode =
  | "sequential" // one credential at a time
  | "parallel"; // N credentials concurrently (one browser per slot)

export interface LoginRunConfig {
  id: string; // uuid
  form: LoginFormConfig;

  /**
   * Profile IDs from the pool to draw from.
   * The runner picks the next available idle profile for each credential.
   */
  profile_pool: string[];

  /**
   * If true, fingerprint and proxy are rotated between every attempt,
   * regardless of soft signals.
   */
  rotate_every_attempt: boolean;

  /**
   * Number of consecutive soft signals before forcing a rotation.
   * Defaults to 1.
   */
  soft_signal_threshold: number;

  /**
   * Maximum number of retries for "error" or "soft_blocked" credentials.
   * Defaults to 2.
   */
  max_retries: number;

  /** Concurrency mode */
  mode: RunMode;

  /**
   * Number of parallel slots (only used when mode = "parallel").
   * Defaults to 1.
   */
  concurrency: number;

  /**
   * Delay (ms) between launching each credential attempt.
   * Adds human-like stagger even in sequential mode.
   */
  launch_delay_ms: number;

  /**
   * Whether to apply domain-aware noise overrides.
   * When true, the runner looks up the domain in DOMAIN_PROFILES and
   * adjusts canvas/webgl/audio noise levels accordingly.
   */
  domain_aware_noise: boolean;

  /**
   * Whether to patch TLS fingerprint args when domain profile recommends it.
   */
  patch_tls: boolean;

  /** Target domain profile (resolved at run start if domain_aware_noise is true) */
  domain_profile?: DomainProfile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-attempt result
// ─────────────────────────────────────────────────────────────────────────────

export type AttemptOutcome =
  | "success"
  | "wrong_credentials"
  | "captcha_block"
  | "rate_limited"
  | "account_locked"
  | "ip_blocked"
  | "2fa_required"
  | "unexpected_redirect"
  | "timeout"
  | "error";

export interface AttemptResult {
  id: string; // uuid
  run_id: string;
  credential_id: string;
  profile_id: string;
  proxy_id: string | null;

  /** ISO timestamp — when the attempt started */
  started_at: string;
  /** ISO timestamp — when the attempt finished */
  finished_at: string;
  /** Duration ms */
  duration_ms: number;

  outcome: AttemptOutcome;
  /** Human-readable detail (error message, signal description, etc.) */
  detail: string;

  /** URL at time of outcome detection */
  final_url: string;

  /** Whether session state was exported */
  session_exported: boolean;
  /** Inline session state (only if exported and small enough) */
  session_state?: SessionState;

  /** Entropy snapshot at attempt end */
  entropy_score: number | null;

  /** Any rotation events that fired during this attempt */
  rotation_events: RotationEvent[];

  /** Soft signals detected during the attempt */
  signals_detected: RotationTrigger[];

  /** Screenshot (base64 PNG) taken at outcome moment */
  screenshot?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Run state
// ─────────────────────────────────────────────────────────────────────────────

export type RunStatus = "idle" | "running" | "paused" | "completed" | "aborted";

export interface LoginRun {
  id: string;
  config: LoginRunConfig;
  credentials: CredentialPair[];
  results: AttemptResult[];
  rotation_log: RotationEvent[];
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  /** Summary counts */
  stats: RunStats;
}

export interface RunStats {
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  soft_blocked: number;
  hard_blocked: number;
  error: number;
  skipped: number;
  rotations: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket messages — login runner protocol
// ─────────────────────────────────────────────────────────────────────────────

/** Messages sent from the frontend to the login runner */
export type LoginClientMsg =
  | { type: "login_start"; run: LoginRun }
  | { type: "login_pause" }
  | { type: "login_resume" }
  | { type: "login_abort" }
  | { type: "login_skip"; credential_id: string }
  | { type: "login_export_session"; credential_id: string };

/** Messages sent from the login runner to the frontend */
export type LoginServerMsg =
  | {
      type: "login_attempt_start";
      run_id: string;
      credential_id: string;
      profile_id: string;
    }
  | { type: "login_attempt_result"; run_id: string; result: AttemptResult }
  | { type: "login_rotation"; run_id: string; event: RotationEvent }
  | { type: "login_run_complete"; run_id: string; stats: RunStats }
  | { type: "login_run_paused"; run_id: string }
  | { type: "login_run_aborted"; run_id: string }
  | { type: "login_error"; run_id: string; message: string };

// ─────────────────────────────────────────────────────────────────────────────
// Domain profile database (statically known threat levels)
// ─────────────────────────────────────────────────────────────────────────────

export const DOMAIN_PROFILES: Record<string, DomainProfile> = {
  "shopify.com": {
    hostname: "shopify.com",
    threat_level: "medium",
    canvas_noise: 0.18,
    webgl_noise: 0.12,
    audio_noise: 0.1,
    font_subset: "reduced",
    spoof_hw_concurrency: true,
    spoof_device_memory: true,
    typing_speed_factor: 0.85,
    mouse_speed_factor: 0.9,
    captcha_providers: ["recaptcha_v2"],
    waf_signals: ["cloudflare"],
    min_attempt_gap_ms: 3_500,
    rotate_after_n_attempts: 5,
    tls_fingerprint_sensitive: false,
    patch_tls: false,
  },
  "tiktok.com": {
    hostname: "tiktok.com",
    threat_level: "high",
    canvas_noise: 0.25,
    webgl_noise: 0.2,
    audio_noise: 0.18,
    font_subset: "reduced",
    spoof_hw_concurrency: true,
    spoof_device_memory: true,
    typing_speed_factor: 0.75,
    mouse_speed_factor: 0.8,
    captcha_providers: ["recaptcha_v2", "arkose_labs"],
    waf_signals: ["akamai"],
    min_attempt_gap_ms: 5_000,
    rotate_after_n_attempts: 3,
    tls_fingerprint_sensitive: true,
    patch_tls: true,
  },
  "instagram.com": {
    hostname: "instagram.com",
    threat_level: "high",
    canvas_noise: 0.22,
    webgl_noise: 0.18,
    audio_noise: 0.15,
    font_subset: "reduced",
    spoof_hw_concurrency: true,
    spoof_device_memory: true,
    typing_speed_factor: 0.7,
    mouse_speed_factor: 0.75,
    captcha_providers: ["recaptcha_v2", "hcaptcha"],
    waf_signals: ["cloudflare"],
    min_attempt_gap_ms: 6_000,
    rotate_after_n_attempts: 2,
    tls_fingerprint_sensitive: true,
    patch_tls: true,
  },
  "amazon.com": {
    hostname: "amazon.com",
    threat_level: "medium",
    canvas_noise: 0.15,
    webgl_noise: 0.1,
    audio_noise: 0.08,
    font_subset: "full",
    spoof_hw_concurrency: false,
    spoof_device_memory: false,
    typing_speed_factor: 0.9,
    mouse_speed_factor: 0.95,
    captcha_providers: ["recaptcha_v2"],
    waf_signals: ["custom"],
    min_attempt_gap_ms: 2_000,
    rotate_after_n_attempts: 6,
    tls_fingerprint_sensitive: false,
    patch_tls: false,
  },
  "accounts.google.com": {
    hostname: "accounts.google.com",
    threat_level: "paranoid",
    canvas_noise: 0.3,
    webgl_noise: 0.25,
    audio_noise: 0.22,
    font_subset: "paranoid",
    spoof_hw_concurrency: true,
    spoof_device_memory: true,
    typing_speed_factor: 0.6,
    mouse_speed_factor: 0.65,
    captcha_providers: ["recaptcha_v2", "recaptcha_v3"],
    waf_signals: ["custom"],
    min_attempt_gap_ms: 10_000,
    rotate_after_n_attempts: 1,
    tls_fingerprint_sensitive: true,
    patch_tls: true,
  },
  "twitter.com": {
    hostname: "twitter.com",
    threat_level: "high",
    canvas_noise: 0.22,
    webgl_noise: 0.18,
    audio_noise: 0.15,
    font_subset: "reduced",
    spoof_hw_concurrency: true,
    spoof_device_memory: true,
    typing_speed_factor: 0.72,
    mouse_speed_factor: 0.78,
    captcha_providers: ["arkose_labs"],
    waf_signals: ["custom"],
    min_attempt_gap_ms: 8_000,
    rotate_after_n_attempts: 2,
    tls_fingerprint_sensitive: true,
    patch_tls: true,
  },
  "linkedin.com": {
    hostname: "linkedin.com",
    threat_level: "high",
    canvas_noise: 0.2,
    webgl_noise: 0.16,
    audio_noise: 0.14,
    font_subset: "reduced",
    spoof_hw_concurrency: true,
    spoof_device_memory: true,
    typing_speed_factor: 0.75,
    mouse_speed_factor: 0.8,
    captcha_providers: ["recaptcha_v2"],
    waf_signals: ["imperva"],
    min_attempt_gap_ms: 7_000,
    rotate_after_n_attempts: 2,
    tls_fingerprint_sensitive: true,
    patch_tls: true,
  },
  "cloudflare.com": {
    hostname: "cloudflare.com",
    threat_level: "paranoid",
    canvas_noise: 0.35,
    webgl_noise: 0.3,
    audio_noise: 0.25,
    font_subset: "paranoid",
    spoof_hw_concurrency: true,
    spoof_device_memory: true,
    typing_speed_factor: 0.55,
    mouse_speed_factor: 0.6,
    captcha_providers: ["cloudflare_turnstile"],
    waf_signals: ["cloudflare"],
    min_attempt_gap_ms: 12_000,
    rotate_after_n_attempts: 1,
    tls_fingerprint_sensitive: true,
    patch_tls: true,
  },
};

/** Default domain profile for unknown domains */
export const DEFAULT_DOMAIN_PROFILE: DomainProfile = {
  hostname: "unknown",
  threat_level: "low",
  canvas_noise: 0.1,
  webgl_noise: 0.08,
  audio_noise: 0.06,
  font_subset: "full",
  spoof_hw_concurrency: false,
  spoof_device_memory: false,
  typing_speed_factor: 1.0,
  mouse_speed_factor: 1.0,
  captcha_providers: [],
  waf_signals: [],
  min_attempt_gap_ms: 1_500,
  rotate_after_n_attempts: 10,
  tls_fingerprint_sensitive: false,
  patch_tls: false,
};

/**
 * Resolve a domain profile from a URL.
 * Tries exact hostname match, then strips www., then falls back to default.
 */
export function resolveDomainProfile(url: string): DomainProfile {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    // Try exact match first
    if (DOMAIN_PROFILES[hostname]) return DOMAIN_PROFILES[hostname];
    // Try parent domain (e.g. shop.example.com → example.com)
    const parts = hostname.split(".");
    if (parts.length > 2) {
      const parent = parts.slice(-2).join(".");
      if (DOMAIN_PROFILES[parent]) return DOMAIN_PROFILES[parent];
    }
    return { ...DEFAULT_DOMAIN_PROFILE, hostname };
  } catch {
    return DEFAULT_DOMAIN_PROFILE;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV / JSON import helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a CSV string into CredentialPair[].
 * Supports headers: username,password[,extra_key,extra_key,...]
 * Also accepts colon-separated "user:pass" lines with no header.
 */
export function parseCredentialCsv(raw: string): CredentialPair[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const pairs: CredentialPair[] = [];

  // Detect header row by checking if first line is comma-separated with header keywords
  const firstLine = lines[0];
  const firstLower = firstLine.toLowerCase();

  let hasHeader = false;
  const headers: string[] = [];

  // Only treat as header if it contains commas AND header keywords
  if (firstLine.includes(",")) {
    const parsedHeaders = firstLine
      .split(",")
      .map((h) => h.trim().toLowerCase());
    const hasUsernameCol = parsedHeaders.some(
      (h) => h === "username" || h === "email" || h === "login" || h === "user",
    );
    const hasPasswordCol = parsedHeaders.some(
      (h) => h === "password" || h === "pass" || h === "pwd",
    );

    if (hasUsernameCol && hasPasswordCol) {
      // Valid header - use it
      hasHeader = true;
      headers.push(...parsedHeaders);
    } else if (
      // If it looks like it was intended as a header (has header keywords)
      // but is missing required columns, reject the entire input
      parsedHeaders.some(
        (h) =>
          h === "username" ||
          h === "email" ||
          h === "login" ||
          h === "user" ||
          h === "password" ||
          h === "pass" ||
          h === "pwd" ||
          h === "first_name" ||
          h === "last_name" ||
          h === "name",
      )
    ) {
      // Looks like a header row but missing username/password columns
      return [];
    }
  }

  const dataLines = hasHeader ? lines.slice(1) : lines;

  for (const line of dataLines) {
    if (!line) continue;

    let username = "";
    let password = "";
    const extras: Record<string, string> = {};

    if (hasHeader) {
      const cols = line.split(",");
      const uIdx = headers.findIndex(
        (h) =>
          h === "username" || h === "email" || h === "login" || h === "user",
      );
      const pIdx = headers.findIndex(
        (h) => h === "password" || h === "pass" || h === "pwd",
      );
      if (uIdx === -1 || pIdx === -1) continue;
      username = cols[uIdx]?.trim() ?? "";
      password = cols[pIdx]?.trim() ?? "";
      // Extra columns
      for (let i = 0; i < headers.length; i++) {
        if (i !== uIdx && i !== pIdx && cols[i]) {
          extras[headers[i]] = cols[i].trim();
        }
      }
    } else {
      // Colon or comma separated without header
      // Prefer colon separator if present, otherwise use comma
      const sep = line.includes(":") ? ":" : ",";
      const parts = line.split(sep);
      username = parts[0]?.trim() ?? "";
      password = parts.slice(1).join(sep).trim();
    }

    if (!username || !password) continue;

    pairs.push({
      id: crypto.randomUUID(),
      username,
      password,
      extras,
      status: "pending",
      profile_id: null,
      last_attempt: null,
      attempts: 0,
    });
  }

  return pairs;
}

/**
 * Parse a JSON array of credential objects.
 * Accepts [{username, password, ...extras}] or [{email, password, ...}]
 */
export function parseCredentialJson(raw: string): CredentialPair[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];

    return arr
      .filter((item) => typeof item === "object" && item !== null)
      .map((item): CredentialPair | null => {
        const username =
          item.username ?? item.email ?? item.login ?? item.user ?? "";
        const password = item.password ?? item.pass ?? item.pwd ?? "";
        if (!username || !password) return null;

        const extras: Record<string, string> = {};
        for (const [k, v] of Object.entries(item)) {
          if (
            ![
              "username",
              "email",
              "login",
              "user",
              "password",
              "pass",
              "pwd",
            ].includes(k)
          ) {
            extras[k] = String(v);
          }
        }

        return {
          id: crypto.randomUUID() as string,
          username: String(username),
          password: String(password),
          extras,
          status: "pending" as CredentialStatus,
          profile_id: null,
          last_attempt: null,
          attempts: 0,
        };
      })
      .filter((x): x is CredentialPair => x !== null);
  } catch {
    return [];
  }
}

/** Compute aggregate RunStats from a credentials array + results array */
export function computeRunStats(
  credentials: CredentialPair[],
  results: AttemptResult[],
  rotationLog: RotationEvent[],
): RunStats {
  const counts = {
    total: credentials.length,
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    soft_blocked: 0,
    hard_blocked: 0,
    error: 0,
    skipped: 0,
    rotations: rotationLog.length,
  };

  for (const c of credentials) {
    switch (c.status) {
      case "pending":
        counts.pending++;
        break;
      case "running":
        counts.running++;
        break;
      case "success":
        counts.success++;
        break;
      case "failed":
        counts.failed++;
        break;
      case "soft_blocked":
        counts.soft_blocked++;
        break;
      case "hard_blocked":
        counts.hard_blocked++;
        break;
      case "error":
        counts.error++;
        break;
      case "skipped":
        counts.skipped++;
        break;
    }
  }

  return counts;
}
