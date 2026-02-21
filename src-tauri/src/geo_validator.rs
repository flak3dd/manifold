// ── Manifold geo consistency validator ───────────────────────────────────────
//
// Enforces hard rules for fingerprint coherence when a proxy is assigned to
// a profile.  Modern WAFs (Akamai Bot Manager ML, Cloudflare Bot Mgmt v2,
// PerimeterX) score "geo consistency" as a first-pass signal before any
// behavioural analysis.  A US proxy with an Australian timezone + en-AU locale
// + 4K screen is an immediate hard flag.
//
// Rules enforced:
//   1. Proxy country code → allowed locale codes (BCP-47 prefix match)
//   2. Proxy country code → allowed IANA timezones
//   3. Proxy country code → screen resolution realism (4K gating)
//   4. Accept-Language primary tag → locale consistency
//   5. Locale ↔ timezone cross-check (e.g. de-DE must not be in Asia/*)
//   6. Platform ↔ screen DPI realism (macOS retina pixel_ratio gate)
//   7. ua_platform ↔ platform string consistency
//
// Usage:
//
//   let violations = GeoValidator::validate(&fingerprint, "US");
//   if !violations.is_empty() {
//       // surface in UI or auto-correct with enforce_geo()
//   }
//
//   // Auto-correct (mutates fingerprint in-place):
//   GeoValidator::auto_correct(&mut fingerprint, "US", seed);

use serde::{Deserialize, Serialize};

use crate::fingerprint::{Fingerprint, FingerprintOrchestrator};

// ── Violation severity ────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// Hard block — will trigger immediate detection on most WAFs.
    Hard,
    /// Soft warning — suspicious but not always decisive alone.
    Soft,
    /// Informational — low signal but worth noting.
    Info,
}

// ── Violation record ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoViolation {
    /// Machine-readable code (stable across versions).
    pub code: String,
    /// Severity of the violation.
    pub severity: Severity,
    /// Human-readable description (for UI tooltip / log).
    pub description: String,
    /// The field(s) that caused the violation.
    pub fields: Vec<String>,
    /// Suggested corrective action (if auto-correct is not used).
    pub suggestion: String,
}

impl GeoViolation {
    fn hard(
        code: &str,
        description: impl Into<String>,
        fields: Vec<&str>,
        suggestion: impl Into<String>,
    ) -> Self {
        Self {
            code: code.to_string(),
            severity: Severity::Hard,
            description: description.into(),
            fields: fields.into_iter().map(|s| s.to_string()).collect(),
            suggestion: suggestion.into(),
        }
    }

    fn soft(
        code: &str,
        description: impl Into<String>,
        fields: Vec<&str>,
        suggestion: impl Into<String>,
    ) -> Self {
        Self {
            code: code.to_string(),
            severity: Severity::Soft,
            description: description.into(),
            fields: fields.into_iter().map(|s| s.to_string()).collect(),
            suggestion: suggestion.into(),
        }
    }

    fn info(
        code: &str,
        description: impl Into<String>,
        fields: Vec<&str>,
        suggestion: impl Into<String>,
    ) -> Self {
        Self {
            code: code.to_string(),
            severity: Severity::Info,
            description: description.into(),
            fields: fields.into_iter().map(|s| s.to_string()).collect(),
            suggestion: suggestion.into(),
        }
    }
}

// ── Geo rule tables ───────────────────────────────────────────────────────────

