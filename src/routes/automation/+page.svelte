<script lang="ts">
    import { profileStore } from "$lib/stores/profiles.svelte";
    import { proxyStore } from "$lib/stores/proxy.svelte";
    import { automationStore } from "$lib/stores/automation.svelte";
    import type { LoginFormConfig, CredentialPair, AttemptResult, LoginRun } from "../../../playwright-bridge/login-types";
    import { resolveDomainProfile, DOMAIN_PROFILES } from "../../../playwright-bridge/login-types";
    import { scrapeFormSelectors, selectorsToFormConfig, FORM_PRESETS } from "$lib/utils/form-scraper";

    // ── State ────────────────────────────────────────────────────────────────
    let runs           = $derived(automationStore.runs);
    let activeRun      = $derived(automationStore.activeRun);
    let drafts         = $derived(automationStore.drafts);
    let importError    = $derived(automationStore.importError);
    let profiles       = $derived(profileStore.profiles);
    let proxies        = $derived(proxyStore.proxies);

    // ── Tab control ──────────────────────────────────────────────────────────
    type Tab = "setup" | "run" | "history";
    let activeTab = $state<Tab>("setup");

    // ── Setup state ──────────────────────────────────────────────────────────
    let targetUrl       = $state("");
    let rawCredText     = $state("");
    let importMode      = $state<"text" | "file">("text");
    let dragOver        = $state(false);

    // Form config fields
    let usernameSelector   = $state("");
    let passwordSelector   = $state("");
    let submitSelector     = $state("");
    let successSelector    = $state("");
    let failureSelector    = $state("");
    let captchaSelector    = $state("");
    let consentSelector    = $state("");
    let totpSelector       = $state("");
    let postSubmitTimeout  = $state(8000);
    let pageLoadTimeout    = $state(15000);
    let exportSession      = $state(true);

    // Auto-fill state
    let isScrapingForm     = $state(false);
    let scrapeError        = $state("");
    let scrapeSuccess      = $state("");

    // Run config fields
    let rotateEvery        = $state(false);
    let softThreshold      = $state(1);
    let maxRetries         = $state(2);
    let runMode            = $state<"sequential" | "parallel">("sequential");
    let concurrency        = $state(1);
    let launchDelay        = $state(3000);
    let domainAwareNoise   = $state(true);
    let patchTls           = $state(false);
    let selectedProfiles   = $state<string[]>([]);
    let showAdvanced       = $state(false);
    let showFormConfig     = $state(true);

    // ── Results filtering and search ─────────────────────────────────────────
    let resultSearchQuery  = $state("");
    let resultStatusFilter = $state<"all" | "success" | "failed" | "blocked" | "error">("all");
    let resultOutcomeFilter = $state<"all" | "success" | "wrong_credentials" | "captcha_block" | "rate_limited" | "ip_blocked" | "timeout" | "error">("all");
    let sortBy             = $state<"index" | "username" | "status" | "duration">("index");
    let sortAsc            = $state(true);

    // ── Derived ──────────────────────────────────────────────────────────────
    let domainProfile = $derived(
        targetUrl
            ? (() => { try { return resolveDomainProfile(targetUrl); } catch { return null; } })()
            : null
    );

    let threatColor = $derived(
        domainProfile?.threat_level === "paranoid" ? "var(--error)" :
        domainProfile?.threat_level === "high"     ? "var(--warning)" :
        domainProfile?.threat_level === "medium"   ? "var(--accent)" :
        "var(--success)"
    );

    let canStart = $derived(
        drafts.length > 0 &&
        targetUrl.length > 0 &&
        usernameSelector.length > 0 &&
        passwordSelector.length > 0 &&
        submitSelector.length > 0 &&
        selectedProfiles.length > 0
    );

    // ── URL → preset auto-fill (with scraping) ────────────────────────────────
    async function applyPreset() {
        if (!targetUrl) return;

        isScrapingForm = true;
        scrapeError = "";
        scrapeSuccess = "";

        try {
            // First try to get from hardcoded presets
            let config: Partial<LoginFormConfig> | null = null;
            let detectionInfo = "";

            for (const [domain, preset] of Object.entries(FORM_PRESETS)) {
                if (targetUrl.includes(domain)) {
                    config = preset;
                    scrapeSuccess = `✓ Loaded preset for ${domain}`;
                    break;
                }
            }

            // If no preset, try to scrape the form
            if (!config) {
                scrapeSuccess = "Scraping form selectors from target...";
                const scraped = await scrapeFormSelectors({
                    url: targetUrl,
                    timeout: 15000,
                    waitForSPA: true,
                    detectCaptcha: true,
                    detectMFA: true,
                });

                if (scraped.confidence > 0) {
                    config = selectorsToFormConfig(targetUrl, scraped);

                    // Build detailed feedback with detection info
                    let feedback = `✓ Auto-detected selectors (confidence: ${Math.round(scraped.confidence)}%)`;
                    const features = [];

                    if (scraped.isSPA) {
                        features.push(`SPA (${scraped.spaFramework || 'unknown'})`);
                    }
                    if (scraped.hasCaptcha) {
                        features.push(`CAPTCHA: ${scraped.captchaProviders?.join(', ') || 'detected'}`);
                    }
                    if (scraped.hasMFA) {
                        features.push(`MFA: ${scraped.mfaType || 'unknown'}`);
                    }

                    if (features.length > 0) {
                        feedback += ` | ${features.join(' • ')}`;
                    }

                    scrapeSuccess = feedback;
                    detectionInfo = scraped.details?.join('\n') || "";
                } else {
                    scrapeError = `Could not auto-detect form selectors. ${scraped.details?.[0] || 'Please configure manually.'}`;
                }
            }

            // Apply the config
            if (config) {
                usernameSelector = config.username_selector ?? "";
                passwordSelector = config.password_selector ?? "";
                submitSelector = config.submit_selector ?? "";
                successSelector = config.success_selector ?? "";
                failureSelector = config.failure_selector ?? "";
                captchaSelector = config.captcha_selector ?? "";
                consentSelector = config.consent_selector ?? "";
                totpSelector = config.totp_selector ?? "";
                postSubmitTimeout = config.post_submit_timeout_ms ?? 8000;
                pageLoadTimeout = config.page_load_timeout_ms ?? 15000;
                exportSession = config.export_session_on_success ?? true;
            }

            // Apply domain profile settings
            if (domainProfile) {
                patchTls = domainProfile.patch_tls;
                launchDelay = domainProfile.min_attempt_gap_ms;
            }

            // Log detection details to console for debugging
            if (detectionInfo) {
                console.log("[automation] Detection details:\n" + detectionInfo);
            }
        } catch (error) {
            scrapeError = `Error: ${error instanceof Error ? error.message : String(error)}`;
            console.error("[automation] Auto-fill error:", error);
        } finally {
            isScrapingForm = false;
        }
    }

    // ── Credential import ─────────────────────────────────────────────────────
    function handleImportText() {
        const n = automationStore.importCredentialText(rawCredText);
        if (n > 0) rawCredText = "";
    }

    async function handleFileInput(e: Event) {
        const files = (e.target as HTMLInputElement).files;
        if (!files?.length) return;
        for (const file of Array.from(files)) {
            await automationStore.importCredentialFile(file);
        }
    }

    function handleDrop(e: DragEvent) {
        e.preventDefault();
        dragOver = false;
        const files = e.dataTransfer?.files;
        if (!files?.length) return;
        for (const file of Array.from(files)) {
            automationStore.importCredentialFile(file);
        }
    }

    // ── Run control ───────────────────────────────────────────────────────────
    function handleStart() {
        if (!canStart) return;

        const form: LoginFormConfig = {
            url: targetUrl,
            username_selector:       usernameSelector,
            password_selector:       passwordSelector,
            submit_selector:         submitSelector,
            success_selector:        successSelector || undefined,
            failure_selector:        failureSelector || undefined,
            captcha_selector:        captchaSelector || undefined,
            consent_selector:        consentSelector || undefined,
            totp_selector:           totpSelector || undefined,
            post_submit_timeout_ms:  postSubmitTimeout,
            page_load_timeout_ms:    pageLoadTimeout,
            export_session_on_success: exportSession,
        };

        const run = automationStore.createRun(form, [...drafts], {
            profile_pool:            selectedProfiles,
            rotate_every_attempt:    rotateEvery,
            soft_signal_threshold:   softThreshold,
            max_retries:             maxRetries,
            mode:                    runMode,
            concurrency:             concurrency,
            launch_delay_ms:         launchDelay,
            domain_aware_noise:      domainAwareNoise,
            patch_tls:               patchTls,
        });

        automationStore.clearDrafts();
        automationStore.startRun(run.id);
        activeTab = "run";
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function statusClass(status: string): string {
        switch (status) {
            case "success":      return "pill-success";
            case "failed":       return "pill-error";
            case "running":      return "pill-accent";
            case "soft_blocked": return "pill-warn";
            case "hard_blocked": return "pill-error";
            case "error":        return "pill-error";
            case "skipped":      return "pill-muted";
            default:             return "pill-muted";
        }
    }

    function outcomeClass(outcome: string): string {
        switch (outcome) {
            case "success":           return "pill-success";
            case "wrong_credentials": return "pill-error";
            case "captcha_block":     return "pill-warn";
            case "rate_limited":      return "pill-warn";
            case "ip_blocked":        return "pill-error";
            case "account_locked":    return "pill-error";
            case "2fa_required":      return "pill-warn";
            case "timeout":           return "pill-muted";
            case "error":             return "pill-error";
            default:                  return "pill-muted";
        }
    }

    function relTime(ts: string | null | undefined): string {
        if (!ts) return "—";
        const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
        if (s < 60)   return `${s}s ago`;
        if (s < 3600) return `${Math.floor(s/60)}m ago`;
        return `${Math.floor(s/3600)}h ago`;
    }

    function fmtMs(ms: number): string {
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    }

    function truncate(s: string, n = 36): string {
        return s.length > n ? s.slice(0, n - 1) + "…" : s;
    }

    function progressPct(stats: LoginRun["stats"]): number {
        if (!stats.total) return 0;
        const done = stats.success + stats.failed + stats.soft_blocked +
                     stats.hard_blocked + stats.error + stats.skipped;
        return Math.round((done / stats.total) * 100);
    }

    function filterResults(credentials: CredentialPair[], results: AttemptResult[], run: LoginRun) {
        let filtered = credentials.map((cred, idx) => ({
            cred,
            result: results.findLast(r => r.credential_id === cred.id),
            index: idx,
        }));

        // Search filter
        if (resultSearchQuery.trim()) {
            const q = resultSearchQuery.toLowerCase();
            filtered = filtered.filter(item =>
                item.cred.username.toLowerCase().includes(q) ||
                item.result?.final_url?.toLowerCase().includes(q)
            );
        }

        // Status filter
        if (resultStatusFilter !== "all") {
            filtered = filtered.filter(item => {
                switch (resultStatusFilter) {
                    case "success": return item.cred.status === "success";
                    case "failed": return item.cred.status === "failed";
                    case "blocked": return item.cred.status === "soft_blocked" || item.cred.status === "hard_blocked";
                    case "error": return item.cred.status === "error";
                    default: return true;
                }
            });
        }

        // Outcome filter
        if (resultOutcomeFilter !== "all" && filtered.length > 0) {
            filtered = filtered.filter(item => item.result?.outcome === resultOutcomeFilter);
        }

        // Sort
        filtered.sort((a, b) => {
            let cmp = 0;
            switch (sortBy) {
                case "username":
                    cmp = a.cred.username.localeCompare(b.cred.username);
                    break;
                case "status":
                    cmp = a.cred.status.localeCompare(b.cred.status);
                    break;
                case "duration":
                    cmp = (a.result?.duration_ms ?? 0) - (b.result?.duration_ms ?? 0);
                    break;
                default: // index
                    cmp = a.index - b.index;
            }
            return sortAsc ? cmp : -cmp;
        });

        return filtered;
    }

    let expandedResult = $state<string | null>(null);
    let showScreenshot = $state<string | null>(null);
</script>

<!-- ── Screenshot lightbox ────────────────────────────────────────────────── -->
{#if showScreenshot}
    <div class="lightbox" onclick={() => { showScreenshot = null; }}>
        <div class="lightbox-inner" onclick={(e) => e.stopPropagation()}>
            <div class="lightbox-header">
                <span class="section-label">Screenshot</span>
                <button class="icon-btn" onclick={() => { showScreenshot = null; }}>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
            <img src="data:image/png;base64,{showScreenshot}" alt="Screenshot" class="lightbox-img"/>
        </div>
    </div>
{/if}

<div class="page">

    <!-- ══════════════════════════════════════════════════════════ HEADER ══ -->
    <div class="page-header">
        <div class="header-left">
            <span class="page-title">Automation</span>
            {#if activeRun}
                <span class="run-badge" class:run-badge-live={activeRun.status === "running"}>
                    {#if activeRun.status === "running"}
                        <span class="dot dot-running"></span> Running
                    {:else if activeRun.status === "paused"}
                        <span class="dot dot-warn"></span> Paused
                    {:else if activeRun.status === "completed"}
                        <span class="dot dot-success"></span> Completed
                    {:else if activeRun.status === "aborted"}
                        <span class="dot dot-error"></span> Aborted
                    {:else}
                        <span class="dot dot-idle"></span> {activeRun.status}
                    {/if}
                </span>
            {/if}
        </div>

        <!-- Global run stats strip -->
        {#if activeRun}
            {@const s = activeRun.stats}
            <div class="stats-strip">
                <span class="stat-chip">
                    <span class="stat-n">{s.total}</span>
                    <span class="stat-l">total</span>
                </span>
                <span class="stat-chip success">
                    <span class="stat-n">{s.success}</span>
                    <span class="stat-l">hit</span>
                </span>
                <span class="stat-chip error">
                    <span class="stat-n">{s.failed}</span>
                    <span class="stat-l">fail</span>
                </span>
                <span class="stat-chip warn">
                    <span class="stat-n">{s.soft_blocked}</span>
                    <span class="stat-l">blocked</span>
                </span>
                <span class="stat-chip muted">
                    <span class="stat-n">{s.error}</span>
                    <span class="stat-l">error</span>
                </span>
                <span class="stat-chip accent">
                    <span class="stat-n">{s.rotations}</span>
                    <span class="stat-l">rotations</span>
                </span>
            </div>
        {/if}

        <!-- Run controls -->
        <div class="header-actions">
            {#if activeRun?.status === "running"}
                <button class="btn btn-secondary btn-sm"
                    onclick={() => automationStore.pauseRun(activeRun!.id)}>
                    ⏸ Pause
                </button>
                <button class="btn btn-danger btn-sm"
                    onclick={() => automationStore.abortRun(activeRun!.id)}>
                    ■ Abort
                </button>
            {:else if activeRun?.status === "paused"}
                <button class="btn btn-primary btn-sm"
                    onclick={() => automationStore.resumeRun(activeRun!.id)}>
                    ▶ Resume
                </button>
                <button class="btn btn-danger btn-sm"
                    onclick={() => automationStore.abortRun(activeRun!.id)}>
                    ■ Abort
                </button>
            {/if}
            {#if activeRun && (activeRun.status === "completed" || activeRun.status === "aborted")}
                <button class="btn btn-secondary btn-sm"
                    onclick={() => automationStore.downloadRunReport(activeRun!.id)}>
                    ↓ Report
                </button>
                <button class="btn btn-secondary btn-sm"
                    onclick={() => automationStore.downloadSuccessCreds(activeRun!.id)}>
                    ↓ Hits
                </button>
                {#if activeRun.results.some(r => r.session_exported)}
                    <button class="btn btn-secondary btn-sm"
                        onclick={() => automationStore.downloadAllSessions(activeRun!.id)}>
                        ↓ Sessions
                    </button>
                {/if}
            {/if}
        </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════ TABS ══ -->
    <div class="tab-bar">
        <button class="tab" class:active={activeTab === "setup"}
            onclick={() => { activeTab = "setup"; }}>
            Setup
        </button>
        <button class="tab" class:active={activeTab === "run"}
            onclick={() => { activeTab = "run"; }}>
            Run
            {#if activeRun?.status === "running"}
                <span class="tab-pip live">●</span>
            {/if}
        </button>
        <button class="tab" class:active={activeTab === "history"}
            onclick={() => { activeTab = "history"; }}>
            History
            {#if runs.length > 0}
                <span class="tab-pip neutral">{runs.length}</span>
            {/if}
        </button>
    </div>

    <div class="page-body">

        <!-- ════════════════════════════════════════════════ SETUP TAB ══ -->
        {#if activeTab === "setup"}
        <div class="setup-layout">

            <!-- ── Left: Target + Credentials ── -->
            <div class="setup-left">

                <!-- Target URL -->
                <div class="setup-card">
                    <div class="card-title">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3"/>
                            <circle cx="6" cy="6" r="1.5" fill="currentColor"/>
                        </svg>
                        Target
                    </div>
                    <div class="field-row">
                        <div class="field-grow">
                            <label class="field-label">Login URL</label>
                            <input
                                class="input"
                                type="url"
                                placeholder="https://accounts.example.com/login"
                                bind:value={targetUrl}
                                oninput={() => { if (targetUrl) applyPreset(); }}
                            />
                        </div>
                    </div>

                    {#if domainProfile}
                        <div class="domain-badge">
                            <span class="domain-host mono">{domainProfile.hostname}</span>
                            <span class="domain-threat" style:color={threatColor}>
                                {domainProfile.threat_level.toUpperCase()}
                            </span>
                            {#if domainProfile.captcha_providers.length > 0}
                                {#each domainProfile.captcha_providers as cp}
                                    <span class="tag tag-warn">{cp}</span>
                                {/each}
                            {/if}
                            {#if domainProfile.waf_signals.length > 0}
                                {#each domainProfile.waf_signals as waf}
                                    <span class="tag">{waf}</span>
                                {/each}
                            {/if}
                            {#if domainProfile.patch_tls}
                                <span class="tag tag-accent">TLS patch</span>
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- Credential Import -->
                <div class="setup-card">
                    <div class="card-title">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                            <path d="M4 5.5h4M4 7.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                        </svg>
                        Credentials
                        {#if drafts.length > 0}
                            <span class="card-count">{drafts.length}</span>
                        {/if}
                    </div>

                    <div class="import-mode-row">
                        <button class="mode-btn" class:active={importMode === "text"}
                            onclick={() => { importMode = "text"; }}>Text</button>
                        <button class="mode-btn" class:active={importMode === "file"}
                            onclick={() => { importMode = "file"; }}>File</button>
                    </div>

                    {#if importMode === "text"}
                        <textarea
                            class="input cred-textarea mono"
                            placeholder={"username:password\nuser@example.com:secretpass\n\nOr CSV with header:\nusername,password,totp_seed\nuser1,pass1,JBSWY3DPEHPK3PXP"}
                            bind:value={rawCredText}
                            rows="7"
                        ></textarea>
                        <div class="import-actions">
                            <button class="btn btn-primary btn-sm"
                                onclick={handleImportText}
                                disabled={!rawCredText.trim()}>
                                Import
                            </button>
                            {#if drafts.length > 0}
                                <button class="btn btn-ghost btn-sm"
                                    onclick={automationStore.clearDrafts}>
                                    Clear all
                                </button>
                            {/if}
                        </div>
                    {:else}
                        <div
                            class="drop-zone"
                            class:drag-over={dragOver}
                            ondragover={(e) => { e.preventDefault(); dragOver = true; }}
                            ondragleave={() => { dragOver = false; }}
                            ondrop={handleDrop}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" opacity="0.4">
                                <path d="M12 3v12M7 8l5-5 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            </svg>
                            <span>Drop CSV / JSON / TXT file</span>
                            <label class="btn btn-secondary btn-sm upload-label">
                                Browse
                                <input type="file" accept=".csv,.txt,.json" multiple onchange={handleFileInput} style="display:none"/>
                            </label>
                        </div>
                    {/if}

                    {#if importError}
                        <div class="error-banner">{importError}</div>
                    {/if}

                    <!-- Draft credential list -->
                    {#if drafts.length > 0}
                        <div class="cred-list">
                            <div class="cred-list-header">
                                <span class="section-label">{drafts.length} credential{drafts.length !== 1 ? "s" : ""} queued</span>
                            </div>
                            <div class="cred-rows">
                                {#each drafts.slice(0, 50) as cred (cred.id)}
                                    <div class="cred-row">
                                        <span class="cred-user mono truncate">{cred.username}</span>
                                        <span class="cred-pass mono">{"•".repeat(Math.min(cred.password.length, 10))}</span>
                                        {#if Object.keys(cred.extras).length > 0}
                                            <span class="tag tag-accent" title={JSON.stringify(cred.extras)}>+{Object.keys(cred.extras).length}</span>
                                        {/if}
                                        <button class="icon-btn danger"
                                            onclick={() => automationStore.removeDraft(cred.id)}>
                                            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                                                <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                                            </svg>
                                        </button>
                                    </div>
                                {/each}
                                {#if drafts.length > 50}
                                    <div class="cred-overflow">+{drafts.length - 50} more</div>
                                {/if}
                            </div>
                        </div>
                    {/if}
                </div>

                <!-- Profile Pool -->
                <div class="setup-card">
                    <div class="card-title">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <circle cx="6" cy="4" r="2.5" stroke="currentColor" stroke-width="1.3"/>
                            <path d="M1.5 11c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                        </svg>
                        Profile Pool
                        {#if selectedProfiles.length > 0}
                            <span class="card-count">{selectedProfiles.length}</span>
                        {/if}
                    </div>

                    <p class="card-hint">
                        Select profiles to draw from. Each credential attempt uses one profile.
                        The runner rotates through the pool on soft signals.
                    </p>

                    <div class="profile-pool-list">
                        {#if profiles.length === 0}
                            <div class="empty">
                                <span class="empty-hint">No profiles. <a href="/profiles">Create one →</a></span>
                            </div>
                        {:else}
                            {#each profiles as profile (profile.id)}
                                {@const checked = selectedProfiles.includes(profile.id)}
                                <label class="pool-item" class:selected={checked}>
                                    <input type="checkbox" checked={checked}
                                        onchange={() => {
                                            if (checked) {
                                                selectedProfiles = selectedProfiles.filter(id => id !== profile.id);
                                            } else {
                                                selectedProfiles = [...selectedProfiles, profile.id];
                                            }
                                        }}
                                    />
                                    <span class="dot"
                                        class:dot-running={profile.status === "running"}
                                        class:dot-error={profile.status === "error"}
                                        class:dot-idle={profile.status === "idle"}
                                    ></span>
                                    <span class="pool-name truncate">{profile.name}</span>
                                    {#if profile.target?.platform}
                                        <span class="tag">{profile.target.platform}</span>
                                    {/if}
                                    {#if profile.proxy_id}
                                        <span class="tag tag-accent">proxy</span>
                                    {/if}
                                </label>
                            {/each}
                        {/if}
                    </div>

                    {#if profiles.length > 1}
                        <div class="pool-actions">
                            <button class="btn btn-ghost btn-sm"
                                onclick={() => { selectedProfiles = profiles.map(p => p.id); }}>
                                Select all
                            </button>
                            <button class="btn btn-ghost btn-sm"
                                onclick={() => { selectedProfiles = []; }}>
                                Clear
                            </button>
                        </div>
                    {/if}
                </div>
            </div>

            <!-- ── Right: Form config + Run options ── -->
            <div class="setup-right">

                <!-- Form Config -->
                <div class="setup-card">
                    <div class="card-title clickable" onclick={() => { showFormConfig = !showFormConfig; }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <rect x="1.5" y="2.5" width="9" height="7" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
                            <path d="M4 5.5h4M4 7.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                        </svg>
                        Form Selectors
                        <span class="collapse-arrow" class:open={showFormConfig}>›</span>
                        {#if targetUrl}
                            <button class="btn btn-ghost btn-sm ml-auto"
                                onclick={(e) => { e.stopPropagation(); applyPreset(); }}
                                disabled={isScrapingForm}>
                                {isScrapingForm ? "Scraping..." : "Auto-fill"}
                            </button>
                        {/if}
                    </div>

                    {#if showFormConfig}
                    <div class="form-fields fade-in">
                        {#if scrapeSuccess}
                            <div class="message message-success">
                                {scrapeSuccess}
                            </div>
                        {/if}
                        {#if scrapeError}
                            <div class="message message-error">
                                <div class="error-title">
                                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="vertical-align: middle; margin-right: 6px;">
                                        <circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.5"/>
                                        <path d="M7 4v3M7 10a0.5 0.5 0 1 1 0 1 0.5 0.5 0 0 1 0 -1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                                    </svg>
                                    {scrapeError}
                                </div>
                                <div class="error-help">
                                    <strong>Need help?</strong>
                                    <ul>
                                        <li>Ensure Tauri bridge is running: <code>npm run bridge</code></li>
                                        <li>Open DevTools (F12) → Inspector to manually find selectors</li>
                                        <li>Check browser console for detailed error logs</li>
                                        <li>See <a href="FORM_SCRAPER_TROUBLESHOOTING.md" target="_blank">troubleshooting guide</a></li>
                                    </ul>
                                </div>
                            </div>
                        {/if}
                        <div class="field-grid-2">
                            <div class="field-group">
                                <label class="field-label">Username / Email field <span class="req">*</span></label>
                                <input class="input mono" bind:value={usernameSelector}
                                    placeholder='input[name="email"], #email'/>
                            </div>
                            <div class="field-group">
                                <label class="field-label">Password field <span class="req">*</span></label>
                                <input class="input mono" bind:value={passwordSelector}
                                    placeholder='input[type="password"]'/>
                            </div>
                            <div class="field-group">
                                <label class="field-label">Submit button <span class="req">*</span></label>
                                <input class="input mono" bind:value={submitSelector}
                                    placeholder='button[type="submit"]'/>
                            </div>
                            <div class="field-group">
                                <label class="field-label">Success indicator</label>
                                <input class="input mono" bind:value={successSelector}
                                    placeholder=".dashboard, #home-feed"/>
                            </div>
                            <div class="field-group">
                                <label class="field-label">Failure indicator</label>
                                <input class="input mono" bind:value={failureSelector}
                                    placeholder=".error-message, #login-error"/>
                            </div>
                            <div class="field-group">
                                <label class="field-label">CAPTCHA detector</label>
                                <input class="input mono" bind:value={captchaSelector}
                                    placeholder=".g-recaptcha, .h-captcha"/>
                            </div>
                            <div class="field-group">
                                <label class="field-label">Consent banner (auto-dismiss)</label>
                                <input class="input mono" bind:value={consentSelector}
                                    placeholder="#accept-cookies, .consent-btn"/>
                            </div>
                            <div class="field-group">
                                <label class="field-label">TOTP / 2FA field</label>
                                <input class="input mono" bind:value={totpSelector}
                                    placeholder='input[name="otp"]'/>
                            </div>
                        </div>

                        <div class="field-grid-2 mt">
                            <div class="field-group">
                                <label class="field-label">Page load timeout (ms)</label>
                                <input class="input mono" type="number" min="3000" max="60000" step="1000"
                                    bind:value={pageLoadTimeout}/>
                            </div>
                            <div class="field-group">
                                <label class="field-label">Post-submit timeout (ms)</label>
                                <input class="input mono" type="number" min="2000" max="30000" step="1000"
                                    bind:value={postSubmitTimeout}/>
                            </div>
                        </div>

                        <label class="toggle-row">
                            <input type="checkbox" bind:checked={exportSession}/>
                            <span>Export session state on success (cookies + localStorage + IDB)</span>
                        </label>
                    </div>
                    {/if}
                </div>

                <!-- Anti-detect / Run options -->
                <div class="setup-card">
                    <div class="card-title">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <path d="M6 1.5L1.5 4v4l4.5 2.5 4.5-2.5V4L6 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                        </svg>
                        Anti-Detect &amp; Run Options
                    </div>

                    <div class="options-grid">
                        <label class="toggle-row">
                            <input type="checkbox" bind:checked={domainAwareNoise}/>
                            <span>Domain-aware canvas/audio/font noise</span>
                            {#if domainProfile}
                                <span class="tag tag-accent">{domainProfile.threat_level}</span>
                            {/if}
                        </label>

                        <label class="toggle-row">
                            <input type="checkbox" bind:checked={patchTls}/>
                            <span>Patch TLS stack (JA3/JA4 hardening)</span>
                            {#if domainProfile?.tls_fingerprint_sensitive}
                                <span class="tag tag-warn">recommended</span>
                            {/if}
                        </label>

                        <label class="toggle-row">
                            <input type="checkbox" bind:checked={rotateEvery}/>
                            <span>Rotate proxy + fingerprint every attempt</span>
                        </label>
                    </div>

                    <div class="field-grid-2 mt">
                        <div class="field-group">
                            <label class="field-label">Soft signal threshold</label>
                            <input class="input mono" type="number" min="1" max="10"
                                bind:value={softThreshold}/>
                            <span class="field-hint">Rotate after N soft signals</span>
                        </div>
                        <div class="field-group">
                            <label class="field-label">Max retries</label>
                            <input class="input mono" type="number" min="0" max="10"
                                bind:value={maxRetries}/>
                            <span class="field-hint">For error / soft-blocked creds</span>
                        </div>
                        <div class="field-group">
                            <label class="field-label">Mode</label>
                            <select class="input" bind:value={runMode}>
                                <option value="sequential">Sequential</option>
                                <option value="parallel">Parallel</option>
                            </select>
                        </div>
                        <div class="field-group">
                            <label class="field-label">Concurrency</label>
                            <input class="input mono" type="number" min="1" max="8"
                                bind:value={concurrency} disabled={runMode !== "parallel"}/>
                        </div>
                        <div class="field-group">
                            <label class="field-label">Launch delay (ms)</label>
                            <input class="input mono" type="number" min="500" max="60000" step="500"
                                bind:value={launchDelay}/>
                            <span class="field-hint">Gap between attempts</span>
                        </div>
                    </div>
                </div>

                <!-- Launch -->
                <div class="launch-block">
                    {#if !canStart}
                        <div class="launch-hint">
                            {#if drafts.length === 0}
                                <span>Add credentials to begin</span>
                            {:else if !targetUrl}
                                <span>Enter target URL</span>
                            {:else if !usernameSelector || !passwordSelector || !submitSelector}
                                <span>Fill required form selectors</span>
                            {:else if selectedProfiles.length === 0}
                                <span>Select at least one profile</span>
                            {/if}
                        </div>
                    {/if}
                    <button class="btn btn-primary btn-lg launch-btn"
                        onclick={handleStart}
                        disabled={!canStart}>
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <path d="M2.5 1.5l9 5-9 5V1.5z" fill="currentColor"/>
                        </svg>
                        Launch {drafts.length > 0 ? `(${drafts.length} credential${drafts.length !== 1 ? "s" : ""})` : ""}
                    </button>
                </div>

            </div><!-- /.setup-right -->
        </div><!-- /.setup-layout -->

        <!-- ════════════════════════════════════════════════ RUN TAB ══ -->
        {:else if activeTab === "run"}
        <div class="run-layout">
            {#if !activeRun}
                <div class="empty" style="flex:1">
                    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" opacity="0.2">
                        <path d="M6 4l24 14L6 32V4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span class="empty-title">No active run</span>
                    <span class="empty-hint">Configure and launch a run from the Setup tab.</span>
                    <button class="btn btn-primary btn-sm" onclick={() => { activeTab = "setup"; }}>
                        Go to Setup →
                    </button>
                </div>
            {:else}
                {@const run = activeRun}

                <!-- Progress bar -->
                <div class="progress-bar-wrap">
                    <div class="progress-bar-track">
                        <div class="progress-bar-fill success"
                            style:width="{(run.stats.success / run.stats.total) * 100}%"></div>
                        <div class="progress-bar-fill failed"
                            style:width="{(run.stats.failed / run.stats.total) * 100}%"></div>
                        <div class="progress-bar-fill blocked"
                            style:width="{((run.stats.soft_blocked + run.stats.hard_blocked) / run.stats.total) * 100}%"></div>
                        <div class="progress-bar-fill error"
                            style:width="{(run.stats.error / run.stats.total) * 100}%"></div>
                    </div>
                    <span class="progress-pct mono">{progressPct(run.stats)}%</span>
                </div>

                <!-- Target info -->
                <div class="run-meta">
                    <span class="run-target mono truncate">{run.config.form.url}</span>
                    {#if run.config.domain_profile}
                        <span class="tag" style:color={threatColor}>{run.config.domain_profile.threat_level}</span>
                    {/if}
                    {#if run.config.patch_tls}
                        <span class="tag tag-accent">TLS patched</span>
                    {/if}
                    {#if run.config.domain_aware_noise}
                        <span class="tag tag-accent">domain noise</span>
                    {/if}
                    <span class="run-time mono">{relTime(run.started_at)}</span>
                </div>

                <!-- Results filtering -->
                <div class="results-filter-bar">
                    <div class="filter-search">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                            <circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.1"/>
                            <path d="M9 9l2 2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                        </svg>
                        <input
                            type="text"
                            placeholder="Search username, URL..."
                            bind:value={resultSearchQuery}
                            class="filter-input"
                        />
                    </div>

                    <div class="filter-buttons">
                        <select class="filter-select" bind:value={resultStatusFilter}>
                            <option value="all">All Status</option>
                            <option value="success">✓ Success</option>
                            <option value="failed">✗ Failed</option>
                            <option value="blocked">⊘ Blocked</option>
                            <option value="error">! Error</option>
                        </select>

                        <select class="filter-select" bind:value={resultOutcomeFilter}>
                            <option value="all">All Outcomes</option>
                            <option value="success">Success</option>
                            <option value="wrong_credentials">Wrong Creds</option>
                            <option value="captcha_block">CAPTCHA</option>
                            <option value="rate_limited">Rate Limited</option>
                            <option value="ip_blocked">IP Blocked</option>
                            <option value="timeout">Timeout</option>
                            <option value="error">Error</option>
                        </select>

                        <select class="filter-select" bind:value={sortBy}>
                            <option value="index">Sort by Index</option>
                            <option value="username">Sort by Username</option>
                            <option value="status">Sort by Status</option>
                            <option value="duration">Sort by Duration</option>
                        </select>

                        <button
                            class="icon-btn"
                            title={sortAsc ? "Ascending" : "Descending"}
                            onclick={() => { sortAsc = !sortAsc; }}
                        >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                {#if sortAsc}
                                    <path d="M6 1v10M2 6l4-4 4 4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
                                {:else}
                                    <path d="M6 11V1M2 6l4 4 4-4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
                                {/if}
                            </svg>
                        </button>
                    </div>

                    <span class="filter-count">{filterResults(run.credentials, run.results, run).length} / {run.credentials.length}</span>
                </div>

                <!-- Results table -->
                <div class="results-table-wrap">
                    <table class="results-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Username</th>
                                <th>Status</th>
                                <th>Outcome</th>
                                <th>Profile</th>
                                <th>Duration</th>
                                <th>Signals</th>
                                <th>Rotations</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each filterResults(run.credentials, run.results, run) as item (item.cred.id)}
                                {@const cred = item.cred}
                                {@const result = item.result}
                                <tr class:row-success={cred.status === "success"}
                                    class:row-running={cred.status === "running"}
                                    class:row-error={cred.status === "failed" || cred.status === "hard_blocked"}>
                                    <td class="mono muted">{item.index + 1}</td>
                                    <td>
                                        <span class="cred-cell mono truncate" title={cred.username}>
                                            {truncate(cred.username, 28)}
                                        </span>
                                    </td>
                                    <td>
                                        <span class="pill {statusClass(cred.status)}">{cred.status}</span>
                                    </td>
                                    <td>
                                        {#if result}
                                            <span class="pill {outcomeClass(result.outcome)}">{result.outcome}</span>
                                        {:else}
                                            <span class="muted">—</span>
                                        {/if}
                                    </td>
                                    <td>
                                        <span class="mono muted" title={cred.profile_id ?? ""}>
                                            {cred.profile_id ? cred.profile_id.slice(0, 8) : "—"}
                                        </span>
                                    </td>
                                    <td>
                                        <span class="mono muted">
                                            {result ? fmtMs(result.duration_ms) : "—"}
                                        </span>
                                    </td>
                                    <td>
                                        {#if result?.signals_detected?.length}
                                            <div class="signals-cell">
                                                {#each result.signals_detected as sig}
                                                    <span class="tag tag-warn signal-tag">{sig.replace(/_/g, " ")}</span>
                                                {/each}
                                            </div>
                                        {:else}
                                            <span class="muted">—</span>
                                        {/if}
                                    </td>
                                    <td>
                                        <span class="mono muted">
                                            {result?.rotation_events?.length ?? 0}
                                        </span>
                                    </td>
                                    <td>
                                        <div class="row-action-btns">
                                            {#if result?.screenshot}
                                                <button class="icon-btn" title="Screenshot"
                                                    onclick={() => { showScreenshot = result.screenshot ?? null; }}>
                                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                                        <rect x="1" y="2" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.1"/>
                                                        <circle cx="5" cy="5" r="1.5" fill="currentColor"/>
                                                    </svg>
                                                </button>
                                            {/if}
                                            {#if result?.session_exported && result.session_state}
                                                <button class="icon-btn accent" title="Download session"
                                                    onclick={() => automationStore.downloadSessionState(result!.session_state!)}>
                                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                                        <path d="M5 1v6M2 7l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                                                        <path d="M1 9h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                                                    </svg>
                                                </button>
                                            {/if}
                                            {#if result}
                                                <button class="icon-btn" title="Detail"
                                                    onclick={() => { expandedResult = expandedResult === result.id ? null : result.id; }}>
                                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                                        <path d="M1 5h8M5 1v8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.6"/>
                                                    </svg>
                                                </button>
                                            {/if}
                                            {#if cred.status === "pending"}
                                                <button class="icon-btn danger" title="Skip"
                                                    onclick={() => automationStore.skipCredential(run.id, cred.id)}>
                                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                                        <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                                                    </svg>
                                                </button>
                                            {/if}
                                        </div>
                                    </td>
                                </tr>
                                <!-- Expanded result detail row -->
                                {#if result && expandedResult === result.id}
                                    <tr class="detail-row">
                                        <td colspan="9">
                                            <div class="detail-expand fade-in">
                                                <div class="detail-kv-grid">
                                                    <div class="dkv">
                                                        <span class="dkv-k">Final URL</span>
                                                        <span class="dkv-v mono truncate">{result.final_url || "—"}</span>
                                                    </div>
                                                    <div class="dkv">
                                                        <span class="dkv-k">Started</span>
                                                        <span class="dkv-v mono">{relTime(result.started_at)}</span>
                                                    </div>
                                                    <div class="dkv">
                                                        <span class="dkv-k">Detail</span>
                                                        <span class="dkv-v">{result.detail || "—"}</span>
                                                    </div>
                                                    <div class="dkv">
                                                        <span class="dkv-k">Session</span>
                                                        <span class="dkv-v">{result.session_exported ? "Exported" : "Not exported"}</span>
                                                    </div>
                                                    {#if result.rotation_events?.length > 0}
                                                        <div class="dkv" style="grid-column:1/-1">
                                                            <span class="dkv-k">Rotations</span>
                                                            <div class="rotation-log">
                                                                {#each result.rotation_events as evt}
                                                                    <div class="rot-entry">
                                                                        <span class="tag tag-warn">{evt.trigger}</span>
                                                                        <span class="mono muted">{evt.old_profile_id.slice(0,8)} → {evt.new_profile_id.slice(0,8)}</span>
                                                                        <span class="muted">{evt.details}</span>
                                                                    </div>
                                                                {/each}
                                                            </div>
                                                        </div>
                                                    {/if}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                {/if}
                            {/each}
                        </tbody>
                    </table>
                </div>

                <!-- Rotation log -->
                {#if run.rotation_log.length > 0}
                    <div class="rotation-panel">
                        <div class="panel-title">Rotation Log — {run.rotation_log.length} event{run.rotation_log.length !== 1 ? "s" : ""}</div>
                        <div class="rot-log-list">
                            {#each run.rotation_log.slice().reverse() as evt}
                                <div class="rot-log-entry">
                                    <span class="mono muted">{relTime(new Date(evt.ts).toISOString())}</span>
                                    <span class="tag tag-warn">{evt.trigger.replace(/_/g, " ")}</span>
                                    <span class="mono" style="font-size:10px">{evt.old_profile_id.slice(0,8)} → {evt.new_profile_id.slice(0,8)}</span>
                                    {#if evt.old_proxy_id || evt.new_proxy_id}
                                        <span class="mono muted" style="font-size:10px">proxy rotated</span>
                                    {/if}
                                    <span class="muted" style="font-size:10px">{evt.details}</span>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}
            {/if}
        </div><!-- /.run-layout -->

        <!-- ════════════════════════════════════════════════ HISTORY TAB ══ -->
        {:else if activeTab === "history"}
        <div class="history-layout">
            {#if runs.length === 0}
                <div class="empty" style="flex:1">
                    <span class="empty-title">No runs yet</span>
                    <span class="empty-hint">Completed runs appear here.</span>
                </div>
            {:else}
                {#each runs as run (run.id)}
                    <div class="history-card"
                        class:active={activeRun?.id === run.id}
                        onclick={() => { automationStore.setActiveRun(run.id); activeTab = "run"; }}>
                        <div class="history-card-header">
                            <span class="mono truncate" style="font-size:11px">{truncate(run.config.form.url, 40)}</span>
                            <div class="history-status">
                                <span class="pill {run.status === 'completed' ? 'pill-success' : run.status === 'running' ? 'pill-accent' : run.status === 'paused' ? 'pill-warn' : 'pill-muted'}">{run.status}</span>
                                <button class="icon-btn danger" onclick={(e) => { e.stopPropagation(); automationStore.deleteRun(run.id); }}>
                                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                                        <path d="M1.5 2.5h6M3.5 2.5V1.5h2v1M2 2.5l.5 5h4l.5-5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div class="history-stats">
                            <span class="stat-chip success"><span class="stat-n">{run.stats.success}</span><span class="stat-l">hit</span></span>
                            <span class="stat-chip error"><span class="stat-n">{run.stats.failed}</span><span class="stat-l">fail</span></span>
                            <span class="stat-chip warn"><span class="stat-n">{run.stats.soft_blocked}</span><span class="stat-l">block</span></span>
                            <span class="stat-chip muted"><span class="stat-n">{run.stats.total}</span><span class="stat-l">total</span></span>
                        </div>
                        <div class="history-meta">
                            <span class="muted" style="font-size:10px">{relTime(run.started_at)}</span>
                            <div class="history-actions" onclick={(e) => e.stopPropagation()}>
                                <button class="btn btn-ghost btn-sm"
                                    onclick={() => automationStore.downloadRunReport(run.id)}>↓ Report</button>
                                <button class="btn btn-ghost btn-sm"
                                    onclick={() => automationStore.downloadSuccessCreds(run.id)}>↓ Hits</button>
                            </div>
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
        {/if}

    </div><!-- /.page-body -->
</div><!-- /.page -->

<style>
    /* ── Layout ────────────────────────────────────────────────── */

    .page {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .page-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--border-subtle);
        flex-shrink: 0;
        flex-wrap: wrap;
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
    }

    .page-body {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
    }

    /* ── Run badge ─────────────────────────────────────────────── */

    .run-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 10px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }

    .run-badge-live {
        color: var(--accent);
    }

    /* ── Stats strip ───────────────────────────────────────────── */

    .stats-strip {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }

    .stat-chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 8px;
        border-radius: 99px;
        background: var(--surface-3);
        border: 1px solid var(--border);
        font-size: 10px;
    }

    .stat-chip.success { background: var(--success-glow); border-color: var(--success-dim); }
    .stat-chip.error   { background: var(--error-glow);   border-color: var(--error-dim);   }
    .stat-chip.warn    { background: var(--warning-glow); border-color: var(--warning-dim); }
    .stat-chip.accent  { background: var(--accent-glow);  border-color: var(--accent-muted); }
    .stat-chip.muted   { background: var(--surface-3);    border-color: var(--border); }

    .stat-n {
        font-weight: 700;
        font-family: 'JetBrains Mono', monospace;
        color: var(--text-primary);
    }

    .stat-l {
        color: var(--text-muted);
    }

    /* ── Tabs ──────────────────────────────────────────────────── */

    .tab-bar {
        display: flex;
        align-items: stretch;
        border-bottom: 1px solid var(--border-subtle);
        flex-shrink: 0;
        background: var(--surface-1);
    }

    .tab {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 0 16px;
        height: 34px;
        font-size: 12px;
        font-weight: 500;
        color: var(--text-muted);
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        transition: color 0.12s, border-color 0.12s;
        letter-spacing: 0.01em;
    }

    .tab:hover { color: var(--text-secondary); }
    .tab.active { color: var(--text-primary); border-bottom-color: var(--accent); }

    .tab-pip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        min-width: 16px;
        height: 14px;
        border-radius: 99px;
        font-size: 10px;
        font-weight: 600;
    }

    .tab-pip.live    { color: var(--success); font-size: 8px; animation: pulse-dot 2s ease-in-out infinite; }
    .tab-pip.neutral { background: var(--surface-4); color: var(--text-muted); }

    /* ── Setup layout ──────────────────────────────────────────── */

    .setup-layout {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        padding: 16px;
        min-height: 100%;
        align-items: start;
    }

    @media (max-width: 900px) {
        .setup-layout { grid-template-columns: 1fr; }
    }

    .setup-left, .setup-right {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    /* ── Setup cards ───────────────────────────────────────────── */

    .setup-card {
        background: var(--surface-1);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius);
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .card-title {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.07em;
    }

    .card-title.clickable {
        cursor: pointer;
        user-select: none;
    }

    .card-title.clickable:hover {
        color: var(--text-primary);
    }

    .card-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 6px;
        height: 16px;
        border-radius: 99px;
        font-size: 10px;
        background: var(--accent-glow);
        color: var(--accent);
        border: 1px solid var(--accent-muted);
        font-weight: 700;
    }

    .card-hint {
        font-size: 11px;
        color: var(--text-muted);
        line-height: 1.5;
    }

    .collapse-arrow {
        font-size: 14px;
        color: var(--text-muted);
        transition: transform 0.15s;
        display: inline-block;
    }

    .collapse-arrow.open { transform: rotate(90deg); }

    .ml-auto { margin-left: auto; }

    /* ── Domain badge ──────────────────────────────────────────── */

    .domain-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        background: var(--surface-2);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
        flex-wrap: wrap;
    }

    .domain-host {
        font-size: 11px;
        color: var(--text-secondary);
        flex-shrink: 0;
    }

    .domain-threat {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        flex-shrink: 0;
    }

    /* ── Import mode buttons ───────────────────────────────────── */

    .import-mode-row {
        display: flex;
        gap: 4px;
    }

    .mode-btn {
        padding: 3px 12px;
        font-size: 11px;
        font-weight: 500;
        color: var(--text-muted);
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.1s;
    }

    .mode-btn.active {
        background: var(--accent-glow);
        color: var(--accent);
        border-color: var(--accent-muted);
    }

    /* ── Credential textarea ───────────────────────────────────── */

    .cred-textarea {
        font-size: 11px;
        min-height: 120px;
        line-height: 1.6;
        resize: vertical;
    }

    .import-actions {
        display: flex;
        gap: 6px;
    }

    /* ── Drop zone ─────────────────────────────────────────────── */

    .drop-zone {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 28px 16px;
        border: 1px dashed var(--border-hover);
        border-radius: var(--radius);
        font-size: 12px;
        color: var(--text-muted);
        transition: border-color 0.12s, background 0.12s;
        cursor: default;
    }

    .drop-zone.drag-over {
        border-color: var(--accent);
        background: var(--accent-glow);
        color: var(--accent);
    }

    .upload-label {
        cursor: pointer;
    }

    /* ── Error banner ──────────────────────────────────────────── */

    .error-banner {
        font-size: 11px;
        color: var(--error);
        background: var(--error-glow);
        border: 1px solid var(--error-dim);
        border-radius: var(--radius-sm);
        padding: 6px 10px;
    }

    /* ── Results filter bar ────────────────────────────────────── */

    .results-filter-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
        background: var(--surface-1);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius);
        margin-bottom: 12px;
        flex-wrap: wrap;
    }

    .filter-search {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 200px;
        padding: 6px 10px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-muted);
        transition: border-color 0.12s, color 0.12s;
    }

    .filter-search:focus-within {
        border-color: var(--accent);
        color: var(--text-primary);
    }

    .filter-input {
        flex: 1;
        font-size: 11px;
        background: transparent;
        border: none;
        color: var(--text-primary);
        outline: none;
    }

    .filter-input::placeholder {
        color: var(--text-muted);
    }

    .filter-buttons {
        display: flex;
        gap: 6px;
        align-items: center;
        flex-wrap: wrap;
    }

    .filter-select {
        padding: 4px 8px;
        font-size: 11px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        cursor: pointer;
        transition: border-color 0.12s, background 0.12s;
    }

    .filter-select:hover {
        border-color: var(--border-hover);
        background: var(--surface-3);
    }

    .filter-select:focus {
        outline: none;
        border-color: var(--accent);
    }

    .filter-count {
        font-size: 11px;
        color: var(--text-muted);
        padding: 4px 8px;
        background: var(--surface-2);
        border-radius: var(--radius-sm);
        border: 1px solid var(--border-subtle);
    }

    /* ── Results table ─────────────────────────────────────────── */

    .results-table-wrap {
        overflow-x: auto;
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius);
        background: var(--surface-1);
    }

    .results-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
    }

    .results-table th,
    .results-table td {
        padding: 8px 10px;
        text-align: left;
        border-bottom: 1px solid var(--border-subtle);
    }

    .results-table th {
        background: var(--surface-2);
        font-weight: 600;
        color: var(--text-secondary);
        white-space: nowrap;
        position: sticky;
        top: 0;
    }

    .results-table tbody tr {
        transition: background 0.1s;
    }

    .results-table tbody tr:hover {
        background: var(--surface-2);
    }

    .results-table tr.row-success {
        background: var(--success-glow);
    }

    .results-table tr.row-success:hover {
        background: var(--success-dim);
    }

    .results-table tr.row-error {
        background: var(--error-glow);
    }

    .results-table tr.row-error:hover {
        background: var(--error-dim);
    }

    .results-table tr.row-running {
        background: var(--accent-glow);
    }

    .results-table tr.detail-row {
        background: var(--surface-3);
    }

    .results-table tr.detail-row:hover {
        background: var(--surface-3);
    }

    .cred-cell {
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .detail-expand {
        padding: 12px;
    }

    .detail-kv-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 16px;
    }

    .dkv {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .dkv-k {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .dkv-v {
        font-size: 11px;
        color: var(--text-primary);
    }

    .rotation-log {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 6px;
    }

    .rot-entry {
        display: flex;
        gap: 8px;
        align-items: center;
        font-size: 10px;
        padding: 6px 8px;
        background: var(--surface-2);
        border-radius: var(--radius-sm);
        border-left: 2px solid var(--accent);
    }

    .row-action-btns {
        display: flex;
        gap: 4px;
        justify-content: flex-end;
    }

    .signals-cell {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .signal-tag {
        font-size: 9px;
        padding: 2px 6px;
    }

    /* ── Message and error help ────────────────────────────────── */

    .message {
        padding: 12px;
        border-radius: var(--radius-sm);
        font-size: 11px;
        line-height: 1.5;
    }

    .message-success {
        background: var(--success-glow);
        color: var(--success);
        border: 1px solid var(--success-dim);
    }

    .message-error {
        background: var(--error-glow);
        color: var(--error);
        border: 1px solid var(--error-dim);
    }

    .error-title {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        font-weight: 500;
    }

    .error-help {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--error-dim);
        font-size: 10px;
    }

    .error-help strong {
        display: block;
        margin-bottom: 6px;
        font-weight: 600;
    }

    .error-help ul {
        margin: 0;
        padding-left: 18px;
        list-style: disc;
    }

    .error-help li {
        margin-bottom: 4px;
        line-height: 1.4;
    }

    .error-help code {
        background: rgba(0, 0, 0, 0.1);
        padding: 2px 4px;
        border-radius: 3px;
        font-family: monospace;
        font-size: 9px;
    }

    .error-help a {
        color: currentColor;
        text-decoration: underline;
    }

    .error-help a:hover {
        opacity: 0.8;
    }

    /* ── Credential list ───────────────────────────────────────── */
</style>
