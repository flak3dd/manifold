// ── AmIUnique-Style Fingerprint Scoring ──────────────────────────────────────
//
// This module provides comprehensive fingerprint uniqueness scoring based on
// real-world browser population statistics. Scores are calibrated against
// AmIUnique.org research data to estimate how distinguishable a fingerprint is.
//
// The scoring model considers:
// 1. Attribute entropy (bits of identifying information)
// 2. Population frequency (how common each value is)
// 3. Correlation penalties (unusual combinations)
// 4. Temporal stability (values that rarely change)

import type { Fingerprint } from "$lib/types";

// ── Population Statistics ────────────────────────────────────────────────────
// Based on AmIUnique.org research papers and EFF Panopticlick data

interface PopulationStats {
  /** Entropy in bits - higher = more identifying */
  entropy: number;
  /** Common values and their approximate frequency */
  commonValues: Record<string, number>;
  /** Weight in overall uniqueness calculation */
  weight: number;
}

const POPULATION_STATS: Record<string, PopulationStats> = {
  userAgent: {
    entropy: 10.0, // ~1000 unique values commonly seen
    commonValues: {
      chrome_windows: 0.45,
      chrome_macos: 0.15,
      chrome_linux: 0.03,
      firefox_windows: 0.08,
      firefox_macos: 0.04,
      safari_macos: 0.12,
      edge_windows: 0.08,
    },
    weight: 0.12,
  },
  screenResolution: {
    entropy: 6.5, // ~100 common resolutions
    commonValues: {
      "1920x1080": 0.23,
      "1366x768": 0.12,
      "2560x1440": 0.08,
      "1536x864": 0.06,
      "1440x900": 0.05,
      "1280x720": 0.04,
      "3840x2160": 0.03,
    },
    weight: 0.08,
  },
  timezone: {
    entropy: 4.5, // ~25 common timezones
    commonValues: {
      "America/New_York": 0.15,
      "America/Los_Angeles": 0.1,
      "Europe/London": 0.08,
      "America/Chicago": 0.06,
      "Europe/Paris": 0.05,
      "Asia/Tokyo": 0.04,
    },
    weight: 0.06,
  },
  language: {
    entropy: 3.5,
    commonValues: {
      "en-US": 0.45,
      "en-GB": 0.08,
      "de-DE": 0.05,
      "fr-FR": 0.04,
      "es-ES": 0.03,
      "ja-JP": 0.03,
    },
    weight: 0.05,
  },
  platform: {
    entropy: 2.0,
    commonValues: {
      Win32: 0.7,
      MacIntel: 0.2,
      "Linux x86_64": 0.05,
    },
    weight: 0.04,
  },
  hardwareConcurrency: {
    entropy: 3.0,
    commonValues: {
      "4": 0.25,
      "8": 0.35,
      "6": 0.15,
      "2": 0.1,
      "12": 0.08,
      "16": 0.05,
    },
    weight: 0.05,
  },
  deviceMemory: {
    entropy: 2.5,
    commonValues: {
      "8": 0.4,
      "4": 0.25,
      "16": 0.15,
      "2": 0.1,
      "32": 0.05,
    },
    weight: 0.04,
  },
  colorDepth: {
    entropy: 1.0,
    commonValues: {
      "24": 0.95,
      "30": 0.03,
      "32": 0.02,
    },
    weight: 0.02,
  },
  pixelRatio: {
    entropy: 2.5,
    commonValues: {
      "1": 0.55,
      "2": 0.25,
      "1.25": 0.08,
      "1.5": 0.07,
      "3": 0.03,
    },
    weight: 0.04,
  },
  webglVendor: {
    entropy: 5.0,
    commonValues: {
      "Google Inc. (NVIDIA)": 0.25,
      "Google Inc. (Intel)": 0.3,
      "Google Inc. (AMD)": 0.15,
      "Apple Inc.": 0.12,
      "Intel Inc.": 0.08,
    },
    weight: 0.1,
  },
  webglRenderer: {
    entropy: 8.5, // Very high - many unique GPU strings
    commonValues: {
      // Too many to enumerate, use heuristics
    },
    weight: 0.12,
  },
  canvasFingerprint: {
    entropy: 12.0, // Extremely high identifying power
    commonValues: {},
    weight: 0.15,
  },
  audioFingerprint: {
    entropy: 8.0,
    commonValues: {},
    weight: 0.08,
  },
  fonts: {
    entropy: 7.5,
    commonValues: {},
    weight: 0.05,
  },
};

