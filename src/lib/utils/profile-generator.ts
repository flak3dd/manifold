/**
 * Random Profile Generator
 *
 * Generates (x) amount of randomly generated profiles for automation.
 * Useful for batch creating diverse profiles with randomized fingerprints,
 * proxies, and behavior patterns.
 */

import type { CreateProfilePayload, ProfileTarget, BehaviorProfile } from "$lib/types";
import { generateFingerprintFallback } from "$lib/fingerprint";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration & Constants
// ─────────────────────────────────────────────────────────────────────────────

export interface RandomProfileGeneratorOptions {
  /** Number of profiles to generate */
  count: number;

  /** Optional target URL to optimize profiles for */
  targetUrl?: string;

  /** Optional list of proxy IDs to randomly assign */
  proxyIds?: string[];

  /** Optional seed for deterministic randomization */
  seed?: number;

  /** Whether to include common base names (auto-generated otherwise) */
  useAutoNames?: boolean;
}

export interface GeneratedProfile extends CreateProfilePayload {
  target?: ProfileTarget;
}

// ─────────────────────────────────────────────────────────────────────────────
// Random value generators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seeded random number generator (linear congruential generator)
 * Provides deterministic randomness when a seed is provided
 */
class SeededRandom {
  private seed: number;

  constructor(seed?: number) {
    this.seed = seed ?? Math.random() * 0xffffffff;
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) % (2 ** 31);
    return Math.abs(this.seed) / (2 ** 31);
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextBool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  choice<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)];
  }

  shuffle<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a random profile name
 */
function generateProfileName(index: number, random: SeededRandom, seed: number): string {
  const adjectives = [
    "swift", "bright", "calm", "noble", "wise", "keen", "bold", "gentle",
    "quick", "sharp", "steady", "silent", "clever", "strong", "agile", "lively"
  ];

  const nouns = [
    "falcon", "tiger", "eagle", "wolf", "phoenix", "dragon", "sphinx", "raven",
    "shadow", "storm", "ember", "frost", "dawn", "dusk", "moon", "sun"
  ];

  const adjective = random.choice(adjectives);
  const noun = random.choice(nouns);
  const seedHex = (seed >>> 0).toString(16).substring(0, 4).toUpperCase();

  return `${adjective}-${noun}-${seedHex}`;
}

/**
 * Generate a random behavior profile
 */
function generateBehaviorProfile(random: SeededRandom): BehaviorProfile {
  const profiles: BehaviorProfile[] = ["bot", "fast", "normal", "cautious"];
  return random.choice(profiles);
}

/**
 * Generate a single random profile
 */
function generateRandomProfileInternal(
  index: number,
  options: RandomProfileGeneratorOptions,
  random: SeededRandom,
): GeneratedProfile {
  // Generate unique seed for this profile
  const seed = options.seed
    ? (options.seed + index * 1000000) >>> 0
    : (Math.random() * 0xffffffff) >>> 0;

  // Generate fingerprint using the seed
  const fingerprint = generateFingerprintFallback(seed);

  // Randomly assign proxy if available
  const proxyId = options.proxyIds && options.proxyIds.length > 0
    ? random.choice(options.proxyIds)
    : undefined;

  // Generate profile name
  const name = options.useAutoNames
    ? generateProfileName(index, random, seed)
    : `Profile-${seed.toString(16).toUpperCase()}`;

  const profile: GeneratedProfile = {
    name,
    seed,
    proxy_id: proxyId,
    behavior_profile: generateBehaviorProfile(random),
  };

  return profile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate multiple random profiles for automation
 *
 * @param options Configuration for profile generation
 * @returns Array of generated profiles ready to be saved
 *
 * @example
 * // Generate 10 profiles with random fingerprints
 * const profiles = generateRandomProfiles({ count: 10 });
 *
 * @example
 * // Generate 50 profiles with specific proxies
 * const profiles = generateRandomProfiles({
 *   count: 50,
 *   proxyIds: ["proxy-1", "proxy-2", "proxy-3"],
 *   seed: 12345, // deterministic
 * });
 */
export function generateRandomProfiles(
  options: RandomProfileGeneratorOptions,
): GeneratedProfile[] {
  const random = new SeededRandom(options.seed);
  const profiles: GeneratedProfile[] = [];

  for (let i = 0; i < options.count; i++) {
    profiles.push(generateRandomProfileInternal(i, options, random));
  }

  return profiles;
}

/**
 * Generate a single random profile
 * Convenience function that uses generateRandomProfiles with count=1
 */
export function generateSingleRandomProfile(
  options: Omit<RandomProfileGeneratorOptions, 'count'>,
): GeneratedProfile {
  const profiles = generateRandomProfiles({ ...options, count: 1 });
  return profiles[0];
}

/**
 * Batch generate profiles with progress callback
 * Useful for UI feedback during generation of large batches
 */
export async function generateRandomProfilesAsync(
  options: RandomProfileGeneratorOptions,
  onProgress?: (current: number, total: number) => void,
): Promise<GeneratedProfile[]> {
  const random = new SeededRandom(options.seed);
  const profiles: GeneratedProfile[] = [];

  for (let i = 0; i < options.count; i++) {
    profiles.push(generateRandomProfileInternal(i, options, random));

    // Yield to event loop for UI updates
    if (i % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
      onProgress?.(i + 1, options.count);
    }
  }

  onProgress?.(options.count, options.count);
  return profiles;
}

/**
 * Generate profiles with specific naming pattern
 *
 * @example
 * const profiles = generateRandomProfilesWithPattern(
 *   10,
 *   (index, seed) => `shopify-account-${index + 1}`,
 *   { proxyIds: ["proxy-1"] }
 * );
 */
export function generateRandomProfilesWithPattern(
  count: number,
  namePattern: (index: number, seed: number) => string,
  options?: Omit<RandomProfileGeneratorOptions, 'count' | 'useAutoNames'>,
): GeneratedProfile[] {
  const random = new SeededRandom(options?.seed);
  const profiles: GeneratedProfile[] = [];

  for (let i = 0; i < count; i++) {
    const seed = options?.seed
      ? (options.seed + i * 1000000) >>> 0
      : (Math.random() * 0xffffffff) >>> 0;

    const fingerprint = generateFingerprintFallback(seed);

    const proxyId = options?.proxyIds && options.proxyIds.length > 0
      ? random.choice(options.proxyIds)
      : undefined;

    profiles.push({
      name: namePattern(i, seed),
      seed,
      proxy_id: proxyId,
      behavior_profile: generateBehaviorProfile(random),
    });
  }

  return profiles;
}

/**
 * Export profiles as JSON for backup/sharing
 */
export function exportProfilesToJson(profiles: GeneratedProfile[]): string {
  return JSON.stringify(profiles, null, 2);
}

/**
 * Import profiles from JSON
 */
export function importProfilesFromJson(json: string): GeneratedProfile[] {
  try {
    const data = JSON.parse(json);
    if (!Array.isArray(data)) {
      throw new Error("Expected array of profiles");
    }
    return data;
  } catch (error) {
    throw new Error(`Failed to import profiles: ${error}`);
  }
}
