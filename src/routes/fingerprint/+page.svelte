<script lang="ts">
    import { onMount } from "svelte";
    import { profileStore } from "$lib/stores/profiles.svelte";
    import type { Fingerprint, Profile, WebRtcMode, UaBrand } from "$lib/types";
    import { SCREEN_PRESETS, OS_OPTIONS } from "$lib/constants/platforms";
    import FingerprintPreview from "$lib/components/FingerprintPreview.svelte";

    // ── State ──────────────────────────────────────────────────────────────────
    let profiles = $derived(profileStore.profiles);
    let selectedProfileId = $state<string | null>(null);
    let fp = $state<Fingerprint | null>(null);
    let dirty = $state(false);
    let saving = $state(false);
    let seedInput = $state("");
    let generating = $state(false);
    let tab = $state<
        "noise" | "navigator" | "screen" | "webrtc" | "uach" | "permissions" | "score"
    >("noise");
    let toastMsg = $state<string | null>(null);
    let toastTimeout: ReturnType<typeof setTimeout> | null = null;

    // ── Lifecycle ──────────────────────────────────────────────────────────────
    onMount(async () => {
        if (profileStore.profiles.length === 0) {
            await profileStore.loadProfiles();
        }
    });

    // ── Helpers ────────────────────────────────────────────────────────────────
    function showToast(msg: string) {
        toastMsg = msg;
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => (toastMsg = null), 2500);
    }

    async function selectProfile(id: string) {
        selectedProfileId = id;
        const profile = profiles.find((p) => p.id === id);
        if (profile) {
            fp = structuredClone(profile.fingerprint);
            seedInput = String(fp.seed);
            dirty = false;
        }
    }

    function markDirty() {
        dirty = true;
    }

    async function handleGenerate() {
        const seed = seedInput.trim()
            ? parseInt(seedInput.trim(), 10)
            : undefined;
        if (seed !== undefined && isNaN(seed)) {
            showToast("Invalid seed — must be a number");
            return;
        }
        generating = true;
        try {
            const newFp = await profileStore.generateFingerprint(seed);
            fp = newFp;
            seedInput = String(newFp.seed);
            dirty = true;
        } catch (e) {
            showToast(`Generate failed: ${e}`);
        } finally {
            generating = false;
        }
    }

    async function handleRandomize() {
        generating = true;
        try {
            const newFp = await profileStore.generateFingerprint();
            fp = newFp;
            seedInput = String(newFp.seed);
            dirty = true;
        } catch (e) {
            showToast(`Randomize failed: ${e}`);
        } finally {
            generating = false;
        }
    }

    async function handleSave() {
        if (!selectedProfileId || !fp) return;
        saving = true;
        try {
            await profileStore.updateProfile(selectedProfileId, {
                fingerprint: fp,
            });
            dirty = false;
            showToast("Fingerprint saved ✓");
        } catch (e) {
            showToast(`Save failed: ${e}`);
        } finally {
            saving = false;
        }
    }

    async function handleReseed() {
        if (!selectedProfileId) return;
        const seed = seedInput.trim()
            ? parseInt(seedInput.trim(), 10)
            : undefined;
        generating = true;
        try {
            const profile = await profileStore.reseedProfile(
                selectedProfileId,
                seed,
            );
            fp = structuredClone(profile.fingerprint);
            seedInput = String(fp.seed);
            dirty = false;
            showToast("Re-seeded ✓");
        } catch (e) {
            showToast(`Reseed failed: ${e}`);
        } finally {
            generating = false;
        }
    }

    function setScreenPreset(w: number, h: number) {
        if (!fp) return;
        fp.screen_width = w;
        fp.screen_height = h;
        fp.viewport_width = w;
        fp.viewport_height = Math.max(h - 128, 600);
        markDirty();
    }

    function addUaBrand() {
        if (!fp) return;
        fp.ua_brands = [...fp.ua_brands, { brand: "", version: "" }];
        markDirty();
    }

    function removeUaBrand(idx: number) {
        if (!fp) return;
        fp.ua_brands = fp.ua_brands.filter((_, i) => i !== idx);
        markDirty();
    }

    function setPermission(key: string, value: string) {
        if (!fp) return;
        fp.permissions = { ...fp.permissions, [key]: value };
        markDirty();
    }

    function removePermission(key: string) {
        if (!fp) return;
        const next = { ...fp.permissions };
        delete next[key];
        fp.permissions = next;
        markDirty();
    }

    let newPermKey = $state("");
    let newPermVal = $state<"granted" | "denied" | "prompt">("prompt");

    function addPermission() {
        if (!fp || !newPermKey.trim()) return;
        setPermission(newPermKey.trim(), newPermVal);
        newPermKey = "";
        newPermVal = "prompt";
    }

    // ── Noise helpers ──────────────────────────────────────────────────────────
    function noisePercent(v: number): string {
        return `${(v * 100).toFixed(1)}%`;
    }
    function noiseRating(v: number): string {
        if (v <= 0.03) return "Minimal";
        if (v <= 0.08) return "Subtle";
        if (v <= 0.15) return "Moderate";
        if (v <= 0.25) return "Heavy";
        return "Extreme";
    }
    function noiseColor(v: number): string {
        if (v <= 0.05) return "var(--success)";
        if (v <= 0.12) return "var(--accent)";
        if (v <= 0.2) return "var(--warning)";
        return "var(--error)";
    }

    const TABS = [
        {
            id: "noise",
            label: "🎨 Noise",
            title: "Canvas / WebGL / Audio noise levels",
        },
        {
            id: "navigator",
            label: "🧭 Navigator",
            title: "UA, platform, hardware",
        },
        {
            id: "screen",
            label: "🖥️ Screen",
            title: "Resolution, viewport, DPR",
        },
        { id: "webrtc", label: "🔒 WebRTC", title: "IP leak protection" },
        { id: "uach", label: "📋 UA-CH", title: "Client Hints brands" },
        {
            id: "permissions",
            label: "🛡️ Permissions",
            title: "Permission API spoofing",
        },
        {
            id: "score",
            label: "📊 Score",
            title: "Weighted fingerprint risk score and leak vector breakdown",
        },
    ] as const;

    let showPreviewIframes = $state(false);

    const WEBRTC_MODES: { value: WebRtcMode; label: string; desc: string }[] = [
        {
            value: "block",
            label: "Block",
            desc: "Drop all ICE candidates — safest, may break WebRTC sites",
        },
        {
            value: "fake_mdns",
            label: "Fake mDNS",
            desc: "Replace real IPs with a seeded mDNS hostname",
        },
        {
            value: "passthrough",
            label: "Passthrough",
            desc: "No interception — real IP may leak",
        },
    ];

    const PERM_STATES = ["granted", "denied", "prompt"] as const;
