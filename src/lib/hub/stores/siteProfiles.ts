/**
 * Manifold Hub — Site scan results store.
 */

import { hubStorage } from '../storage';
import type { SiteProfile } from '../types';

const STORAGE_KEY = 'hub_site_profiles';

let siteProfiles = $state<SiteProfile[]>(hubStorage.get<SiteProfile[]>(STORAGE_KEY) ?? []);

function persist() {
  hubStorage.set(STORAGE_KEY, siteProfiles);
}

export const hubSiteProfilesStore = {
  get siteProfiles() {
    return siteProfiles;
  },

  add(profile: SiteProfile): void {
    siteProfiles = [...siteProfiles, profile];
    persist();
  },

  update(id: string, patch: Partial<SiteProfile>): void {
    const idx = siteProfiles.findIndex((p) => p.id === id);
    if (idx === -1) return;
    siteProfiles = siteProfiles.with(idx, { ...siteProfiles[idx], ...patch });
    persist();
  },

  delete(id: string): void {
    siteProfiles = siteProfiles.filter((p) => p.id !== id);
    persist();
  },

  getById(id: string): SiteProfile | undefined {
    return siteProfiles.find((p) => p.id === id);
  },
};
