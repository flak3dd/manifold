<script lang="ts">
    import { onMount } from "svelte";
    import type {
        Profile,
        Fingerprint,
        ProfileTarget,
        BehaviorProfile,
        TargetTag,
    } from "$lib/types";
    import {
        PLATFORM_PRESETS,
        QUICK_PRESETS,
        TARGET_SUGGESTIONS,
        TARGET_TAG_OPTIONS,
        SCREEN_PRESETS,
        OS_OPTIONS,
        BROWSER_OPTIONS,
        resolvePlatform,
    } from "$lib/constants/platforms";
    import {
        profileStore,
        encodeTarget,
        suggestName,
    } from "$lib/stores/profiles.svelte";
    import { proxyStore } from "$lib/stores/proxy.svelte";

    // ── Props ────────────────────────────────────────────────────────────────────

    let {
        mode = "create" as "create" | "edit",
        profile = null as Profile | null,
        onClose,
        onSaved,
    }: {
        mode?: "create" | "edit";
        profile?: Profile | null;
        onClose: () => void;
        onSaved?: (p: Profile) => void;
    } = $props();

    // ── Tabs ─────────────────────────────────────────────────────────────────────

    type Tab = "target" | "base" | "network" | "fingerprint";
    let activeTab = $state<Tab>("target");

    const TABS: { id: Tab; label: string; emoji: string }[] = [
        { id: "target", label: "Target", emoji: "🎯" },
        { id: "base", label: "Base", emoji: "🖥️" },
        { id: "network", label: "Network", emoji: "🌐" },
        { id: "fingerprint", label: "Fingerprint", emoji: "🔑" },
    ];

    // ── Target tab ───────────────────────────────────────────────────────────────

    let targetUrl = $state("");
    let targetTags = $state<TargetTag[]>([]);
    let optimizeForTarget = $state(false);
    let showSuggestions = $state(false);
    let previewVisible = $state(false);

    let filteredSuggestions = $derived(
        TARGET_SUGGESTIONS.filter(
            (s) =>
                (!targetUrl ||
                    s.toLowerCase().includes(targetUrl.toLowerCase())) &&
                s !== targetUrl,
        ).slice(0, 7),
    );

    let resolvedPreset = $derived(
        targetUrl ? resolvePlatform(targetUrl) : null,
    );
    let targetPlatform = $derived(resolvedPreset?.label ?? null);
    let riskSignals = $derived(resolvedPreset?.risk_signals ?? []);
    let threatLevel = $derived(resolvedPreset?.threat_level ?? "low");
    let threatColor = $derived(
        (
            {
                low: "var(--success)",
                medium: "var(--warning)",
                high: "#f97316",
                critical: "var(--error)",
            } as Record<string, string>
        )[threatLevel],
    );

    function toggleTag(tag: TargetTag) {
        targetTags = targetTags.includes(tag)
            ? targetTags.filter((t) => t !== tag)
            : [...targetTags, tag];
    }

    // ── Base tab ─────────────────────────────────────────────────────────────────

    let profileName = $state("");
    let selectedOs = $state("windows11");
    let selectedBrowser = $state("chrome132");
    let selectedLang = $state("en-US");
    let selectedTz = $state("America/New_York");
    let screenW = $state(1920);
    let screenH = $state(1080);
    let customScreen = $state(false);

    const LANG_OPTIONS = [
        { value: "en-US", label: "English (US)" },
        { value: "en-GB", label: "English (UK)" },
        { value: "en-AU", label: "English (AU)" },
        { value: "fr-FR", label: "French" },
        { value: "de-DE", label: "German" },
        { value: "es-ES", label: "Spanish (ES)" },
        { value: "es-MX", label: "Spanish (MX)" },
        { value: "pt-BR", label: "Portuguese (BR)" },
        { value: "ja-JP", label: "Japanese" },
        { value: "ko-KR", label: "Korean" },
        { value: "zh-CN", label: "Chinese (Simplified)" },
        { value: "ar-SA", label: "Arabic" },
    ];

    const TZ_OPTIONS = [
        { value: "America/New_York", label: "America/New_York (ET)" },
        { value: "America/Chicago", label: "America/Chicago (CT)" },
        { value: "America/Denver", label: "America/Denver (MT)" },
        { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
        { value: "America/Sao_Paulo", label: "America/Sao_Paulo" },
        { value: "Europe/London", label: "Europe/London (GMT)" },
        { value: "Europe/Paris", label: "Europe/Paris (CET)" },
        { value: "Europe/Berlin", label: "Europe/Berlin (CET)" },
        { value: "Europe/Moscow", label: "Europe/Moscow (MSK)" },
        { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
        { value: "Asia/Seoul", label: "Asia/Seoul (KST)" },
        { value: "Asia/Shanghai", label: "Asia/Shanghai (CST)" },
        { value: "Asia/Dubai", label: "Asia/Dubai (GST)" },
        { value: "Australia/Sydney", label: "Australia/Sydney (AEST)" },
    ];

    // ── Network tab ──────────────────────────────────────────────────────────────

    let selectedProxyId = $state<string | null>(null);
    let rotationMode = $state<"manual" | "interval" | "on_ban">("manual");
    let rotationIntervalMin = $state(30);
    let showBdPanel = $state(false);
    let bdCustomerId = $state("");
    let bdZone = $state("residential");
    let bdCountry = $state("");
    let bdMode = $state<"sticky" | "rotating">("rotating");
    let bdPassword = $state("");
    let bdAdding = $state(false);

    let proxies = $derived(proxyStore.proxies);

    async function addBrightDataProxy() {
        if (!bdCustomerId || !bdZone || !bdPassword) return;
        bdAdding = true;
        try {
            const cfg = {
                customer_id: bdCustomerId,
                zone: bdZone,
                country: bdCountry,
                mode: bdMode,
                password: bdPassword,
            };
            const px =
                bdMode === "sticky"
                    ? await proxyStore.addBrightDataSticky(cfg)
                    : await proxyStore.addBrightDataRotating(cfg);
            selectedProxyId = px.id;
            showBdPanel = false;
        } catch (e) {
            // surface error
        } finally {
            bdAdding = false;
        }
    }

    // ── Fingerprint tab ──────────────────────────────────────────────────────────

    let fp = $state<Fingerprint | null>(null);
    let seedHex = $state("");
    let seedMode = $state<"random" | "manual">("random");
    let canvasNoise = $state(0.04);
    let webglNoise = $state(0.04);
    let audioNoise = $state(0.003);
    let hwConcurrency = $state(8);
    let deviceMemory = $state(8);
    let webrtcMode = $state<"block" | "fake_mdns" | "passthrough">("fake_mdns");
    let uaMobile = $state(false);
    let behaviorProfile = $state<BehaviorProfile>("normal");
    let generatingFp = $state(false);
    let activePresetId = $state<string | null>(null);

    const HW_OPTIONS = [2, 4, 8, 16];
    const MEM_OPTIONS = [0.5, 1, 2, 4, 8];

    // Context-sorted quick presets — recommended one first when target is known
    let contextualPresets = $derived(() => {
        if (!resolvedPreset) return QUICK_PRESETS;
        const pid = resolvedPreset.id;
        return [...QUICK_PRESETS].sort((a, b) => {
            const am = a.id.startsWith(pid) ? -1 : 0;
            const bm = b.id.startsWith(pid) ? -1 : 0;
            return am - bm;
        });
    });

    async function regenerateFp() {
        generatingFp = true;
        errorMsg = null;
        try {
            const seed =
                seedMode === "manual"
                    ? parseInt(seedHex || "0", 16)
                    : undefined;
            const newFp = await profileStore.generateFingerprint(seed);
            fp = newFp;
            seedHex = (newFp.seed >>> 0).toString(16).padStart(8, "0");
            canvasNoise = newFp.canvas_noise;
            webglNoise = newFp.webgl_noise;
            audioNoise = newFp.audio_noise;
            hwConcurrency = newFp.hardware_concurrency;
            deviceMemory = newFp.device_memory;
            webrtcMode = newFp.webrtc_mode;
            uaMobile = newFp.ua_mobile;
            selectedTz = newFp.timezone;
            selectedLang =
                newFp.accept_language.split(",")[0]?.trim() ?? "en-US";
            screenW = newFp.screen_width;
            screenH = newFp.screen_height;
            activePresetId = null;
        } catch (e) {
            errorMsg = `Fingerprint generation failed: ${e}`;
        } finally {
            generatingFp = false;
        }
    }

    function applyQuickPreset(id: string) {
        const p = QUICK_PRESETS.find((q) => q.id === id);
        if (!p) return;
        activePresetId = id;
        const o = p.overrides;
        if (o.canvas_noise !== undefined) canvasNoise = o.canvas_noise;
        if (o.webgl_noise !== undefined) webglNoise = o.webgl_noise;
        if (o.audio_noise !== undefined) audioNoise = o.audio_noise;
        if (o.hardware_concurrency !== undefined)
            hwConcurrency = o.hardware_concurrency;
        if (o.device_memory !== undefined) deviceMemory = o.device_memory;
        if (o.ua_mobile !== undefined) uaMobile = o.ua_mobile;
        if (o.webrtc_mode !== undefined)
            webrtcMode = o.webrtc_mode as typeof webrtcMode;
        behaviorProfile = p.behavior_profile;
    }

    // ── Effects ──────────────────────────────────────────────────────────────────

    // Auto-apply optimizations when target changes and checkbox is on
    $effect(() => {
        if (optimizeForTarget && resolvedPreset) {
            const h = resolvedPreset.fp_hints;
            if (h.canvas_noise !== undefined) canvasNoise = h.canvas_noise;
            if (h.webgl_noise !== undefined) webglNoise = h.webgl_noise;
            if (h.audio_noise !== undefined) audioNoise = h.audio_noise;
            if (h.hardware_concurrency !== undefined)
                hwConcurrency = h.hardware_concurrency;
            if (h.device_memory !== undefined) deviceMemory = h.device_memory;
            if (h.ua_mobile !== undefined) uaMobile = h.ua_mobile;
            if (h.webrtc_mode !== undefined)
                webrtcMode = h.webrtc_mode as typeof webrtcMode;
            behaviorProfile = resolvedPreset.behavior_profile;
        }
    });

    // ── Global ───────────────────────────────────────────────────────────────────

    let saving = $state(false);
    let errorMsg = $state<string | null>(null);

    // ── Mount ────────────────────────────────────────────────────────────────────

    onMount(async () => {
        await proxyStore.loadProxies();

        if (mode === "edit" && profile) {
            if (profile.target) {
                targetUrl = profile.target.url ?? "";
                targetTags = profile.target.tags ?? [];
                optimizeForTarget = profile.target.optimized ?? false;
            }
            profileName = profile.name;
            selectedLang =
                profile.fingerprint.accept_language.split(",")[0]?.trim() ??
                "en-US";
            selectedTz = profile.fingerprint.timezone;
            screenW = profile.fingerprint.screen_width;
            screenH = profile.fingerprint.screen_height;
            selectedProxyId = profile.proxy_id ?? null;
            fp = { ...profile.fingerprint };
            seedHex = (profile.fingerprint.seed >>> 0)
                .toString(16)
                .padStart(8, "0");
            canvasNoise = profile.fingerprint.canvas_noise;
            webglNoise = profile.fingerprint.webgl_noise;
            audioNoise = profile.fingerprint.audio_noise;
            hwConcurrency = profile.fingerprint.hardware_concurrency;
            deviceMemory = profile.fingerprint.device_memory;
            webrtcMode = profile.fingerprint.webrtc_mode;
            uaMobile = profile.fingerprint.ua_mobile;
            behaviorProfile = profile.human.profile;
        } else {
            await regenerateFp();
        }
    });

    // ── Save ─────────────────────────────────────────────────────────────────────

    async function handleSave() {
        if (!fp) {
            errorMsg = "No fingerprint generated.";
            return;
        }
        saving = true;
        errorMsg = null;

        const mergedFp: Fingerprint = {
            ...fp,
            canvas_noise: canvasNoise,
            webgl_noise: webglNoise,
            audio_noise: audioNoise,
            hardware_concurrency: hwConcurrency,
            device_memory: deviceMemory,
            webrtc_mode: webrtcMode,
            ua_mobile: uaMobile,
            accept_language: selectedLang,
            timezone: selectedTz,
            screen_width: screenW,
            screen_height: screenH,
        };

        const target: ProfileTarget | undefined = targetUrl
            ? {
                  url: targetUrl,
                  platform: targetPlatform,
                  tags: targetTags,
                  optimized: optimizeForTarget,
                  snippet_ids: resolvedPreset?.snippet_ids ?? [],
              }
            : undefined;

        const geo =
            proxies.find((p) => p.id === selectedProxyId)?.country ?? "XX";
        const name = profileName.trim() || suggestName(target, geo, fp.seed);

        try {
            let saved: Profile;
            if (mode === "edit" && profile) {
                saved = await profileStore.updateProfile(
                    profile.id,
                    {
                        name,
                        fingerprint: mergedFp,
                        proxy_id: selectedProxyId,
                        behavior_profile: behaviorProfile,
                    },
                    target,
                );
            } else {
                saved = await profileStore.createProfile(
                    {
                        name,
                        seed: mergedFp.seed,
                        proxy_id: selectedProxyId ?? undefined,
                        behavior_profile: behaviorProfile,
                    },
                    target,
                );
                saved = await profileStore.updateProfile(
                    saved.id,
                    { fingerprint: mergedFp },
                    target,
                );
            }
            onSaved?.(saved);
            onClose();
        } catch (e) {
            errorMsg = String(e);
        } finally {
            saving = false;
        }
    }

    function noiseLabel(v: number) {
        if (v === 0) return "Off";
        if (v < 0.05) return "Minimal";
        if (v < 0.1) return "Low";
        if (v < 0.13) return "Medium";
        return "High";
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") onClose();
    }

    let canShowLaunch = $derived(mode === "edit" && !!profile);
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Backdrop -->
<div
    class="backdrop"
    onclick={onClose}
    role="presentation"
    aria-hidden="true"
></div>

<!-- Modal shell -->
<div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label={mode === "create" ? "New Profile" : "Edit Profile"}
>
    <!-- ── Header ── -->
    <header class="modal-header">
        <div class="header-meta">
            <h2 class="modal-title">
                {mode === "create" ? "New Profile" : "Edit Profile"}
            </h2>
            {#if targetUrl}
                <span
                    class="header-url-chip"
                    style="border-color:{threatColor};color:{threatColor}"
                >
                    {targetPlatform ?? targetUrl}
                </span>
            {/if}
        </div>
        <button class="icon-btn close-btn" onclick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                    d="M1 1l10 10M11 1L1 11"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                />
            </svg>
        </button>
    </header>

    <!-- ── Body (left form + right preview) ── -->
    <div class="modal-body">
        <!-- Left: tabs + form -->
        <div class="form-col">
            <!-- Tab bar -->
            <div class="tab-bar" role="tablist">
                {#each TABS as tab}
                    <button
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        class="tab-btn"
                        class:active={activeTab === tab.id}
                        onclick={() => {
                            activeTab = tab.id;
                        }}
                    >
                        <span class="tab-emoji">{tab.emoji}</span>
                        {tab.label}
                        {#if tab.id === "target" && resolvedPreset}
                            <span
                                class="threat-pip"
                                style="background:{threatColor}"
                            ></span>
                        {/if}
                    </button>
                {/each}
            </div>

            <!-- Tab panels -->
            <div class="tab-panel" role="tabpanel">
                <!-- ══════════ TARGET ══════════ -->
                {#if activeTab === "target"}
                    <!-- URL field -->
                    <div class="field-group">
                        <label class="field-label" for="target-url"
                            >Target URL / Domain</label
                        >
                        <div class="url-wrap">
                            <div class="url-row">
                                <svg
                                    class="url-globe"
                                    width="14"
                                    height="14"
                                    viewBox="0 0 14 14"
                                    fill="none"
                                >
                                    <circle
                                        cx="7"
                                        cy="7"
                                        r="6"
                                        stroke="currentColor"
                                        stroke-width="1.3"
                                    />
                                    <path
                                        d="M3.5 7h7M7 1.5c-2 1.5-2.5 3-2.5 5.5S5 11 7 12.5M7 1.5c2 1.5 2.5 3 2.5 5.5S9 11 7 12.5"
                                        stroke="currentColor"
                                        stroke-width="1.1"
                                    />
                                </svg>
                                <input
                                    id="target-url"
                                    type="text"
                                    class="url-input"
                                    placeholder="https://shopify.com  ·  tiktok.com  ·  custom domain…"
                                    bind:value={targetUrl}
                                    onfocus={() => {
                                        showSuggestions = true;
                                    }}
                                    onblur={() =>
                                        setTimeout(() => {
                                            showSuggestions = false;
                                        }, 160)}
                                    autocomplete="off"
                                    spellcheck={false}
                                />
                                {#if targetPlatform}
                                    <span
                                        class="detected-chip"
                                        style="color:{threatColor};border-color:color-mix(in srgb,{threatColor} 40%,transparent)"
                                    >
                                        {targetPlatform}
                                    </span>
                                {/if}
                            </div>

                            {#if showSuggestions && filteredSuggestions.length}
                                <ul class="suggestions" role="listbox">
                                    {#each filteredSuggestions as sug}
                                        <li>
                                            <button
                                                class="sug-item"
                                                role="option"
                                                aria-selected={targetUrl ===
                                                    sug}
                                                onmousedown={() => {
                                                    targetUrl = sug;
                                                    showSuggestions = false;
                                                }}
                                            >
                                                <span class="sug-url"
                                                    >{sug}</span
                                                >
                                                {#if resolvePlatform(sug)}
                                                    <span class="sug-platform"
                                                        >{resolvePlatform(sug)
                                                            ?.label}</span
                                                    >
                                                {/if}
                                            </button>
                                        </li>
                                    {/each}
                                </ul>
                            {/if}
                        </div>
                    </div>

                    <!-- Platform quick-pick -->
                    <div class="platform-grid">
                        {#each PLATFORM_PRESETS.slice(0, 8) as preset}
                            <button
                                class="plat-chip"
                                class:active={targetPlatform === preset.label}
                                onclick={() => {
                                    targetUrl = `https://${preset.domains[0]}`;
                                }}>{preset.label}</button
                            >
                        {/each}
                    </div>

                    <!-- Risk panel (appears when platform detected) -->
                    {#if resolvedPreset}
                        <div class="risk-panel">
                            <div class="risk-header">
                                <span class="risk-label">Threat level</span>
                                <span
                                    class="risk-badge"
                                    style="color:{threatColor};border-color:color-mix(in srgb,{threatColor} 35%,transparent);background:color-mix(in srgb,{threatColor} 12%,transparent)"
                                >
                                    {threatLevel.toUpperCase()}
                                </span>
                            </div>
                            <div class="risk-signals">
                                {#each riskSignals as sig}
                                    <span class="risk-sig">{sig}</span>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    <!-- Tags -->
                    <div class="field-group">
                        <span class="field-label">Session tags</span>
                        <div class="tag-grid">
                            {#each TARGET_TAG_OPTIONS as opt}
                                <button
                                    class="tag-toggle"
                                    class:on={targetTags.includes(
                                        opt.value as TargetTag,
                                    )}
                                    onclick={() =>
                                        toggleTag(opt.value as TargetTag)}
                                >
                                    <span>{opt.emoji}</span>{opt.label}
                                </button>
                            {/each}
                        </div>
                    </div>

                    <!-- Optimize checkbox -->
                    <label
                        class="optimize-row"
                        class:disabled={!resolvedPreset}
                    >
                        <input
                            type="checkbox"
                            bind:checked={optimizeForTarget}
                            disabled={!resolvedPreset}
                        />
                        <div>
                            <div class="opt-title">
                                Optimize for this target
                            </div>
                            <div class="opt-desc">
                                {#if resolvedPreset}
                                    Auto-tunes fingerprint aggression, behavior
                                    profile (<strong
                                        >{resolvedPreset.behavior_profile}</strong
                                    >), suggested geo (<strong
                                        >{resolvedPreset.suggested_geo}</strong
                                    >), and pre-selects relevant automation
                                    snippets.
                                {:else}
                                    Enter a recognized platform URL to enable
                                    automatic tuning.
                                {/if}
                            </div>
                        </div>
                    </label>

                    <!-- Preview button -->
                    <button
                        class="preview-btn"
                        class:active={previewVisible}
                        disabled={!targetUrl}
                        onclick={() => {
                            previewVisible = !previewVisible;
                        }}
                    >
                        <svg
                            width="13"
                            height="13"
                            viewBox="0 0 13 13"
                            fill="none"
                        >
                            <ellipse
                                cx="6.5"
                                cy="6.5"
                                rx="5.5"
                                ry="3.5"
                                stroke="currentColor"
                                stroke-width="1.3"
                            />
                            <circle
                                cx="6.5"
                                cy="6.5"
                                r="1.8"
                                fill="currentColor"
                            />
                        </svg>
                        {previewVisible ? "Hide Preview" : "Generate Preview"}
                    </button>

                    <!-- ══════════ BASE ══════════ -->
                {:else if activeTab === "base"}
                    <div class="field-group">
                        <label class="field-label" for="p-name"
                            >Profile name</label
                        >
                        <input
                            id="p-name"
                            type="text"
                            class="text-input"
                            placeholder={suggestName(
                                targetUrl
                                    ? {
                                          url: targetUrl,
                                          platform: targetPlatform,
                                          tags: targetTags,
                                          optimized: false,
                                          snippet_ids: [],
                                      }
                                    : undefined,
                                "US",
                                fp?.seed ?? 0,
                            )}
                            bind:value={profileName}
                        />
                        <span class="hint"
                            >Leave blank to auto-generate from target + geo +
                            seed</span
                        >
                    </div>

                    <div class="row-2">
                        <div class="field-group">
                            <label class="field-label" for="os-sel"
                                >Operating system</label
                            >
                            <select
                                id="os-sel"
                                class="select-input"
                                bind:value={selectedOs}
                            >
                                {#each OS_OPTIONS as os}
                                    <option value={os.value}>{os.label}</option>
                                {/each}
                            </select>
                        </div>
                        <div class="field-group">
                            <label class="field-label" for="br-sel"
                                >Browser</label
                            >
                            <select
                                id="br-sel"
                                class="select-input"
                                bind:value={selectedBrowser}
                            >
                                {#each BROWSER_OPTIONS as br}
                                    <option value={br.value}>{br.label}</option>
                                {/each}
                            </select>
                        </div>
                    </div>

                    <div class="row-2">
                        <div class="field-group">
                            <label class="field-label" for="lang-sel"
                                >Language pack</label
                            >
                            <select
                                id="lang-sel"
                                class="select-input"
                                bind:value={selectedLang}
                            >
                                {#each LANG_OPTIONS as l}
                                    <option value={l.value}>{l.label}</option>
                                {/each}
                            </select>
                        </div>
                        <div class="field-group">
                            <label class="field-label" for="tz-sel"
                                >Timezone</label
                            >
                            <select
                                id="tz-sel"
                                class="select-input"
                                bind:value={selectedTz}
                            >
                                {#each TZ_OPTIONS as tz}
                                    <option value={tz.value}>{tz.label}</option>
                                {/each}
                            </select>
                        </div>
                    </div>

                    <!-- Screen presets -->
                    <div class="field-group">
                        <span class="field-label">Screen resolution</span>
                        <div class="screen-chips">
                            {#each SCREEN_PRESETS as sp}
                                <button
                                    class="screen-chip"
                                    class:active={!customScreen &&
                                        screenW === sp.w &&
                                        screenH === sp.h}
                                    onclick={() => {
                                        screenW = sp.w;
                                        screenH = sp.h;
                                        customScreen = false;
                                    }}>{sp.label}</button
                                >
                            {/each}
                            <button
                                class="screen-chip"
                                class:active={customScreen}
                                onclick={() => {
                                    customScreen = true;
                                }}>Custom</button
                            >
                        </div>
                        {#if customScreen}
                            <div class="row-2" style="margin-top:8px">
                                <div class="field-group">
                                    <label class="field-label-sm" for="scr-w"
                                        >Width (px)</label
                                    >
                                    <input
                                        id="scr-w"
                                        type="number"
                                        class="text-input"
                                        bind:value={screenW}
                                        min="320"
                                        max="7680"
                                    />
                                </div>
                                <div class="field-group">
                                    <label class="field-label-sm" for="scr-h"
                                        >Height (px)</label
                                    >
                                    <input
                                        id="scr-h"
                                        type="number"
                                        class="text-input"
                                        bind:value={screenH}
                                        min="240"
                                        max="4320"
                                    />
                                </div>
                            </div>
                        {/if}
                    </div>

                    <!-- ══════════ NETWORK ══════════ -->
                {:else if activeTab === "network"}
                    <div class="field-group">
                        <label class="field-label" for="proxy-sel">Proxy</label>
                        {#if resolvedPreset && !selectedProxyId}
                            <div class="info-banner">
                                <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 12 12"
                                    fill="none"
                                >
                                    <circle
                                        cx="6"
                                        cy="6"
                                        r="5"
                                        stroke="var(--info)"
                                        stroke-width="1.3"
                                    />
                                    <path
                                        d="M6 4v2M6 7.5h.01"
                                        stroke="var(--info)"
                                        stroke-width="1.4"
                                        stroke-linecap="round"
                                    />
                                </svg>
                                Suggested geo for {resolvedPreset.label}:
                                <strong>{resolvedPreset.suggested_geo}</strong>
                            </div>
                        {/if}
                        <select
                            id="proxy-sel"
                            class="select-input"
                            bind:value={selectedProxyId}
                        >
                            <option value={null}
                                >— None (direct connection) —</option
                            >
                            {#each proxies as px}
                                <option value={px.id}>
                                    {px.healthy ? "●" : "○"}
                                    {px.name}{px.country
                                        ? ` [${px.country.toUpperCase()}]`
                                        : ""}{px.latency_ms != null
                                        ? ` · ${px.latency_ms}ms`
                                        : ""}
                                </option>
                            {/each}
                        </select>
                    </div>

                    <!-- Rotation policy -->
                    <div class="field-group">
                        <span class="field-label">Rotation policy</span>
                        <div class="seg-control">
                            {#each [["manual", "Manual"], ["interval", "Every X min"], ["on_ban", "On ban signal"]] as [v, l]}
                                <button
                                    class="seg-btn"
                                    class:active={rotationMode === v}
                                    onclick={() => {
                                        rotationMode = v as typeof rotationMode;
                                    }}>{l}</button
                                >
                            {/each}
                        </div>
                        {#if rotationMode === "interval"}
                            <div class="inline-field">
                                <label class="field-label-sm" for="rot-min"
                                    >Interval (minutes)</label
                                >
                                <input
                                    id="rot-min"
                                    type="number"
                                    class="text-input num-input"
                                    bind:value={rotationIntervalMin}
                                    min="1"
                                    max="1440"
                                />
                            </div>
                        {/if}
                    </div>

                    <!-- BrightData panel -->
                    <div class="field-group">
                        <button
                            class="section-toggle"
                            onclick={() => {
                                showBdPanel = !showBdPanel;
                            }}
                        >
                            <svg
                                class="chevron"
                                class:open={showBdPanel}
                                width="10"
                                height="10"
                                viewBox="0 0 10 10"
                                fill="none"
                            >
                                <path
                                    d="M2 3.5l3 3 3-3"
                                    stroke="currentColor"
                                    stroke-width="1.5"
                                    stroke-linecap="round"
                                />
                            </svg>
                            Add BrightData / Luminati proxy
                        </button>
                        {#if showBdPanel}
                            <div class="bd-panel">
                                <div class="row-2">
                                    <div class="field-group">
                                        <label
                                            class="field-label-sm"
                                            for="bd-cust">Customer ID</label
                                        >
                                        <input
                                            id="bd-cust"
                                            type="text"
                                            class="text-input"
                                            placeholder="hl_abc123"
                                            bind:value={bdCustomerId}
                                        />
                                    </div>
                                    <div class="field-group">
                                        <label
                                            class="field-label-sm"
                                            for="bd-zone">Zone</label
                                        >
                                        <input
                                            id="bd-zone"
                                            type="text"
                                            class="text-input"
                                            placeholder="residential"
                                            bind:value={bdZone}
                                        />
                                    </div>
                                </div>
                                <div class="row-2">
                                    <div class="field-group">
                                        <label
                                            class="field-label-sm"
                                            for="bd-country"
                                            >Country (ISO)</label
                                        >
                                        <input
                                            id="bd-country"
                                            type="text"
                                            class="text-input"
                                            placeholder="us"
                                            bind:value={bdCountry}
                                            maxlength="2"
                                        />
                                    </div>
                                    <div class="field-group">
                                        <label
                                            class="field-label-sm"
                                            for="bd-pass">Password</label
                                        >
                                        <input
                                            id="bd-pass"
                                            type="password"
                                            class="text-input"
                                            bind:value={bdPassword}
                                        />
                                    </div>
                                </div>
                                <div
                                    class="seg-control"
                                    style="margin-bottom:10px"
                                >
                                    {#each [["rotating", "Rotating"], ["sticky", "Sticky session"]] as [v, l]}
                                        <button
                                            class="seg-btn"
                                            class:active={bdMode === v}
                                            onclick={() => {
                                                bdMode = v as
                                                    | "sticky"
                                                    | "rotating";
                                            }}>{l}</button
                                        >
                                    {/each}
                                </div>
                                <button
                                    class="bd-add-btn"
                                    disabled={!bdCustomerId ||
                                        !bdZone ||
                                        !bdPassword ||
                                        bdAdding}
                                    onclick={addBrightDataProxy}
                                >
                                    {bdAdding
                                        ? "Adding…"
                                        : "+ Add BrightData proxy"}
                                </button>
                            </div>
                        {/if}
                    </div>

                    <!-- ══════════ FINGERPRINT ══════════ -->
                {:else if activeTab === "fingerprint"}
                    <!-- Seed row -->
                    <div class="field-group">
                        <span class="field-label">Seed</span>
                        <div class="seed-row">
                            <div class="seg-control seed-mode">
                                <button
                                    class="seg-btn"
                                    class:active={seedMode === "random"}
                                    onclick={() => {
                                        seedMode = "random";
                                    }}>Random</button
                                >
                                <button
                                    class="seg-btn"
                                    class:active={seedMode === "manual"}
                                    onclick={() => {
                                        seedMode = "manual";
                                    }}>Manual hex</button
                                >
                            </div>
                            {#if seedMode === "manual"}
                                <input
                                    type="text"
                                    class="text-input seed-input"
                                    placeholder="e.g. 1a2b3c4d"
                                    bind:value={seedHex}
                                    maxlength="16"
                                    spellcheck={false}
                                />
                            {:else}
                                <span class="seed-display mono"
                                    >{seedHex || "—"}</span
                                >
                            {/if}
                            <button
                                class="regen-btn"
                                class:spinning={generatingFp}
                                title="Regenerate fingerprint"
                                onclick={regenerateFp}
                                disabled={generatingFp}
                            >
                                <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 13 13"
                                    fill="none"
                                >
                                    <path
                                        d="M2 6.5A4.5 4.5 0 0 1 11 4.2"
                                        stroke="currentColor"
                                        stroke-width="1.6"
                                        stroke-linecap="round"
                                    />
                                    <path
                                        d="M9 2l2 2.2-2.2 2"
                                        stroke="currentColor"
                                        stroke-width="1.6"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                    />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- Quick presets — context-aware -->
                    <div class="field-group">
                        <span class="field-label">
                            Quick presets
                            {#if resolvedPreset}
                                <span class="label-hint"
                                    >· tuned for {resolvedPreset.label}</span
                                >
                            {/if}
                        </span>
                        <div class="preset-grid">
                            {#each contextualPresets() as preset}
                                <button
                                    class="preset-btn"
                                    class:active={activePresetId === preset.id}
                                    title={preset.description}
                                    onclick={() => applyQuickPreset(preset.id)}
                                >
                                    <span class="preset-emoji"
                                        >{preset.emoji}</span
                                    >
                                    <span class="preset-label"
                                        >{preset.label}</span
                                    >
                                </button>
                            {/each}
                        </div>
                    </div>

                    <!-- Canvas noise -->
                    <div class="field-group slider-group">
                        <div class="slider-header">
                            <span class="field-label">Canvas noise</span>
                            <span class="slider-val"
                                >{noiseLabel(canvasNoise)} ({(
                                    canvasNoise * 100
                                ).toFixed(1)}%)</span
                            >
                        </div>
                        <input
                            type="range"
                            class="slider"
                            min="0"
                            max="0.20"
                            step="0.005"
                            bind:value={canvasNoise}
                        />
                        <div class="slider-marks">
                            <span>Off</span><span>±3 px</span><span>±4 px</span>
                        </div>
                    </div>

                    <!-- WebGL noise -->
                    <div class="field-group slider-group">
                        <div class="slider-header">
                            <span class="field-label">WebGL spoof strength</span
                            >
                            <span class="slider-val"
                                >{noiseLabel(webglNoise)}</span
                            >
                        </div>
                        <input
                            type="range"
                            class="slider"
                            min="0"
                            max="0.20"
                            step="0.005"
                            bind:value={webglNoise}
                        />
                    </div>

                    <!-- Audio noise -->
                    <div class="field-group slider-group">
                        <div class="slider-header">
                            <span class="field-label">AudioContext noise</span>
                            <span class="slider-val"
                                >{noiseLabel(audioNoise)}</span
                            >
                        </div>
                        <input
                            type="range"
                            class="slider"
                            min="0"
                            max="0.015"
                            step="0.0005"
                            bind:value={audioNoise}
                        />
                    </div>

                    <!-- Hardware -->
                    <div class="row-2">
                        <div class="field-group">
                            <span class="field-label">CPU threads</span>
                            <div class="seg-control">
                                {#each HW_OPTIONS as n}
                                    <button
                                        class="seg-btn"
                                        class:active={hwConcurrency === n}
                                        onclick={() => {
                                            hwConcurrency = n;
                                        }}>{n}</button
                                    >
                                {/each}
                            </div>
                        </div>
                        <div class="field-group">
                            <span class="field-label">Device memory</span>
                            <div class="seg-control">
                                {#each MEM_OPTIONS as m}
                                    <button
                                        class="seg-btn"
                                        class:active={deviceMemory === m}
                                        onclick={() => {
                                            deviceMemory = m;
                                        }}>{m} GB</button
                                    >
                                {/each}
                            </div>
                        </div>
                    </div>

                    <!-- WebRTC -->
                    <div class="field-group">
                        <span class="field-label">WebRTC mode</span>
                        <div class="seg-control">
                            {#each [["block", "Block"], ["fake_mdns", "Fake mDNS"], ["passthrough", "Pass-through"]] as [v, l]}
                                <button
                                    class="seg-btn"
                                    class:active={webrtcMode === v}
                                    onclick={() => {
                                        webrtcMode = v as typeof webrtcMode;
                                    }}>{l}</button
                                >
                            {/each}
                        </div>
                    </div>

                    <!-- Mobile UA toggle -->
                    <label class="toggle-row">
                        <input type="checkbox" bind:checked={uaMobile} />
                        <span class="toggle-label">Mobile User-Agent</span>
                        <span class="toggle-desc"
                            >Sets ua_mobile=true and applies a mobile screen
                            preset</span
                        >
                    </label>

                    <!-- Behavior profile -->
                    <div class="field-group">
                        <span class="field-label">Behavior profile</span>
                        <div class="seg-control">
                            {#each [["bot", "Bot"], ["fast", "Fast"], ["normal", "Normal"], ["cautious", "Cautious"]] as [v, l]}
                                <button
                                    class="seg-btn"
                                    class:active={behaviorProfile === v}
                                    onclick={() => {
                                        behaviorProfile = v as BehaviorProfile;
                                    }}>{l}</button
                                >
                            {/each}
                        </div>
                    </div>

                    <!-- Live FP summary if available -->
                    {#if fp}
                        <div class="fp-summary">
                            <div class="fp-row">
                                <span class="fp-k">UA</span><span
                                    class="fp-v mono"
                                    >{fp.user_agent.slice(0, 60)}…</span
                                >
                            </div>
                            <div class="fp-row">
                                <span class="fp-k">Platform</span><span
                                    class="fp-v"
                                    >{fp.ua_platform}
                                    {fp.ua_platform_version}</span
                                >
                            </div>
                            <div class="fp-row">
                                <span class="fp-k">WebGL</span><span
                                    class="fp-v"
                                    >{fp.webgl_vendor} / {fp.webgl_renderer.slice(
                                        0,
                                        40,
                                    )}</span
                                >
                            </div>
                            <div class="fp-row">
                                <span class="fp-k">Screen</span><span
                                    class="fp-v"
                                    >{fp.screen_width}×{fp.screen_height} @{fp.pixel_ratio}x</span
                                >
                            </div>
                            <div class="fp-row">
                                <span class="fp-k">Timezone</span><span
                                    class="fp-v">{fp.timezone}</span
                                >
                            </div>
                        </div>
                    {/if}
                {/if}
            </div>
            <!-- end tab-panel -->
        </div>
        <!-- end form-col -->

        <!-- ── Right pane: preview ── -->
        {#if previewVisible && targetUrl}
            <div class="preview-col">
                <div class="preview-header">
                    <span class="preview-title">Target preview</span>
                    <span class="preview-url mono">{targetUrl}</span>
                    <button
                        class="icon-btn"
                        onclick={() => {
                            previewVisible = false;
                        }}
                        aria-label="Close preview"
                    >
                        <svg
                            width="11"
                            height="11"
                            viewBox="0 0 11 11"
                            fill="none"
                        >
                            <path
                                d="M1 1l9 9M10 1L1 10"
                                stroke="currentColor"
                                stroke-width="1.6"
                                stroke-linecap="round"
                            />
                        </svg>
                    </button>
                </div>

                <!-- Sandboxed mini target view -->
                <div class="iframe-section">
                    <div class="iframe-label">Target site (read-only)</div>
                    <iframe
                        class="preview-iframe"
                        src={targetUrl}
                        title="Target preview"
                        sandbox="allow-scripts allow-same-origin"
                        referrerpolicy="no-referrer"
                        loading="lazy"
                    ></iframe>
                </div>

                <!-- creepjs -->
                <div class="iframe-section">
                    <div class="iframe-label">
                        creepjs
                        <span class="iframe-note"
                            >Reflects launched Playwright session</span
                        >
                    </div>
                    <iframe
                        class="preview-iframe creep-iframe"
                        src="https://abrahamjuliot.github.io/creepjs/"
                        title="creepjs fingerprint check"
                        sandbox="allow-scripts allow-same-origin"
                        loading="lazy"
                    ></iframe>
                </div>

                <!-- Risk score banner -->
                {#if resolvedPreset}
                    <div
                        class="score-banner"
                        style="border-color:color-mix(in srgb,{threatColor} 40%,transparent)"
                    >
                        <span class="score-label">Detected risk signals</span>
                        <div class="score-signals">
                            {#each riskSignals as sig}
                                <span
                                    class="score-sig"
                                    style="color:{threatColor}">{sig}</span
                                >
                            {/each}
                        </div>
                        {#if targetTags.some((t) => t.includes("captcha"))}
                            <div class="score-warn">
                                ⚠ CAPTCHA detected — ensure behavioral entropy
                                is above 0.6 before submitting
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}
    </div>
    <!-- end modal-body -->

    <!-- ── Footer ── -->
    <footer class="modal-footer">
        {#if errorMsg}
            <span class="error-msg">{errorMsg}</span>
        {/if}
        <div class="footer-actions">
            <button class="btn-ghost" onclick={onClose}>Cancel</button>
            {#if canShowLaunch}
                <button
                    class="btn-secondary"
                    disabled={saving || generatingFp || !fp}
                    onclick={async () => {
                        await handleSave();
                        if (!errorMsg && profile)
                            profileStore.launchProfile(profile.id);
                    }}
                >
                    Save &amp; Launch
                </button>
            {/if}
            <button
                class="btn-primary"
                disabled={saving || generatingFp || !fp}
                onclick={handleSave}
            >
                {#if saving}
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
                            stroke-width="1.5"
                            stroke-dasharray="14 8"
                        />
                    </svg>
                    Saving…
                {:else}
                    {mode === "create" ? "Create Profile" : "Save Changes"}
                {/if}
            </button>
        </div>
    </footer>
</div>

<style>
    /* ── Shell ── */
    .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(3px);
        z-index: 100;
    }
    .modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 101;
        width: min(96vw, 960px);
        max-height: 90vh;
        background: var(--surface-1);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
    }

    /* ── Header ── */
    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px 14px;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
    }
    .header-meta {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .modal-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--text-primary);
    }
    .header-url-chip {
        font-size: 11px;
        font-weight: 500;
        padding: 2px 8px;
        border-radius: 99px;
        border: 1px solid;
        opacity: 0.9;
    }
    .icon-btn {
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        color: var(--text-muted);
        background: transparent;
        border: none;
        cursor: pointer;
        transition:
            background 0.12s,
            color 0.12s;
    }
    .icon-btn:hover {
        background: var(--surface-3);
        color: var(--text-primary);
    }

    /* ── Body layout ── */
    .modal-body {
        display: flex;
        flex: 1;
        overflow: hidden;
    }
    .form-col {
        display: flex;
        flex-direction: column;
        width: 420px;
        min-width: 320px;
        flex-shrink: 0;
        border-right: 1px solid var(--border);
        overflow: hidden;
    }

    /* ── Tab bar ── */
    .tab-bar {
        display: flex;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
        background: var(--surface-1);
    }
    .tab-btn {
        flex: 1;
        padding: 10px 4px 9px;
        font-size: 11.5px;
        font-weight: 500;
        color: var(--text-muted);
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        position: relative;
        transition:
            color 0.12s,
            border-color 0.12s;
    }
    .tab-btn:hover {
        color: var(--text-secondary);
    }
    .tab-btn.active {
        color: var(--accent);
        border-bottom-color: var(--accent);
    }
    .tab-emoji {
        font-size: 13px;
    }
    .threat-pip {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    /* ── Tab panel ── */
    .tab-panel {
        flex: 1;
        overflow-y: auto;
        padding: 16px 18px 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    /* ── Field groups ── */
    .field-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .field-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
    }
    .field-label-sm {
        font-size: 10.5px;
        font-weight: 500;
        color: var(--text-muted);
    }
    .label-hint {
        text-transform: none;
        letter-spacing: 0;
        font-weight: 400;
        color: var(--accent);
    }
    .hint {
        font-size: 11px;
        color: var(--text-muted);
    }
    .row-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }
    .text-input,
    .select-input {
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-size: 12.5px;
        padding: 7px 10px;
        outline: none;
        width: 100%;
        transition: border-color 0.15s;
    }
    .text-input:focus,
    .select-input:focus {
        border-color: var(--border-focus);
    }
    .num-input {
        width: 80px;
    }

    /* ── URL field ── */
    .url-wrap {
        position: relative;
    }
    .url-row {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 0 10px;
        transition: border-color 0.15s;
    }
    .url-row:focus-within {
        border-color: var(--border-focus);
    }
    .url-globe {
        color: var(--text-muted);
        flex-shrink: 0;
    }
    .url-input {
        flex: 1;
        background: transparent;
        border: none;
        font-size: 12.5px;
        color: var(--text-primary);
        outline: none;
        padding: 7px 0;
    }
    .detected-chip {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 99px;
        border: 1px solid;
        white-space: nowrap;
        flex-shrink: 0;
    }

    /* suggestions */
    .suggestions {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        z-index: 20;
        list-style: none;
        overflow: hidden;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    .sug-item {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        font-size: 12px;
        cursor: pointer;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        text-align: left;
        transition: background 0.1s;
    }
    .sug-item:hover {
        background: var(--surface-3);
        color: var(--text-primary);
    }
    .sug-url {
        color: var(--text-primary);
    }
    .sug-platform {
        font-size: 10px;
        color: var(--text-muted);
    }

    /* Platform chips */
    .platform-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .plat-chip {
        font-size: 11px;
        font-weight: 500;
        padding: 4px 10px;
        border-radius: 99px;
        border: 1px solid var(--border);
        background: var(--surface-3);
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.12s;
    }
    .plat-chip:hover {
        border-color: var(--accent);
        color: var(--accent);
    }
    .plat-chip.active {
        border-color: var(--accent);
        color: var(--accent);
        background: var(--accent-glow);
    }

    /* Risk panel */
    .risk-panel {
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .risk-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    .risk-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
    }
    .risk-badge {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 99px;
        border: 1px solid;
    }
    .risk-signals {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
    }
    .risk-sig {
        font-size: 10.5px;
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--surface-3);
        border: 1px solid var(--border);
        color: var(--text-secondary);
    }

    /* Tag grid */
    .tag-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
    }
    .tag-toggle {
        font-size: 11px;
        padding: 4px 9px;
        border-radius: 99px;
        border: 1px solid var(--border);
        background: var(--surface-3);
        color: var(--text-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        transition: all 0.12s;
    }
    .tag-toggle:hover {
        border-color: var(--accent);
        color: var(--text-secondary);
    }
    .tag-toggle.on {
        border-color: var(--accent);
        color: var(--accent);
        background: var(--accent-glow);
    }

    /* Optimize row */
    .optimize-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 10px 12px;
        cursor: pointer;
        transition: border-color 0.12s;
    }
    .optimize-row:not(.disabled):hover {
        border-color: var(--border-hover);
    }
    .optimize-row.disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .optimize-row input[type="checkbox"] {
        margin-top: 2px;
        flex-shrink: 0;
        accent-color: var(--accent);
    }
    .opt-title {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 3px;
    }
    .opt-desc {
        font-size: 11.5px;
        color: var(--text-secondary);
        line-height: 1.55;
    }

    /* Preview btn */
    .preview-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 500;
        padding: 7px 14px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--border);
        background: var(--surface-3);
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.12s;
    }
    .preview-btn:hover:not(:disabled) {
        border-color: var(--accent);
        color: var(--accent);
    }
    .preview-btn.active {
        border-color: var(--accent);
        color: var(--accent);
        background: var(--accent-glow);
    }
    .preview-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    /* Screen chips */
    .screen-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
    }
    .screen-chip {
        font-size: 10.5px;
        padding: 3px 9px;
        border-radius: 4px;
        border: 1px solid var(--border);
        background: var(--surface-3);
        color: var(--text-muted);
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.12s;
    }
    .screen-chip:hover {
        border-color: var(--border-hover);
        color: var(--text-secondary);
    }
    .screen-chip.active {
        border-color: var(--accent);
        color: var(--accent);
        background: var(--accent-glow);
    }

    /* Info banner */
    .info-banner {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 11.5px;
        color: var(--text-secondary);
        padding: 7px 10px;
        background: rgba(56, 189, 248, 0.06);
        border: 1px solid rgba(56, 189, 248, 0.2);
        border-radius: var(--radius-sm);
        margin-bottom: 6px;
    }

    /* Segmented control */
    .seg-control {
        display: flex;
        border-radius: var(--radius-sm);
        overflow: hidden;
        border: 1px solid var(--border);
    }
    .seg-btn {
        flex: 1;
        padding: 6px 8px;
        font-size: 11.5px;
        font-weight: 500;
        background: var(--surface-2);
        color: var(--text-muted);
        border: none;
        border-right: 1px solid var(--border);
        cursor: pointer;
        transition:
            background 0.12s,
            color 0.12s;
    }
    .seg-btn:last-child {
        border-right: none;
    }
    .seg-btn:hover {
        background: var(--surface-3);
        color: var(--text-secondary);
    }
    .seg-btn.active {
        background: var(--accent-glow);
        color: var(--accent);
    }
    .inline-field {
        margin-top: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    /* BrightData */
    .section-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 500;
        color: var(--accent);
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
    }
    .chevron {
        transition: transform 0.2s;
    }
    .chevron.open {
        transform: rotate(180deg);
    }
    .bd-panel {
        margin-top: 10px;
        padding: 12px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .bd-add-btn {
        width: 100%;
        padding: 7px;
        font-size: 12px;
        font-weight: 500;
        background: var(--accent-glow);
        color: var(--accent);
        border: 1px solid rgba(129, 140, 248, 0.25);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: background 0.12s;
    }
    .bd-add-btn:hover:not(:disabled) {
        background: rgba(99, 102, 241, 0.2);
    }
    .bd-add-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    /* Fingerprint tab */
    .seed-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .seed-mode {
        flex-shrink: 0;
    }
    .seed-input {
        flex: 1;
        min-width: 120px;
        font-family: monospace;
    }
    .seed-display {
        font-family: monospace;
        font-size: 13px;
        color: var(--text-secondary);
        padding: 0 4px;
    }
    .regen-btn {
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        color: var(--text-secondary);
        transition: all 0.12s;
    }
    .regen-btn:hover {
        border-color: var(--accent);
        color: var(--accent);
    }
    .regen-btn.spinning svg {
        animation: spin 0.6s linear infinite;
    }

    .preset-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .preset-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11.5px;
        font-weight: 500;
        padding: 5px 11px;
        border-radius: 99px;
        border: 1px solid var(--border);
        background: var(--surface-3);
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.12s;
    }
    .preset-btn:hover {
        border-color: var(--accent);
        color: var(--accent);
    }
    .preset-btn.active {
        border-color: var(--accent);
        color: var(--accent);
        background: var(--accent-glow);
    }
    .preset-emoji {
        font-size: 13px;
    }
    .preset-label {
        white-space: nowrap;
    }

    /* Sliders */
    .slider-group {
        gap: 6px;
    }
    .slider-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .slider-val {
        font-size: 11px;
        color: var(--accent);
        font-weight: 500;
    }
    .slider {
        width: 100%;
        accent-color: var(--accent);
        height: 4px;
        cursor: pointer;
    }
    .slider-marks {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: var(--text-muted);
        margin-top: 2px;
    }

    .toggle-row {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        cursor: pointer;
        padding: 4px 0;
    }
    .toggle-row input[type="checkbox"] {
        margin-top: 2px;
        accent-color: var(--accent);
    }
    .toggle-label {
        font-size: 12.5px;
        font-weight: 500;
        color: var(--text-primary);
    }
    .toggle-desc {
        font-size: 11px;
        color: var(--text-muted);
    }

    /* FP summary */
    .fp-summary {
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 5px;
    }
    .fp-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        font-size: 11.5px;
        overflow: hidden;
    }
    .fp-k {
        font-weight: 600;
        color: var(--text-muted);
        min-width: 64px;
        flex-shrink: 0;
    }
    .fp-v {
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* ── Right preview pane ── */
    .preview-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--surface-1);
        min-width: 0;
    }
    .preview-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
    }
    .preview-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
    }
    .preview-url {
        font-size: 11px;
        color: var(--text-secondary);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .iframe-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        border-bottom: 1px solid var(--border);
        min-height: 0;
    }
    .iframe-section:last-of-type {
        border-bottom: none;
    }
    .iframe-label {
        padding: 6px 12px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
        border-bottom: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
    }
    .iframe-note {
        font-size: 9.5px;
        text-transform: none;
        letter-spacing: 0;
        color: var(--text-muted);
        font-weight: 400;
    }
    .preview-iframe {
        flex: 1;
        width: 100%;
        border: none;
        background: #fff;
    }
    .creep-iframe {
        background: #111;
    }

    /* Score banner */
    .score-banner {
        flex-shrink: 0;
        padding: 10px 14px;
        border-top: 1px solid var(--border);
        border-left: 3px solid;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .score-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-muted);
    }
    .score-signals {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
    .score-sig {
        font-size: 10.5px;
        font-weight: 500;
    }
    .score-warn {
        font-size: 11px;
        color: var(--warning);
        background: rgba(251, 191, 36, 0.06);
        border: 1px solid rgba(251, 191, 36, 0.2);
        border-radius: var(--radius-sm);
        padding: 5px 8px;
    }

    /* ── Footer ── */
    .modal-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 20px;
        border-top: 1px solid var(--border);
        flex-shrink: 0;
        background: var(--surface-1);
    }
    .error-msg {
        font-size: 11.5px;
        color: var(--error);
        flex: 1;
    }
    .footer-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .btn-ghost {
        padding: 7px 14px;
        font-size: 12.5px;
        font-weight: 500;
        border-radius: var(--radius-sm);
        border: 1px solid var(--border);
        background: transparent;
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.12s;
    }
    .btn-ghost:hover {
        background: var(--surface-3);
        color: var(--text-primary);
    }

    .btn-secondary {
        padding: 7px 16px;
        font-size: 12.5px;
        font-weight: 500;
        border-radius: var(--radius-sm);
        border: 1px solid rgba(129, 140, 248, 0.3);
        background: var(--accent-glow);
        color: var(--accent);
        cursor: pointer;
        transition: all 0.12s;
    }
    .btn-secondary:hover:not(:disabled) {
        background: rgba(99, 102, 241, 0.22);
    }
    .btn-secondary:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .btn-primary {
        padding: 7px 18px;
        font-size: 12.5px;
        font-weight: 600;
        border-radius: var(--radius-sm);
        border: none;
        background: var(--accent-dim);
        color: #fff;
        cursor: pointer;
        transition: background 0.12s;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .btn-primary:hover:not(:disabled) {
        background: var(--accent);
    }
    .btn-primary:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    /* ── Animations ── */
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
    .spin {
        animation: spin 0.8s linear infinite;
    }
    .mono {
        font-family: "JetBrains Mono", "Fira Code", monospace;
    }
</style>
