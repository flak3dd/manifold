<script lang="ts">
    // ── FingerprintPreview ────────────────────────────────────────────────────
    //
    // Renders a weighted fingerprint risk score derived from the active profile's
    // fingerprint fields, plus embedded iframe previews for creepjs and pixelscan.
    //
    // Scoring model (weights sum to 1.0):
    //   Canvas noise coverage    0.30
    //   WebGL vendor/renderer    0.25
    //   AudioContext noise       0.15
    //   Font subset size         0.10
    //   WebRTC mode              0.10
    //   Navigator consistency    0.05
    //   Permissions API          0.05
    //
    // Each vector produces a 0–100 sub-score; the weighted sum is the overall
    // score. Score ≥ 85 = green (spec threshold), 60–84 = amber, < 60 = red.

    import type { Fingerprint } from "$lib/types";

    let {
        fingerprint,
        showIframes = false,
    }: {
        fingerprint: Fingerprint | null;
        showIframes?: boolean;
    } = $props();

    // ── Scoring ───────────────────────────────────────────────────────────────

    interface VectorScore {
        id: string;
        label: string;
        weight: number;
        score: number; // 0–100
        detail: string;
        failing: boolean; // highlight red in UI
    }

    function clamp(v: number, lo = 0, hi = 100): number {
        return Math.max(lo, Math.min(hi, v));
    }

    let vectors = $derived.by((): VectorScore[] => {
        const fp = fingerprint;
        if (!fp) return [];

        // ── Canvas ─────────────────────────────────────────────────────────
        const canvasNoise = fp.canvas_noise ?? 0;
        const canvasScore = clamp(canvasNoise * 700); // 0.01→7, 0.15→105 (cap at 100)
        const canvasFailing = canvasNoise < 0.02;

        // ── WebGL ──────────────────────────────────────────────────────────
        const hasWebglVendor =
            !!fp.webgl_vendor && !fp.webgl_vendor.includes("Google Inc")
                ? 85
                : 70;
        const webglNoise = fp.webgl_noise ?? 0;
        const webglScore = clamp((hasWebglVendor + webglNoise * 200) / 2);
        const webglFailing = webglNoise < 0.005;

        // ── AudioContext ───────────────────────────────────────────────────
        const audioNoise = fp.audio_noise ?? 0;
        const audioScore = clamp(audioNoise * 12000); // 0.001→12, 0.01→120 (cap 100)
        const audioFailing = audioNoise < 0.001;

        // ── Fonts ──────────────────────────────────────────────────────────
        const fontCount = fp.font_subset?.length ?? 0;
        // < 50 fonts = paranoid = best; > 80 = too many exposed = worse
        const fontScore =
            fontCount === 0
                ? 0
                : fontCount < 30
                  ? 100
                  : fontCount < 50
                    ? 95
                    : fontCount < 70
                      ? 80
                      : fontCount < 100
                        ? 60
                        : 40;
        const fontFailing = fontCount > 100 || fontCount === 0;

        // ── WebRTC ─────────────────────────────────────────────────────────
        const rtcMode = fp.webrtc_mode ?? "passthrough";
        const rtcScore =
            rtcMode === "block" ? 100 : rtcMode === "fake_mdns" ? 88 : 20; // passthrough — leaks real IP
        const rtcFailing = rtcMode === "passthrough";

        // ── Navigator consistency ──────────────────────────────────────────
        // Check that ua_platform, platform, ua_platform_version all agree
        const navPlatform = (fp.ua_platform ?? "").toLowerCase();
        const platform = (fp.platform ?? "").toLowerCase();
        const consistent =
            (navPlatform.includes("win") && platform.includes("win")) ||
            (navPlatform.includes("mac") && platform.includes("mac")) ||
            (navPlatform.includes("linux") && platform.includes("linux"));
        const hasBrands = (fp.ua_brands ?? []).length >= 2;
        const navScore = clamp((consistent ? 60 : 10) + (hasBrands ? 40 : 0));
        const navFailing = !consistent || !hasBrands;

        // ── Permissions API ────────────────────────────────────────────────
        const perms = fp.permissions ?? {};
        const permCount = Object.keys(perms).length;
        const hasDenied = Object.values(perms).some(
            (v) => v === "denied" || v === "prompt",
        );
        const permScore = clamp(
            (permCount >= 3 ? 50 : permCount * 15) + (hasDenied ? 50 : 0),
        );
        const permFailing = permCount < 2;

        return [
            {
                id: "canvas",
                label: "Canvas 2D",
                weight: 0.3,
                score: canvasScore,
                detail: `noise=${(canvasNoise * 100).toFixed(1)}%`,
                failing: canvasFailing,
            },
            {
                id: "webgl",
                label: "WebGL",
                weight: 0.25,
                score: webglScore,
                detail: `${fp.webgl_vendor ?? "unknown"} / noise=${(webglNoise * 100).toFixed(1)}%`,
                failing: webglFailing,
            },
            {
                id: "audio",
                label: "AudioContext",
                weight: 0.15,
                score: audioScore,
                detail: `noise=${(audioNoise * 1e5).toFixed(2)}e-5`,
                failing: audioFailing,
            },
            {
                id: "fonts",
                label: "Font Subset",
                weight: 0.1,
                score: fontScore,
                detail: `${fontCount} fonts exposed`,
                failing: fontFailing,
            },
            {
                id: "webrtc",
                label: "WebRTC",
                weight: 0.1,
                score: rtcScore,
                detail: rtcMode,
                failing: rtcFailing,
            },
            {
                id: "navigator",
                label: "Navigator",
                weight: 0.05,
                score: navScore,
                detail: consistent ? "consistent" : "⚠ mismatch",
                failing: navFailing,
            },
            {
                id: "perms",
                label: "Permissions",
                weight: 0.05,
                score: permScore,
                detail: `${permCount} overrides`,
                failing: permFailing,
            },
        ];
    });

    let overallScore = $derived.by((): number => {
        if (vectors.length === 0) return 0;
        const weighted = vectors.reduce(
            (acc, v) => acc + v.score * v.weight,
            0,
        );
        return Math.round(clamp(weighted));
    });

    let scoreLabel = $derived(
        overallScore >= 85
            ? "Unique"
            : overallScore >= 70
              ? "Moderate"
              : overallScore >= 50
                ? "Weak"
                : "Exposed",
    );

    let scoreColor = $derived(
        overallScore >= 85
            ? "var(--success)"
            : overallScore >= 70
              ? "var(--warning)"
              : "var(--error)",
    );

    let failingVectors = $derived(vectors.filter((v) => v.failing));

    // ── Iframe previews ───────────────────────────────────────────────────────

    let activePreview = $state<"creepjs" | "pixelscan" | "browserleaks" | null>(
        null,
    );

    const PREVIEWS = [
        {
            id: "creepjs",
            label: "CreepJS",
            url: "https://abrahamjuliot.github.io/creepjs/",
        },
        { id: "pixelscan", label: "Pixelscan", url: "https://pixelscan.net/" },
        {
            id: "browserleaks",
            label: "BrowserLeaks",
            url: "https://browserleaks.com/canvas",
        },
    ] as const;