// ── Scoring Interfaces ───────────────────────────────────────────────────────

export interface AttributeScore {
  /** Attribute identifier */
  id: string;
  /** Human-readable label */
  label: string;
  /** Uniqueness score 0-100 (100 = perfectly common, 0 = unique) */
  anonymityScore: number;
  /** Entropy contribution in bits */
  entropyBits: number;
  /** Current value */
  value: string;
  /** How common this value is (0-1, null if unknown) */
  frequency: number | null;
  /** Whether this attribute is a privacy risk */
  isRisk: boolean;
  /** Recommendation for improving anonymity */
  recommendation?: string;
}

export interface CorrelationPenalty {
  /** Attributes involved */
  attributes: string[];
  /** Penalty description */
  description: string;
  /** Penalty amount (reduces anonymity score) */
  penalty: number;
}

export interface AmIUniqueScore {
  /** Overall anonymity score 0-100 (100 = indistinguishable, 0 = unique) */
  anonymityScore: number;
  /** Estimated uniqueness ratio (1 in N browsers) */
  uniquenessRatio: number;
  /** Total entropy bits */
  totalEntropyBits: number;
  /** Per-attribute scores */
  attributes: AttributeScore[];
  /** Correlation penalties applied */
  correlationPenalties: CorrelationPenalty[];
  /** Overall risk level */
  riskLevel: "low" | "medium" | "high" | "critical";
  /** Summary recommendations */
  recommendations: string[];
  /** Timestamp of analysis */
  analyzedAt: string;
}

// ── Scoring Functions ────────────────────────────────────────────────────────

/**
 * Calculate frequency-based anonymity score for a value
 * Higher frequency = higher anonymity score
 */
function frequencyToAnonymityScore(frequency: number | null): number {
  if (frequency === null) return 50; // Unknown, assume moderate
  if (frequency >= 0.3) return 95;
  if (frequency >= 0.1) return 85;
  if (frequency >= 0.05) return 70;
  if (frequency >= 0.01) return 50;
  if (frequency >= 0.001) return 30;
  return 10; // Very rare
}

/**
 * Calculate entropy contribution from frequency
 */
function frequencyToEntropy(frequency: number | null): number {
  if (frequency === null || frequency <= 0) return 10; // Assume high entropy
  return -Math.log2(frequency);
}

/**
 * Detect unusual attribute correlations that increase uniqueness
 */
function detectCorrelations(fp: Fingerprint): CorrelationPenalty[] {
  const penalties: CorrelationPenalty[] = [];

  // Platform vs UA mismatch
  const uaPlatform = (fp.ua_platform ?? "").toLowerCase();
  const platform = (fp.platform ?? "").toLowerCase();
  const platformMismatch =
    (uaPlatform.includes("win") && !platform.includes("win")) ||
    (uaPlatform.includes("mac") && !platform.includes("mac")) ||
    (uaPlatform.includes("linux") && !platform.includes("linux"));

  if (platformMismatch) {
    penalties.push({
      attributes: ["ua_platform", "platform"],
      description: "Platform strings are inconsistent",
      penalty: 15,
    });
  }

  // High DPI with low resolution (unusual)
  if (fp.pixel_ratio >= 2 && fp.screen_width < 1920) {
    penalties.push({
      attributes: ["pixel_ratio", "screen_resolution"],
      description: "High DPI with low resolution is uncommon",
      penalty: 8,
    });
  }

  // Linux with high device memory (uncommon combination)
  if (platform.includes("linux") && fp.device_memory >= 16) {
    penalties.push({
      attributes: ["platform", "device_memory"],
      description: "Linux with 16GB+ RAM is less common",
      penalty: 5,
    });
  }

  // Timezone vs language mismatch
  const tz = fp.timezone ?? "";
  const locale = fp.locale ?? "";
  if (
    (tz.includes("America") && locale.startsWith("de")) ||
    (tz.includes("Europe/Berlin") && locale.startsWith("en-US")) ||
    (tz.includes("Asia/Tokyo") && !locale.includes("ja"))
  ) {
    penalties.push({
      attributes: ["timezone", "locale"],
      description: "Timezone and language combination is unusual",
      penalty: 10,
    });
  }

  // Very high core count with low memory
  if (fp.hardware_concurrency >= 16 && fp.device_memory <= 4) {
    penalties.push({
      attributes: ["hardware_concurrency", "device_memory"],
      description: "Many cores with little RAM is unusual",
      penalty: 8,
    });
  }

  return penalties;
}

