// ── Manifold HumanBehavior ────────────────────────────────────────────────────
//
// Parameter model for the TypeScript HumanBehavior middleware.
// The Rust side owns/persists these settings; the TS bridge reads them when
// launching a profile and applies them to every Playwright interaction.

use serde::{Deserialize, Serialize};
use std::fmt;

use crate::error::{ManifoldError, Result};

// ── Core types ────────────────────────────────────────────────────────────────

/// How aggressively to simulate human timing variance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BehaviorProfile {
    /// Minimal delays — useful for debugging / fast automation.
    Bot,
    /// Light timing jitter, ~95th-percentile human speed.
    Fast,
    /// Realistic average user (default).
    #[default]
    Normal,
    /// Slow, cautious user — maximum evasion.
    Cautious,
}

impl fmt::Display for BehaviorProfile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            Self::Bot => "bot",
            Self::Fast => "fast",
            Self::Normal => "normal",
            Self::Cautious => "cautious",
        };
        write!(f, "{s}")
    }
}

impl std::str::FromStr for BehaviorProfile {
    type Err = ManifoldError;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "bot" => Ok(Self::Bot),
            "fast" => Ok(Self::Fast),
            "normal" => Ok(Self::Normal),
            "cautious" => Ok(Self::Cautious),
            other => Err(ManifoldError::InvalidArg(format!(
                "unknown BehaviorProfile: {other:?}"
            ))),
        }
    }
}

// ── Mouse config ──────────────────────────────────────────────────────────────

/// Parameters for cubic-Bézier mouse movement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouseConfig {
    /// Base cursor speed in logical pixels per second.
    /// Actual speed varies ±`speed_jitter` each move.
    pub base_speed_px_per_sec: f64,

    /// Fractional speed jitter, 0.0 – 1.0.
    /// E.g. 0.3 means ±30% random variation around `base_speed_px_per_sec`.
    pub speed_jitter: f64,

    /// Control-point scatter as a fraction of the move distance.
    /// Higher values = more curved paths.  0.0 = straight lines.
    pub curve_scatter: f64,

    /// Probability [0, 1] of adding a small overshoot-then-correct at the end
    /// of a move.  0.0 = never, 1.0 = always.
    pub overshoot_prob: f64,

    /// Maximum overshoot distance in logical pixels.
    pub overshoot_max_px: f64,

    /// Extra wait in ms after arriving at the target before clicking.
    /// Drawn from Uniform(0, `pre_click_pause_max_ms`).
    pub pre_click_pause_max_ms: u32,

    /// Probability of a sub-move micro-jitter (tiny random displacement mid-path).
    pub micro_jitter_prob: f64,
}

impl MouseConfig {
    pub fn for_profile(p: BehaviorProfile) -> Self {
        match p {
            BehaviorProfile::Bot => Self {
                base_speed_px_per_sec: 4000.0,
                speed_jitter: 0.0,
                curve_scatter: 0.0,
                overshoot_prob: 0.0,
                overshoot_max_px: 0.0,
                pre_click_pause_max_ms: 0,
                micro_jitter_prob: 0.0,
            },
            BehaviorProfile::Fast => Self {
                base_speed_px_per_sec: 1400.0,
                speed_jitter: 0.15,
                curve_scatter: 0.15,
                overshoot_prob: 0.05,
                overshoot_max_px: 8.0,
                pre_click_pause_max_ms: 40,
                micro_jitter_prob: 0.05,
            },
            BehaviorProfile::Normal => Self {
                base_speed_px_per_sec: 800.0,
                speed_jitter: 0.30,
                curve_scatter: 0.30,
                overshoot_prob: 0.15,
                overshoot_max_px: 18.0,
                pre_click_pause_max_ms: 120,
                micro_jitter_prob: 0.10,
            },
            BehaviorProfile::Cautious => Self {
                base_speed_px_per_sec: 400.0,
                speed_jitter: 0.45,
                curve_scatter: 0.45,
                overshoot_prob: 0.25,
                overshoot_max_px: 30.0,
                pre_click_pause_max_ms: 300,
                micro_jitter_prob: 0.20,
            },
        }
    }
}

