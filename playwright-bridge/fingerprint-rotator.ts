// ── Fingerprint Rotator with AmIUnique Uniqueness Validation ─────────────────
//
// This module provides fingerprint rotation with uniqueness validation based on
// AmIUnique.org research data. When rotating fingerprints during automation,
// it ensures each new fingerprint is statistically unique and won't be easily
// correlated with previous fingerprints.

import type { Fingerprint, UaBrand } from "./types";

// ── Population Statistics (AmIUnique calibrated) ─────────────────────────────

interface PopulationStats {
  entropy: number;
  commonValues: Record<string, number>;
  weight: number;
}

const POPULATION_STATS: Record<string, PopulationStats> = {
  userAgent: {
    entropy: 10.0,
    commonValues: {
      chrome_windows: 0.45,
      chrome_macos: 0.15,
      chrome_linux: 0.03,
      firefox_windows: 0.08,
      safari_macos: 0.12,
    },
    weight: 0.12,
  },
  screenResolution: {
    entropy: 6.5,
    commonValues: {
      "1920x1080": 0.23,
      "1366x768": 0.12,
      "2560x1440": 0.08,
      "1536x864": 0.06,
      "1440x900": 0.05,
    },
    weight: 0.08,
  },
  timezone: {
    entropy: 4.5,
    commonValues: {
      "America/New_York": 0.15,
      "America/Los_Angeles": 0.1,
      "Europe/London": 0.08,
      "America/Chicago": 0.06,
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
    },
    weight: 0.05,
  },
  hardwareConcurrency: {
    entropy: 3.0,
    commonValues: { "4": 0.25, "8": 0.35, "6": 0.15, "2": 0.1 },
    weight: 0.05,
  },
  deviceMemory: {
    entropy: 2.5,
    commonValues: { "8": 0.4, "4": 0.25, "16": 0.15, "2": 0.1 },
    weight: 0.04,
  },
  webglRenderer: {
    entropy: 8.0,
    commonValues: {
      "ANGLE (Intel": 0.25,
      "ANGLE (NVIDIA": 0.2,
      "ANGLE (AMD": 0.15,
    },
    weight: 0.1,
  },
  canvasNoise: {
    entropy: 12.0,
    commonValues: {},
    weight: 0.15,
  },
  audioNoise: {
    entropy: 10.0,
    commonValues: {},
    weight: 0.1,
  },
  fonts: {
    entropy: 7.0,
    commonValues: {},
    weight: 0.08,
  },
};

// ── Uniqueness Score Calculation ─────────────────────────────────────────────

export interface UniquenessScore {
  /** Overall uniqueness score 0-100 (higher = more unique) */
  score: number;
  /** Estimated 1-in-N uniqueness ratio */
  uniquenessRatio: number;
  /** Total entropy bits */
  entropyBits: number;
  /** Risk level for detection */
  riskLevel: "low" | "medium" | "high";
  /** Attributes contributing most to uniqueness */
  topContributors: { attribute: string; contribution: number }[];
  /** Whether fingerprint passes uniqueness threshold */
  isUnique: boolean;
}

/**
 * Calculate the uniqueness score for a fingerprint based on AmIUnique statistics.
 */
