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

    onMount(async () => {
        // ── Load persisted data ───────────────────────────────────────────────────
        // Load profiles and proxies from the Rust backend in parallel
        const loadPromises: Promise<void>[] = [
            profileStore.loadProfiles(),
            proxyStore.loadProxies(),
            appStore.loadSources(),
        ];
        await Promise.allSettled(loadPromises);

        // ── Connect WebSocket clients ─────────────────────────────────────────────
        // Scraper WS — auto-reconnects until the scraper is up
        ws.connect();

        // Bridge WS — connects to the playwright-bridge for live trace data
        bridgeStore.connect();

        // Attempt to launch the scraper sidecar via Tauri (best-effort)
        appStore.startScraper();
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
</style>