/// Allowed BCP-47 locale prefixes for a given ISO-3166-1 alpha-2 country code.
/// The check is prefix-based: "en-US" satisfies prefix "en-" or "en".
fn allowed_locale_prefixes(cc: &str) -> &'static [&'static str] {
    match cc {
        "US" => &["en-US", "en-"],
        "GB" => &["en-GB", "en-"],
        "CA" => &["en-CA", "fr-CA", "en-", "fr-"],
        "AU" => &["en-AU", "en-"],
        "NZ" => &["en-NZ", "en-"],
        "IE" => &["en-IE", "en-"],
        "DE" => &["de-DE", "de-AT", "de-CH", "de-"],
        "AT" => &["de-AT", "de-"],
        "CH" => &["de-CH", "fr-CH", "it-CH", "de-", "fr-", "it-"],
        "FR" => &["fr-FR", "fr-"],
        "BE" => &["fr-BE", "nl-BE", "de-BE", "fr-", "nl-", "de-"],
        "NL" => &["nl-NL", "nl-"],
        "ES" => &["es-ES", "es-", "ca-", "gl-", "eu-"],
        "MX" => &["es-MX", "es-"],
        "AR" => &["es-AR", "es-"],
        "CO" => &["es-CO", "es-"],
        "IT" => &["it-IT", "it-"],
        "PT" => &["pt-PT", "pt-"],
        "BR" => &["pt-BR", "pt-"],
        "PL" => &["pl-PL", "pl-"],
        "SE" => &["sv-SE", "sv-"],
        "NO" => &["nb-NO", "nn-NO", "no-", "nb-", "nn-"],
        "DK" => &["da-DK", "da-"],
        "FI" => &["fi-FI", "fi-", "sv-FI"],
        "CZ" => &["cs-CZ", "cs-"],
        "SK" => &["sk-SK", "sk-"],
        "HU" => &["hu-HU", "hu-"],
        "RO" => &["ro-RO", "ro-"],
        "BG" => &["bg-BG", "bg-"],
        "HR" => &["hr-HR", "hr-"],
        "GR" => &["el-GR", "el-"],
        "TR" => &["tr-TR", "tr-"],
        "UA" => &["uk-UA", "uk-", "ru-"],
        "RU" => &["ru-RU", "ru-"],
        "JP" => &["ja-JP", "ja-"],
        "KR" => &["ko-KR", "ko-"],
        "CN" => &["zh-CN", "zh-Hans", "zh-"],
        "TW" => &["zh-TW", "zh-Hant", "zh-"],
        "HK" => &["zh-HK", "zh-", "en-HK", "en-"],
        "SG" => &["en-SG", "zh-SG", "ms-SG", "en-", "zh-"],
        "IN" => &["en-IN", "hi-IN", "en-", "hi-"],
        "ID" => &["id-ID", "id-"],
        "MY" => &["ms-MY", "en-MY", "ms-", "en-"],
        "TH" => &["th-TH", "th-"],
        "VN" => &["vi-VN", "vi-"],
        "PH" => &["fil-PH", "en-PH", "en-"],
        "SA" => &["ar-SA", "ar-"],
        "AE" => &["ar-AE", "ar-", "en-"],
        "IL" => &["he-IL", "he-", "en-"],
        "ZA" => &["en-ZA", "af-ZA", "en-", "af-"],
        "NG" => &["en-NG", "en-"],
        "KE" => &["sw-KE", "en-KE", "en-"],
        _ => &["en-"], // Unknown country: allow English as fallback
    }
}

/// Allowed IANA timezone prefixes for a given country code.
fn allowed_tz_prefixes(cc: &str) -> &'static [&'static str] {
    match cc {
        "US" | "CA" | "MX" | "AR" | "CO" | "BR" | "CL" | "PE" | "VE" | "EC" | "BO" | "PY"
        | "UY" => &["America/"],
        "GB" | "IE" => &["Europe/London", "Europe/Dublin"],
        "DE" | "AT" | "CH" | "FR" | "BE" | "NL" | "ES" | "IT" | "PT" | "PL" | "SE" | "NO"
        | "DK" | "FI" | "CZ" | "SK" | "HU" | "RO" | "BG" | "HR" | "GR" | "TR" | "UA" | "RU" => {
            &["Europe/"]
        }
        "AU" | "NZ" | "PG" | "FJ" => &["Australia/", "Pacific/"],
        "JP" => &["Asia/Tokyo"],
        "KR" => &["Asia/Seoul"],
        "CN" | "TW" | "HK" | "SG" | "MY" | "ID" | "PH" | "TH" | "VN" | "IN" | "SA" | "AE"
        | "IL" => &["Asia/"],
        "ZA" | "NG" | "KE" | "ET" | "GH" | "TZ" | "UG" => &["Africa/"],
        _ => &[], // Unknown: no restriction
    }
}

