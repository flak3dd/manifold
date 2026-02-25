<script lang="ts">
    import { onMount } from "svelte";
    import {
        proxyStore,
        latencyLabel,
        latencyColor,
        proxyServerUrl,
        parseProxyConnectionString,
    } from "$lib/stores/proxy.svelte";
    import type { Proxy, AddProxyPayload } from "$lib/types";

    // ── Local UI state ─────────────────────────────────────────────────────────
    let showAddPanel = $state(false);
    let showBdPanel = $state(false);
    let editingId = $state<string | null>(null);
    let confirmDeleteId = $state<string | null>(null);

    // Add/edit form
    let formName = $state("");
    let formType = $state<"http" | "https" | "socks5">("http");
    let formHost = $state("");
    let formPort = $state(8080);
    let formUser = $state("");
    let formPass = $state("");
    let formCountry = $state("");
    let formError = $state("");
    let formSaving = $state(false);

    // Quick-add connection string (host:port:username:password)
    let quickAddInput = $state("");
    let quickAddError = $state("");
    let quickAddSaving = $state(false);
    let quickAddBulkOpen = $state(false);
    let bulkAddInput = $state("");
    let bulkAddSaving = $state(false);
    let bulkAddResult = $state<{
        added: number;
        failed: number;
        failedLines: { line: string; error: string }[];
    } | null>(null);

    // BrightData form
    let bdCustomer = $state("");
    let bdZone = $state("");
    let bdCountry = $state("");
    let bdMode = $state<"sticky" | "rotating">("rotating");
    let bdPassword = $state("");
    let bdAdding = $state(false);
    let bdError = $state("");

    // Rotation policy (global)
    let rotMode = $state<"manual" | "interval" | "on_ban">("manual");
    let rotInterval = $state(10);

    // ── Lifecycle ──────────────────────────────────────────────────────────────
    onMount(() => {
        const w = window as any;
        tauriAvailable =
            !!w?.__TAURI_INTERNALS__ ||
            !!w?.__TAURI__ ||
            (typeof navigator !== "undefined" &&
                navigator.userAgent.toLowerCase().includes("tauri"));
        proxyStore.loadProxies();
    });

    // ── Derived ───────────────────────────────────────────────────────────────
    let proxies = $derived(proxyStore.proxies);
    let healthResults = $derived(proxyStore.healthResults);
    let checking = $derived(proxyStore.checking);
    let checkingAll = $derived(proxyStore.checkingAll);
    let healthyCount = $derived(proxyStore.healthyProxies.length);
    let unhealthyCount = $derived(proxyStore.unhealthyProxies.length);
    let tauriAvailable = $state(false);

    // ── Helpers ────────────────────────────────────────────────────────────────
    function openAdd() {
        editingId = null;
        formName = "";
        formType = "http";
        formHost = "";
        formPort = 8080;
        formUser = "";
        formPass = "";
        formCountry = "";
        formError = "";
        showAddPanel = true;
        showBdPanel = false;
    }

    function openEdit(proxy: Proxy) {
        editingId = proxy.id;
        formName = proxy.name;
        formType = proxy.proxy_type as "http" | "https" | "socks5";
        formHost = proxy.host;
        formPort = proxy.port;
        formUser = proxy.username ?? "";
        formPass = "";
        formCountry = proxy.country ?? "";
        formError = "";
        showAddPanel = true;
        showBdPanel = false;
    }

    function closePanel() {
        showAddPanel = false;
        showBdPanel = false;
        editingId = null;
        formError = "";
        bdError = "";
    }

    async function handleSave() {
        if (!formName.trim()) {
            formError = "Name is required";
            return;
        }
        if (!formHost.trim()) {
            formError = "Host is required";
            return;
        }
        if (!formPort || formPort < 1 || formPort > 65535) {
            formError = "Port must be 1–65535";
            return;
        }
        formError = "";
        formSaving = true;
        try {
            const payload: AddProxyPayload = {
                name: formName.trim(),
                proxy_type: formType,
                host: formHost.trim(),
                port: formPort,
                username: formUser.trim() || undefined,
                password: formPass.trim() || undefined,
                country: formCountry.trim() || undefined,
            };
            if (editingId) {
                await proxyStore.updateProxy(editingId, payload);
            } else {
                await proxyStore.addProxy(payload);
            }
            closePanel();
        } catch (e) {
            formError = String(e);
        } finally {
            formSaving = false;
        }
    }

    async function handleBdAdd() {
        if (!bdCustomer.trim()) {
            bdError = "Customer ID required";
            return;
        }
        if (!bdZone.trim()) {
            bdError = "Zone required";
            return;
        }
        if (!bdPassword.trim()) {
            bdError = "Password required";
            return;
        }
        bdError = "";
        bdAdding = true;
        try {
            const cfg = {
                customer_id: bdCustomer.trim(),
                zone: bdZone.trim(),
                country: bdCountry.trim(),
                mode: bdMode,
                password: bdPassword.trim(),
            };
            if (bdMode === "sticky") {
                await proxyStore.addBrightDataSticky(cfg);
            } else {
                await proxyStore.addBrightDataRotating(cfg);
            }
            bdCustomer = "";
            bdZone = "";
            bdCountry = "";
            bdPassword = "";
            closePanel();
        } catch (e) {
            bdError = String(e);
        } finally {
            bdAdding = false;
        }
    }

    async function handleDelete(id: string) {
        await proxyStore.deleteProxy(id);
        confirmDeleteId = null;
    }

    function healthFor(id: string) {
        return healthResults[id] ?? null;
    }

    function countryFlag(cc: string | null): string {
        if (!cc || cc.length !== 2) return "🌐";
        const base = 0x1f1e0;
        const a = cc.toUpperCase().charCodeAt(0) - 65;
        const b = cc.toUpperCase().charCodeAt(1) - 65;
        return String.fromCodePoint(base + a) + String.fromCodePoint(base + b);
    }

    function typeColor(t: string) {
        if (t === "socks5") return "var(--accent)";
        if (t === "https") return "var(--success)";
        return "var(--text-muted)";
    }

    function applyGlobalRotation() {
        proxyStore.configureGlobalRotator(
            proxies.map((p) => p.id),
            rotMode,
            rotMode === "interval" ? rotInterval : undefined,
        );
    }

    async function handleQuickAdd() {
        if (!tauriAvailable) {
            quickAddError =
                "Tauri unavailable. Launch the app via `npm run tauri dev` (or run the .exe) to add proxies.";
            return;
        }
        const raw = quickAddInput.trim();
        if (!raw) {
            quickAddError = "Paste a connection string";
            return;
        }
        const payload = parseProxyConnectionString(raw);
        if (!payload) {
            quickAddError =
                "Use format host:port:username:password (e.g. proxy.example.com:1080:USERNAME:PASSWORD)";
            return;
        }
        quickAddError = "";
        quickAddSaving = true;
        try {
            await proxyStore.addProxyFromConnectionString(raw);
            quickAddInput = "";
        } catch (e) {
            quickAddError = String(e);
        } finally {
            quickAddSaving = false;
        }
    }

    async function handleBulkAdd() {
        if (!tauriAvailable) {
            bulkAddResult = null;
            quickAddError =
                "Tauri unavailable. Launch the app via `npm run tauri dev` (or run the .exe) to add proxies.";
            return;
        }
        const raw = bulkAddInput.trim();
        if (!raw) {
            bulkAddResult = null;
            quickAddError = "Paste one proxy per line";
            return;
        }
        quickAddError = "";
        bulkAddSaving = true;
        bulkAddResult = null;
        try {
            const lines = raw
                .split(/\r?\n/g)
                .map((l) => l.trim())
                .filter(Boolean);
            const { added, failed } =
                await proxyStore.addProxiesFromConnectionStrings(lines);
            bulkAddResult = {
                added: added.length,
                failed: failed.length,
                failedLines: failed.slice(0, 10), // keep UI small
            };
            if (failed.length === 0) {
                bulkAddInput = "";
                quickAddBulkOpen = false;
            }
        } catch (e) {
            quickAddError = String(e);
        } finally {
            bulkAddSaving = false;
        }
    }