// ── Typing config ─────────────────────────────────────────────────────────────

/// Parameters for burst/pause typing with optional typo injection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypingConfig {
    /// Average typing speed in words per minute (5 chars/word baseline).
    pub base_wpm: f64,

    /// Fractional WPM jitter, 0.0 – 1.0.
    pub wpm_jitter: f64,

    /// Number of characters typed before a "burst pause".
    /// Drawn from Uniform(`burst_min_chars`, `burst_max_chars`).
    pub burst_min_chars: u32,
    pub burst_max_chars: u32,

    /// Pause duration between bursts in ms.
    /// Drawn from Uniform(`pause_min_ms`, `pause_max_ms`).
    pub pause_min_ms: u32,
    pub pause_max_ms: u32,

    /// Probability [0, 1] of injecting a typo on any given character.
    /// A typo types an adjacent QWERTY key, waits `typo_correct_ms`, then
    /// presses Backspace and retypes the correct character.
    pub typo_rate: f64,

    /// Extra wait after typing the wrong key before correcting, in ms.
    /// Drawn from Uniform(`typo_correct_min_ms`, `typo_correct_max_ms`).
    pub typo_correct_min_ms: u32,
    pub typo_correct_max_ms: u32,

    /// Probability of a double-tap (same key pressed twice) instead of an
    /// adjacent-key typo.
    pub double_tap_rate: f64,

    /// Whether to add a short "think" pause before long fields (>20 chars).
    pub think_before_long_fields: bool,
    pub think_pause_min_ms: u32,
    pub think_pause_max_ms: u32,
}

impl TypingConfig {
    pub fn for_profile(p: BehaviorProfile) -> Self {
        match p {
            BehaviorProfile::Bot => Self {
                base_wpm: 800.0,
                wpm_jitter: 0.0,
                burst_min_chars: 999,
                burst_max_chars: 999,
                pause_min_ms: 0,
                pause_max_ms: 0,
                typo_rate: 0.0,
                typo_correct_min_ms: 0,
                typo_correct_max_ms: 0,
                double_tap_rate: 0.0,
                think_before_long_fields: false,
                think_pause_min_ms: 0,
                think_pause_max_ms: 0,
            },
            BehaviorProfile::Fast => Self {
                base_wpm: 90.0,
                wpm_jitter: 0.15,
                burst_min_chars: 6,
                burst_max_chars: 14,
                pause_min_ms: 80,
                pause_max_ms: 200,
                typo_rate: 0.008,
                typo_correct_min_ms: 120,
                typo_correct_max_ms: 280,
                double_tap_rate: 0.002,
                think_before_long_fields: false,
                think_pause_min_ms: 0,
                think_pause_max_ms: 0,
            },
            BehaviorProfile::Normal => Self {
                base_wpm: 65.0,
                wpm_jitter: 0.25,
                burst_min_chars: 4,
                burst_max_chars: 10,
                pause_min_ms: 150,
                pause_max_ms: 600,
                typo_rate: 0.02,
                typo_correct_min_ms: 200,
                typo_correct_max_ms: 500,
                double_tap_rate: 0.005,
                think_before_long_fields: true,
                think_pause_min_ms: 400,
                think_pause_max_ms: 1200,
            },
            BehaviorProfile::Cautious => Self {
                base_wpm: 38.0,
                wpm_jitter: 0.35,
                burst_min_chars: 2,
                burst_max_chars: 6,
                pause_min_ms: 400,
                pause_max_ms: 1400,
                typo_rate: 0.04,
                typo_correct_min_ms: 400,
                typo_correct_max_ms: 900,
                double_tap_rate: 0.01,
                think_before_long_fields: true,
                think_pause_min_ms: 800,
                think_pause_max_ms: 2500,
            },
        }
    }
}

// ── Scroll config ─────────────────────────────────────────────────────────────

