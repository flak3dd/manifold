// ── Manifold app store (Svelte 5 runes) ──

import { ws } from "../websocket";
import type {
  Source,
  ScrapeResult,
  AddSourcePayload,
  WsServerMessage,
} from "../types";

// ── Tauri availability and dynamic import ──────────────────────────────────

function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
}

let invokeCache: typeof import("@tauri-apps/api/core").invoke | null = null;

async function getInvoke() {
  if (invokeCache) return invokeCache;

  if (!isTauriAvailable()) {
    return null;
  }

  try {
    const tauriCore = await import("@tauri-apps/api/core");
    invokeCache = tauriCore.invoke;
    return invokeCache;
  } catch (e) {
    console.warn("[appStore] Failed to import Tauri API:", e);
    return null;
  }
}

async function safeInvoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    console.warn(`[appStore] Tauri unavailable, skipping command: ${cmd}`);
    return null;
  }
  return invoke<T>(cmd, args ?? {});
}

// ── State ─────────────────────────────────────────────────────────────────────

let sources = $state<Source[]>([]);
let results = $state<Record<string, ScrapeResult[]>>({});
let selectedSourceId = $state<string | null>(null);
let wsConnected = $state(false);
let scraperRunning = $state(false);

// ── Intervals map (not reactive — just bookkeeping) ───────────────────────────

const intervalHandles = new Map<string, ReturnType<typeof setInterval>>();

// ── Persistence ───────────────────────────────────────────────────────────────

async function loadSources(): Promise<void> {
  try {
    const raw = await safeInvoke<string>("load_data", { key: "sources" });
    if (raw) {
      const parsed: Source[] = JSON.parse(raw);
      sources = parsed.map((s) => ({ ...s, status: "idle", error: null }));
      // Restore auto-scrape intervals
      sources.forEach((s) => {
        if (s.interval > 0) _startInterval(s.id, s.interval);
      });
    }
  } catch {
    // No saved data yet — start fresh
  }
}

async function persistSources(): Promise<void> {
  try {
    await safeInvoke("save_data", {
      key: "sources",
      data: JSON.stringify(sources),
    });
  } catch (e) {
    console.error("[manifold] failed to persist sources:", e);
  }
}

// ── Source management ─────────────────────────────────────────────────────────

function addSource(payload: AddSourcePayload): void {
  const source: Source = {
    id: crypto.randomUUID(),
    ...payload,
    createdAt: new Date().toISOString(),
    lastScraped: null,
    status: "idle",
    error: null,
  };
  sources = [...sources, source];
  persistSources();

  if (source.interval > 0) _startInterval(source.id, source.interval);
}

function removeSource(id: string): void {
  _clearInterval(id);
  sources = sources.filter((s) => s.id !== id);
  const { [id]: _removed, ...rest } = results;
  results = rest;
  if (selectedSourceId === id) selectedSourceId = null;
  persistSources();
}

function updateSource(
  id: string,
  patch: Partial<Pick<Source, "name" | "url" | "selector" | "interval">>,
): void {
  sources = sources.map((s) => {
    if (s.id !== id) return s;
    const updated = { ...s, ...patch };
    // Re-schedule interval if it changed
    if (patch.interval !== undefined && patch.interval !== s.interval) {
      _clearInterval(id);
      if (updated.interval > 0) _startInterval(id, updated.interval);
    }
    return updated;
  });
  persistSources();
}

// ── Scraping ──────────────────────────────────────────────────────────────────

function scrapeSource(sourceId: string): void {
  const source = sources.find((s) => s.id === sourceId);
  if (!source) return;

  const sent = ws.send({
    type: "scrape",
    sourceId,
    url: source.url,
    selector: source.selector,
  });

  if (!sent) {
    _patchSource(sourceId, {
      status: "error",
      error: "Scraper not connected.",
    });
  }
}

function scrapeAll(): void {
  sources.forEach((s) => scrapeSource(s.id));
}

// ── Scraper process ───────────────────────────────────────────────────────────

async function startScraper(): Promise<void> {
  try {
    await safeInvoke("start_scraper");
    scraperRunning = true;
  } catch (e) {
    console.error("[manifold] start_scraper failed:", e);
  }
}

async function stopScraper(): Promise<void> {
  try {
    await safeInvoke("stop_scraper");
    scraperRunning = false;
  } catch (e) {
    console.error("[manifold] stop_scraper failed:", e);
  }
}

// ── WS message handler ────────────────────────────────────────────────────────

function _handleMessage(msg: WsServerMessage): void {
  switch (msg.type) {
    case "status": {
      _patchSource(msg.sourceId, { status: "scraping", error: null });
      break;
    }

    case "result": {
      const source = sources.find((s) => s.id === msg.sourceId);
      _patchSource(msg.sourceId, {
        status: "success",
        lastScraped: new Date().toISOString(),
        error: null,
      });

      const result: ScrapeResult = {
        id: crypto.randomUUID(),
        sourceId: msg.sourceId,
        url: source?.url ?? "",
        content: msg.content,
        timestamp: new Date().toISOString(),
        durationMs: msg.durationMs,
      };

      const prev = results[msg.sourceId] ?? [];
      results = {
        ...results,
        [msg.sourceId]: [result, ...prev].slice(0, 20),
      };
      break;
    }

    case "error": {
      _patchSource(msg.sourceId, { status: "error", error: msg.message });
      break;
    }

    case "pong": {
      // heartbeat acknowledged
      break;
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _patchSource(id: string, patch: Partial<Source>): void {
  sources = sources.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

function _startInterval(sourceId: string, seconds: number): void {
  _clearInterval(sourceId);
  const handle = setInterval(() => scrapeSource(sourceId), seconds * 1000);
  intervalHandles.set(sourceId, handle);
}

function _clearInterval(sourceId: string): void {
  const handle = intervalHandles.get(sourceId);
  if (handle !== undefined) {
    clearInterval(handle);
    intervalHandles.delete(sourceId);
  }
}

// ── Wire up WS callbacks (runs once at module load) ───────────────────────────

ws.onMessage(_handleMessage);

ws.onConnectChange((connected) => {
  wsConnected = connected;
});

// ── Exported store object ─────────────────────────────────────────────────────

export const appStore = {
  // Reactive getters
  get sources() {
    return sources;
  },
  get results() {
    return results;
  },
  get wsConnected() {
    return wsConnected;
  },
  get scraperRunning() {
    return scraperRunning;
  },
  get selectedSourceId() {
    return selectedSourceId;
  },

  // Setters
  set selectedSourceId(id: string | null) {
    selectedSourceId = id;
  },
  set wsConnected(v: boolean) {
    wsConnected = v;
  },

  // Actions
  loadSources,
  addSource,
  removeSource,
  updateSource,
  scrapeSource,
  scrapeAll,
  startScraper,
  stopScraper,
};
