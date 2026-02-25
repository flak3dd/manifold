/**
 * Manifold Hub — Hub profiles store (target URL + proxy + simulation level).
 */

import { hubStorage } from '../storage';
import type { HubProfile, SimulationLevel } from '../types';

const STORAGE_KEY = 'hub_profiles';

function defaultProfiles(): HubProfile[] {
  return [
    {
      id: crypto.randomUUID(),
      name: 'PPSR Portal',
      targetURL: 'https://transact.ppsr.gov.au',
      simulationLevel: 'high',
      status: 'idle',
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      name: 'Generic Site',
      targetURL: 'https://example.com',
      simulationLevel: 'medium',
      status: 'idle',
      createdAt: new Date().toISOString(),
    },
  ];
}

function load(): HubProfile[] {
  const stored = hubStorage.get<HubProfile[]>(STORAGE_KEY);
  if (stored?.length) return stored;
  const def = defaultProfiles();
  hubStorage.set(STORAGE_KEY, def);
  return def;
}

let profiles = $state<HubProfile[]>(load());

function persist() {
  hubStorage.set(STORAGE_KEY, profiles);
}

export const hubProfilesStore = {
  get profiles() {
    return profiles;
  },

  add(profile: Omit<HubProfile, 'id' | 'createdAt' | 'status'>): HubProfile {
    const created: HubProfile = {
      ...profile,
      id: crypto.randomUUID(),
      status: 'idle',
      createdAt: new Date().toISOString(),
    };
    if (profile.proxyPassword) {
      hubStorage.setSecret(created.id, 'proxyPassword', profile.proxyPassword);
      const { proxyPassword: _, ...rest } = created;
      (rest as HubProfile).proxyPassword = undefined;
    }
    profiles = [...profiles, created];
    persist();
    return created;
  },

  update(
    id: string,
    patch: Partial<Pick<HubProfile, 'name' | 'targetURL' | 'proxyServer' | 'proxyUsername' | 'proxyPassword' | 'simulationLevel' | 'siteProfileId' | 'status' | 'lastUsedAt'>>
  ): void {
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const next = { ...profiles[idx], ...patch };
    if (patch.proxyPassword !== undefined) {
      if (patch.proxyPassword) hubStorage.setSecret(id, 'proxyPassword', patch.proxyPassword);
      else hubStorage.removeSecret(id, 'proxyPassword');
      next.proxyPassword = undefined;
    }
    profiles = profiles.with(idx, next);
    persist();
  },

  setStatus(id: string, status: HubProfile['status']): void {
    hubProfilesStore.update(id, { status });
  },

  setSiteProfile(profileId: string, siteProfileId: string): void {
    hubProfilesStore.update(profileId, { siteProfileId });
  },

  touchLastUsed(id: string): void {
    hubProfilesStore.update(id, { lastUsedAt: new Date().toISOString() });
  },

  getProxyPassword(id: string): string | null {
    return hubStorage.getSecret(id, 'proxyPassword');
  },

  delete(id: string): void {
    hubStorage.removeAllSecretsFor(id);
    profiles = profiles.filter((p) => p.id !== id);
    persist();
  },

  getById(id: string): HubProfile | undefined {
    return profiles.find((p) => p.id === id);
  },
};