/// Parameters for natural momentum-based scrolling.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrollConfig {
    /// Initial scroll velocity in px per wheel tick.
    pub initial_velocity_px: f64,

    /// Momentum decay factor per tick (0 < factor < 1).
    /// Lower = faster deceleration; higher = more coasting.
    pub momentum_decay: f64,

    /// Minimum velocity below which scrolling stops.
    pub min_velocity_px: f64,

    /// Delay between wheel ticks in ms.
    /// Drawn from Uniform(`tick_min_ms`, `tick_max_ms`).
    pub tick_min_ms: u32,
    pub tick_max_ms: u32,

    /// Probability of a brief "re-scroll" (slightly overshot then corrected).
    pub overshoot_prob: f64,

    /// Max overshoot in px.
    pub overshoot_max_px: f64,
}

impl ScrollConfig {
    pub fn for_profile(p: BehaviorProfile) -> Self {
        match p {
            BehaviorProfile::Bot => Self {
                initial_velocity_px: 500.0,
                momentum_decay: 0.5,
                min_velocity_px: 1.0,
                tick_min_ms: 8,
                tick_max_ms: 8,
                overshoot_prob: 0.0,
                overshoot_max_px: 0.0,
            },
            BehaviorProfile::Fast => Self {
                initial_velocity_px: 120.0,
                momentum_decay: 0.82,
                min_velocity_px: 2.0,
                tick_min_ms: 12,
                tick_max_ms: 20,
                overshoot_prob: 0.05,
                overshoot_max_px: 30.0,
            },
            BehaviorProfile::Normal => Self {
                initial_velocity_px: 80.0,
                momentum_decay: 0.88,
                min_velocity_px: 2.0,
                tick_min_ms: 14,
                tick_max_ms: 28,
                overshoot_prob: 0.10,
                overshoot_max_px: 60.0,
            },
            BehaviorProfile::Cautious => Self {
                initial_velocity_px: 50.0,
                momentum_decay: 0.92,
                min_velocity_px: 1.5,
                tick_min_ms: 18,
                tick_max_ms: 40,
                overshoot_prob: 0.15,
                overshoot_max_px: 80.0,
            },
        }
    }
}

// ── Macro-behavior ────────────────────────────────────────────────────────────

/// High-level behavioral timing for page-level actions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroBehavior {
    /// Pause before the first interaction after a page load, in ms.
    pub page_load_pause_min_ms: u32,
    pub page_load_pause_max_ms: u32,

    /// Pause between distinct actions (click → type, type → scroll, etc.), ms.
    pub inter_action_min_ms: u32,
    pub inter_action_max_ms: u32,

    /// Probability of a random "idle" pause mid-session (simulates reading).
    pub idle_pause_prob: f64,
    pub idle_pause_min_ms: u32,
    pub idle_pause_max_ms: u32,

    /// Probability of randomly moving the mouse to a non-interactive element
    /// before the "real" target (simulates natural visual scanning).
    pub random_premove_prob: f64,
}

impl MacroBehavior {
    pub fn for_profile(p: BehaviorProfile) -> Self {
        match p {
            BehaviorProfile::Bot => Self {
                page_load_pause_min_ms: 0,
                page_load_pause_max_ms: 0,
                inter_action_min_ms: 0,
                inter_action_max_ms: 10,
                idle_pause_prob: 0.0,
                idle_pause_min_ms: 0,
                idle_pause_max_ms: 0,
                random_premove_prob: 0.0,
            },
            BehaviorProfile::Fast => Self {
                page_load_pause_min_ms: 200,
                page_load_pause_max_ms: 600,
                inter_action_min_ms: 80,
                inter_action_max_ms: 300,
                idle_pause_prob: 0.03,
                idle_pause_min_ms: 500,
                idle_pause_max_ms: 2000,
                random_premove_prob: 0.05,
            },
            BehaviorProfile::Normal => Self {
                page_load_pause_min_ms: 500,
                page_load_pause_max_ms: 1800,
                inter_action_min_ms: 200,
                inter_action_max_ms: 800,
                idle_pause_prob: 0.08,
                idle_pause_min_ms: 1000,
                idle_pause_max_ms: 5000,
                random_premove_prob: 0.12,
            },
            BehaviorProfile::Cautious => Self {
                page_load_pause_min_ms: 1200,
                page_load_pause_max_ms: 4000,
                inter_action_min_ms: 600,
                inter_action_max_ms: 2000,
                idle_pause_prob: 0.15,
                idle_pause_min_ms: 2000,
                idle_pause_max_ms: 12000,
                random_premove_prob: 0.25,
            },
        }
    }
}

