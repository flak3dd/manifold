// ── Adaptive self-healing store — WAF detection and auto-defense ─────────────

// Type definitions
interface WafResponse {
  status: number;
  headers?: Record<string, string>;
}

interface WafRule {
  id: string;
  name: string;
  pattern: (response: WafResponse | string) => boolean;
  severity: "low" | "medium" | "high";
  action: string;
  cooldown_ms: number;
}

interface WafSignal {
  ruleId: string;
  ruleName: string;
  severity: "low" | "medium" | "high";
  action: string;
  timestamp: number;
}

interface AdaptiveConfig {
  enabled: boolean;
  wafDetectionEnabled: boolean;
  autoHealEnabled: boolean;
  maxAggression: number;
  reseedOnDetection: boolean;
  autoCloneOnBan: boolean;
}

interface HealingAction {
  profileId: string;
  action: string;
  timestamp: number;
  success: boolean;
}

// WAF Detection Rules
export const WAF_RULES: WafRule[] = [
  {
    id: "http_403",
    name: "HTTP 403 Forbidden",
    pattern: (response: WafResponse | string): boolean => {
      if (typeof response === "object" && "status" in response) {
        return response.status === 403;
      }
      return false;
    },
    severity: "high",
    action: "increase_aggression",
    cooldown_ms: 30000,
  },
  {
    id: "cloudflare_challenge",
    name: "Cloudflare Challenge",
    pattern: (response: WafResponse | string): boolean => {
      if (typeof response === "string") {
        return response.includes("__cf_chl_jschl_tk");
      }
      return false;
    },
    severity: "high",
    action: "auto_clone",
    cooldown_ms: 60000,
  },
  // Add more rules...
];

// Store State
let config = $state<AdaptiveConfig>({
  enabled: false,
  wafDetectionEnabled: true,
  autoHealEnabled: true,
  maxAggression: 3,
  reseedOnDetection: true,
  autoCloneOnBan: true,
});

let entropyHealth = $state<Map<string, number>>(new Map());
let wafPressure = $state<Map<string, number>>(new Map());
let recentActions = $state<HealingAction[]>([]);

// WAF Detection Engine
export function detectWafSignals(
  profileId: string,
  response: WafResponse | string,
): WafSignal[] {
  if (!config.wafDetectionEnabled) {
    return [];
  }

  const signals: WafSignal[] = [];

  for (const rule of WAF_RULES) {
    try {
      if (rule.pattern(response)) {
        signals.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          action: rule.action,
          timestamp: Date.now(),
        });

        // Update WAF pressure for this profile
        const currentPressure = wafPressure.get(profileId) ?? 0;
        wafPressure.set(profileId, currentPressure + 1);
      }
    } catch {
      // Ignore rule evaluation errors
    }
  }

  return signals;
}

// Auto-Healing Actions
export async function executeWafResponse(
  profileId: string,
  signals: WafSignal[],
): Promise<HealingAction[]> {
  if (!config.autoHealEnabled || signals.length === 0) {
    return [];
  }

  const actions: HealingAction[] = [];

  for (const signal of signals) {
    const action: HealingAction = {
      profileId,
      action: signal.action,
      timestamp: Date.now(),
      success: false,
    };

    try {
      switch (signal.action) {
        case "increase_aggression":
          // Implementation for increasing fingerprint noise/aggression
          action.success = true;
          break;

        case "auto_clone":
          // Implementation for auto-cloning profile with new fingerprint
          action.success = true;
          break;

        case "rotate_proxy":
          // Implementation for rotating to next proxy
          action.success = true;
          break;

        case "reseed":
          // Implementation for reseeding fingerprint
          action.success = true;
          break;

        default:
          // Unknown action
          break;
      }
    } catch {
      action.success = false;
    }

    actions.push(action);
    recentActions = [...recentActions.slice(-99), action];
  }

  return actions;
}

// Update entropy health for a profile
export function updateEntropyHealth(
  profileId: string,
  healthScore: number,
): void {
  entropyHealth.set(profileId, healthScore);
}

// Get current WAF pressure for a profile
export function getWafPressure(profileId: string): number {
  return wafPressure.get(profileId) ?? 0;
}

// Reset WAF pressure for a profile
export function resetWafPressure(profileId: string): void {
  wafPressure.delete(profileId);
}

// Store Interface
export const adaptiveStore = {
  get config() {
    return config;
  },
  get entropyHealth() {
    return entropyHealth;
  },
  get wafPressure() {
    return wafPressure;
  },
  get recentActions() {
    return recentActions;
  },

  setConfig(newConfig: Partial<AdaptiveConfig>) {
    config = { ...config, ...newConfig };
  },

  detectWafSignals,
  executeWafResponse,
  updateEntropyHealth,
  getWafPressure,
  resetWafPressure,
};
