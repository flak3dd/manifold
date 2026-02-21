// ── Manifold fingerprint generator (TypeScript fallback) ────────────────────
//
// This is a JavaScript port of the Rust FingerprintOrchestrator::generate()
// function. Used as a fallback when Tauri is unavailable (e.g., `npm run dev`
// in a browser). In production, the Rust backend is authoritative.
//
// Mirrors the Rust implementation for deterministic, seeded generation.

import type { Fingerprint, UaBrand } from './types';

// ── Seeded PRNG (simple but sufficient) ────────────────────────────────────

class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state;
  }

  gen(max: number): number {
    return (this.next() >>> 0) % max;
  }

  genBool(probability: number): boolean {
    return (this.next() >>> 0) / 0x7fffffff < probability;
  }

  genRange(min: number, max: number): number {
    return min + this.gen(max - min);
  }

  genFloat(): number {
    return (this.next() >>> 0) / 0x7fffffff;
  }

  pick<T>(arr: T[]): T {
    return arr[this.gen(arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.gen(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function pickOs(rng: SeededRng): 'windows' | 'macos' | 'linux' {
  // Weighted: Windows ~70%, macOS ~25%, Linux ~5%
  const pick = rng.gen(20);
  if (pick <= 13) return 'windows';
  if (pick <= 18) return 'macos';
  return 'linux';
}

function buildUa(rng: SeededRng, os: 'windows' | 'macos' | 'linux'): {
  userAgent: string;
  platform: string;
  uaPlatform: string;
  uaPlatformVersion: string;
  uaArchitecture: string;
  uaBitness: string;
} {
  // Chrome 124-136 weighted toward recent majors (~60% of real traffic).
  // Mirrors the Rust FingerprintOrchestrator::build_ua weight table.
  const w = rng.gen(100);
  const chromeMajor =
    w < 10 ? 124 :
    w < 20 ? 125 :
    w < 30 ? 126 :
    w < 40 ? 127 :
    w < 50 ? 128 :
    w < 60 ? 129 :
    w < 65 ? 130 :
    w < 73 ? 131 :
    w < 81 ? 132 :
    w < 88 ? 133 :
    w < 94 ? 134 :
    w < 97 ? 135 : 136;
  const chromeMinor = rng.genRange(0, 9999);
  const chromeBuild = rng.genRange(0, 999);

  if (os === 'macos') {
    // macOS 13 (Ventura) – 15 (Sequoia); Chrome UA still uses legacy 10_15_x format
    const macUaVer = `10_15_${rng.genRange(7, 9)}`;
    const ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macUaVer}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${chromeMinor}.${chromeBuild} Safari/537.36`;
    // High-entropy platform version reports the real macOS major.minor.patch
    const [macMajor, macMinorMax] = rng.gen(10) < 3 ? [13, 6] : rng.gen(10) < 6 ? [14, 7] : [15, 3];
    const macMinor = rng.genRange(0, macMinorMax);
    const macPatch = rng.genRange(0, 3);
    const platformVer = `${macMajor}.${macMinor}.${macPatch}`;
    return {
      userAgent: ua,
      platform: 'MacIntel',
      uaPlatform: 'macOS',
      uaPlatformVersion: platformVer,
      uaArchitecture: 'arm',
      uaBitness: '64',
    };
  }

  if (os === 'linux') {
    const kernels = ['5.15.0', '5.19.0', '6.1.0', '6.5.0', '6.8.0', '6.11.0'];
    const kernel = rng.pick(kernels);
    const ua = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${chromeMinor}.${chromeBuild} Safari/537.36`;
    return {
      userAgent: ua,
      platform: 'Linux x86_64',
      uaPlatform: 'Linux',
      uaPlatformVersion: kernel,
      uaArchitecture: 'x86',
      uaBitness: '64',
    };
  }

  // Windows — Win10 22H2, Win11 23H2, Win11 24H2
  const winW = rng.gen(10);
  const winBuild =
    winW < 4 ? rng.genRange(19041, 19045) :
    winW < 8 ? rng.genRange(22000, 22631) :
               rng.genRange(26100, 26200);
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${chromeMinor}.${chromeBuild} Safari/537.36`;
  const platformVer = `0.0.${winBuild}`;
  return {
    userAgent: ua,
    platform: 'Win32',
    uaPlatform: 'Windows',
    uaPlatformVersion: platformVer,
    uaArchitecture: 'x86',
    uaBitness: '64',
  };
}

function buildUaBrands(rng: SeededRng, userAgent: string): UaBrand[] {
  const match = userAgent.match(/Chrome\/(\d+)/);
  const major = match ? parseInt(match[1], 10) : 136;

  // Full GREASE char pool (Chrome 124+ expanded set)
  const greaseChars = [' ', '(', ')', '-', '.', '/', ':', ';', '=', '?', '_'];
  // GREASE suffix variants — prevents Akamai/PerimeterX from keying on "A)Brand"
  const greaseSuffixes = ['A)Brand', 'B)Brand', 'X)Brand', 'Y)Brand'];
  const gc = rng.pick(greaseChars);
  const gs = rng.pick(greaseSuffixes);
  // GREASE version rotates with major % 3 (matching Chrome source)
  const gv = major % 3 === 0 ? 8 : major % 3 === 1 ? 24 : 99;

  const greaseBrand: UaBrand = { brand: `Not${gc}${gs}`, version: String(gv) };
  const chromiumBrand: UaBrand = { brand: 'Chromium', version: String(major) };
  const chromeBrand: UaBrand = { brand: 'Google Chrome', version: String(major) };

  // Chrome 124+ randomises GREASE position (first vs last ~50/50)
  return rng.gen(2) === 0
    ? [greaseBrand, chromiumBrand, chromeBrand]
    : [chromiumBrand, chromeBrand, greaseBrand];
}

function pickWebgl(rng: SeededRng, os: 'windows' | 'macos' | 'linux'): { vendor: string; renderer: string } {
  // GPU catalogue updated for 2024-2025 market share (Steam Survey + StatCounter).
  const options: Array<[string, string]> =
    os === 'macos'
      ? [
          // Apple Silicon — dominant on Mac since 2021
          ['Apple', 'Apple M1'],
          ['Apple', 'Apple M1 Pro'],
          ['Apple', 'Apple M2'],
          ['Apple', 'Apple M2 Pro'],
          ['Apple', 'Apple M3'],
          ['Apple', 'Apple M3 Pro'],
          ['Apple', 'Apple M4'],
          // Intel Mac legacy (~15% of Mac Chrome)
          ['Intel Inc.', 'Intel(R) Iris(TM) Plus Graphics 640'],
          ['Intel Inc.', 'Intel(R) UHD Graphics 630'],
          ['Intel Inc.', 'Intel(R) Iris(TM) Plus Graphics 655'],
        ]
      : os === 'linux'
        ? [
            ['Mesa/X.org', 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)'],
            ['Mesa/X.org', 'Mesa Intel(R) UHD Graphics 630 (CFL GT2)'],
            ['Mesa/X.org', 'Mesa Intel(R) HD Graphics 630 (KBL GT2)'],
            ['Mesa/X.org', 'Mesa Intel(R) Xe Graphics (TGL GT2)'],
            ['NVIDIA Corporation', 'NVIDIA GeForce RTX 3060/PCIe/SSE2'],
            ['NVIDIA Corporation', 'NVIDIA GeForce RTX 4070/PCIe/SSE2'],
            ['AMD', 'AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 15.0.7, DRM 3.54)'],
            ['Intel Open Source Technology Center', 'Mesa DRI Intel(R) HD Graphics 620 (Kaby Lake GT2)'],
          ]
        : [
            // NVIDIA Turing/Ampere/Ada desktop + laptop
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            // AMD RDNA 2/3
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 7600 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 7700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 7900 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            // Intel Arc (Alchemist)
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Arc(TM) A750 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            // Intel iGPU
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 730 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
          ];

  const [vendor, renderer] = rng.pick(options);
  return { vendor, renderer };
}

function pickScreen(rng: SeededRng): { screenWidth: number; screenHeight: number; viewportWidth: number; viewportHeight: number; pixelRatio: number } {
  // Weighted resolution pool — StatCounter global desktop Q1-2025.
  // [width, height, weight, pixelRatio]
  const screens: Array<[number, number, number, number]> = [
    [1920, 1080, 30, 1.0],
    [1920, 1080, 10, 1.25],
    [2560, 1440, 14, 1.0],
    [2560, 1440,  6, 1.5],
    [1366,  768,  8, 1.0],
    [1536,  864,  6, 1.25],
    [1440,  900,  4, 1.0],
    [1280,  800,  3, 1.0],
    [3840, 2160,  5, 2.0],
    [3840, 2160,  3, 1.5],
    [2560, 1600,  4, 2.0],
    [2880, 1800,  3, 2.0],
    [1680, 1050,  2, 1.0],
    [1600,  900,  2, 1.0],
  ];

  const total = screens.reduce((s, r) => s + r[2], 0);
  let pick = rng.gen(total);
  const chosen = screens.find(([,, w]) => { if (pick < w) return true; pick -= w; return false; }) ?? screens[0];
  const [screenWidth, screenHeight,, pixelRatio] = chosen;

  // Browser chrome height: 72-96 px (Chrome version + OS specific)
  const chromeHeight = 72 + rng.gen(25);
  // Taskbar: 36-47 px (Windows/Linux)
  const taskbarHeight = 36 + rng.gen(12);
  const viewportHeight = Math.max(600, screenHeight - chromeHeight - taskbarHeight);

  return {
    screenWidth,
    screenHeight,
    viewportWidth: screenWidth,
    viewportHeight,
    pixelRatio,
  };
}

function buildFontSubset(rng: SeededRng, os: 'windows' | 'macos' | 'linux'): string[] {
  const base = [
    'Arial',
    'Arial Black',
    'Comic Sans MS',
    'Courier New',
    'Georgia',
    'Impact',
    'Times New Roman',
    'Trebuchet MS',
    'Verdana',
    'Webdings',
  ];

  const extras =
    os === 'macos'
      ? ['Helvetica', 'Helvetica Neue', 'Gill Sans', 'Optima', 'Palatino', 'Futura', 'Menlo', 'Monaco', 'Apple Chancery']
      : os === 'linux'
        ? ['Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'DejaVu Sans', 'DejaVu Serif', 'Ubuntu', 'Cantarell', 'Noto Sans']
        : [
            'Calibri',
            'Cambria',
            'Candara',
            'Consolas',
            'Constantia',
            'Corbel',
            'Franklin Gothic Medium',
            'Gabriola',
            'Segoe UI',
            'Tahoma',
            'Microsoft Sans Serif',
            'Palatino Linotype',
          ];

  const subset = [...base];
  for (const font of extras) {
    if (rng.genBool(0.75)) {
      subset.push(font);
    }
  }

  return rng.shuffle(subset);
}

function pickLocale(rng: SeededRng): { locale: string; acceptLanguage: string; timezone: string } {
  const options: Array<[string, string, string]> = [
    ['en-US', 'en-US,en;q=0.9', 'America/New_York'],
    ['en-US', 'en-US,en;q=0.9', 'America/Chicago'],
    ['en-US', 'en-US,en;q=0.9', 'America/Los_Angeles'],
    ['en-US', 'en-US,en;q=0.9', 'America/Denver'],
    ['en-GB', 'en-GB,en;q=0.9', 'Europe/London'],
    ['en-AU', 'en-AU,en;q=0.9', 'Australia/Sydney'],
    ['en-CA', 'en-CA,en;q=0.9,fr-CA;q=0.8', 'America/Toronto'],
    ['de-DE', 'de-DE,de;q=0.9,en;q=0.8', 'Europe/Berlin'],
    ['fr-FR', 'fr-FR,fr;q=0.9,en;q=0.8', 'Europe/Paris'],
    ['es-ES', 'es-ES,es;q=0.9,en;q=0.8', 'Europe/Madrid'],
    ['nl-NL', 'nl-NL,nl;q=0.9,en;q=0.8', 'Europe/Amsterdam'],
    ['pl-PL', 'pl-PL,pl;q=0.9,en;q=0.8', 'Europe/Warsaw'],
    ['pt-BR', 'pt-BR,pt;q=0.9,en;q=0.8', 'America/Sao_Paulo'],
    ['ja-JP', 'ja-JP,ja;q=0.9,en;q=0.8', 'Asia/Tokyo'],
    ['ko-KR', 'ko-KR,ko;q=0.9,en;q=0.8', 'Asia/Seoul'],
  ];

  const [locale, acceptLanguage, timezone] = rng.pick(options);
  return { locale, acceptLanguage, timezone };
}

function generateMdnsHostname(rng: SeededRng): string {
  const a = rng.next();
  const b = rng.next();
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}.local`;
}

function generateFakeLocalIp(rng: SeededRng): string {
  const third = rng.genRange(1, 255);
  const fourth = rng.genRange(2, 255);
  return `192.168.${third}.${fourth}`;
}

function defaultPermissions(): Record<string, string> {
  return {
    geolocation: 'prompt',
    notifications: 'prompt',
    camera: 'prompt',
    microphone: 'prompt',
    'clipboard-read': 'prompt',
    'clipboard-write': 'granted',
    'payment-handler': 'prompt',
    accelerometer: 'granted',
    gyroscope: 'granted',
    magnetometer: 'granted',
    push: 'prompt',
    midi: 'prompt',
    'storage-access': 'prompt',
  };
}

// ── Main fingerprint generator ────────────────────────────────────────────

export function generateFingerprintFallback(seedInput?: number): Fingerprint {
  const seed = seedInput ?? Math.floor(Math.random() * 0xffffffff);
  const rng = new SeededRng(seed);

  const os = pickOs(rng);
  const ua = buildUa(rng, os);
  const uaBrands = buildUaBrands(rng, ua.userAgent);
  const webgl = pickWebgl(rng, os);
  const screen = pickScreen(rng);
  const fontSubset = buildFontSubset(rng, os);
  const locale = pickLocale(rng);

  const hardwareConcurrency = [2, 4, 4, 8, 8, 8, 16][rng.gen(7)] || 4;
  const deviceMemory = [0.5, 1.0, 2.0, 4.0, 4.0, 8.0][rng.gen(6)] || 4.0;

  const canvasNoise = 0.01 + rng.genFloat() * 0.14;
  const webglNoise = 0.01 + rng.genFloat() * 0.09;
  const audioNoise = 0.001 + rng.genFloat() * 0.009;

  return {
    seed,
    canvas_noise: canvasNoise,
    webgl_vendor: webgl.vendor,
    webgl_renderer: webgl.renderer,
    webgl_noise: webglNoise,
    audio_noise: audioNoise,
    font_subset: fontSubset,
    user_agent: ua.userAgent,
    platform: ua.platform,
    accept_language: locale.acceptLanguage,
    hardware_concurrency: hardwareConcurrency,
    device_memory: deviceMemory,
    screen_width: screen.screenWidth,
    screen_height: screen.screenHeight,
    viewport_width: screen.viewportWidth,
    viewport_height: screen.viewportHeight,
    color_depth: 24,
    pixel_ratio: screen.pixelRatio,
    webrtc_mode: 'fake_mdns',
    webrtc_fake_mdns: generateMdnsHostname(rng),
    webrtc_fake_ip: generateFakeLocalIp(rng),
    timezone: locale.timezone,
    locale: locale.locale,
    ua_brands: uaBrands,
    ua_mobile: false,
    ua_platform: ua.uaPlatform,
    ua_platform_version: ua.uaPlatformVersion,
    ua_architecture: ua.uaArchitecture,
    ua_bitness: ua.uaBitness,
    permissions: defaultPermissions(),
  };
}
