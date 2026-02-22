// ── Manifold proxy store (Svelte 5 runes) ─────────────────────────────────────

import type {
  Proxy,
  ProxyHealth,
  AddProxyPayload,
  UpdateProxyPayload,
  BrightDataConfig,
  ProxyRotationPolicy,
  RotationPolicy,
} from "$lib/types";

// ── Tauri availability and dynamic import ──────────────────────────────────

function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
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
    console.warn("[proxyStore] Failed to import Tauri API:", e);
    return null;
  }
}

async function safeInvoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    console.warn(`[proxyStore] Tauri unavailable, skipping command: ${cmd}`);
    return null;
  }
  return invoke<T>(cmd, args ?? {});
}

// ─────────────────────────────────────────────────────────────────────────────
// BrightData / Luminati URL builder
// ─────────────────────────────────────────────────────────────────────────────

const BRIGHTDATA_HOST = "zproxy.lum-superproxy.io";
const BRIGHTDATA_PORT = 22225;

/** Build an AddProxyPayload for a BrightData sticky-session proxy.
 *  Username format: lum-customer-CUSTOMER-zone-ZONE[-country-CC]-session-SID */
export function buildBrightDataSticky(
  cfg: BrightDataConfig & { password: string; name?: string },
): AddProxyPayload {
  const sessionId = cfg.session_id ?? `s${Date.now().toString(36)}`;
  const countryPart = cfg.country
    ? `-country-${cfg.country.toLowerCase()}`
    : "";
  const username = `lum-customer-${cfg.customer_id}-zone-${cfg.zone}${countryPart}-session-${sessionId}`;
  return {
    name: cfg.name ?? `BD ${cfg.zone} sticky-${sessionId.slice(0, 6)}`,
    proxy_type: "http",
    host: BRIGHTDATA_HOST,
    port: BRIGHTDATA_PORT,
    username,
    password: cfg.password,
    country: cfg.country || undefined,
  };
}

/** Build an AddProxyPayload for a BrightData rotating proxy. */
export function buildBrightDataRotating(
  cfg: BrightDataConfig & { password: string; name?: string },
): AddProxyPayload {
  const countryPart = cfg.country
    ? `-country-${cfg.country.toLowerCase()}`
    : "";
  const username = `lum-customer-${cfg.customer_id}-zone-${cfg.zone}${countryPart}`;
  return {
    name: cfg.name ?? `BD ${cfg.zone} rotating`,
    proxy_type: "http",
    host: BRIGHTDATA_HOST,
    port: BRIGHTDATA_PORT,
    username,
    password: cfg.password,
    country: cfg.country || undefined,
  };
}

/** Detect whether a proxy record was created from BrightData */
export function isBrightData(proxy: Proxy): boolean {
  return proxy.host === BRIGHTDATA_HOST;
}

