<script lang="ts">
  import type { SourceStatus } from '$lib/types';

  let { status }: { status: SourceStatus } = $props();

  const label: Record<SourceStatus, string> = {
    idle:     'Idle',
    scraping: 'Scraping',
    success:  'Done',
    error:    'Error',
  };
</script>

<span class="badge" data-status={status}>
  <span class="dot"></span>
  {label[status]}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.03em;
    padding: 2px 8px;
    border-radius: 99px;
    border: 1px solid transparent;
    white-space: nowrap;
    user-select: none;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* idle */
  .badge[data-status="idle"] {
    color: var(--text-muted);
    background: var(--surface-3);
    border-color: var(--border);
  }
  .badge[data-status="idle"] .dot {
    background: var(--text-muted);
  }

  /* scraping */
  .badge[data-status="scraping"] {
    color: var(--info);
    background: rgba(56, 189, 248, 0.08);
    border-color: rgba(56, 189, 248, 0.25);
  }
  .badge[data-status="scraping"] .dot {
    background: var(--info);
    animation: pulse 1.1s ease-in-out infinite;
  }

  /* success */
  .badge[data-status="success"] {
    color: var(--success);
    background: rgba(74, 222, 128, 0.08);
    border-color: rgba(74, 222, 128, 0.25);
  }
  .badge[data-status="success"] .dot {
    background: var(--success);
  }

  /* error */
  .badge[data-status="error"] {
    color: var(--error);
    background: rgba(248, 113, 113, 0.08);
    border-color: rgba(248, 113, 113, 0.25);
  }
  .badge[data-status="error"] .dot {
    background: var(--error);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1;   transform: scale(1); }
    50%       { opacity: 0.4; transform: scale(0.75); }
  }
</style>
