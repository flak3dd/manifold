<script lang="ts">
  import { hubFingerprintStore } from '$lib/hub/stores/fingerprint';
  import { hubCredentialsStore } from '$lib/hub/stores/credentials';
  import { hubSiteProfilesStore } from '$lib/hub/stores/siteProfiles';
  import AddCredentialForm from './credentials/AddCredentialForm.svelte';
  import FingerprintPreview from '$lib/components/FingerprintPreview.svelte';
  import type { Fingerprint } from '$lib/types';

  // Step 1 — Target site & scan
  let urlInput = $state('');
  let scanning = $state(false);
  let scanLog = $state<string[]>([]);

  // Step 2 — Credentials
  let showAddCredential = $state(false);
  let credentials = $derived(hubCredentialsStore.credentials);

  // Step 3 — Fingerprint summary
  let fp = $state<Fingerprint | null>(hubFingerprintStore.currentFingerprint);

  async function handleScan() {
    if (!urlInput.trim()) return;
    scanning = true;
    scanLog = [];
    try {
      // Use existing scanSite helper (via hub scanner) if available
      const { scanSite } = await import('$lib/hub/scanner');
      const profile = await scanSite(urlInput.trim(), (msg: string) => {
        scanLog = [...scanLog, `[${new Date().toLocaleTimeString()}] ${msg}`];
      });
      hubSiteProfilesStore.add(profile);
    } catch (e) {
      scanLog = [...scanLog, `Error: ${e instanceof Error ? e.message : String(e)}`];
    } finally {
      scanning = false;
    }
  }

  async function handleGenerateFingerprint() {
    const newFp = await hubFingerprintStore.generateNew();
    fp = newFp;
  }
</script>

<div class="hub-page setup-page">
  <!-- Step 1: Target site & scan -->
  <section class="card">
    <h2>1. Target site</h2>
    <p class="hint">Enter a login or payment URL and optionally run a quick scan for fields and protections.</p>
    <div class="field-group">
      <label for="hub-target-url">Target URL</label>
      <input
        id="hub-target-url"
        type="url"
        bind:value={urlInput}
        placeholder="https://example.com/login"
      />
    </div>
    <button class="btn-primary" onclick={handleScan} disabled={scanning || !urlInput.trim()}>
      {scanning ? 'Scanning…' : 'Scan site'}
    </button>
    <details class="log-details">
      <summary>Scan log</summary>
      <pre class="log-content">{scanLog.join('\n') || '—'}</pre>
    </details>
  </section>

  <!-- Step 2: Credentials -->
  <section class="card">
    <div class="card-head">
      <h2>2. Credentials</h2>
      <button class="btn-ghost" onclick={() => (showAddCredential = true)}>+ Add</button>
    </div>
    {#if credentials.length === 0}
      <p class="hint">No credentials yet. Click “Add” to create your first pair.</p>
    {:else}
      <ul class="cred-list">
        {#each credentials as c (c.id)}
          <li class="cred-item">
            <span>{c.username}</span>
            <div class="cred-actions">
              <a href="/hub/credentials/edit/{c.id}" class="link">Edit</a>
              <button type="button" class="link danger" onclick={() => hubCredentialsStore.delete(c.id)}>
                Delete
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Step 3: Fingerprint (summary only) -->
  <section class="card">
    <div class="card-head">
      <h2>3. Fingerprint</h2>
      <button class="btn-primary" onclick={handleGenerateFingerprint}>
        {fp ? 'Regenerate' : 'Generate'} fingerprint
      </button>
    </div>
    <p class="hint">
      A fresh fingerprint is generated for each credential attempt during automation. You can pre-generate one
      here and verify uniqueness at
      <a href={hubFingerprintStore.amiUniqueUrl} target="_blank" rel="noopener noreferrer">AmIUnique.org</a>.
    </p>
    {#if fp}
      <div class="fp-summary">
        <span class="seed-badge">seed: {fp.seed}</span>
        <span class="ua-badge" title={fp.user_agent}>{fp.platform} · {fp.hardware_concurrency} cores</span>
      </div>
      <FingerprintPreview fingerprint={fp} showIframes={false} />
    {:else}
      <p class="hint">No fingerprint yet. Click “Generate fingerprint” above.</p>
    {/if}
  </section>
</div>

{#if showAddCredential}
  <AddCredentialForm onClose={() => (showAddCredential = false)} onSaved={() => (showAddCredential = false)} />
{/if}

<style>
  .setup-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 900px;
  }
  .card {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem 1.25rem;
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  h2 {
    font-size: 1rem;
    color: var(--text-primary);
  }
  .hint {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin: 0.25rem 0 0.75rem;
  }
  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }
  .field-group label {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
  .field-group input {
    padding: 0.5rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface-3);
    color: var(--text-primary);
  }
  .btn-primary {
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .btn-ghost {
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .log-details {
    margin-top: 0.75rem;
  }
  .log-content {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--text-muted);
    max-height: 160px;
    overflow: auto;
  }
  .cred-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cred-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.875rem;
  }
  .cred-actions {
    display: flex;
    gap: 0.5rem;
  }
  .link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.875rem;
  }
  .link.danger {
    color: var(--error);
  }
  .fp-summary {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .seed-badge {
    font-size: 0.75rem;
    font-family: ui-monospace, monospace;
    color: var(--text-muted);
    background: var(--surface-3);
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
  }
  .ua-badge {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
</style>
