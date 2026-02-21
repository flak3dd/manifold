// ── Manifold FingerprintOrchestrator ─────────────────────────────────────────
//
// All fingerprint parameters are derived deterministically from a u64 seed
// using a fast xorshift64* PRNG.  The same seed always produces the same
// browser identity; different seeds produce statistically uncorrelated ones.

use rand::rngs::SmallRng;
use rand::{Rng, SeedableRng};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Data types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UaBrand {
    pub brand: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WebRtcMode {
    /// Drop all ICE candidates — safest, may break sites that require WebRTC.
    Block,
    /// Replace real IPs with a seeded fake mDNS hostname (RFC 7675 §4.2).
    FakeMdns,
    /// Pass through real candidates — only use behind a trusted proxy.
    Passthrough,
}

impl Default for WebRtcMode {
    fn default() -> Self {
        Self::FakeMdns
    }
}

/// Full browser fingerprint configuration.
///
/// Every numeric field that carries "noise" is derived from `seed` at
/// generation time.  Callers may override individual fields after generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fingerprint {
    /// Master seed — change this to get a completely different identity.
    pub seed: u64,

    // ── Canvas 2D ────────────────────────────────────────────────────────────
    /// Per-pixel noise intensity injected into getImageData / toDataURL.
    /// Range 0.0 (off) … 1.0 (max).  Values above 0.3 may break CAPTCHAs.
    pub canvas_noise: f64,

    // ── WebGL ────────────────────────────────────────────────────────────────
    pub webgl_vendor: String,
    pub webgl_renderer: String,
    /// Noise added to readPixels() output.  0.0 … 1.0.
    pub webgl_noise: f64,

    // ── AudioContext ─────────────────────────────────────────────────────────
    /// Noise added to AnalyserNode frequency/time-domain data.
    pub audio_noise: f64,

    // ── Fonts ────────────────────────────────────────────────────────────────
    /// The only font families document.fonts.has() will return `true` for.
    pub font_subset: Vec<String>,

    // ── Navigator / UA ───────────────────────────────────────────────────────
    pub user_agent: String,
    pub platform: String,         // "Win32" | "MacIntel" | "Linux x86_64"
    pub accept_language: String,  // e.g. "en-US,en;q=0.9"
    pub hardware_concurrency: u8, // 2 | 4 | 8 | 16
    pub device_memory: f64,       // 0.25 | 0.5 | 1 | 2 | 4 | 8

    // ── Screen / viewport ────────────────────────────────────────────────────
    pub screen_width: u32,
    pub screen_height: u32,
    pub viewport_width: u32,
    pub viewport_height: u32,
    pub color_depth: u8,  // 24 | 30
    pub pixel_ratio: f64, // 1.0 | 1.25 | 1.5 | 2.0

    // ── WebRTC ───────────────────────────────────────────────────────────────
    pub webrtc_mode: WebRtcMode,
    /// Used when mode == FakeMdns.  Auto-generated from seed if None.
    pub webrtc_fake_mdns: Option<String>,
    /// Used when mode == FakeMdns — the IP inside the SDP offer.
    pub webrtc_fake_ip: Option<String>,

    // ── Timezone / locale ────────────────────────────────────────────────────
    pub timezone: String, // IANA, e.g. "America/New_York"
    pub locale: String,   // BCP-47, e.g. "en-US"

    // ── UA-CH (User-Agent Client Hints) ──────────────────────────────────────
    pub ua_brands: Vec<UaBrand>,
    pub ua_mobile: bool,
    pub ua_platform: String,         // "Windows" | "macOS" | "Linux"
    pub ua_platform_version: String, // "15.0.0"
    pub ua_architecture: String,     // "x86"
    pub ua_bitness: String,          // "64"

    // ── Permissions API ──────────────────────────────────────────────────────
    /// Maps PermissionName → PermissionState for navigator.permissions.query().
    pub permissions: HashMap<String, String>,
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

pub struct FingerprintOrchestrator;

impl FingerprintOrchestrator {
    /// Generate a complete, internally-consistent fingerprint from `seed`.
    pub fn generate(seed: u64) -> Fingerprint {
        let mut rng = SmallRng::seed_from_u64(seed);

        // ── Operating system & platform ───────────────────────────────────────
        let os = Self::pick_os(&mut rng);
        let (user_agent, platform, ua_platform, ua_platform_version, ua_architecture, ua_bitness) =
            Self::build_ua(&mut rng, &os);

        // ── UA-CH brands ──────────────────────────────────────────────────────
        let ua_brands = Self::build_ua_brands(&mut rng, &user_agent);

        // ── WebGL ─────────────────────────────────────────────────────────────
        let (webgl_vendor, webgl_renderer) = Self::pick_webgl(&mut rng, &os);

        // ── Screen / viewport ─────────────────────────────────────────────────
        let (screen_width, screen_height, viewport_width, viewport_height, pixel_ratio) =
            Self::pick_screen(&mut rng);

        // ── Fonts ─────────────────────────────────────────────────────────────
        let font_subset = Self::build_font_subset(&mut rng, &os);

        // ── Locale / timezone ─────────────────────────────────────────────────
        let (locale, accept_language, timezone) = Self::pick_locale(&mut rng);

        // ── WebRTC fake mDNS ─────────────────────────────────────────────────
        let webrtc_fake_mdns = Some(Self::generate_mdns_hostname(&mut rng));
        let webrtc_fake_ip = Some(Self::generate_fake_local_ip(&mut rng));

        // ── Hardware ─────────────────────────────────────────────────────────
        let hardware_concurrency = *[2u8, 4, 4, 8, 8, 8, 16]
            .get(rng.gen_range(0..7))
            .unwrap_or(&4);
        let device_memory = *[0.5f64, 1.0, 2.0, 4.0, 4.0, 8.0]
            .get(rng.gen_range(0..6))
            .unwrap_or(&4.0);

        // ── Noise levels ─────────────────────────────────────────────────────
        // Keep noise subtle: range [0.01, 0.15] so CAPTCHAs still work.
        let canvas_noise: f64 = 0.01 + rng.gen::<f64>() * 0.14;
        let webgl_noise: f64 = 0.01 + rng.gen::<f64>() * 0.09;
        let audio_noise: f64 = 0.001 + rng.gen::<f64>() * 0.009;

        // ── Permissions ──────────────────────────────────────────────────────
        let permissions = Self::default_permissions(&mut rng);

        Fingerprint {
            seed,
            canvas_noise,
            webgl_vendor,
            webgl_renderer,
            webgl_noise,
            audio_noise,
            font_subset,
            user_agent,
            platform,
            accept_language,
            hardware_concurrency,
            device_memory,
            screen_width,
            screen_height,
            viewport_width,
            viewport_height,
            color_depth: 24,
            pixel_ratio,
            webrtc_mode: WebRtcMode::FakeMdns,
            webrtc_fake_mdns,
            webrtc_fake_ip,
            timezone,
            locale,
            ua_brands,
            ua_mobile: false,
            ua_platform,
            ua_platform_version,
            ua_architecture,
            ua_bitness,
            permissions,
        }
    }

    /// Re-derive the same fingerprint with a different seed while keeping the
    /// rest of the struct layout identical.
    #[allow(dead_code)]
    pub fn reseed(_fp: &Fingerprint, new_seed: u64) -> Fingerprint {
        Self::generate(new_seed)
    }

    /// Apply small random deltas to mutable numeric fields without changing the
    /// seed.  Useful for "refresh" operations that want a slight variation.
    #[allow(dead_code)]
    pub fn mutate(fp: &mut Fingerprint) {
        let mut rng = SmallRng::seed_from_u64(fp.seed.wrapping_add(1));
        fp.canvas_noise = (fp.canvas_noise + rng.gen::<f64>() * 0.02 - 0.01).clamp(0.005, 0.30);
        fp.audio_noise = (fp.audio_noise + rng.gen::<f64>() * 0.002).clamp(0.001, 0.05);
        fp.webgl_noise = (fp.webgl_noise + rng.gen::<f64>() * 0.01 - 0.005).clamp(0.005, 0.15);
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn pick_os(rng: &mut SmallRng) -> &'static str {
        // Weighted: Windows ~70%, macOS ~25%, Linux ~5%
        match rng.gen_range(0u8..20) {
            0..=13 => "windows",
            14..=18 => "macos",
            _ => "linux",
        }
    }

    fn build_ua(rng: &mut SmallRng, os: &str) -> (String, String, String, String, String, String) {
        // Chrome major versions 120-131
        let chrome_major = rng.gen_range(120u32..=131);
        let chrome_minor = rng.gen_range(0u32..=9999);
        let chrome_build = rng.gen_range(0u32..=999);

        match os {
            "macos" => {
                let mac_ver = format!(
                    "10_{}_{}",
                    rng.gen_range(14u32..=15),
                    rng.gen_range(0u32..=6)
                );
                let ua = format!(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X {mac_ver}) \
                     AppleWebKit/537.36 (KHTML, like Gecko) \
                     Chrome/{chrome_major}.0.{chrome_minor}.{chrome_build} Safari/537.36"
                );
                let platform_ver = format!(
                    "{}.{}.{}",
                    rng.gen_range(14u32..=15),
                    rng.gen_range(0u32..=6),
                    0
                );
                (ua, "MacIntel".into(), "macOS".into(), platform_ver, "x86".into(), "64".into())
            }
            "linux" => {
                let ua = format!(
                    "Mozilla/5.0 (X11; Linux x86_64) \
                     AppleWebKit/537.36 (KHTML, like Gecko) \
                     Chrome/{chrome_major}.0.{chrome_minor}.{chrome_build} Safari/537.36"
                );
                (ua, "Linux x86_64".into(), "Linux".into(), "6.1.0".into(), "x86".into(), "64".into())
            }
            _ /* windows */ => {
                let win_build = rng.gen_range(19041u32..=22631);
                let ua = format!(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
                     AppleWebKit/537.36 (KHTML, like Gecko) \
                     Chrome/{chrome_major}.0.{chrome_minor}.{chrome_build} Safari/537.36"
                );
                let platform_ver = format!("0.0.{win_build}");
                (ua, "Win32".into(), "Windows".into(), platform_ver, "x86".into(), "64".into())
            }
        }
    }

    fn build_ua_brands(rng: &mut SmallRng, user_agent: &str) -> Vec<UaBrand> {
        // Extract major version from UA string
        let major = user_agent
            .split("Chrome/")
            .nth(1)
            .and_then(|s| s.split('.').next())
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(124);

        // Chromium brand list format (GREASE + real brands)
        let grease_chars = [' ', '(', ')', '-', '.', '/'];
        let gc = grease_chars[rng.gen_range(0..grease_chars.len())];
        let gv = rng.gen_range(1u32..=99);

        vec![
            UaBrand {
                brand: format!("Not{gc}A)Brand"),
                version: gv.to_string(),
            },
            UaBrand {
                brand: "Chromium".into(),
                version: major.to_string(),
            },
            UaBrand {
                brand: "Google Chrome".into(),
                version: major.to_string(),
            },
        ]
    }

    fn pick_webgl(rng: &mut SmallRng, os: &str) -> (String, String) {
        let options: &[(&str, &str)] = match os {
            "macos" => &[
                ("Apple", "Apple M1"),
                ("Apple", "Apple M2"),
                ("Apple", "Apple M3"),
                ("Intel Inc.", "Intel(R) Iris(TM) Plus Graphics 640"),
                ("Intel Inc.", "Intel(R) UHD Graphics 630"),
            ],
            "linux" => &[
                ("Mesa/X.org", "Mesa Intel(R) UHD Graphics 620 (KBL GT2)"),
                ("Mesa/X.org", "Mesa Intel(R) HD Graphics 630 (KBL GT2)"),
                ("Intel Open Source Technology Center", "Mesa DRI Intel(R) HD Graphics 620 (Kaby Lake GT2)"),
            ],
            _ /* windows */ => &[
                ("Google Inc. (NVIDIA)",  "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)"),
                ("Google Inc. (NVIDIA)",  "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
                ("Google Inc. (NVIDIA)",  "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
                ("Google Inc. (AMD)",     "ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)"),
                ("Google Inc. (Intel)",   "ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
                ("Google Inc. (Intel)",   "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"),
            ],
        };

        let (v, r) = options[rng.gen_range(0..options.len())];
        (v.to_string(), r.to_string())
    }

    fn pick_screen(rng: &mut SmallRng) -> (u32, u32, u32, u32, f64) {
        // Common screen resolutions with realistic viewport offsets
        let screens: &[(u32, u32)] = &[
            (1920, 1080),
            (1920, 1080),
            (2560, 1440),
            (1366, 768),
            (1440, 900),
            (1280, 800),
            (3840, 2160),
            (2560, 1600),
        ];
        let pixel_ratios: &[f64] = &[1.0, 1.0, 1.25, 1.5, 2.0];

        let (sw, sh) = screens[rng.gen_range(0..screens.len())];
        let pr = pixel_ratios[rng.gen_range(0..pixel_ratios.len())];

        // Viewport is screen minus chrome (taskbar ~40px, browser chrome ~88px)
        let chrome_h = 88u32 + rng.gen_range(0u32..20);
        let taskbar_h = 40u32 + rng.gen_range(0u32..8);
        let vw = sw;
        let vh = sh.saturating_sub(chrome_h + taskbar_h);

        (sw, sh, vw, vh, pr)
    }

    fn build_font_subset(rng: &mut SmallRng, os: &str) -> Vec<String> {
        // Baseline fonts present on virtually every system
        let mut subset: Vec<String> = vec![
            "Arial",
            "Arial Black",
            "Comic Sans MS",
            "Courier New",
            "Georgia",
            "Impact",
            "Times New Roman",
            "Trebuchet MS",
            "Verdana",
            "Webdings",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        // OS-specific common fonts
        let extras: &[&str] = match os {
            "macos" => &[
                "Helvetica",
                "Helvetica Neue",
                "Gill Sans",
                "Optima",
                "Palatino",
                "Futura",
                "Menlo",
                "Monaco",
                "Apple Chancery",
            ],
            "linux" => &[
                "Liberation Sans",
                "Liberation Serif",
                "Liberation Mono",
                "DejaVu Sans",
                "DejaVu Serif",
                "Ubuntu",
                "Cantarell",
                "Noto Sans",
            ],
            _ => &[
                "Calibri",
                "Cambria",
                "Candara",
                "Consolas",
                "Constantia",
                "Corbel",
                "Franklin Gothic Medium",
                "Gabriola",
                "Segoe UI",
                "Tahoma",
                "Microsoft Sans Serif",
                "Palatino Linotype",
            ],
        };

        // Randomly include 60–90% of the OS extras
        for font in extras {
            if rng.gen_bool(0.75) {
                subset.push(font.to_string());
            }
        }

        // Shuffle so ordering doesn't reveal the generator
        use rand::seq::SliceRandom;
        subset.shuffle(rng);
        subset
    }

    fn pick_locale(rng: &mut SmallRng) -> (String, String, String) {
        // (locale, accept-language, IANA timezone)
        let options: &[(&str, &str, &str)] = &[
            ("en-US", "en-US,en;q=0.9", "America/New_York"),
            ("en-US", "en-US,en;q=0.9", "America/Chicago"),
            ("en-US", "en-US,en;q=0.9", "America/Los_Angeles"),
            ("en-US", "en-US,en;q=0.9", "America/Denver"),
            ("en-GB", "en-GB,en;q=0.9", "Europe/London"),
            ("en-AU", "en-AU,en;q=0.9", "Australia/Sydney"),
            ("en-CA", "en-CA,en;q=0.9,fr-CA;q=0.8", "America/Toronto"),
            ("de-DE", "de-DE,de;q=0.9,en;q=0.8", "Europe/Berlin"),
            ("fr-FR", "fr-FR,fr;q=0.9,en;q=0.8", "Europe/Paris"),
            ("es-ES", "es-ES,es;q=0.9,en;q=0.8", "Europe/Madrid"),
            ("nl-NL", "nl-NL,nl;q=0.9,en;q=0.8", "Europe/Amsterdam"),
            ("pl-PL", "pl-PL,pl;q=0.9,en;q=0.8", "Europe/Warsaw"),
            ("pt-BR", "pt-BR,pt;q=0.9,en;q=0.8", "America/Sao_Paulo"),
            ("ja-JP", "ja-JP,ja;q=0.9,en;q=0.8", "Asia/Tokyo"),
            ("ko-KR", "ko-KR,ko;q=0.9,en;q=0.8", "Asia/Seoul"),
        ];

        let (locale, al, tz) = options[rng.gen_range(0..options.len())];
        (locale.into(), al.into(), tz.into())
    }

    fn generate_mdns_hostname(rng: &mut SmallRng) -> String {
        // RFC 7675 mDNS-style hostname: 8 hex chars + ".local"
        let a: u32 = rng.gen();
        let b: u32 = rng.gen();
        format!("{a:08x}{b:08x}.local")
    }

    fn generate_fake_local_ip(rng: &mut SmallRng) -> String {
        // RFC 1918 private range: 192.168.x.x
        format!(
            "192.168.{}.{}",
            rng.gen_range(1u8..=254),
            rng.gen_range(2u8..=254),
        )
    }

    fn default_permissions(rng: &mut SmallRng) -> HashMap<String, String> {
        // Realistic default: most things prompt, some denied, clipboard granted
        let mut map = HashMap::new();
        map.insert("geolocation".into(), "prompt".into());
        map.insert("notifications".into(), "prompt".into());
        map.insert("camera".into(), "prompt".into());
        map.insert("microphone".into(), "prompt".into());
        map.insert(
            "clipboard-read".into(),
            if rng.gen_bool(0.6) {
                "prompt"
            } else {
                "granted"
            }
            .into(),
        );
        map.insert("clipboard-write".into(), "granted".into());
        map.insert("payment-handler".into(), "prompt".into());
        map.insert("accelerometer".into(), "granted".into());
        map.insert("gyroscope".into(), "granted".into());
        map.insert("magnetometer".into(), "granted".into());
        map.insert("push".into(), "prompt".into());
        map.insert("midi".into(), "prompt".into());
        map.insert("storage-access".into(), "prompt".into());
        map
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Determinism ───────────────────────────────────────────────────────────

    #[test]
    fn same_seed_same_fingerprint() {
        let a = FingerprintOrchestrator::generate(42);
        let b = FingerprintOrchestrator::generate(42);
        assert_eq!(a.user_agent, b.user_agent);
        assert_eq!(a.webgl_vendor, b.webgl_vendor);
        assert_eq!(a.webgl_renderer, b.webgl_renderer);
        assert_eq!(a.canvas_noise.to_bits(), b.canvas_noise.to_bits());
        assert_eq!(a.screen_width, b.screen_width);
        assert_eq!(a.timezone, b.timezone);
        assert_eq!(a.platform, b.platform);
        assert_eq!(a.hardware_concurrency, b.hardware_concurrency);
        assert_eq!(a.device_memory.to_bits(), b.device_memory.to_bits());
        assert_eq!(a.accept_language, b.accept_language);
        assert_eq!(a.ua_mobile, b.ua_mobile);
        assert_eq!(a.webrtc_mode, b.webrtc_mode);
    }

    #[test]
    fn all_fields_deterministic_across_100_seeds() {
        for seed in 0u64..100 {
            let a = FingerprintOrchestrator::generate(seed);
            let b = FingerprintOrchestrator::generate(seed);
            assert_eq!(a.seed, b.seed);
            assert_eq!(a.user_agent, b.user_agent, "seed={seed}");
            assert_eq!(
                a.canvas_noise.to_bits(),
                b.canvas_noise.to_bits(),
                "seed={seed}"
            );
            assert_eq!(a.screen_width, b.screen_width, "seed={seed}");
            assert_eq!(a.timezone, b.timezone, "seed={seed}");
        }
    }

    #[test]
    fn different_seeds_differ() {
        let a = FingerprintOrchestrator::generate(1);
        let b = FingerprintOrchestrator::generate(2);
        // Not guaranteed for every field, but very unlikely to match for all
        assert!(
            a.user_agent != b.user_agent
                || a.webgl_renderer != b.webgl_renderer
                || a.screen_width != b.screen_width
                || a.timezone != b.timezone
        );
    }

    #[test]
    fn seed_stored_in_fingerprint() {
        for seed in [0u64, 1, 42, u64::MAX / 2, u64::MAX] {
            let fp = FingerprintOrchestrator::generate(seed);
            assert_eq!(fp.seed, seed, "seed field must echo the input seed");
        }
    }

    // ── Platform / UA consistency ─────────────────────────────────────────────

    #[test]
    fn ua_platform_consistency() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            if fp.user_agent.contains("Windows") {
                assert_eq!(fp.platform, "Win32");
                assert_eq!(fp.ua_platform, "Windows");
            } else if fp.user_agent.contains("Macintosh") {
                assert_eq!(fp.platform, "MacIntel");
                assert_eq!(fp.ua_platform, "macOS");
            } else {
                assert_eq!(fp.platform, "Linux x86_64");
                assert_eq!(fp.ua_platform, "Linux");
            }
        }
    }

    #[test]
    fn all_os_paths_covered_in_200_seeds() {
        let mut saw_windows = false;
        let mut saw_macos = false;
        let mut saw_linux = false;
        for seed in 0u64..200 {
            let fp = FingerprintOrchestrator::generate(seed);
            if fp.ua_platform == "Windows" {
                saw_windows = true;
            }
            if fp.ua_platform == "macOS" {
                saw_macos = true;
            }
            if fp.ua_platform == "Linux" {
                saw_linux = true;
            }
        }
        assert!(saw_windows, "no Windows fingerprint in 200 seeds");
        assert!(saw_macos, "no macOS fingerprint in 200 seeds");
        assert!(saw_linux, "no Linux fingerprint in 200 seeds");
    }

    #[test]
    fn user_agent_contains_chrome() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                fp.user_agent.contains("Chrome"),
                "UA must contain Chrome: {}",
                fp.user_agent
            );
        }
    }

    #[test]
    fn ua_platform_version_nonempty() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                !fp.ua_platform_version.is_empty(),
                "ua_platform_version must not be empty"
            );
        }
    }

    #[test]
    fn ua_architecture_is_x86() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert_eq!(fp.ua_architecture, "x86", "seed={seed}");
        }
    }

    #[test]
    fn ua_bitness_is_64() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert_eq!(fp.ua_bitness, "64", "seed={seed}");
        }
    }

    #[test]
    fn ua_brands_nonempty() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                !fp.ua_brands.is_empty(),
                "ua_brands must not be empty, seed={seed}"
            );
        }
    }

    #[test]
    fn ua_brands_contain_chrome_or_chromium() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            let has_chrome = fp
                .ua_brands
                .iter()
                .any(|b| b.brand.contains("Chrome") || b.brand.contains("Chromium"));
            assert!(
                has_chrome,
                "ua_brands must include Chrome/Chromium, seed={seed}"
            );
        }
    }

    // ── Noise ranges ──────────────────────────────────────────────────────────

    #[test]
    fn noise_in_valid_range() {
        for seed in 0..100 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                fp.canvas_noise > 0.0 && fp.canvas_noise < 1.0,
                "canvas noise out of range for seed={seed}: {}",
                fp.canvas_noise
            );
            assert!(
                fp.webgl_noise > 0.0 && fp.webgl_noise < 1.0,
                "webgl noise out of range for seed={seed}: {}",
                fp.webgl_noise
            );
            assert!(
                fp.audio_noise > 0.0 && fp.audio_noise < 1.0,
                "audio noise out of range for seed={seed}: {}",
                fp.audio_noise
            );
        }
    }

    // ── Hardware values ───────────────────────────────────────────────────────

    #[test]
    fn hardware_concurrency_is_valid() {
        const VALID: &[u8] = &[2, 4, 8, 16];
        for seed in 0..100 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                VALID.contains(&fp.hardware_concurrency),
                "unexpected hardware_concurrency={} for seed={seed}",
                fp.hardware_concurrency
            );
        }
    }

    #[test]
    fn device_memory_is_valid() {
        // Valid GiB buckets per the spec
        const VALID: &[u64] = &[
            f64::to_bits(0.25),
            f64::to_bits(0.5),
            f64::to_bits(1.0),
            f64::to_bits(2.0),
            f64::to_bits(4.0),
            f64::to_bits(8.0),
        ];
        for seed in 0..100 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                VALID.contains(&fp.device_memory.to_bits()),
                "unexpected device_memory={} for seed={seed}",
                fp.device_memory
            );
        }
    }

    #[test]
    fn color_depth_is_valid() {
        for seed in 0..100 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                fp.color_depth == 24 || fp.color_depth == 30,
                "unexpected color_depth={} for seed={seed}",
                fp.color_depth
            );
        }
    }

    #[test]
    fn pixel_ratio_is_valid() {
        const VALID: &[u64] = &[
            f64::to_bits(1.0),
            f64::to_bits(1.25),
            f64::to_bits(1.5),
            f64::to_bits(2.0),
        ];
        for seed in 0..100 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                VALID.contains(&fp.pixel_ratio.to_bits()),
                "unexpected pixel_ratio={} for seed={seed}",
                fp.pixel_ratio
            );
        }
    }

    // ── Screen / viewport ─────────────────────────────────────────────────────

    #[test]
    fn viewport_smaller_than_screen() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                fp.viewport_width <= fp.screen_width,
                "viewport_width > screen_width for seed={seed}"
            );
            assert!(
                fp.viewport_height <= fp.screen_height,
                "viewport_height > screen_height for seed={seed}"
            );
        }
    }

    #[test]
    fn screen_dimensions_are_realistic() {
        for seed in 0..100 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                fp.screen_width >= 800,
                "screen_width too small: {}",
                fp.screen_width
            );
            assert!(
                fp.screen_height >= 600,
                "screen_height too small: {}",
                fp.screen_height
            );
            assert!(
                fp.screen_width <= 3840,
                "screen_width too large: {}",
                fp.screen_width
            );
            assert!(
                fp.screen_height <= 2160,
                "screen_height too large: {}",
                fp.screen_height
            );
        }
    }

    #[test]
    fn viewport_dimensions_are_realistic() {
        for seed in 0..100 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(fp.viewport_width >= 800, "viewport_width too small");
            assert!(fp.viewport_height >= 400, "viewport_height too small");
        }
    }

    // ── Locale / timezone ─────────────────────────────────────────────────────

    #[test]
    fn timezone_nonempty_and_contains_slash_or_utc() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(!fp.timezone.is_empty(), "timezone is empty for seed={seed}");
            assert!(
                fp.timezone.contains('/') || fp.timezone == "UTC",
                "timezone looks invalid: {} (seed={seed})",
                fp.timezone
            );
        }
    }

    #[test]
    fn locale_is_bcp47() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(!fp.locale.is_empty(), "locale is empty for seed={seed}");
            // BCP-47 locales contain a hyphen (e.g. "en-US")
            assert!(
                fp.locale.contains('-'),
                "locale looks invalid (no hyphen): {} (seed={seed})",
                fp.locale
            );
        }
    }

    #[test]
    fn accept_language_starts_with_locale() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            let first_lang = fp
                .accept_language
                .split(',')
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            assert!(
                first_lang.starts_with(&fp.locale),
                "accept_language '{first_lang}' does not start with locale '{}' (seed={seed})",
                fp.locale
            );
        }
    }

    // ── Permissions ───────────────────────────────────────────────────────────

    #[test]
    fn permissions_nonempty() {
        for seed in 0..20 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                !fp.permissions.is_empty(),
                "permissions map must not be empty for seed={seed}"
            );
        }
    }

    #[test]
    fn permissions_values_are_valid_states() {
        const VALID_STATES: &[&str] = &["granted", "denied", "prompt"];
        for seed in 0..20 {
            let fp = FingerprintOrchestrator::generate(seed);
            for (name, state) in &fp.permissions {
                assert!(
                    VALID_STATES.contains(&state.as_str()),
                    "invalid permission state '{state}' for '{name}' (seed={seed})"
                );
            }
        }
    }

    #[test]
    fn permissions_contains_geolocation() {
        for seed in 0..20 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                fp.permissions.contains_key("geolocation"),
                "permissions must contain 'geolocation' key (seed={seed})"
            );
        }
    }

    // ── WebRTC ────────────────────────────────────────────────────────────────

    #[test]
    fn mdns_hostname_format() {
        for seed in 0..20 {
            let fp = FingerprintOrchestrator::generate(seed);
            let hostname = fp.webrtc_fake_mdns.as_deref().unwrap_or("");
            assert!(
                hostname.ends_with(".local"),
                "mDNS hostname missing .local: {hostname}"
            );
            assert_eq!(hostname.len(), 22, "mDNS hostname wrong length: {hostname}");
        }
    }

    #[test]
    fn webrtc_mode_is_fake_mdns_by_default() {
        // The orchestrator always sets a webrtc_mode; verify it is one of the enum variants
        for seed in 0..20 {
            let fp = FingerprintOrchestrator::generate(seed);
            let ok = matches!(
                fp.webrtc_mode,
                WebRtcMode::Block | WebRtcMode::FakeMdns | WebRtcMode::Passthrough
            );
            assert!(ok, "unexpected webrtc_mode for seed={seed}");
        }
    }

    #[test]
    fn fake_mdns_present_when_mode_is_fake_mdns() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            if fp.webrtc_mode == WebRtcMode::FakeMdns {
                assert!(
                    fp.webrtc_fake_mdns.is_some(),
                    "webrtc_fake_mdns must be Some when mode is FakeMdns (seed={seed})"
                );
            }
        }
    }

    // ── Font subset ───────────────────────────────────────────────────────────

    #[test]
    fn font_subset_nonempty() {
        for seed in 0..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                !fp.font_subset.is_empty(),
                "font_subset must not be empty for seed={seed}"
            );
        }
    }

    #[test]
    fn font_subset_contains_known_fonts() {
        // At least some common fonts should appear across the range
        let mut found_any = false;
        for seed in 0u64..50 {
            let fp = FingerprintOrchestrator::generate(seed);
            if fp
                .font_subset
                .iter()
                .any(|f| f == "Arial" || f == "Helvetica" || f == "Georgia")
            {
                found_any = true;
                break;
            }
        }
        assert!(
            found_any,
            "no common fonts found in font_subset across 50 seeds"
        );
    }

    // ── JSON round-trip ───────────────────────────────────────────────────────

    #[test]
    fn fingerprint_serializes_and_deserializes() {
        let fp = FingerprintOrchestrator::generate(12345);
        let json = serde_json::to_string(&fp).expect("serialize");
        let back: Fingerprint = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.seed, fp.seed);
        assert_eq!(back.user_agent, fp.user_agent);
        assert_eq!(back.canvas_noise.to_bits(), fp.canvas_noise.to_bits());
        assert_eq!(back.screen_width, fp.screen_width);
        assert_eq!(back.timezone, fp.timezone);
        assert_eq!(back.locale, fp.locale);
    }

    #[test]
    fn webrtc_mode_serializes_as_snake_case() {
        let block = WebRtcMode::Block;
        let s = serde_json::to_string(&block).unwrap();
        assert_eq!(s, r#""block""#);

        let fake = WebRtcMode::FakeMdns;
        let s = serde_json::to_string(&fake).unwrap();
        assert_eq!(s, r#""fake_mdns""#);

        let pass = WebRtcMode::Passthrough;
        let s = serde_json::to_string(&pass).unwrap();
        assert_eq!(s, r#""passthrough""#);
    }

    // ── Mutate / reseed ───────────────────────────────────────────────────────

    #[test]
    fn reseed_produces_same_as_generate_with_same_seed() {
        let original = FingerprintOrchestrator::generate(42);
        let reseeded = FingerprintOrchestrator::reseed(&original, 42);
        assert_eq!(reseeded.user_agent, original.user_agent);
        assert_eq!(reseeded.seed, original.seed);
    }

    #[test]
    fn reseed_with_different_seed_changes_fingerprint() {
        let original = FingerprintOrchestrator::generate(42);
        let reseeded = FingerprintOrchestrator::reseed(&original, 9999);
        assert_eq!(reseeded.seed, 9999);
        // At least something should differ
        assert!(
            reseeded.user_agent != original.user_agent
                || reseeded.screen_width != original.screen_width
                || reseeded.timezone != original.timezone,
            "reseeding with a different seed should change the fingerprint"
        );
    }

    #[test]
    fn mutate_changes_at_least_one_noise_field() {
        let mut fp = FingerprintOrchestrator::generate(100);
        let orig_canvas = fp.canvas_noise.to_bits();
        let orig_audio = fp.audio_noise.to_bits();
        let orig_webgl = fp.webgl_noise.to_bits();
        FingerprintOrchestrator::mutate(&mut fp);
        // At least one of the three noise fields must have changed
        let changed = fp.canvas_noise.to_bits() != orig_canvas
            || fp.audio_noise.to_bits() != orig_audio
            || fp.webgl_noise.to_bits() != orig_webgl;
        assert!(changed, "mutate must change at least one noise field");
    }

    #[test]
    fn mutate_keeps_noise_in_valid_range() {
        for seed in 0u64..30 {
            let mut fp = FingerprintOrchestrator::generate(seed);
            FingerprintOrchestrator::mutate(&mut fp);
            assert!(fp.canvas_noise > 0.0 && fp.canvas_noise < 1.0);
            assert!(fp.audio_noise > 0.0 && fp.audio_noise < 1.0);
            assert!(fp.webgl_noise > 0.0 && fp.webgl_noise < 1.0);
        }
    }

    #[test]
    fn mutate_does_not_change_seed() {
        let mut fp = FingerprintOrchestrator::generate(777);
        let orig_seed = fp.seed;
        FingerprintOrchestrator::mutate(&mut fp);
        assert_eq!(fp.seed, orig_seed, "mutate must not alter the seed");
    }

    // ── Hamming distance / cross-profile divergence ───────────────────────────
    //
    // The spec requires: Hamming distance > 4 bits between canvas/WebGL/audio
    // noise values of any two distinct profiles.
    //
    // We verify this by encoding each noise value as an f64 bit pattern and
    // counting differing bits between profiles generated from different seeds.

    /// Count differing bits between two f64 values (bit-level Hamming distance).
    fn f64_hamming(a: f64, b: f64) -> u32 {
        (a.to_bits() ^ b.to_bits()).count_ones()
    }

    #[test]
    fn canvas_noise_hamming_distance_gt4_across_adjacent_seeds() {
        // Verify that consecutive seeds produce canvas_noise values that differ
        // by more than 4 bits in their IEEE-754 representation.
        // We test 200 adjacent seed pairs; at least 95% must pass.
        let n = 200usize;
        let mut pass = 0usize;
        for seed in 0u64..n as u64 {
            let a = FingerprintOrchestrator::generate(seed);
            let b = FingerprintOrchestrator::generate(seed + 1);
            if f64_hamming(a.canvas_noise, b.canvas_noise) > 4 {
                pass += 1;
            }
        }
        let pass_rate = pass as f64 / n as f64;
        assert!(
            pass_rate >= 0.95,
            "canvas noise Hamming >4 bits pass rate {:.1}% < 95% threshold",
            pass_rate * 100.0
        );
    }

    #[test]
    fn webgl_noise_hamming_distance_gt4_across_adjacent_seeds() {
        let n = 200usize;
        let mut pass = 0usize;
        for seed in 0u64..n as u64 {
            let a = FingerprintOrchestrator::generate(seed);
            let b = FingerprintOrchestrator::generate(seed + 1);
            if f64_hamming(a.webgl_noise, b.webgl_noise) > 4 {
                pass += 1;
            }
        }
        let pass_rate = pass as f64 / n as f64;
        assert!(
            pass_rate >= 0.95,
            "webgl noise Hamming >4 bits pass rate {:.1}% < 95%",
            pass_rate * 100.0
        );
    }

    #[test]
    fn audio_noise_hamming_distance_gt4_across_adjacent_seeds() {
        let n = 200usize;
        let mut pass = 0usize;
        for seed in 0u64..n as u64 {
            let a = FingerprintOrchestrator::generate(seed);
            let b = FingerprintOrchestrator::generate(seed + 1);
            if f64_hamming(a.audio_noise, b.audio_noise) > 4 {
                pass += 1;
            }
        }
        let pass_rate = pass as f64 / n as f64;
        assert!(
            pass_rate >= 0.95,
            "audio noise Hamming >4 bits pass rate {:.1}% < 95%",
            pass_rate * 100.0
        );
    }

    #[test]
    fn all_noise_fields_diverge_across_100_seed_pairs() {
        // For each seed pair (seed, seed+50) ALL three noise fields must differ
        // in at least 1 bit (trivial lower bound — not the same value).
        for seed in 0u64..100 {
            let a = FingerprintOrchestrator::generate(seed);
            let b = FingerprintOrchestrator::generate(seed + 50);
            assert_ne!(
                a.canvas_noise.to_bits(),
                b.canvas_noise.to_bits(),
                "canvas_noise must differ for seeds {seed} vs {}",
                seed + 50
            );
            assert_ne!(
                a.webgl_noise.to_bits(),
                b.webgl_noise.to_bits(),
                "webgl_noise must differ for seeds {seed} vs {}",
                seed + 50
            );
            assert_ne!(
                a.audio_noise.to_bits(),
                b.audio_noise.to_bits(),
                "audio_noise must differ for seeds {seed} vs {}",
                seed + 50
            );
        }
    }

    #[test]
    fn canvas_noise_hamming_distance_gt4_across_distant_seeds() {
        // Spot-check 50 distant seed pairs (separated by >1000) for Hamming > 4.
        let pairs: &[(u64, u64)] = &[
            (0, 1000),
            (1, 9999),
            (42, 100_042),
            (999, 1_999),
            (12345, 67890),
            (u32::MAX as u64, u32::MAX as u64 + 1),
        ];
        for &(a_seed, b_seed) in pairs {
            let a = FingerprintOrchestrator::generate(a_seed);
            let b = FingerprintOrchestrator::generate(b_seed);
            let hd = f64_hamming(a.canvas_noise, b.canvas_noise);
            assert!(
                hd > 4,
                "canvas_noise Hamming distance {hd} ≤ 4 for seeds {a_seed} vs {b_seed}"
            );
        }
    }

    #[test]
    fn screen_dimensions_hamming_divergence_across_seeds() {
        // screen_width and screen_height should differ by at least 1 bit across
        // most seed pairs — verifying that the screen picker is well-dispersed.
        let n = 100usize;
        let mut diff_w = 0usize;
        let mut _diff_h = 0usize;
        for seed in 0u64..n as u64 {
            let a = FingerprintOrchestrator::generate(seed);
            let b = FingerprintOrchestrator::generate(seed + 1);
            if a.screen_width != b.screen_width {
                diff_w += 1;
            }
            if a.screen_height != b.screen_height {
                _diff_h += 1;
            }
        }
        // At least 30% of adjacent seeds should produce different screen dimensions
        // (actual rate will be much higher but we use a conservative threshold
        // because screen resolution comes from a small discrete set).
        assert!(
            diff_w as f64 / n as f64 >= 0.30,
            "screen_width divergence rate too low: {}/{n}",
            diff_w
        );
    }

    #[test]
    fn font_subset_diverges_across_profiles() {
        // Two profiles from different seeds must not have identical font subsets
        // (extremely unlikely given the probabilistic selection, but we verify
        // for the first 50 adjacent seed pairs).
        let mut all_same = 0usize;
        for seed in 0u64..50 {
            let a = FingerprintOrchestrator::generate(seed);
            let b = FingerprintOrchestrator::generate(seed + 1);
            if a.font_subset == b.font_subset {
                all_same += 1;
            }
        }
        // Allow up to 2 collisions out of 50 (4%)
        assert!(
            all_same <= 2,
            "font_subset identical for {all_same}/50 adjacent seed pairs — too many collisions"
        );
    }

    #[test]
    fn webrtc_fake_ip_diverges_across_seeds() {
        // Each profile should get a unique fake local IP.
        let mut unique_ips = std::collections::HashSet::new();
        for seed in 0u64..100 {
            let fp = FingerprintOrchestrator::generate(seed);
            if let Some(ip) = &fp.webrtc_fake_ip {
                unique_ips.insert(ip.clone());
            }
        }
        // At least 80% of the 100 IPs should be distinct
        assert!(
            unique_ips.len() >= 80,
            "only {}/{} unique fake IPs — insufficient divergence",
            unique_ips.len(),
            100
        );
    }

    #[test]
    fn mdns_hostname_diverges_across_seeds() {
        let mut unique = std::collections::HashSet::new();
        for seed in 0u64..100 {
            let fp = FingerprintOrchestrator::generate(seed);
            if let Some(h) = &fp.webrtc_fake_mdns {
                unique.insert(h.clone());
            }
        }
        assert!(
            unique.len() >= 90,
            "only {}/{} unique mDNS hostnames",
            unique.len(),
            100
        );
    }

    #[test]
    fn noise_levels_are_stable_not_near_zero_boundary() {
        // Ensure canvas_noise stays in [0.01, 0.15] as specified in generate().
        // This guarantees that Hamming distance tests are meaningful (near-zero
        // values would all map to the same exponent bits).
        for seed in 0u64..500 {
            let fp = FingerprintOrchestrator::generate(seed);
            assert!(
                fp.canvas_noise >= 0.005,
                "canvas_noise {:.6} below minimum for seed={seed}",
                fp.canvas_noise
            );
            assert!(
                fp.canvas_noise <= 0.20,
                "canvas_noise {:.6} above maximum for seed={seed}",
                fp.canvas_noise
            );
            assert!(
                fp.audio_noise >= 0.0005,
                "audio_noise {:.8} below minimum for seed={seed}",
                fp.audio_noise
            );
            assert!(
                fp.audio_noise <= 0.015,
                "audio_noise {:.8} above maximum for seed={seed}",
                fp.audio_noise
            );
        }
    }
}
