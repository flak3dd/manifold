<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import "../app.css";
    import { ws } from "$lib/websocket";
    import { appStore } from "$lib/stores/app.svelte";
    import { profileStore } from "$lib/stores/profiles.svelte";
    import { proxyStore } from "$lib/stores/proxy.svelte";
    import { bridgeStore } from "$lib/stores/bridge.svelte";
    import TopBar from "$lib/components/Sidebar.svelte";
    import AddSourceDialog from "$lib/components/AddSourceDialog.svelte";
    import ProfileModal from "$lib/components/ProfileModal.svelte";
    import { Toaster } from "svelte-sonner";

    let { children } = $props();

    let showAddDialog = $state(false);
    let showProfileModal = $state(false);
    let showStartupSplash = $state(true);
    let splashMessage = $state("Initializing dashboard...");
    let splashProgress = $state(0);
    let splashError = $state<string | null>(null);

    type BootstrapStep = {
        id: string;
        label: string;
        required: boolean;
    };

    type BootstrapPlan = {
        required: boolean;
        steps: BootstrapStep[];
    };

    function delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function runBootstrapInstall(): Promise<void> {
        const hasTauri =
            typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
        if (!hasTauri) return;

        const { invoke } = await import("@tauri-apps/api/core");
        splashMessage = "Checking machine requirements...";
        const plan = await invoke<BootstrapPlan>("bootstrap_check");
        const steps = (plan.steps ?? []).filter((s) => s.required);
        if (!steps.length) {
            splashProgress = 100;
            return;
        }

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            splashMessage = `${step.label} (${i + 1}/${steps.length})`;
            splashProgress = Math.round((i / steps.length) * 100);
            await invoke("run_bootstrap_step", { step: step.id });
            splashProgress = Math.round(((i + 1) / steps.length) * 100);
        }
    }

    onMount(async () => {
        const splashStartedAt = Date.now();

        try {
            await runBootstrapInstall();
        } catch (error) {
            splashError = `Setup warning: ${String(error)}`;
            splashMessage = "Continuing startup with existing environment...";
        }

        // ── Load persisted data ───────────────────────────────────────────────────
        // Load profiles and proxies from the Rust backend in parallel
        splashMessage = "Loading local data...";
        const loadPromises: Promise<void>[] = [
            profileStore.loadProfiles(),
            proxyStore.loadProxies(),
            appStore.loadSources(),
        ];
        await Promise.allSettled(loadPromises);

        // ── Start local sidecars (best effort): scraper + bridge ─────────────────
        splashMessage = "Starting local services...";
        await appStore.startServices();

        // ── Connect WebSocket clients ─────────────────────────────────────────────
        // Scraper WS — auto-reconnects until scraper sidecar is up
        splashMessage = "Connecting services...";
        ws.connect();

        // Bridge WS — auto-reconnects until bridge sidecar is up
        bridgeStore.connect();

        splashMessage = "Launching dashboard...";
        splashProgress = 100;

        // Keep logo visible for at least 2s so startup feels intentional.
        const elapsed = Date.now() - splashStartedAt;
        await delay(Math.max(0, 2000 - elapsed));
        showStartupSplash = false;
    });

    onDestroy(() => {
        ws.disconnect();
        bridgeStore.disconnect();
    });

    function handleProfileSaved() {
        showProfileModal = false;
        // Refresh the profile list after creation
        profileStore.loadProfiles();
    }
</script>

{#if showStartupSplash}
    <div class="startup-splash" aria-label="Manifold startup screen">
        <div class="splash-logo" role="img" aria-label="Manifold logo">
            <svg
                class="splash-icon"
                width="56"
                height="56"
                viewBox="0 0 16 16"
                fill="none"
            >
                <circle cx="3" cy="8" r="2.2" fill="var(--accent)" opacity="0.9"
                ></circle>
                <circle cx="8" cy="3" r="1.6" fill="var(--accent)" opacity="0.6"
                ></circle>
                <circle cx="13" cy="8" r="1.6" fill="var(--accent)" opacity="0.6"
                ></circle>
                <circle cx="8" cy="13" r="1.6" fill="var(--accent)" opacity="0.6"
                ></circle>
                <line
                    x1="3"
                    y1="8"
                    x2="8"
                    y2="3"
                    stroke="var(--accent)"
                    stroke-width="0.8"
                    opacity="0.35"
                ></line>
                <line
                    x1="3"
                    y1="8"
                    x2="13"
                    y2="8"
                    stroke="var(--accent)"
                    stroke-width="0.8"
                    opacity="0.35"
                ></line>
                <line
                    x1="3"
                    y1="8"
                    x2="8"
                    y2="13"
                    stroke="var(--accent)"
                    stroke-width="0.8"
                    opacity="0.35"
                ></line>
            </svg>
            <span class="splash-wordmark">MANIFOLD</span>
            <span class="splash-sub">{splashMessage}</span>
            <div class="splash-progress" aria-hidden="true">
                <div class="splash-progress-bar" style={`width: ${splashProgress}%`}></div>
            </div>
            {#if splashError}
                <span class="splash-error">{splashError}</span>
            {/if}
        </div>
    </div>
{:else}
    <div class="shell">
        <div class="chrome">
            <TopBar
                onAddSource={() => {
                    showAddDialog = true;
                }}
                onCreateProfile={() => {
                    showProfileModal = true;
                }}
            />
        </div>

        <main class="main-area">
            {@render children()}
        </main>
    </div>
{/if}

{#if showAddDialog}
    <AddSourceDialog
        onClose={() => {
            showAddDialog = false;
        }}
    />
{/if}

{#if showProfileModal}
    <ProfileModal
        onClose={() => {
            showProfileModal = false;
        }}
        onSaved={handleProfileSaved}
    />
{/if}

<Toaster position="bottom-right" theme="dark" richColors />

<style>
    .shell {
        display: flex;
        flex-direction: column;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
        background: var(--bg);
    }

    .chrome {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
    }

    .main-area {
        flex: 1;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .startup-splash {
        width: 100vw;
        height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(
            circle at 50% 40%,
            color-mix(in srgb, var(--accent) 10%, var(--bg)) 0%,
            var(--bg) 55%
        );
    }

    .splash-logo {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        animation: splash-fade-in 260ms ease-out;
    }

    .splash-icon {
        filter: drop-shadow(0 0 22px color-mix(in srgb, var(--accent) 22%, transparent));
        animation: splash-pulse 1.4s ease-in-out infinite;
    }

    .splash-wordmark {
        font-size: 16px;
        letter-spacing: 0.18em;
        font-weight: 700;
        color: var(--text-primary);
    }

    .splash-sub {
        font-size: 11px;
        color: var(--text-muted);
        letter-spacing: 0.04em;
    }

    .splash-progress {
        width: min(320px, 72vw);
        height: 6px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--text-muted) 25%, transparent);
        overflow: hidden;
        margin-top: 4px;
    }

    .splash-progress-bar {
        height: 100%;
        width: 0%;
        background: linear-gradient(
            90deg,
            color-mix(in srgb, var(--accent) 75%, white),
            var(--accent)
        );
        transition: width 220ms ease;
    }

    .splash-error {
        margin-top: 4px;
        max-width: min(560px, 85vw);
        text-align: center;
        font-size: 11px;
        color: #f59e0b;
    }

    @keyframes splash-fade-in {
        from {
            opacity: 0;
            transform: translateY(4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes splash-pulse {
        0%,
        100% {
            transform: scale(1);
            opacity: 0.9;
        }
        50% {
            transform: scale(1.05);
            opacity: 1;
        }
    }
</style>