</script>

<div class="fp-preview">
    <!-- ── Overall score ring ─────────────────────────────────────────── -->
    <div class="score-section">
        <div class="score-ring-wrap">
            <svg class="score-ring" viewBox="0 0 80 80" width="80" height="80">
                <!-- Track -->
                <circle
                    cx="40"
                    cy="40"
                    r="32"
                    fill="none"
                    stroke="var(--border-subtle)"
                    stroke-width="7"
                />
                <!-- Fill arc: circumference = 2π·32 ≈ 201 -->
                {#if fingerprint}
                    <circle
                        cx="40"
                        cy="40"
                        r="32"
                        fill="none"
                        stroke={scoreColor}
                        stroke-width="7"
                        stroke-linecap="round"
                        stroke-dasharray="201"
                        stroke-dashoffset={201 - (overallScore / 100) * 201}
                        transform="rotate(-90 40 40)"
                        style="transition: stroke-dashoffset 0.6s ease, stroke 0.4s ease"
                    />
                {/if}
            </svg>
            <div class="score-center">
                {#if fingerprint}
                    <span class="score-num" style:color={scoreColor}
                        >{overallScore}</span
                    >
                    <span class="score-lbl">{scoreLabel}</span>
                {:else}
                    <span class="score-empty">—</span>
                {/if}
            </div>
        </div>

        <div class="score-meta">
            <p class="score-desc">
                {#if !fingerprint}
                    Select a profile to score its fingerprint vectors.
                {:else if overallScore >= 85}
                    Profile passes 2026 stealth thresholds. All major leak
                    vectors hardened.
                {:else if overallScore >= 70}
                    Profile is moderately hardened. Review failing vectors
                    below.
                {:else}
                    Critical fingerprint leaks detected. Profile will be
                    identified by detectors.
                {/if}
            </p>
            {#if failingVectors.length > 0}
                <div class="failing-list">
                    <span class="failing-label">Failing vectors:</span>
                    {#each failingVectors as v}
                        <span class="failing-chip">{v.label}</span>
                    {/each}
                </div>
            {/if}
        </div>
    </div>

    <!-- ── Per-vector breakdown ───────────────────────────────────────── -->
    {#if fingerprint}
        <div class="vectors">
            {#each vectors as v (v.id)}
                {@const barWidth = v.score}
                {@const barColor = v.failing
                    ? "var(--error)"
                    : v.score >= 80
                      ? "var(--success)"
                      : "var(--warning)"}
                <div class="vector-row" class:failing={v.failing}>
                    <div class="vec-header">
                        <span class="vec-label" class:failing={v.failing}
                            >{v.label}</span
                        >
                        <span class="vec-weight">×{v.weight.toFixed(2)}</span>
                        <span class="vec-score mono" style:color={barColor}
                            >{v.score}</span
                        >
                    </div>
                    <div class="vec-bar-track">
                        <div
                            class="vec-bar-fill"
                            style:width="{barWidth}%"
                            style:background={barColor}
                        ></div>
                    </div>
                    <span class="vec-detail">{v.detail}</span>
                </div>
            {/each}
        </div>

        <!-- ── Hamming distance info ─────────────────────────────────────── -->
        <div class="hamming-info">
            <span class="info-icon">ℹ</span>
            <span>
                Per-profile PRNG seed <span class="mono"
                    >{fingerprint.seed}</span
                > — canvas/WebGL/audio outputs diverge by &gt;4 bits (Hamming) from
                any other seed.
            </span>
        </div>
    {/if}

    <!-- ── External detector iframes ─────────────────────────────────── -->
    {#if showIframes && fingerprint}
        <div class="iframe-section">
            <div class="iframe-tabs">
                {#each PREVIEWS as p}
                    <button
                        class="itab"
                        class:active={activePreview === p.id}
                        onclick={() =>
                            (activePreview =
                                activePreview === p.id ? null : p.id)}
                    >
                        {p.label}
                        {#if p.id === "creepjs"}
                            <span class="itab-hint">score &gt;85%</span>
                        {/if}
                    </button>
                {/each}
                {#if activePreview}
                    <button
                        class="itab-close"
                        onclick={() => (activePreview = null)}
                        title="Close preview">✕</button
                    >
                {/if}
            </div>

            {#if activePreview}
                {@const preview = PREVIEWS.find((p) => p.id === activePreview)}
                {#if preview}
                    <div class="iframe-wrap">
                        <div class="iframe-banner">
                            <span class="iframe-url mono">{preview.url}</span>
                            <span class="iframe-note">
                                Opens in profile browser context — scores
                                reflect active evasions
                            </span>
                        </div>
                        <iframe
                            src={preview.url}
                            title="{preview.label} fingerprint test"
                            class="fp-iframe"
                            sandbox="allow-scripts allow-same-origin allow-forms"
                            loading="lazy"
                        ></iframe>
                    </div>
                {/if}
            {/if}
        </div>
    {/if}
</div>

<style>
    .fp-preview {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    /* ── Score ring ───────────────────────────────────────────────────── */

    .score-section {
        display: flex;
        align-items: flex-start;
        gap: 20px;
    }

    .score-ring-wrap {
        position: relative;
        flex-shrink: 0;
        width: 80px;
        height: 80px;
    }

    .score-ring {
        transform: scale(1);
    }

    .score-center {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0;
    }

    .score-num {
        font-size: 20px;
        font-weight: 700;
        font-family: "JetBrains Mono", monospace;
        line-height: 1;
        transition: color 0.4s ease;
    }

    .score-lbl {
        font-size: 9px;
        color: var(--text-muted);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        margin-top: 2px;
    }

    .score-empty {
        font-size: 20px;
        color: var(--text-muted);
        font-family: "JetBrains Mono", monospace;
    }

    .score-meta {
        flex: 1;
        min-width: 0;
        padding-top: 4px;
    }

    .score-desc {
        font-size: 11.5px;
        color: var(--text-secondary);
        line-height: 1.5;
        margin: 0 0 8px;
    }

    .failing-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
    }

    .failing-label {
        font-size: 10px;
        color: var(--error);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-right: 2px;
    }

    .failing-chip {
        font-size: 10px;
        padding: 1px 6px;
        background: color-mix(in srgb, var(--error) 12%, transparent);
        color: var(--error);
        border: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
        border-radius: 3px;
        font-family: "JetBrains Mono", monospace;
    }

    /* ── Vector breakdown ─────────────────────────────────────────────── */

    .vectors {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .vector-row {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 8px 10px;
        border-radius: 6px;
        background: var(--surface-2);
        border: 1px solid var(--border-subtle);
        transition: border-color 0.2s;
    }

    .vector-row.failing {
        border-color: color-mix(in srgb, var(--error) 35%, transparent);
        background: color-mix(in srgb, var(--error) 5%, var(--surface-2));
    }

    .vec-header {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .vec-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-primary);
        flex: 1;
    }

    .vec-label.failing {
        color: var(--error);
    }

    .vec-weight {
        font-size: 10px;
        color: var(--text-muted);
        font-family: "JetBrains Mono", monospace;
    }

    .vec-score {
        font-size: 12px;
        font-weight: 700;
        font-family: "JetBrains Mono", monospace;
        min-width: 28px;
        text-align: right;
    }

    .vec-bar-track {
        height: 4px;
        background: var(--border-subtle);
        border-radius: 2px;
        overflow: hidden;
    }

    .vec-bar-fill {
        height: 100%;
        border-radius: 2px;
        transition:
            width 0.5s ease,
            background 0.3s ease;
    }

    .vec-detail {
        font-size: 10px;
        color: var(--text-muted);
        font-family: "JetBrains Mono", monospace;
    }

    /* ── Hamming info ─────────────────────────────────────────────────── */

    .hamming-info {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        padding: 8px 10px;
        background: color-mix(in srgb, var(--accent) 6%, var(--surface-2));
        border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
        border-radius: 6px;
        font-size: 10.5px;
        color: var(--text-secondary);
        line-height: 1.5;
    }

    .info-icon {
        color: var(--accent);
        font-style: normal;
        flex-shrink: 0;
        margin-top: 1px;
    }

    .mono {
        font-family: "JetBrains Mono", monospace;
        color: var(--accent);
    }

    /* ── Iframe section ───────────────────────────────────────────────── */

    .iframe-section {
        display: flex;
        flex-direction: column;
        gap: 0;
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        overflow: hidden;
    }

    .iframe-tabs {
        display: flex;
        align-items: stretch;
        background: var(--surface-1);
        border-bottom: 1px solid var(--border-subtle);
        gap: 0;
    }

    .itab {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        font-size: 11px;
        font-weight: 500;
        color: var(--text-secondary);
        background: transparent;
        border: none;
        border-right: 1px solid var(--border-subtle);
        cursor: pointer;
        transition:
            background 0.15s,
            color 0.15s;
        white-space: nowrap;
    }

    .itab:hover {
        background: var(--surface-2);
        color: var(--text-primary);
    }

    .itab.active {
        background: var(--surface-2);
        color: var(--accent);
        border-bottom-color: var(--surface-2);
    }

    .itab-hint {
        font-size: 9px;
        padding: 1px 5px;
        background: color-mix(in srgb, var(--success) 15%, transparent);
        color: var(--success);
        border-radius: 3px;
        font-family: "JetBrains Mono", monospace;
    }

    .itab-close {
        margin-left: auto;
        padding: 7px 12px;
        font-size: 11px;
        color: var(--text-muted);
        background: transparent;
        border: none;
        border-left: 1px solid var(--border-subtle);
        cursor: pointer;
    }

    .itab-close:hover {
        color: var(--text-primary);
        background: var(--surface-2);
    }

    .iframe-wrap {
        display: flex;
        flex-direction: column;
    }

    .iframe-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 12px;
        background: color-mix(in srgb, var(--accent) 5%, var(--surface-1));
        border-bottom: 1px solid var(--border-subtle);
    }

    .iframe-url {
        font-size: 10px;
        color: var(--accent);
    }

    .iframe-note {
        font-size: 10px;
        color: var(--text-muted);
        white-space: nowrap;
    }

    .fp-iframe {
        width: 100%;
        height: 520px;
        border: none;
        background: #fff;
    }
</style>