export function calculateUniquenessScore(fp: Fingerprint): UniquenessScore {
  let totalEntropy = 0;
  const contributions: { attribute: string; contribution: number }[] = [];

  // User Agent entropy
  const uaEntropy =
    POPULATION_STATS.userAgent.entropy * POPULATION_STATS.userAgent.weight;
  totalEntropy += uaEntropy;
  contributions.push({ attribute: "userAgent", contribution: uaEntropy });

  // Screen resolution
  const screenKey = `${fp.screen_width}x${fp.screen_height}`;
  const screenFreq =
    POPULATION_STATS.screenResolution.commonValues[screenKey] ?? 0.01;
  const screenEntropy =
    -Math.log2(screenFreq) * POPULATION_STATS.screenResolution.weight;
  totalEntropy += screenEntropy;
  contributions.push({
    attribute: "screenResolution",
    contribution: screenEntropy,
  });

  // Timezone
  const tzFreq = POPULATION_STATS.timezone.commonValues[fp.timezone] ?? 0.02;
  const tzEntropy = -Math.log2(tzFreq) * POPULATION_STATS.timezone.weight;
  totalEntropy += tzEntropy;
  contributions.push({ attribute: "timezone", contribution: tzEntropy });

  // Language/locale
  const langFreq = POPULATION_STATS.language.commonValues[fp.locale] ?? 0.02;
  const langEntropy = -Math.log2(langFreq) * POPULATION_STATS.language.weight;
  totalEntropy += langEntropy;
  contributions.push({ attribute: "language", contribution: langEntropy });

  // Hardware concurrency
  const hwKey = String(fp.hardware_concurrency);
  const hwFreq =
    POPULATION_STATS.hardwareConcurrency.commonValues[hwKey] ?? 0.05;
  const hwEntropy =
    -Math.log2(hwFreq) * POPULATION_STATS.hardwareConcurrency.weight;
  totalEntropy += hwEntropy;
  contributions.push({
    attribute: "hardwareConcurrency",
    contribution: hwEntropy,
  });

  // Device memory
  const memKey = String(fp.device_memory);
  const memFreq = POPULATION_STATS.deviceMemory.commonValues[memKey] ?? 0.05;
  const memEntropy = -Math.log2(memFreq) * POPULATION_STATS.deviceMemory.weight;
  totalEntropy += memEntropy;
  contributions.push({ attribute: "deviceMemory", contribution: memEntropy });

  // WebGL renderer (partial match)
  let webglEntropy =
    POPULATION_STATS.webglRenderer.entropy *
    POPULATION_STATS.webglRenderer.weight;
  for (const [prefix, freq] of Object.entries(
    POPULATION_STATS.webglRenderer.commonValues,
  )) {
    if (fp.webgl_renderer.startsWith(prefix)) {
      webglEntropy = -Math.log2(freq) * POPULATION_STATS.webglRenderer.weight;
      break;
    }
  }
  totalEntropy += webglEntropy;
  contributions.push({
    attribute: "webglRenderer",
    contribution: webglEntropy,
  });

  // Canvas noise (continuous - use noise level as entropy indicator)
  const canvasEntropy =
    fp.canvas_noise * 100 * POPULATION_STATS.canvasNoise.weight;
  totalEntropy += canvasEntropy;
  contributions.push({ attribute: "canvasNoise", contribution: canvasEntropy });

  // Audio noise
  const audioEntropy =
    fp.audio_noise * 1000 * POPULATION_STATS.audioNoise.weight;
  totalEntropy += audioEntropy;
  contributions.push({ attribute: "audioNoise", contribution: audioEntropy });

  // Font subset entropy (based on count and uniqueness)
  const fontEntropy =
    Math.min(fp.font_subset.length / 50, 1) *
    POPULATION_STATS.fonts.entropy *
    POPULATION_STATS.fonts.weight;
  totalEntropy += fontEntropy;
  contributions.push({ attribute: "fonts", contribution: fontEntropy });

  // Sort contributions by value
  contributions.sort((a, b) => b.contribution - a.contribution);

  // Calculate uniqueness ratio (1 in N browsers)
  const uniquenessRatio = Math.pow(2, totalEntropy);

  // Normalize to 0-100 score
  // Score of 50 means 1 in ~1000 browsers (average uniqueness)
  // Score of 80+ means highly unique
  const score = Math.min(
    100,
    Math.max(0, (Math.log2(uniquenessRatio) / 20) * 100),
  );

  // Determine risk level
  let riskLevel: "low" | "medium" | "high";
  if (score >= 70) {
    riskLevel = "low"; // Very unique, unlikely to be fingerprinted as same user
  } else if (score >= 40) {
    riskLevel = "medium";
  } else {
    riskLevel = "high"; // Not unique enough, may be correlated
  }

  return {
    score,
    uniquenessRatio,
    entropyBits: totalEntropy,
    riskLevel,
    topContributors: contributions.slice(0, 5),
    isUnique: score >= 60,
  };
}

// ── Fingerprint Similarity Check ─────────────────────────────────────────────

/**
 * Calculate similarity between two fingerprints (0-1, higher = more similar)
 */