/// Returns true if the given screen width×height qualifies as 4K or higher.
fn is_4k_or_above(width: u32, height: u32) -> bool {
    width >= 3840 && height >= 2160
}

/// Countries where 4K desktop penetration is realistic (>5% of desktop users).
/// Source: Steam Hardware Survey Q1-2025 + StatCounter by country.
fn allows_4k(cc: &str) -> bool {
    matches!(
        cc,
        "US" | "CA"
            | "GB"
            | "AU"
            | "DE"
            | "FR"
            | "NL"
            | "SE"
            | "NO"
            | "DK"
            | "FI"
            | "CH"
            | "AT"
            | "JP"
            | "KR"
            | "SG"
            | "HK"
            | "TW"
            | "NZ"
            | "IE"
            | "BE"
            | "IT"
            | "ES"
            | "PT"
            | "PL"
    )
}

/// Countries where high pixel-ratio (2.0+) screens are common on desktops/laptops.
fn allows_high_dpr(cc: &str) -> bool {
    // Apple devices are prevalent globally; OLED/Retina laptops growing everywhere.
    // Only flag DPR=2 on countries with very low consumer electronics spend.
    !matches!(
        cc,
        "NG" | "ET" | "UG" | "TZ" | "GH" | "KE" | "BD" | "KH" | "LA" | "MM"
    )
}

// ── GeoValidator ─────────────────────────────────────────────────────────────

pub struct GeoValidator;

impl GeoValidator {
    /// Validate a `Fingerprint` against a proxy country code.
    ///
    /// Returns a (possibly empty) list of violations sorted by severity
    /// (Hard → Soft → Info).
    ///
    /// `proxy_country` should be an ISO-3166-1 alpha-2 code, e.g. "US".
    /// Pass `None` to run only the internal self-consistency checks
    /// (locale ↔ timezone, platform ↔ ua_platform, etc.).
    pub fn validate(fp: &Fingerprint, proxy_country: Option<&str>) -> Vec<GeoViolation> {
        let mut violations: Vec<GeoViolation> = Vec::new();

        // ── Internal consistency checks (no proxy needed) ─────────────────

        // 1. ua_platform ↔ platform string
        Self::check_platform_consistency(fp, &mut violations);

        // 2. Locale ↔ timezone cross-check
        Self::check_locale_tz_consistency(fp, &mut violations);

        // 3. accept_language primary tag must match locale
        Self::check_accept_language_locale(fp, &mut violations);

        // 4. macOS retina pixel-ratio gate
        Self::check_macos_dpr(fp, &mut violations);

        // ── Proxy-country-specific checks ─────────────────────────────────
        if let Some(cc) = proxy_country {
            let cc = cc.to_uppercase();
            let cc = cc.as_str();

            // 5. Locale vs proxy country
            Self::check_locale_vs_country(fp, cc, &mut violations);

            // 6. Timezone vs proxy country
            Self::check_tz_vs_country(fp, cc, &mut violations);

            // 7. 4K screen gating
            Self::check_4k_vs_country(fp, cc, &mut violations);

            // 8. High DPR gating
            Self::check_dpr_vs_country(fp, cc, &mut violations);
        }

        // Sort: Hard first, then Soft, then Info
        violations.sort_by_key(|v| match v.severity {
            Severity::Hard => 0u8,
            Severity::Soft => 1,
            Severity::Info => 2,
        });

        violations
    }

