<script lang="ts">
  import { page } from '$app/stores';
  import '../../app.css';
  let { children } = $props();

  // Simplified Hub: just two tabs — Setup (all-in-one) and Automation
  const TABS = [
    { href: '/hub', label: 'Setup', icon: 'fingerprint' },
    { href: '/hub/automation', label: 'Automation', icon: 'play.circle.fill' },
  ];

  let current = $derived($page.url.pathname);
  function isActive(href: string) {
    if (href === '/hub') return current === '/hub' || current === '/hub/';
    return current.startsWith(href);
  }
</script>

<div class="hub-shell">
  <header class="hub-header">
    <a href="/" class="hub-back">← Manifold</a>
    <span class="hub-title">Manifold Hub</span>
  </header>
  <nav class="hub-tabs">
    {#each TABS as tab (tab.href)}
      <a
        href={tab.href}
        class="hub-tab"
        class:active={isActive(tab.href)}
      >
        <span class="hub-tab-icon">{#if tab.icon === 'fingerprint'}🖐{:else if tab.icon === 'magnifyingglass'}🔍{:else if tab.icon === 'key.fill'}🔑{:else}▶{/if}</span>
        {tab.label}
      </a>
    {/each}
  </nav>
  <main class="hub-main">
    {@render children()}
  </main>
</div>

<style>
  .hub-shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: var(--bg);
  }
  .hub-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--surface-1);
    border-bottom: 1px solid var(--border);
  }
  .hub-back {
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 0.875rem;
  }
  .hub-back:hover {
    color: var(--accent);
  }
  .hub-title {
    font-weight: 600;
    color: var(--text-primary);
  }
  .hub-tabs {
    display: flex;
    gap: 2px;
    padding: 0.5rem 1rem;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .hub-tab {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-radius: var(--radius);
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 0.875rem;
  }
  .hub-tab:hover {
    color: var(--text-primary);
    background: var(--surface-3);
  }
  .hub-tab.active {
    color: var(--accent);
    background: var(--accent-glow);
  }
  .hub-tab-icon {
    font-size: 1rem;
  }
  .hub-main {
    flex: 1;
    overflow: auto;
    padding: 1rem;
  }
</style>
