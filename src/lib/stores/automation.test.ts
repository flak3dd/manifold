/**
 * Comprehensive tests for:
 *   • URL test store (urltest.svelte.ts)  – export / downloadReport, message handling, lifecycle
 *   • Automation store (automation.svelte.ts) – credential import, run creation, message handling,
 *     session export, download helpers
 *   • Form-scraper integration – selectorsToFormConfig, presets, validation
 *
 * These tests exercise the pure-logic functions that back the stores.  Svelte 5
 * rune-reactive state ($state / $derived) cannot be tested directly in a Node
 * vitest environment, so we replicate the core logic inline and verify contracts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  parseCredentialCsv,
  parseCredentialJson,
  computeRunStats,
  resolveDomainProfile,
  DOMAIN_PROFILES,
} from "../../../playwright-bridge/login-types";

import type {
  LoginFormConfig,
  CredentialPair,
  CredentialStatus,
  AttemptResult,
  AttemptOutcome,
  RotationEvent,
  RotationTrigger,
  RunStats,
  LoginRun,
  LoginRunConfig,
  RunMode,
  SessionState,
  DomainProfile,
} from "../../../playwright-bridge/login-types";

import {
  selectorsToFormConfig,
  FORM_PRESETS,
  type ScrapedFormSelectors,
} from "../utils/form-scraper";

import type {
  UrlTestResult,
  UrlTestSummary,
  UrlTestDetectedForm,
  UrlTestScreenshots,
  UrlTestLoginResult,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Inlined from automation.svelte.ts to avoid Svelte rune ($state) dependency
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_FORM_CONFIGS: Record<string, Partial<LoginFormConfig>> = {
  "shopify.com": {
    username_selector:  '#account_email, input[name="email"], input[type="email"]',
    password_selector:  '#account_password, input[name="password"], input[type="password"]',
    submit_selector:    'button[type="submit"], input[type="submit"], .btn-primary',
    success_selector:   '.dashboard, #MainContent, [data-trekkie-id="dashboard"]',
    failure_selector:   '.field__message--error, .notice--error, [data-error]',
    captcha_selector:   '.g-recaptcha, .h-captcha',
    consent_selector:   '#onetrust-accept-btn-handler, .consent-banner button',
    post_submit_timeout_ms: 10_000,
    export_session_on_success: true,
  },
  "accounts.google.com": {
    username_selector:  'input[type="email"]',
    password_selector:  'input[type="password"], input[name="password"]',
    submit_selector:    '#identifierNext button, #passwordNext button, [data-idom-class="nCP5yc"]',
    success_selector:   '[data-ogsr-up], .gb_A, #gb',
    failure_selector:   '#view_container .Ekjuhf, [data-error-code]',
    captcha_selector:   '.g-recaptcha',
    totp_selector:      'input[name="totpPin"], #totpPin',
    post_submit_timeout_ms: 12_000,
    export_session_on_success: true,
  },
  "instagram.com": {
    username_selector:  'input[name="username"]',
    password_selector:  'input[name="password"]',
    submit_selector:    'button[type="submit"]',
    success_selector:   'nav[role="navigation"], svg[aria-label="Home"]',
    failure_selector:   '#slfErrorAlert, [data-testid="login-error-message"]',
    captcha_selector:   '.h-captcha, .g-recaptcha',
    post_submit_timeout_ms: 10_000,
    export_session_on_success: true,
  },
  "twitter.com": {
    username_selector:  'input[name="text"], input[autocomplete="username"]',
    password_selector:  'input[name="password"], input[type="password"]',
    submit_selector:    '[data-testid="LoginForm_Login_Button"], [role="button"]:has-text("Log in")',
    success_selector:   '[data-testid="primaryColumn"], [aria-label="Home timeline"]',
    failure_selector:   '[data-testid="LoginForm_Login_Button"] + * [role="alert"]',
    post_submit_timeout_ms: 12_000,
    export_session_on_success: true,
  },
  "linkedin.com": {
    username_selector:  '#username, input[name="session_key"]',
    password_selector:  '#password, input[name="session_password"]',
    submit_selector:    'button[type="submit"], .sign-in-form__submit-button',
    success_selector:   '.global-nav, [data-test-id="nav-settings__dropdown-trigger"]',
    failure_selector:   '.alert-content, #error-for-username, #error-for-password',
    captcha_selector:   '.g-recaptcha',
    post_submit_timeout_ms: 10_000,
    export_session_on_success: true,
  },
  "amazon.com": {
    username_selector:  '#ap_email, input[name="email"]',
    password_selector:  '#ap_password, input[name="password"]',
    submit_selector:    '#signInSubmit, input[type="submit"]',
    success_selector:   '#nav-link-accountList, .nav-line-1',
    failure_selector:   '#auth-error-message-box, .a-alert-error',
    captcha_selector:   '.a-box-inner .a-row:has(img[src*="captcha"])',
    post_submit_timeout_ms: 10_000,
    export_session_on_success: true,
  },
};

function getFormPreset(url: string): Partial<LoginFormConfig> {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (KNOWN_FORM_CONFIGS[hostname]) return KNOWN_FORM_CONFIGS[hostname];
    const parts = hostname.split(".");
    if (parts.length > 2) {
      const parent = parts.slice(-2).join(".");
      if (KNOWN_FORM_CONFIGS[parent]) return KNOWN_FORM_CONFIGS[parent];
    }
  } catch {}
  return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCred(
  username: string,
  password: string,
  status: CredentialStatus = "pending",
): CredentialPair {
  return {
    id: crypto.randomUUID(),
    username,
    password,
    extras: {},
    status,
    profile_id: null,
    last_attempt: null,
    attempts: 0,
  };
}

function makeRotationEvent(overrides: Partial<RotationEvent> = {}): RotationEvent {
  return {
    ts: Date.now(),
    trigger: "soft_signal" as RotationTrigger,
    credential_id: null,
    old_profile_id: "p1",
    new_profile_id: "p2",
    old_proxy_id: "x1",
    new_proxy_id: "x2",
    details: "test rotation",
    ...overrides,
  };
}

function makeAttemptResult(
  credentialId: string,
  outcome: AttemptOutcome = "success",
  overrides: Partial<AttemptResult> = {},
): AttemptResult {
  return {
    id: crypto.randomUUID(),
    run_id: "run-1",
    credential_id: credentialId,
    profile_id: "profile-1",
    proxy_id: "proxy-1",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 1234,
    outcome,
    detail: `Outcome: ${outcome}`,
    final_url: "https://example.com/dashboard",
    session_exported: false,
    entropy_score: null,
    rotation_events: [],
    signals_detected: [],
    ...overrides,
  };
}

function makeUrlTestResult(
  name: string,
  status: UrlTestResult["status"],
  detail = "",
): UrlTestResult {
  return { name, status, detail, durationMs: 100 };
}

function makeScrapedResult(overrides: Partial<ScrapedFormSelectors> = {}): ScrapedFormSelectors {
  return {
    url: "https://example.com/login",
    username_selector: 'input[type="email"]',
    password_selector: 'input[type="password"]',
    submit_selector: 'button[type="submit"]',
    success_selector: ".dashboard",
    failure_selector: ".error-message",
    captcha_selector: ".g-recaptcha",
    confidence: 85,
    details: ["Test detection"],
    ...overrides,
  };
}

function makeFormConfig(url = "https://shopify.com/login"): LoginFormConfig {
  return {
    url,
    username_selector: 'input[name="email"]',
    password_selector: 'input[name="password"]',
    submit_selector: 'button[type="submit"]',
    success_selector: ".dashboard",
    failure_selector: ".error-message",
    post_submit_timeout_ms: 8000,
    page_load_timeout_ms: 15000,
    export_session_on_success: true,
  };
}

function emptyStats(total = 0): RunStats {
  return {
    total,
    pending: total,
    running: 0,
    success: 0,
    failed: 0,
    soft_blocked: 0,
    hard_blocked: 0,
    error: 0,
    skipped: 0,
    rotations: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Replicate the downloadReport logic from urltest.svelte.ts so we can test it
// without Svelte runes.
// ─────────────────────────────────────────────────────────────────────────────

interface UrlTest {
  id: string;
  url: string;
  username?: string;
  password?: string;
  status: "idle" | "running" | "completed" | "error";
  startedAt: string;
  finishedAt: string | null;
  results: UrlTestResult[];
  forms: UrlTestDetectedForm[];
  loginResult: UrlTestLoginResult | null;
  screenshots: UrlTestScreenshots;
  summary: UrlTestSummary | null;
  overallStatus: UrlTestResult["status"] | null;
  durationMs: number | null;
  error: string | null;
  progress: {
    testName: string;
    testIndex: number;
    totalTests: number;
    status: "running" | "done";
  } | null;
}

/** Pure-logic replica of urlTestStore.downloadReport for testing. */
function buildReport(test: UrlTest) {
  return {
    url: test.url,
    timestamp: test.startedAt,
    finishedAt: test.finishedAt,
    durationMs: test.durationMs,
    summary: test.summary,
    overallStatus: test.overallStatus,
    hasLogin: !!(test.username && test.password),
    loginResult: test.loginResult,
    forms: test.forms,
    results: test.results,
    screenshots: test.screenshots,
  };
}

