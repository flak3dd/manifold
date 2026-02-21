<script lang="ts">
  import { appStore } from '$lib/stores/app.svelte';
  import StatusBadge from './StatusBadge.svelte';
  import type { Source, ScrapeResult } from '$lib/types';

  let { source }: { source: Source } = $props();

  let results = $derived(appStore.results[source.id] ?? []);
  let latest: ScrapeResult | undefined = $derived(results[0]);

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatTime(ts: string): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function handleScrape(e: MouseEvent) {
    e.stopPropagation();
    appStore.scrapeSource(source.id);
  }

  function handleRemove(e: MouseEvent) {
    e.stopPropagation();
    appStore.removeSource(source.id);
  }

  let isActive = $derived(appStore.selectedSourceId === source.id);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="card"
  class:active={isActive}
  class:scraping={source.status === 'scraping'}
  onclick={() => { appStore.selectedSourceId = source.id; }}
>
  <!-- Card header -->
  <div class="card-header">
    <div class="card-title-row">
      <h3 class="card-name truncate">{source.name}</h3>
      <StatusBadge status={source.status} />
    </div>
    <a
      class="card-url truncate"
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      onclick={(e) => e.stopPropagation()}
    >
      {source.url}
    </a>
  </div>

  <!-- Result preview -->
  <div class="card-body">
    {#if source.status === 'scraping'}
      <div class="scraping-indicator">
        <span class="spin-dot"></span>
        <span class="scraping-label">Fetching…</span>
      </div>
    {:else if source.status === 'error' && source.error}
      <div class="error-block">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="5.5" stroke="var(--error)" stroke-width="1.3"/>
          <path d="M6.5 3.5v3M6.5 9h.01" stroke="var(--error)" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <p class="error-text truncate">{source.error}</p>
      </div>
    {:else if latest}
      <ul class="preview-list">
        {#each latest.content.slice(0, 5) as line}
          <li class="preview-line truncate">{line}</li>
        {/each}
        {#if latest.content.length > 5}
          <li class="preview-more">+{latest.content.length - 5} more lines</li>
        {/if}
      </ul>
    {:else}
      <p class="no-data">No data yet — scrape to begin.</p>
    {/if}
  </div>

  <!-- Card footer -->
  <div class="card-footer">
    <div class="card-meta">
      {#if latest}
        <span class="meta-item">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" stroke-width="1.1"/>
            <path d="M5.5 3v2.5l1.5 1" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          </svg>
          {formatTime(latest.timestamp)}
        </span>
        <span class="meta-item">
          {formatDuration(latest.durationMs)}
        </span>
        <span class="meta-item">
          {latest.content.length} lines
        </span>
      {:else}
        <span class="meta-item muted">Not scraped</span>
      {/if}
      {#if source.interval > 0}
        <span class="meta-item interval-badge">⏱ {source.interval}s</span>
      {/if}
    </div>

    <div class="card-actions">
      <button
        class="action-btn scrape-btn"
        onclick={handleScrape}
        disabled={!appStore.wsConnected || source.status === 'scraping'}
        title={appStore.wsConnected ? 'Scrape now' : 'Scraper not connected'}
        aria-label="Scrape {source.name}"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M2 6.5A4.5 4.5 0 0 1 11 4.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          <path d="M9 2l2 2.3-2.3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Scrape
      </button>

      <button
        class="action-btn remove-btn"
        onclick={handleRemove}
        title="Remove source"
        aria-label="Remove {source.name}"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Active indicator bar -->
  {#if isActive}
    <div class="active-bar" aria-hidden="true"></div>
  {/if}
</div>

<style>
  .card {
    position: relative;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    overflow: hidden;
  }

  .card:hover {
    border-color: var(--border-hover);
    background: var(--surface-3);
  }

  .card.active {
    border-color: var(--accent-dim);
    box-shadow: 0 0 0 1px var(--accent-dim), 0 4px 16px rgba(99, 102, 241, 0.12);
    background: var(--surface-3);
  }

  .card.scraping {
    border-color: rgba(56, 189, 248, 0.35);
  }

  /* Active bar */
  .active-bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--accent);
    border-radius: 3px 0 0 3px;
  }

  /* Header */
  .card-header {
    padding: 14px 14px 10px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .card-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .card-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    letter-spacing: -0.01em;
  }

  .card-url {
    font-size: 11px;
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.12s;
    display: block;
  }
  .card-url:hover {
    color: var(--accent);
    text-decoration: none;
  }

  /* Body */
  .card-body {
    flex: 1;
    padding: 10px 14px;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  /* Scraping animation */
  .scraping-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spin-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--info);
    border-top-color: transparent;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  .scraping-label {
    font-size: 12px;
    color: var(--info);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Error */
  .error-block {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .error-block svg {
    flex-shrink: 0;
    margin-top: 1px;
  }
  .error-text {
    font-size: 11px;
    color: var(--error);
    line-height: 1.5;
    flex: 1;
    min-width: 0;
  }

  /* Preview */
  .preview-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .preview-line {
    font-size: 11.5px;
    color: var(--text-secondary);
    line-height: 1.5;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  }
  .preview-more {
    font-size: 10.5px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .no-data {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }

  /* Footer */
  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px 10px;
    border-top: 1px solid var(--border);
  }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
    flex: 1;
  }

  .meta-item {
    font-size: 10.5px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }
  .meta-item.muted {
    opacity: 0.6;
  }
  .interval-badge {
    background: var(--surface-4);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1px 5px;
    color: var(--text-muted);
  }

  /* Action buttons */
  .card-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .scrape-btn {
    background: var(--surface-4);
    border-color: var(--border);
    color: var(--text-secondary);
  }
  .scrape-btn:hover:not(:disabled) {
    background: var(--accent-glow);
    border-color: rgba(129, 140, 248, 0.35);
    color: var(--accent);
  }
  .scrape-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .remove-btn {
    padding: 4px 6px;
    background: transparent;
    border-color: transparent;
    color: var(--text-muted);
  }
  .remove-btn:hover {
    background: rgba(248, 113, 113, 0.1);
    border-color: rgba(248, 113, 113, 0.25);
    color: var(--error);
  }

  .truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