/**
 * Get frequency for a screen resolution
 */
function getScreenFrequency(width: number, height: number): number | null {
  const key = `${width}x${height}`;
  return POPULATION_STATS.screenResolution.commonValues[key] ?? null;
}

/**
 * Get frequency for a platform
 */
function getPlatformFrequency(platform: string): number | null {
  return POPULATION_STATS.platform.commonValues[platform] ?? null;
}

/**
 * Estimate user agent frequency based on components
 */
function getUserAgentFrequency(ua: string, platform: string): number {
  const isChrome = ua.includes("Chrome") && !ua.includes("Edg");
  const isFirefox = ua.includes("Firefox");
  const isSafari = ua.includes("Safari") && !ua.includes("Chrome");
  const isEdge = ua.includes("Edg");

  const isWindows = platform.includes("Win");
  const isMac = platform.includes("Mac");
  const isLinux = platform.includes("Linux");

  if (isChrome && isWindows) return 0.45;
  if (isChrome && isMac) return 0.15;
  if (isChrome && isLinux) return 0.03;
  if (isFirefox && isWindows) return 0.08;
  if (isFirefox && isMac) return 0.04;
  if (isSafari && isMac) return 0.12;
  if (isEdge && isWindows) return 0.08;

  return 0.01; // Uncommon combination
}

/**
 * Analyze a fingerprint and return AmIUnique-style scoring
 */