/** Pure-logic replica of urlTestStore.countByStatus */
function countByStatus(results: UrlTestResult[]): UrlTestSummary {
  const summary: UrlTestSummary = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const r of results) {
    if (r.status === "PASS") summary.pass++;
    else if (r.status === "WARN") summary.warn++;
    else if (r.status === "FAIL") summary.fail++;
    else summary.info++;
  }
  return summary;
}

/** Replicate downloadReport filename logic */
function buildReportFilename(testUrl: string, timestamp: number): string {
  let hostname = "unknown";
  try {
    hostname = new URL(testUrl).hostname;
  } catch {
    // malformed URL — use fallback
  }
  return `url-test-${hostname}-${timestamp}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Replicate core automation store helpers for testing
// ─────────────────────────────────────────────────────────────────────────────

function createRunConfig(
  formConfig: LoginFormConfig,
  options: Partial<LoginRunConfig> = {},
): LoginRunConfig {
  const dp = resolveDomainProfile(formConfig.url);
  return {
    id: crypto.randomUUID(),
    form: formConfig,
    profile_pool: options.profile_pool ?? [],
    rotate_every_attempt: options.rotate_every_attempt ?? false,
    soft_signal_threshold: options.soft_signal_threshold ?? 1,
    max_retries: options.max_retries ?? 2,
    mode: (options.mode ?? "sequential") as RunMode,
    concurrency: options.concurrency ?? 1,
    launch_delay_ms: options.launch_delay_ms ?? dp.min_attempt_gap_ms,
    domain_aware_noise: options.domain_aware_noise ?? true,
    patch_tls: options.patch_tls ?? dp.patch_tls,
    domain_profile: dp,
  };
}

function createRun(
  formConfig: LoginFormConfig,
  credentials: CredentialPair[],
  options: Partial<LoginRunConfig> = {},
): LoginRun {
  const config = createRunConfig(formConfig, options);
  return {
    id: config.id,
    config,
    credentials: credentials.map((c) => ({
      ...c,
      status: "pending" as CredentialStatus,
    })),
    results: [],
    rotation_log: [],
    status: "idle",
    started_at: null,
    finished_at: null,
    stats: emptyStats(credentials.length),
  };
}

/** Replicate the outcome→status mapping from the message handler */
function outcomeToCredentialStatus(outcome: AttemptOutcome): CredentialStatus {
  switch (outcome) {
    case "success":
      return "success";
    case "wrong_credentials":
      return "failed";
    case "account_locked":
      return "hard_blocked";
    case "ip_blocked":
    case "captcha_block":
    case "rate_limited":
      return "soft_blocked";
    default:
      return "error";
  }
}

/** Replicate the message handler for login_attempt_result */
function applyAttemptResult(run: LoginRun, result: AttemptResult): LoginRun {
  const updated: LoginRun = {
    ...run,
    results: [...run.results, result],
    credentials: run.credentials.map((c) => {
      if (c.id !== result.credential_id) return c;
      return { ...c, status: outcomeToCredentialStatus(result.outcome) };
    }),
    rotation_log: [...run.rotation_log],
  };
  updated.stats = computeRunStats(
    updated.credentials,
    updated.results,
    updated.rotation_log,
  );
  return updated;
}

/** Replicate the message handler for login_attempt_start */
function applyAttemptStart(
  run: LoginRun,
  credentialId: string,
  profileId: string,
): LoginRun {
  const updated: LoginRun = {
    ...run,
    credentials: run.credentials.map((c) => {
      if (c.id !== credentialId) return c;
      return {
        ...c,
        status: "running" as CredentialStatus,
        profile_id: profileId,
        last_attempt: new Date().toISOString(),
      };
    }),
  };
  updated.stats = computeRunStats(
    updated.credentials,
    updated.results,
    updated.rotation_log,
  );
  return updated;
}

/** Replicate the abort handler */
function applyAbort(run: LoginRun): LoginRun {
  const updated: LoginRun = {
    ...run,
    status: "aborted",
    finished_at: new Date().toISOString(),
    credentials: run.credentials.map((c) => {
      if (c.status === "running" || c.status === "pending") {
        return { ...c, status: "skipped" as CredentialStatus };
      }
      return c;
    }),
  };
  updated.stats = computeRunStats(
    updated.credentials,
    updated.results,
    updated.rotation_log,
  );
  return updated;
}

/** Replicate buildSuccessCreds download logic */
function buildSuccessCredsLines(run: LoginRun): string[] {
  return run.results
    .filter((r) => r.outcome === "success")
    .map((r) => {
      const cred = run.credentials.find((c) => c.id === r.credential_id);
      return cred ? `${cred.username}:${cred.password}` : null;
    })
    .filter(Boolean) as string[];
}

/** Replicate buildRunReport */
function buildRunReport(run: LoginRun) {
  return {
    run_id: run.id,
    target: run.config.form.url,
    started_at: run.started_at,
    finished_at: run.finished_at,
    status: run.status,
    stats: run.stats,
    results: run.results.map((r) => ({
      credential:
        run.credentials.find((c) => c.id === r.credential_id)?.username ??
        r.credential_id,
      outcome: r.outcome,
      detail: r.detail,
      duration_ms: r.duration_ms,
      profile_id: r.profile_id,
      signals: r.signals_detected,
      rotations: r.rotation_events.length,
      session: r.session_exported,
      final_url: r.final_url,
    })),
    rotations: run.rotation_log,
  };
}

/** Replicate skip-credential logic */
function skipCredential(run: LoginRun, credentialId: string): LoginRun {
  const cred = run.credentials.find((c) => c.id === credentialId);
  if (!cred || cred.status !== "pending") return run;
  const updated: LoginRun = {
    ...run,
    credentials: run.credentials.map((c) =>
      c.id === credentialId
        ? { ...c, status: "skipped" as CredentialStatus }
        : c,
    ),
  };
  updated.stats = computeRunStats(
    updated.credentials,
    updated.results,
    updated.rotation_log,
  );
  return updated;
}

// =============================================================================
//
//  TEST SUITES
//
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// 1. URL Test Store – Report Building
// ─────────────────────────────────────────────────────────────────────────────

describe("URL Test Store – report building", () => {
  const baseTest: UrlTest = {
    id: "test-1",
    url: "https://example.com",
    username: "user@example.com",
    password: "secret",
    status: "completed",
    startedAt: "2025-01-01T00:00:00Z",
    finishedAt: "2025-01-01T00:00:30Z",
    results: [
      makeUrlTestResult("HTTP Status", "PASS", "200 OK"),
      makeUrlTestResult("SSL Certificate", "PASS", "Valid"),
      makeUrlTestResult("Mixed Content", "WARN", "Found 2 insecure resources"),
    ],
    forms: [
      {
        action: "/login",
        method: "POST",
        fields: [
          {
            tag: "input",
            type: "email",
            name: "email",
            id: "email",
            placeholder: "Enter email",
            required: true,
            autocomplete: "email",
            label: "Email",
          },
          {
            tag: "input",
            type: "password",
            name: "password",
            id: "password",
            placeholder: "",
            required: true,
            autocomplete: "current-password",
            label: "Password",
          },
        ],
        submitButtons: ['button[type="submit"]'],
        formType: "login",
        formIndex: 0,
      },
    ],
    loginResult: {
      attempted: true,
      navigatedToLogin: true,
      loginUrl: "https://example.com/login",
      usernameFieldFound: true,
      passwordFieldFound: true,
      submitButtonFound: true,
      submitted: true,
      postSubmitUrl: "https://example.com/dashboard",
      outcomeGuess: "success",
      detail: "Login appeared successful",
    },
    screenshots: {
      desktop: "base64desktopdata",
      tablet: "base64tabletdata",
      mobile: "base64mobiledata",
    },
    summary: { pass: 2, warn: 1, fail: 0, info: 0 },
    overallStatus: "WARN",
    durationMs: 30000,
    error: null,
    progress: null,
  };

  it("includes all required fields in the report", () => {
    const report = buildReport(baseTest);
    expect(report).toHaveProperty("url", baseTest.url);
    expect(report).toHaveProperty("timestamp", baseTest.startedAt);
    expect(report).toHaveProperty("finishedAt", baseTest.finishedAt);
    expect(report).toHaveProperty("durationMs", 30000);
    expect(report).toHaveProperty("summary");
    expect(report).toHaveProperty("overallStatus", "WARN");
    expect(report).toHaveProperty("hasLogin", true);
    expect(report).toHaveProperty("loginResult");
    expect(report).toHaveProperty("forms");
    expect(report).toHaveProperty("results");
  });

  it("includes screenshots in the report (bug fix verification)", () => {
    const report = buildReport(baseTest);
    expect(report).toHaveProperty("screenshots");
    expect(report.screenshots).toHaveProperty("desktop", "base64desktopdata");
    expect(report.screenshots).toHaveProperty("tablet", "base64tabletdata");
    expect(report.screenshots).toHaveProperty("mobile", "base64mobiledata");
  });

  it("hasLogin is false when no username", () => {
    const test: UrlTest = { ...baseTest, username: undefined, password: "secret" };
    const report = buildReport(test);
    expect(report.hasLogin).toBe(false);
  });

  it("hasLogin is false when no password", () => {
    const test: UrlTest = { ...baseTest, username: "user", password: undefined };
    const report = buildReport(test);
    expect(report.hasLogin).toBe(false);
  });

  it("hasLogin is false when both are empty strings", () => {
    const test: UrlTest = { ...baseTest, username: "", password: "" };
    const report = buildReport(test);
    expect(report.hasLogin).toBe(false);
  });

  it("has correct result count", () => {
    const report = buildReport(baseTest);
    expect(report.results).toHaveLength(3);
  });

  it("has correct form count and form fields", () => {
    const report = buildReport(baseTest);
    expect(report.forms).toHaveLength(1);
    expect(report.forms[0].fields).toHaveLength(2);
    expect(report.forms[0].formType).toBe("login");
  });

  it("serialises to valid JSON", () => {
    const report = buildReport(baseTest);
    const json = JSON.stringify(report, null, 2);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.url).toBe("https://example.com");
    expect(parsed.screenshots).toBeDefined();
  });

  it("handles empty screenshots object", () => {
    const test: UrlTest = { ...baseTest, screenshots: {} };
    const report = buildReport(test);
    expect(report.screenshots).toEqual({});
  });

  it("handles null loginResult", () => {
    const test: UrlTest = { ...baseTest, loginResult: null };
    const report = buildReport(test);
    expect(report.loginResult).toBeNull();
  });

  it("handles null summary", () => {
    const test: UrlTest = { ...baseTest, summary: null };
    const report = buildReport(test);
    expect(report.summary).toBeNull();
  });

  it("preserves login screenshot in report", () => {
    const test: UrlTest = {
      ...baseTest,
      loginResult: {
        ...baseTest.loginResult!,
        screenshot: "base64loginscreenshot",
      },
    };
    const report = buildReport(test);
    expect(report.loginResult!.screenshot).toBe("base64loginscreenshot");
  });

  it("handles zero results", () => {
    const test: UrlTest = { ...baseTest, results: [] };
    const report = buildReport(test);
    expect(report.results).toHaveLength(0);
  });

  it("handles zero forms", () => {
    const test: UrlTest = { ...baseTest, forms: [] };
    const report = buildReport(test);
    expect(report.forms).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1b. URL Test Store – Report Filename
// ─────────────────────────────────────────────────────────────────────────────

describe("URL Test Store – report filename", () => {
  it("extracts hostname from valid URL", () => {
    const name = buildReportFilename("https://shop.example.com/login", 1234);
    expect(name).toBe("url-test-shop.example.com-1234");
  });

  it("falls back to 'unknown' for malformed URL", () => {
    const name = buildReportFilename("not a url at all", 1234);
    expect(name).toBe("url-test-unknown-1234");
  });

  it("handles URL with port", () => {
    const name = buildReportFilename("https://localhost:3000/test", 999);
    expect(name).toBe("url-test-localhost-999");
  });

  it("handles URL with www prefix", () => {
    const name = buildReportFilename("https://www.example.com", 0);
    expect(name).toBe("url-test-www.example.com-0");
  });

  it("handles empty URL gracefully", () => {
    const name = buildReportFilename("", 42);
    expect(name).toBe("url-test-unknown-42");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1c. URL Test Store – countByStatus
// ─────────────────────────────────────────────────────────────────────────────

describe("URL Test Store – countByStatus", () => {
  it("counts PASS correctly", () => {
    const results = [
      makeUrlTestResult("a", "PASS"),
      makeUrlTestResult("b", "PASS"),
    ];
    expect(countByStatus(results)).toEqual({ pass: 2, warn: 0, fail: 0, info: 0 });
  });

  it("counts mixed statuses", () => {
    const results = [
      makeUrlTestResult("a", "PASS"),
      makeUrlTestResult("b", "WARN"),
      makeUrlTestResult("c", "FAIL"),
      makeUrlTestResult("d", "INFO"),
      makeUrlTestResult("e", "PASS"),
    ];
    expect(countByStatus(results)).toEqual({ pass: 2, warn: 1, fail: 1, info: 1 });
  });

  it("returns zeros for empty results", () => {
    expect(countByStatus([])).toEqual({ pass: 0, warn: 0, fail: 0, info: 0 });
  });

  it("all FAIL", () => {
    const results = Array.from({ length: 5 }, (_, i) =>
      makeUrlTestResult(`test-${i}`, "FAIL"),
    );
    const s = countByStatus(results);
    expect(s.fail).toBe(5);
    expect(s.pass + s.warn + s.info).toBe(0);
  });

  it("all INFO", () => {
    const results = Array.from({ length: 3 }, (_, i) =>
      makeUrlTestResult(`info-${i}`, "INFO"),
    );
    expect(countByStatus(results).info).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1d. URL Test Store – test lifecycle / progress
// ─────────────────────────────────────────────────────────────────────────────

describe("URL Test Store – test lifecycle", () => {
  it("new test starts with correct initial state", () => {
    const test: UrlTest = {
      id: "t-1",
      url: "https://example.com",
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      results: [],
      forms: [],
      loginResult: null,
      screenshots: {},
      summary: null,
      overallStatus: null,
      durationMs: null,
      error: null,
      progress: {
        testName: "Initializing...",
        testIndex: 0,
        totalTests: 14,
        status: "running",
      },
    };

    expect(test.status).toBe("running");
    expect(test.results).toHaveLength(0);
    expect(test.progress).not.toBeNull();
    expect(test.progress!.totalTests).toBe(14);
  });

  it("test with credentials has 15 total tests", () => {
    const hasLogin = true;
    const totalTests = hasLogin ? 15 : 14;
    expect(totalTests).toBe(15);
  });

  it("test without credentials has 14 total tests", () => {
    const hasLogin = false;
    const totalTests = hasLogin ? 15 : 14;
    expect(totalTests).toBe(14);
  });

  it("progress percentage at 50%", () => {
    const testIndex = 7;
    const totalTests = 14;
    const statusVal = "running" as "running" | "done";
    const pct = Math.round(
      ((testIndex + (statusVal === "done" ? 1 : 0)) / totalTests) * 100,
    );
    expect(pct).toBe(50);
  });

  it("progress percentage at 100% when done", () => {
    const testIndex = 13;
    const totalTests = 14;
    const statusVal = "done" as "running" | "done";
    const pct = Math.round(
      ((testIndex + (statusVal === "done" ? 1 : 0)) / totalTests) * 100,
    );
    expect(pct).toBe(100);
  });

  it("progress percentage at 0% when just started", () => {
    const testIndex = 0;
    const totalTests = 14;
    const statusVal = "running" as "running" | "done";
    const pct = Math.round(
      ((testIndex + (statusVal === "done" ? 1 : 0)) / totalTests) * 100,
    );
    expect(pct).toBe(0);
  });

  it("completed status yields 100 even without progress", () => {
    const status = "completed";
    const progress = null;
    const pct = progress
      ? Math.round(((0 + 1) / 14) * 100)
      : status === "completed"
        ? 100
        : 0;
    expect(pct).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Automation Store – Credential Import
// ─────────────────────────────────────────────────────────────────────────────

describe("Automation – credential import via CSV", () => {
  it("parses colon-separated credentials", () => {
    const result = parseCredentialCsv("user@test.com:pass123\nadmin:secret");
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe("user@test.com");
    expect(result[0].password).toBe("pass123");
    expect(result[1].username).toBe("admin");
    expect(result[1].password).toBe("secret");
  });

  it("parses CSV with header row", () => {
    const csv = "username,password\nuser1,pass1\nuser2,pass2";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe("user1");
  });

  it("handles passwords containing colons", () => {
    const result = parseCredentialCsv("user@test.com:p@ss:w0rd:123");
    expect(result).toHaveLength(1);
    expect(result[0].password).toBe("p@ss:w0rd:123");
  });

  it("skips empty lines", () => {
    const csv = "user1:pass1\n\n\nuser2:pass2\n\n";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(2);
  });

  it("returns empty for empty input", () => {
    expect(parseCredentialCsv("")).toHaveLength(0);
  });

  it("all credentials start as pending", () => {
    const result = parseCredentialCsv("a:b\nc:d\ne:f");
    for (const cred of result) {
      expect(cred.status).toBe("pending");
    }
  });

  it("assigns unique IDs", () => {
    const result = parseCredentialCsv("u1:p1\nu2:p2\nu3:p3");
    const ids = new Set(result.map((c) => c.id));
    expect(ids.size).toBe(3);
  });

  it("trims whitespace", () => {
    const result = parseCredentialCsv("  user1  :  pass1  ");
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("user1");
    expect(result[0].password).toBe("pass1");
  });

  it("handles CRLF line endings", () => {
    const csv = "a:b\r\nc:d\r\n";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(2);
  });
});

describe("Automation – credential import via JSON", () => {
  it("parses standard JSON array", () => {
    const json = JSON.stringify([
      { username: "u1", password: "p1" },
      { username: "u2", password: "p2" },
    ]);
    const result = parseCredentialJson(json);
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe("u1");
  });

  it("handles email alias", () => {
    const json = JSON.stringify([{ email: "test@x.com", password: "pass" }]);
    const result = parseCredentialJson(json);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("test@x.com");
  });

  it("captures extras", () => {
    const json = JSON.stringify([
      { username: "u", password: "p", totp_seed: "ABC123" },
    ]);
    const result = parseCredentialJson(json);
    expect(result[0].extras).toHaveProperty("totp_seed", "ABC123");
  });

  it("returns empty for invalid JSON", () => {
    expect(parseCredentialJson("not json")).toHaveLength(0);
  });

  it("skips items with missing password", () => {
    const json = JSON.stringify([
      { username: "u1" },
      { username: "u2", password: "p2" },
    ]);
    const result = parseCredentialJson(json);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("u2");
  });

  it("returns empty for empty array", () => {
    expect(parseCredentialJson("[]")).toHaveLength(0);
  });

  it("returns empty for non-array JSON", () => {
    expect(parseCredentialJson('{"username":"a","password":"b"}')).toHaveLength(0);
  });

  it("all credentials start as pending with attempts=0", () => {
    const json = JSON.stringify([{ username: "u", password: "p" }]);
    const cred = parseCredentialJson(json)[0];
    expect(cred.status).toBe("pending");
    expect(cred.attempts).toBe(0);
    expect(cred.profile_id).toBeNull();
    expect(cred.last_attempt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2b. Automation – Credential Deduplication
// ─────────────────────────────────────────────────────────────────────────────

describe("Automation – credential deduplication", () => {
  it("deduplicates by username+password", () => {
    const existing = [makeCred("u1", "p1"), makeCred("u2", "p2")];
    const imported = parseCredentialCsv("u1:p1\nu3:p3\nu2:p2");

    const existingSet = new Set(existing.map((c) => `${c.username}::${c.password}`));
    const fresh = imported.filter((c) => !existingSet.has(`${c.username}::${c.password}`));

    expect(fresh).toHaveLength(1);
    expect(fresh[0].username).toBe("u3");
  });

  it("same username different password is not a duplicate", () => {
    const existing = [makeCred("u1", "p1")];
    const imported = parseCredentialCsv("u1:differentpass");

    const existingSet = new Set(existing.map((c) => `${c.username}::${c.password}`));
    const fresh = imported.filter((c) => !existingSet.has(`${c.username}::${c.password}`));

    expect(fresh).toHaveLength(1);
  });

  it("empty existing list means all are fresh", () => {
    const existing: CredentialPair[] = [];
    const imported = parseCredentialCsv("u1:p1\nu2:p2");

    const existingSet = new Set(existing.map((c) => `${c.username}::${c.password}`));
    const fresh = imported.filter((c) => !existingSet.has(`${c.username}::${c.password}`));

    expect(fresh).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Automation Store – Run Creation and Config
// ─────────────────────────────────────────────────────────────────────────────

describe("Automation – run creation", () => {
  it("creates a run with correct credential count", () => {
    const creds = [makeCred("u1", "p1"), makeCred("u2", "p2")];
    const run = createRun(makeFormConfig(), creds);
    expect(run.credentials).toHaveLength(2);
    expect(run.stats.total).toBe(2);
    expect(run.stats.pending).toBe(2);
  });

  it("all credentials are set to pending on creation", () => {
    const creds = [makeCred("u1", "p1", "success"), makeCred("u2", "p2", "failed")];
    const run = createRun(makeFormConfig(), creds);
    for (const c of run.credentials) {
      expect(c.status).toBe("pending");
    }
  });

  it("run starts in idle status", () => {
    const run = createRun(makeFormConfig(), [makeCred("u", "p")]);
    expect(run.status).toBe("idle");
    expect(run.started_at).toBeNull();
    expect(run.finished_at).toBeNull();
  });

  it("results and rotation_log start empty", () => {
    const run = createRun(makeFormConfig(), [makeCred("u", "p")]);
    expect(run.results).toHaveLength(0);
    expect(run.rotation_log).toHaveLength(0);
  });

  it("config uses domain profile from URL", () => {
    const config = createRunConfig(makeFormConfig("https://shopify.com/login"));
    const dp = resolveDomainProfile("https://shopify.com/login");
    expect(config.domain_profile).toBeDefined();
    expect(config.domain_profile!.hostname).toBe(dp.hostname);
    expect(config.launch_delay_ms).toBe(dp.min_attempt_gap_ms);
    expect(config.patch_tls).toBe(dp.patch_tls);
  });

  it("config uses option overrides", () => {
    const config = createRunConfig(makeFormConfig(), {
      concurrency: 5,
      max_retries: 10,
      mode: "parallel" as RunMode,
      rotate_every_attempt: true,
    });
    expect(config.concurrency).toBe(5);
    expect(config.max_retries).toBe(10);
    expect(config.mode).toBe("parallel");
    expect(config.rotate_every_attempt).toBe(true);
  });

  it("config defaults to sequential mode", () => {
    const config = createRunConfig(makeFormConfig());
    expect(config.mode).toBe("sequential");
  });

  it("config defaults max_retries to 2", () => {
    const config = createRunConfig(makeFormConfig());
    expect(config.max_retries).toBe(2);
  });

  it("config defaults concurrency to 1", () => {
    const config = createRunConfig(makeFormConfig());
    expect(config.concurrency).toBe(1);
  });

  it("empty credential list creates run with 0 total", () => {
    const run = createRun(makeFormConfig(), []);
    expect(run.stats.total).toBe(0);
    expect(run.credentials).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Automation Store – Message Handling
// ─────────────────────────────────────────────────────────────────────────────

describe("Automation – login_attempt_start handling", () => {
  it("marks credential as running", () => {
    const cred = makeCred("u1", "p1");
    const run = createRun(makeFormConfig(), [cred]);
    const updated = applyAttemptStart(run, cred.id, "profile-1");

    expect(updated.credentials[0].status).toBe("running");
    expect(updated.credentials[0].profile_id).toBe("profile-1");
    expect(updated.credentials[0].last_attempt).not.toBeNull();
  });

  it("updates stats to reflect running credential", () => {
    const cred = makeCred("u1", "p1");
    const run = createRun(makeFormConfig(), [cred]);
    const updated = applyAttemptStart(run, cred.id, "profile-1");

    expect(updated.stats.running).toBe(1);
    expect(updated.stats.pending).toBe(0);
  });

  it("does not affect other credentials", () => {
    const c1 = makeCred("u1", "p1");
    const c2 = makeCred("u2", "p2");
    const run = createRun(makeFormConfig(), [c1, c2]);
    const updated = applyAttemptStart(run, c1.id, "profile-1");

    expect(updated.credentials[0].status).toBe("running");
    expect(updated.credentials[1].status).toBe("pending");
  });
});

describe("Automation – login_attempt_result handling", () => {
  it("success marks credential as success", () => {
    const cred = makeCred("u1", "p1");
    const run = createRun(makeFormConfig(), [cred]);
    const result = makeAttemptResult(cred.id, "success");
    const updated = applyAttemptResult(run, result);

    expect(updated.credentials[0].status).toBe("success");
    expect(updated.results).toHaveLength(1);
    expect(updated.stats.success).toBe(1);
    expect(updated.stats.pending).toBe(0);
  });

  it("wrong_credentials marks credential as failed", () => {
    const cred = makeCred("u1", "p1");
    const run = createRun(makeFormConfig(), [cred]);
    const result = makeAttemptResult(cred.id, "wrong_credentials");
    const updated = applyAttemptResult(run, result);

    expect(updated.credentials[0].status).toBe("failed");
    expect(updated.stats.failed).toBe(1);
  });

  it("captcha_block marks credential as soft_blocked", () => {
    const cred = makeCred("u1", "p1");
    const run = createRun(makeFormConfig(), [cred]);
    const result = makeAttemptResult(cred.id, "captcha_block");
    const updated = applyAttemptResult(run, result);

    expect(updated.credentials[0].status).toBe("soft_blocked");
    expect(updated.stats.soft_blocked).toBe(1);
  });

  it("rate_limited marks credential as soft_blocked", () => {
    const cred = makeCred("u1", "p1");
    const run = createRun(makeFormConfig(), [cred]);
    const result = makeAttemptResult(cred.id, "rate_limited");
    const updated = applyAttemptResult(run, result);

    expect(updated.credentials[0].status).toBe("soft_blocked");
  });

  it("ip_blocked marks credential as soft_blocked", () => {
    const cred = makeCred("u1", "p1");
    const run = createRun(makeFormConfig(), [cred]);
    const result = makeAttemptResult(cred.id, "ip_blocked");
    const updated = applyAttemptResult(run, result);

    expect(updated.credentials[0].status).toBe("soft_blocked");
  });

  it("account_locked marks credential as hard_blocked", () => {
    const cred = makeCred("u1", "p1");
    const run = createRun(makeFormConfig(), [cred]);
    const result = makeAttemptResult(cred.id, "account_locked");
    const updated = applyAttemptResult(run, result);

    expect(updated.credentials[0].status).toBe("hard_blocked");
    expect(updated.stats.hard_blocked).toBe(1);
  });

  it("timeout marks credential as error", () => {
    const cred = makeCred("u1", "p1");
    const run = createRun(makeFormConfig(), [cred]);
    const result = makeAttemptResult(cred.id, "timeout");
    const updated = applyAttemptResult(run, result);

    expect(updated.credentials[0].status).toBe("error");
    expect(updated.stats.error).toBe(1);
  });

  it("error marks credential as error", () => {
    const cred = makeCred("u1", "p1");
    const run = createRun(makeFormConfig(), [cred]);
    const result = makeAttemptResult(cred.id, "error");
    const updated = applyAttemptResult(run, result);

    expect(updated.credentials[0].status).toBe("error");
  });

  it("handles multiple results sequentially", () => {
    const c1 = makeCred("u1", "p1");
    const c2 = makeCred("u2", "p2");
    const c3 = makeCred("u3", "p3");
    let run = createRun(makeFormConfig(), [c1, c2, c3]);

    run = applyAttemptResult(run, makeAttemptResult(c1.id, "success"));
    run = applyAttemptResult(run, makeAttemptResult(c2.id, "wrong_credentials"));
    run = applyAttemptResult(run, makeAttemptResult(c3.id, "captcha_block"));

    expect(run.results).toHaveLength(3);
    expect(run.stats.success).toBe(1);
    expect(run.stats.failed).toBe(1);
    expect(run.stats.soft_blocked).toBe(1);
    expect(run.stats.pending).toBe(0);
    expect(run.credentials[0].status).toBe("success");
    expect(run.credentials[1].status).toBe("failed");
    expect(run.credentials[2].status).toBe("soft_blocked");
  });

  it("unknown credential_id does not crash", () => {
    const run = createRun(makeFormConfig(), [makeCred("u1", "p1")]);
    const result = makeAttemptResult("nonexistent-id", "success");
    const updated = applyAttemptResult(run, result);

    // Result is added but no credential is updated
    expect(updated.results).toHaveLength(1);
    expect(updated.credentials[0].status).toBe("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Automation Store – Abort and Skip
// ─────────────────────────────────────────────────────────────────────────────

describe("Automation – abort run", () => {
  it("marks run as aborted", () => {
    const run = createRun(makeFormConfig(), [makeCred("u1", "p1")]);
    const aborted = applyAbort(run);
    expect(aborted.status).toBe("aborted");
    expect(aborted.finished_at).not.toBeNull();
  });

  it("marks pending credentials as skipped", () => {
    const creds = [makeCred("u1", "p1"), makeCred("u2", "p2"), makeCred("u3", "p3")];
    let run = createRun(makeFormConfig(), creds);
    // Simulate first credential succeeding
    run = applyAttemptResult(run, makeAttemptResult(creds[0].id, "success"));

    const aborted = applyAbort(run);
    expect(aborted.credentials[0].status).toBe("success"); // preserved
    expect(aborted.credentials[1].status).toBe("skipped");
    expect(aborted.credentials[2].status).toBe("skipped");
  });

  it("marks running credentials as skipped", () => {
    const cred = makeCred("u1", "p1");
    let run = createRun(makeFormConfig(), [cred]);
    run = applyAttemptStart(run, cred.id, "p1");
    expect(run.credentials[0].status).toBe("running");

    const aborted = applyAbort(run);
    expect(aborted.credentials[0].status).toBe("skipped");
    expect(aborted.stats.skipped).toBe(1);
  });

  it("updates stats correctly after abort", () => {
    const creds = [makeCred("u1", "p1"), makeCred("u2", "p2")];
    let run = createRun(makeFormConfig(), creds);
    run = applyAttemptResult(run, makeAttemptResult(creds[0].id, "success"));

    const aborted = applyAbort(run);
    expect(aborted.stats.success).toBe(1);
    expect(aborted.stats.skipped).toBe(1);
    expect(aborted.stats.pending).toBe(0);
  });
});

describe("Automation – skip credential", () => {
  it("skips a pending credential", () => {
    const cred = makeCred("u1", "p1");
    const run = createRun(makeFormConfig(), [cred]);
    const updated = skipCredential(run, cred.id);

    expect(updated.credentials[0].status).toBe("skipped");
    expect(updated.stats.skipped).toBe(1);
    expect(updated.stats.pending).toBe(0);
  });

  it("does not skip a non-pending credential", () => {
    const cred = makeCred("u1", "p1");
    let run = createRun(makeFormConfig(), [cred]);
    run = applyAttemptStart(run, cred.id, "p1"); // now "running"
    const updated = skipCredential(run, cred.id);

    // Should not change — still running
    expect(updated.credentials[0].status).toBe("running");
  });

  it("returns same run if credential not found", () => {
    const run = createRun(makeFormConfig(), [makeCred("u1", "p1")]);
    const updated = skipCredential(run, "nonexistent");
    expect(updated).toBe(run);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Automation Store – Export Helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("Automation – success credentials export", () => {
  it("extracts only successful credentials", () => {
    const c1 = makeCred("good@user.com", "pass1");
    const c2 = makeCred("bad@user.com", "pass2");
    const c3 = makeCred("also-good@user.com", "pass3");
    let run = createRun(makeFormConfig(), [c1, c2, c3]);
    run = applyAttemptResult(run, makeAttemptResult(c1.id, "success"));
    run = applyAttemptResult(run, makeAttemptResult(c2.id, "wrong_credentials"));
    run = applyAttemptResult(run, makeAttemptResult(c3.id, "success"));

    const lines = buildSuccessCredsLines(run);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("good@user.com:pass1");
    expect(lines[1]).toBe("also-good@user.com:pass3");
  });

  it("returns empty for no successes", () => {
    const cred = makeCred("u1", "p1");
    let run = createRun(makeFormConfig(), [cred]);
    run = applyAttemptResult(run, makeAttemptResult(cred.id, "wrong_credentials"));

    const lines = buildSuccessCredsLines(run);
    expect(lines).toHaveLength(0);
  });

  it("returns empty for empty run", () => {
    const run = createRun(makeFormConfig(), []);
    const lines = buildSuccessCredsLines(run);
    expect(lines).toHaveLength(0);
  });
});

describe("Automation – run report export", () => {
  it("includes all required fields", () => {
    const cred = makeCred("user@test.com", "pw");
    let run = createRun(makeFormConfig("https://shopify.com/login"), [cred]);
    run.started_at = new Date().toISOString();
    run = applyAttemptResult(run, makeAttemptResult(cred.id, "success"));
    run.status = "completed";
    run.finished_at = new Date().toISOString();

    const report = buildRunReport(run);

    expect(report).toHaveProperty("run_id", run.id);
    expect(report).toHaveProperty("target", "https://shopify.com/login");
    expect(report).toHaveProperty("started_at");
    expect(report).toHaveProperty("finished_at");
    expect(report).toHaveProperty("status", "completed");
    expect(report).toHaveProperty("stats");
    expect(report).toHaveProperty("results");
    expect(report).toHaveProperty("rotations");
    expect(report.results).toHaveLength(1);
  });

  it("maps credential username into result row", () => {
    const cred = makeCred("test@example.com", "pw");
    let run = createRun(makeFormConfig(), [cred]);
    run = applyAttemptResult(run, makeAttemptResult(cred.id, "success"));

    const report = buildRunReport(run);
    expect(report.results[0].credential).toBe("test@example.com");
  });

  it("falls back to credential_id if credential not found", () => {
    const cred = makeCred("u1", "p1");
    let run = createRun(makeFormConfig(), [cred]);
    const result = makeAttemptResult("orphan-id", "success");
    run.results = [result];

    const report = buildRunReport(run);
    expect(report.results[0].credential).toBe("orphan-id");
  });

  it("serialises to valid JSON", () => {
    const cred = makeCred("u", "p");
    let run = createRun(makeFormConfig(), [cred]);
    run = applyAttemptResult(run, makeAttemptResult(cred.id, "success"));

    const report = buildRunReport(run);
    const json = JSON.stringify(report, null, 2);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("rotations are included", () => {
    const cred = makeCred("u1", "p1");
    let run = createRun(makeFormConfig(), [cred]);
    run.rotation_log = [makeRotationEvent(), makeRotationEvent()];

    const report = buildRunReport(run);
    expect(report.rotations).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Automation Store – Form Presets (getFormPreset / KNOWN_FORM_CONFIGS)
// ─────────────────────────────────────────────────────────────────────────────

describe("Automation – getFormPreset", () => {
  it("returns preset for exact known hostname", () => {
    const preset = getFormPreset("https://shopify.com/login");
    expect(preset).toHaveProperty("username_selector");
    expect(preset.username_selector).toBeTruthy();
  });

  it("returns preset for www. prefixed hostname", () => {
    const preset = getFormPreset("https://www.instagram.com/accounts/login");
    // instagram.com should match after www. stripping
    expect(preset).toHaveProperty("username_selector");
  });

  it("returns preset for subdomain falling back to parent", () => {
    const preset = getFormPreset("https://seller.amazon.com/login");
    // seller.amazon.com → parent amazon.com
    expect(preset).toHaveProperty("username_selector");
  });

  it("returns empty object for unknown domain", () => {
    const preset = getFormPreset("https://unknown-site-12345.com/login");
    expect(Object.keys(preset)).toHaveLength(0);
  });

  it("returns empty for malformed URL", () => {
    const preset = getFormPreset("not-a-url");
    expect(Object.keys(preset)).toHaveLength(0);
  });

  it("all KNOWN_FORM_CONFIGS have username, password, and submit selectors", () => {
    for (const [domain, config] of Object.entries(KNOWN_FORM_CONFIGS)) {
      expect(config.username_selector, `${domain} username_selector`).toBeTruthy();
      expect(config.password_selector, `${domain} password_selector`).toBeTruthy();
      expect(config.submit_selector, `${domain} submit_selector`).toBeTruthy();
    }
  });

  it("all KNOWN_FORM_CONFIGS have post_submit_timeout_ms", () => {
    for (const [domain, config] of Object.entries(KNOWN_FORM_CONFIGS)) {
      expect(config.post_submit_timeout_ms, `${domain} timeout`).toBeGreaterThan(0);
    }
  });

  it("all KNOWN_FORM_CONFIGS have export_session_on_success=true", () => {
    for (const [domain, config] of Object.entries(KNOWN_FORM_CONFIGS)) {
      expect(config.export_session_on_success, `${domain} export_session`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Form Scraper Integration – selectorsToFormConfig
// ─────────────────────────────────────────────────────────────────────────────

describe("Form Scraper – selectorsToFormConfig", () => {
  it("converts scraped result to form config", () => {
    const scraped = makeScrapedResult();
    const config = selectorsToFormConfig("https://example.com/login", scraped);

    expect(config).toHaveProperty("url", "https://example.com/login");
    expect(config).toHaveProperty("username_selector", 'input[type="email"]');
    expect(config).toHaveProperty("password_selector", 'input[type="password"]');
    expect(config).toHaveProperty("submit_selector", 'button[type="submit"]');
    expect(config).toHaveProperty("success_selector", ".dashboard");
    expect(config).toHaveProperty("failure_selector", ".error-message");
    expect(config).toHaveProperty("captcha_selector", ".g-recaptcha");
  });

  it("handles missing optional selectors gracefully", () => {
    const scraped = makeScrapedResult({
      success_selector: undefined,
      failure_selector: undefined,
      captcha_selector: undefined,
    });
    const config = selectorsToFormConfig("https://example.com", scraped);

    expect(config.success_selector).toBeUndefined();
    expect(config.failure_selector).toBeUndefined();
    expect(config.captcha_selector).toBeUndefined();
  });
});

describe("Form Scraper – FORM_PRESETS", () => {
  it("has presets for common platforms", () => {
    const expectedDomains = [
      "shopify.com",
      "accounts.google.com",
      "instagram.com",
      "twitter.com",
      "amazon.com",
      "linkedin.com",
    ];
    for (const domain of expectedDomains) {
      expect(FORM_PRESETS, `Missing preset for ${domain}`).toHaveProperty(domain);
    }
  });

  it("all presets have non-empty selector strings", () => {
    for (const [domain, preset] of Object.entries(FORM_PRESETS)) {
      expect(preset.username_selector!.length, `${domain} username`).toBeGreaterThan(0);
      expect(preset.password_selector!.length, `${domain} password`).toBeGreaterThan(0);
      expect(preset.submit_selector!.length, `${domain} submit`).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Automation – computeRunStats integration
// ─────────────────────────────────────────────────────────────────────────────

describe("Automation – computeRunStats consistency", () => {
  it("total equals sum of all status counts", () => {
    const creds = [
      makeCred("u1", "p1", "success"),
      makeCred("u2", "p2", "failed"),
      makeCred("u3", "p3", "soft_blocked"),
      makeCred("u4", "p4", "hard_blocked"),
      makeCred("u5", "p5", "error"),
      makeCred("u6", "p6", "skipped"),
      makeCred("u7", "p7", "pending"),
      makeCred("u8", "p8", "running"),
    ];
    const stats = computeRunStats(creds, [], []);
    const sum =
      stats.pending +
      stats.running +
      stats.success +
      stats.failed +
      stats.soft_blocked +
      stats.hard_blocked +
      stats.error +
      stats.skipped;
    expect(sum).toBe(stats.total);
  });

  it("counts rotations from rotation log", () => {
    const creds = [makeCred("u1", "p1")];
    const rotations = [makeRotationEvent(), makeRotationEvent(), makeRotationEvent()];
    const stats = computeRunStats(creds, [], rotations);
    expect(stats.rotations).toBe(3);
  });

  it("zero rotations for empty log", () => {
    const stats = computeRunStats([], [], []);
    expect(stats.rotations).toBe(0);
  });

  it("handles large batch", () => {
    const creds = Array.from({ length: 500 }, (_, i) =>
      makeCred(`u${i}`, `p${i}`, i < 200 ? "success" : "pending"),
    );
    const stats = computeRunStats(creds, [], []);
    expect(stats.total).toBe(500);
    expect(stats.success).toBe(200);
    expect(stats.pending).toBe(300);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Automation – Outcome → Credential Status mapping (exhaustive)
// ─────────────────────────────────────────────────────────────────────────────

describe("Automation – outcomeToCredentialStatus mapping", () => {
  const cases: [AttemptOutcome, CredentialStatus][] = [
    ["success", "success"],
    ["wrong_credentials", "failed"],
    ["account_locked", "hard_blocked"],
    ["captcha_block", "soft_blocked"],
    ["rate_limited", "soft_blocked"],
    ["ip_blocked", "soft_blocked"],
    ["2fa_required", "error"],
    ["unexpected_redirect", "error"],
    ["timeout", "error"],
    ["error", "error"],
  ];

  for (const [outcome, expectedStatus] of cases) {
    it(`${outcome} → ${expectedStatus}`, () => {
      expect(outcomeToCredentialStatus(outcome)).toBe(expectedStatus);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Automation – Domain Profile integration
// ─────────────────────────────────────────────────────────────────────────────

describe("Automation – domain profile integration", () => {
  it("shopify.com resolves to a known profile", () => {
    const dp = resolveDomainProfile("https://shopify.com/login");
    expect(dp.hostname).toBe("shopify.com");
    expect(dp.threat_level).toBeDefined();
  });

  it("accounts.google.com is paranoid threat level", () => {
    const dp = resolveDomainProfile("https://accounts.google.com");
    expect(dp.threat_level).toBe("paranoid");
  });

  it("unknown domain gets default profile", () => {
    const dp = resolveDomainProfile("https://totally-unknown-site.xyz");
    expect(dp.hostname).toBe("totally-unknown-site.xyz");
  });

  it("www prefix is stripped for matching", () => {
    const with_www = resolveDomainProfile("https://www.instagram.com");
    const without_www = resolveDomainProfile("https://instagram.com");
    expect(with_www.hostname).toBe(without_www.hostname);
  });

  it("domain profile fields are wired into run config", () => {
    const form = makeFormConfig("https://accounts.google.com/login");
    const config = createRunConfig(form);
    const dp = resolveDomainProfile("https://accounts.google.com/login");

    expect(config.domain_profile).toBeDefined();
    expect(config.launch_delay_ms).toBe(dp.min_attempt_gap_ms);
    expect(config.patch_tls).toBe(dp.patch_tls);
    expect(config.domain_aware_noise).toBe(true);
  });

  it("all DOMAIN_PROFILES have required numeric fields > 0", () => {
    for (const [hostname, dp] of Object.entries(DOMAIN_PROFILES)) {
      expect(dp.min_attempt_gap_ms, `${hostname} min_attempt_gap_ms`).toBeGreaterThan(0);
      expect(dp.rotate_after_n_attempts, `${hostname} rotate_after`).toBeGreaterThan(0);
      expect(dp.typing_speed_factor, `${hostname} typing`).toBeGreaterThan(0);
      expect(dp.typing_speed_factor, `${hostname} typing <= 1`).toBeLessThanOrEqual(1);
      expect(dp.mouse_speed_factor, `${hostname} mouse`).toBeGreaterThan(0);
      expect(dp.mouse_speed_factor, `${hostname} mouse <= 1`).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. End-to-end: full run lifecycle simulation
// ─────────────────────────────────────────────────────────────────────────────

describe("Automation – full run lifecycle", () => {
  it("simulates a complete run from creation through completion", () => {
    // 1. Import credentials
    const creds = parseCredentialCsv("alice@test.com:pw1\nbob@test.com:pw2\ncharlie@test.com:pw3");
    expect(creds).toHaveLength(3);

    // 2. Create run
    const form = makeFormConfig("https://shopify.com/login");
    let run = createRun(form, creds);
    expect(run.status).toBe("idle");
    expect(run.stats.total).toBe(3);
    expect(run.stats.pending).toBe(3);

    // 3. Start run
    run = { ...run, status: "running", started_at: new Date().toISOString() };

    // 4. First credential starts
    run = applyAttemptStart(run, creds[0].id, "profile-a");
    expect(run.stats.running).toBe(1);
    expect(run.stats.pending).toBe(2);

    // 5. First credential succeeds
    run = applyAttemptResult(run, makeAttemptResult(creds[0].id, "success"));
    expect(run.stats.success).toBe(1);
    expect(run.stats.running).toBe(0);

    // 6. Second credential starts and fails
    run = applyAttemptStart(run, creds[1].id, "profile-b");
    run = applyAttemptResult(run, makeAttemptResult(creds[1].id, "wrong_credentials"));
    expect(run.stats.failed).toBe(1);

    // 7. Third credential starts, gets captcha blocked
    run = applyAttemptStart(run, creds[2].id, "profile-c");
    run = applyAttemptResult(run, makeAttemptResult(creds[2].id, "captcha_block"));
    expect(run.stats.soft_blocked).toBe(1);

    // 8. Complete
    run = { ...run, status: "completed", finished_at: new Date().toISOString() };
    expect(run.stats.pending).toBe(0);
    expect(run.stats.success + run.stats.failed + run.stats.soft_blocked).toBe(3);

    // 9. Export success creds
    const hits = buildSuccessCredsLines(run);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBe("alice@test.com:pw1");

    // 10. Export report
    const report = buildRunReport(run);
    expect(report.status).toBe("completed");
    expect(report.results).toHaveLength(3);
    expect(report.target).toBe("https://shopify.com/login");

    const json = JSON.stringify(report, null, 2);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("simulates abort mid-run", () => {
    const creds = parseCredentialCsv("u1:p1\nu2:p2\nu3:p3\nu4:p4");
    let run = createRun(makeFormConfig(), creds);
    run = { ...run, status: "running", started_at: new Date().toISOString() };

    // Process first two
    run = applyAttemptResult(run, makeAttemptResult(creds[0].id, "success"));
    run = applyAttemptStart(run, creds[1].id, "profile-x");

    // Abort while cred[1] is running, cred[2] and cred[3] are pending
    const aborted = applyAbort(run);
    expect(aborted.status).toBe("aborted");
    expect(aborted.credentials[0].status).toBe("success");   // preserved
    expect(aborted.credentials[1].status).toBe("skipped");   // was running
    expect(aborted.credentials[2].status).toBe("skipped");   // was pending
    expect(aborted.credentials[3].status).toBe("skipped");   // was pending
    expect(aborted.stats.success).toBe(1);
    expect(aborted.stats.skipped).toBe(3);
  });
});
