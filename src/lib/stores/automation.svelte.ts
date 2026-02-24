// ── Manifold automation store ─────────────────────────────────────────────────
//
// Manages the full lifecycle of login automation runs:
//   • Credential import (CSV / JSON / raw colon-separated)
//   • Run creation, start, pause, resume, abort
//   • Real-time result streaming via bridgeStore WebSocket
//   • Session state export / download
//   • Persisted run history (in-memory, exportable as JSON)

import { bridgeStore } from "./bridge.svelte";
import { profileStore } from "./profiles.svelte";
import { proxyStore } from "./proxy.svelte";
import type {
  LoginRun,
  LoginRunConfig,
  CredentialPair,
  CredentialStatus,
  AttemptResult,
  RotationEvent,
  RunStats,
  LoginFormConfig,
  SessionState,
  RunMode,
} from "../../../playwright-bridge/login-types";
import {
  parseCredentialCsv,
  parseCredentialJson,
  computeRunStats,
  resolveDomainProfile,
} from "../../../playwright-bridge/login-types";

// ─────────────────────────────────────────────────────────────────────────────
// Default form configs for known platforms
// ─────────────────────────────────────────────────────────────────────────────

export const KNOWN_FORM_CONFIGS: Record<string, Partial<LoginFormConfig>> = {
  "shopify.com": {
    username_selector:
      '#account_email, input[name="email"], input[type="email"]',
    password_selector:
      '#account_password, input[name="password"], input[type="password"]',
    submit_selector:
      'button[type="submit"], input[type="submit"], .btn-primary',
    success_selector: '.dashboard, #MainContent, [data-trekkie-id="dashboard"]',
    failure_selector: ".field__message--error, .notice--error, [data-error]",
    captcha_selector: ".g-recaptcha, .h-captcha",
    consent_selector: "#onetrust-accept-btn-handler, .consent-banner button",
    post_submit_timeout_ms: 10_000,
    export_session_on_success: true,
  },
  "accounts.google.com": {
    username_selector: 'input[type="email"]',
    password_selector: 'input[type="password"], input[name="password"]',
    submit_selector:
      '#identifierNext button, #passwordNext button, [data-idom-class="nCP5yc"]',
    success_selector: "[data-ogsr-up], .gb_A, #gb",
    failure_selector: "#view_container .Ekjuhf, [data-error-code]",
    captcha_selector: ".g-recaptcha",
    totp_selector: 'input[name="totpPin"], #totpPin',
    post_submit_timeout_ms: 12_000,
    export_session_on_success: true,
  },
  "instagram.com": {
    username_selector: 'input[name="username"]',
    password_selector: 'input[name="password"]',
    submit_selector: 'button[type="submit"]',
    success_selector: 'nav[role="navigation"], svg[aria-label="Home"]',
    failure_selector: '#slfErrorAlert, [data-testid="login-error-message"]',
    captcha_selector: ".h-captcha, .g-recaptcha",
    post_submit_timeout_ms: 10_000,
    export_session_on_success: true,
  },
  "twitter.com": {
    username_selector: 'input[name="text"], input[autocomplete="username"]',
    password_selector: 'input[name="password"], input[type="password"]',
    submit_selector:
      '[data-testid="LoginForm_Login_Button"], [role="button"]:has-text("Log in")',
    success_selector:
      '[data-testid="primaryColumn"], [aria-label="Home timeline"]',
    failure_selector:
      '[data-testid="LoginForm_Login_Button"] + * [role="alert"]',
    post_submit_timeout_ms: 12_000,
    export_session_on_success: true,
  },
  "linkedin.com": {
    username_selector: '#username, input[name="session_key"]',
    password_selector: '#password, input[name="session_password"]',
    submit_selector: 'button[type="submit"], .sign-in-form__submit-button',
    success_selector:
      '.global-nav, [data-test-id="nav-settings__dropdown-trigger"]',
    failure_selector:
      ".alert-content, #error-for-username, #error-for-password",
    captcha_selector: ".g-recaptcha",
    post_submit_timeout_ms: 10_000,
    export_session_on_success: true,
  },
  "amazon.com": {
    username_selector: '#ap_email, input[name="email"]',
    password_selector: '#ap_password, input[name="password"]',
    submit_selector: '#signInSubmit, input[type="submit"]',
    success_selector: "#nav-link-accountList, .nav-line-1",
    failure_selector: "#auth-error-message-box, .a-alert-error",
    captcha_selector: '.a-box-inner .a-row:has(img[src*="captcha"])',
    post_submit_timeout_ms: 10_000,
    export_session_on_success: true,
  },
};