    /// Auto-correct a fingerprint for a given proxy country.
    ///
    /// Calls `enforce_geo` to align locale/timezone, then re-checks and
    /// applies any remaining resolvable violations (screen resolution gating).
    ///
    /// Returns the list of violations that were automatically fixed and any
    /// residual violations that require manual intervention.
    pub fn auto_correct(fp: &mut Fingerprint, proxy_country: &str, seed: u64) -> AutoCorrectResult {
        let before = Self::validate(fp, Some(proxy_country));
        if before.is_empty() {
            return AutoCorrectResult {
                fixed: vec![],
                residual: vec![],
            };
        }

        // Apply geo enforcement (aligns locale, accept-language, timezone)
        FingerprintOrchestrator::enforce_geo(fp, proxy_country);

        let cc = proxy_country.to_uppercase();
        let cc = cc.as_str();

        // Fix 4K screen if country doesn't allow it
        if is_4k_or_above(fp.screen_width, fp.screen_height) && !allows_4k(cc) {
            use rand::prelude::*;
            let mut rng = rand::rngs::SmallRng::seed_from_u64(seed ^ 0xc0ffee);
            fp.screen_width = 1920;
            fp.screen_height = 1080;
            fp.viewport_width = 1920;
            fp.viewport_height = 1080u32.saturating_sub(88 + 40 + rng.gen_range(0u32..20));
            fp.pixel_ratio = if rng.gen_bool(0.3) { 1.25 } else { 1.0 };
        }

        // Fix high DPR on countries where it's unrealistic
        if fp.pixel_ratio >= 2.0 && !allows_high_dpr(cc) {
            fp.pixel_ratio = 1.0;
        }

        let after = Self::validate(fp, Some(proxy_country));

        // Violations that disappeared = fixed
        let fixed: Vec<GeoViolation> = before
            .iter()
            .filter(|v| !after.iter().any(|a| a.code == v.code))
            .cloned()
            .collect();

        AutoCorrectResult {
            fixed,
            residual: after,
        }
    }

    /// Returns a summary score 0.0–1.0 (1.0 = no violations).
    /// Weights: Hard = 0.5, Soft = 0.3, Info = 0.1 per violation, cap 0.
    #[allow(dead_code)]
    pub fn consistency_score(fp: &Fingerprint, proxy_country: Option<&str>) -> f64 {
        let violations = Self::validate(fp, proxy_country);
        let penalty: f64 = violations
            .iter()
            .map(|v| match v.severity {
                Severity::Hard => 0.50,
                Severity::Soft => 0.20,
                Severity::Info => 0.05,
            })
            .sum();
        (1.0_f64 - penalty).max(0.0)
    }

    // ── Private rule implementations ──────────────────────────────────────────

    fn check_platform_consistency(fp: &Fingerprint, out: &mut Vec<GeoViolation>) {
        // ua_platform is the high-entropy CH value ("Windows", "macOS", "Linux")
        // platform is the JS navigator.platform ("Win32", "MacIntel", "Linux x86_64")
        let ok = match fp.ua_platform.as_str() {
            "Windows" => fp.platform == "Win32",
            "macOS" => fp.platform == "MacIntel",
            "Linux" => fp.platform.starts_with("Linux"),
            _ => true, // unknown UA platform — skip
        };
        if !ok {
            out.push(GeoViolation::hard(
                "PLATFORM_UA_MISMATCH",
                format!(
                    "navigator.platform '{}' is inconsistent with ua_platform '{}'",
                    fp.platform, fp.ua_platform
                ),
                vec!["platform", "ua_platform"],
                "Regenerate fingerprint or align ua_platform with platform",
            ));
        }
    }

    fn check_locale_tz_consistency(fp: &Fingerprint, out: &mut Vec<GeoViolation>) {
        // High-confidence locale ↔ timezone pairs.  We only flag obvious mismatches
        // (e.g. de-DE in America/New_York) rather than every edge case.
        let locale_region = fp.locale.split('-').nth(1).unwrap_or("").to_uppercase();

        let tz_continent = fp.timezone.split('/').next().unwrap_or("").to_lowercase();

        // Obvious hard mismatches
        let hard_mismatch = match locale_region.as_str() {
            "DE" | "AT" | "CH" | "FR" | "NL" | "BE" | "PL" | "SE" | "NO" | "DK" | "FI" | "IT"
            | "ES" | "PT" | "GR" | "CZ" | "SK" | "HU" | "RO" | "BG" | "HR" => {
                tz_continent != "europe" && !fp.timezone.starts_with("Europe/")
            }
            "JP" => fp.timezone != "Asia/Tokyo",
            "KR" => fp.timezone != "Asia/Seoul",
            "AU" => tz_continent != "australia",
            "BR" => tz_continent != "america",
            "US" | "CA" => tz_continent != "america",
            _ => false,
        };

        if hard_mismatch {
            out.push(GeoViolation::hard(
                "LOCALE_TZ_MISMATCH",
                format!(
                    "Locale '{}' is incompatible with timezone '{}'",
                    fp.locale, fp.timezone
                ),
                vec!["locale", "timezone"],
                "Use enforce_geo() or auto_correct() to align timezone with locale region",
            ));
        }
    }

