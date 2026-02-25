/**
 * Manifold Hub — Credentials store (username/password/card); secrets in hub storage.
 */

import { hubStorage } from '../storage';
import type { Credential } from '../types';

const STORAGE_KEY = 'hub_credentials';

function hydrateSecrets(list: Credential[]): Credential[] {
  return list.map((c) => {
    const password = hubStorage.getSecret(c.id, 'password');
    const cardNumber = hubStorage.getSecret(c.id, 'cardNumber');
    const cardCVV = hubStorage.getSecret(c.id, 'cardCVV');
    return {
      ...c,
      password: password ?? c.password,
      cardNumber: cardNumber ?? c.cardNumber,
      cardCVV: cardCVV ?? c.cardCVV,
    };
  });
}

const raw = hubStorage.get<Credential[]>(STORAGE_KEY) ?? [];
let credentials = $state<Credential[]>(hydrateSecrets(raw));

function persist() {
  const toSave = credentials.map((c) => ({
    ...c,
    password: '',
    cardNumber: c.cardNumber ? '***' : undefined,
    cardCVV: c.cardCVV ? '***' : undefined,
  }));
  hubStorage.set(STORAGE_KEY, toSave);
}

export const hubCredentialsStore = {
  get credentials() {
    return credentials;
  },

  add(cred: Omit<Credential, 'id' | 'createdAt'>): Credential {
    const id = crypto.randomUUID();
    const created: Credential = {
      ...cred,
      id,
      createdAt: new Date().toISOString(),
    };
    hubStorage.setSecret(id, 'password', created.password);
    if (created.cardNumber) hubStorage.setSecret(id, 'cardNumber', created.cardNumber);
    if (created.cardCVV) hubStorage.setSecret(id, 'cardCVV', created.cardCVV);
    credentials = [...credentials, { ...created, password: '***', cardNumber: created.cardNumber ? '***' : undefined, cardCVV: created.cardCVV ? '***' : undefined }];
    persist();
    return created;
  },

  update(id: string, patch: Partial<Omit<Credential, 'id'>>): void {
    const idx = credentials.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const next = { ...credentials[idx], ...patch };
    if (patch.password !== undefined) hubStorage.setSecret(id, 'password', patch.password);
    if (patch.cardNumber !== undefined) {
      if (patch.cardNumber) hubStorage.setSecret(id, 'cardNumber', patch.cardNumber);
      else hubStorage.removeSecret(id, 'cardNumber');
    }
    if (patch.cardCVV !== undefined) {
      if (patch.cardCVV) hubStorage.setSecret(id, 'cardCVV', patch.cardCVV);
      else hubStorage.removeSecret(id, 'cardCVV');
    }
    credentials = credentials.with(idx, next);
    persist();
  },

  getPassword(id: string): string | null {
    return hubStorage.getSecret(id, 'password');
  },

  getCardNumber(id: string): string | null {
    return hubStorage.getSecret(id, 'cardNumber');
  },

  getCardCVV(id: string): string | null {
    return hubStorage.getSecret(id, 'cardCVV');
  },

  touchLastUsed(id: string): void {
    hubCredentialsStore.update(id, { lastUsedAt: new Date().toISOString() });
  },

  delete(id: string): void {
    hubStorage.removeAllSecretsFor(id);
    credentials = credentials.filter((c) => c.id !== id);
    persist();
  },

  getById(id: string): Credential | undefined {
    return credentials.find((c) => c.id === id);
  },
};