</script>

<!-- ── Page ──────────────────────────────────────────────────────────────────── -->
<div class="page">
    <!-- ── Header ──────────────────────────────────────────────────────────────── -->
    <div class="page-header">
        <div class="header-left">
            <h1 class="page-title">Proxies</h1>
            <div class="header-pills">
                <span class="pill green">{healthyCount} healthy</span>
                {#if unhealthyCount > 0}
                    <span class="pill red">{unhealthyCount} down</span>
                {/if}
                <span class="pill">{proxies.length} total</span>
            </div>
        </div>
        <div class="header-actions">
            <button
                class="btn-secondary"
                disabled={checkingAll || proxies.length === 0}
                onclick={() => proxyStore.checkAllProxies()}
            >
                {#if checkingAll}
                    <svg
                        class="spin"
                        width="13"
                        height="13"
                        viewBox="0 0 13 13"
                        fill="none"
                    >
                        <circle
                            cx="6.5"
                            cy="6.5"
                            r="5"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-dasharray="8 12"
                        />
                    </svg>
                {:else}
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                        <path
                            d="M2 6.5A4.5 4.5 0 0 1 11 4.3"
                            stroke="currentColor"
                            stroke-width="1.6"
                            stroke-linecap="round"
                        />
                        <path
                            d="M9 2l2 2.3-2.3 2"
                            stroke="currentColor"
                            stroke-width="1.6"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    </svg>
                {/if}
                Check All
            </button>
            <button
                class="btn-secondary"
                onclick={() => {
                    showBdPanel = true;
                    showAddPanel = false;
                }}
            >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <rect
                        x="1"
                        y="1"
                        width="11"
                        height="11"
                        rx="2"
                        stroke="currentColor"
                        stroke-width="1.4"
                    />
                    <path
                        d="M4 6.5h5M6.5 4v5"
                        stroke="currentColor"
                        stroke-width="1.4"
                        stroke-linecap="round"
                    />
                </svg>
                BrightData
            </button>
            <button class="btn-primary" onclick={openAdd}>
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path
                        d="M6.5 1v11M1 6.5h11"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                    />
                </svg>
                Add Proxy
            </button>
        </div>
    </div>

    <!-- ── Quick add: host:port:username:password ───────────────────────────────── -->
    <div class="quick-add-bar">
        {#if !tauriAvailable}
            <span class="quick-add-error"
                >Desktop runtime not detected. Open Manifold via `npm run tauri
                dev` or the built `.exe` to add/check proxies.</span
            >
        {/if}
        <input
            type="text"
            class="quick-add-input"
            placeholder="host:port:username:password (e.g. proxy.example.com:1080:USERNAME:PASSWORD)"
            bind:value={quickAddInput}
            onkeydown={(e) => e.key === "Enter" && handleQuickAdd()}
            disabled={quickAddSaving || !tauriAvailable}
        />
        <button
            class="btn-secondary quick-add-btn"
            onclick={handleQuickAdd}
            disabled={
                !tauriAvailable || quickAddSaving || !quickAddInput.trim()
            }
        >
            {quickAddSaving ? "Adding…" : "Quick add"}
        </button>
        <button
            class="btn-secondary quick-add-btn"
            onclick={() => {
                quickAddBulkOpen = !quickAddBulkOpen;
                bulkAddResult = null;
            }}
            disabled={!tauriAvailable || bulkAddSaving}
            title="Paste multiple proxies, one per line"
        >
            {quickAddBulkOpen ? "Close bulk" : "Bulk add"}
        </button>
        {#if quickAddError}
            <span class="quick-add-error">{quickAddError}</span>
        {/if}
        {#if quickAddBulkOpen}
            <div class="bulk-add-wrap">
                <textarea
                    class="bulk-add-textarea mono"
                    placeholder="One proxy per line:\nproxy.example.com:1080:USERNAME:PASSWORD\nproxy.example.com:1080:USERNAME:PASSWORD"
                    bind:value={bulkAddInput}
                    disabled={!tauriAvailable || bulkAddSaving}
                ></textarea>
                <div class="bulk-add-actions">
                    <button
                        class="btn-secondary"
                        onclick={() => {
                            bulkAddInput = "";
                            bulkAddResult = null;
                            quickAddError = "";
                        }}
                        disabled={bulkAddSaving}
                    >
                        Clear
                    </button>
                    <button
                        class="btn-primary"
                        onclick={handleBulkAdd}
                        disabled={
                            bulkAddSaving || !tauriAvailable || !bulkAddInput.trim()
                        }
                    >
                        {bulkAddSaving ? "Adding…" : "Add all"}
                    </button>
                </div>
                {#if bulkAddResult}
                    <div class="bulk-add-result">
                        <span class="muted"
                            >Added: {bulkAddResult.added} · Failed:
                            {bulkAddResult.failed}</span
                        >
                        {#if bulkAddResult.failedLines.length > 0}
                            <div class="bulk-add-failures">
                                {#each bulkAddResult.failedLines as f}
                                    <div class="bulk-add-failure mono">
                                        {f.line} → {f.error}
                                    </div>
                                {/each}
                                {#if bulkAddResult.failed > bulkAddResult.failedLines.length}
                                    <div class="muted">
                                        (+{bulkAddResult.failed -
                                            bulkAddResult.failedLines.length}
                                        more)
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}
    </div>

    <!-- ── Body ────────────────────────────────────────────────────────────────── -->
    <div class="body">
        <!-- ── Left: proxy list ──────────────────────────────────────────────────── -->
        <div class="proxy-col">
            {#if proxyStore.loading}
                <div class="empty-state">
                    <span class="muted">Loading…</span>
                </div>
            {:else if proxies.length === 0}
                <div class="empty-state">
                    <svg
                        width="40"
                        height="40"
                        viewBox="0 0 40 40"
                        fill="none"
                        opacity="0.3"
                    >
                        <circle
                            cx="20"
                            cy="20"
                            r="14"
                            stroke="var(--text-muted)"
                            stroke-width="1.5"
                        />
                        <path
                            d="M14 20h12M20 14v12"
                            stroke="var(--text-muted)"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />
                    </svg>
                    <p class="empty-title">No proxies yet</p>
                    <p class="empty-sub">
                        Add a proxy or connect BrightData to get started.
                    </p>
                </div>
            {:else}
                <div class="proxy-list">
                    {#each proxies as proxy (proxy.id)}
                        {@const hr = healthFor(proxy.id)}
                        {@const isChecking = checking.has(proxy.id)}
                        <div
                            class="proxy-card"
                            class:unhealthy={!proxy.healthy}
                        >
                            <!-- Left accent dot -->
                            <div
                                class="health-dot"
                                style:background={proxy.healthy
                                    ? "var(--success)"
                                    : hr
                                      ? "var(--error)"
                                      : "var(--text-muted)"}
                            ></div>

                            <!-- Flag + name -->
                            <div class="proxy-main">
                                <div class="proxy-name-row">
                                    <span class="proxy-flag"
                                        >{countryFlag(proxy.country)}</span
                                    >
                                    <span class="proxy-name">{proxy.name}</span>
                                    <span
                                        class="proxy-type-badge"
                                        style:color={typeColor(
                                            proxy.proxy_type,
                                        )}
                                    >
                                        {proxy.proxy_type.toUpperCase()}
                                    </span>
                                </div>
                                <div class="proxy-server mono">
                                    {proxyServerUrl(proxy)}
                                </div>
                                {#if proxy.username}
                                    <div class="proxy-user muted">
                                        👤 {proxy.username}
                                    </div>
                                {/if}
                            </div>

                            <!-- Latency -->
                            <div class="proxy-stat">
                                {#if isChecking}
                                    <svg
                                        class="spin"
                                        width="12"
                                        height="12"
                                        viewBox="0 0 12 12"
                                        fill="none"
                                    >
                                        <circle
                                            cx="6"
                                            cy="6"
                                            r="4.5"
                                            stroke="currentColor"
                                            stroke-width="1.4"
                                            stroke-dasharray="7 10"
                                        />
                                    </svg>
                                {:else}
                                    <span
                                        class="latency"
                                        style:color={latencyColor(
                                            proxy.latency_ms,
                                        )}
                                    >
                                        {proxy.latency_ms != null
                                            ? `${proxy.latency_ms}ms`
                                            : "—"}
                                    </span>
                                    <span
                                        class="latency-label"
                                        style:color={latencyColor(
                                            proxy.latency_ms,
                                        )}
                                    >
                                        {latencyLabel(proxy.latency_ms)}
                                    </span>
                                {/if}
                                {#if hr?.error}
                                    <span class="health-err" title={hr.error}
                                        >⚠</span
                                    >
                                {/if}
                            </div>

                            <!-- Actions -->
                            <div class="proxy-actions">
                                <button
                                    class="icon-btn"
                                    title="Check health"
                                    disabled={isChecking}
                                    onclick={() =>
                                        proxyStore.checkProxy(proxy.id)}
                                >
                                    <svg
                                        width="13"
                                        height="13"
                                        viewBox="0 0 13 13"
                                        fill="none"
                                    >
                                        <path
                                            d="M2 6.5A4.5 4.5 0 0 1 11 4.3"
                                            stroke="currentColor"
                                            stroke-width="1.6"
                                            stroke-linecap="round"
                                        />
                                        <path
                                            d="M9 2l2 2.3-2.3 2"
                                            stroke="currentColor"
                                            stroke-width="1.6"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                        />
                                    </svg>
                                </button>
                                <button
                                    class="icon-btn"
                                    title="Edit"
                                    onclick={() => openEdit(proxy)}
                                >
                                    <svg
                                        width="13"
                                        height="13"
                                        viewBox="0 0 13 13"
                                        fill="none"
                                    >
                                        <path
                                            d="M9.5 1.5 a1.5 1.5 0 0 1 2.1 2.1L4.5 10.7l-3 .8.8-3Z"
                                            stroke="currentColor"
                                            stroke-width="1.3"
                                            stroke-linejoin="round"
                                        />
                                    </svg>
                                </button>
                                {#if confirmDeleteId === proxy.id}
                                    <button
                                        class="icon-btn danger"
                                        onclick={() => handleDelete(proxy.id)}
                                        title="Confirm delete"
                                    >
                                        <svg
                                            width="13"
                                            height="13"
                                            viewBox="0 0 13 13"
                                            fill="none"
                                        >
                                            <path
                                                d="M2 2l9 9M11 2 2 11"
                                                stroke="currentColor"
                                                stroke-width="1.6"
                                                stroke-linecap="round"
                                            />
                                        </svg>
                                    </button>
                                    <button
                                        class="icon-btn"
                                        onclick={() => (confirmDeleteId = null)}
                                        title="Cancel"
                                    >
                                        <svg
                                            width="13"
                                            height="13"
                                            viewBox="0 0 13 13"
                                            fill="none"
                                        >
                                            <path
                                                d="M2.5 6.5l3 3 5-6"
                                                stroke="currentColor"
                                                stroke-width="1.6"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            />
                                        </svg>
                                    </button>
                                {:else}
                                    <button
                                        class="icon-btn"
                                        title="Delete"
                                        onclick={() =>
                                            (confirmDeleteId = proxy.id)}
                                    >
                                        <svg
                                            width="13"
                                            height="13"
                                            viewBox="0 0 13 13"
                                            fill="none"
                                        >
                                            <path
                                                d="M2 3.5h9M5 3.5V2.5h3v1M4.5 3.5l.5 7h3l.5-7"
                                                stroke="currentColor"
                                                stroke-width="1.3"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                            />
                                        </svg>
                                    </button>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- ── Right: panel (add / edit / brightdata / rotation) ─────────────────── -->
        <div class="right-col">
            <!-- Add / Edit form -->
            {#if showAddPanel}
                <div class="panel">
                    <div class="panel-header">
                        <span class="panel-title"
                            >{editingId ? "Edit Proxy" : "Add Proxy"}</span
                        >
                        <button
                            class="icon-btn"
                            onclick={closePanel}
                            aria-label="Close"
                        >
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 12 12"
                                fill="none"
                            >
                                <path
                                    d="M1 1l10 10M11 1 1 11"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linecap="round"
                                />
                            </svg>
                        </button>
                    </div>
                    <div class="panel-body">
                        <div class="field-group">
                            <label class="field-label" for="px-name">Name</label
                            >
                            <input
                                id="px-name"
                                class="input"
                                type="text"
                                bind:value={formName}
                                placeholder="My Proxy"
                            />
                        </div>
                        <div class="row-2">
                            <div class="field-group">
                                <label class="field-label" for="px-type"
                                    >Type</label
                                >
                                <select
                                    id="px-type"
                                    class="input"
                                    bind:value={formType}
                                >
                                    <option value="http">HTTP</option>
                                    <option value="https">HTTPS</option>
                                    <option value="socks5">SOCKS5</option>
                                </select>
                            </div>
                            <div class="field-group">
                                <label class="field-label" for="px-country"
                                    >Country (2-letter)</label
                                >
                                <input
                                    id="px-country"
                                    class="input"
                                    type="text"
                                    bind:value={formCountry}
                                    placeholder="US"
                                    maxlength="2"
                                />
                            </div>
                        </div>
                        <div class="row-2">
                            <div class="field-group" style="flex:2">
                                <label class="field-label" for="px-host"
                                    >Host</label
                                >
                                <input
                                    id="px-host"
                                    class="input mono"
                                    type="text"
                                    bind:value={formHost}
                                    placeholder="proxy.example.com"
                                />
                            </div>
                            <div class="field-group" style="flex:1">
                                <label class="field-label" for="px-port"
                                    >Port</label
                                >
                                <input
                                    id="px-port"
                                    class="input mono"
                                    type="number"
                                    bind:value={formPort}
                                    min="1"
                                    max="65535"
                                />
                            </div>
                        </div>
                        <div class="row-2">
                            <div class="field-group">
                                <label class="field-label" for="px-user"
                                    >Username</label
                                >
                                <input
                                    id="px-user"
                                    class="input"
                                    type="text"
                                    bind:value={formUser}
                                    placeholder="optional"
                                />
                            </div>
                            <div class="field-group">
                                <label class="field-label" for="px-pass"
                                    >Password</label
                                >
                                <input
                                    id="px-pass"
                                    class="input"
                                    type="password"
                                    bind:value={formPass}
                                    placeholder={editingId
                                        ? "(unchanged)"
                                        : "optional"}
                                />
                            </div>
                        </div>
                        {#if formError}
                            <p class="form-error">{formError}</p>
                        {/if}
                        <div class="panel-footer">
                            <button class="btn-ghost" onclick={closePanel}
                                >Cancel</button
                            >
                            <button
                                class="btn-primary"
                                disabled={formSaving}
                                onclick={handleSave}
                            >
                                {formSaving
                                    ? "Saving…"
                                    : editingId
                                      ? "Save changes"
                                      : "Add proxy"}
                            </button>
                        </div>
                    </div>
                </div>
            {/if}

            <!-- BrightData quick-add panel -->
            {#if showBdPanel}
                <div class="panel">
                    <div class="panel-header">
                        <span class="panel-title">⚡ BrightData Quick-Add</span>
                        <button
                            class="icon-btn"
                            onclick={closePanel}
                            aria-label="Close"
                        >
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 12 12"
                                fill="none"
                            >
                                <path
                                    d="M1 1l10 10M11 1 1 11"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linecap="round"
                                />
                            </svg>
                        </button>
                    </div>
                    <div class="panel-body">
                        <p class="panel-desc">
                            Automatically build and register a BrightData proxy
                            endpoint from your zone credentials.
                        </p>
                        <div class="row-2">
                            <div class="field-group">
                                <label class="field-label" for="bd-cust"
                                    >Customer ID</label
                                >
                                <input
                                    id="bd-cust"
                                    class="input"
                                    type="text"
                                    bind:value={bdCustomer}
                                    placeholder="brd-customer-…"
                                />
                            </div>
                            <div class="field-group">
                                <label class="field-label" for="bd-zone"
                                    >Zone</label
                                >
                                <input
                                    id="bd-zone"
                                    class="input"
                                    type="text"
                                    bind:value={bdZone}
                                    placeholder="residential"
                                />
                            </div>
                        </div>
                        <div class="row-2">
                            <div class="field-group">
                                <label class="field-label" for="bd-country"
                                    >Country (optional)</label
                                >
                                <input
                                    id="bd-country"
                                    class="input"
                                    type="text"
                                    bind:value={bdCountry}
                                    placeholder="us"
                                />
                            </div>
                            <div class="field-group">
                                <label class="field-label" for="bd-pass"
                                    >Zone Password</label
                                >
                                <input
                                    id="bd-pass"
                                    class="input"
                                    type="password"
                                    bind:value={bdPassword}
                                    placeholder="•••••••••"
                                />
                            </div>
                        </div>
                        <div class="seg-control">
                            {#each [["rotating", "Rotating"], ["sticky", "Sticky session"]] as [v, l]}
                                <button
                                    class="seg-btn"
                                    class:active={bdMode === v}
                                    onclick={() =>
                                        (bdMode = v as "sticky" | "rotating")}
                                    >{l}</button
                                >
                            {/each}
                        </div>
                        {#if bdError}
                            <p class="form-error">{bdError}</p>
                        {/if}
                        <div class="panel-footer">
                            <button class="btn-ghost" onclick={closePanel}
                                >Cancel</button
                            >
                            <button
                                class="btn-primary"
                                disabled={bdAdding}
                                onclick={handleBdAdd}
                            >
                                {bdAdding ? "Adding…" : "Add BrightData proxy"}
                            </button>
                        </div>
                    </div>
                </div>
            {/if}

            <!-- Global rotation policy -->
            <div class="panel">
                <div class="panel-header">
                    <span class="panel-title">🔄 Global Rotation Policy</span>
                </div>
                <div class="panel-body">
                    <p class="panel-desc">
                        Configure the global proxy rotator used when a profile
                        has no per-profile policy set.
                    </p>
                    <div class="field-group">
                        <span class="field-label">Rotation trigger</span>
                        <div class="seg-control">
                            {#each [["manual", "Manual"], ["interval", "Every X min"], ["on_ban", "On ban signal"]] as [v, l]}
                                <button
                                    class="seg-btn"
                                    class:active={rotMode === v}
                                    onclick={() =>
                                        (rotMode = v as typeof rotMode)}
                                    >{l}</button
                                >
                            {/each}
                        </div>
                    </div>
                    {#if rotMode === "interval"}
                        <div class="field-group">
                            <label class="field-label" for="rot-min"
                                >Interval (minutes)</label
                            >
                            <input
                                id="rot-min"
                                class="input"
                                style="width:80px"
                                type="number"
                                bind:value={rotInterval}
                                min="1"
                                max="1440"
                            />
                        </div>
                    {/if}
                    <div class="panel-footer" style="margin-top:4px">
                        <button
                            class="btn-secondary"
                            onclick={applyGlobalRotation}>Apply</button
                        >
                    </div>
                </div>
            </div>

            <!-- Stats summary -->
            {#if proxies.length > 0}
                <div class="panel">
                    <div class="panel-header">
                        <span class="panel-title">📊 Pool Summary</span>
                    </div>
                    <div class="panel-body">
                        <div class="stat-grid">
                            <div class="stat-cell">
                                <span class="stat-val green"
                                    >{healthyCount}</span
                                >
                                <span class="stat-lbl">Healthy</span>
                            </div>
                            <div class="stat-cell">
                                <span class="stat-val red"
                                    >{unhealthyCount}</span
                                >
                                <span class="stat-lbl">Down</span>
                            </div>
                            <div class="stat-cell">
                                <span class="stat-val"
                                    >{proxies.filter((p) => p.country)
                                        .length}</span
                                >
                                <span class="stat-lbl">Geolocated</span>
                            </div>
                            <div class="stat-cell">
                                <span class="stat-val accent"
                                    >{proxyStore.brightDataProxies.length}</span
                                >
                                <span class="stat-lbl">BrightData</span>
                            </div>
                        </div>
                        {#if Object.keys(proxyStore.proxiesByCountry).length > 0}
                            <div class="country-chips">
                                {#each Object.entries(proxyStore.proxiesByCountry) as [cc, pxs]}
                                    <span class="country-chip">
                                        {countryFlag(cc)}
                                        {cc.toUpperCase()}
                                        <span class="country-count"
                                            >{pxs.length}</span
                                        >
                                    </span>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .page {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        color: var(--text-primary);
    }

    /* ── Header ── */
    .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 24px 14px;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
        gap: 12px;
        flex-wrap: wrap;
    }
    .header-left {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }
    .page-title {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: -0.025em;
    }
    .header-pills {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }
    .pill {
        font-size: 11px;
        font-weight: 500;
        padding: 2px 9px;
        border-radius: 99px;
        background: var(--surface-3);
        border: 1px solid var(--border);
        color: var(--text-secondary);
    }
    .pill.green {
        color: var(--success);
        border-color: rgba(52, 211, 153, 0.25);
        background: rgba(52, 211, 153, 0.07);
    }
    .pill.red {
        color: var(--error);
        border-color: rgba(239, 68, 68, 0.25);
        background: rgba(239, 68, 68, 0.07);
    }
    .header-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
    }

    /* ── Quick add bar ── */
    .quick-add-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 24px 12px;
        border-bottom: 1px solid var(--border);
        background: var(--surface-2);
        flex-wrap: wrap;
    }
    .quick-add-input {
        flex: 1;
        min-width: 200px;
        padding: 8px 12px;
        font-size: 13px;
        font-family: inherit;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
    }
    .quick-add-input::placeholder {
        color: var(--text-muted);
    }
    .quick-add-btn {
        flex-shrink: 0;
    }
    .quick-add-error {
        width: 100%;
        font-size: 12px;
        color: var(--error);
    }

    .bulk-add-wrap {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 6px;
    }

    .bulk-add-textarea {
        width: 100%;
        min-height: 120px;
        resize: vertical;
        padding: 10px 12px;
        font-size: 12px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        outline: none;
    }

    .bulk-add-textarea:focus {
        border-color: var(--border-focus);
        box-shadow: 0 0 0 3px var(--accent-glow);
    }

    .bulk-add-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }

    .bulk-add-result {
        padding: 8px 10px;
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
    }

    .bulk-add-failures {
        margin-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .bulk-add-failure {
        font-size: 11px;
        color: var(--error);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* ── Body ── */
    .body {
        flex: 1;
        display: flex;
        overflow: hidden;
        min-height: 0;
    }

    /* ── Proxy list column ── */
    .proxy-col {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 0;
    }
    .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 60px 20px;
        text-align: center;
    }
    .empty-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
        margin: 0;
    }
    .empty-sub {
        font-size: 12px;
        color: var(--text-muted);
        margin: 0;
        max-width: 280px;
        line-height: 1.55;
    }

    .proxy-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .proxy-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        transition: border-color 0.12s;
    }
    .proxy-card:hover {
        border-color: var(--border-hover);
    }
    .proxy-card.unhealthy {
        border-color: rgba(239, 68, 68, 0.2);
    }

    .health-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    .proxy-main {
        flex: 1;
        min-width: 0;
    }
    .proxy-name-row {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-bottom: 3px;
        flex-wrap: wrap;
    }
    .proxy-flag {
        font-size: 14px;
        line-height: 1;
    }
    .proxy-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
    }
    .proxy-type-badge {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.05em;
        opacity: 0.8;
    }
    .proxy-server {
        font-size: 11px;
        color: var(--text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .proxy-user {
        font-size: 11px;
        margin-top: 2px;
    }

    .proxy-stat {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        min-width: 52px;
        flex-shrink: 0;
    }
    .latency {
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
    .latency-label {
        font-size: 10px;
        font-weight: 500;
    }
    .health-err {
        font-size: 10px;
        color: var(--error);
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .proxy-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
    }

    /* ── Buttons ── */
    .btn-primary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: 600;
        background: var(--accent-dim);
        color: #fff;
        border: none;
        cursor: pointer;
        transition: background 0.12s;
    }
    .btn-primary:hover {
        background: var(--accent);
    }
    .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .btn-secondary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: 500;
        background: var(--surface-3);
        color: var(--text-secondary);
        border: 1px solid var(--border);
        cursor: pointer;
        transition:
            background 0.12s,
            color 0.12s,
            border-color 0.12s;
    }
    .btn-secondary:hover {
        background: var(--surface-4);
        color: var(--text-primary);
        border-color: var(--border-hover);
    }

    .btn-ghost {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: 500;
        background: transparent;
        color: var(--text-muted);
        border: 1px solid transparent;
        cursor: pointer;
        transition: color 0.12s;
    }
    .btn-ghost:hover {
        color: var(--text-primary);
    }

    .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: var(--radius-sm);
        background: transparent;
        color: var(--text-muted);
        border: 1px solid transparent;
        cursor: pointer;
        transition:
            background 0.12s,
            color 0.12s;
    }
    .icon-btn:hover {
        background: var(--surface-3);
        color: var(--text-primary);
    }
    .icon-btn.danger {
        color: var(--error);
    }
    .icon-btn.danger:hover {
        background: rgba(239, 68, 68, 0.1);
    }

    .muted {
        color: var(--text-muted);
    }

    /* ── Spinner ── */
    .spin {
        animation: manifold-spin 0.8s linear infinite;
    }
    @keyframes manifold-spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* ── Right column ── */
    .right-col {
        width: 340px;
        min-width: 300px;
        border-left: 1px solid var(--border);
        overflow-y: auto;
        padding: 16px 18px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        flex-shrink: 0;
    }

    /* ── Panels ── */
    .panel {
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        overflow: hidden;
    }
    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid var(--border);
    }
    .panel-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
    }
    .panel-body {
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .panel-desc {
        font-size: 12px;
        color: var(--text-secondary);
        line-height: 1.55;
    }
    .panel-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding-top: 4px;
    }

    /* ── Form fields ── */
    .field-group {
        display: flex;
        flex-direction: column;
        gap: 5px;
    }
    .field-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        letter-spacing: 0.03em;
    }
    .input {
        font-size: 12px;
        padding: 6px 10px;
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        outline: none;
        transition: border-color 0.12s;
        width: 100%;
    }
    .input:focus {
        border-color: var(--border-focus);
        box-shadow: 0 0 0 3px var(--accent-glow);
    }
    .input::placeholder {
        color: var(--text-muted);
    }
    .form-error {
        font-size: 11px;
        color: var(--error);
        margin: 0;
    }
    .row-2 {
        display: flex;
        gap: 10px;
    }
    .row-2 > * {
        flex: 1;
    }

    /* ── Segmented control ── */
    .seg-control {
        display: flex;
        gap: 0;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        overflow: hidden;
    }
    .seg-control button {
        flex: 1;
        padding: 6px 10px;
        font-size: 11px;
        font-weight: 500;
        color: var(--text-secondary);
        background: var(--surface-3);
        border: none;
        border-right: 1px solid var(--border);
        cursor: pointer;
        transition:
            background 0.12s,
            color 0.12s;
    }
    .seg-control button:last-child {
        border-right: none;
    }
    .seg-control button:hover {
        color: var(--text-primary);
    }
    .seg-control button.active {
        background: var(--accent-glow);
        color: var(--accent);
        font-weight: 600;
    }

    /* ── Stats grid ── */
    .stat-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
    }
    .stat-cell {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 10px;
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
    }
    .stat-val {
        font-size: 18px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--text-primary);
    }
    .stat-val.green {
        color: var(--success);
    }
    .stat-val.red {
        color: var(--error);
    }
    .stat-val.accent {
        color: var(--accent);
    }
    .stat-lbl {
        font-size: 10px;
        font-weight: 500;
        color: var(--text-muted);
        letter-spacing: 0.03em;
    }

    /* ── Country chips ── */
    .country-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
    }
    .country-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 9px;
        font-size: 11px;
        font-weight: 500;
        color: var(--text-secondary);
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: 99px;
    }
    .country-count {
        font-size: 10px;
        font-weight: 700;
        color: var(--text-muted);
        background: var(--surface-4);
        border-radius: 50%;
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .mono {
        font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
    }
</style>