export function fingerprintSimilarity(
  fp1: Fingerprint,
  fp2: Fingerprint,
): number {
  let matchScore = 0;
  let totalWeight = 0;

  // Check each attribute with weights
  const checks: { match: boolean; weight: number }[] = [
    { match: fp1.user_agent === fp2.user_agent, weight: 0.15 },
    {
      match:
        fp1.screen_width === fp2.screen_width &&
        fp1.screen_height === fp2.screen_height,
      weight: 0.1,
    },
    { match: fp1.timezone === fp2.timezone, weight: 0.08 },
    { match: fp1.locale === fp2.locale, weight: 0.06 },
    {
      match: fp1.hardware_concurrency === fp2.hardware_concurrency,
      weight: 0.05,
    },
    { match: fp1.device_memory === fp2.device_memory, weight: 0.04 },
    { match: fp1.webgl_vendor === fp2.webgl_vendor, weight: 0.08 },
    { match: fp1.webgl_renderer === fp2.webgl_renderer, weight: 0.1 },
    { match: fp1.platform === fp2.platform, weight: 0.06 },
    { match: fp1.ua_platform === fp2.ua_platform, weight: 0.05 },
    {
      match: Math.abs(fp1.canvas_noise - fp2.canvas_noise) < 0.01,
      weight: 0.1,
    },
    {
      match: Math.abs(fp1.audio_noise - fp2.audio_noise) < 0.001,
      weight: 0.08,
    },
    { match: fp1.color_depth === fp2.color_depth, weight: 0.02 },
    { match: fp1.pixel_ratio === fp2.pixel_ratio, weight: 0.03 },
  ];

  for (const { match, weight } of checks) {
    totalWeight += weight;
    if (match) matchScore += weight;
  }

  return matchScore / totalWeight;
}

/**
 * Check if a fingerprint is sufficiently different from a list of previous fingerprints
 */
export function isFingerPrintDistinct(
  newFp: Fingerprint,
  previousFps: Fingerprint[],
  similarityThreshold: number = 0.3,
): boolean {
  for (const prevFp of previousFps) {
    const similarity = fingerprintSimilarity(newFp, prevFp);
    if (similarity > similarityThreshold) {
      return false; // Too similar to a previous fingerprint
    }
  }
  return true;
}

// ── Fingerprint Generation ───────────────────────────────────────────────────

// Simple seeded PRNG for deterministic generation
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

// OS distributions
const OS_WEIGHTS = [
  { os: "Windows", weight: 0.72 },
  { os: "macOS", weight: 0.18 },
  { os: "Linux", weight: 0.1 },
];

// Chrome versions
const CHROME_VERSIONS = [
  "120",
  "121",
  "122",
  "123",
  "124",
  "125",
  "126",
  "127",
  "128",
  "129",
  "130",
  "131",
];

// Screen resolutions by OS
const SCREEN_RESOLUTIONS: Record<string, [number, number, number][]> = {
  Windows: [
    [1920, 1080, 1],
    [2560, 1440, 1],
    [1366, 768, 1],
    [1536, 864, 1.25],
    [1440, 900, 1],
    [1680, 1050, 1],
    [3840, 2160, 1.5],
    [1280, 720, 1],
  ],
  macOS: [
    [1440, 900, 2],
    [1680, 1050, 2],
    [1920, 1080, 2],
    [2560, 1440, 2],
    [2880, 1800, 2],
    [3024, 1964, 2],
    [3456, 2234, 2],
  ],
  Linux: [
    [1920, 1080, 1],
    [2560, 1440, 1],
    [1366, 768, 1],
    [1600, 900, 1],
  ],
};

