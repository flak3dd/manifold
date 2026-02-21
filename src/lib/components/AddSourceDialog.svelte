<script lang="ts">
  import { appStore } from '$lib/stores/app.svelte';
  import type { AddSourcePayload } from '$lib/types';

  let { onClose }: { onClose: () => void } = $props();

  let name = $state('');
  let url = $state('');
  let selector = $state('');
  let interval = $state(0);
  let errors = $state<Record<string, string>>({});
  let submitting = $state(false);

  function validate(): boolean {
    const e: Record<string, string> = {};

    if (!name.trim()) {
      e.name = 'Name is required.';
    }

    if (!url.trim()) {
      e.url = 'URL is required.';
    } else {
      try {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          e.url = 'URL must start with http:// or https://';
        }
      } catch {
        e.url = 'Enter a valid URL (e.g. https://example.com)';
      }
    }

    if (interval < 0) {
      e.interval = 'Interval must be 0 or greater.';
    }

    errors = e;
    return Object.keys(e).length === 0;
  }

  function handleSubmit(event: Event) {
    event.preventDefault();
    if (!validate()) return;

    submitting = true;

    const payload: AddSourcePayload = {
      name: name.trim(),
      url: url.trim(),
      selector: selector.trim(),
      interval: Number(interval),
    };

    appStore.addSource(payload);
    onClose();
  }

  function handleBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('backdrop')) {
      onClose();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={handleBackdropClick}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">

    <header class="dialog-header">
      <h2 id="dialog-title">Add Source</h2>
      <button class="close-btn" onclick={onClose} aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    </header>

    <form class="dialog-body" onsubmit={handleSubmit} novalidate>

      <!-- Name -->
      <div class="field" class:has-error={!!errors.name}>
        <label for="src-name">Name <span class="required">*</span></label>
        <input
          id="src-name"
          type="text"
          placeholder="e.g. Hacker News Front Page"
          bind:value={name}
          autocomplete="off"
          spellcheck="false"
        />
        {#if errors.name}
          <p class="error-msg">{errors.name}</p>
        {/if}
      </div>

      <!-- URL -->
      <div class="field" class:has-error={!!errors.url}>
        <label for="src-url">URL <span class="required">*</span></label>
        <input
          id="src-url"
          type="url"
          placeholder="https://example.com"
          bind:value={url}
          autocomplete="off"
          spellcheck="false"
        />
        {#if errors.url}
          <p class="error-msg">{errors.url}</p>
        {/if}
      </div>

      <!-- CSS Selector -->
      <div class="field" class:has-error={!!errors.selector}>
        <label for="src-selector">
          CSS Selector
          <span class="label-hint">optional — leave blank for full body text</span>
        </label>
        <input
          id="src-selector"
          type="text"
          placeholder=".article-title, h1, table > tr"
          bind:value={selector}
          autocomplete="off"
          spellcheck="false"
          class="mono"
        />
        {#if errors.selector}
          <p class="error-msg">{errors.selector}</p>
        {/if}
      </div>

      <!-- Interval -->
      <div class="field" class:has-error={!!errors.interval}>
        <label for="src-interval">
          Auto-scrape interval (seconds)
          <span class="label-hint">0 = manual only</span>
        </label>
        <input
          id="src-interval"
          type="number"
          min="0"
          step="1"
          placeholder="0"
          bind:value={interval}
        />
        {#if errors.interval}
          <p class="error-msg">{errors.interval}</p>
        {/if}
      </div>

      <!-- Actions -->
      <div class="dialog-actions">
        <button type="button" class="btn-cancel" onclick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" class="btn-submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add Source'}
        </button>
      </div>

    </form>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 16px;
  }

  .dialog {
    background: var(--surface-2);
    border: 1px solid var(--border-hover);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 460px;
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(255, 255, 255, 0.03) inset;
    animation: pop-in 0.18s cubic-bezier(0.34, 1.4, 0.64, 1) both;
  }

  @keyframes pop-in {
    from { opacity: 0; transform: scale(0.93) translateY(6px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);   }
  }

  /* Header */
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--border);
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    transition: background 0.12s, color 0.12s;
    cursor: pointer;
    flex-shrink: 0;
  }
  .close-btn:hover {
    background: var(--surface-4);
    color: var(--text-primary);
  }

  /* Body */
  .dialog-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Fields */
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .required {
    color: var(--error);
    font-size: 13px;
    line-height: 1;
  }

  .label-hint {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-muted);
  }

  .field input {
    width: 100%;
  }

  .field.has-error input {
    border-color: var(--error);
    box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.12);
  }

  .error-msg {
    font-size: 11px;
    color: var(--error);
    margin-top: 1px;
  }

  .mono {
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace !important;
    font-size: 13px !important;
  }

  /* Actions */
  .dialog-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 4px;
  }

  .btn-cancel,
  .btn-submit {
    padding: 7px 18px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    border: 1px solid transparent;
  }

  .btn-cancel {
    background: var(--surface-3);
    border-color: var(--border);
    color: var(--text-secondary);
  }
  .btn-cancel:hover:not(:disabled) {
    background: var(--surface-4);
    border-color: var(--border-hover);
    color: var(--text-primary);
  }

  .btn-submit {
    background: var(--accent-dim);
    color: #fff;
    border-color: transparent;
  }
  .btn-submit:hover:not(:disabled) {
    background: var(--accent);
  }

  .btn-cancel:disabled,
  .btn-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
