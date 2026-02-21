// ── Manifold profile store (Svelte 5 runes) ───────────────────────────────────

import type {
  Profile,
  Fingerprint,
  HumanBehavior,
  CreateProfilePayload,
  UpdateProfilePayload,
  ProfileTarget,
  BehaviorProfile,
  EmergencyRotateMode,
} from "$lib/types";
import { resolvePlatform } from "$lib/constants/platforms";
import { generateFingerprintFallback } from "$lib/fingerprint";

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
    console.warn("[profileStore] Failed to import Tauri API:", e);
    return null;
  }
}

// ── Safe invoke wrapper ────────────────────────────────────────────────────
//
// All Tauri commands should use this to handle cases where Tauri is unavailable.

async function safeInvoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  const invoke = await getInvoke();
  if (!invoke) {
    console.warn(`[profileStore] Tauri unavailable, skipping command: ${cmd}`);
    return null;
  }
  return invoke<T>(cmd, args ?? {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback storage (for when Tauri is unavailable)
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "manifold_profiles";

function loadProfilesFromStorage(): Profile[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as Profile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("[profileStore] Failed to load from localStorage:", e);
    return [];
  }
}

function saveProfilesToStorage(profs: Profile[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profs));
  } catch (e) {
    console.warn("[profileStore] Failed to save to localStorage:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Target parsing helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Encode a ProfileTarget into the notes field as a JSON block.
 *  Any human-written notes are preserved after the sentinel. */
const TARGET_SENTINEL = "<!-- manifold:target ";
const TARGET_SENTINEL_END = " -->";

export function encodeTarget(
  target: ProfileTarget,
  existingNotes = "",
): string {
  // Strip any old target block first
  const cleaned = existingNotes
    .replace(/<!--\s*manifold:target\s+.*?\s*-->/s, "")
    .trim();
  const block = `${TARGET_SENTINEL}${JSON.stringify(target)}${TARGET_SENTINEL_END}`;
  return cleaned ? `${cleaned}\n${block}` : block;
}

export function decodeTarget(notes: string): ProfileTarget | null {
  const start = notes.indexOf(TARGET_SENTINEL);
  if (start === -1) return null;
  const jsonStart = start + TARGET_SENTINEL.length;
  const end = notes.indexOf(TARGET_SENTINEL_END, jsonStart);
  if (end === -1) return null;
  try {
    return JSON.parse(notes.slice(jsonStart, end)) as ProfileTarget;
  } catch {
    return null;
  }
}

/** Human-readable notes without the target JSON block */
export function stripTargetBlock(notes: string): string {
  return notes.replace(/<!--\s*manifold:target\s+.*?\s*-->/s, "").trim();
}

/** Hydrate a profile with a parsed .target field */
function hydrateProfile(p: Profile): Profile {
  return { ...p, target: decodeTarget(p.notes) ?? undefined };
}

/** Auto-generate a smart profile name from target + geo + seed */
export function suggestName(
  target: ProfileTarget | undefined,
  geo: string,
  seed: number,
): string {
  const shortSeed = (seed >>> 0).toString(16).slice(0, 4).toUpperCase();
  if (!target?.url) return `Profile-${shortSeed}`;
  const platform =
    target.platform ?? target.url.replace(/^https?:\/\//, "").split("/")[0];
  return `${platform}-${geo.toUpperCase()}-${shortSeed}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let profiles = $state<Profile[]>([]);
let selectedIds = $state<Set<string>>(new Set());
let activeProfileId = $state<string | null>(null);
let loading = $state(false);
let error = $state<string | null>(null);

// Pagination / filter
let filterStatus = $state<"all" | "idle" | "running" | "error">("all");
let filterQuery = $state("");
let sortBy = $state<"created_at" | "last_used" | "name" | "status">(
  "created_at",
);

// ─────────────────────────────────────────────────────────────────────────────
// Derived
// ─────────────────────────────────────────────────────────────────────────────

let filteredProfiles = $derived.by(() => {
  let result = profiles;

  if (filterStatus !== "all") {
    result = result.filter((p) => p.status === filterStatus);
  }

  if (filterQuery.trim()) {
    const q = filterQuery.toLowerCase();
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.target?.url?.toLowerCase().includes(q) ||
        p.target?.platform?.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  return [...result].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "status":
        return a.status.localeCompare(b.status);
      case "last_used":
        if (!a.last_used && !b.last_used) return 0;
        if (!a.last_used) return 1;
        if (!b.last_used) return -1;
        return b.last_used.localeCompare(a.last_used);
      default: // created_at
        return b.created_at.localeCompare(a.created_at);
    }
  });
});

let selectedProfiles = $derived(profiles.filter((p) => selectedIds.has(p.id)));

let activeProfile = $derived(
  activeProfileId
    ? (profiles.find((p) => p.id === activeProfileId) ?? null)
    : null,
);

/** Target distribution for Control Room pie */
let targetDistribution = $derived.by(() => {
  const map = new Map<string, number>();
  for (const p of profiles) {
    const key = p.target?.platform ?? "Other";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count);
});

let globalStats = $derived.by(() => ({
  profiles_total: profiles.length,
  profiles_running: profiles.filter((p) => p.status === "running").length,
  profiles_error: profiles.filter((p) => p.status === "error").length,
  target_distribution: targetDistribution,
}));

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

async function loadProfiles(): Promise<void> {
  loading = true;
  error = null;
  try {
    const raw = await safeInvoke<Profile[]>("list_profiles");
    if (raw) {
      profiles = raw.map(hydrateProfile);
      saveProfilesToStorage(profiles);
    } else {
      // Fallback: load from localStorage if Tauri unavailable
      console.log(
        "[profileStore] Tauri unavailable, loading from localStorage",
      );
      const stored = loadProfilesFromStorage();
      profiles = stored.map(hydrateProfile);
    }
  } catch (e) {
    error = String(e);
    // Try fallback on error
    try {
      const stored = loadProfilesFromStorage();
      profiles = stored.map(hydrateProfile);
    } catch (fallbackError) {
      console.error(
        "[profileStore] Both Tauri and fallback failed:",
        fallbackError,
      );
    }
  } finally {
    loading = false;
  }
}

async function getProfile(id: string): Promise<Profile | null> {
  try {
    const raw = await safeInvoke<Profile>("get_profile", { id });
    return raw ? hydrateProfile(raw) : null;
  } catch {
    return null;
  }
}

async function createProfile(
  payload: CreateProfilePayload,
  target?: ProfileTarget,
): Promise<Profile> {
  // Embed target into notes
  const notes = target
    ? encodeTarget(target, payload.notes ?? "")
    : (payload.notes ?? "");

  const raw = await safeInvoke<Profile>("create_profile", {
    name: payload.name,
    seed: payload.seed ?? null,
    proxyId: payload.proxy_id ?? null,
    notes,
    tags: payload.tags ?? [],
    behaviorProfile: payload.behavior_profile ?? "normal",
  });

  // Fallback: create profile locally if Tauri unavailable
  if (!raw) {
    console.log(
      "[profileStore] Tauri unavailable, creating profile in localStorage",
    );
    const profile: Profile = {
      id: crypto.randomUUID(),
      name: payload.name,
      fingerprint: payload.seed
        ? generateFingerprintFallback(payload.seed)
        : generateFingerprintFallback(),
      human: {
        profile: payload.behavior_profile ?? "normal",
      } as HumanBehavior,
      proxy_id: payload.proxy_id ?? null,
      notes,
      tags: payload.tags ?? [],
      status: "idle",
      created_at: new Date().toISOString(),
      last_used: null,
      data_dir: "",
    };

    profiles = [profile, ...profiles];
    saveProfilesToStorage(profiles);
    return profile;
  }

  const hydrated = hydrateProfile(raw);
  profiles = [hydrated, ...profiles];
  saveProfilesToStorage(profiles);
  return hydrated;
}

async function updateProfile(
  id: string,
  payload: UpdateProfilePayload,
  target?: ProfileTarget,
): Promise<Profile> {
  let notes = payload.notes;

  // Re-encode target if provided
  if (target !== undefined) {
    const existing = profiles.find((p) => p.id === id);
    const base = notes ?? existing?.notes ?? "";
    notes = encodeTarget(target, stripTargetBlock(base));
  }

  const raw = await safeInvoke<Profile>("update_profile", {
    id,
    name: payload.name ?? null,
    fingerprint: payload.fingerprint ?? null,
    human: payload.human ?? null,
    proxyId: payload.proxy_id !== undefined ? payload.proxy_id : null,
    notes: notes ?? null,
    tags: payload.tags ?? null,
    behaviorProfile: payload.behavior_profile ?? null,
  });

  if (!raw) {
    // Fallback: update profile locally if Tauri unavailable
    console.log(
      "[profileStore] Tauri unavailable, updating profile in localStorage",
    );
    const existing = profiles.find((p) => p.id === id);
    if (!existing) {
      throw new Error("Profile not found");
    }

    const updated: Profile = {
      ...existing,
      name: payload.name ?? existing.name,
      fingerprint: payload.fingerprint ?? existing.fingerprint,
      human: payload.human ?? existing.human,
      proxy_id:
        payload.proxy_id !== undefined ? payload.proxy_id : existing.proxy_id,
      notes: notes ?? existing.notes,
      tags: payload.tags ?? existing.tags,
      status: existing.status,
    };

    profiles = profiles.map((p) => (p.id === id ? updated : p));
    saveProfilesToStorage(profiles);
    return hydrateProfile(updated);
  }

  const hydrated = hydrateProfile(raw);
  profiles = profiles.map((p) => (p.id === id ? hydrated : p));
  saveProfilesToStorage(profiles);
  return hydrated;
}

async function deleteProfile(id: string): Promise<void> {
  await safeInvoke("delete_profile", { id });
  profiles = profiles.filter((p) => p.id !== id);
  selectedIds.delete(id);
  if (activeProfileId === id) activeProfileId = null;
}

async function deleteSelected(): Promise<void> {
  const ids = [...selectedIds];
  await Promise.all(ids.map((id) => safeInvoke("delete_profile", { id })));
  profiles = profiles.filter((p) => !selectedIds.has(p.id));
  selectedIds = new Set();
}

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint helpers
// ─────────────────────────────────────────────────────────────────────────────

async function reseedProfile(id: string, seed?: number): Promise<Profile> {
  const raw = await safeInvoke<Profile>("reseed_profile", {
    id,
    seed: seed ?? null,
  });

  if (!raw) {
    throw new Error("Failed to reseed profile: Tauri unavailable");
  }

  const hydrated = hydrateProfile(raw);
  profiles = profiles.map((p) => (p.id === id ? hydrated : p));
  return hydrated;
}

async function generateFingerprint(seed?: number): Promise<Fingerprint> {
  // Try Tauri backend first; fall back to JS implementation if unavailable
  try {
    const fp = await safeInvoke<Fingerprint>("generate_fingerprint", {
      seed: seed ?? null,
    });
    if (fp) {
      return fp;
    }
  } catch (e) {
    console.warn("[profileStore] Tauri invoke failed, using JS fallback:", e);
  }

  // JS fallback (used during web dev or if Tauri fails)
  return generateFingerprintFallback(seed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Clone with variation
// ─────────────────────────────────────────────────────────────────────────────

export type CloneVariantMode =
  | "proxy_only"
  | "geo_and_tz"
  | "mutate_seed"
  | "change_target"
  | "increment_hw";

export interface CloneVariantOptions {
  mode: CloneVariantMode;
  new_proxy_id?: string;
  seed_bit_flip?: number; // 1–5
  new_target?: ProfileTarget;
  new_name?: string;
}

async function cloneProfile(
  id: string,
  opts: CloneVariantOptions,
): Promise<Profile> {
  const src = profiles.find((p) => p.id === id);
  if (!src) throw new Error(`Profile ${id} not found`);

  // Build a mutated fingerprint copy
  let fp: Fingerprint = { ...src.fingerprint };
  let target: ProfileTarget | undefined = src.target;
  let newName = opts.new_name;

  switch (opts.mode) {
    case "mutate_seed": {
      const bits = opts.seed_bit_flip ?? 2;
      // Flip `bits` random bits in the seed
      let seed = BigInt(src.fingerprint.seed);
      for (let i = 0; i < bits; i++) {
        const bit = BigInt(Math.floor(Math.random() * 32));
        seed ^= 1n << bit;
      }
      fp = await generateFingerprint(Number(seed & 0xffffffffn));
      if (!newName) {
        const shortSeed = fp.seed.toString(16).slice(0, 4).toUpperCase();
        newName = `${src.name}-μ${shortSeed}`;
      }
      break;
    }

    case "increment_hw": {
      // Step up concurrency and memory
      const concurrencySteps = [2, 4, 8, 16];
      const memorySteps = [1, 2, 4, 8];
      const curC = concurrencySteps.indexOf(fp.hardware_concurrency);
      const curM = memorySteps.indexOf(fp.device_memory);
      fp.hardware_concurrency =
        concurrencySteps[Math.min(curC + 1, concurrencySteps.length - 1)];
      fp.device_memory =
        memorySteps[Math.min(curM + 1, memorySteps.length - 1)];
      if (!newName) newName = `${src.name}-HW+`;
      break;
    }

    case "geo_and_tz": {
      // The proxy change will carry geo/tz — just tag the name
      if (!newName) newName = `${src.name}-geo`;
      break;
    }

    case "change_target": {
      target = opts.new_target ?? undefined;
      if (!newName && target?.platform) {
        newName = `${target.platform}-${(fp.seed >>> 0).toString(16).slice(0, 4).toUpperCase()}`;
      }
      break;
    }

    default:
      if (!newName) newName = `${src.name}-clone`;
  }

  const notes = target
    ? encodeTarget(target, stripTargetBlock(src.notes))
    : src.notes;

  const raw = await safeInvoke<Profile>("create_profile", {
    name: newName ?? `${src.name}-clone`,
    seed: fp.seed,
    proxyId: opts.new_proxy_id ?? src.proxy_id ?? null,
    notes,
    tags: src.tags,
    behaviorProfile: src.human.profile,
  });

  if (!raw) {
    throw new Error("Failed to clone profile: Tauri unavailable");
  }

  // If we incremented HW, push a fingerprint update
  let hydrated = hydrateProfile(raw);
  if (opts.mode === "increment_hw") {
    hydrated = await updateProfile(hydrated.id, { fingerprint: fp });
  }

  profiles = [hydrated, ...profiles];
  return hydrated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Launch / stop
// ─────────────────────────────────────────────────────────────────────────────

async function launchProfile(id: string, url?: string): Promise<number> {
  // If no explicit URL, use the profile's target URL
  const profile = profiles.find((p) => p.id === id);
  const launchUrl = url ?? profile?.target?.url ?? "about:blank";

  const port = await safeInvoke<number>("launch_profile", {
    id,
    url: launchUrl,
  });

  if (!port) {
    throw new Error("Failed to launch profile: Tauri unavailable");
  }

  // Optimistically mark as running
  profiles = profiles.map((p) =>
    p.id === id ? { ...p, status: "running" } : p,
  );

  return port;
}

async function stopProfile(id: string): Promise<void> {
  await safeInvoke("stop_bridge", { profileId: id });
  profiles = profiles.map((p) => (p.id === id ? { ...p, status: "idle" } : p));
}

async function launchSelected(): Promise<void> {
  await Promise.all([...selectedIds].map((id) => launchProfile(id)));
}

async function stopSelected(): Promise<void> {
  await Promise.all([...selectedIds].map((id) => stopProfile(id)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Emergency rotate
// ─────────────────────────────────────────────────────────────────────────────

async function emergencyRotate(
  mode: EmergencyRotateMode,
  proxyPool: string[], // ordered proxy IDs to rotate through
): Promise<void> {
  const running = profiles.filter((p) => p.status === "running");
  const targets = running.length > 0 ? running : profiles;

  await Promise.allSettled(
    targets.map(async (p, i) => {
      const newProxyId = proxyPool[i % proxyPool.length] ?? null;

      const patch: UpdateProfilePayload = {};

      if (
        mode === "proxies_only" ||
        mode === "proxies_and_fingerprint" ||
        mode === "proxies_fingerprint_and_targets"
      ) {
        patch.proxy_id = newProxyId;
      }

      if (
        mode === "proxies_and_fingerprint" ||
        mode === "proxies_fingerprint_and_targets"
      ) {
        // Generate a brand-new random fingerprint
        const newFp = await generateFingerprint();
        patch.fingerprint = newFp;
      }

      await updateProfile(p.id, patch);

      // Restart if currently running
      if (p.status === "running") {
        await stopProfile(p.id).catch(() => {});
        await launchProfile(p.id).catch(() => {});
      }
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection helpers
// ─────────────────────────────────────────────────────────────────────────────

function toggleSelect(id: string): void {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds = next;
}

function selectAll(): void {
  selectedIds = new Set(filteredProfiles.map((p) => p.id));
}

function clearSelection(): void {
  selectedIds = new Set();
}

function setActive(id: string | null): void {
  activeProfileId = id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported store object
// ─────────────────────────────────────────────────────────────────────────────

export const profileStore = {
  // ── Reactive state ────────────────────────────────────────────────────────
  get profiles() {
    return profiles;
  },
  get filteredProfiles() {
    return filteredProfiles;
  },
  get selectedIds() {
    return selectedIds;
  },
  get selectedProfiles() {
    return selectedProfiles;
  },
  get activeProfile() {
    return activeProfile;
  },
  get loading() {
    return loading;
  },
  get error() {
    return error;
  },
  get globalStats() {
    return globalStats;
  },
  get targetDistribution() {
    return targetDistribution;
  },

  // ── Filters / sort (writable) ─────────────────────────────────────────────
  get filterStatus() {
    return filterStatus;
  },
  set filterStatus(v: typeof filterStatus) {
    filterStatus = v;
  },
  get filterQuery() {
    return filterQuery;
  },
  set filterQuery(v: string) {
    filterQuery = v;
  },
  get sortBy() {
    return sortBy;
  },
  set sortBy(v: typeof sortBy) {
    sortBy = v;
  },

  // ── CRUD ──────────────────────────────────────────────────────────────────
  loadProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  deleteSelected,
  reseedProfile,
  generateFingerprint,

  // ── Clone ─────────────────────────────────────────────────────────────────
  cloneProfile,

  // ── Launch / stop ─────────────────────────────────────────────────────────
  launchProfile,
  stopProfile,
  launchSelected,
  stopSelected,

  // ── Emergency ─────────────────────────────────────────────────────────────
  emergencyRotate,

  // ── Selection ─────────────────────────────────────────────────────────────
  toggleSelect,
  selectAll,
  clearSelection,
  setActive,
};