// WebGL vendors/renderers by OS
const WEBGL_CONFIGS: Record<string, { vendor: string; renderer: string }[]> = {
  Windows: [
    {
      vendor: "Google Inc. (NVIDIA)",
      renderer:
        "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
      vendor: "Google Inc. (NVIDIA)",
      renderer:
        "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
      vendor: "Google Inc. (NVIDIA)",
      renderer:
        "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
      vendor: "Google Inc. (Intel)",
      renderer:
        "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
      vendor: "Google Inc. (Intel)",
      renderer:
        "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
      vendor: "Google Inc. (AMD)",
      renderer:
        "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
    {
      vendor: "Google Inc. (AMD)",
      renderer:
        "ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    },
  ],
  macOS: [
    {
      vendor: "Google Inc. (Apple)",
      renderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
    },
    {
      vendor: "Google Inc. (Apple)",
      renderer: "ANGLE (Apple, Apple M2, OpenGL 4.1)",
    },
    {
      vendor: "Google Inc. (Apple)",
      renderer: "ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)",
    },
    {
      vendor: "Google Inc. (Intel)",
      renderer:
        "ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)",
    },
  ],
  Linux: [
    {
      vendor: "Google Inc. (NVIDIA Corporation)",
      renderer:
        "ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3080/PCIe/SSE2, OpenGL 4.5)",
    },
    {
      vendor: "Google Inc. (Intel)",
      renderer:
        "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)",
    },
    {
      vendor: "Google Inc. (AMD)",
      renderer:
        "ANGLE (AMD, AMD Radeon RX 6800 XT (navi21, LLVM 15.0.7, DRM 3.49, 6.1.0-18-amd64), OpenGL 4.6)",
    },
  ],
};

// Timezones with weights
const TIMEZONES = [
  { tz: "America/New_York", weight: 0.15 },
  { tz: "America/Chicago", weight: 0.08 },
  { tz: "America/Denver", weight: 0.04 },
  { tz: "America/Los_Angeles", weight: 0.12 },
  { tz: "Europe/London", weight: 0.1 },
  { tz: "Europe/Paris", weight: 0.06 },
  { tz: "Europe/Berlin", weight: 0.05 },
  { tz: "Asia/Tokyo", weight: 0.05 },
  { tz: "Asia/Shanghai", weight: 0.04 },
  { tz: "Australia/Sydney", weight: 0.03 },
];

// Locales
const LOCALES = [
  { locale: "en-US", lang: "en-US,en;q=0.9", weight: 0.45 },
  { locale: "en-GB", lang: "en-GB,en;q=0.9", weight: 0.1 },
  { locale: "de-DE", lang: "de-DE,de;q=0.9,en;q=0.8", weight: 0.06 },
  { locale: "fr-FR", lang: "fr-FR,fr;q=0.9,en;q=0.8", weight: 0.05 },
  { locale: "es-ES", lang: "es-ES,es;q=0.9,en;q=0.8", weight: 0.04 },
  { locale: "ja-JP", lang: "ja-JP,ja;q=0.9,en;q=0.8", weight: 0.03 },
];

// Fonts by OS
const FONTS: Record<string, string[]> = {
  Windows: [
    "Arial",
    "Arial Black",
    "Calibri",
    "Cambria",
    "Candara",
    "Comic Sans MS",
    "Consolas",
    "Constantia",
    "Corbel",
    "Courier New",
    "Georgia",
    "Impact",
    "Lucida Console",
    "Lucida Sans Unicode",
    "Microsoft Sans Serif",
    "Palatino Linotype",
    "Segoe UI",
    "Tahoma",
    "Times New Roman",
    "Trebuchet MS",
    "Verdana",
    "Wingdings",
  ],
  macOS: [
    "Arial",
    "Arial Black",
    "Courier New",
    "Georgia",
    "Helvetica",
    "Helvetica Neue",
    "Impact",
    "Lucida Grande",
    "Monaco",
    "Palatino",
    "SF Pro",
    "SF Mono",
    "Times New Roman",
    "Trebuchet MS",
    "Verdana",
    "Menlo",
    "Optima",
    "Futura",
  ],
  Linux: [
    "Arial",
    "Bitstream Vera Sans",
    "Cantarell",
    "Courier New",
    "DejaVu Sans",
    "DejaVu Sans Mono",
    "Droid Sans",
    "FreeMono",
    "FreeSans",
    "Georgia",
    "Liberation Mono",
    "Liberation Sans",
    "Noto Sans",
    "Times New Roman",
    "Ubuntu",
  ],
};

function pickWeighted<T extends { weight: number }>(
  rng: SeededRandom,
  items: T[],
): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let r = rng.next() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

/**
 * Generate a new unique fingerprint from a seed
 */
export function generateFingerprint(seed: number): Fingerprint {
  const rng = new SeededRandom(seed);

  // Pick OS
  const { os } = pickWeighted(rng, OS_WEIGHTS);

  // Pick Chrome version
  const chromeVersion = rng.pick(CHROME_VERSIONS);
  const chromeFull = `${chromeVersion}.0.${rng.nextInt(6000, 6999)}.${rng.nextInt(100, 200)}`;

  // Build user agent
  let userAgent: string;
  let platform: string;
  let uaPlatform: string;
  let uaPlatformVersion: string;

  if (os === "Windows") {
    const winVer = rng.pick(["10.0", "10.0", "10.0", "11.0"]); // Win10 more common
    userAgent = `Mozilla/5.0 (Windows NT ${winVer}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFull} Safari/537.36`;
    platform = "Win32";
    uaPlatform = "Windows";
    uaPlatformVersion = winVer === "11.0" ? "15.0.0" : "10.0.0";
  } else if (os === "macOS") {
    const macVer = rng.pick([
      "10_15_7",
      "11_6_0",
      "12_6_0",
      "13_4_0",
      "14_2_0",
    ]);
    userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macVer}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFull} Safari/537.36`;
    platform = "MacIntel";
    uaPlatform = "macOS";
    uaPlatformVersion = macVer
      .replace(/_/g, ".")
      .split(".")
      .slice(0, 2)
      .join(".");
  } else {
    userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFull} Safari/537.36`;
    platform = "Linux x86_64";
    uaPlatform = "Linux";
    uaPlatformVersion = "";
  }

  // Screen resolution
  const [screenWidth, screenHeight, pixelRatio] = rng.pick(
    SCREEN_RESOLUTIONS[os] ?? SCREEN_RESOLUTIONS["Windows"],
  );
  const viewportWidth = Math.floor(screenWidth * (0.85 + rng.next() * 0.1));
  const viewportHeight = Math.floor(screenHeight * (0.75 + rng.next() * 0.15));

  // WebGL
  const webgl = rng.pick(WEBGL_CONFIGS[os] ?? WEBGL_CONFIGS["Windows"]);

  // Timezone and locale
  const { tz: timezone } = pickWeighted(rng, TIMEZONES);
  const { locale, lang: acceptLanguage } = pickWeighted(rng, LOCALES);

  // Hardware
  const hardwareConcurrency = rng.pick([2, 4, 4, 6, 8, 8, 8, 12, 16]);
  const deviceMemory = rng.pick([2, 4, 4, 8, 8, 8, 16]);

  // Fonts
  const osFonts = FONTS[os] ?? FONTS["Windows"];
  const fontSubset = rng.shuffle(osFonts).slice(0, rng.nextInt(12, 18));

  // Noise values (quantum-inspired distribution)
  const canvasNoise = 0.02 + rng.next() * 0.12;
  const webglNoise = 0.02 + rng.next() * 0.08;
  const audioNoise = 0.002 + rng.next() * 0.008;

  // UA-CH brands
  const uaBrands: UaBrand[] = [
    { brand: "Not/A)Brand", version: "8" },
    { brand: "Chromium", version: chromeVersion },
    { brand: "Google Chrome", version: chromeVersion },
  ];

  // WebRTC fake data
  const mdnsId = Array.from({ length: 8 }, () =>
    rng.nextInt(0, 15).toString(16),
  ).join("");
  const webrtcFakeMdns = `${mdnsId}.local`;
  const webrtcFakeIp = `192.168.${rng.nextInt(0, 255)}.${rng.nextInt(2, 254)}`;

  return {
    seed,
    canvas_noise: canvasNoise,
    webgl_vendor: webgl.vendor,
    webgl_renderer: webgl.renderer,
    webgl_noise: webglNoise,
    audio_noise: audioNoise,
    font_subset: fontSubset,
    user_agent: userAgent,
    platform,
    accept_language: acceptLanguage,
    hardware_concurrency: hardwareConcurrency,
    device_memory: deviceMemory,
    screen_width: screenWidth,
    screen_height: screenHeight,
    viewport_width: viewportWidth,
    viewport_height: viewportHeight,
    color_depth: 24,
    pixel_ratio: pixelRatio,
    webrtc_mode: "fake_mdns",
    webrtc_fake_mdns: webrtcFakeMdns,
    webrtc_fake_ip: webrtcFakeIp,
    timezone,
    locale,
    ua_brands: uaBrands,
    ua_mobile: false,
    ua_platform: uaPlatform,
    ua_platform_version: uaPlatformVersion,
    ua_architecture: "x86",
    ua_bitness: "64",
    permissions: {
      geolocation: "prompt",
      notifications: "prompt",
      camera: "prompt",
      microphone: "prompt",
    },
  };
}

