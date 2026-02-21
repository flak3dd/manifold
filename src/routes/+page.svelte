<script lang="ts">
    import { onMount } from "svelte";
    import { profileStore } from "$lib/stores/profiles.svelte";
    import { proxyStore } from "$lib/stores/proxy.svelte";
    import { bridgeStore } from "$lib/stores/bridge.svelte";
    import { appStore } from "$lib/stores/app.svelte";
    import type { Profile } from "$lib/types";

    // ── Derived state ────────────────────────────────────────────────────────
    let stats = $derived(profileStore.globalStats);
    let profiles = $derived(profileStore.profiles);
    let filteredProfiles = $derived(profileStore.filteredProfiles);
    let proxies = $derived(proxyStore.proxies);
    let healthyProxies = $derived(proxyStore.healthyProxies);
    let unhealthyProxies = $derived(proxyStore.unhealthyProxies);
    let proxiesByCountry = $derived(proxyStore.proxiesByCountry);
    let bridgeConnected = $derived(bridgeStore.connected);
    let bridgeSession = $derived(bridgeStore.sessionId);
    let bridgeUrl = $derived(bridgeStore.currentUrl);
    let riskScore = $derived(bridgeStore.riskScore);
    let harEntries = $derived(bridgeStore.harEntries);
    let scraperConnected = $derived(appStore.wsConnected);
    let sources = $derived(appStore.sources);
    let loading = $derived(profileStore.loading);

    let runningProfiles = $derived(
        profiles.filter((p) => p.status === "running"),
    );
    let recentProfiles = $derived(
        [...profiles]
            .sort((a, b) => {
                const aTime = a.last_used ?? a.created_at;
                const bTime = b.last_used ?? b.created_at;
                return bTime.localeCompare(aTime);
            })
            .slice(0, 6),
    );
    let errorProfiles = $derived(profiles.filter((p) => p.status === "error"));

    // ── Actions ──────────────────────────────────────────────────────────────
    async function handleLaunch(profile: Profile) {
        try {
            await profileStore.launchProfile(profile.id);
        } catch (e) {
            console.error("Launch failed:", e);
        }
    }

    async function handleStop(profile: Profile) {
        try {
            await profileStore.stopProfile(profile.id);
        } catch (e) {
            console.error("Stop failed:", e);
        }
    }

    async function handleCheckAllProxies() {
        try {
            await proxyStore.checkAllProxies();
        } catch (e) {
            console.error("Proxy check failed:", e);
        }
    }

    function riskColor(score: number | null): string {
        if (score === null) return "var(--text-muted)";
        if (score < 25) return "var(--success)";
        if (score < 50) return "var(--warning)";
        return "var(--error)";
    }

    function riskLabel(score: number | null): string {
        if (score === null) return "N/A";
        if (score < 25) return "Low";
        if (score < 50) return "Medium";
        if (score < 75) return "High";
        return "Critical";
    }

    function statusColor(status: string): string {
        switch (status) {
            case "running":
                return "var(--accent)";
            case "error":
                return "var(--error)";
            default:
                return "var(--text-muted)";
        }
    }

    function formatTime(ts: string | null | undefined): string {
        if (!ts) return "Never";
        const d = new Date(ts);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 60) return `${diffSec}s ago`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        return d.toLocaleDateString();
    }

    function truncate(s: string, max = 50): string {
        if (s.length <= max) return s;
        return s.slice(0, max - 1) + "…";
    }
</script>

