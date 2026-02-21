<script lang="ts">
  import { appStore } from '$lib/stores/app.svelte';
  import StatusBadge from './StatusBadge.svelte';
  import type { Source, ScrapeResult } from '$lib/types';

  let { source }: { source: Source } = $props();

  let results = $derived(appStore.results[source.id] ?? []);
  let selectedResult = $state<ScrapeResult | null>(null);
  let copyFeedback = $state<string | null>(null);

  // Auto-select latest result
  $effect(() => {
    if (results.length > 0 && (!selectedResult || !results.find(r => r.id === selectedResult?.id))) {
      selectedResult = results[0];
    }
  });

  function formatTime(ts: string): string {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function formatDate(ts: string): string {
    return new Date(ts).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function formatFullTimestamp(ts: string): string {
    const d = new Date(ts);
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  async function copyContent() {
    if (!selectedResult) return;
    try {
      await navigator.clipboard.writeText(selectedResult.content.join('\n'));
      copyFeedback = 'Copied!';
      setTimeout(() => { copyFeedback = null; }, 1800);
    } catch {
      copyFeedback = 'Failed';
      setTimeout(() => { copyFeedback = null; }, 1800);
    }
  }

  function handleScrape() {
    appStore.scrapeSource(source.id);
  }

  function handleRemove() {
    appStore.removeSource(source.id);
  }

  // Diff: highlight lines that are new compared to the previous result
  function getDiffLines(current: ScrapeResult, allResults: ScrapeResult[]): Set<number> {
    const idx = allResults.indexOf(current);
    if (idx < 0 || idx >= allResults.length - 1) return new Set();
    const prev = new Set(allResults[idx + 1].content);
    const newLines = new Set<number>();
    current.content.forEach((line, i) => {
      if (!prev.has(line)) newLines.add(i);
    });
    return newLines;
  }

  let diffLines = $derived(selectedResult ? getDiffLines(selectedResult, results) : new Set<number>());
  let showDiff = $state(false);
</script>

<div class="panel">

  <!-- Panel header -->
  <div class="panel-header">
    <div class="header-left">
      <div class="source-info">
        <h2 class="source-name">{source.name}</h2>
        <StatusBadge status={source.status} />
      </div>
      <a
        class="source-url"
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
      >{source.url}</a>
    </div>

    <div class="header-actions">
      {#if results.length > 1}
        <button
          class="action-btn"
          class:active={showDiff}
          onclick={() => { showDiff = !showDiff; }}
          title="Highlight lines that changed since the previous scrape"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M1 3h11M1 6.5h7M1 10h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="11" cy="10" r="1.5" fill="var(--success)" opacity={showDiff ? 1 : 0.4}/>
          </svg>
          Diff
        </button>
      {/if}

      {#if selectedResult}
        <button
          class="action-btn"
          onclick={copyContent}
          title="Copy result to clipboard"
        >
          {#if copyFeedback}
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M2 6.5l3 3 6-6" stroke="var(--success)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            {copyFeedback}
          {:else}
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M9 4V2.5A1.5 1.5 0 0 0 7.5 1h-5A1.5 1.5 0 0 0 1 2.5v5A1.5 1.5 0 0 0 2.5 9H4" stroke="currentColor" stroke-width="1.3"/>
            </svg>
            Copy
          {/if}
        </button>
      {/if}

      <button
        class="action-btn scrape-btn"
        onclick={handleScrape}
        disabled={!appStore.wsConnected || source.status === 'scraping'}
        title={appStore.wsConnected ? 'Scrape now' : 'Scraper not connected'}
      >
        {#if source.status === 'scraping'}
          <span class="spin-dot" aria-hidden="true"></span>
          Fetching…
        {:else}
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M2 6.5A4.5 4.5 0 0 1 11 4.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            <path d="M9 2l2 2.3-2.3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Scrape
        {/if}
      </button>

      <button
        class="action-btn danger-btn"
        onclick={handleRemove}
        title="Remove this source"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M1 3h10M4 3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 6v3M7 6v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 3l.7 7.3A1 1 0 0 0 3.7 11h4.6a1 1 0 0 0 1-.7L10 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        Remove
      </button>
    </div>
  </div>

  <!-- Config row -->
  <div class="config-row">
    <span class="config-chip">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
        <path d="M1 4h8" stroke="currentColor" stroke-width="1.2"/>
      </svg>
      Selector: <code>{source.selector || '(body text)'}</code>
    </span>

    <span class="config-chip">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.2"/>
        <path d="M5 2.5V5l1.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
      Interval: <code>{source.interval > 0 ? `${source.interval}s` : 'Manual'}</code>
    </span>

    <span class="config-chip">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M1 8 L5 2 L9 8 Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>
      </svg>
      Runs: <code>{results.length}</code>
    </span>
  </div>

  <!-- Main content -->
  <div class="panel-body">

    {#if results.length === 0}
      <!-- Empty state -->
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="18" stroke="var(--border-hover)" stroke-width="1.5"/>
            <path d="M13 20h14M20 13v14" stroke="var(--border-hover)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <p class="empty-title">No results yet</p>
        <p class="empty-sub">
          {appStore.wsConnected
            ? 'Click Scrape to fetch data from this source.'
            : 'Start the scraper process, then click Scrape.'}
        </p>
        {#if appStore.wsConnected}
          <button class="empty-cta" onclick={handleScrape}>
            Scrape Now
          </button>
        {:else}
          <button class="empty-cta" onclick={() => appStore.startScraper()}>
            Start Scraper
          </button>
        {/if}
      </div>

    {:else}
      <div class="content-layout">

        <!-- History sidebar -->
        <div class="history-col">
          <div class="history-label">History</div>
          <div class="history-list">
            {#each results as result (result.id)}
              <button
                class="history-item"
                class:selected={selectedResult?.id === result.id}
                onclick={() => { selectedResult = result; }}
              >
                <div class="history-time">{formatTime(result.timestamp)}</div>
                <div class="history-date">{formatDate(result.timestamp)}</div>
                <div class="history-meta">
                  <span>{result.content.length} lines</span>
                  <span>{formatDuration(result.durationMs)}</span>
                </div>
              </button>
            {/each}
          </div>
        </div>

        <!-- Result view -->
        <div class="result-col">
          {#if selectedResult}
            <div class="result-header">
              <span class="result-ts">{formatFullTimestamp(selectedResult.timestamp)}</span>
              <div class="result-stats">
                <span class="stat-chip">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M1 2h8v6H1z" stroke="currentColor" stroke-width="1.1" rx="1"/>
                    <path d="M1 4h8" stroke="currentColor" stroke-width="1.1"/>
                  </svg>
                  {selectedResult.content.length} lines
                </span>
                <span class="stat-chip">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.1"/>
                    <path d="M5 2.5V5l1.5 1" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                  </svg>
                  {formatDuration(selectedResult.durationMs)}
                </span>
                {#if showDiff && diffLines.size > 0}
                  <span class="stat-chip diff-chip">
                    +{diffLines.size} new
                  </span>
                {/if}
              </div>
            </div>

            <div class="result-content">
              {#if selectedResult.content.length === 0}
                <p class="no-content">No content matched — try a different selector.</p>
              {:else}
                <table class="content-table">
                  <tbody>
                    {#each selectedResult.content as line, i}
                      <tr
                        class="content-row"
                        class:new-line={showDiff && diffLines.has(i)}
                      >
                        <td class="line-num">{i + 1}</td>
                        <td class="line-text">{line}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
            </div>

          {:else}
            <div class="no-selection">Select a run from the history to view results.</div>
          {/if}
        </div>

      </div>
    {/if}

    <!-- Error banner -->
    {#if source.status === 'error' && source.error}
      <div class="error-banner">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="6" stroke="var(--error)" stroke-width="1.4"/>
          <path d="M7 4v3.5M7 9.5h.01" stroke="var(--error)" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        <span>{source.error}</span>
      </div>
    {/if}

  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  /* ── Header ── */
  .panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 24px 14px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }

  .source-info {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .source-name {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-url {
    font-size: 11.5px;
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.12s;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }
  .source-url:hover {
    color: var(--accent);
  }

  /* Actions */
  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-secondary);
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    white-space: nowrap;
  }
  .action-btn:hover:not(:disabled) {
    background: var(--surface-3);
    border-color: var(--border-hover);
    color: var(--text-primary);
  }
  .action-btn.active {
    background: var(--surface-4);
    border-color: var(--border-hover);
    color: var(--success);
  }

  .scrape-btn {
    background: var(--surface-3);
    border-color: var(--border-hover);
    color: var(--text-primary);
  }
  .scrape-btn:hover:not(:disabled) {
    background: var(--accent-glow);
    border-color: rgba(129, 140, 248, 0.4);
    color: var(--accent);
  }
  .scrape-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .danger-btn:hover {
    background: rgba(248, 113, 113, 0.08) !important;
    border-color: rgba(248, 113, 113, 0.3) !important;
    color: var(--error) !important;
  }

  .spin-dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-top-color: transparent;
    animation: spin 0.75s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Config row ── */
  .config-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 24px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .config-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 99px;
    padding: 2px 8px;
  }
  .config-chip code {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 10.5px;
    color: var(--text-secondary);
  }

  /* ── Body ── */
  .panel-body {
    flex: 1;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  /* ── Empty state ── */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 48px 24px;
    text-align: center;
  }
  .empty-icon {
    opacity: 0.5;
    margin-bottom: 4px;
  }
  .empty-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .empty-sub {
    font-size: 13px;
    color: var(--text-muted);
    max-width: 320px;
    line-height: 1.6;
  }
  .empty-cta {
    margin-top: 8px;
    padding: 8px 22px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    background: var(--accent-dim);
    color: #fff;
    border: none;
    cursor: pointer;
    transition: background 0.12s;
  }
  .empty-cta:hover {
    background: var(--accent);
  }

  /* ── Content layout ── */
  .content-layout {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  /* History column */
  .history-col {
    width: 140px;
    min-width: 140px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .history-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    padding: 10px 12px 6px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .history-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 7px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    cursor: pointer;
    text-align: left;
    background: transparent;
    transition: background 0.1s, border-color 0.1s;
    width: 100%;
  }
  .history-item:hover {
    background: var(--surface-2);
    border-color: var(--border);
  }
  .history-item.selected {
    background: var(--surface-3);
    border-color: var(--border-hover);
  }

  .history-time {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
    font-family: 'JetBrains Mono', monospace;
  }
  .history-date {
    font-size: 10px;
    color: var(--text-muted);
  }
  .history-meta {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    margin-top: 2px;
  }
  .history-meta span {
    font-size: 9.5px;
    color: var(--text-muted);
    background: var(--surface-4);
    padding: 1px 4px;
    border-radius: 3px;
  }

  /* Result column */
  .result-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 18px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .result-ts {
    font-size: 11px;
    color: var(--text-muted);
    font-family: 'JetBrains Mono', monospace;
  }

  .result-stats {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .stat-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10.5px;
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 99px;
    padding: 2px 7px;
  }
  .diff-chip {
    color: var(--success);
    background: rgba(74, 222, 128, 0.07);
    border-color: rgba(74, 222, 128, 0.25);
  }

  /* Content table */
  .result-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .content-table {
    width: 100%;
    border-collapse: collapse;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 12px;
    line-height: 1.6;
  }

  .content-row {
    transition: background 0.08s;
  }
  .content-row:hover {
    background: var(--surface-2);
  }
  .content-row.new-line {
    background: rgba(74, 222, 128, 0.06);
  }
  .content-row.new-line:hover {
    background: rgba(74, 222, 128, 0.1);
  }
  .content-row.new-line .line-num {
    color: var(--success);
  }

  .line-num {
    width: 44px;
    min-width: 44px;
    padding: 2px 14px 2px 18px;
    text-align: right;
    color: var(--text-muted);
    font-size: 11px;
    vertical-align: top;
    user-select: none;
    border-right: 1px solid var(--border);
    white-space: nowrap;
  }

  .line-text {
    padding: 2px 18px;
    color: var(--text-secondary);
    word-break: break-word;
    white-space: pre-wrap;
  }

  .no-content {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
    padding: 24px 18px;
  }

  .no-selection {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
    padding: 32px;
  }

  /* Error banner */
  .error-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 18px;
    background: rgba(248, 113, 113, 0.07);
    border-top: 1px solid rgba(248, 113, 113, 0.2);
    font-size: 12px;
    color: var(--error);
    flex-shrink: 0;
  }
  .error-banner svg {
    flex-shrink: 0;
    margin-top: 1px;
  }
  .error-banner span {
    word-break: break-word;
    line-height: 1.5;
  }
</style>