export function analyzeFingerprint(fp: Fingerprint): AmIUniqueScore {
  const attributes: AttributeScore[] = [];
  let totalWeightedScore = 0;
  let totalWeight = 0;
  let totalEntropyBits = 0;

  // ── User Agent ───────────────────────────────────────────────────────────
  const uaFreq = getUserAgentFrequency(fp.user_agent, fp.platform);
  const uaEntropy = frequencyToEntropy(uaFreq);
  const uaScore = frequencyToAnonymityScore(uaFreq);
  attributes.push({
    id: "userAgent",
    label: "User Agent",
    anonymityScore: uaScore,
    entropyBits: uaEntropy,
    value: fp.user_agent.slice(0, 60) + "...",
    frequency: uaFreq,
    isRisk: uaScore < 50,
    recommendation:
      uaScore < 50
        ? "Consider using a more common browser/OS combination"
        : undefined,
  });
  totalWeightedScore += uaScore * POPULATION_STATS.userAgent.weight;
  totalWeight += POPULATION_STATS.userAgent.weight;
  totalEntropyBits += uaEntropy * POPULATION_STATS.userAgent.weight;

  // ── Screen Resolution ────────────────────────────────────────────────────
  const screenFreq = getScreenFrequency(fp.screen_width, fp.screen_height);
  const screenEntropy = frequencyToEntropy(screenFreq);
  const screenScore = frequencyToAnonymityScore(screenFreq);
  attributes.push({
    id: "screenResolution",
    label: "Screen Resolution",
    anonymityScore: screenScore,
    entropyBits: screenEntropy,
    value: `${fp.screen_width}x${fp.screen_height}`,
    frequency: screenFreq,
    isRisk: screenScore < 50,
    recommendation:
      screenScore < 50 ? "Use a common resolution like 1920x1080" : undefined,
  });
  totalWeightedScore += screenScore * POPULATION_STATS.screenResolution.weight;
  totalWeight += POPULATION_STATS.screenResolution.weight;
  totalEntropyBits += screenEntropy * POPULATION_STATS.screenResolution.weight;

  // ── Timezone ─────────────────────────────────────────────────────────────
  const tzFreq = POPULATION_STATS.timezone.commonValues[fp.timezone] ?? null;
  const tzEntropy = frequencyToEntropy(tzFreq);
  const tzScore = frequencyToAnonymityScore(tzFreq);
  attributes.push({
    id: "timezone",
    label: "Timezone",
    anonymityScore: tzScore,
    entropyBits: tzEntropy,
    value: fp.timezone,
    frequency: tzFreq,
    isRisk: tzScore < 40,
  });
  totalWeightedScore += tzScore * POPULATION_STATS.timezone.weight;
  totalWeight += POPULATION_STATS.timezone.weight;
  totalEntropyBits += tzEntropy * POPULATION_STATS.timezone.weight;

  // ── Language ─────────────────────────────────────────────────────────────
  const langFreq = POPULATION_STATS.language.commonValues[fp.locale] ?? null;
  const langEntropy = frequencyToEntropy(langFreq);
  const langScore = frequencyToAnonymityScore(langFreq);
  attributes.push({
    id: "language",
    label: "Language",
    anonymityScore: langScore,
    entropyBits: langEntropy,
    value: fp.locale,
    frequency: langFreq,
    isRisk: langScore < 40,
  });
  totalWeightedScore += langScore * POPULATION_STATS.language.weight;
  totalWeight += POPULATION_STATS.language.weight;
  totalEntropyBits += langEntropy * POPULATION_STATS.language.weight;

  // ── Platform ─────────────────────────────────────────────────────────────
  const platFreq = getPlatformFrequency(fp.platform);
  const platEntropy = frequencyToEntropy(platFreq);
  const platScore = frequencyToAnonymityScore(platFreq);
  attributes.push({
    id: "platform",
    label: "Platform",
    anonymityScore: platScore,
    entropyBits: platEntropy,
    value: fp.platform,
    frequency: platFreq,
    isRisk: platScore < 50,
  });
  totalWeightedScore += platScore * POPULATION_STATS.platform.weight;
  totalWeight += POPULATION_STATS.platform.weight;
  totalEntropyBits += platEntropy * POPULATION_STATS.platform.weight;

  // ── Hardware Concurrency ─────────────────────────────────────────────────
  const coresFreq =
    POPULATION_STATS.hardwareConcurrency.commonValues[
      String(fp.hardware_concurrency)
    ] ?? null;
  const coresEntropy = frequencyToEntropy(coresFreq);
  const coresScore = frequencyToAnonymityScore(coresFreq);
  attributes.push({
    id: "hardwareConcurrency",
    label: "CPU Cores",
    anonymityScore: coresScore,
    entropyBits: coresEntropy,
    value: String(fp.hardware_concurrency),
    frequency: coresFreq,
    isRisk: coresScore < 40,
  });
  totalWeightedScore +=
    coresScore * POPULATION_STATS.hardwareConcurrency.weight;
  totalWeight += POPULATION_STATS.hardwareConcurrency.weight;
  totalEntropyBits +=
    coresEntropy * POPULATION_STATS.hardwareConcurrency.weight;

  // ── Device Memory ────────────────────────────────────────────────────────
  const memFreq =
    POPULATION_STATS.deviceMemory.commonValues[String(fp.device_memory)] ??
    null;
  const memEntropy = frequencyToEntropy(memFreq);
  const memScore = frequencyToAnonymityScore(memFreq);
  attributes.push({
    id: "deviceMemory",
    label: "Device Memory",
    anonymityScore: memScore,
    entropyBits: memEntropy,
    value: `${fp.device_memory} GB`,
    frequency: memFreq,
    isRisk: memScore < 40,
  });
  totalWeightedScore += memScore * POPULATION_STATS.deviceMemory.weight;
  totalWeight += POPULATION_STATS.deviceMemory.weight;
  totalEntropyBits += memEntropy * POPULATION_STATS.deviceMemory.weight;

  // ── Color Depth ──────────────────────────────────────────────────────────
  const colorFreq =
    POPULATION_STATS.colorDepth.commonValues[String(fp.color_depth)] ?? null;
  const colorEntropy = frequencyToEntropy(colorFreq);
  const colorScore = frequencyToAnonymityScore(colorFreq);
  attributes.push({
    id: "colorDepth",
    label: "Color Depth",
    anonymityScore: colorScore,
    entropyBits: colorEntropy,
    value: `${fp.color_depth}-bit`,
    frequency: colorFreq,
    isRisk: false,
  });
  totalWeightedScore += colorScore * POPULATION_STATS.colorDepth.weight;
  totalWeight += POPULATION_STATS.colorDepth.weight;
  totalEntropyBits += colorEntropy * POPULATION_STATS.colorDepth.weight;

  // ── Pixel Ratio ──────────────────────────────────────────────────────────
  const dprFreq =
    POPULATION_STATS.pixelRatio.commonValues[String(fp.pixel_ratio)] ?? null;
  const dprEntropy = frequencyToEntropy(dprFreq);
  const dprScore = frequencyToAnonymityScore(dprFreq);
  attributes.push({
    id: "pixelRatio",
    label: "Pixel Ratio",
    anonymityScore: dprScore,
    entropyBits: dprEntropy,
    value: `${fp.pixel_ratio}x`,
    frequency: dprFreq,
    isRisk: dprScore < 40,
  });
  totalWeightedScore += dprScore * POPULATION_STATS.pixelRatio.weight;
  totalWeight += POPULATION_STATS.pixelRatio.weight;
  totalEntropyBits += dprEntropy * POPULATION_STATS.pixelRatio.weight;

  // ── WebGL Vendor ─────────────────────────────────────────────────────────
  const webglFreq =
    POPULATION_STATS.webglVendor.commonValues[fp.webgl_vendor] ?? 0.05;
  const webglEntropy = frequencyToEntropy(webglFreq);
  const webglScore = frequencyToAnonymityScore(webglFreq);
  attributes.push({
    id: "webglVendor",
    label: "WebGL Vendor",
    anonymityScore: webglScore,
    entropyBits: webglEntropy,
    value: fp.webgl_vendor,
    frequency: webglFreq,
    isRisk: webglScore < 50,
  });
  totalWeightedScore += webglScore * POPULATION_STATS.webglVendor.weight;
  totalWeight += POPULATION_STATS.webglVendor.weight;
  totalEntropyBits += webglEntropy * POPULATION_STATS.webglVendor.weight;

  // ── WebGL Renderer ───────────────────────────────────────────────────────
  // Renderer is highly unique, estimate based on vendor match
  const rendererFreq = webglFreq * 0.3; // Much more specific than vendor
  const rendererEntropy = frequencyToEntropy(rendererFreq);
  const rendererScore = frequencyToAnonymityScore(rendererFreq);
  attributes.push({
    id: "webglRenderer",
    label: "WebGL Renderer",
    anonymityScore: rendererScore,
    entropyBits: rendererEntropy,
    value:
      fp.webgl_renderer.length > 50
        ? fp.webgl_renderer.slice(0, 47) + "..."
        : fp.webgl_renderer,
    frequency: rendererFreq,
    isRisk: true, // Always a risk - very identifying
    recommendation:
      "WebGL renderer is highly identifying; consider noise injection",
  });
  totalWeightedScore += rendererScore * POPULATION_STATS.webglRenderer.weight;
  totalWeight += POPULATION_STATS.webglRenderer.weight;
  totalEntropyBits += rendererEntropy * POPULATION_STATS.webglRenderer.weight;

  // ── Canvas Fingerprint (noise level) ─────────────────────────────────────
  // With noise, canvas becomes less identifying
  const canvasNoise = fp.canvas_noise ?? 0;
  const canvasEffectiveEntropy =
    canvasNoise >= 0.1
      ? 4
      : canvasNoise >= 0.05
        ? 6
        : canvasNoise >= 0.02
          ? 8
          : 12;
  const canvasScore =
    canvasNoise >= 0.1
      ? 80
      : canvasNoise >= 0.05
        ? 60
        : canvasNoise >= 0.02
          ? 40
          : 20;
  attributes.push({
    id: "canvasFingerprint",
    label: "Canvas Fingerprint",
    anonymityScore: canvasScore,
    entropyBits: canvasEffectiveEntropy,
    value: `${(canvasNoise * 100).toFixed(1)}% noise`,
    frequency: null,
    isRisk: canvasNoise < 0.02,
    recommendation:
      canvasNoise < 0.02
        ? "Increase canvas noise to at least 2% for better anonymity"
        : undefined,
  });
  totalWeightedScore += canvasScore * POPULATION_STATS.canvasFingerprint.weight;
  totalWeight += POPULATION_STATS.canvasFingerprint.weight;
  totalEntropyBits +=
    canvasEffectiveEntropy * POPULATION_STATS.canvasFingerprint.weight;

  // ── Audio Fingerprint (noise level) ──────────────────────────────────────
  const audioNoise = fp.audio_noise ?? 0;
  const audioEffectiveEntropy =
    audioNoise >= 0.005 ? 3 : audioNoise >= 0.002 ? 5 : 8;
  const audioScore = audioNoise >= 0.005 ? 80 : audioNoise >= 0.002 ? 50 : 20;
  attributes.push({
    id: "audioFingerprint",
    label: "Audio Fingerprint",
    anonymityScore: audioScore,
    entropyBits: audioEffectiveEntropy,
    value: `${(audioNoise * 100).toFixed(3)}% noise`,
    frequency: null,
    isRisk: audioNoise < 0.002,
  });
  totalWeightedScore += audioScore * POPULATION_STATS.audioFingerprint.weight;
  totalWeight += POPULATION_STATS.audioFingerprint.weight;
  totalEntropyBits +=
    audioEffectiveEntropy * POPULATION_STATS.audioFingerprint.weight;

  // ── Fonts ────────────────────────────────────────────────────────────────
  const fontCount = fp.font_subset?.length ?? 0;
  // Fewer fonts = more common (system fonts only)
  const fontScore =
    fontCount <= 20 ? 90 : fontCount <= 50 ? 70 : fontCount <= 80 ? 50 : 30;
  const fontEntropy = fontCount <= 20 ? 3 : fontCount <= 50 ? 5 : 7.5;
  attributes.push({
    id: "fonts",
    label: "Font List",
    anonymityScore: fontScore,
    entropyBits: fontEntropy,
    value: `${fontCount} fonts`,
    frequency: null,
    isRisk: fontCount > 80,
    recommendation:
      fontCount > 80
        ? "Reduce exposed fonts to system defaults only"
        : undefined,
  });
  totalWeightedScore += fontScore * POPULATION_STATS.fonts.weight;
  totalWeight += POPULATION_STATS.fonts.weight;
  totalEntropyBits += fontEntropy * POPULATION_STATS.fonts.weight;

  // ── Correlation Penalties ────────────────────────────────────────────────
  const correlationPenalties = detectCorrelations(fp);
  const totalPenalty = correlationPenalties.reduce(
    (sum, p) => sum + p.penalty,
    0,
  );

  // ── Calculate Final Score ────────────────────────────────────────────────
  const baseAnonymityScore =
    totalWeight > 0 ? totalWeightedScore / totalWeight : 50;
  const anonymityScore = Math.max(
    0,
    Math.round(baseAnonymityScore - totalPenalty),
  );

  // Estimate uniqueness ratio (1 in N browsers)
  // Based on total entropy bits
  const effectiveEntropy = totalEntropyBits + totalPenalty * 0.5;
  const uniquenessRatio = Math.round(
    Math.pow(2, Math.min(effectiveEntropy, 33)),
  );

  // Determine risk level
  let riskLevel: "low" | "medium" | "high" | "critical";
  if (anonymityScore >= 75) riskLevel = "low";
  else if (anonymityScore >= 50) riskLevel = "medium";
  else if (anonymityScore >= 25) riskLevel = "high";
  else riskLevel = "critical";

  // Generate recommendations
  const recommendations: string[] = [];
  const risks = attributes.filter((a) => a.isRisk);

  if (risks.length === 0) {
    recommendations.push("Your fingerprint has good anonymity characteristics");
  } else {
    if (risks.some((r) => r.id === "canvasFingerprint")) {
      recommendations.push(
        "Increase canvas noise for better protection against canvas fingerprinting",
      );
    }
    if (risks.some((r) => r.id === "webglRenderer")) {
      recommendations.push(
        "Consider using WebGL noise injection to mask your GPU",
      );
    }
    if (risks.some((r) => r.id === "fonts")) {
      recommendations.push("Limit exposed fonts to reduce font fingerprinting");
    }
    if (correlationPenalties.length > 0) {
      recommendations.push(
        "Fix inconsistencies between fingerprint attributes",
      );
    }
  }

  if (uniquenessRatio > 100000) {
    recommendations.push(
      `Your fingerprint is highly unique (1 in ${uniquenessRatio.toLocaleString()}). Consider adjusting settings.`,
    );
  }

  return {
    anonymityScore,
    uniquenessRatio,
    totalEntropyBits: Math.round(totalEntropyBits * 10) / 10,
    attributes: attributes.sort((a, b) => a.anonymityScore - b.anonymityScore), // Worst first
    correlationPenalties,
    riskLevel,
    recommendations,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Get a simple anonymity grade (A-F) from a score
 */
export function getAnonymityGrade(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

/**
 * Format uniqueness ratio for display
 */
export function formatUniquenessRatio(ratio: number): string {
  if (ratio >= 1_000_000_000)
    return `1 in ${(ratio / 1_000_000_000).toFixed(1)}B`;
  if (ratio >= 1_000_000) return `1 in ${(ratio / 1_000_000).toFixed(1)}M`;
  if (ratio >= 1_000) return `1 in ${(ratio / 1_000).toFixed(1)}K`;
  return `1 in ${ratio}`;
}

/**
 * Compare two fingerprints and return similarity score (0-100)
 */
export function compareFingerprintSimilarity(
  fp1: Fingerprint,
  fp2: Fingerprint,
): number {
  let matches = 0;
  let total = 0;

  // Compare key attributes
  const comparisons: [string, string][] = [
    [fp1.platform, fp2.platform],
    [fp1.timezone, fp2.timezone],
    [fp1.locale, fp2.locale],
    [String(fp1.screen_width), String(fp2.screen_width)],
    [String(fp1.screen_height), String(fp2.screen_height)],
    [String(fp1.hardware_concurrency), String(fp2.hardware_concurrency)],
    [String(fp1.device_memory), String(fp2.device_memory)],
    [String(fp1.color_depth), String(fp2.color_depth)],
    [String(fp1.pixel_ratio), String(fp2.pixel_ratio)],
    [fp1.webgl_vendor, fp2.webgl_vendor],
  ];

  for (const [v1, v2] of comparisons) {
    total++;
    if (v1 === v2) matches++;
  }

  return total > 0 ? Math.round((matches / total) * 100) : 0;
}

/**
 * Check if a fingerprint would pass common bot detection systems
 */
export function checkBotDetectionRisk(fp: Fingerprint): {
  wouldPass: boolean;
  risks: string[];
} {
  const risks: string[] = [];

  // Check for obvious automation signals
  if (fp.hardware_concurrency === 1) {
    risks.push("Single core CPU is rare in real browsers");
  }

  if (fp.device_memory < 1) {
    risks.push("Very low memory is uncommon");
  }

  if (!fp.webgl_vendor || fp.webgl_vendor === "Unknown") {
    risks.push("Missing WebGL vendor indicates headless browser");
  }

  if ((fp.font_subset?.length ?? 0) < 10) {
    risks.push("Very few fonts may indicate automation");
  }

  if (fp.webrtc_mode === "block") {
    risks.push("Blocked WebRTC may trigger some detectors");
  }

  const canvasNoise = fp.canvas_noise ?? 0;
  if (canvasNoise > 0.3) {
    risks.push("Excessive canvas noise may be detectable");
  }

  return {
    wouldPass: risks.length === 0,
    risks,
  };
}