// ── Top-level container ───────────────────────────────────────────────────────

/// All human-behavior parameters for one profile session.
///
/// Serialised to JSON and passed to the TypeScript bridge at launch time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HumanBehavior {
    pub profile: BehaviorProfile,
    pub mouse: MouseConfig,
    pub typing: TypingConfig,
    pub scroll: ScrollConfig,
    pub macro_b: MacroBehavior,
}

impl HumanBehavior {
    /// Build a fully-populated config from a named profile.
    pub fn from_profile(p: BehaviorProfile) -> Self {
        Self {
            profile: p,
            mouse: MouseConfig::for_profile(p),
            typing: TypingConfig::for_profile(p),
            scroll: ScrollConfig::for_profile(p),
            macro_b: MacroBehavior::for_profile(p),
        }
    }

    /// Validate all fields are within sensible bounds.
    /// Returns a list of validation errors (empty = valid).
    #[allow(dead_code)]
    pub fn validate(&self) -> Vec<String> {
        let mut errors = Vec::new();

        // Mouse
        if self.mouse.base_speed_px_per_sec <= 0.0 {
            errors.push("mouse.base_speed_px_per_sec must be > 0".into());
        }
        if !(0.0..=1.0).contains(&self.mouse.speed_jitter) {
            errors.push("mouse.speed_jitter must be in [0, 1]".into());
        }
        if !(0.0..=1.0).contains(&self.mouse.curve_scatter) {
            errors.push("mouse.curve_scatter must be in [0, 1]".into());
        }
        if !(0.0..=1.0).contains(&self.mouse.overshoot_prob) {
            errors.push("mouse.overshoot_prob must be in [0, 1]".into());
        }

        // Typing
        if self.typing.base_wpm <= 0.0 {
            errors.push("typing.base_wpm must be > 0".into());
        }
        if self.typing.burst_min_chars > self.typing.burst_max_chars {
            errors.push("typing.burst_min_chars must be <= burst_max_chars".into());
        }
        if self.typing.pause_min_ms > self.typing.pause_max_ms {
            errors.push("typing.pause_min_ms must be <= pause_max_ms".into());
        }
        if !(0.0..=1.0).contains(&self.typing.typo_rate) {
            errors.push("typing.typo_rate must be in [0, 1]".into());
        }
        if !(0.0..=1.0).contains(&self.typing.double_tap_rate) {
            errors.push("typing.double_tap_rate must be in [0, 1]".into());
        }

        // Scroll
        if self.scroll.initial_velocity_px <= 0.0 {
            errors.push("scroll.initial_velocity_px must be > 0".into());
        }
        if !(0.0..1.0).contains(&self.scroll.momentum_decay) {
            errors.push("scroll.momentum_decay must be in [0, 1)".into());
        }
        if self.scroll.tick_min_ms > self.scroll.tick_max_ms {
            errors.push("scroll.tick_min_ms must be <= tick_max_ms".into());
        }

        // Macro
        if self.macro_b.page_load_pause_min_ms > self.macro_b.page_load_pause_max_ms {
            errors.push("macro_b.page_load_pause_min_ms must be <= max".into());
        }
        if !(0.0..=1.0).contains(&self.macro_b.idle_pause_prob) {
            errors.push("macro_b.idle_pause_prob must be in [0, 1]".into());
        }
        if !(0.0..=1.0).contains(&self.macro_b.random_premove_prob) {
            errors.push("macro_b.random_premove_prob must be in [0, 1]".into());
        }

        errors
    }

    /// Convenience: return `Err` if validation fails.
    #[allow(dead_code)]
    pub fn validate_strict(&self) -> Result<()> {
        let errs = self.validate();
        if errs.is_empty() {
            Ok(())
        } else {
            Err(ManifoldError::InvalidArg(errs.join("; ")))
        }
    }
}

