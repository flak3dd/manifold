// ── Manifold bridge store (Svelte 5 runes) ────────────────────────────────────
//
// Manages the second WebSocket connection — to the playwright-bridge process
// (default port 8766) — that is spawned when a profile is launched.
//
// Responsibilities:
//   • Connect / disconnect / auto-reconnect to the bridge WS
//   • Route incoming ServerMessages to reactive state
//   • Accumulate the live HAR log and entropy snapshots
//   • Provide the automation runner (send execute / click / type / scroll)
//   • Expose a log ring-buffer for the session console pane

import { invoke } from "@tauri-apps/api/core";
import type {
  BridgeClientMsg,
  BridgeServerMsg,
  HarEntry,
  EntropyLog,
  SessionEvent,
  SessionEventType,
} from "$lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 8766;
const RECONNECT_DELAY_MS = 3_000;
const MAX_LOG_LINES = 500;
const MAX_HAR_ENTRIES = 2_000;
const MAX_ENTROPY_SNAPS = 100;
const HEARTBEAT_MS = 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// Log entry
// ─────────────────────────────────────────────────────────────────────────────

export interface LogLine {
  ts: number;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  sessionId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending promise map (for request / response correlation)
// ─────────────────────────────────────────────────────────────────────────────

type PendingEntry = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let port = $state<number>(DEFAULT_PORT);
let connected = $state(false);
let connecting = $state(false);
let sessionId = $state<string | null>(null);
let profileId = $state<string | null>(null);
let currentUrl = $state<string>("about:blank");
let lastScreenshot = $state<string | null>(null); // base64 PNG
let harEntries = $state<HarEntry[]>([]);
let entropySnaps = $state<EntropyLog[]>([]);
let eventLog = $state<SessionEvent[]>([]);
let logLines = $state<LogLine[]>([]);
let runnerOutput = $state<unknown>(null);
let runnerError = $state<string | null>(null);
let runnerRunning = $state(false);

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket internals (not reactive — not exposed directly)
// ─────────────────────────────────────────────────────────────────────────────

let _socket: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _destroyed = false;
let _messageHandlers = new Set<(msg: BridgeServerMsg) => void>();

// Map of pending `execute` / `extract` correlations:  sessionId → PendingEntry
const _pending = new Map<string, PendingEntry>();

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function _log(
  level: LogLine["level"],
  message: string,
  sid: string | null = null,
): void {
  const line: LogLine = { ts: Date.now(), level, message, sessionId: sid };
  logLines = [...logLines.slice(-(MAX_LOG_LINES - 1)), line];
}

function _pushEvent(
  type: SessionEventType,
  data: Record<string, unknown>,
): void {
  eventLog = [...eventLog, { ts: Date.now(), type, data }];
}

function _send(msg: BridgeClientMsg): boolean {
  if (_socket?.readyState !== WebSocket.OPEN) return false;
  try {
    _socket.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

function _clearReconnect(): void {
  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
}

function _clearHeartbeat(): void {
  if (_heartbeatTimer !== null) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

function _scheduleReconnect(): void {
  if (_destroyed || _reconnectTimer !== null) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    _open();
  }, RECONNECT_DELAY_MS);
}

function _startHeartbeat(): void {
  _clearHeartbeat();
  _heartbeatTimer = setInterval(() => {
    if (!_send({ type: "ping" })) {
      _clearHeartbeat();
    }
  }, HEARTBEAT_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Message dispatcher
// ─────────────────────────────────────────────────────────────────────────────

function _dispatch(msg: BridgeServerMsg): void {
  // Fan out to any external handlers first
  _messageHandlers.forEach((h) => h(msg));

  switch (msg.type) {
    case "pong":
      break;

    case "ready":
      sessionId = msg.sessionId;
      _log("info", `Session ready — id=${msg.sessionId} port=${msg.wsPort}`);
      _pushEvent("navigate", { url: currentUrl, session: msg.sessionId });
      break;

    case "log":
      _log(msg.level, msg.message, msg.sessionId);
      break;

    case "screenshot":
      lastScreenshot = msg.data;
      _pushEvent("screenshot", { sessionId: msg.sessionId });
      break;

    case "navigate_done":
      currentUrl = msg.url;
      _pushEvent("navigate", { url: msg.url, status: msg.status });
      _log("info", `Navigated → ${msg.url}  [${msg.status}]`, msg.sessionId);
      break;

    case "execute_result": {
      runnerOutput = msg.value;
      runnerRunning = false;
      runnerError = null;
      _pushEvent("execute", { value: msg.value });
      // Resolve any pending promise
      const p = _pending.get(`exec:${msg.sessionId}`);
      if (p) {
        clearTimeout(p.timeout);
        p.resolve(msg.value);
        _pending.delete(`exec:${msg.sessionId}`);
      }
      break;
    }

    case "extract_result": {
      _pushEvent("extract", { items: msg.items });
      const p = _pending.get(`extract:${msg.sessionId}`);
      if (p) {
        clearTimeout(p.timeout);
        p.resolve(msg.items);
        _pending.delete(`extract:${msg.sessionId}`);
      }
      break;
    }

    case "har_export": {
      try {
        const parsed = JSON.parse(msg.har) as HarEntry[];
        harEntries = [...harEntries, ...parsed].slice(-MAX_HAR_ENTRIES);
      } catch {
        _log("warn", "Could not parse HAR export blob");
      }
      break;
    }

    case "entropy":
      entropySnaps = [...entropySnaps.slice(-(MAX_ENTROPY_SNAPS - 1)), msg.log];
      _pushEvent("entropy", { snapshot: msg.log });
      break;

    case "error":
      runnerRunning = false;
      runnerError = msg.error;
      _log("error", msg.error, msg.sessionId);
      _pushEvent("error", { error: msg.error });
      // Reject all pending promises for this session
      for (const [key, entry] of _pending.entries()) {
        if (key.endsWith(`:${msg.sessionId}`)) {
          clearTimeout(entry.timeout);
          entry.reject(new Error(msg.error));
          _pending.delete(key);
        }
      }
      break;

    case "stopped":
      sessionId = null;
      runnerRunning = false;
      _log("info", `Session stopped`, msg.sessionId);
      _pushEvent("navigate", { url: "stopped" });
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket lifecycle
// ─────────────────────────────────────────────────────────────────────────────

function _open(): void {
  if (_destroyed) return;

  connecting = true;

  try {
    const socket = new WebSocket(`ws://localhost:${port}`);
    _socket = socket;

    socket.onopen = () => {
      if (socket !== _socket) return;
      _clearReconnect();
      connected = true;
      connecting = false;
      _startHeartbeat();
      _log("info", `Connected to bridge ws://localhost:${port}`);
    };

    socket.onmessage = (ev: MessageEvent) => {
      if (socket !== _socket) return;
      try {
        const msg = JSON.parse(ev.data as string) as BridgeServerMsg;
        _dispatch(msg);
      } catch {
        _log(
          "warn",
          `Received malformed frame: ${String(ev.data).slice(0, 80)}`,
        );
      }
    };

    socket.onerror = () => {
      // always followed by onclose
    };

    socket.onclose = () => {
      if (socket !== _socket) return;
      connected = false;
      connecting = false;
      _clearHeartbeat();
      _scheduleReconnect();
    };
  } catch (e) {
    connected = false;
    connecting = false;
    _scheduleReconnect();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/** Connect the bridge client.
 *  Optionally pass a port override (default: read from Tauri or 8766). */
async function connect(wsPort?: number): Promise<void> {
  if (wsPort !== undefined) {
    port = wsPort;
  } else {
    try {
      const url = await invoke<string>("get_bridge_url");
      const match = url.match(/:(\d+)$/);
      if (match) port = parseInt(match[1], 10);
    } catch {
      // use default
    }
  }

  _destroyed = false;
  _open();
}

function disconnect(): void {
  _destroyed = true;
  _clearReconnect();
  _clearHeartbeat();
  _socket?.close();
  _socket = null;
  connected = false;
  connecting = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Automation actions
// ─────────────────────────────────────────────────────────────────────────────

/** Navigate the active session to a URL */
function navigate(url: string): boolean {
  if (!sessionId) return false;
  return _send({ type: "navigate", sessionId, url });
}

/** Execute arbitrary JS / Playwright script in the bridge context.
 *  Returns a promise that resolves with the script's return value. */
function execute(script: string, timeoutMs = 30_000): Promise<unknown> {
  if (!sessionId) return Promise.reject(new Error("No active session"));

  runnerRunning = true;
  runnerError = null;
  runnerOutput = null;

  _send({ type: "execute", sessionId, script });

  return new Promise<unknown>((resolve, reject) => {
    const key = `exec:${sessionId}`;
    const timeout = setTimeout(() => {
      _pending.delete(key);
      runnerRunning = false;
      runnerError = "Script timed out";
      reject(new Error("Script timed out"));
    }, timeoutMs);
    _pending.set(key, { resolve, reject, timeout });
  });
}

/** Click a CSS selector */
function click(selector: string): boolean {
  if (!sessionId) return false;
  _pushEvent("click", { selector });
  return _send({ type: "click", sessionId, selector });
}

/** Type text into a CSS selector */
function type(selector: string, text: string): boolean {
  if (!sessionId) return false;
  _pushEvent("type", { selector, text });
  return _send({ type: "type", sessionId, selector, text });
}

/** Scroll a selector by deltaY pixels */
function scroll(selector: string, deltaY: number): boolean {
  if (!sessionId) return false;
  _pushEvent("scroll", { selector, deltaY });
  return _send({ type: "scroll", sessionId, selector, deltaY });
}

/** Extract text from all elements matching selector.
 *  Returns a promise resolving to a string array. */
function extract(selector: string, timeoutMs = 15_000): Promise<string[]> {
  if (!sessionId) return Promise.reject(new Error("No active session"));
  _send({ type: "extract", sessionId, selector });

  return new Promise<string[]>((resolve, reject) => {
    const key = `extract:${sessionId}`;
    const timeout = setTimeout(() => {
      _pending.delete(key);
      reject(new Error("Extract timed out"));
    }, timeoutMs);
    _pending.set(key, {
      resolve: resolve as (v: unknown) => void,
      reject,
      timeout,
    });
  });
}

/** Take a screenshot — result arrives via `lastScreenshot` state */
function screenshot(): boolean {
  if (!sessionId) return false;
  return _send({ type: "screenshot", sessionId });
}

/** Request a full HAR export — result arrives via the `har_export` message */
function requestHarExport(): boolean {
  if (!sessionId) return false;
  return _send({ type: "har_export", sessionId });
}

/** Stop the active browser session */
function stop(): boolean {
  if (!sessionId) return false;
  return _send({ type: "stop", sessionId });
}

// ─────────────────────────────────────────────────────────────────────────────
// Session reset
// ─────────────────────────────────────────────────────────────────────────────

function clearSession(): void {
  harEntries = [];
  entropySnaps = [];
  eventLog = [];
  logLines = [];
  lastScreenshot = null;
  runnerOutput = null;
  runnerError = null;
  runnerRunning = false;
  sessionId = null;
  currentUrl = "about:blank";
}

// ─────────────────────────────────────────────────────────────────────────────
// External message subscription
// ─────────────────────────────────────────────────────────────────────────────

function onMessage(handler: (msg: BridgeServerMsg) => void): () => void {
  _messageHandlers.add(handler);
  return () => _messageHandlers.delete(handler);
}

/** Send a raw JSON-serialisable payload directly over the WebSocket.
 *  Used by the automation store to send login_start / pause / resume / abort. */
function sendRaw(payload: unknown): boolean {
  if (!_socket || _socket.readyState !== WebSocket.OPEN) {
    console.warn("[bridge] sendRaw: socket not open (readyState=%d)", _socket?.readyState ?? -1);
    return false;
  }
  try {
    _socket.send(JSON.stringify(payload));
    return true;
  } catch (e) {
    console.error("[bridge] sendRaw failed:", e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HAR / export helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Export the accumulated HAR entries as a standard HAR 1.2 JSON string */
function exportHarJson(): string {
  const entries = harEntries.map((e) => ({
    startedDateTime: new Date(e.ts).toISOString(),
    time: e.time_ms,
    request: {
      method: e.method,
      url: e.url,
      headers: e.request_headers,
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: e.status,
      statusText: e.status_text,
      headers: e.response_headers,
      content: {
        size: e.body_size,
        mimeType: e.mime_type,
      },
      headersSize: -1,
      bodySize: e.body_size,
    },
    cache: {},
    timings: { send: 0, wait: e.time_ms, receive: 0 },
  }));

  return JSON.stringify(
    {
      log: {
        version: "1.2",
        creator: { name: "Manifold", version: "0.1.0" },
        entries,
      },
    },
    null,
    2,
  );
}

/** Export the entropy log as JSON */
function exportEntropyJson(): string {
  return JSON.stringify(entropySnaps, null, 2);
}

/** Download a blob in the browser */
function downloadBlob(
  content: string,
  filename: string,
  mime = "application/json",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** One-click HAR download */
function downloadHar(filename?: string): void {
  downloadBlob(exportHarJson(), filename ?? `session-${Date.now()}.har`);
}

/** One-click entropy log download */
function downloadEntropy(filename?: string): void {
  downloadBlob(exportEntropyJson(), filename ?? `entropy-${Date.now()}.json`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived convenience
// ─────────────────────────────────────────────────────────────────────────────

let latestEntropy = $derived(
  entropySnaps.length > 0 ? entropySnaps[entropySnaps.length - 1] : null,
);

let harStats = $derived.by(() => {
  const total = harEntries.length;
  const errors = harEntries.filter((e) => e.status >= 400).length;
  const avgTime =
    total > 0
      ? Math.round(harEntries.reduce((s, e) => s + e.time_ms, 0) / total)
      : 0;
  const byMethod = harEntries.reduce<Record<string, number>>((acc, e) => {
    acc[e.method] = (acc[e.method] ?? 0) + 1;
    return acc;
  }, {});
  return { total, errors, avgTime, byMethod };
});

let riskScore = $derived.by(() => {
  // Heuristic: combine entropy signals into a 0–100 risk score.
  // Higher = more likely to be detected as a bot.
  const snap = latestEntropy;
  if (!snap) return null;

  let score = 0;
  if (snap.navigator.webdriver) score += 40;
  if (snap.webrtc_leak) score += 25;
  if (snap.navigator.hardwareConcurrency < 2) score += 10;
  if (snap.screen.pixelRatio > 3) score += 5;
  return Math.min(100, score);
});

// ─────────────────────────────────────────────────────────────────────────────
// Exported store
// ─────────────────────────────────────────────────────────────────────────────

export const bridgeStore = {
  // ── Reactive state ────────────────────────────────────────────────────────
  get port() {
    return port;
  },
  get connected() {
    return connected;
  },
  get connecting() {
    return connecting;
  },
  get sessionId() {
    return sessionId;
  },
  get profileId() {
    return profileId;
  },
  get currentUrl() {
    return currentUrl;
  },
  get lastScreenshot() {
    return lastScreenshot;
  },
  get harEntries() {
    return harEntries;
  },
  get entropySnaps() {
    return entropySnaps;
  },
  get eventLog() {
    return eventLog;
  },
  get logLines() {
    return logLines;
  },
  get runnerOutput() {
    return runnerOutput;
  },
  get runnerError() {
    return runnerError;
  },
  get runnerRunning() {
    return runnerRunning;
  },
  get latestEntropy() {
    return latestEntropy;
  },
  get harStats() {
    return harStats;
  },
  get riskScore() {
    return riskScore;
  },

  // Writable
  set profileId(id: string | null) {
    profileId = id;
  },
  set port(p: number) {
    port = p;
  },

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  connect,
  disconnect,
  clearSession,
  onMessage,
  sendRaw,

  // ── Automation actions ────────────────────────────────────────────────────
  navigate,
  execute,
  click,
  type,
  scroll,
  extract,
  screenshot,
  requestHarExport,
  stop,

  // ── Exports ───────────────────────────────────────────────────────────────
  exportHarJson,
  exportEntropyJson,
  downloadHar,
  downloadEntropy,
};