export function getFormPreset(url: string): Partial<LoginFormConfig> {
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
// State
// ─────────────────────────────────────────────────────────────────────────────

let runs = $state<LoginRun[]>([]);
let activeRunId = $state<string | null>(null);
let drafts = $state<CredentialPair[]>([]);
let draftRunConfig = $state<Partial<LoginRunConfig>>({});
let importError = $state<string | null>(null);
let wsConnected = $state(false);

// ─────────────────────────────────────────────────────────────────────────────
// Derived
// ─────────────────────────────────────────────────────────────────────────────

let activeRun = $derived(runs.find((r) => r.id === activeRunId) ?? null);

let globalStats = $derived(
  activeRun
    ? activeRun.stats
    : {
        total: 0,
        pending: 0,
        running: 0,
        success: 0,
        failed: 0,
        soft_blocked: 0,
        hard_blocked: 0,
        error: 0,
        skipped: 0,
        rotations: 0,
      },
);

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket message handler
// ─────────────────────────────────────────────────────────────────────────────

function handleWsMessage(raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return;
  const msg = raw as Record<string, unknown>;

  switch (msg.type) {
    case "login_attempt_start": {
      const run = runs.find((r) => r.id === msg.run_id);
      if (!run) return;
      const cred = run.credentials.find((c) => c.id === msg.credential_id);
      if (cred) {
        cred.status = "running";
        cred.profile_id = msg.profile_id as string;
        cred.last_attempt = new Date().toISOString();
      }
      run.stats = computeRunStats(
        run.credentials,
        run.results,
        run.rotation_log,
      );
      // Trigger Svelte reactivity
      runs = [...runs];
      break;
    }

    case "login_attempt_result": {
      const run = runs.find((r) => r.id === msg.run_id);
      if (!run) return;
      const result = msg.result as AttemptResult;
      run.results.push(result);
      const cred = run.credentials.find((c) => c.id === result.credential_id);
      if (cred) {
        cred.status =
          result.outcome === "success"
            ? "success"
            : result.outcome === "wrong_credentials"
              ? "failed"
              : result.outcome === "account_locked"
                ? "hard_blocked"
                : result.outcome === "ip_blocked" ||
                    result.outcome === "captcha_block" ||
                    result.outcome === "rate_limited"
                  ? "soft_blocked"
                  : "error";
      }
      run.stats = computeRunStats(
        run.credentials,
        run.results,
        run.rotation_log,
      );
      // Trigger reactivity
      runs = [...runs];
      break;
    }

    case "login_rotation": {
      const run = runs.find((r) => r.id === msg.run_id);
      if (!run) return;
      run.rotation_log.push(msg.event as RotationEvent);
      run.stats = computeRunStats(
        run.credentials,
        run.results,
        run.rotation_log,
      );
      runs = [...runs];
      break;
    }

    case "login_run_complete": {
      const run = runs.find((r) => r.id === msg.run_id);
      if (run) {
        run.status = "completed";
        run.finished_at = new Date().toISOString();
        run.stats = msg.stats as RunStats;
        runs = [...runs];
      }
      break;
    }

    case "login_run_paused": {
      const run = runs.find((r) => r.id === msg.run_id);
      if (run) {
        run.status = "paused";
        runs = [...runs];
      }
      break;
    }

    case "login_run_aborted": {
      const run = runs.find((r) => r.id === msg.run_id);
      if (run) {
        run.status = "aborted";
        run.finished_at = new Date().toISOString();
        // Mark still-running creds as skipped
        for (const c of run.credentials) {
          if (c.status === "running" || c.status === "pending")
            c.status = "skipped";
        }
        run.stats = computeRunStats(
          run.credentials,
          run.results,
          run.rotation_log,
        );
        runs = [...runs];
      }
      break;
    }

    case "login_error": {
      const run = runs.find((r) => r.id === msg.run_id);
      if (run) {
        run.status = "aborted";
        run.finished_at = new Date().toISOString();
        runs = [...runs];
      }
      break;
    }
  }
}

// Register on bridgeStore message bus
bridgeStore.onMessage(handleWsMessage);

// ─────────────────────────────────────────────────────────────────────────────
// Credential import
// ─────────────────────────────────────────────────────────────────────────────

function importCredentialText(raw: string): number {
  importError = null;
  let parsed: CredentialPair[] = [];

  const trimmed = raw.trim();
  if (!trimmed) {
    importError = "Input is empty";
    return 0;
  }

  // Try JSON first
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      parsed = parseCredentialJson(trimmed);
    } catch (e) {
      importError = `JSON parse error: ${String(e)}`;
      return 0;
    }
  } else {
    // CSV / colon-separated
    parsed = parseCredentialCsv(trimmed);
  }

  if (parsed.length === 0) {
    importError =
      "No valid credential pairs found. Expected format: username,password or username:password";
    return 0;
  }

  // Deduplicate by username+password
  const existing = new Set(drafts.map((c) => `${c.username}::${c.password}`));
  const fresh = parsed.filter(
    (c) => !existing.has(`${c.username}::${c.password}`),
  );
  drafts = [...drafts, ...fresh];
  return fresh.length;
}

