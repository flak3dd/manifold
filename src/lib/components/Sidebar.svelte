<script lang="ts">
    import { page } from "$app/stores";
    import { profileStore } from "$lib/stores/profiles.svelte";
    import { proxyStore } from "$lib/stores/proxy.svelte";
    import { bridgeStore } from "$lib/stores/bridge.svelte";
    import { appStore } from "$lib/stores/app.svelte";
    import { automationStore } from "$lib/stores/automation.svelte";
    import { urlTestStore } from "$lib/stores/urltest.svelte";
    import PanicButton from "$lib/components/PanicButton.svelte";

    let {
        onAddSource,
        onCreateProfile = () => {},
    }: {
        onAddSource: () => void;
        onCreateProfile?: () => void;
    } = $props();

    let stats          = $derived(profileStore.globalStats);
    let proxyCount     = $derived(proxyStore.proxies.length);
    let healthyCount   = $derived(proxyStore.healthyProxies.length);
    let rotatingCount  = $derived(proxyStore.proxies.filter(p => p.rotation_policy?.mode !== "manual").length);
    let bridgeConnected = $derived(bridgeStore.connected);
    let bridgeSession  = $derived(bridgeStore.sessionId);
    let currentPath    = $derived($page.url.pathname);
    let activeRun      = $derived(automationStore.activeRun);
    let urlTestRunning = $derived(urlTestStore.isRunning);

    const NAV: { href: string; label: string }[] = [
        { href: "/",            label: "Dashboard"   },
        { href: "/proxies",     label: "Proxies"    },
        { href: "/fingerprint", label: "Fingerprint" },
        { href: "/automation",  label: "Automation" },
        { href: "/url-test",    label: "URL Test"   },
        { href: "/trace",       label: "Trace"     },
    ];

    function isActive(href: string): boolean {
        if (href === "/") return currentPath === "/";
        return currentPath.startsWith(href);
    }
</script>