</script>

<div class="page">
    <!-- ── Header ── -->
    <div class="page-header">
        <div class="header-left">
            <h1 class="page-title">Fingerprint Editor</h1>
            {#if fp}
                <span class="seed-badge mono">seed: {fp.seed}</span>
                {#if dirty}
                    <span class="dirty-badge">● Unsaved</span>
                {/if}
            {/if}
        </div>
        <div class="header-actions">
            {#if fp}
                <button
                    class="btn-ghost"
                    onclick={handleRandomize}
                    disabled={generating}
                >
                    🎲 Randomize
                </button>
                <button
                    class="btn-secondary"
                    onclick={handleReseed}
                    disabled={generating || !selectedProfileId}
                >
                    🔄 Reseed
                </button>
                <button
                    class="btn-primary"
                    onclick={handleSave}
                    disabled={saving || !dirty || !selectedProfileId}
                >
                    {saving ? "Saving…" : "💾 Save"}
                </button>
            {/if}
        </div>
    </div>

    <div class="body">
        <!-- ── Left: profile selector ── -->
        <div class="selector-col">
            <div class="selector-header">
                <span class="section-label">Profile</span>
            </div>
            <div class="profile-list">
                {#if profiles.length === 0}
                    <p class="empty-hint">
                        No profiles yet.<br />Create one first.
                    </p>
                {:else}
                    {#each profiles as profile (profile.id)}
                        <button
                            class="profile-item"
                            class:active={selectedProfileId === profile.id}
                            onclick={() => selectProfile(profile.id)}
                        >
                            <span class="profile-name truncate"
                                >{profile.name}</span
                            >
                            <span class="profile-seed mono"
                                >{(profile.fingerprint.seed >>> 0)
                                    .toString(16)
                                    .slice(0, 6)}</span
                            >
                        </button>
                    {/each}
                {/if}
            </div>

            {#if fp}
                <!-- Seed control -->
                <div class="seed-section">
                    <label class="field-label" for="seed-input">Seed</label>
                    <div class="seed-row">
                        <input
                            id="seed-input"
                            class="input mono"
                            type="text"
                            bind:value={seedInput}
                            placeholder="Auto"
                        />
                        <button
                            class="btn-sm"
                            onclick={handleGenerate}
                            disabled={generating}
                            title="Generate fingerprint from this seed"
                        >
                            ▶
                        </button>
                    </div>
                </div>

                <!-- Quick summary -->
                <div class="fp-summary">
                    <div class="summary-row">
                        <span class="summary-label">OS</span>
                        <span class="summary-value">{fp.ua_platform}</span>
                    </div>
                    <div class="summary-row">
                        <span class="summary-label">Screen</span>
                        <span class="summary-value"
                            >{fp.screen_width}×{fp.screen_height}</span
                        >
                    </div>
                    <div class="summary-row">
                        <span class="summary-label">Viewport</span>
                        <span class="summary-value"
                            >{fp.viewport_width}×{fp.viewport_height}</span
                        >
                    </div>
                    <div class="summary-row">
                        <span class="summary-label">DPR</span>
                        <span class="summary-value">{fp.pixel_ratio}</span>
                    </div>
                    <div class="summary-row">
                        <span class="summary-label">WebRTC</span>
                        <span class="summary-value">{fp.webrtc_mode}</span>
                    </div>
                    <div class="summary-row">
                        <span class="summary-label">Locale</span>
                        <span class="summary-value">{fp.locale}</span>
                    </div>
                    <div class="summary-row">
                        <span class="summary-label">TZ</span>
                        <span class="summary-value truncate" title={fp.timezone}
                            >{fp.timezone}</span
                        >
                    </div>
                </div>
            {/if}
        </div>

        <!-- ── Right: editor ── -->
        <div class="editor-col">
            {#if !fp}
                <div class="empty-editor">
                    <svg
                        width="48"
                        height="48"
                        viewBox="0 0 48 48"
                        fill="none"
                        opacity="0.3"
                    >
                        <circle
                            cx="24"
                            cy="24"
                            r="20"
                            stroke="var(--text-muted)"
                            stroke-width="1.5"
                        />
                        <path
                            d="M18 24h12M24 18v12"
                            stroke="var(--text-muted)"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />
                    </svg>
                    <p class="empty-title">
                        Select a profile to edit its fingerprint
                    </p>
                    <p class="empty-sub">
                        Choose from the list on the left, or create a new
                        profile first.
                    </p>
                </div>
            {:else}
                <!-- Tabs -->
                <div class="tabs">
                    {#each TABS as t}
                        <button
                            class="tab"
                            class:active={tab === t.id}
                            onclick={() => (tab = t.id as typeof tab)}
                            title={t.title}
                        >
                            {t.label}
                        </button>
                    {/each}
                </div>

                <div class="tab-content">
                    <!-- ═══ NOISE TAB ═══ -->
                    {#if tab === "noise"}
                        <div class="section">
                            <h3 class="section-title">Canvas Noise</h3>
                            <p class="section-desc">
                                Per-pixel deterministic noise injected into
                                getImageData / toDataURL. Keep below 0.15 to
                                avoid breaking CAPTCHAs.
                            </p>
                            <div class="slider-row">
                                <input
                                    type="range"
                                    class="slider"
                                    min="0"
                                    max="0.30"
                                    step="0.005"
                                    bind:value={fp.canvas_noise}
                                    oninput={markDirty}
                                />
                                <span
                                    class="slider-value"
                                    style:color={noiseColor(fp.canvas_noise)}
                                >
                                    {noisePercent(fp.canvas_noise)}
                                </span>
                                <span
                                    class="slider-rating"
                                    style:color={noiseColor(fp.canvas_noise)}
                                >
                                    {noiseRating(fp.canvas_noise)}
                                </span>
                            </div>
                        </div>

                        <div class="section">
                            <h3 class="section-title">WebGL Noise</h3>
                            <p class="section-desc">
                                Noise injected into WebGL rendering parameters.
                            </p>
                            <div class="slider-row">
                                <input
                                    type="range"
                                    class="slider"
                                    min="0"
                                    max="0.20"
                                    step="0.005"
                                    bind:value={fp.webgl_noise}
                                    oninput={markDirty}
                                />
                                <span
                                    class="slider-value"
                                    style:color={noiseColor(fp.webgl_noise)}
                                >
                                    {noisePercent(fp.webgl_noise)}
                                </span>
                                <span
                                    class="slider-rating"
                                    style:color={noiseColor(fp.webgl_noise)}
                                >
                                    {noiseRating(fp.webgl_noise)}
                                </span>
                            </div>
                        </div>

                        <div class="section">
                            <h3 class="section-title">Audio Noise</h3>
                            <p class="section-desc">
                                Subtle noise applied to AudioContext output.
                                Very low values recommended.
                            </p>
                            <div class="slider-row">
                                <input
                                    type="range"
                                    class="slider"
                                    min="0"
                                    max="0.05"
                                    step="0.001"
                                    bind:value={fp.audio_noise}
                                    oninput={markDirty}
                                />
                                <span
                                    class="slider-value"
                                    style:color={noiseColor(fp.audio_noise * 5)}
                                >
                                    {noisePercent(fp.audio_noise)}
                                </span>
                                <span
                                    class="slider-rating"
                                    style:color={noiseColor(fp.audio_noise * 5)}
                                >
                                    {noiseRating(fp.audio_noise * 5)}
                                </span>
                            </div>
                        </div>

                        <div class="section">
                            <h3 class="section-title">WebGL Identity</h3>
                            <div class="field-row">
                                <div class="field-group">
                                    <label
                                        class="field-label"
                                        for="webgl-vendor">Vendor</label
                                    >
                                    <input
                                        id="webgl-vendor"
                                        class="input"
                                        type="text"
                                        bind:value={fp.webgl_vendor}
                                        oninput={markDirty}
                                    />
                                </div>
                            </div>
                            <div class="field-row">
                                <div class="field-group">
                                    <label
                                        class="field-label"
                                        for="webgl-renderer">Renderer</label
                                    >
                                    <input
                                        id="webgl-renderer"
                                        class="input mono"
                                        type="text"
                                        bind:value={fp.webgl_renderer}
                                        oninput={markDirty}
                                    />
                                </div>
                            </div>
                        </div>

                        <div class="section">
                            <h3 class="section-title">Font Subset</h3>
                            <p class="section-desc">
                                {fp.font_subset.length} fonts loaded. Edit the list
                                below (one per line).
                            </p>
                            <textarea
                                class="input mono font-textarea"
                                rows="6"
                                value={fp!.font_subset.join("\n")}
                                oninput={(e) => {
                                    fp!.font_subset = (
                                        e.target as HTMLTextAreaElement
                                    ).value
                                        .split("\n")
                                        .map((s) => s.trim())
                                        .filter(Boolean);
                                    markDirty();
                                }}
                            ></textarea>
                        </div>

                        <!-- ═══ NAVIGATOR TAB ═══ -->
                    {:else if tab === "navigator"}
                        <div class="section">
                            <h3 class="section-title">User Agent</h3>
                            <textarea
                                class="input mono"
                                rows="3"
                                bind:value={fp.user_agent}
                                oninput={markDirty}
                            ></textarea>
                        </div>

                        <div class="section">
                            <h3 class="section-title">Platform & Locale</h3>
                            <div class="field-grid">
                                <div class="field-group">
                                    <label
                                        class="field-label"
                                        for="nav-platform">Platform</label
                                    >
                                    <input
                                        id="nav-platform"
                                        class="input"
                                        type="text"
                                        bind:value={fp.platform}
                                        oninput={markDirty}
                                    />
                                </div>
                                <div class="field-group">
                                    <label class="field-label" for="nav-locale"
                                        >Locale</label
                                    >
                                    <input
                                        id="nav-locale"
                                        class="input"
                                        type="text"
                                        bind:value={fp.locale}
                                        oninput={markDirty}
                                    />
                                </div>
                                <div class="field-group">
                                    <label class="field-label" for="nav-tz"
                                        >Timezone</label
                                    >
                                    <input
                                        id="nav-tz"
                                        class="input"
                                        type="text"
                                        bind:value={fp.timezone}
                                        oninput={markDirty}
                                    />
                                </div>
                                <div class="field-group">
                                    <label class="field-label" for="nav-lang"
                                        >Accept-Language</label
                                    >
                                    <input
                                        id="nav-lang"
                                        class="input mono"
                                        type="text"
                                        bind:value={fp.accept_language}
                                        oninput={markDirty}
                                    />
                                </div>
                            </div>
                        </div>

                        <div class="section">
                            <h3 class="section-title">Hardware</h3>
                            <div class="field-grid">
                                <div class="field-group">
                                    <label class="field-label" for="nav-cores"
                                        >Hardware Concurrency</label
                                    >
                                    <select
                                        id="nav-cores"
                                        class="input"
                                        bind:value={fp.hardware_concurrency}
                                        onchange={markDirty}
                                    >
                                        {#each [1, 2, 4, 6, 8, 12, 16, 24, 32] as v}
                                            <option value={v}>{v} cores</option>
                                        {/each}
                                    </select>
                                </div>
                                <div class="field-group">
                                    <label class="field-label" for="nav-mem"
                                        >Device Memory</label
                                    >
                                    <select
                                        id="nav-mem"
                                        class="input"
                                        bind:value={fp.device_memory}
                                        onchange={markDirty}
                                    >
                                        {#each [0.25, 0.5, 1, 2, 4, 8, 16] as v}
                                            <option value={v}>{v} GB</option>
                                        {/each}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <!-- ═══ SCREEN TAB ═══ -->
                    {:else if tab === "screen"}
                        <div class="section">
                            <h3 class="section-title">Screen Resolution</h3>
                            <p class="section-desc">Quick presets:</p>
                            <div class="preset-chips">
                                {#each SCREEN_PRESETS as preset}
                                    <button
                                        class="chip"
                                        class:active={fp.screen_width ===
                                            preset.w &&
                                            fp.screen_height === preset.h}
                                        onclick={() =>
                                            setScreenPreset(preset.w, preset.h)}
                                    >
                                        {preset.label}
                                    </button>
                                {/each}
                            </div>
                            <div class="field-grid mt">
                                <div class="field-group">
                                    <label class="field-label" for="scr-w"
                                        >Width</label
                                    >
                                    <input
                                        id="scr-w"
                                        class="input mono"
                                        type="number"
                                        bind:value={fp.screen_width}
                                        oninput={markDirty}
                                    />
                                </div>
                                <div class="field-group">
                                    <label class="field-label" for="scr-h"
                                        >Height</label
                                    >
                                    <input
                                        id="scr-h"
                                        class="input mono"
                                        type="number"
                                        bind:value={fp.screen_height}
                                        oninput={markDirty}
                                    />
                                </div>
                            </div>
                        </div>

                        <div class="section">
                            <h3 class="section-title">Viewport</h3>
                            <div class="field-grid">
                                <div class="field-group">
                                    <label class="field-label" for="vp-w"
                                        >Viewport Width</label
                                    >
                                    <input
                                        id="vp-w"
                                        class="input mono"
                                        type="number"
                                        bind:value={fp.viewport_width}
                                        oninput={markDirty}
                                    />
                                </div>
                                <div class="field-group">
                                    <label class="field-label" for="vp-h"
                                        >Viewport Height</label
                                    >
                                    <input
                                        id="vp-h"
                                        class="input mono"
                                        type="number"
                                        bind:value={fp.viewport_height}
                                        oninput={markDirty}
                                    />
                                </div>
                            </div>
                        </div>

                        <div class="section">
                            <h3 class="section-title">Display Properties</h3>
                            <div class="field-grid">
                                <div class="field-group">
                                    <label class="field-label" for="scr-dpr"
                                        >Pixel Ratio (DPR)</label
                                    >
                                    <select
                                        id="scr-dpr"
                                        class="input"
                                        bind:value={fp.pixel_ratio}
                                        onchange={markDirty}
                                    >
                                        {#each [1.0, 1.25, 1.5, 2.0, 2.5, 3.0] as v}
                                            <option value={v}>{v}×</option>
                                        {/each}
                                    </select>
                                </div>
                                <div class="field-group">
                                    <label class="field-label" for="scr-depth"
                                        >Color Depth</label
                                    >
                                    <select
                                        id="scr-depth"
                                        class="input"
                                        bind:value={fp.color_depth}
                                        onchange={markDirty}
                                    >
                                        <option value={24}>24-bit</option>
                                        <option value={30}>30-bit</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <!-- ═══ WEBRTC TAB ═══ -->
                    {:else if tab === "webrtc"}
                        <div class="section">
                            <h3 class="section-title">WebRTC Mode</h3>
                            <p class="section-desc">
                                Controls how ICE candidates are handled to
                                prevent IP leaks.
                            </p>
                            <div class="radio-cards">
                                {#each WEBRTC_MODES as mode}
                                    <button
                                        class="radio-card"
                                        class:active={fp.webrtc_mode ===
                                            mode.value}
                                        onclick={() => {
                                            fp!.webrtc_mode = mode.value;
                                            markDirty();
                                        }}
                                    >
                                        <div
                                            class="radio-dot"
                                            class:filled={fp.webrtc_mode ===
                                                mode.value}
                                        ></div>
                                        <div class="radio-body">
                                            <span class="radio-label"
                                                >{mode.label}</span
                                            >
                                            <span class="radio-desc"
                                                >{mode.desc}</span
                                            >
                                        </div>
                                    </button>
                                {/each}
                            </div>
                        </div>

                        {#if fp.webrtc_mode === "fake_mdns"}
                            <div class="section">
                                <h3 class="section-title">
                                    Fake mDNS Hostname
                                </h3>
                                <p class="section-desc">
                                    Used to replace real host candidates in SDP.
                                    Auto-generated from seed.
                                </p>
                                <div class="field-group">
                                    <input
                                        class="input mono"
                                        type="text"
                                        bind:value={fp.webrtc_fake_mdns}
                                        oninput={markDirty}
                                        placeholder="xxxxxxxx.local"
                                    />
                                </div>
                            </div>
                        {/if}

                        {#if fp.webrtc_mode !== "block"}
                            <div class="section">
                                <h3 class="section-title">Fake Local IP</h3>
                                <p class="section-desc">
                                    Replaces srflx candidate IPs. Uses RFC 1918
                                    private range.
                                </p>
                                <div class="field-group">
                                    <input
                                        class="input mono"
                                        type="text"
                                        bind:value={fp.webrtc_fake_ip}
                                        oninput={markDirty}
                                        placeholder="192.168.1.100"
                                    />
                                </div>
                            </div>
                        {/if}

                        <!-- ═══ UA-CH TAB ═══ -->
                    {:else if tab === "uach"}
                        <div class="section">
                            <h3 class="section-title">Client Hints Identity</h3>
                            <div class="field-grid">
                                <div class="field-group">
                                    <label class="field-label" for="ch-platform"
                                        >Platform</label
                                    >
                                    <input
                                        id="ch-platform"
                                        class="input"
                                        type="text"
                                        bind:value={fp.ua_platform}
                                        oninput={markDirty}
                                    />
                                </div>
                                <div class="field-group">
                                    <label class="field-label" for="ch-platver"
                                        >Platform Version</label
                                    >
                                    <input
                                        id="ch-platver"
                                        class="input"
                                        type="text"
                                        bind:value={fp.ua_platform_version}
                                        oninput={markDirty}
                                    />
                                </div>
                                <div class="field-group">
                                    <label class="field-label" for="ch-arch"
                                        >Architecture</label
                                    >
                                    <input
                                        id="ch-arch"
                                        class="input"
                                        type="text"
                                        bind:value={fp.ua_architecture}
                                        oninput={markDirty}
                                    />
                                </div>
                                <div class="field-group">
                                    <label class="field-label" for="ch-bit"
                                        >Bitness</label
                                    >
                                    <input
                                        id="ch-bit"
                                        class="input"
                                        type="text"
                                        bind:value={fp.ua_bitness}
                                        oninput={markDirty}
                                    />
                                </div>
                            </div>

                            <div class="field-group mt">
                                <label class="field-label">
                                    <input
                                        type="checkbox"
                                        bind:checked={fp.ua_mobile}
                                        onchange={markDirty}
                                    />
                                    Mobile
                                </label>
                            </div>
                        </div>

                        <div class="section">
                            <h3 class="section-title">UA Brands</h3>
                            <p class="section-desc">
                                The brand list returned by
                                navigator.userAgentData.brands and Sec-CH-UA
                                header.
                            </p>
                            <div class="brands-list">
                                {#each fp.ua_brands as brand, idx}
                                    <div class="brand-row">
                                        <input
                                            class="input"
                                            type="text"
                                            placeholder="Brand name"
                                            bind:value={brand.brand}
                                            oninput={markDirty}
                                        />
                                        <input
                                            class="input mono"
                                            type="text"
                                            placeholder="Version"
                                            style="width: 90px; flex-shrink: 0"
                                            bind:value={brand.version}
                                            oninput={markDirty}
                                        />
                                        <button
                                            class="icon-btn danger"
                                            onclick={() => removeUaBrand(idx)}
                                            title="Remove brand"
                                        >
                                            <svg
                                                width="12"
                                                height="12"
                                                viewBox="0 0 12 12"
                                                fill="none"
                                            >
                                                <path
                                                    d="M2 2l8 8M10 2 2 10"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    stroke-linecap="round"
                                                />
                                            </svg>
                                        </button>
                                    </div>
                                {/each}
                            </div>
                            <button
                                class="btn-ghost add-brand-btn"
                                onclick={addUaBrand}>+ Add brand</button
                            >
                        </div>

                        <!-- ═══ PERMISSIONS TAB ═══ -->
                    {:else if tab === "permissions"}
                        <div class="section">
                            <h3 class="section-title">Permission Spoofing</h3>
                            <p class="section-desc">
                                Override navigator.permissions.query()
                                responses. Unknown permissions fall through to
                                the real browser API.
                            </p>

                            <div class="perm-list">
                                {#each Object.entries(fp.permissions) as [key, value]}
                                    <div class="perm-row">
                                        <span class="perm-key mono">{key}</span>
                                        <select
                                            class="input perm-select"
                                            {value}
                                            onchange={(e) =>
                                                setPermission(
                                                    key,
                                                    (
                                                        e.target as HTMLSelectElement
                                                    ).value,
                                                )}
                                        >
                                            {#each PERM_STATES as s}
                                                <option value={s}>{s}</option>
                                            {/each}
                                        </select>
                                        <button
                                            class="icon-btn danger"
                                            onclick={() =>
                                                removePermission(key)}
                                            title="Remove"
                                        >
                                            <svg
                                                width="12"
                                                height="12"
                                                viewBox="0 0 12 12"
                                                fill="none"
                                            >
                                                <path
                                                    d="M2 2l8 8M10 2 2 10"
                                                    stroke="currentColor"
                                                    stroke-width="1.5"
                                                    stroke-linecap="round"
                                                />
                                            </svg>
                                        </button>
                                    </div>
                                {/each}
                            </div>

                            <div class="add-perm-row">
                                <input
                                    class="input mono"
                                    type="text"
                                    placeholder="permission name"
                                    bind:value={newPermKey}
                                />
                                <select
                                    class="input perm-select"
                                    bind:value={newPermVal}
                                >
                                    {#each PERM_STATES as s}
                                        <option value={s}>{s}</option>
                                    {/each}
                                </select>
                                <button
                                    class="btn-sm"
                                    onclick={addPermission}
                                    disabled={!newPermKey.trim()}>+ Add</button
                                >
                            </div>
                        </div>
                    <!-- ═══ SCORE TAB ═══ -->
                    {:else if tab === "score"}
                        <div class="section">
                            <h3 class="section-title">Fingerprint Risk Score</h3>
                            <p class="section-desc">
                                Weighted score across all fingerprint leak vectors.
                                Score ≥ 85 = green (passes 2026 stealth thresholds).
                                Red rows indicate failing vectors that need attention.
                            </p>
                            <FingerprintPreview
                                fingerprint={fp}
                                showIframes={showPreviewIframes}
                            />
                            <div class="score-iframe-toggle" style="margin-top: 12px;">
                                <label class="field-label" style="cursor:pointer; display:flex; align-items:center; gap:8px;">
                                    <input
                                        type="checkbox"
                                        bind:checked={showPreviewIframes}
                                    />
                                    Show external detector iframes (CreepJS / Pixelscan / BrowserLeaks)
                                </label>
                                <p class="section-desc" style="margin-top:4px;">
                                    ⚠ Iframes open in the host browser context, not the profile context.
                                    Launch the profile and use the Trace → FP Score tab for in-profile scoring.
                                </p>
                            </div>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>

    <!-- Toast -->
    {#if toastMsg}
        <div class="toast">{toastMsg}</div>
    {/if}
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
    .seed-badge {
        font-size: 11px;
        padding: 2px 9px;
        border-radius: 99px;
        background: var(--surface-3);
        border: 1px solid var(--border);
        color: var(--text-secondary);
    }
    .dirty-badge {
        font-size: 11px;
        font-weight: 600;
        color: var(--warning);
    }
    .header-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
    }

    /* ── Body ── */
    .body {
        flex: 1;
        display: flex;
        overflow: hidden;
        min-height: 0;
    }

    /* ── Selector column (left) ── */
    .selector-col {
        width: 240px;
        min-width: 200px;
        border-right: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        flex-shrink: 0;
    }
    .selector-header {
        padding: 10px 14px 6px;
        border-bottom: 1px solid var(--border);
    }
    .section-label {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-muted);
    }
    .profile-list {
        flex: 1;
        overflow-y: auto;
        padding: 4px 6px;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .empty-hint {
        font-size: 12px;
        color: var(--text-muted);
        text-align: center;
        padding: 24px 12px;
        line-height: 1.6;
    }
    .profile-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        text-align: left;
        padding: 7px 9px;
        border-radius: var(--radius-sm);
        border: 1px solid transparent;
        background: transparent;
        cursor: pointer;
        transition:
            background 0.12s,
            border-color 0.12s;
    }
    .profile-item:hover {
        background: var(--surface-2);
        border-color: var(--border);
    }
    .profile-item.active {
        background: var(--surface-3);
        border-color: var(--border-hover);
    }
    .profile-name {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-primary);
        flex: 1;
        min-width: 0;
    }
    .profile-seed {
        font-size: 10px;
        color: var(--text-muted);
        flex-shrink: 0;
    }

    /* ── Seed section ── */
    .seed-section {
        padding: 10px 14px;
        border-top: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 5px;
    }
    .seed-row {
        display: flex;
        gap: 6px;
    }
    .seed-row .input {
        flex: 1;
        font-size: 11px;
    }

    /* ── FP Summary ── */
    .fp-summary {
        padding: 8px 14px 12px;
        border-top: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .summary-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 6px;
    }
    .summary-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-muted);
        letter-spacing: 0.03em;
        flex-shrink: 0;
    }
    .summary-value {
        font-size: 11px;
        color: var(--text-secondary);
        text-align: right;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* ── Editor column (right) ── */
    .editor-col {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .empty-editor {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 48px 32px;
        text-align: center;
    }
    .empty-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
    }
    .empty-sub {
        font-size: 12px;
        color: var(--text-muted);
        max-width: 300px;
        line-height: 1.55;
    }

    /* ── Tabs ── */
    .tabs {
        display: flex;
        gap: 0;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
        overflow-x: auto;
        padding: 0 16px;
    }
    .tab {
        padding: 10px 14px;
        font-size: 12px;
        font-weight: 500;
        color: var(--text-muted);
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        white-space: nowrap;
        transition:
            color 0.12s,
            border-color 0.12s;
    }
    .tab:hover {
        color: var(--text-secondary);
    }
    .tab.active {
        color: var(--accent);
        border-bottom-color: var(--accent);
        font-weight: 600;
    }

    /* ── Tab content ── */
    .tab-content {
        flex: 1;
        overflow-y: auto;
        padding: 18px 24px 32px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    /* ── Sections ── */
    .section {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--border);
    }
    .section:last-child {
        border-bottom: none;
        padding-bottom: 0;
    }
    .section-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: -0.01em;
    }
    .section-desc {
        font-size: 11.5px;
        color: var(--text-secondary);
        line-height: 1.55;
    }

    /* ── Slider ── */
    .slider-row {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .slider {
        flex: 1;
        -webkit-appearance: none;
        appearance: none;
        height: 4px;
        background: var(--surface-4);
        border-radius: 2px;
        outline: none;
    }
    .slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--accent);
        cursor: pointer;
        border: 2px solid var(--bg);
        box-shadow: 0 0 0 1px var(--accent-dim);
    }
    .slider-value {
        font-size: 13px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        min-width: 48px;
        text-align: right;
        font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
    }
    .slider-rating {
        font-size: 10px;
        font-weight: 600;
        min-width: 56px;
        text-align: left;
    }

    /* ── Fields ── */
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
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .field-label input[type="checkbox"] {
        accent-color: var(--accent);
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
    .field-row {
        display: flex;
        gap: 10px;
    }
    .field-row > * {
        flex: 1;
    }
    .field-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }
    .mt {
        margin-top: 8px;
    }
    .font-textarea {
        font-size: 11px;
        line-height: 1.6;
        resize: vertical;
    }

    /* ── Preset chips ── */
    .preset-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .chip {
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 500;
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: 99px;
        color: var(--text-secondary);
        cursor: pointer;
        transition:
            background 0.12s,
            color 0.12s,
            border-color 0.12s;
    }
    .chip:hover {
        background: var(--surface-4);
        color: var(--text-primary);
        border-color: var(--border-hover);
    }
    .chip.active {
        background: var(--accent-glow);
        color: var(--accent);
        border-color: rgba(129, 140, 248, 0.3);
        font-weight: 600;
    }

    /* ── Radio cards (WebRTC) ── */
    .radio-cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .radio-card {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 14px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        cursor: pointer;
        transition: border-color 0.12s;
        text-align: left;
    }
    .radio-card:hover {
        border-color: var(--border-hover);
    }
    .radio-card.active {
        border-color: var(--accent-dim);
        background: var(--accent-glow);
    }
    .radio-dot {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid var(--border-hover);
        flex-shrink: 0;
        margin-top: 1px;
        transition:
            border-color 0.12s,
            background 0.12s;
    }
    .radio-dot.filled {
        border-color: var(--accent);
        background: var(--accent);
        box-shadow: inset 0 0 0 3px var(--bg);
    }
    .radio-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .radio-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
    }
    .radio-desc {
        font-size: 11px;
        color: var(--text-secondary);
        line-height: 1.5;
    }

    /* ── UA Brands ── */
    .brands-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .brand-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .brand-row .input:first-child {
        flex: 1;
    }
    .add-brand-btn {
        align-self: flex-start;
        font-size: 12px;
        color: var(--accent);
        padding: 4px 8px;
    }

    /* ── Permissions ── */
    .perm-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .perm-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .perm-key {
        flex: 1;
        font-size: 12px;
        color: var(--text-primary);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .perm-select {
        width: 100px;
        flex-shrink: 0;
        font-size: 11px;
        padding: 4px 8px;
    }
    .add-perm-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
    }
    .add-perm-row .input:first-child {
        flex: 1;
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
    .btn-secondary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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
    .btn-ghost:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .btn-sm {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 5px 10px;
        border-radius: var(--radius-sm);
        font-size: 11px;
        font-weight: 600;
        background: var(--surface-3);
        color: var(--text-secondary);
        border: 1px solid var(--border);
        cursor: pointer;
        transition:
            background 0.12s,
            color 0.12s;
        flex-shrink: 0;
    }
    .btn-sm:hover {
        background: var(--surface-4);
        color: var(--text-primary);
    }
    .btn-sm:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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
        flex-shrink: 0;
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

    /* ── Toast ── */
    .toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        padding: 10px 18px;
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        color: var(--text-primary);
        font-size: 12px;
        font-weight: 500;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
        z-index: 1000;
        animation: toast-in 0.2s ease-out;
    }
    @keyframes toast-in {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .mono {
        font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
    }
</style>