    fn check_accept_language_locale(fp: &Fingerprint, out: &mut Vec<GeoViolation>) {
        // accept_language must start with (or contain as first entry) the locale prefix
        let primary_locale_lang = fp.locale.split('-').next().unwrap_or("en");
        let accept_primary = fp
            .accept_language
            .split(',')
            .next()
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_lowercase();

        let accept_lang_prefix = accept_primary
            .split('-')
            .next()
            .unwrap_or("")
            .to_lowercase();

        if accept_lang_prefix != primary_locale_lang.to_lowercase() {
            out.push(GeoViolation::hard(
                "ACCEPT_LANGUAGE_LOCALE_MISMATCH",
                format!(
                    "accept_language primary tag '{}' does not match locale language '{}'",
                    accept_primary, fp.locale
                ),
                vec!["accept_language", "locale"],
                "Set accept_language to start with the same language tag as locale",
            ));
        }

        // Check that the full locale appears as first entry in accept_language
        let first_full = fp
            .accept_language
            .split(',')
            .next()
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_lowercase();

        if first_full != fp.locale.to_lowercase() && first_full != primary_locale_lang {
            out.push(GeoViolation::soft(
                "ACCEPT_LANGUAGE_LOCALE_PARTIAL_MISMATCH",
                format!(
                    "First accept_language entry '{}' does not exactly match locale '{}'; \
                     WAFs may score this as inconsistent",
                    first_full, fp.locale
                ),
                vec!["accept_language", "locale"],
                "Ensure the first accept-language value exactly matches the locale tag",
            ));
        }
    }

    fn check_macos_dpr(fp: &Fingerprint, out: &mut Vec<GeoViolation>) {
        // macOS with pixel_ratio < 2.0 is possible (non-Retina) but
        // ua_platform=macOS + pixel_ratio=1.0 + screen=3840×2160 is synthetic
        if fp.ua_platform == "macOS"
            && is_4k_or_above(fp.screen_width, fp.screen_height)
            && fp.pixel_ratio < 1.5
        {
            out.push(GeoViolation::soft(
                "MACOS_4K_LOW_DPR",
                format!(
                    "macOS profile with 4K screen ({}×{}) but pixel_ratio={:.2} is unrealistic; \
                     macOS reports HiDPI (2.0) for Retina displays",
                    fp.screen_width, fp.screen_height, fp.pixel_ratio
                ),
                vec![
                    "ua_platform",
                    "screen_width",
                    "screen_height",
                    "pixel_ratio",
                ],
                "Set pixel_ratio to 2.0 for macOS 4K/5K screens or use a non-4K resolution",
            ));
        }

        // macOS with pixel_ratio=1.0 and high screen_width is unusual (non-Retina Mac)
        if fp.ua_platform == "macOS" && fp.screen_width >= 2560 && fp.pixel_ratio < 1.5 {
            out.push(GeoViolation::info(
                "MACOS_HIGH_RES_LOW_DPR",
                format!(
                    "macOS with {}px wide screen and pixel_ratio={:.2} is unusual; \
                     most modern Macs use Retina (DPR≥2)",
                    fp.screen_width, fp.pixel_ratio
                ),
                vec!["ua_platform", "screen_width", "pixel_ratio"],
                "Consider setting pixel_ratio=2.0 for macOS profiles with high-res screens",
            ));
        }
    }