<header class="topbar">
    <!-- ── Left: wordmark ─────────────────────────────────────────── -->
    <div class="brand">
        <svg class="brand-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="3"  cy="8"  r="2.2" fill="var(--accent)" opacity="0.9"/>
            <circle cx="8"  cy="3"  r="1.6" fill="var(--accent)" opacity="0.6"/>
            <circle cx="13" cy="8"  r="1.6" fill="var(--accent)" opacity="0.6"/>
            <circle cx="8"  cy="13" r="1.6" fill="var(--accent)" opacity="0.6"/>
            <line x1="3"  y1="8"  x2="8"  y2="3"  stroke="var(--accent)" stroke-width="0.8" opacity="0.35"/>
            <line x1="3"  y1="8"  x2="13" y2="8"  stroke="var(--accent)" stroke-width="0.8" opacity="0.35"/>
            <line x1="3"  y1="8"  x2="8"  y2="13" stroke="var(--accent)" stroke-width="0.8" opacity="0.35"/>
        </svg>
        <span class="brand-name">MANIFOLD</span>
        <span class="brand-version">v0.9.3-beta</span>
    </div>

    <!-- ── Centre: nav tabs ───────────────────────────────────────── -->
    <nav class="nav">
        {#each NAV as item (item.href)}
            {@const active = isActive(item.href)}
            <a
                href={item.href}
                class="nav-item"
                class:active
            >
                {item.label}
                {#if item.href === "/trace" && bridgeSession}
                    <span class="nav-pip live">●</span>
                {/if}
                {#if item.href === "/proxies" && proxyCount > 0}
                    <span class="nav-pip neutral">{proxyCount}</span>
                {/if}
                {#if item.href === "/automation" && activeRun?.status === "running"}
                    <span class="nav-pip running">●</span>
                {/if}
                {#if item.href === "/url-test" && urlTestRunning}
                    <span class="nav-pip running">●</span>
                {/if}
            </a>
        {/each}
    </nav>

    <!-- ── Right: actions ─────────────────────────────────────────── -->
    <div class="topbar-actions">
        <PanicButton />
    </div>
</header>

<!-- ── Status bar ────────────────────────────────────────────────────── -->
<div class="statusbar">
    <div class="statusbar-left">
        <!-- Bridge / session -->
        <span class="status-item" class:on={bridgeConnected}>
            <span class="sdot" class:sdot-on={bridgeConnected}></span>
            {#if bridgeConnected && bridgeSession}
                Bridge · session active
            {:else if bridgeConnected}
                Bridge · connected
            {:else}
                Bridge · offline
            {/if}
        </span>

        <span class="sep">·</span>

        <!-- Proxy health -->
        <span class="status-item" class:on={healthyCount === proxyCount && proxyCount > 0}>
            <span
                class="sdot"
                class:sdot-on={healthyCount === proxyCount && proxyCount > 0}
                class:sdot-warn={healthyCount < proxyCount && healthyCount > 0}
                class:sdot-err={healthyCount === 0 && proxyCount > 0}
            ></span>
            {healthyCount}/{proxyCount} proxies healthy
            {#if rotatingCount > 0}
                · {rotatingCount} rotating
            {/if}
        </span>

        <span class="sep">·</span>

        <!-- Fingerprint DB -->
        <span class="status-item">
            <span class="sdot sdot-dim"></span>
            Fingerprint DB · {stats.profiles_total} vector{stats.profiles_total !== 1 ? "s" : ""}
        </span>
    </div>

    <div class="statusbar-right">
        {#if stats.profiles_running > 0}
            <span class="status-pill running">
                {stats.profiles_running} running
            </span>
        {/if}
        {#if stats.profiles_error > 0}
            <span class="status-pill error">
                {stats.profiles_error} error{stats.profiles_error !== 1 ? "s" : ""}
            </span>
        {/if}
    </div>
</div>

<style>
    /* ── Topbar ──────────────────────────────────────────────────── */

    .topbar {
        display: flex;
        align-items: center;
        gap: 0;
        height: 38px;
        padding: 0 16px;
        background: var(--surface-1);
        border-bottom: 1px solid var(--border-subtle);
        flex-shrink: 0;
        position: relative;
        z-index: 50;
    }

    /* ── Brand ───────────────────────────────────────────────────── */

    .brand {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-right: 28px;
        flex-shrink: 0;
    }

    .brand-icon {
        flex-shrink: 0;
        opacity: 0.9;
    }

    .brand-name {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.18em;
        color: var(--text-primary);
    }

    .brand-version {
        font-size: 10px;
        color: var(--text-muted);
        font-family: 'JetBrains Mono', monospace;
        letter-spacing: 0.04em;
    }

    /* ── Nav ─────────────────────────────────────────────────────── */

    .nav {
        display: flex;
        align-items: stretch;
        flex: 1;
        height: 100%;
        gap: 0;
    }

    .nav-item {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 0 14px;
        font-size: 12px;
        font-weight: 500;
        color: var(--text-muted);
        text-decoration: none;
        border-bottom: 2px solid transparent;
        transition: color 0.12s, border-color 0.12s;
        letter-spacing: 0.01em;
        white-space: nowrap;
        position: relative;
    }

    .nav-item:hover {
        color: var(--text-secondary);
        text-decoration: none;
    }

    .nav-item.active {
        color: var(--text-primary);
        border-bottom-color: var(--accent);
    }

    /* ── Nav pips (badges) ───────────────────────────────────────── */

    .nav-pip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 14px;
        padding: 0 4px;
        border-radius: 99px;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0;
    }

    .nav-pip.running {
        background: var(--accent-glow-md);
        color: var(--accent);
    }

    .nav-pip.live {
        background: transparent;
        color: var(--success);
        font-size: 8px;
        animation: pulse-dot 2s ease-in-out infinite;
    }

    .nav-pip.neutral {
        background: var(--surface-4);
        color: var(--text-muted);
    }

    /* ── Right actions ───────────────────────────────────────────── */

    .topbar-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
        flex-shrink: 0;
    }

    /* ── Status bar ──────────────────────────────────────────────── */

    .statusbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 24px;
        padding: 0 16px;
        background: var(--surface-1);
        border-bottom: 1px solid var(--border-subtle);
        flex-shrink: 0;
        font-size: 10px;
        color: var(--text-muted);
        letter-spacing: 0.02em;
    }

    .statusbar-left,
    .statusbar-right {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .sep {
        color: var(--border-hover);
        user-select: none;
    }

    .status-item {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: color 0.15s;
    }

    .status-item.on {
        color: var(--text-secondary);
    }

    /* ── Status dots ─────────────────────────────────────────────── */

    .sdot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--surface-5);
        flex-shrink: 0;
    }

    .sdot-on {
        background: var(--accent);
        box-shadow: 0 0 4px var(--accent-glow-md);
    }

    .sdot-warn {
        background: var(--warning);
    }

    .sdot-err {
        background: var(--error);
    }

    .sdot-dim {
        background: var(--text-faint);
    }

    /* ── Status pills ────────────────────────────────────────────── */

    .status-pill {
        display: inline-flex;
        align-items: center;
        padding: 1px 7px;
        border-radius: 99px;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.02em;
    }

    .status-pill.running {
        background: var(--accent-glow);
        color: var(--accent);
    }

    .status-pill.error {
        background: var(--error-glow);
        color: var(--error);
    }

    @keyframes pulse-dot {
        0%, 100% { opacity: 1; }
        50%       { opacity: 0.35; }
    }
</style>
