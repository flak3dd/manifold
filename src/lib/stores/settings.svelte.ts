// Settings store with auto-defense toggle
export const settingsStore = {
  autoDefenseEnabled: false,
  enableAutoDefense() { this.autoDefenseEnabled = true; },
  disableAutoDefense() { this.autoDefenseEnabled = false; },
};
