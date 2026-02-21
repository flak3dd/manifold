<script lang="ts">
    import { invoke } from "@tauri-apps/api/core";
    import { profileStore } from "$lib/stores/profiles.svelte";
    import { bridgeStore } from "$lib/stores/bridge.svelte";
    import { toast } from "svelte-sonner";

    let confirming = $state(false);
    let shutting   = $state(false);
    let confirmTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Panic logic ───────────────────────────────────────────────────────────
    //
    // Phase 1: First click → enter confirm state (3 s window)
    // Phase 2: Second click within window → execute full shutdown sequence:
    //   1. Stop the Playwright bridge process
    //   2. Set all running profiles to "idle" in the DB
    //   3. Disconnect all WebSocket clients
    //   4. Emit a visual "PANIC" flash

    async function handleClick() {
        if (shutting) return;

        if (!confirming) {
            // Enter confirm mode; auto-cancel after 3 s
            confirming = true;
            confirmTimer = setTimeout(() => {
                confirming = false;
                confirmTimer = null;
            }, 3000);
            return;
        }

        // Second click — execute panic
        if (confirmTimer) {
            clearTimeout(confirmTimer);
            confirmTimer = null;
        }
        confirming = false;
        shutting   = true;

        try {
            await executePanic();
        } finally {
            // Brief lock-out to prevent double-trigger
            setTimeout(() => { shutting = false; }, 2000);
        }
    }

    async function executePanic() {
        const errors: string[] = [];

        // 1. Stop bridge (kills the Playwright browser process)
        try {
            await invoke("stop_bridge");
        } catch (e) {
            errors.push(`bridge: ${e}`);
        }

        // 2. Disconnect WS client in the frontend
        try {
            bridgeStore.disconnect();
        } catch (e) {
            errors.push(`ws: ${e}`);
        }

        // 3. Set all running profiles to idle via Rust backend
        const running = profileStore.profiles.filter(p => p.status === "running");
        for (const p of running) {
            try {
                await invoke("set_profile_status", { id: p.id, status: "idle" });
            } catch (e) {
                errors.push(`profile ${p.id}: ${e}`);
            }
        }

        // 4. Reload profile list to reflect status changes
        try {
            await profileStore.loadProfiles();
        } catch (_) { /* best-effort */ }

        // 5. Notify
        if (errors.length === 0) {
            toast.success("🛑 Panic shutdown complete — all sessions stopped", {
                duration: 6000,
            });
        } else {
            toast.error(`Panic shutdown completed with ${errors.length} error(s)`, {
                description: errors.slice(0, 3).join("\n"),
                duration: 8000,
            });
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        // Allow activation via Enter / Space
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
        }
        // Escape cancels confirm mode
        if (e.key === "Escape" && confirming) {
            confirming = false;
            if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
        }
    }
</script>

<div
    class="panic-wrap"
    class:confirming
    class:shutting
    role="group"
    aria-label="Emergency panic shutdown"
>
    <button
        class="panic-btn"
        class:confirm-state={confirming}
        class:shutting-state={shutting}
        onclick={handleClick}
        onkeydown={handleKeydown}
        title={confirming ? "Click again to confirm shutdown" : "Panic — emergency stop all sessions"}
        aria-label={confirming ? "Confirm emergency shutdown" : "Panic shutdown"}
        disabled={shutting}
    >
        {#if shutting}
            <!-- Spinner during shutdown -->
            <svg class="spin" width="11" height="11" viewBox="0 0 11 11" fill="none">
                <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.5"
                    stroke-dasharray="18" stroke-dashoffset="6" stroke-linecap="round"/>
            </svg>
            <span>Stopping…</span>
        {:else if confirming}
            <!-- Warning icon in confirm state -->
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M5.5 1L10 10H1L5.5 1z" stroke="currentColor" stroke-width="1.4"
                    stroke-linejoin="round"/>
                <line x1="5.5" y1="4.5" x2="5.5" y2="7" stroke="currentColor" stroke-width="1.4"
                    stroke-linecap="round"/>
                <circle cx="5.5" cy="8.5" r="0.6" fill="currentColor"/>
            </svg>
            <span>Confirm?</span>
        {:else}
            <!-- Stop square icon -->
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor"/>
            </svg>
            <span>Panic</span>
        {/if}
    </button>

    {#if confirming}
        <div class="confirm-tooltip" role="alert" aria-live="assertive">
            Click again to stop ALL sessions
            <span class="confirm-timer-bar"></span>
        </div>
    {/if}
</div>

<style>
    .panic-wrap {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
    }

    /* ── Base button ─────────────────────────────────────────────────────── */

    .panic-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        height: 26px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--error) 80%, var(--text-secondary));
        background: color-mix(in srgb, var(--error) 8%, var(--surface-2));
        border: 1px solid color-mix(in srgb, var(--error) 22%, var(--border-subtle));
        border-radius: 5px;
        cursor: pointer;
        transition:
            background  0.15s ease,
            border-color 0.15s ease,
            color        0.15s ease,
            box-shadow   0.15s ease,
            transform    0.1s ease;
        white-space: nowrap;
        user-select: none;
    }

    .panic-btn:hover:not(:disabled) {
        background:    color-mix(in srgb, var(--error) 16%, var(--surface-2));
        border-color:  color-mix(in srgb, var(--error) 45%, transparent);
        color:         var(--error);
        box-shadow:    0 0 6px color-mix(in srgb, var(--error) 20%, transparent);
    }

    .panic-btn:active:not(:disabled) {
        transform: scale(0.97);
    }

    /* ── Confirm state ───────────────────────────────────────────────────── */

    .panic-btn.confirm-state {
        background:   color-mix(in srgb, var(--error) 20%, var(--surface-1));
        border-color: color-mix(in srgb, var(--error) 60%, transparent);
        color:        var(--error);
        animation:    panic-pulse 0.8s ease-in-out infinite alternate;
    }

    @keyframes panic-pulse {
        from { box-shadow: 0 0 0px   color-mix(in srgb, var(--error) 0%, transparent); }
        to   { box-shadow: 0 0 10px  color-mix(in srgb, var(--error) 40%, transparent); }
    }

    /* ── Shutting state ──────────────────────────────────────────────────── */

    .panic-btn.shutting-state,
    .panic-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        animation: none;
    }

    .spin {
        animation: rotate 0.9s linear infinite;
    }

    @keyframes rotate {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
    }

    /* ── Confirm tooltip ─────────────────────────────────────────────────── */

    .confirm-tooltip {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 180px;
        padding: 6px 10px 8px;
        background: var(--surface-1);
        border: 1px solid color-mix(in srgb, var(--error) 40%, transparent);
        border-radius: 6px;
        font-size: 10.5px;
        color: var(--error);
        font-weight: 500;
        text-align: center;
        z-index: 200;
        display: flex;
        flex-direction: column;
        gap: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        pointer-events: none;
        white-space: nowrap;

        /* Fade in */
        animation: tooltip-in 0.12s ease-out both;
    }

    @keyframes tooltip-in {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    /* 3-second countdown bar */
    .confirm-timer-bar {
        display: block;
        height: 2px;
        background: var(--error);
        border-radius: 1px;
        transform-origin: left;
        animation: drain 3s linear forwards;
    }

    @keyframes drain {
        from { transform: scaleX(1); }
        to   { transform: scaleX(0); }
    }
</style>
