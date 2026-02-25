/**
 * Manifold Hub — Site scanner: uses Tauri scrape_form_selectors when available,
 * otherwise fetches via server route and parses HTML for form fields and tokens.
 */

import type { SiteProfile } from './types';
import { scrapeFormSelectors } from '$lib/utils/form-scraper';

const LOG_PREFIX = '[Hub Scanner]';

async function invokeTauri<T>(cmd: string, args: Record<string, unknown>): Promise<T | null> {
  if (typeof window === 'undefined') return null;
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (c: string, a: unknown) => Promise<T> } }).__TAURI_INTERNALS__;
  if (!tauri?.invoke) return null;
  try {
    return await tauri.invoke(cmd, args);
  } catch {
    return null;
  }
}

export interface ScanProgress {
  (message: string): void;
}

export async function scanSite(
  url: string,
  onProgress: ScanProgress
): Promise<SiteProfile> {
  onProgress(`Starting scan for ${url}`);

  const siteProfile: SiteProfile = {
    id: crypto.randomUUID(),
    url,
    scannedAt: new Date().toISOString(),
    hasCaptcha: false,
    hasHCaptcha: false,
    hasTurnstile: false,
    hasArkose: false,
    hasCloudflare: false,
  };

  // Prefer the scraper sidecar (ws://localhost:8765) via shared scrapeFormSelectors util.
  try {
    const result = await scrapeFormSelectors({ url, timeout: 15000 });
    if (result && result.confidence > 0) {
      onProgress('Scraper returned results');
      siteProfile.usernameSelector = result.username_selector;
      siteProfile.passwordSelector = result.password_selector;
      siteProfile.submitButtonSelector = result.submit_selector;
      siteProfile.hasCaptcha = result.hasCaptcha ?? false;
      if (result.captchaProviders?.length) {
        siteProfile.hasHCaptcha = result.captchaProviders.some((p) => /hcaptcha/i.test(p));
        siteProfile.hasTurnstile = result.captchaProviders.some((p) => /turnstile/i.test(p));
        siteProfile.hasArkose = result.captchaProviders.some((p) => /arkose/i.test(p));
      }
      siteProfile.rawScanData = JSON.stringify(result);
      onProgress(`Detected fields (confidence: ${(result.confidence ?? 0).toFixed(2)})`);
      onProgress('Scan complete (scraper)');
      return siteProfile;
    }
  } catch (e) {
    onProgress(`Scraper error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Fallback: fetch page via server route and parse
  onProgress('Tauri unavailable; fetching page via proxy...');
  try {
    const res = await fetch(`/hub/api/scan?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(res.statusText);
    const html = await res.text();
    onProgress(`Fetched ${html.length} bytes`);

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const inputs = doc.querySelectorAll('input, select, textarea, button');

    inputs.forEach((el) => {
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      const name = (el.getAttribute('name') ?? '').toLowerCase();
      const id = (el.getAttribute('id') ?? '').toLowerCase();
      const placeholder = (el.getAttribute('placeholder') ?? '').toLowerCase();

      if (type === 'email' || name.includes('email') || id.includes('email') || placeholder.includes('email')) {
        siteProfile.usernameSelector = id ? `#${id}` : `[name="${el.getAttribute('name')}"]`;
      }
      if (type === 'password' || name.includes('pass') || id.includes('pass')) {
        siteProfile.passwordSelector = id ? `#${id}` : `[name="${el.getAttribute('name')}"]`;
      }
      if (type === 'submit' || el.tagName === 'BUTTON') {
        const text = (el.textContent ?? '').toLowerCase();
        if (/login|submit|pay|continue|sign in/.test(text)) {
          siteProfile.submitButtonSelector = id ? `#${id}` : `${el.tagName.toLowerCase()}[type="${el.getAttribute('type') ?? 'submit'}"]`;
        }
      }
    });

    // Hidden tokens
    doc.querySelectorAll('input[type="hidden"]').forEach((el) => {
      const n = (el.getAttribute('name') ?? '').toLowerCase();
      if (n.includes('csrf') || n.includes('__requestverificationtoken')) siteProfile.csrfTokenSelector = `input[name="${el.getAttribute('name')}"]`;
      if (n.includes('token')) siteProfile.verificationTokenSelector = `input[name="${el.getAttribute('name')}"]`;
      if (n.includes('xsrf') || n.includes('_token')) siteProfile.xsrfTokenSelector = `input[name="${el.getAttribute('name')}"]`;
    });

    // Bot protection indicators
    if (doc.querySelector('[data-sitekey], .g-recaptcha, [class*="recaptcha"]')) siteProfile.hasCaptcha = true;
    if (doc.querySelector('.h-captcha, [class*="hcaptcha"]')) siteProfile.hasHCaptcha = true;
    if (doc.querySelector('.cf-turnstile, [class*="turnstile"]')) siteProfile.hasTurnstile = true;
    if (doc.querySelector('#arkose-frame, [data-enforcement-token]')) siteProfile.hasArkose = true;
    if (doc.querySelector('#challenge-form, .cf-browser-verification') || doc.body?.textContent?.includes('Checking your browser')) siteProfile.hasCloudflare = true;

    onProgress('Scan complete (fetch fallback)');
  } catch (e) {
    onProgress(`Scan error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return siteProfile;
}