    fn check_locale_vs_country(fp: &Fingerprint, cc: &str, out: &mut Vec<GeoViolation>) {
        let allowed = allowed_locale_prefixes(cc);
        if allowed.is_empty() {
            return;
        }

        let locale_lower = fp.locale.to_lowercase();
        let matches = allowed
            .iter()
            .any(|prefix| locale_lower.starts_with(&prefix.to_lowercase()));

        if !matches {
            out.push(GeoViolation::hard(
                "LOCALE_COUNTRY_MISMATCH",
                format!(
                    "Locale '{}' is not consistent with proxy country '{}' \
                     (expected one of: {})",
                    fp.locale,
                    cc,
                    allowed.join(", ")
                ),
                vec!["locale", "proxy_country"],
                format!(
                    "Run auto_correct() or manually set locale to match proxy country '{}'; \
                     allowed prefixes: {}",
                    cc,
                    allowed.join(", ")
                ),
            ));
        }
    }

    fn check_tz_vs_country(fp: &Fingerprint, cc: &str, out: &mut Vec<GeoViolation>) {
        let allowed = allowed_tz_prefixes(cc);
        if allowed.is_empty() {
            return;
        }

        let matches = allowed.iter().any(|prefix| fp.timezone.starts_with(prefix));

        if !matches {
            out.push(GeoViolation::hard(
                "TIMEZONE_COUNTRY_MISMATCH",
                format!(
                    "Timezone '{}' is not consistent with proxy country '{}' \
                     (expected prefix: {})",
                    fp.timezone,
                    cc,
                    allowed.join(" or ")
                ),
                vec!["timezone", "proxy_country"],
                format!(
                    "Run auto_correct() or manually set timezone to match proxy country '{}'; \
                     allowed: {}",
                    cc,
                    allowed.join(", ")
                ),
            ));
        }
    }

    fn check_4k_vs_country(fp: &Fingerprint, cc: &str, out: &mut Vec<GeoViolation>) {
        if is_4k_or_above(fp.screen_width, fp.screen_height) && !allows_4k(cc) {
            out.push(GeoViolation::soft(
                "4K_SCREEN_COUNTRY_UNREALISTIC",
                format!(
                    "4K screen resolution ({}×{}) is statistically rare (<3%) for \
                     proxy country '{}'; may trigger WAF geo-consistency score",
                    fp.screen_width, fp.screen_height, cc
                ),
                vec!["screen_width", "screen_height", "proxy_country"],
                "Set screen_width/height to 1920×1080 for this country, or use auto_correct()",
            ));
        }
    }

    fn check_dpr_vs_country(fp: &Fingerprint, cc: &str, out: &mut Vec<GeoViolation>) {
        if fp.pixel_ratio >= 2.0 && !allows_high_dpr(cc) {
            out.push(GeoViolation::info(
                "HIGH_DPR_COUNTRY_UNUSUAL",
                format!(
                    "pixel_ratio={:.1} is unusual for proxy country '{}' where \
                     high-end consumer devices have low market penetration",
                    fp.pixel_ratio, cc
                ),
                vec!["pixel_ratio", "proxy_country"],
                "Consider setting pixel_ratio=1.0 for this country",
            ));
        }
    }
}

// ── AutoCorrectResult ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct AutoCorrectResult {
    /// Violations that were automatically resolved.
    pub fixed: Vec<GeoViolation>,
    /// Violations that could not be auto-corrected (require manual action).
    pub residual: Vec<GeoViolation>,
}

impl AutoCorrectResult {
    #[allow(dead_code)]
    pub fn is_clean(&self) -> bool {
        self.residual.is_empty()
    }

