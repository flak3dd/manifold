<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { invoke } from "@tauri-apps/api/core";
    import { bridgeStore } from "$lib/stores/bridge.svelte";
    import { profileStore } from "$lib/stores/profiles.svelte";
    import FingerprintPreview from "$lib/components/FingerprintPreview.svelte";
    import { toast } from "svelte-sonner";
    import type { HarEntry, EntropyLog, SessionEvent } from "$lib/types";

    // ── State ──────────────────────────────────────────────────────────────────
    let tab = $state<"live" | "har" | "entropy" | "events" | "log" | "fingerprint">("live");
    let exportingSession = $state(false);
    let autoScroll = $state(true);
    let harFilter = $state("");
    let harMethodFilter = $state<string>("all");
    let harStatusFilter = $state<"all" | "ok" | "error">("all");
    let entropyIdx = $state(0);
    let logLevelFilter = $state<"all" | "info" | "warn" | "error">("all");
    let showRawJson = $state(false);

    // ── Derived ────────────────────────────────────────────────────────────────
    let connected = $derived(bridgeStore.connected);
    let sessionId = $derived(bridgeStore.sessionId);
    let currentUrl = $derived(bridgeStore.currentUrl);
    let harEntries = $derived(bridgeStore.harEntries as HarEntry[]);
    let entropySnaps = $derived(bridgeStore.entropySnaps as EntropyLog[]);
    let eventLog = $derived(bridgeStore.eventLog as SessionEvent[]);
    let logLines = $derived(bridgeStore.logLines);
    let riskScore = $derived(bridgeStore.riskScore);
    let harStats = $derived(bridgeStore.harStats);
    let latestEntropy = $derived(
        bridgeStore.latestEntropy as EntropyLog | null,
    );
    let screenshot = $derived(bridgeStore.lastScreenshot);
    let profileId = $derived(bridgeStore.profileId);

    let activeProfile = $derived(
        profileId
            ? (profileStore.profiles.find((p) => p.id === profileId) ?? null)
            : null,
    );

    let filteredHar = $derived.by(() => {
        let result = harEntries;

        if (harMethodFilter !== "all") {
            result = result.filter((e) => e.method === harMethodFilter);
        }

        if (harStatusFilter === "ok") {
            result = result.filter((e) => e.status < 400);
        } else if (harStatusFilter === "error") {
            result = result.filter((e) => e.status >= 400);
        }

        if (harFilter.trim()) {
            const q = harFilter.toLowerCase();
            result = result.filter(
                (e) =>
                    e.url.toLowerCase().includes(q) ||
                    e.method.toLowerCase().includes(q) ||
                    String(e.status).includes(q),
            );
        }

        return result;
    });

    let filteredLogs = $derived.by(() => {
        if (logLevelFilter === "all") return logLines;
        return logLines.filter((l) => l.level === logLevelFilter);
    });

    let currentEntropy = $derived(
        entropySnaps.length > 0
            ? entropySnaps[Math.min(entropyIdx, entropySnaps.length - 1)]
            : null,
    );

    let harMethods = $derived.by(() => {
        const set = new Set(harEntries.map((e) => e.method));
        return Array.from(set).sort();
    });

    // ── Refs ───────────────────────────────────────────────────────────────────
    let logContainer: HTMLDivElement | undefined = $state(undefined);

    // ── Auto-scroll log ────────────────────────────────────────────────────────
    $effect(() => {
        if (autoScroll && logContainer && logLines.length > 0) {
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    });

    // ── Lifecycle ──────────────────────────────────────────────────────────────
    onMount(async () => {
        if (profileStore.profiles.length === 0) {
            await profileStore.loadProfiles();
        }
    });

    // ── Helpers ────────────────────────────────────────────────────────────────
    function statusColor(status: number): string {
        if (status < 300) return "var(--status-success, #22c55e)";
        if (status < 400) return "var(--accent, #818cf8)";
        if (status < 500) return "var(--status-warning, #f59e0b)";
        return "var(--status-error, #ef4444)";
    }

    function riskColor(score: number | null): string {
        if (score === null) return "var(--text-muted)";
        if (score < 25) return "var(--status-success, #22c55e)";
        if (score < 50) return "var(--status-warning, #f59e0b)";
        return "var(--status-error, #ef4444)";
    }

    function riskLabel(score: number | null): string {
        if (score === null) return "N/A";
        if (score < 25) return "Low";
        if (score < 50) return "Medium";
        if (score < 75) return "High";
        return "Critical";
    }

    function formatMs(ms: number): string {
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
    }

    function truncateUrl(url: string, max = 80): string {
        if (url.length <= max) return url;
        return url.slice(0, max - 3) + "…";
    }

    function formatTimestamp(ts: number | string): string {
        const d = new Date(ts);
        return d.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    }

    function levelIcon(level: string): string {
        switch (level) {
            case "error":
                return "✕";
            case "warn":
                return "⚠";
            case "info":
                return "ℹ";
            default:
                return "·";
        }
    }

    function levelColor(level: string): string {
        switch (level) {
            case "error":
                return "var(--status-error, #ef4444)";
            case "warn":
                return "var(--status-warning, #f59e0b)";
            default:
                return "var(--text-secondary)";
        }
    }

    function mimeIcon(mime: string): string {
        if (mime.includes("html")) return "📄";
        if (mime.includes("json") || mime.includes("api")) return "📦";
        if (mime.includes("javascript") || mime.includes("script")) return "⚡";
        if (mime.includes("css") || mime.includes("style")) return "🎨";
        if (mime.includes("image")) return "🖼";
        if (mime.includes("font")) return "🔤";
        return "📎";
    }

    // ── Shannon entropy calculation ────────────────────────────────────────────
    //
    // Computes Shannon entropy (bits/action) for the event log.
    // H = -Σ p(x) * log2(p(x))   where p(x) = freq(x) / total
    // Spec threshold: H > 4.2 bits/action indicates human-like behaviour.

    let shannonEntropy = $derived.by((): number | null => {
        if (eventLog.length < 2) return null;
        const counts: Record<string, number> = {};
        for (const ev of eventLog) {
            counts[ev.type] = (counts[ev.type] ?? 0) + 1;
        }
        const total = eventLog.length;
        let H = 0;
        for (const c of Object.values(counts)) {
            const p = c / total;
            if (p > 0) H -= p * Math.log2(p);
        }
        return Math.round(H * 100) / 100;
    });

    let shannonColor = $derived(
        shannonEntropy === null ? "var(--text-muted)"
      : shannonEntropy >= 4.2  ? "var(--success)"
      : shannonEntropy >= 3.0  ? "var(--warning)"
      : "var(--error)"
    );

    // ── Session export ─────────────────────────────────────────────────────────

    async function handleExportSession() {
        if (!sessionId || !profileId) {
            toast.error("No active session to export");
            return;
        }
        exportingSession = true;
        try {
            const harJson     = bridgeStore.exportHarJson();
            const entropyJson = bridgeStore.exportEntropyJson();
            const path = await invoke<string>("export_session", {
                profileId,
                harJson,
                entropyJson,
            });
            toast.success(`Session exported`, { description: path, duration: 6000 });
        } catch (e) {
            toast.error(`Export failed: ${e}`);
        } finally {
            exportingSession = false;
        }
    }

    const TABS: { id: typeof tab; label: string; badge?: () => string }[] = [
        { id: "live", label: "Live View" },
        {
            id: "har",
            label: "Network",
            badge: () =>
                harEntries.length > 0 ? String(harEntries.length) : "",
        },
        {
            id: "entropy",
            label: "Entropy",
            badge: () =>
                entropySnaps.length > 0 ? String(entropySnaps.length) : "",
        },
        {
            id: "events",
            label: "Events",
            badge: () => (eventLog.length > 0 ? String(eventLog.length) : ""),
        },
        {
            id: "log",
            label: "Console",
            badge: () => (logLines.length > 0 ? String(logLines.length) : ""),
        },
        { id: "fingerprint", label: "FP Score" },
    ];
</script>

<div class="page">
    <!-- ── Header ───────────────────────────────────────────────────────────── -->
    <div class="page-header">
        <div class="header-left">
            <h1 class="page-title">Trace Viewer</h1>
            <span class="conn-badge" class:online={connected}>
                <span class="conn-dot"></span>
                {connected ? "Connected" : "Disconnected"}
            </span>
            {#if sessionId}
                <span class="session-badge mono">{sessionId.slice(0, 8)}</span>
            {/if}
        </div>
        <div class="header-actions">
            {#if connected && sessionId}
                <button
                    class="btn-secondary"
                    onclick={() => bridgeStore.screenshot()}
                >
                    📷 Screenshot
                </button>
                <button
                    class="btn-secondary"
                    onclick={() =>
                        bridgeStore.downloadHar(
                            `har-${sessionId?.slice(0, 8)}.har`,
                        )}
                    disabled={harEntries.length === 0}
                >
                    ⬇ HAR
                </button>
                <button
                    class="btn-secondary"
                    onclick={() =>
                        bridgeStore.downloadEntropy(
                            `entropy-${sessionId?.slice(0, 8)}.json`,
                        )}
                    disabled={entropySnaps.length === 0}
                >
                    ⬇ Entropy
                </button>
                <button
                    class="btn-secondary"
                    onclick={handleExportSession}
                    disabled={exportingSession}
                    title="Export full session bundle (HAR + entropy + fingerprint) to profiles dir"
                >
                    {exportingSession ? "Exporting…" : "⬇ Session Bundle"}
                </button>
                {#if shannonEntropy !== null}
                    <span class="entropy-pill" style:color={shannonColor} title="Shannon entropy of action log (>4.2 = human-like)">
                        H={shannonEntropy}
                    </span>
                {/if}
                <button
                    class="btn-ghost danger"
                    onclick={() => bridgeStore.stop()}
                >
                    ■ Stop
                </button>
            {:else}
                <span class="muted" style="font-size: 12px;">
                    Launch a profile to start tracing
                </span>
            {/if}
        </div>
    </div>

    <!-- ── Tabs ─────────────────────────────────────────────────────────────── -->
    <div class="tabs">
        {#each TABS as t}
            <button
                class="tab"
                class:active={tab === t.id}
                onclick={() => (tab = t.id)}
            >
                {t.label}
                {#if t.badge}
                    {@const b = t.badge()}
                    {#if b}
                        <span class="tab-badge">{b}</span>
                    {/if}
                {/if}
            </button>
        {/each}
    </div>

    <!-- ── Body ─────────────────────────────────────────────────────────────── -->
    <div class="body">
        <!-- ════════ FINGERPRINT SCORE ════════ -->
        {#if tab === "fingerprint"}
            <div class="fp-score-tab">
                {#if activeProfile}
                    <div class="fp-score-header">
                        <span class="fp-score-title">Fingerprint Risk Analysis</span>
                        <span class="fp-score-sub">
                            Profile: <strong>{activeProfile.name}</strong>
                            · Seed: <span class="mono">{activeProfile.fingerprint.seed}</span>
                        </span>
                    </div>
                    <FingerprintPreview
                        fingerprint={activeProfile.fingerprint}
                        showIframes={false}
                    />
                {:else}
                    <div class="empty-state">
                        <p>No active profile — launch a profile to view fingerprint scoring.</p>
                    </div>
                {/if}
                {#if shannonEntropy !== null}
                    <div class="shannon-card">
                        <div class="shannon-header">
                            <span class="shannon-title">Behavioural Entropy</span>
                            <span class="shannon-badge" style:background={shannonColor + "22"} style:color={shannonColor}>
                                {shannonEntropy >= 4.2 ? "✓ PASS" : "✗ BELOW THRESHOLD"}
                            </span>
                        </div>
                        <div class="shannon-body">
                            <div class="shannon-row">
                                <span class="shannon-label">Shannon H</span>
                                <span class="shannon-val mono" style:color={shannonColor}>{shannonEntropy} bits/action</span>
                            </div>
                            <div class="shannon-row">
                                <span class="shannon-label">Threshold</span>
                                <span class="shannon-val mono">&gt; 4.2 bits/action</span>
                            </div>
                            <div class="shannon-row">
                                <span class="shannon-label">Actions sampled</span>
                                <span class="shannon-val mono">{eventLog.length}</span>
                            </div>
                            <div class="shannon-row">
                                <span class="shannon-label">Event types</span>
                                <span class="shannon-val mono">
                                    {[...new Set(eventLog.map(e => e.type))].join(", ") || "—"}
                                </span>
                            </div>
                        </div>
                        <p class="shannon-desc">
                            Shannon entropy measures the unpredictability of the action sequence.
                            Values &gt;4.2 bits/action indicate human-like behavioural variance
                            and resist WAF ML classifiers. Low values suggest bot-like patterns.
                        </p>
                    </div>
                {/if}
            </div>

        <!-- ════════ LIVE VIEW ════════ -->
        {:else if tab === "live"}
            <div class="live-grid">
                <!-- Session info -->
                <div class="panel">
                    <div class="panel-header">
                        <span class="panel-title">Session</span>
                    </div>
                    <div class="panel-body">
                        {#if activeProfile}
                            <div class="info-row">
                                <span class="info-label">Profile</span>
                                <span class="info-value"
                                    >{activeProfile.name}</span
                                >
                            </div>
                        {/if}
                        <div class="info-row">
                            <span class="info-label">URL</span>
                            <span class="info-value mono" title={currentUrl}>
                                {truncateUrl(currentUrl, 60)}
                            </span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Requests</span>
                            <span class="info-value">{harEntries.length}</span>
                        </div>
                        {#if harStats}
                            <div class="info-row">
                                <span class="info-label">Errors</span>
                                <span
                                    class="info-value"
                                    style:color={harStats.errors > 0
                                        ? "var(--status-error, #ef4444)"
                                        : undefined}
                                >
                                    {harStats.errors}
                                </span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Avg latency</span>
                                <span class="info-value"
                                    >{formatMs(harStats.avgTime)}</span
                                >
                            </div>
                        {/if}
                        <div class="info-row">
                            <span class="info-label">Entropy snaps</span>
                            <span class="info-value">{entropySnaps.length}</span
                            >
                        </div>
                    </div>
                </div>

                <!-- Risk score -->
                <div class="panel">
                    <div class="panel-header">
                        <span class="panel-title">Detection Risk</span>
                    </div>
                    <div class="panel-body risk-panel">
                        <div
                            class="risk-score"
                            style:color={riskColor(riskScore)}
                        >
                            {riskScore ?? "—"}
                        </div>
                        <div
                            class="risk-label"
                            style:color={riskColor(riskScore)}
                        >
                            {riskLabel(riskScore)}
                        </div>
                        <div class="risk-bar-track">
                            <div
                                class="risk-bar-fill"
                                style:width="{riskScore ?? 0}%"
                                style:background={riskColor(riskScore)}
                            ></div>
                        </div>
                        {#if latestEntropy}
                            <div class="risk-signals">
                                <span
                                    class="signal"
                                    class:bad={latestEntropy.navigator
                                        ?.webdriver}
                                >
                                    WebDriver: {latestEntropy.navigator
                                        ?.webdriver
                                        ? "DETECTED"
                                        : "hidden"}
                                </span>
                                <span
                                    class="signal"
                                    class:bad={latestEntropy.webrtc_leak}
                                >
                                    WebRTC leak: {latestEntropy.webrtc_leak
                                        ? "LEAKING"
                                        : "safe"}
                                </span>
                            </div>
                        {:else}
                            <p
                                class="muted"
                                style="font-size:12px; margin-top:8px;"
                            >
                                No entropy data yet
                            </p>
                        {/if}
                    </div>
                </div>

                <!-- Screenshot -->
                <div class="panel screenshot-panel">
                    <div class="panel-header">
                        <span class="panel-title">Last Screenshot</span>
                    </div>
                    <div class="panel-body">
                        {#if screenshot}
                            <img
                                class="screenshot-img"
                                src="data:image/png;base64,{screenshot}"
                                alt="Page screenshot"
                            />
                        {:else}
                            <div class="empty-screenshot">
                                <span class="muted">No screenshot captured</span
                                >
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Recent events -->
                <div class="panel">
                    <div class="panel-header">
                        <span class="panel-title">Recent Events</span>
                        <span class="muted" style="font-size:11px;">
                            {eventLog.length} total
                        </span>
                    </div>
                    <div class="panel-body event-mini-list">
                        {#each eventLog.slice(-10).reverse() as evt}
                            <div class="event-mini">
                                <span class="event-time mono">
                                    {formatTimestamp(evt.ts)}
                                </span>
                                <span class="event-type">{evt.type}</span>
                            </div>
                        {:else}
                            <p class="muted" style="font-size:12px;">
                                No events yet
                            </p>
                        {/each}
                    </div>
                </div>
            </div>

            <!-- ════════ NETWORK / HAR ════════ -->
        {:else if tab === "har"}
            <div class="har-toolbar">
                <input
                    class="input har-search"
                    type="text"
                    placeholder="Filter by URL, method, status…"
                    bind:value={harFilter}
                />
                <select class="input har-select" bind:value={harMethodFilter}>
                    <option value="all">All methods</option>
                    {#each harMethods as m}
                        <option value={m}>{m}</option>
                    {/each}
                </select>
                <select class="input har-select" bind:value={harStatusFilter}>
                    <option value="all">All statuses</option>
                    <option value="ok">2xx–3xx</option>
                    <option value="error">4xx–5xx</option>
                </select>
                <span class="muted" style="font-size:11px; white-space:nowrap;">
                    {filteredHar.length} / {harEntries.length}
                </span>
            </div>

            <div class="har-list">
                {#if harEntries.length === 0}
                    <div class="empty-state">
                        <p class="empty-title">No network requests captured</p>
                        <p class="empty-sub">
                            Requests will appear here once a session is running.
                        </p>
                    </div>
                {:else if filteredHar.length === 0}
                    <div class="empty-state">
                        <p class="muted">No requests match your filters</p>
                    </div>
                {:else}
                    <div class="har-header-row">
                        <span class="har-col status">Status</span>
                        <span class="har-col method">Method</span>
                        <span class="har-col url">URL</span>
                        <span class="har-col mime">Type</span>
                        <span class="har-col time">Time</span>
                        <span class="har-col size">Size</span>
                    </div>
                    {#each filteredHar as entry, idx (idx)}
                        <div class="har-row" class:error={entry.status >= 400}>
                            <span
                                class="har-col status mono"
                                style:color={statusColor(entry.status)}
                            >
                                {entry.status}
                            </span>
                            <span class="har-col method mono"
                                >{entry.method}</span
                            >
                            <span class="har-col url mono" title={entry.url}>
                                {truncateUrl(entry.url)}
                            </span>
                            <span class="har-col mime">
                                {mimeIcon(entry.mime_type)}
                            </span>
                            <span class="har-col time mono">
                                {formatMs(entry.time_ms)}
                            </span>
                            <span class="har-col size mono">
                                {entry.body_size > 0
                                    ? `${(entry.body_size / 1024).toFixed(1)}k`
                                    : "—"}
                            </span>
                        </div>
                    {/each}
                {/if}
            </div>

            <!-- ════════ ENTROPY ════════ -->
        {:else if tab === "entropy"}
            <div class="entropy-view">
                {#if entropySnaps.length === 0}
                    <div class="empty-state">
                        <p class="empty-title">No entropy snapshots</p>
                        <p class="empty-sub">
                            Entropy data is collected periodically during active
                            sessions to detect fingerprint leaks and spoofing
                            failures.
                        </p>
                    </div>
                {:else}
                    <div class="entropy-toolbar">
                        <button
                            class="btn-sm"
                            disabled={entropyIdx <= 0}
                            onclick={() =>
                                (entropyIdx = Math.max(0, entropyIdx - 1))}
                        >
                            ← Prev
                        </button>
                        <span class="mono" style="font-size: 12px;">
                            Snapshot {entropyIdx + 1} / {entropySnaps.length}
                        </span>
                        <button
                            class="btn-sm"
                            disabled={entropyIdx >= entropySnaps.length - 1}
                            onclick={() =>
                                (entropyIdx = Math.min(
                                    entropySnaps.length - 1,
                                    entropyIdx + 1,
                                ))}
                        >
                            Next →
                        </button>
                        <button
                            class="btn-sm"
                            onclick={() =>
                                (entropyIdx = entropySnaps.length - 1)}
                        >
                            Latest
                        </button>
                        <label class="toggle-label">
                            <input type="checkbox" bind:checked={showRawJson} />
                            Raw JSON
                        </label>
                    </div>

                    {#if showRawJson}
                        <pre class="json-view mono">{JSON.stringify(
                                currentEntropy,
                                null,
                                2,
                            )}</pre>
                    {:else if currentEntropy}
                        <div class="entropy-grid">
                            <!-- Navigator -->
                            <div class="entropy-card">
                                <h3 class="entropy-card-title">Navigator</h3>
                                <div class="kv-list">
                                    <div class="kv">
                                        <span class="kv-key">userAgent</span>
                                        <span class="kv-val mono">
                                            {truncateUrl(
                                                currentEntropy.navigator
                                                    ?.userAgent ?? "—",
                                                100,
                                            )}
                                        </span>
                                    </div>
                                    <div class="kv">
                                        <span class="kv-key">platform</span>
                                        <span class="kv-val mono">
                                            {currentEntropy.navigator
                                                ?.platform ?? "—"}
                                        </span>
                                    </div>
                                    <div class="kv">
                                        <span class="kv-key"
                                            >hardwareConcurrency</span
                                        >
                                        <span class="kv-val mono">
                                            {currentEntropy.navigator
                                                ?.hardwareConcurrency ?? "—"}
                                        </span>
                                    </div>
                                    <div class="kv">
                                        <span class="kv-key">deviceMemory</span>
                                        <span class="kv-val mono">
                                            {currentEntropy.navigator
                                                ?.deviceMemory ?? "—"}
                                        </span>
                                    </div>
                                    <div
                                        class="kv"
                                        class:bad-kv={currentEntropy.navigator
                                            ?.webdriver}
                                    >
                                        <span class="kv-key">webdriver</span>
                                        <span class="kv-val mono">
                                            {String(
                                                currentEntropy.navigator
                                                    ?.webdriver ?? false,
                                            )}
                                        </span>
                                    </div>
                                    <div class="kv">
                                        <span class="kv-key">languages</span>
                                        <span class="kv-val mono">
                                            {currentEntropy.navigator?.languages?.join(
                                                ", ",
                                            ) ?? "—"}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <!-- Screen -->
                            <div class="entropy-card">
                                <h3 class="entropy-card-title">Screen</h3>
                                <div class="kv-list">
                                    <div class="kv">
                                        <span class="kv-key"
                                            >width × height</span
                                        >
                                        <span class="kv-val mono">
                                            {currentEntropy.screen?.width ??
                                                "—"} × {currentEntropy.screen
                                                ?.height ?? "—"}
                                        </span>
                                    </div>
                                    <div class="kv">
                                        <span class="kv-key">colorDepth</span>
                                        <span class="kv-val mono">
                                            {currentEntropy.screen
                                                ?.colorDepth ?? "—"}
                                        </span>
                                    </div>
                                    <div class="kv">
                                        <span class="kv-key">pixelRatio</span>
                                        <span class="kv-val mono">
                                            {currentEntropy.screen
                                                ?.pixelRatio ?? "—"}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <!-- WebGL -->
                            <div class="entropy-card">
                                <h3 class="entropy-card-title">WebGL</h3>
                                <div class="kv-list">
                                    <div class="kv">
                                        <span class="kv-key">vendor</span>
                                        <span class="kv-val mono">
                                            {currentEntropy.webgl?.vendor ??
                                                "—"}
                                        </span>
                                    </div>
                                    <div class="kv">
                                        <span class="kv-key">renderer</span>
                                        <span class="kv-val mono">
                                            {truncateUrl(
                                                currentEntropy.webgl
                                                    ?.renderer ?? "—",
                                                80,
                                            )}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <!-- Canvas -->
                            <div class="entropy-card">
                                <h3 class="entropy-card-title">Canvas</h3>
                                <div class="kv-list">
                                    <div class="kv">
                                        <span class="kv-key">hash</span>
                                        <span class="kv-val mono">
                                            {currentEntropy.canvas_hash ?? "—"}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <!-- WebRTC -->
                            <div
                                class="entropy-card"
                                class:bad-card={currentEntropy.webrtc_leak}
                            >
                                <h3 class="entropy-card-title">WebRTC</h3>
                                <div class="kv-list">
                                    <div
                                        class="kv"
                                        class:bad-kv={currentEntropy.webrtc_leak}
                                    >
                                        <span class="kv-key">leak detected</span
                                        >
                                        <span class="kv-val mono">
                                            {String(
                                                currentEntropy.webrtc_leak ??
                                                    false,
                                            )}
                                        </span>
                                    </div>
                                    {#if currentEntropy.webrtc_ips}
                                        <div class="kv">
                                            <span class="kv-key">IPs</span>
                                            <span class="kv-val mono">
                                                {currentEntropy.webrtc_ips.join(
                                                    ", ",
                                                )}
                                            </span>
                                        </div>
                                    {/if}
                                </div>
                            </div>

                            <!-- Audio -->
                            <div class="entropy-card">
                                <h3 class="entropy-card-title">Audio</h3>
                                <div class="kv-list">
                                    <div class="kv">
                                        <span class="kv-key">hash</span>
                                        <span class="kv-val mono">
                                            {currentEntropy.audio_hash ?? "—"}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    {/if}
                {/if}
            </div>

            <!-- ════════ EVENTS ════════ -->
        {:else if tab === "events"}
            <div class="events-list">
                {#if eventLog.length === 0}
                    <div class="empty-state">
                        <p class="empty-title">No session events</p>
                        <p class="empty-sub">
                            Events like navigation, clicks, executions, and
                            errors will appear here during a live session.
                        </p>
                    </div>
                {:else}
                    {#each [...eventLog].reverse() as evt, idx (idx)}
                        <div class="event-row">
                            <span class="event-time mono"
                                >{formatTimestamp(evt.ts)}</span
                            >
                            <span class="event-type-badge">{evt.type}</span>
                            <span class="event-data mono">
                                {JSON.stringify(evt.data).slice(0, 120)}
                            </span>
                        </div>
                    {/each}
                {/if}
            </div>

            <!-- ════════ CONSOLE / LOG ════════ -->
        {:else if tab === "log"}
            <div class="log-toolbar">
                <select class="input log-select" bind:value={logLevelFilter}>
                    <option value="all">All levels</option>
                    <option value="info">Info</option>
                    <option value="warn">Warn</option>
                    <option value="error">Error</option>
                </select>
                <label class="toggle-label">
                    <input type="checkbox" bind:checked={autoScroll} />
                    Auto-scroll
                </label>
                <span class="muted" style="font-size:11px;">
                    {filteredLogs.length} lines
                </span>
            </div>

            <div class="log-container" bind:this={logContainer}>
                {#if filteredLogs.length === 0}
                    <div class="empty-state" style="padding-top: 48px;">
                        <p class="muted">No log output yet</p>
                    </div>
                {:else}
                    {#each filteredLogs as line, idx (idx)}
                        <div class="log-line">
                            <span class="log-time mono"
                                >{formatTimestamp(line.ts)}</span
                            >
                            <span
                                class="log-level mono"
                                style:color={levelColor(line.level)}
                            >
                                {levelIcon(line.level)}
                            </span>
                            <span class="log-msg">{line.message}</span>
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
    /* ── Page layout ──────────────────────────────────────────────────────────── */
    .page {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        background: var(--background, #0a0a0f);
        color: var(--text-primary, #e2e2e8);
    }

    .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 24px;
        border-bottom: 1px solid var(--border, #1e1e2e);
        flex-shrink: 0;
        gap: 12px;
        flex-wrap: wrap;
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
    }

    .page-title {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: -0.025em;
        white-space: nowrap;
    }

    .conn-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        padding: 2px 10px;
        border-radius: 99px;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.25);
        color: var(--status-error, #ef4444);
    }

    .conn-badge.online {
        background: rgba(34, 197, 94, 0.1);
        border-color: rgba(34, 197, 94, 0.25);
        color: var(--status-success, #22c55e);
    }

    .conn-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
    }

    .session-badge {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--surface-2, #12121a);
        border: 1px solid var(--border, #1e1e2e);
        color: var(--text-muted, #5a5a72);
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    /* ── Tabs ──────────────────────────────────────────────────────────────────── */
    .tabs {
        display: flex;
        gap: 0;
        padding: 0 24px;
        border-bottom: 1px solid var(--border, #1e1e2e);
        flex-shrink: 0;
        overflow-x: auto;
    }

    .tab {
        padding: 10px 16px;
        font-size: 12px;
        font-weight: 500;
        color: var(--text-muted, #5a5a72);
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 6px;
        transition:
            color 0.15s,
            border-color 0.15s;
    }

    .tab:hover {
        color: var(--text-secondary, #9898ad);
    }

    .tab.active {
        color: var(--accent, #818cf8);
        border-bottom-color: var(--accent, #818cf8);
    }

    .tab-badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 99px;
        background: var(--surface-3, #1a1a28);
        color: var(--text-muted, #5a5a72);
        font-weight: 600;
    }

    /* ── Body ──────────────────────────────────────────────────────────────────── */
    .body {
        flex: 1;
        overflow-y: auto;
        padding: 0;
    }

    /* ── Live grid ─────────────────────────────────────────────────────────────── */
    .live-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        padding: 20px 24px;
    }

    .panel {
        background: var(--surface-2, #12121a);
        border: 1px solid var(--border, #1e1e2e);
        border-radius: 8px;
        overflow: hidden;
    }

    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid var(--border, #1e1e2e);
    }

    .panel-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary, #9898ad);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .panel-body {
        padding: 12px 14px;
    }

    .screenshot-panel {
        grid-column: span 2;
    }

    .info-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 4px 0;
        gap: 12px;
    }

    .info-label {
        font-size: 12px;
        color: var(--text-muted, #5a5a72);
        flex-shrink: 0;
    }

    .info-value {
        font-size: 12px;
        color: var(--text-primary, #e2e2e8);
        text-align: right;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* Risk panel */
    .risk-panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 16px 14px;
    }

    .risk-score {
        font-size: 36px;
        font-weight: 800;
        letter-spacing: -0.04em;
        line-height: 1;
    }

    .risk-label {
        font-size: 12px;
        font-weight: 600;
        margin-top: 4px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .risk-bar-track {
        width: 100%;
        height: 4px;
        background: var(--surface-3, #1a1a28);
        border-radius: 2px;
        margin-top: 12px;
        overflow: hidden;
    }

    .risk-bar-fill {
        height: 100%;
        border-radius: 2px;
        transition: width 0.3s ease;
    }

    .risk-signals {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
    }

    .signal {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 4px;
        background: rgba(34, 197, 94, 0.1);
        color: var(--status-success, #22c55e);
        border: 1px solid rgba(34, 197, 94, 0.2);
    }

    .signal.bad {
        background: rgba(239, 68, 68, 0.1);
        color: var(--status-error, #ef4444);
        border-color: rgba(239, 68, 68, 0.25);
    }

    /* Screenshot */
    .screenshot-img {
        width: 100%;
        max-height: 300px;
        object-fit: contain;
        border-radius: 4px;
        background: #000;
    }

    .empty-screenshot {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 120px;
    }

    /* Event mini list */
    .event-mini-list {
        max-height: 200px;
        overflow-y: auto;
    }

    .event-mini {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 0;
        font-size: 12px;
    }

    .event-time {
        color: var(--text-muted, #5a5a72);
        font-size: 11px;
        flex-shrink: 0;
    }

    .event-type {
        color: var(--accent, #818cf8);
        font-weight: 500;
        font-size: 11px;
    }

    /* ── HAR / Network ─────────────────────────────────────────────────────────── */
    .har-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 24px;
        border-bottom: 1px solid var(--border, #1e1e2e);
        flex-shrink: 0;
        flex-wrap: wrap;
    }

    .har-search {
        flex: 1;
        min-width: 180px;
    }

    .har-select {
        width: auto;
        min-width: 120px;
    }

    .har-list {
        flex: 1;
        overflow-y: auto;
        padding: 0;
    }

    .har-header-row {
        display: flex;
        align-items: center;
        padding: 6px 24px;
        background: var(--surface-2, #12121a);
        border-bottom: 1px solid var(--border, #1e1e2e);
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted, #5a5a72);
        position: sticky;
        top: 0;
        z-index: 1;
    }

    .har-row {
        display: flex;
        align-items: center;
        padding: 5px 24px;
        border-bottom: 1px solid var(--border, #1e1e2e);
        font-size: 12px;
        transition: background 0.1s;
    }

    .har-row:hover {
        background: var(--surface-2, #12121a);
    }

    .har-row.error {
        background: rgba(239, 68, 68, 0.04);
    }

    .har-col.status {
        width: 56px;
        flex-shrink: 0;
        font-weight: 600;
    }
    .har-col.method {
        width: 64px;
        flex-shrink: 0;
    }
    .har-col.url {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .har-col.mime {
        width: 40px;
        flex-shrink: 0;
        text-align: center;
    }
    .har-col.time {
        width: 72px;
        flex-shrink: 0;
        text-align: right;
    }
    .har-col.size {
        width: 64px;
        flex-shrink: 0;
        text-align: right;
    }

    /* ── Entropy ───────────────────────────────────────────────────────────────── */
    .entropy-view {
        padding: 0;
    }

    .entropy-toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 24px;
        border-bottom: 1px solid var(--border, #1e1e2e);
        flex-wrap: wrap;
    }

    .entropy-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        padding: 20px 24px;
    }

    .entropy-card {
        background: var(--surface-2, #12121a);
        border: 1px solid var(--border, #1e1e2e);
        border-radius: 8px;
        padding: 12px 14px;
    }

    .entropy-card.bad-card {
        border-color: rgba(239, 68, 68, 0.35);
        background: rgba(239, 68, 68, 0.05);
    }

    .entropy-card-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary, #9898ad);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 8px;
    }

    .kv-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .kv {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 3px 0;
        gap: 12px;
    }

    .kv.bad-kv {
        color: var(--status-error, #ef4444);
    }

    .kv-key {
        font-size: 11px;
        color: var(--text-muted, #5a5a72);
        flex-shrink: 0;
    }

    .kv-val {
        font-size: 11px;
        color: var(--text-primary, #e2e2e8);
        text-align: right;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .json-view {
        margin: 16px 24px;
        padding: 14px;
        background: var(--surface-2, #12121a);
        border: 1px solid var(--border, #1e1e2e);
        border-radius: 8px;
        font-size: 11px;
        line-height: 1.6;
        overflow: auto;
        max-height: calc(100vh - 220px);
        color: var(--text-secondary, #9898ad);
        white-space: pre-wrap;
        word-break: break-all;
    }

    /* ── Events ────────────────────────────────────────────────────────────────── */
    .events-list {
        padding: 0;
        overflow-y: auto;
    }

    .event-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 24px;
        border-bottom: 1px solid var(--border, #1e1e2e);
        font-size: 12px;
    }

    .event-row:hover {
        background: var(--surface-2, #12121a);
    }

    .event-type-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 1px 8px;
        border-radius: 4px;
        background: rgba(129, 140, 248, 0.1);
        color: var(--accent, #818cf8);
        border: 1px solid rgba(129, 140, 248, 0.2);
        flex-shrink: 0;
    }

    .event-data {
        font-size: 11px;
        color: var(--text-muted, #5a5a72);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* ── Console / Log ─────────────────────────────────────────────────────────── */
    .log-toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 24px;
        border-bottom: 1px solid var(--border, #1e1e2e);
        flex-shrink: 0;
    }

    .log-select {
        width: auto;
        min-width: 110px;
    }

    .log-container {
        flex: 1;
        overflow-y: auto;
        padding: 0;
        font-size: 12px;
    }

    .log-line {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 3px 24px;
        border-bottom: 1px solid rgba(30, 30, 46, 0.4);
        line-height: 1.55;
    }

    .log-line:hover {
        background: var(--surface-2, #12121a);
    }

    .log-time {
        font-size: 11px;
        color: var(--text-muted, #5a5a72);
        flex-shrink: 0;
        padding-top: 1px;
    }

    .log-level {
        flex-shrink: 0;
        width: 14px;
        text-align: center;
        font-weight: 700;
        font-size: 12px;
        padding-top: 1px;
    }

    .log-msg {
        color: var(--text-secondary, #9898ad);
        word-break: break-all;
        min-width: 0;
    }

    /* ── Empty state ───────────────────────────────────────────────────────────── */
    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px 24px;
        text-align: center;
    }

    .empty-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary, #9898ad);
        margin-bottom: 6px;
    }

    .empty-sub {
        font-size: 12px;
        color: var(--text-muted, #5a5a72);
        line-height: 1.6;
        max-width: 340px;
    }

    /* ── Toggle label ──────────────────────────────────────────────────────────── */
    .toggle-label {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        color: var(--text-secondary, #9898ad);
        cursor: pointer;
        user-select: none;
    }

    .toggle-label input[type="checkbox"] {
        accent-color: var(--accent, #818cf8);
    }

    /* ── Shared controls ───────────────────────────────────────────────────────── */
    .input {
        padding: 6px 10px;
        font-size: 12px;
        font-family: inherit;
        border-radius: 6px;
        border: 1px solid var(--border, #1e1e2e);
        background: var(--surface-2, #12121a);
        color: var(--text-primary, #e2e2e8);
        outline: none;
        transition: border-color 0.15s;
    }

    .input:focus {
        border-color: var(--accent, #818cf8);
    }

    .input::placeholder {
        color: var(--text-muted, #5a5a72);
    }

    .btn-secondary {
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 500;
        font-family: inherit;
        border-radius: 6px;
        border: 1px solid var(--border, #1e1e2e);
        background: var(--surface-2, #12121a);
        color: var(--text-primary, #e2e2e8);
        cursor: pointer;
        transition:
            background 0.15s,
            border-color 0.15s;
        white-space: nowrap;
    }

    .btn-secondary:hover {
        background: var(--surface-3, #1a1a28);
        border-color: var(--accent, #818cf8);
    }

    .btn-secondary:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .btn-ghost {
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 500;
        font-family: inherit;
        border-radius: 6px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--text-secondary, #9898ad);
        cursor: pointer;
        transition:
            background 0.15s,
            color 0.15s;
        white-space: nowrap;
    }

    .btn-ghost:hover {
        background: var(--surface-2, #12121a);
        color: var(--text-primary, #e2e2e8);
    }

    .btn-ghost.danger {
        color: var(--status-error, #ef4444);
    }

    .btn-ghost.danger:hover {
        background: rgba(239, 68, 68, 0.1);
    }

    .btn-sm {
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 500;
        font-family: inherit;
        border-radius: 5px;
        border: 1px solid var(--border, #1e1e2e);
        background: var(--surface-2, #12121a);
        color: var(--text-primary, #e2e2e8);
        cursor: pointer;
        transition: background 0.15s;
    }

    .btn-sm:hover {
        background: var(--surface-3, #1a1a28);
    }

    .btn-sm:disabled {
        opacity: 0.35;
        cursor: not-allowed;
    }

    .muted {
        color: var(--text-muted, #5a5a72);
    }

    .mono {
        font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
    }

    /* ── Entropy pill (header badge) ─────────────────────────────────────── */

    .entropy-pill {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        height: 24px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 700;
        font-family: "JetBrains Mono", monospace;
        background: color-mix(in srgb, currentColor 10%, transparent);
        border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
        letter-spacing: 0.03em;
        transition: color 0.3s ease;
        white-space: nowrap;
        user-select: none;
    }

    /* ── Fingerprint score tab ────────────────────────────────────────────── */

    .fp-score-tab {
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        overflow-y: auto;
        max-width: 680px;
    }

    .fp-score-header {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--border-subtle, #1e1e2e);
    }

    .fp-score-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary, #e2e2e8);
        letter-spacing: 0.01em;
    }

    .fp-score-sub {
        font-size: 11.5px;
        color: var(--text-muted, #5a5a72);
    }

    /* ── Shannon entropy card ─────────────────────────────────────────────── */

    .shannon-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px 16px;
        background: var(--surface-2, #12121a);
        border: 1px solid var(--border-subtle, #1e1e2e);
        border-radius: 8px;
    }

    .shannon-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }

    .shannon-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary, #e2e2e8);
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }

    .shannon-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        font-family: "JetBrains Mono", monospace;
        letter-spacing: 0.06em;
    }

    .shannon-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .shannon-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
    }

    .shannon-label {
        font-size: 11px;
        color: var(--text-muted, #5a5a72);
        min-width: 130px;
        flex-shrink: 0;
    }

    .shannon-val {
        font-size: 12px;
        color: var(--text-primary, #e2e2e8);
    }

    .shannon-desc {
        font-size: 11px;
        color: var(--text-muted, #5a5a72);
        line-height: 1.6;
        margin: 0;
        padding-top: 4px;
        border-top: 1px solid var(--border-subtle, #1e1e2e);
    }

    /* ── Empty state ─────────────────────────────────────────────────────── */

    .empty-state {
        padding: 40px 20px;
        text-align: center;
        color: var(--text-muted, #5a5a72);
        font-size: 12px;
    }
</style>
