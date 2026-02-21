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
  const chromeMajor = rng.genRange(120, 132);
  const chromeMinor = rng.genRange(0, 10000);
  const chromeBuild = rng.genRange(0, 1000);

  if (os === 'macos') {
    const macVer = `10_${rng.genRange(14, 16)}_${rng.genRange(0, 7)}`;
    const ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macVer}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${chromeMinor}.${chromeBuild} Safari/537.36`;
    const platformVer = `${rng.genRange(14, 16)}.${rng.genRange(0, 7)}.0`;
    return {
      userAgent: ua,
      platform: 'MacIntel',
      uaPlatform: 'macOS',
      uaPlatformVersion: platformVer,
      uaArchitecture: 'x86',
      uaBitness: '64',
    };
  }

  if (os === 'linux') {
    const ua = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${chromeMinor}.${chromeBuild} Safari/537.36`;
    return {
      userAgent: ua,
      platform: 'Linux x86_64',
      uaPlatform: 'Linux',
      uaPlatformVersion: '6.1.0',
      uaArchitecture: 'x86',
      uaBitness: '64',
    };
  }

  // Windows
  const winBuild = rng.genRange(19041, 22632);
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
  const major = match ? parseInt(match[1], 10) : 124;

  const greaseChars = [' ', '(', ')', '-', '.', '/'];
  const gc = rng.pick(greaseChars);
  const gv = rng.genRange(1, 100);

  return [
    { brand: `Not${gc}A)Brand`, version: String(gv) },
    { brand: 'Chromium', version: String(major) },
    { brand: 'Google Chrome', version: String(major) },
  ];
}

function pickWebgl(rng: SeededRng, os: 'windows' | 'macos' | 'linux'): { vendor: string; renderer: string } {
  const options: Array<[string, string]> =
    os === 'macos'
      ? [
          ['Apple', 'Apple M1'],
          ['Apple', 'Apple M2'],
          ['Apple', 'Apple M3'],
          ['Intel Inc.', 'Intel(R) Iris(TM) Plus Graphics 640'],
          ['Intel Inc.', 'Intel(R) UHD Graphics 630'],
        ]
      : os === 'linux'
        ? [
            ['Mesa/X.org', 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)'],
            ['Mesa/X.org', 'Mesa Intel(R) HD Graphics 630 (KBL GT2)'],
            ['Intel Open Source Technology Center', 'Mesa DRI Intel(R) HD Graphics 620 (Kaby Lake GT2)'],
          ]
        : [
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
          ];

  const [vendor, renderer] = rng.pick(options);
  return { vendor, renderer };
}

function pickScreen(rng: SeededRng): { screenWidth: number; screenHeight: number; viewportWidth: number; viewportHeight: number; pixelRatio: number } {
  const screens: Array<[number, number]> = [
    [1920, 1080],
    [1920, 1080],
    [2560, 1440],
    [1366, 768],
    [1440, 900],
    [1280, 800],
    [3840, 2160],
    [2560, 1600],
  ];
  const pixelRatios = [1.0, 1.0, 1.25, 1.5, 2.0];

  const [screenWidth, screenHeight] = rng.pick(screens);
  const pixelRatio = rng.pick(pixelRatios);

  const chromeHeight = 88 + rng.gen(20);
  const taskbarHeight = 40 + rng.gen(8);
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
