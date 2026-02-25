/**
 * Manifold Hub — Advanced fingerprint generator store.
 * Generates a new fingerprint per credential attempt; supports AmIUnique verification.
 */

import { generateFingerprintFallback } from '$lib/fingerprint';
import type { Fingerprint } from '$lib/types';

let currentFingerprint = $state<Fingerprint | null>(null);

async function generateFingerprint(seed?: number): Promise<Fingerprint> {
  if (typeof window !== 'undefined') {
    try {
      const tauri = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string, a: unknown) => Promise<Fingerprint> } }).__TAURI_INTERNALS__;
      if (tauri?.invoke) {
        const fp = await tauri.invoke('generate_fingerprint', seed != null ? { seed } : {});
        if (fp) return fp;
      }
    } catch {}
  }
  return generateFingerprintFallback(seed);
}

export const hubFingerprintStore = {
  get currentFingerprint() {
    return currentFingerprint;
  },

  /** Generate a new fingerprint (random seed). For use before each credential attempt. */
  async generateNew(seed?: number): Promise<Fingerprint> {
    const fp = await generateFingerprint(seed);
    currentFingerprint = fp;
    return fp;
  },

  /** Alias for generateNew — used by automation for each run. */
  async generateForRun(): Promise<Fingerprint> {
    return hubFingerprintStore.generateNew();
  },

  setCurrent(fp: Fingerprint | null) {
    currentFingerprint = fp;
  },

  /** Open AmIUnique in a new tab for manual verification. */
  openAmIUnique() {
    if (typeof window === 'undefined') return;
    window.open('https://www.amiunique.org/', '_blank', 'noopener,noreferrer');
  },

  /** AmIUnique check URL (for display / manual step). */
  get amiUniqueUrl(): string {
    return 'https://www.amiunique.org/';
  },
};
