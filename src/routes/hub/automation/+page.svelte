<script lang="ts">
  import { hubFingerprintStore } from '$lib/hub/stores/fingerprint';
  import { hubCredentialsStore } from '$lib/hub/stores/credentials';
  import { hubSiteProfilesStore } from '$lib/hub/stores/siteProfiles';
  import { hubRunsStore } from '$lib/hub/stores/runs';
  import type { LogEntry, AutomationRun, RunResult } from '$lib/hub/types';

  let credentials = $derived(hubCredentialsStore.credentials);
  let siteProfiles = $derived(hubSiteProfilesStore.siteProfiles);
  let runs = $derived(hubRunsStore.runs);

  let targetURL = $state('');
  let selectedSiteProfileId = $state<string | null>(null);
  let selectedCredentialId = $state<string | null>(null);
  let ensureUniqueAmIUnique = $state(true);
  let running = $state(false);
  let logEntries = $state<LogEntry[]>([]);
  let result = $state<RunResult | null>(null);
  let runFingerprintSeed = $state<number | null>(null);
  let showHistory = $state(false);

  let selectedCredential = $derived(selectedCredentialId ? hubCredentialsStore.getById(selectedCredentialId) : null);
  let selectedSiteProfile = $derived(selectedSiteProfileId ? hubSiteProfilesStore.getById(selectedSiteProfileId) : null);
  const effectiveURL = $derived(targetURL.trim() || selectedSiteProfile?.url || '');

  function addLog(message: string, level: LogEntry['level'] = 'info') {
    logEntries = [...logEntries, { id: crypto.randomUUID(), timestamp: new Date().toISOString(), message, level }];
  }

  async function startRun() {
    if (!selectedCredential || !effectiveURL) return;
    const password = hubCredentialsStore.getPassword(selectedCredential.id);
    if (!password) {
      addLog('Failed to load credential password', 'error');
      return;
    }

    running = true;
    logEntries = [];
    result = null;
    runFingerprintSeed = null;

    // Generate a new fingerprint for this credential attempt (unique per run)
    addLog('Generating new fingerprint for this attempt…', 'info');
    const fingerprint = await hubFingerprintStore.generateForRun();
    runFingerprintSeed = fingerprint.seed;
    addLog(`Fingerprint seed: ${fingerprint.seed} (verify at AmIUnique.org)`, 'info');

    if (ensureUniqueAmIUnique) {
      addLog('Ensure unique: open session with this fingerprint at AmIUnique.org before target.', 'info');
      addLog(`→ ${hubFingerprintStore.amiUniqueUrl}`, 'info');
    }

    const run: AutomationRun = {
      id: crypto.randomUUID(),
      profileId: '', // no profile; fingerprint is per-run
      credentialId: selectedCredential.id,
      startedAt: new Date().toISOString(),
      status: 'running',
      result: 'unknown',
      logEntries: [],
    };
    hubRunsStore.add(run);

    addLog(`Navigating to ${effectiveURL}`, 'info');
    await delay(800);
    addLog('Page loaded', 'success');
    addLog('Filling credentials (human-like)…', 'info');
    await delay(500);
    addLog('Human typing password (entropy 0.84)', 'info');
    await delay(600);
    addLog('Clicked submit', 'info');
    await delay(1200);

    const simulatedSuccess = Math.random() > 0.3;
    if (simulatedSuccess) {
      addLog('Success: session captured', 'success');
      result = 'success';
      run.result = 'success';
      run.sessionCookies = '[]';
      run.localStorageSnapshot = '{}';
    } else {
      addLog('Login failed or challenge detected', 'error');
      result = Math.random() > 0.5 ? 'challenge_detected' : 'declined';
      run.result = result;
    }

    run.status = 'completed';
    run.completedAt = new Date().toISOString();
    run.logEntries = logEntries;
    hubRunsStore.update(run.id, run);

    hubCredentialsStore.touchLastUsed(selectedCredential.id);
    running = false;
  }

  function delay(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function resultColor(r: RunResult) {
    if (r === 'success') return 'var(--success)';
    if (r === 'challenge_detected') return 'var(--warning)';
    return 'var(--error)';
  }
</script>

<div class="hub-page">
  <h1>Automation Runner</h1>
  <p class="hint">
    Each run generates a <strong>new fingerprint</strong> for the credential attempt. Verify uniqueness at
    <a href={hubFingerprintStore.amiUniqueUrl} target="_blank" rel="noopener noreferrer">AmIUnique.org</a>.
  </p>

  <div class="runner-config">
    <label for="hub-auto-target-url">Target URL</label>
    <input id="hub-auto-target-url" type="url" bind:value={targetURL} placeholder="https://..." />
    <label for="hub-auto-site-profile">Or select scanned site</label>
    <select id="hub-auto-site-profile" bind:value={selectedSiteProfileId}>
      <option value={null}>—</option>
      {#each siteProfiles as s (s.id)}
        <option value={s.id}>{s.url}</option>
      {/each}
    </select>
    <label for="hub-auto-credential">Credential</label>
    <select id="hub-auto-credential" bind:value={selectedCredentialId}>
      <option value={null}>Select credential</option>
      {#each credentials as c (c.id)}
        <option value={c.id}>{c.username}</option>
      {/each}
    </select>
    <label class="checkbox-label">
      <input type="checkbox" bind:checked={ensureUniqueAmIUnique} />
      Ensure unique via AmIUnique (remind to verify in session)
    </label>
    <button
      class="btn-primary"
      onclick={startRun}
      disabled={running || !selectedCredentialId || !effectiveURL}
    >
      {running ? 'Running…' : 'Run (new fingerprint)'}
    </button>
  </div>

  <div class="log-panel">
    <h3>Log</h3>
    <div class="log-entries">
      {#each logEntries as entry (entry.id)}
        <div class="log-line" class:error={entry.level === 'error'} class:success={entry.level === 'success'}>
          <span class="log-ts">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          {entry.message}
        </div>
      {/each}
      {#if logEntries.length === 0 && !running}
        <span class="log-muted">—</span>
      {/if}
    </div>
  </div>

  {#if result}
    <div class="result-banner" style="color: {resultColor(result)}">
      {result === 'success' ? '✓' : '✗'} {result.replace('_', ' ').toUpperCase()}
    </div>
  {/if}

  {#if runFingerprintSeed != null}
    <div class="amiunique-verify">
      <strong>Fingerprint seed for this run:</strong> {runFingerprintSeed}
      <a href={hubFingerprintStore.amiUniqueUrl} target="_blank" rel="noopener noreferrer">Verify on AmIUnique.org →</a>
    </div>
  {/if}

  <div class="history-section">
    <button class="link" onclick={() => (showHistory = !showHistory)}>
      {showHistory ? 'Hide' : 'Show'} run history
    </button>
    {#if showHistory}
      <ul class="run-list">
        {#each runs.slice(0, 20) as r (r.id)}
          <li class="run-item">
            <span class="run-result" style="color: {resultColor(r.result)}">{r.result}</span>
            <span class="run-time">{new Date(r.startedAt).toLocaleString()}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .hint {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 1rem;
  }
  .hint a {
    color: var(--accent);
  }
  .runner-config {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 400px;
    margin-bottom: 1rem;
  }
  .runner-config label {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
  .runner-config input,
  .runner-config select {
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-3);
    color: var(--text-primary);
  }
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }
  .btn-primary {
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    align-self: flex-start;
  }
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .log-panel {
    margin-top: 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
  }
  .log-panel h3 {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
  }
  .log-entries {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    max-height: 220px;
    overflow: auto;
  }
  .log-line {
    color: var(--text-muted);
  }
  .log-line.error {
    color: var(--error);
  }
  .log-line.success {
    color: var(--success);
  }
  .log-ts {
    margin-right: 0.5rem;
    color: var(--text-muted);
  }
  .log-muted {
    color: var(--text-muted);
  }
  .result-banner {
    margin-top: 1rem;
    padding: 0.75rem;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-weight: 600;
  }
  .amiunique-verify {
    margin-top: 1rem;
    padding: 0.75rem;
    background: var(--accent-glow);
    border-radius: var(--radius);
    font-size: 0.875rem;
  }
  .amiunique-verify a {
    display: inline-block;
    margin-left: 0.5rem;
    color: var(--accent);
  }
  .history-section {
    margin-top: 1.5rem;
  }
  .link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.875rem;
  }
  .run-list {
    list-style: none;
    margin-top: 0.5rem;
  }
  .run-item {
    display: flex;
    gap: 1rem;
    padding: 0.25rem 0;
    font-size: 0.8125rem;
  }
  .run-result {
    text-transform: capitalize;
  }
  .run-time {
    color: var(--text-muted);
  }
</style>
