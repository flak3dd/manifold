// ── Scrape → Automation handoff store ────────────────────────────────────────
//
// Lightweight shared state that lets the URL-test page push detected form
// selectors into a "pending" slot that the Automation page picks up on mount.
//
// Flow:
//   1. URL test completes → user clicks "Use in Automation"
//   2. urlTestPage calls `scrapeHandoff.set(...)` with detected selectors + URL
//   3. User is navigated to /automation
//   4. Automation page on mount calls `scrapeHandoff.consume()`
//      → returns the pending config (or null) and clears it

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScrapedFormHandoff {
  url: string;
  username_selector: string;
  password_selector: string;
  submit_selector: string;
  success_selector?: string;
  failure_selector?: string;
  captcha_selector?: string;
  consent_selector?: string;
  totp_selector?: string;
  /** Human-readable note about how selectors were detected */
  detection_note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let pending = $state<ScrapedFormHandoff | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

/** Store a scraped form config for the automation page to pick up. */
function set(config: ScrapedFormHandoff): void {
  pending = config;
}

/**
 * Read and clear the pending handoff.
 * Returns `null` if nothing was queued.
 */
function consume(): ScrapedFormHandoff | null {
  const val = pending;
  pending = null;
  return val;
}

/** Check whether a handoff is waiting without consuming it. */
function peek(): ScrapedFormHandoff | null {
  return pending;
}

/** Discard any pending handoff. */
function clear(): void {
  pending = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store export
// ─────────────────────────────────────────────────────────────────────────────

export const scrapeHandoff = {
  get pending() {
    return pending;
  },
  set,
  consume,
  peek,
  clear,
};