impl Default for HumanBehavior {
    fn default() -> Self {
        Self::from_profile(BehaviorProfile::Normal)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn all_profiles() -> [BehaviorProfile; 4] {
        [
            BehaviorProfile::Bot,
            BehaviorProfile::Fast,
            BehaviorProfile::Normal,
            BehaviorProfile::Cautious,
        ]
    }

    // ── BehaviorProfile enum ──────────────────────────────────────────────────

    #[test]
    fn behavior_profile_roundtrip() {
        for s in ["bot", "fast", "normal", "cautious"] {
            let p: BehaviorProfile = s.parse().expect("parse");
            assert_eq!(p.to_string(), s);
        }
    }

    #[test]
    fn unknown_profile_errors() {
        let result: Result<BehaviorProfile> = "turbo".parse();
        assert!(result.is_err());
    }

    #[test]
    fn behavior_profile_eq() {
        assert_eq!(BehaviorProfile::Normal, BehaviorProfile::Normal);
        assert_ne!(BehaviorProfile::Bot, BehaviorProfile::Cautious);
    }

    // ── Validation ────────────────────────────────────────────────────────────

    #[test]
    fn all_profiles_valid() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            let errs = hb.validate();
            assert!(
                errs.is_empty(),
                "Profile {p} has validation errors: {errs:?}"
            );
        }
    }

    #[test]
    fn validate_strict_ok_for_all_profiles() {
        for p in all_profiles() {
            HumanBehavior::from_profile(p)
                .validate_strict()
                .unwrap_or_else(|e| panic!("validate_strict failed for {p}: {e}"));
        }
    }

    #[test]
    fn validate_detects_zero_speed() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.mouse.base_speed_px_per_sec = 0.0;
        let errs = hb.validate();
        assert!(!errs.is_empty(), "zero speed should fail validation");
        assert!(errs.iter().any(|e| e.contains("base_speed")));
    }

    #[test]
    fn validate_detects_invalid_speed_jitter() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.mouse.speed_jitter = 1.5; // out of [0, 1]
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("speed_jitter")));
    }

    #[test]
    fn validate_detects_invalid_overshoot_prob() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.mouse.overshoot_prob = -0.1;
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("overshoot_prob")));
    }

    #[test]
    fn validate_detects_zero_wpm() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.typing.base_wpm = 0.0;
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("base_wpm")));
    }

    #[test]
    fn validate_detects_inverted_burst() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.typing.burst_min_chars = 20;
        hb.typing.burst_max_chars = 5; // min > max
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("burst_min_chars")));
    }

    #[test]
    fn validate_detects_inverted_pause() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.typing.pause_min_ms = 1000;
        hb.typing.pause_max_ms = 100; // min > max
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("pause_min_ms")));
    }

    #[test]
    fn validate_detects_typo_rate_out_of_range() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.typing.typo_rate = 2.0; // > 1
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("typo_rate")));
    }

    #[test]
    fn validate_detects_double_tap_rate_out_of_range() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.typing.double_tap_rate = -0.01;
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("double_tap_rate")));
    }

    #[test]
    fn validate_detects_zero_scroll_velocity() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.scroll.initial_velocity_px = 0.0;
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("initial_velocity_px")));
    }

    #[test]
    fn validate_detects_momentum_decay_gte_one() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.scroll.momentum_decay = 1.0; // must be < 1
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("momentum_decay")));
    }

    #[test]
    fn validate_detects_inverted_scroll_ticks() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.scroll.tick_min_ms = 100;
        hb.scroll.tick_max_ms = 10;
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("tick_min_ms")));
    }

    #[test]
    fn validate_detects_inverted_page_load_pause() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.macro_b.page_load_pause_min_ms = 9999;
        hb.macro_b.page_load_pause_max_ms = 100;
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("page_load_pause_min_ms")));
    }

    #[test]
    fn validate_detects_idle_pause_prob_out_of_range() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.macro_b.idle_pause_prob = 1.5;
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("idle_pause_prob")));
    }

    #[test]
    fn validate_detects_premove_prob_out_of_range() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.macro_b.random_premove_prob = -0.5;
        let errs = hb.validate();
        assert!(!errs.is_empty());
        assert!(errs.iter().any(|e| e.contains("random_premove_prob")));
    }

    #[test]
    fn validate_strict_returns_err_on_invalid() {
        let mut hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        hb.mouse.base_speed_px_per_sec = 0.0;
        assert!(hb.validate_strict().is_err());
    }

    // ── Mouse config per-profile ──────────────────────────────────────────────

    #[test]
    fn mouse_speed_positive_for_all_profiles() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                hb.mouse.base_speed_px_per_sec > 0.0,
                "base_speed_px_per_sec must be > 0 for profile {p}"
            );
        }
    }

    #[test]
    fn mouse_jitter_in_unit_range() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                (0.0..=1.0).contains(&hb.mouse.speed_jitter),
                "speed_jitter out of [0,1] for {p}: {}",
                hb.mouse.speed_jitter
            );
            assert!(
                (0.0..=1.0).contains(&hb.mouse.overshoot_prob),
                "overshoot_prob out of [0,1] for {p}: {}",
                hb.mouse.overshoot_prob
            );
            assert!(
                (0.0..=1.0).contains(&hb.mouse.micro_jitter_prob),
                "micro_jitter_prob out of [0,1] for {p}: {}",
                hb.mouse.micro_jitter_prob
            );
        }
    }

    #[test]
    fn cautious_mouse_slower_than_fast() {
        let fast = HumanBehavior::from_profile(BehaviorProfile::Fast);
        let cautious = HumanBehavior::from_profile(BehaviorProfile::Cautious);
        assert!(
            cautious.mouse.base_speed_px_per_sec < fast.mouse.base_speed_px_per_sec,
            "cautious mouse should be slower than fast"
        );
    }

    #[test]
    fn bot_mouse_fastest() {
        let bot = HumanBehavior::from_profile(BehaviorProfile::Bot);
        let cautious = HumanBehavior::from_profile(BehaviorProfile::Cautious);
        assert!(
            bot.mouse.base_speed_px_per_sec > cautious.mouse.base_speed_px_per_sec,
            "bot mouse should be faster than cautious"
        );
    }

    // ── Typing config per-profile ─────────────────────────────────────────────

    #[test]
    fn typing_wpm_positive_for_all_profiles() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                hb.typing.base_wpm > 0.0,
                "base_wpm must be > 0 for profile {p}"
            );
        }
    }

    #[test]
    fn typing_burst_min_le_max() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                hb.typing.burst_min_chars <= hb.typing.burst_max_chars,
                "burst_min > burst_max for {p}"
            );
        }
    }

    #[test]
    fn typing_pause_min_le_max() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                hb.typing.pause_min_ms <= hb.typing.pause_max_ms,
                "pause_min > pause_max for {p}"
            );
        }
    }

    #[test]
    fn typing_typo_rate_in_range() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                (0.0..=1.0).contains(&hb.typing.typo_rate),
                "typo_rate out of [0,1] for {p}: {}",
                hb.typing.typo_rate
            );
        }
    }

    #[test]
    fn typing_double_tap_rate_in_range() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                (0.0..=1.0).contains(&hb.typing.double_tap_rate),
                "double_tap_rate out of [0,1] for {p}: {}",
                hb.typing.double_tap_rate
            );
        }
    }

    #[test]
    fn typing_think_pauses_ordered() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                hb.typing.think_pause_min_ms <= hb.typing.think_pause_max_ms,
                "think_pause_min > think_pause_max for {p}"
            );
        }
    }

    #[test]
    fn cautious_types_slower_than_fast() {
        let fast = HumanBehavior::from_profile(BehaviorProfile::Fast);
        let cautious = HumanBehavior::from_profile(BehaviorProfile::Cautious);
        assert!(
            cautious.typing.base_wpm < fast.typing.base_wpm,
            "cautious should type slower than fast"
        );
    }

    #[test]
    fn bot_has_zero_typo_rate() {
        let bot = HumanBehavior::from_profile(BehaviorProfile::Bot);
        assert_eq!(
            bot.typing.typo_rate.to_bits(),
            0.0f64.to_bits(),
            "bot profile should have zero typo rate"
        );
    }

    // ── Scroll config per-profile ─────────────────────────────────────────────

    #[test]
    fn scroll_velocity_positive_for_all_profiles() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                hb.scroll.initial_velocity_px > 0.0,
                "initial_velocity_px must be > 0 for profile {p}"
            );
        }
    }

    #[test]
    fn scroll_momentum_decay_in_range() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                hb.scroll.momentum_decay > 0.0 && hb.scroll.momentum_decay < 1.0,
                "momentum_decay must be in (0,1) for {p}: {}",
                hb.scroll.momentum_decay
            );
        }
    }

    #[test]
    fn scroll_ticks_ordered() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                hb.scroll.tick_min_ms <= hb.scroll.tick_max_ms,
                "tick_min_ms > tick_max_ms for {p}"
            );
        }
    }

    // ── MacroBehavior per-profile ─────────────────────────────────────────────

    #[test]
    fn macro_page_load_pauses_ordered() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                hb.macro_b.page_load_pause_min_ms <= hb.macro_b.page_load_pause_max_ms,
                "page_load_pause_min > max for {p}"
            );
        }
    }

    #[test]
    fn macro_inter_action_pauses_ordered() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                hb.macro_b.inter_action_min_ms <= hb.macro_b.inter_action_max_ms,
                "inter_action_min > max for {p}"
            );
        }
    }

    #[test]
    fn macro_idle_pause_prob_in_range() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                (0.0..=1.0).contains(&hb.macro_b.idle_pause_prob),
                "idle_pause_prob out of [0,1] for {p}: {}",
                hb.macro_b.idle_pause_prob
            );
        }
    }

    #[test]
    fn macro_premove_prob_in_range() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            assert!(
                (0.0..=1.0).contains(&hb.macro_b.random_premove_prob),
                "random_premove_prob out of [0,1] for {p}: {}",
                hb.macro_b.random_premove_prob
            );
        }
    }

    #[test]
    fn cautious_has_longer_page_load_pauses_than_bot() {
        let bot = HumanBehavior::from_profile(BehaviorProfile::Bot);
        let cautious = HumanBehavior::from_profile(BehaviorProfile::Cautious);
        assert!(
            cautious.macro_b.page_load_pause_min_ms >= bot.macro_b.page_load_pause_min_ms,
            "cautious should have at least as long page load pauses as bot"
        );
    }

    // ── JSON round-trip ───────────────────────────────────────────────────────

    #[test]
    fn roundtrip_json() {
        let hb = HumanBehavior::from_profile(BehaviorProfile::Normal);
        let json = serde_json::to_string(&hb).expect("serialize");
        let back: HumanBehavior = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.profile, hb.profile);
        assert_eq!(back.typing.base_wpm.to_bits(), hb.typing.base_wpm.to_bits());
        assert_eq!(
            back.mouse.base_speed_px_per_sec.to_bits(),
            hb.mouse.base_speed_px_per_sec.to_bits()
        );
        assert_eq!(
            back.scroll.initial_velocity_px.to_bits(),
            hb.scroll.initial_velocity_px.to_bits()
        );
    }

    #[test]
    fn all_profiles_survive_json_roundtrip() {
        for p in all_profiles() {
            let hb = HumanBehavior::from_profile(p);
            let json = serde_json::to_string(&hb).unwrap();
            let back: HumanBehavior = serde_json::from_str(&json).unwrap();
            assert_eq!(back.profile, hb.profile);
            assert_eq!(
                back.typing.base_wpm.to_bits(),
                hb.typing.base_wpm.to_bits(),
                "WPM mismatch after roundtrip for {p}"
            );
        }
    }

    // ── Default ───────────────────────────────────────────────────────────────

    #[test]
    fn default_is_normal_profile() {
        let hb = HumanBehavior::default();
        assert_eq!(hb.profile, BehaviorProfile::Normal);
    }
}