<div class="page">
    <!-- ── Header ── -->
    <div class="page-header">
        <div class="header-left">
            <h1 class="page-title">Dashboard</h1>
            <span class="subtitle">
                {profiles.length} profile{profiles.length !== 1 ? "s" : ""}
                · {proxies.length} prox{proxies.length !== 1 ? "ies" : "y"}
                · {sources.length} source{sources.length !== 1 ? "s" : ""}
            </span>
        </div>
        <div class="header-actions">
            <a href="/profiles" class="btn-secondary">
                <svg
                    width="13"
                    height="13"
                    viewBox="0 0 13 13"
                    fill="none"
                    aria-hidden="true"
                >
                    <circle
                        cx="6.5"
                        cy="4.5"
                        r="2.5"
                        stroke="currentColor"
                        stroke-width="1.3"
                    />
                    <path
                        d="M2 12c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"
                        stroke="currentColor"
                        stroke-width="1.3"
                        stroke-linecap="round"
                    />
                </svg>
                Manage Profiles
            </a>
            <a href="/proxies" class="btn-secondary">
                <svg
                    width="13"
                    height="13"
                    viewBox="0 0 13 13"
                    fill="none"
                    aria-hidden="true"
                >
                    <circle
                        cx="6.5"
                        cy="6.5"
                        r="5"
                        stroke="currentColor"
                        stroke-width="1.3"
                    />
                    <path
                        d="M1.5 6.5h10M6.5 1.5c-1.5 1.5-1.5 8.5 0 10M6.5 1.5c1.5 1.5 1.5 8.5 0 10"
                        stroke="currentColor"
                        stroke-width="1"
                    />
                </svg>
                Manage Proxies
            </a>
        </div>
    </div>

    <!-- ── Body ── -->
    <div class="body">
        <!-- ════════ TOP STAT CARDS ════════ -->
        <div class="stat-row">
            <div class="stat-card">
                <div class="stat-icon profiles-icon">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <circle
                            cx="10"
                            cy="7"
                            r="3.5"
                            stroke="currentColor"
                            stroke-width="1.5"
                        />
                        <path
                            d="M3 18c0-3.5 3-6 7-6s7 2.5 7 6"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />
                    </svg>
                </div>
                <div class="stat-body">
                    <span class="stat-number">{stats.profiles_total}</span>
                    <span class="stat-label">Total Profiles</span>
                </div>
            </div>

            <div class="stat-card">
                <div class="stat-icon running-icon">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path
                            d="M6 4l10 6-10 6V4z"
                            fill="currentColor"
                            opacity="0.8"
                        />
                    </svg>
                </div>
                <div class="stat-body">
                    <span class="stat-number accent"
                        >{stats.profiles_running}</span
                    >
                    <span class="stat-label">Running</span>
                </div>
            </div>

            <div class="stat-card">
                <div
                    class="stat-icon proxy-icon"
                    class:healthy-icon={healthyProxies.length ===
                        proxies.length && proxies.length > 0}
                >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <circle
                            cx="10"
                            cy="10"
                            r="7.5"
                            stroke="currentColor"
                            stroke-width="1.5"
                        />
                        <path
                            d="M2.5 10h15M10 2.5c-2.5 2.5-2.5 12.5 0 15M10 2.5c2.5 2.5 2.5 12.5 0 15"
                            stroke="currentColor"
                            stroke-width="1.2"
                        />
                    </svg>
                </div>
                <div class="stat-body">
                    <span class="stat-number"
                        >{healthyProxies.length}<span class="stat-of"
                            >/{proxies.length}</span
                        ></span
                    >
                    <span class="stat-label">Proxies Healthy</span>
                </div>
            </div>

            <div class="stat-card">
                <div
                    class="stat-icon bridge-icon"
                    class:connected-icon={bridgeConnected}
                >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path
                            d="M3 14l4-5 4 3 4-7 2 3"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                        {#if bridgeConnected}
                            <circle cx="17" cy="8" r="2" fill="currentColor" />
                        {/if}
                    </svg>
                </div>
                <div class="stat-body">
                    <span class="stat-number"
                        >{bridgeConnected ? "Online" : "Offline"}</span
                    >
                    <span class="stat-label">Bridge</span>
                </div>
            </div>
        </div>

        <!-- ════════ MAIN GRID ════════ -->
        <div class="main-grid">
            <!-- ── Running Profiles Panel ── -->
            <div class="panel running-panel">
                <div class="panel-header">
                    <span class="panel-title">Active Sessions</span>
                    {#if runningProfiles.length > 0}
                        <span class="panel-badge accent"
                            >{runningProfiles.length} running</span
                        >
                    {/if}
                </div>
                <div class="panel-body">
                    {#if runningProfiles.length === 0}
                        <div class="empty-mini">
                            <p class="empty-text">
                                No profiles are currently running.
                            </p>
                            <p class="empty-hint">
                                Launch a profile from the <a href="/profiles"
                                    >Profiles</a
                                > page or the sidebar.
                            </p>
                        </div>
                    {:else}
                        <div class="profile-list">
                            {#each runningProfiles as profile (profile.id)}
                                <div class="profile-row running-row">
                                    <div class="profile-info">
                                        <span class="profile-status-dot running"
                                        ></span>
                                        <span class="profile-name"
                                            >{profile.name}</span
                                        >
                                        <span class="profile-seed mono"
                                            >{profile.fingerprint.seed
                                                .toString(16)
                                                .slice(0, 6)
                                                .toUpperCase()}</span
                                        >
                                    </div>
                                    <div class="profile-actions">
                                        <a
                                            href="/trace"
                                            class="mini-btn trace"
                                            title="View trace"
                                        >
                                            📊
                                        </a>
                                        <button
                                            class="mini-btn stop"
                                            title="Stop session"
                                            onclick={() => handleStop(profile)}
                                        >
                                            ■
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>

            <!-- ── Live Session Panel ── -->
            <div class="panel session-panel">
                <div class="panel-header">
                    <span class="panel-title">Live Session</span>
                    {#if bridgeSession}
                        <a href="/trace" class="panel-link">Open Trace →</a>
                    {/if}
                </div>
                <div class="panel-body">
                    {#if bridgeConnected && bridgeSession}
                        <div class="session-info">
                            <div class="session-row">
                                <span class="session-key">Session</span>
                                <span class="session-val mono"
                                    >{bridgeSession.slice(0, 12)}</span
                                >
                            </div>
                            <div class="session-row">
                                <span class="session-key">URL</span>
                                <span class="session-val mono"
                                    >{truncate(bridgeUrl, 40)}</span
                                >
                            </div>
                            <div class="session-row">
                                <span class="session-key">Requests</span>
                                <span class="session-val"
                                    >{harEntries.length}</span
                                >
                            </div>
                            <div class="session-row">
                                <span class="session-key">Risk Score</span>
                                <span
                                    class="session-val"
                                    style:color={riskColor(riskScore)}
                                >
                                    {riskScore ?? "—"} · {riskLabel(riskScore)}
                                </span>
                            </div>
                        </div>
                    {:else}
                        <div class="empty-mini">
                            <div class="bridge-status-icon">
                                <span
                                    class="bridge-dot"
                                    class:on={bridgeConnected}
                                ></span>
                            </div>
                            <p class="empty-text">
                                {bridgeConnected
                                    ? "Bridge connected — no active session"
                                    : "Bridge is offline"}
                            </p>
                            <p class="empty-hint">
                                Launch a profile to start a live session with
                                trace and entropy monitoring.
                            </p>
                        </div>
                    {/if}
                </div>
            </div>

            <!-- ── Recent Profiles Panel ── -->
            <div class="panel recent-panel">
                <div class="panel-header">
                    <span class="panel-title">Recent Profiles</span>
                    <a href="/profiles" class="panel-link"
                        >View All ({profiles.length}) →</a
                    >
                </div>
                <div class="panel-body">
                    {#if loading}
                        <div class="empty-mini">
                            <p class="empty-text">Loading profiles…</p>
                        </div>
                    {:else if profiles.length === 0}
                        <div class="empty-mini">
                            <p class="empty-text">No profiles yet.</p>
                            <p class="empty-hint">
                                Create your first profile using the sidebar
                                button to get started.
                            </p>
                        </div>
                    {:else}
                        <div class="profile-list">
                            {#each recentProfiles as profile (profile.id)}
                                <div class="profile-row">
                                    <div class="profile-info">
                                        <span
                                            class="profile-status-dot"
                                            style:background={statusColor(
                                                profile.status,
                                            )}
                                        ></span>
                                        <span class="profile-name"
                                            >{truncate(profile.name, 28)}</span
                                        >
                                        <span class="profile-meta"
                                            >{formatTime(
                                                profile.last_used ??
                                                    profile.created_at,
                                            )}</span
                                        >
                                    </div>
                                    <div class="profile-actions">
                                        <a
                                            href="/fingerprint"
                                            class="mini-btn"
                                            title="Edit fingerprint"
                                        >
                                            🔧
                                        </a>
                                        {#if profile.status === "running"}
                                            <button
                                                class="mini-btn stop"
                                                title="Stop"
                                                onclick={() =>
                                                    handleStop(profile)}
                                            >
                                                ■
                                            </button>
                                        {:else}
                                            <button
                                                class="mini-btn launch"
                                                title="Launch"
                                                onclick={() =>
                                                    handleLaunch(profile)}
                                            >
                                                ▶
                                            </button>
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>

            <!-- ── Proxy Health Panel ── -->
            <div class="panel proxy-panel">
                <div class="panel-header">
                    <span class="panel-title">Proxy Health</span>
                    <div class="panel-header-actions">
                        <button
                            class="panel-btn"
                            onclick={handleCheckAllProxies}
                            disabled={proxyStore.checkingAll ||
                                proxies.length === 0}
                            title="Health check all proxies"
                        >
                            {proxyStore.checkingAll ? "Checking…" : "Check All"}
                        </button>
                        <a href="/proxies" class="panel-link">Manage →</a>
                    </div>
                </div>
                <div class="panel-body">
                    {#if proxies.length === 0}
                        <div class="empty-mini">
                            <p class="empty-text">No proxies configured.</p>
                            <p class="empty-hint">
                                Add proxies from the <a href="/proxies"
                                    >Proxies</a
                                > page.
                            </p>
                        </div>
                    {:else}
                        <div class="proxy-summary">
                            <div class="proxy-bar-track">
                                <div
                                    class="proxy-bar-fill healthy"
                                    style:width="{(healthyProxies.length /
                                        proxies.length) *
                                        100}%"
                                ></div>
                                <div
                                    class="proxy-bar-fill unhealthy"
                                    style:width="{(unhealthyProxies.length /
                                        proxies.length) *
                                        100}%"
                                ></div>
                            </div>
                            <div class="proxy-stats-row">
                                <span class="proxy-stat healthy-stat">
                                    <span class="stat-dot healthy"></span>
                                    {healthyProxies.length} healthy
                                </span>
                                {#if unhealthyProxies.length > 0}
                                    <span class="proxy-stat unhealthy-stat">
                                        <span class="stat-dot unhealthy"></span>
                                        {unhealthyProxies.length} unhealthy
                                    </span>
                                {/if}
                            </div>

                            {#if proxiesByCountry instanceof Map && proxiesByCountry.size > 0}
                                <div class="country-chips">
                                    {#each [...proxiesByCountry.entries()].slice(0, 8) as [cc, pxs]}
                                        <span class="country-chip">
                                            <span class="country-code"
                                                >{cc}</span
                                            >
                                            <span class="country-count"
                                                >{pxs.length}</span
                                            >
                                        </span>
                                    {/each}
                                </div>
                            {/if}
                        </div>

                        <div class="proxy-list">
                            {#each proxies.slice(0, 5) as proxy (proxy.id)}
                                <div
                                    class="proxy-row"
                                    class:unhealthy={!proxy.healthy}
                                >
                                    <span
                                        class="proxy-dot"
                                        class:healthy={proxy.healthy}
                                    ></span>
                                    <span class="proxy-name"
                                        >{truncate(proxy.name, 24)}</span
                                    >
                                    <span class="proxy-type mono"
                                        >{proxy.proxy_type}</span
                                    >
                                    <span class="proxy-latency mono">
                                        {proxy.latency_ms != null
                                            ? `${proxy.latency_ms}ms`
                                            : "—"}
                                    </span>
                                </div>
                            {/each}
                            {#if proxies.length > 5}
                                <a href="/proxies" class="more-link"
                                    >+{proxies.length - 5} more…</a
                                >
                            {/if}
                        </div>
                    {/if}
                </div>
            </div>

            <!-- ── Errors Panel ── -->
            {#if errorProfiles.length > 0}
                <div class="panel error-panel">
                    <div class="panel-header">
                        <span class="panel-title error-title"
                            >⚠ Errors ({errorProfiles.length})</span
                        >
                    </div>
                    <div class="panel-body">
                        <div class="profile-list">
                            {#each errorProfiles as profile (profile.id)}
                                <div class="profile-row error-row">
                                    <div class="profile-info">
                                        <span class="profile-status-dot error"
                                        ></span>
                                        <span class="profile-name"
                                            >{profile.name}</span
                                        >
                                    </div>
                                    <div class="profile-actions">
                                        <button
                                            class="mini-btn launch"
                                            title="Retry launch"
                                            onclick={() =>
                                                handleLaunch(profile)}
                                        >
                                            ↻
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    </div>
                </div>
            {/if}

            <!-- ── Scraper Sources Panel ── -->
            <div class="panel sources-panel">
                <div class="panel-header">
                    <span class="panel-title">Scraper Sources</span>
                    <span class="panel-badge" class:on={scraperConnected}>
                        <span class="mini-dot"></span>
                        {scraperConnected ? "Connected" : "Offline"}
                    </span>
                </div>
                <div class="panel-body">
                    {#if sources.length === 0}
                        <div class="empty-mini">
                            <p class="empty-text">No scraper sources.</p>
                            <p class="empty-hint">
                                Add sources from the sidebar to monitor web
                                pages.
                            </p>
                        </div>
                    {:else}
                        <div class="source-list">
                            {#each sources.slice(0, 5) as source (source.id)}
                                <div class="source-row">
                                    <span
                                        class="source-dot"
                                        class:ok={source.status === "success"}
                                        class:err={source.status === "error"}
                                        class:scraping={source.status ===
                                            "scraping"}
                                    ></span>
                                    <span class="source-name"
                                        >{truncate(source.name, 22)}</span
                                    >
                                    <span class="source-url mono"
                                        >{truncate(source.url, 30)}</span
                                    >
                                </div>
                            {/each}
                            {#if sources.length > 5}
                                <button
                                    class="more-link"
                                    onclick={() => {
                                        appStore.selectedSourceId = null;
                                    }}
                                >
                                    +{sources.length - 5} more…
                                </button>
                            {/if}
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    /* ── Page shell ── */
    .page {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        background: var(--bg, #080808);
        color: var(--text-primary, #f4f4f5);
    }

    .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 28px 14px;
        border-bottom: 1px solid var(--border, #2a2a2a);
        flex-shrink: 0;
        gap: 16px;
        flex-wrap: wrap;
    }

    .header-left {
        display: flex;
        align-items: baseline;
        gap: 12px;
        min-width: 0;
    }

    .page-title {
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.03em;
    }

    .subtitle {
        font-size: 12px;
        color: var(--text-muted, #52525b);
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .body {
        flex: 1;
        overflow-y: auto;
        padding: 20px 28px 32px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    /* ── Stat row ── */
    .stat-row {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
    }

    .stat-card {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 16px 18px;
        background: var(--surface-1, #0f0f0f);
        border: 1px solid var(--border, #2a2a2a);
        border-radius: 10px;
        transition: border-color 0.15s;
    }

    .stat-card:hover {
        border-color: var(--border-hover, #3d3d3d);
    }

    .stat-icon {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background: var(--surface-3, #1e1e1e);
        color: var(--text-secondary, #a1a1aa);
    }

    .stat-icon.running-icon {
        background: rgba(99, 102, 241, 0.12);
        color: var(--accent, #818cf8);
    }

    .stat-icon.healthy-icon {
        background: rgba(74, 222, 128, 0.1);
        color: var(--success, #4ade80);
    }

    .stat-icon.connected-icon {
        background: rgba(74, 222, 128, 0.1);
        color: var(--success, #4ade80);
    }

    .stat-body {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
    }

    .stat-number {
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.03em;
        color: var(--text-primary, #f4f4f5);
        line-height: 1.2;
    }

    .stat-number.accent {
        color: var(--accent, #818cf8);
    }

    .stat-of {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-muted, #52525b);
    }

    .stat-label {
        font-size: 11px;
        color: var(--text-muted, #52525b);
        font-weight: 500;
        letter-spacing: 0.01em;
    }

    /* ── Main grid ── */
    .main-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
    }

    .panel {
        background: var(--surface-1, #0f0f0f);
        border: 1px solid var(--border, #2a2a2a);
        border-radius: 10px;
        overflow: hidden;
    }

    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border, #2a2a2a);
        gap: 10px;
    }

    .panel-header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .panel-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary, #a1a1aa);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
</style>