// ── Unique Fingerprint Rotation ──────────────────────────────────────────────

export interface RotationResult {
  fingerprint: Fingerprint;
  attempts: number;
  uniquenessScore: UniquenessScore;
  distinctFromPrevious: boolean;
}

/**
 * Generate a unique fingerprint that passes AmIUnique validation and is distinct
 * from all previously used fingerprints.
 *
 * @param previousFingerprints - Array of fingerprints previously used in this session
 * @param minUniquenessScore - Minimum uniqueness score required (0-100, default 60)
 * @param maxAttempts - Maximum generation attempts before returning best result
 * @param baseSeed - Optional base seed (default: current timestamp)
 */
export function rotateToUniqueFingerprint(
  previousFingerprints: Fingerprint[],
  minUniquenessScore: number = 60,
  maxAttempts: number = 50,
  baseSeed?: number,
): RotationResult {
  let bestResult: RotationResult | null = null;
  let seed = baseSeed ?? Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generate fingerprint with unique seed
    const fp = generateFingerprint(seed + attempt * 7919); // Prime number for better distribution

    // Check uniqueness score
    const uniquenessScore = calculateUniquenessScore(fp);

    // Check distinctness from previous fingerprints
    const distinctFromPrevious = isFingerPrintDistinct(
      fp,
      previousFingerprints,
    );

    const result: RotationResult = {
      fingerprint: fp,
      attempts: attempt + 1,
      uniquenessScore,
      distinctFromPrevious,
    };

    // Track best result
    if (
      !bestResult ||
      uniquenessScore.score > bestResult.uniquenessScore.score
    ) {
      bestResult = result;
    }

    // Return if meets all criteria
    if (uniquenessScore.score >= minUniquenessScore && distinctFromPrevious) {
      return result;
    }
  }

  // Return best result even if not perfect
  return bestResult!;
}