    #[allow(dead_code)]
    pub fn hard_count(&self) -> usize {
        self.residual
            .iter()
            .filter(|v| v.severity == Severity::Hard)
            .count()
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fingerprint::FingerprintOrchestrator;

    fn gen(seed: u64) -> Fingerprint {
        FingerprintOrchestrator::generate(seed)
    }

    #[test]
    fn clean_profile_has_no_violations() {
        // Default-generated fingerprint should pass internal consistency
        let fp = gen(42);
        let v = GeoValidator::validate(&fp, None);
        let hard: Vec<_> = v.iter().filter(|x| x.severity == Severity::Hard).collect();
        assert!(
            hard.is_empty(),
            "Default fingerprint should not have hard violations: {:?}",
            hard
        );
    }

    #[test]
    fn us_proxy_with_us_locale_passes() {
        let mut fp = gen(1);
        FingerprintOrchestrator::enforce_geo(&mut fp, "US");
        let v = GeoValidator::validate(&fp, Some("US"));
        let hard: Vec<_> = v.iter().filter(|x| x.severity == Severity::Hard).collect();
        assert!(
            hard.is_empty(),
            "US locale+tz should pass for US proxy: {:?}",
            hard
        );
    }

    #[test]
    fn au_locale_with_us_proxy_is_hard_violation() {
        let mut fp = gen(2);
        // Force an Australian profile
        FingerprintOrchestrator::enforce_geo(&mut fp, "AU");
        // But pretend the proxy is US
        let v = GeoValidator::validate(&fp, Some("US"));
        let has_locale_mismatch = v.iter().any(|x| x.code == "LOCALE_COUNTRY_MISMATCH");
        let has_tz_mismatch = v.iter().any(|x| x.code == "TIMEZONE_COUNTRY_MISMATCH");
        assert!(
            has_locale_mismatch || has_tz_mismatch,
            "AU locale with US proxy should produce mismatch violations: {:?}",
            v
        );
    }

    #[test]
    fn auto_correct_resolves_locale_tz_mismatch() {
        let mut fp = gen(3);
        FingerprintOrchestrator::enforce_geo(&mut fp, "JP");
        // Pretend proxy is US
        let result = GeoValidator::auto_correct(&mut fp, "US", 3);
        // After auto-correct, US locale+tz should be set
        let residual_hard: Vec<_> = result
            .residual
            .iter()
            .filter(|x| x.severity == Severity::Hard)
            .collect();
        assert!(
            residual_hard.is_empty(),
            "Auto-correct should resolve hard violations for US proxy: {:?}",
            residual_hard
        );
    }

    #[test]
    fn consistency_score_is_1_for_clean_profile() {
        let mut fp = gen(10);
        FingerprintOrchestrator::enforce_geo(&mut fp, "DE");
        let score = GeoValidator::consistency_score(&fp, Some("DE"));
        assert!(
            score >= 0.95,
            "Enforced DE profile should have consistency score ≥ 0.95, got {score}"
        );
    }

    #[test]
    fn platform_ua_mismatch_is_detected() {
        let mut fp = gen(7);
        // Force a mismatch: Windows UA platform but Linux navigator.platform
        fp.ua_platform = "Windows".to_string();
        fp.platform = "Linux x86_64".to_string();
        let v = GeoValidator::validate(&fp, None);
        let has_mismatch = v.iter().any(|x| x.code == "PLATFORM_UA_MISMATCH");
        assert!(
            has_mismatch,
            "Should detect platform/ua_platform mismatch: {:?}",
            v
        );
    }

    #[test]
    fn accept_language_locale_mismatch_is_detected() {
        let mut fp = gen(8);
        fp.locale = "de-DE".to_string();
        fp.accept_language = "en-US,en;q=0.9".to_string();
        let v = GeoValidator::validate(&fp, None);
        let has_mismatch = v
            .iter()
            .any(|x| x.code == "ACCEPT_LANGUAGE_LOCALE_MISMATCH");
        assert!(
            has_mismatch,
            "Should detect accept-language/locale mismatch: {:?}",
            v
        );
    }

    #[test]
    fn score_decreases_with_violations() {
        let mut fp = gen(9);
        // Introduce hard violations
        fp.locale = "ja-JP".to_string();
        fp.accept_language = "ja-JP,ja;q=0.9".to_string();
        fp.timezone = "Asia/Tokyo".to_string();
        // US proxy → should be hard violations
        let score = GeoValidator::consistency_score(&fp, Some("US"));
        assert!(
            score < 0.9,
            "Score should drop below 0.9 with geo violations, got {score}"
        );
    }
}