async function importCredentialFile(file: File): Promise<number> {
  const text = await file.text();
  return importCredentialText(text);
}

function clearDrafts(): void {
  drafts = [];
  importError = null;
}

function removeDraft(id: string): void {
  drafts = drafts.filter((c) => c.id !== id);
}

function skipCredential(runId: string, credentialId: string): void {
  const run = runs.find((r) => r.id === runId);
  if (!run) return;
  const cred = run.credentials.find((c) => c.id === credentialId);
  if (cred && cred.status === "pending") {
    cred.status = "skipped";
    run.stats = computeRunStats(run.credentials, run.results, run.rotation_log);
    runs = [...runs];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run lifecycle
// ─────────────────────────────────────────────────────────────────────────────

function createRun(
  formConfig: LoginFormConfig,
  credentials: CredentialPair[],
  options: Partial<LoginRunConfig> = {},
): LoginRun {
  const id = crypto.randomUUID();

  // Auto-resolve domain profile
  const dp = resolveDomainProfile(formConfig.url);

  // Default profile pool: all idle profiles
  const defaultPool = profileStore.profiles
    .filter((p) => p.status === "idle")
    .map((p) => p.id);

  const config: LoginRunConfig = {
    id,
    form: formConfig,
    profile_pool: options.profile_pool ?? defaultPool,
    proxy_pool: options.proxy_pool ?? [],
    nord_rotation: options.nord_rotation ?? false,
    nord_country: options.nord_country ?? "Australia",
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

  const run: LoginRun = {
    id,
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
    stats: {
      total: credentials.length,
      pending: credentials.length,
      running: 0,
      success: 0,
      failed: 0,
      soft_blocked: 0,
      hard_blocked: 0,
      error: 0,
      skipped: 0,
      rotations: 0,
    },
  };

  runs = [run, ...runs];
  activeRunId = id;
  return run;
}

function sendWs(msg: unknown): boolean {
  const payload = msg as Record<string, unknown>;
  const ok = bridgeStore.sendRaw(payload);
  if (!ok) {
    console.warn(
      "[automationStore] sendWs: bridge not connected — message dropped:",
      payload.type,
    );
  } else {
    console.debug("[automationStore] sendWs →", payload.type);
  }
  return ok;
}

function startRun(runId: string): { success: boolean; error?: string } {
  const run = runs.find((r) => r.id === runId);
  if (!run) return { success: false, error: "Run not found" };
  if (run.status === "running")
    return { success: false, error: "Run already in progress" };

  // Check if bridge is connected before attempting to start
  if (!bridgeStore.connected) {
    return {
      success: false,
      error:
        "Bridge not connected. Please launch a profile session first using the session bar above.",
    };
  }

  // Check if profile pool is valid
  const poolIds = new Set(run.config.profile_pool);
  const profiles = profileStore.profiles.filter((p) => poolIds.has(p.id));

  if (profiles.length === 0) {
    return {
      success: false,
      error:
        "No profiles selected. Please select at least one profile for the automation pool.",
    };
  }

  // Validate selected profile proxies before launch.
  // Proxy passwords are intentionally not serialized from backend, so after app restart
  // authenticated proxies may exist with username but missing password in memory.
  // Skip proxy validation when using Nord rotation (traffic via system VPN).
  const proxyById = new Map(proxyStore.proxies.map((p) => [p.id, p]));
  const runProxyPool = run.config.proxy_pool ?? [];
  const usingRunProxyPool = runProxyPool.length > 0;
  const usingNord = run.config.nord_rotation === true;
  if (!usingNord && !usingRunProxyPool) {
    for (const profile of profiles) {
      if (!profile.proxy_id) continue;
      const proxy = proxyById.get(profile.proxy_id);
      if (!proxy) continue;
      if (proxy.username && !proxy.password) {
        return {
          success: false,
          error:
            `Proxy "${proxy.name}" is missing password in current session. ` +
            `Edit and re-save the proxy password, then retry automation.`,
        };
      }
    }
  }

  // Validate run-level proxy pool (if provided).
  if (!usingNord && usingRunProxyPool) {
    for (const proxyId of runProxyPool) {
      const proxy = proxyById.get(proxyId);
      if (!proxy) {
        return {
          success: false,
          error: `Selected proxy not found: ${proxyId}`,
        };
      }
      if (proxy.username && !proxy.password) {
        return {
          success: false,
          error:
            `Proxy "${proxy.name}" is missing password in current session. ` +
            `Edit and re-save the proxy password (or set it in Automation), then retry.`,
        };
      }
    }
  }

  run.status = "running";
  run.started_at = new Date().toISOString();
  runs = [...runs];

  // Include the full profile objects so the bridge LoginRunner can launch browsers,
  // and slim proxy descriptors it needs to configure each browser context.
  const proxies = proxyStore.proxies.map((p) => ({
    id: p.id,
    server: `${p.proxy_type}://${p.host}:${p.port}`,
    username: p.username ?? undefined,
    password: p.password ?? undefined,
    healthy: p.healthy,
  }));

  const ok = sendWs({ type: "login_start", run, profiles, proxies });

  if (!ok) {
    // Revert status if send failed
    run.status = "idle";
    run.started_at = null;
    runs = [...runs];
    return {
      success: false,
      error:
        "Failed to send message to bridge. Please ensure the bridge is connected.",
    };
  }

  return { success: true };
}

function pauseRun(runId: string): void {
  const run = runs.find((r) => r.id === runId);
  if (!run || run.status !== "running") return;
  run.status = "paused";
  runs = [...runs];
  sendWs({ type: "login_pause" });
}

function resumeRun(runId: string): void {
  const run = runs.find((r) => r.id === runId);
  if (!run || run.status !== "paused") return;
  run.status = "running";
  runs = [...runs];
  sendWs({ type: "login_resume" });
}

function abortRun(runId: string): void {
  const run = runs.find((r) => r.id === runId);
  if (!run) return;
  run.status = "aborted";
  run.finished_at = new Date().toISOString();
  for (const c of run.credentials) {
    if (c.status === "running" || c.status === "pending") c.status = "skipped";
  }
  run.stats = computeRunStats(run.credentials, run.results, run.rotation_log);
  runs = [...runs];
  sendWs({ type: "login_abort" });
}

function deleteRun(runId: string): void {
  runs = runs.filter((r) => r.id !== runId);
  if (activeRunId === runId) {
    activeRunId = runs[0]?.id ?? null;
  }
}

function setActiveRun(runId: string | null): void {
  activeRunId = runId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session state export / download
// ─────────────────────────────────────────────────────────────────────────────

function downloadSessionState(state: SessionState): void {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `session-${state.credential_id.slice(0, 8)}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadAllSessions(runId: string): void {
  const run = runs.find((r) => r.id === runId);
  if (!run) return;
  const sessions = run.results
    .filter((r) => r.session_state)
    .map((r) => r.session_state!);
  if (sessions.length === 0) return;
  const json = JSON.stringify(sessions, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sessions-run-${runId.slice(0, 8)}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadRunReport(runId: string): void {
  const run = runs.find((r) => r.id === runId);
  if (!run) return;
  const report = {
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
  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `run-report-${runId.slice(0, 8)}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadSuccessCreds(runId: string): void {
  const run = runs.find((r) => r.id === runId);
  if (!run) return;
  const lines = run.results
    .filter((r) => r.outcome === "success")
    .map((r) => {
      const cred = run.credentials.find((c) => c.id === r.credential_id);
      return cred ? `${cred.username}:${cred.password}` : null;
    })
    .filter(Boolean);
  if (lines.length === 0) return;
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hits-${runId.slice(0, 8)}-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft run config helpers
// ─────────────────────────────────────────────────────────────────────────────

function setDraftConfig(patch: Partial<LoginRunConfig>): void {
  draftRunConfig = { ...draftRunConfig, ...patch };
}

function applyFormPreset(url: string): void {
  const preset = getFormPreset(url);
  const dp = resolveDomainProfile(url);
  draftRunConfig = {
    ...draftRunConfig,
    form: {
      url,
      username_selector: preset.username_selector ?? "",
      password_selector: preset.password_selector ?? "",
      submit_selector: preset.submit_selector ?? "",
      success_selector: preset.success_selector ?? "",
      failure_selector: preset.failure_selector ?? "",
      captcha_selector: preset.captcha_selector ?? "",
      consent_selector: preset.consent_selector ?? "",
      totp_selector: preset.totp_selector ?? "",
      post_submit_timeout_ms: preset.post_submit_timeout_ms ?? 8_000,
      page_load_timeout_ms: 15_000,
      export_session_on_success: preset.export_session_on_success ?? true,
    } as LoginFormConfig,
    domain_aware_noise: true,
    patch_tls: dp.patch_tls,
    soft_signal_threshold: 1,
    rotate_every_attempt: false,
    max_retries: 2,
    mode: "sequential" as RunMode,
    concurrency: 1,
    launch_delay_ms: dp.min_attempt_gap_ms,
  };
}

function resetDraft(): void {
  drafts = [];
  draftRunConfig = {};
  importError = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store export
// ─────────────────────────────────────────────────────────────────────────────

export const automationStore = {
  // ── State ──────────────────────────────────────────────────────────────
  get runs() {
    return runs;
  },
  get activeRun() {
    return activeRun;
  },
  get activeRunId() {
    return activeRunId;
  },
  get drafts() {
    return drafts;
  },
  get draftRunConfig() {
    return draftRunConfig;
  },
  get importError() {
    return importError;
  },
  get globalStats() {
    return globalStats;
  },

  // ── Credential import ──────────────────────────────────────────────────
  importCredentialText,
  importCredentialFile,
  clearDrafts,
  removeDraft,
  skipCredential,

  // ── Run lifecycle ──────────────────────────────────────────────────────
  createRun,
  startRun,
  pauseRun,
  resumeRun,
  abortRun,
  deleteRun,
  setActiveRun,

  // ── Config helpers ─────────────────────────────────────────────────────
  setDraftConfig,
  applyFormPreset,
  resetDraft,
  getFormPreset,

  // ── Export ─────────────────────────────────────────────────────────────
  downloadSessionState,
  downloadAllSessions,
  downloadRunReport,
  downloadSuccessCreds,
};