/**
 * Validate a fingerprint against AmIUnique-style metrics.
 * Returns true if the fingerprint is sufficiently unique.
 */
export function validateFingerprintUniqueness(
  fp: Fingerprint,
  minScore: number = 60,
): { valid: boolean; score: UniquenessScore; issues: string[] } {
  const score = calculateUniquenessScore(fp);
  const issues: string[] = [];

  if (score.score < minScore) {
    issues.push(
      `Uniqueness score ${score.score.toFixed(1)} below minimum ${minScore}`,
    );
  }

  if (score.riskLevel === "high") {
    issues.push("High correlation risk - fingerprint may be easily tracked");
  }

  // Check for suspicious patterns
  if (fp.canvas_noise < 0.01) {
    issues.push("Canvas noise too low - may trigger bot detection");
  }

  if (fp.audio_noise < 0.001) {
    issues.push("Audio noise too low - may trigger bot detection");
  }

  // Check screen consistency
  if (
    fp.viewport_width > fp.screen_width ||
    fp.viewport_height > fp.screen_height
  ) {
    issues.push("Viewport larger than screen - inconsistent fingerprint");
  }

  return {
    valid: issues.length === 0 && score.score >= minScore,
    score,
    issues,
  };
}

// ── Session Fingerprint Manager ──────────────────────────────────────────────

/**
 * Manages fingerprint rotation within a session, tracking used fingerprints
 * and ensuring uniqueness across rotations.
 */
export class FingerprintRotationManager {
  private usedFingerprints: Fingerprint[] = [];
  private rotationCount: number = 0;
  private minUniquenessScore: number;
  private maxSimilarity: number;

  constructor(options?: {
    minUniquenessScore?: number;
    maxSimilarity?: number;
  }) {
    this.minUniquenessScore = options?.minUniquenessScore ?? 60;
    this.maxSimilarity = options?.maxSimilarity ?? 0.3;
  }

  /**
   * Get the next unique fingerprint for rotation
   */
  rotate(baseSeed?: number): RotationResult {
    const result = rotateToUniqueFingerprint(
      this.usedFingerprints,
      this.minUniquenessScore,
      50,
      baseSeed,
    );

    this.usedFingerprints.push(result.fingerprint);
    this.rotationCount++;

    return result;
  }

  /**
   * Add an existing fingerprint to the used list (e.g., initial profile fingerprint)
   */
  addUsedFingerprint(fp: Fingerprint): void {
    this.usedFingerprints.push(fp);
  }

  /**
   * Get statistics about rotation session
   */
  getStats(): {
    rotationCount: number;
    usedFingerprintsCount: number;
    averageUniquenessScore: number;
  } {
    const scores = this.usedFingerprints.map(
      (fp) => calculateUniquenessScore(fp).score,
    );
    const avgScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    return {
      rotationCount: this.rotationCount,
      usedFingerprintsCount: this.usedFingerprints.length,
      averageUniquenessScore: avgScore,
    };
  }

  /**
   * Reset the manager for a new session
   */
  reset(): void {
    this.usedFingerprints = [];
    this.rotationCount = 0;
  }

  /**
   * Check if a fingerprint would be distinct from previously used ones
   */
  wouldBeDistinct(fp: Fingerprint): boolean {
    return isFingerPrintDistinct(fp, this.usedFingerprints, this.maxSimilarity);
  }
}
