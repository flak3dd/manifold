// ── Manifold URL Test store (Svelte 5 runes) ──────────────────────────────────
//
// Manages the lifecycle of URL tests run through the scraper WebSocket:
//   • Start a URL test (with optional login credentials)
//   • Stream progress and results in real-time
//   • Store screenshots, detected forms, login results
//   • Maintain test history

import { ws } from "../websocket";
import type {
  WsServerMessage,
  UrlTestResult,
  UrlTestStatus,
  UrlTestDetectedForm,
  UrlTestScreenshots,
  UrlTestSummary,
  UrlTestLoginResult,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface UrlTest {
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
  overallStatus: UrlTestStatus | null;
  durationMs: number | null;
  error: string | null;
  progress: {
    testName: string;
    testIndex: number;
    totalTests: number;
    status: "running" | "done";
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let tests = $state<UrlTest[]>([]);
let activeTestId = $state<string | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Derived
// ─────────────────────────────────────────────────────────────────────────────

let activeTest = $derived(tests.find((t) => t.id === activeTestId) ?? null);
let isRunning = $derived(activeTest?.status === "running");
let history = $derived(tests.filter((t) => t.status === "completed" || t.status === "error"));

// ─────────────────────────────────────────────────────────────────────────────
// WS message handler
// ─────────────────────────────────────────────────────────────────────────────

function handleMessage(msg: WsServerMessage): void {
  if (!msg || typeof msg !== "object" || !("type" in msg)) return;

  switch (msg.type) {
    case "url_test_progress": {
      const test = tests.find((t) => t.id === msg.testId);
      if (!test) return;
      tests = tests.map((t) =>
        t.id === msg.testId
          ? {
              ...t,
              progress: {
                testName: msg.testName,
                testIndex: msg.testIndex,
                totalTests: msg.totalTests,
                status: msg.status,
              },
            }
          : t,
      );
      break;
    }

    case "url_test_result": {
      const test = tests.find((t) => t.id === msg.testId);
      if (!test) return;
      tests = tests.map((t) =>
        t.id === msg.testId
          ? { ...t, results: [...t.results, msg.result] }
          : t,
      );
      break;
    }

    case "url_test_forms": {
      tests = tests.map((t) =>
        t.id === msg.testId ? { ...t, forms: msg.forms } : t,
      );
      break;
    }

    case "url_test_login": {
      tests = tests.map((t) =>
        t.id === msg.testId ? { ...t, loginResult: msg.login } : t,
      );
      break;
    }

    case "url_test_complete": {
      tests = tests.map((t) =>
        t.id === msg.testId
          ? {
              ...t,
              status: "completed" as const,
              finishedAt: new Date().toISOString(),
              summary: msg.summary,
              overallStatus: msg.overallStatus,
              durationMs: msg.durationMs,
              screenshots: msg.screenshots,
              progress: null,
            }
          : t,
      );
      break;
    }

    case "url_test_error": {
      tests = tests.map((t) =>
        t.id === msg.testId
          ? {
              ...t,
              status: "error" as const,
              finishedAt: new Date().toISOString(),
              error: msg.message,
              progress: null,
            }
          : t,
      );
      break;
    }
  }
}

// Wire up the WS handler
ws.onMessage(handleMessage);

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

function startTest(
  url: string,
  username?: string,
  password?: string,
): string | null {
  if (!url) return null;

  // Validate URL
  try {
    new URL(url);
  } catch {
    // Try prepending https://
    try {
      new URL("https://" + url);
      url = "https://" + url;
    } catch {
      return null;
    }
  }

  const testId = crypto.randomUUID();

  const test: UrlTest = {
    id: testId,
    url,
    username: username || undefined,
    password: password || undefined,
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
      totalTests: username && password ? 15 : 14,
      status: "running",
    },
  };

  tests = [test, ...tests];
  activeTestId = testId;

  // Send test request via WS
  const sent = ws.send({
    type: "url_test",
    testId,
    url,
    username: username || undefined,
    password: password || undefined,
  } as any);

  if (!sent) {
    tests = tests.map((t) =>
      t.id === testId
        ? {
            ...t,
            status: "error" as const,
            error: "Scraper WebSocket not connected. Start the scraper first.",
            finishedAt: new Date().toISOString(),
            progress: null,
          }
        : t,
    );
    return null;
  }

  return testId;
}

function setActiveTest(id: string | null): void {
  activeTestId = id;
}

function deleteTest(id: string): void {
  tests = tests.filter((t) => t.id !== id);
  if (activeTestId === id) {
    activeTestId = tests.length > 0 ? tests[0].id : null;
  }
}

function clearHistory(): void {
  tests = tests.filter((t) => t.status === "running");
  if (activeTestId && !tests.find((t) => t.id === activeTestId)) {
    activeTestId = tests.length > 0 ? tests[0].id : null;
  }
}

/** Get a specific screenshot as a data URL */
function getScreenshotDataUrl(
  test: UrlTest,
  viewport: "desktop" | "tablet" | "mobile",
): string | null {
  const base64 = test.screenshots[viewport];
  if (!base64) return null;
  return "data:image/png;base64," + base64;
}

/** Download a JSON report for the test */
function downloadReport(testId: string): void {
  const test = tests.find((t) => t.id === testId);
  if (!test) return;

  const report = {
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

  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  let hostname = "unknown";
  try {
    hostname = new URL(test.url).hostname;
  } catch {
    // malformed URL — use fallback
  }

  a.download = `url-test-${hostname}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Count results by status */
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

// ─────────────────────────────────────────────────────────────────────────────
// Store export
// ─────────────────────────────────────────────────────────────────────────────

export const urlTestStore = {
  // ── Reactive state ────────────────────────────────────────────────────
  get tests() {
    return tests;
  },
  get activeTest() {
    return activeTest;
  },
  get activeTestId() {
    return activeTestId;
  },
  get isRunning() {
    return isRunning;
  },
  get history() {
    return history;
  },

  // ── Actions ───────────────────────────────────────────────────────────
  startTest,
  setActiveTest,
  deleteTest,
  clearHistory,
  getScreenshotDataUrl,
  downloadReport,
  countByStatus,
};