/** Parse BrightData username back into component parts (best-effort) */
export function parseBrightDataUsername(
  username: string,
): Partial<BrightDataConfig> {
  const customer = username.match(/lum-customer-([^-]+)/)?.[1] ?? "";
  const zone = username.match(/zone-([^-]+)/)?.[1] ?? "";
  const country =
    username.match(/country-([a-z]{2})/i)?.[1]?.toUpperCase() ?? "";
  const session = username.match(/session-(\S+)/)?.[1];
  return {
    customer_id: customer,
    zone,
    country,
    mode: session ? "sticky" : "rotating",
    session_id: session,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Round-robin rotator
// ─────────────────────────────────────────────────────────────────────────────

// ── Poisson process helper ────────────────────────────────────────────────────
//
// For a Poisson process with mean inter-arrival time λ_ms, the time until the
// next event is Exponentially distributed: T ~ Exp(1/λ).
// We sample T = -λ * ln(U) where U ~ Uniform(0,1).
//
// This gives rotation events that are random (not predictable) but average to
// exactly λ_ms between rotations — matching the spec's "Poisson λ=15min" model.

function poissonDelay(lambdaMs: number): number {
  // Guard: U must be in (0,1] to avoid -Infinity
  const u = Math.max(1e-10, Math.random());
  return Math.round(-lambdaMs * Math.log(u));
}

// ── ProxyRotator ──────────────────────────────────────────────────────────────

class ProxyRotator {
  private idx = 0;
  private pool: Proxy[] = [];
  private policy: RotationPolicy = "manual";
  private poissonHandle: ReturnType<typeof setTimeout> | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private onRotateCallback: ((proxy: Proxy) => void) | null = null;
  private lambdaMs = 15 * 60 * 1000; // default λ = 15 min

  // ── Rotation stats ──────────────────────────────────────────────────────
  public rotationCount = 0;
  public lastRotatedAt: number | null = null;
  public nextRotationAt: number | null = null;
  public banCount = 0;

  configure(policy: ProxyRotationPolicy, allProxies: Proxy[]): void {
    this.policy = policy.mode;
    this.pool = policy.proxy_ids
      .map((id) => allProxies.find((p) => p.id === id))
      .filter((p): p is Proxy => !!p && p.healthy);
    this.idx = policy.current_index % Math.max(1, this.pool.length);
    this.lambdaMs = (policy.interval_min ?? 15) * 60 * 1000;
    this._resetSchedule(policy);
  }

  next(): Proxy | null {
    const healthy = this.pool.filter((p) => p.healthy);
    if (healthy.length === 0) return null;
    const proxy = healthy[this.idx % healthy.length];
    this.idx = (this.idx + 1) % healthy.length;
    this.rotationCount++;
    this.lastRotatedAt = Date.now();
    return proxy;
  }

  peek(): Proxy | null {
    const healthy = this.pool.filter((p) => p.healthy);
    if (healthy.length === 0) return null;
    return healthy[this.idx % healthy.length];
  }

  /**
   * Call when a 403/429/502 ban signal is detected for the current proxy.
   * Immediately rotates to the next healthy proxy regardless of policy.
   */
  onBan(): Proxy | null {
    this.banCount++;
    // Always rotate on ban — advance to next healthy proxy
    const next = this.next();
    if (next && this.onRotateCallback) {
      this.onRotateCallback(next);
    }
    // Re-arm the Poisson schedule from now (ban resets the timer)
    if (this.policy === "interval" || this.policy === "poisson") {
      this._armPoisson();
    }
    return next;
  }

  onRotate(cb: (proxy: Proxy) => void): void {
    this.onRotateCallback = cb;
  }

  destroy(): void {
    this._clearAll();
  }

  get currentIndex(): number {
    return this.idx;
  }
  get poolSize(): number {
    return this.pool.filter((p) => p.healthy).length;
  }

  // ── Scheduling ────────────────────────────────────────────────────────────

  private _clearAll(): void {
    if (this.poissonHandle !== null) {
      clearTimeout(this.poissonHandle);
      this.poissonHandle = null;
    }
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.nextRotationAt = null;
  }

  /**
   * Arm the next Poisson rotation event.
   * Each firing reschedules itself with a fresh Exponential sample,
   * producing a memoryless Poisson process with mean λ.
   */
  private _armPoisson(): void {
    if (this.poissonHandle !== null) {
      clearTimeout(this.poissonHandle);
      this.poissonHandle = null;
    }
    const delay = poissonDelay(this.lambdaMs);
    this.nextRotationAt = Date.now() + delay;

    this.poissonHandle = setTimeout(() => {
      this.poissonHandle = null;
      const next = this.next();
      if (next && this.onRotateCallback) this.onRotateCallback(next);
      // Reschedule with a new Poisson sample (memoryless property)
      this._armPoisson();
    }, delay);
  }

  private _resetSchedule(policy: ProxyRotationPolicy): void {
    this._clearAll();

    switch (policy.mode) {
      case "poisson":
        // Pure Poisson process: λ from policy.interval_min (minutes)
        this._armPoisson();
        break;

      case "interval":
        // Legacy fixed-interval mode (kept for backwards compatibility).
        // Wrap with a small ±10% jitter to avoid deterministic timing patterns.
        if ((policy.interval_min ?? 0) > 0) {
          const base = (policy.interval_min ?? 15) * 60 * 1000;
          const jitter = base * 0.1;
          const interval = base + (Math.random() - 0.5) * 2 * jitter;
          this.nextRotationAt = Date.now() + interval;
          this.intervalHandle = setInterval(() => {
            const next = this.next();
            if (next && this.onRotateCallback) this.onRotateCallback(next);
            this.nextRotationAt = Date.now() + interval;
          }, interval);
        }
        break;

      case "on_ban":
      case "manual":
      default:
        // No timer — rotation only on ban or explicit call
        break;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let proxies = $state<Proxy[]>([]);
let healthResults = $state<Record<string, ProxyHealth>>({});
let checking = $state<Set<string>>(new Set());
let checkingAll = $state(false);
let loading = $state(false);
let error = $state<string | null>(null);

// Global rotator instance (used by profiles that don't have their own pool)
const globalRotator = new ProxyRotator();

// Per-profile rotators keyed by profile ID
const profileRotators = new Map<string, ProxyRotator>();

// ─────────────────────────────────────────────────────────────────────────────
// Derived
// ─────────────────────────────────────────────────────────────────────────────

let healthyProxies = $derived(proxies.filter((p) => p.healthy));

let unhealthyProxies = $derived(proxies.filter((p) => !p.healthy));

let proxiesByCountry = $derived.by(() => {
  const map = new Map<string, Proxy[]>();
  for (const p of proxies) {
    const key = p.country ?? "Unknown";
    const arr = map.get(key) ?? [];
    arr.push(p);
    map.set(key, arr);
  }
  return map;
});

let brightDataProxies = $derived(proxies.filter(isBrightData));

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

async function loadProxies(): Promise<void> {
  loading = true;
  error = null;
  try {
    const raw = await safeInvoke<Proxy[]>("list_proxies");
    if (raw) {
      proxies = raw;
    }
  } catch (e) {
    error = String(e);
  } finally {
    loading = false;
  }
}

async function addProxy(payload: AddProxyPayload): Promise<Proxy> {
  const raw = await safeInvoke<Proxy>("add_proxy", {
    name: payload.name,
    proxyType: payload.proxy_type,
    host: payload.host,
    port: payload.port,
    username: payload.username ?? null,
    password: payload.password ?? null,
    country: payload.country ?? null,
  });

  if (!raw) {
    throw new Error("Failed to add proxy: Tauri unavailable");
  }

  // Backend strips password via #[serde(skip_serializing)].
  // Preserve it client-side so the automation bridge can authenticate.
  const proxy: Proxy = { ...raw, password: payload.password ?? null };

  proxies = [proxy, ...proxies];
  return proxy;
}

/** Add a BrightData sticky-session proxy */
async function addBrightDataSticky(
  cfg: BrightDataConfig & { password: string },
): Promise<Proxy> {
  return addProxy(buildBrightDataSticky(cfg));
}

/** Add a BrightData rotating proxy */
async function addBrightDataRotating(
  cfg: BrightDataConfig & { password: string },
): Promise<Proxy> {
  return addProxy(buildBrightDataRotating(cfg));
}

async function updateProxy(
  id: string,
  payload: UpdateProxyPayload,
): Promise<Proxy> {
  const raw = await safeInvoke<Proxy>("update_proxy", {
    id,
    name: payload.name ?? null,
    proxyType: payload.proxy_type ?? null,
    host: payload.host ?? null,
    port: payload.port ?? null,
    username: payload.username ?? null,
    password: payload.password ?? null,
    country: payload.country ?? null,
  });

  if (!raw) {
    throw new Error("Failed to update proxy: Tauri unavailable");
  }

  // Backend strips password via #[serde(skip_serializing)].
  // If the payload included a new password, keep it client-side.
  // Otherwise preserve the password we already had for this proxy.
  const existing = proxies.find((p) => p.id === id);
  const password =
    payload.password !== undefined
      ? (payload.password ?? null)
      : (existing?.password ?? null);
  const proxy: Proxy = { ...raw, password };

  proxies = proxies.map((p) => (p.id === id ? proxy : p));
  return proxy;
}

async function deleteProxy(id: string): Promise<void> {
  await safeInvoke("delete_proxy", { id });
  proxies = proxies.filter((p) => p.id !== id);
  const { [id]: _removed, ...rest } = healthResults;
  healthResults = rest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health checking
// ─────────────────────────────────────────────────────────────────────────────

async function checkProxy(id: string): Promise<ProxyHealth> {
  const next = new Set(checking);
  next.add(id);
  checking = next;

  try {
    const result = await safeInvoke<ProxyHealth>("check_proxy", { id });

    if (!result) {
      throw new Error("Failed to check proxy: Tauri unavailable");
    }

    // Update the proxy's health fields in-place
    proxies = proxies.map((p) =>
      p.id === id
        ? {
            ...p,
            healthy: result.healthy,
            latency_ms: result.latency_ms ?? null,
            last_checked: result.checked_at,
          }
        : p,
    );
    healthResults = { ...healthResults, [id]: result };
    return result;
  } finally {
    const next2 = new Set(checking);
    next2.delete(id);
    checking = next2;
  }
}

async function checkAllProxies(): Promise<ProxyHealth[]> {
  checkingAll = true;
  try {
    const results = await safeInvoke<ProxyHealth[]>("check_all_proxies");

    if (!results) {
      throw new Error("Failed to check proxies: Tauri unavailable");
    }

    // Merge results into state
    const resultMap: Record<string, ProxyHealth> = {};
    for (const r of results) {
      resultMap[r.id] = r;
    }
    proxies = proxies.map((p) => {
      const r = resultMap[p.id];
      if (!r) return p;
      return {
        ...p,
        healthy: r.healthy,
        latency_ms: r.latency_ms ?? null,
        last_checked: r.checked_at,
      };
    });
    healthResults = { ...healthResults, ...resultMap };
    return results;
  } finally {
    checkingAll = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotation
// ─────────────────────────────────────────────────────────────────────────────

/** Configure the global rotator with a pool of healthy proxies */
function configureGlobalRotator(
  proxyIds: string[],
  policy: RotationPolicy,
  intervalMin?: number,
): void {
  globalRotator.configure(
    {
      mode: policy,
      proxy_ids: proxyIds,
      current_index: 0,
      interval_min: intervalMin,
    },
    proxies,
  );
}

/** Get the next proxy from the global pool */
function nextProxy(): Proxy | null {
  return globalRotator.next();
}

/** Configure a per-profile rotator */
function configureProfileRotator(
  profileId: string,
  policy: ProxyRotationPolicy,
): ProxyRotator {
  let rotator = profileRotators.get(profileId);
  if (!rotator) {
    rotator = new ProxyRotator();
    profileRotators.set(profileId, rotator);
  }
  rotator.configure(policy, proxies);
  return rotator;
}

/** Get the next proxy for a specific profile */
function nextForProfile(profileId: string): Proxy | null {
  return profileRotators.get(profileId)?.next() ?? globalRotator.next();
}

/** Signal a ban for a profile's current proxy, returns the new proxy */
function reportBan(profileId: string): Proxy | null {
  const rotator = profileRotators.get(profileId);
  if (rotator) return rotator.onBan();
  return globalRotator.onBan();
}

/** Destroy a per-profile rotator (call when profile is deleted) */
function destroyProfileRotator(profileId: string): void {
  profileRotators.get(profileId)?.destroy();
  profileRotators.delete(profileId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Format a proxy for display in a dropdown */
export function proxyLabel(proxy: Proxy): string {
  const geo = proxy.country ? ` [${proxy.country.toUpperCase()}]` : "";
  const latency = proxy.latency_ms != null ? ` · ${proxy.latency_ms}ms` : "";
  const health = proxy.healthy ? "●" : "○";
  return `${health} ${proxy.name}${geo}${latency}`;
}

/** Get a canonical playwright-server URL for a proxy (no credentials) */
export function proxyServerUrl(proxy: Proxy): string {
  const scheme = proxy.proxy_type === "socks5" ? "socks5" : "http";
  return `${scheme}://${proxy.host}:${proxy.port}`;
}

/** Latency tier label */
export function latencyLabel(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 150) return "fast";
  if (ms < 500) return "ok";
  if (ms < 1500) return "slow";
  return "very slow";
}

export function latencyColor(ms: number | null): string {
  if (ms === null) return "var(--text-muted)";
  if (ms < 150) return "var(--success)";
  if (ms < 500) return "var(--accent)";
  if (ms < 1500) return "var(--warning)";
  return "var(--error)";
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported store
// ─────────────────────────────────────────────────────────────────────────────

export const proxyStore = {
  // ── Reactive state ────────────────────────────────────────────────────────
  get proxies() {
    return proxies;
  },
  get healthyProxies() {
    return healthyProxies;
  },
  get unhealthyProxies() {
    return unhealthyProxies;
  },
  get proxiesByCountry() {
    return proxiesByCountry;
  },
  get brightDataProxies() {
    return brightDataProxies;
  },
  get healthResults() {
    return healthResults;
  },
  get checking() {
    return checking;
  },
  get checkingAll() {
    return checkingAll;
  },
  get loading() {
    return loading;
  },
  get error() {
    return error;
  },

  // ── CRUD ──────────────────────────────────────────────────────────────────
  loadProxies,
  addProxy,
  addBrightDataSticky,
  addBrightDataRotating,
  updateProxy,
  deleteProxy,

  // ── Health ────────────────────────────────────────────────────────────────
  checkProxy,
  checkAllProxies,

  // ── Rotation ──────────────────────────────────────────────────────────────
  configureGlobalRotator,
  nextProxy,
  configureProfileRotator,
  nextForProfile,
  reportBan,
  destroyProfileRotator,

  // ── BrightData builders ───────────────────────────────────────────────────
  buildBrightDataSticky,
  buildBrightDataRotating,
};
