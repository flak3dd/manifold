/**
 * Manifold Hub — localStorage persistence with optional encryption placeholder.
 * Sensitive fields (passwords, card) are stored in a separate keyed store with obfuscation.
 */

const PREFIX = 'manifold_hub_';
const SECRET_PREFIX = 'manifold_hub_secret_';

function key(k: string) {
  return PREFIX + k;
}

function secretKey(id: string, field: string) {
  return SECRET_PREFIX + id + '_' + field;
}

/** Simple obfuscation (base64) — not crypto; for web-only. Use backend/Keychain in production. */
function obfuscate(value: string): string {
  return btoa(encodeURIComponent(value));
}

function unobfuscate(value: string): string {
  try {
    return decodeURIComponent(atob(value));
  } catch {
    return value;
  }
}

export const hubStorage = {
  get<T>(storageKey: string): T | null {
    try {
      const raw = localStorage.getItem(key(storageKey));
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  set(storageKey: string, value: unknown): void {
    try {
      localStorage.setItem(key(storageKey), JSON.stringify(value));
    } catch (e) {
      console.error('[hub storage] set failed', e);
    }
  },

  remove(storageKey: string): void {
    localStorage.removeItem(key(storageKey));
  },

  getSecret(ownerId: string, field: string): string | null {
    try {
      const raw = localStorage.getItem(secretKey(ownerId, field));
      if (raw == null) return null;
      return unobfuscate(raw);
    } catch {
      return null;
    }
  },

  setSecret(ownerId: string, field: string, value: string): void {
    try {
      localStorage.setItem(secretKey(ownerId, field), obfuscate(value));
    } catch (e) {
      console.error('[hub storage] setSecret failed', e);
    }
  },

  removeSecret(ownerId: string, field: string): void {
    localStorage.removeItem(secretKey(ownerId, field));
  },

  removeAllSecretsFor(ownerId: string): void {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(SECRET_PREFIX + ownerId)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  },
};
