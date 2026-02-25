/**
 * Manifold Hub — Automation run history store.
 */

import { hubStorage } from '../storage';
import type { AutomationRun } from '../types';

const STORAGE_KEY = 'hub_runs';

let runs = $state<AutomationRun[]>(hubStorage.get<AutomationRun[]>(STORAGE_KEY) ?? []);

function persist() {
  hubStorage.set(STORAGE_KEY, runs);
}

export const hubRunsStore = {
  get runs() {
    return runs;
  },

  add(run: AutomationRun): void {
    runs = [run, ...runs];
    persist();
  },

  update(id: string, patch: Partial<AutomationRun>): void {
    const idx = runs.findIndex((r) => r.id === id);
    if (idx === -1) return;
    runs = runs.with(idx, { ...runs[idx], ...patch });
    persist();
  },

  getById(id: string): AutomationRun | undefined {
    return runs.find((r) => r.id === id);
  },
};
