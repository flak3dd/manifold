// ── Manifold human layer — behavioral entropy tracker ─────────────────────────
//
// Implements second-order behavioral statistics that 2026-era WAF ML models
// use to distinguish human from bot traffic:
//
//   • Shannon entropy of velocity / IKI / pause time histograms
//   • Velocity kurtosis tracker (target > 5.0 for realistic mixture model)
//   • Curvature histogram entropy (target > 3.1 bits)
//   • Fitts' law dwell-time scaling (target acquisition difficulty → pause)
//   • Hick's law think-time scaling (choice complexity → decision latency)
//   • Inter-click dependency chains (post-action fatigue / momentum state)
//   • Live entropy feedback loop: when uniformity is detected, variance is
//     amplified automatically to bring entropy back above the floor.
//
// Usage:
//
//   const tracker = new EntropyTracker();
//
//   // Before every mouse move — returns an adjusted delay multiplier
//   const mult = tracker.beforeMove({ from, to, targetSize, numChoices });
//   // After every mouse step — record velocity sample
//   tracker.recordVelocity(px_per_sec);
//   // After click — record inter-click time and update fatigue state
//   tracker.afterClick(holdMs);
//   // After keyboard IKI — record and get feedback
//   tracker.recordIki(ms);
//   // After pause — record and get feedback
//   tracker.recordPause(ms);
//   // Periodically check entropy health (call after every ~50 actions)
//   const report = tracker.report();

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Welford online algorithm for running mean + M2 (variance). */
class OnlineStats {
  n = 0;
  mean = 0;
  M2 = 0;
  min = Infinity;
  max = -Infinity;

  push(x: number): void {
    this.n++;
    const delta = x - this.mean;
    this.mean += delta / this.n;
    const delta2 = x - this.mean;
    this.M2 += delta * delta2;
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
  }

  /** Population variance (0 if n < 2). */
  get variance(): number {
    return this.n < 2 ? 0 : this.M2 / (this.n - 1);
  }

  /** Standard deviation. */
  get stddev(): number {
    return Math.sqrt(this.variance);
  }

  /**
   * Excess kurtosis (Fisher definition, 0 for normal distribution).
   * Tracked via a 4th-moment accumulator separately.
   * Returns NaN until ≥ 8 samples.
   */
}

/** Fixed-width histogram over a bounded domain. */
class Histogram {
  private bins: Float64Array;
  private total = 0;

  constructor(
    private readonly numBins: number,
    private readonly lo: number,
    private readonly hi: number,
  ) {
    this.bins = new Float64Array(numBins);
  }

  push(value: number): void {
    const clamped = Math.max(this.lo, Math.min(this.hi - 1e-9, value));
    const idx = Math.floor(((clamped - this.lo) / (this.hi - this.lo)) * this.numBins);
    const safe = Math.max(0, Math.min(this.numBins - 1, idx));
    this.bins[safe]++;
    this.total++;
  }

  /** Shannon entropy in bits. */
  entropy(): number {
    if (this.total === 0) return 0;
    let H = 0;
    for (let i = 0; i < this.numBins; i++) {
      const p = this.bins[i] / this.total;
      if (p > 0) H -= p * Math.log2(p);
    }
    return H;
  }

  /** Approximate excess kurtosis from histogram moments. */
  kurtosis(): number {
    if (this.total < 8) return NaN;
    let mean = 0;
    for (let i = 0; i < this.numBins; i++) {
      const mid = this.lo + ((i + 0.5) / this.numBins) * (this.hi - this.lo);
      mean += (this.bins[i] / this.total) * mid;
    }
    let m2 = 0, m4 = 0;
    for (let i = 0; i < this.numBins; i++) {
      const mid = this.lo + ((i + 0.5) / this.numBins) * (this.hi - this.lo);
      const p = this.bins[i] / this.total;
      const d = mid - mean;
      m2 += p * d * d;
      m4 += p * d * d * d * d;
    }
    if (m2 < 1e-10) return NaN;
    return m4 / (m2 * m2) - 3; // excess kurtosis
  }

  get count(): number {
    return this.total;
  }

  reset(): void {
    this.bins.fill(0);
    this.total = 0;
  }
}

// ── Fitts' Law ────────────────────────────────────────────────────────────────
//
// Movement time MT = a + b * log2(2D/W)
// where D = distance (px), W = target width (px), a ≈ 50 ms, b ≈ 140 ms/bit.
// We use this to scale pre-click hesitation: larger ID → more think time.

const FITTS_A = 50;   // ms intercept
const FITTS_B = 140;  // ms/bit

/**
 * Compute Fitts' Index of Difficulty.
 * @param distancePx  pixels from cursor to target centre
 * @param targetSizePx  width (or min dimension) of the target in px
 */
export function fittsId(distancePx: number, targetSizePx: number): number {
  const effective = Math.max(1, targetSizePx);
  const d = Math.max(1, distancePx);
  return Math.log2((2 * d) / effective);
}

/**
 * Predicted movement time from Fitts' model (ms).
 * Clamp to [80, 2000] ms for practical use.
 */
export function fittsMt(distancePx: number, targetSizePx: number): number {
  const id = fittsId(distancePx, targetSizePx);
  return Math.max(80, Math.min(2000, FITTS_A + FITTS_B * id));
}

// ── Hick's Law ────────────────────────────────────────────────────────────────
//
// Reaction time RT = b * log2(n + 1)
// where n = number of choices, b ≈ 150 ms/bit.
// Used to scale think-time before clicking on elements in complex UIs
// (e.g. dropdown with 12 items → more delay than a single button).

const HICK_B = 150;  // ms/bit

/**
 * Predicted decision time from Hick's law (ms).
 * @param numChoices  number of equally-likely alternatives (1 = no choice)
 */
export function hickRt(numChoices: number): number {
  const n = Math.max(1, numChoices);
  return Math.max(0, HICK_B * Math.log2(n + 1));
}

// ── Entropy targets ───────────────────────────────────────────────────────────

export interface EntropyTargets {
  /** Minimum velocity histogram entropy (bits). Default: 5.8 */
  velocityEntropyFloor: number;
  /** Minimum IKI histogram entropy (bits). Default: 4.2 */
  ikiEntropyFloor: number;
  /** Minimum pause histogram entropy (bits). Default: 3.8 */
  pauseEntropyFloor: number;
  /** Minimum velocity excess kurtosis. Default: 3.5 (realistic mixture > 5) */
  velocityKurtosisFloor: number;
}

export const DEFAULT_ENTROPY_TARGETS: EntropyTargets = {
  velocityEntropyFloor: 5.8,
  ikiEntropyFloor: 4.2,
  pauseEntropyFloor: 3.8,
  velocityKurtosisFloor: 3.5,
};

// ── Interaction fatigue state ─────────────────────────────────────────────────
//
// Inter-click dependency chains model how human fatigue / momentum affects
// subsequent actions. After a complex interaction (many clicks, long typing),
// the user slows down. After a page load, there is a "fresh start" hesitation.

interface FatigueState {
  /** Accumulated "cognitive load" — increases with actions, decays over time. */
  cognitiveLoad: number;
  /** Timestamp of last action (ms since epoch). */
  lastActionTs: number;
  /** Running count of actions since last page-load pause. */
  actionsSinceReset: number;
  /** Whether the user just completed a complex interaction. */
  complexInteractionPending: boolean;
}

// ── EntropyReport ─────────────────────────────────────────────────────────────

export interface EntropyReport {
  velocityEntropy: number;
  ikiEntropy: number;
  pauseEntropy: number;
  velocityKurtosis: number;
  velocityCount: number;
  ikiCount: number;
  pauseCount: number;
  /** Overall entropy health score 0–1 (1 = all targets met). */
  healthScore: number;
  /** True if any metric is below its floor and variance should be amplified. */
  amplifyVariance: boolean;
  /** Recommended multiplier for timing variance (1.0 = no change, 1.5 = +50%). */
  varianceMultiplier: number;
  flags: string[];
}

// ── EntropyTracker ────────────────────────────────────────────────────────────

/**
 * Session-level behavioral entropy tracker.
 *
 * Maintains histograms + running stats for velocity, IKI, and pause times.
 * Exposes a live feedback API that returns variance multipliers to the
 * HumanMouse / HumanKeyboard classes when entropy falls below target floors.
 */
export class EntropyTracker {
  // Histograms — ranges chosen to cover 99th-percentile real human data
  private readonly velHist = new Histogram(64, 0, 4000);     // px/s
  private readonly ikiHist = new Histogram(48, 10, 1200);    // ms
  private readonly pauseHist = new Histogram(40, 50, 5000);  // ms
  private readonly curvHist = new Histogram(32, 0, Math.PI); // curvature angle

  // Running stats (for kurtosis computation beyond histogram approximation)
  private readonly velStats = new OnlineStats();
  private readonly ikiStats = new OnlineStats();

  // 4th-moment accumulators for exact kurtosis
  private velM4Acc = 0;
  private velM3Acc = 0;

  // Inter-click dependency chain
  private fatigue: FatigueState = {
    cognitiveLoad: 0,
    lastActionTs: Date.now(),
    actionsSinceReset: 0,
    complexInteractionPending: false,
  };

  // Variance multiplier set by the feedback loop (applied by callers)
  private _varianceMultiplier = 1.0;

  // Sliding window for recent velocity samples (last 200 moves)
  private recentVelocities: number[] = [];
  private readonly WINDOW = 200;

  constructor(private readonly targets: EntropyTargets = DEFAULT_ENTROPY_TARGETS) {}

  // ── Public recording API ────────────────────────────────────────────────────

  /** Record a mouse velocity sample (px/s). Call once per mouse-move step. */
  recordVelocity(pxPerSec: number): void {
    this.velHist.push(pxPerSec);
    this.velStats.push(pxPerSec);

    // Maintain sliding window for recent-only entropy check
    this.recentVelocities.push(pxPerSec);
    if (this.recentVelocities.length > this.WINDOW) {
      this.recentVelocities.shift();
    }

    // Update 4th-moment accumulator for exact excess kurtosis
    if (this.velStats.n >= 4) {
      const d = pxPerSec - this.velStats.mean;
      this.velM4Acc += d * d * d * d;
    }
  }

  /** Record a curvature angle sample (radians 0–π). */
  recordCurvature(angleRad: number): void {
    this.curvHist.push(Math.abs(angleRad));
  }

  /** Record an inter-keystroke interval (ms). */
  recordIki(ms: number): void {
    this.ikiHist.push(ms);
    this.ikiStats.push(ms);
    this._updateFatigue(0.3); // typing is moderately fatiguing
  }

  /** Record a pause duration (ms). */
  recordPause(ms: number): void {
    this.pauseHist.push(ms);
    this._updateFatigue(-0.5 * Math.min(ms / 500, 2)); // pauses restore energy
  }

  /** Record a click event. Returns recommended post-click pause (ms). */
  afterClick(holdMs: number): number {
    this._updateFatigue(0.8); // clicking is cognitively loading
    this.fatigue.actionsSinceReset++;

    // Flag complex interaction when many actions in a short window
    if (this.fatigue.actionsSinceReset > 12) {
      this.fatigue.complexInteractionPending = true;
    }

    // Inter-click dependency: post-click recovery time scales with fatigue
    const basePause = 80 + holdMs * 0.4;
    const fatiguePenalty = this.fatigue.cognitiveLoad * 40;
    return Math.min(800, basePause + fatiguePenalty);
  }

  /** Signal a page-load event — resets action counter and softens fatigue. */
  onPageLoad(): void {
    this.fatigue.actionsSinceReset = 0;
    this.fatigue.complexInteractionPending = false;
    this.fatigue.cognitiveLoad = Math.max(0, this.fatigue.cognitiveLoad * 0.3);
  }

  // ── Fitts + Hick integration ────────────────────────────────────────────────

  /**
   * Compute an adjusted pre-action delay (ms) combining:
   *   - Fitts' law movement time (distance / target size)
   *   - Hick's law decision time (number of alternatives)
   *   - Current fatigue state (cognitive load penalty)
   *   - Live entropy feedback multiplier (amplify if below floor)
   *
   * @param distancePx     Euclidean distance cursor will travel (px)
   * @param targetSizePx   Min dimension of the target element (px)
   * @param numChoices     Number of UI alternatives (1 for single button, n for menu)
   * @param rngJitter      Additional jitter factor 0–1 supplied by caller's RNG
   */
  fittsHickDelay(
    distancePx: number,
    targetSizePx: number,
    numChoices: number,
    rngJitter: number,
  ): number {
    const mt = fittsMt(distancePx, targetSizePx);
    const rt = hickRt(numChoices);

    // Fatigue penalty: 0–30% slowdown based on cognitive load (0–10 scale)
    const fatigueFactor = 1 + Math.min(0.30, this.fatigue.cognitiveLoad * 0.03);

    // Entropy feedback: if variance is being amplified, jitter pre-action delay too
    const entropyFactor = this._varianceMultiplier;

    // Log-normal noise on top (rngJitter is a [0,1] uniform from caller)
    const noise = 0.85 + rngJitter * 0.30;

    return (mt + rt) * fatigueFactor * entropyFactor * noise;
  }

  /**
   * Velocity variance multiplier: if recent velocity entropy is below floor,
   * returns > 1 to tell the caller to spread its speed distribution wider.
   */
  velocityMultiplier(): number {
    return this._varianceMultiplier;
  }

  // ── Entropy report ──────────────────────────────────────────────────────────

  /**
   * Compute the current entropy health report.
   * Should be called every 50–100 actions.
   * The returned `varianceMultiplier` should be fed back to `HumanMouse`
   * and `HumanKeyboard` to bump their jitter parameters.
   */
  report(): EntropyReport {
    const ve = this.velHist.entropy();
    const ie = this.ikiHist.entropy();
    const pe = this.pauseHist.entropy();
    const vk = this._exactKurtosis();

    const flags: string[] = [];

    // Check each metric against its floor
    let healthParts = 0;
    let healthTotal = 0;

    const checkFloor = (
      label: string,
      value: number,
      floor: number,
      weight: number,
    ): number => {
      healthTotal += weight;
      if (isNaN(value)) {
        return 0; // not enough data yet
      }
      if (value < floor) {
        flags.push(`LOW_${label.toUpperCase()}: ${value.toFixed(2)} < ${floor}`);
        healthParts += weight * (value / floor);
        return value / floor;
      }
      healthParts += weight;
      return 1;
    };

    const veRatio = checkFloor('velocity_entropy', ve, this.targets.velocityEntropyFloor, 3);
    const ieRatio = checkFloor('iki_entropy', ie, this.targets.ikiEntropyFloor, 2);
    const peRatio = checkFloor('pause_entropy', pe, this.targets.pauseEntropyFloor, 1);
    const vkRatio = checkFloor('velocity_kurtosis', vk, this.targets.velocityKurtosisFloor, 2);

    const healthScore = healthTotal > 0 ? healthParts / healthTotal : 1;

    // ── Live feedback: compute variance multiplier ──────────────────────────
    // When health < 0.85, increase variance multiplier.
    // When health > 0.95, decay multiplier back toward 1.0.
    const amplify = healthScore < 0.85;
    let mult = this._varianceMultiplier;

    if (amplify) {
      // Bump multiplier — proportional to how far below target we are
      const deficit = 1 - healthScore;
      mult = Math.min(2.5, mult + deficit * 0.4);
      flags.push(`VARIANCE_AMPLIFIED: x${mult.toFixed(2)}`);
    } else if (healthScore > 0.95 && mult > 1.0) {
      // Decay slowly back toward 1.0
      mult = Math.max(1.0, mult * 0.92);
    }

    this._varianceMultiplier = mult;

    // Flag suspicious uniformity in the recent velocity window
    if (this.recentVelocities.length >= 50) {
      const recentEntropy = this._recentVelocityEntropy();
      if (recentEntropy < this.targets.velocityEntropyFloor * 0.7) {
        flags.push(`RECENT_VELOCITY_UNIFORM: H=${recentEntropy.toFixed(2)}`);
      }
    }

    return {
      velocityEntropy: ve,
      ikiEntropy: ie,
      pauseEntropy: pe,
      velocityKurtosis: isNaN(vk) ? 0 : vk,
      velocityCount: this.velHist.count,
      ikiCount: this.ikiHist.count,
      pauseCount: this.pauseHist.count,
      healthScore,
      amplifyVariance: amplify,
      varianceMultiplier: mult,
      flags,
    };
  }

  /** Reset all histograms (e.g. when starting a new session). */
  reset(): void {
    this.velHist.reset();
    this.ikiHist.reset();
    this.pauseHist.reset();
    this.curvHist.reset();
    this.velM4Acc = 0;
    this.velM3Acc = 0;
    this._varianceMultiplier = 1.0;
    this.recentVelocities = [];
    this.fatigue = {
      cognitiveLoad: 0,
      lastActionTs: Date.now(),
      actionsSinceReset: 0,
      complexInteractionPending: false,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Update fatigue state with a cognitive-load delta. */
  private _updateFatigue(delta: number): void {
    const now = Date.now();
    const elapsedSec = (now - this.fatigue.lastActionTs) / 1000;

    // Exponential decay: half-life ≈ 30 seconds of inactivity
    this.fatigue.cognitiveLoad *= Math.exp(-elapsedSec / 30);

    // Apply delta and clamp to [0, 10]
    this.fatigue.cognitiveLoad = Math.max(
      0,
      Math.min(10, this.fatigue.cognitiveLoad + delta),
    );

    this.fatigue.lastActionTs = now;
  }

  /**
   * Exact excess kurtosis from accumulated moments.
   * Falls back to histogram approximation if not enough direct samples.
   */
  private _exactKurtosis(): number {
    const n = this.velStats.n;
    if (n < 8) return NaN;

    const variance = this.velStats.variance;
    if (variance < 1e-10) return NaN;

    // Sample excess kurtosis via 4th central moment
    // K = [n(n+1) / ((n-1)(n-2)(n-3))] * sum(z^4) - 3(n-1)^2/((n-2)(n-3))
    const sumZ4 = this.velM4Acc / Math.pow(variance, 2);
    const bias_factor =
      (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
    const correction =
      (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));

    const k = bias_factor * sumZ4 - correction;

    // Fall back to histogram if exact value seems degenerate
    if (!isFinite(k)) return this.velHist.kurtosis();

    return k;
  }

  /** Compute entropy of recent velocity window (last 200 samples). */
  private _recentVelocityEntropy(): number {
    if (this.recentVelocities.length < 10) return Infinity;
    const tmp = new Histogram(64, 0, 4000);
    for (const v of this.recentVelocities) tmp.push(v);
    return tmp.entropy();
  }
}

// ── Module-level singleton for bridge/session use ─────────────────────────────

let _globalTracker: EntropyTracker | null = null;

/** Get the session-global EntropyTracker, creating it on first call. */
export function getSessionTracker(targets?: EntropyTargets): EntropyTracker {
  if (!_globalTracker) {
    _globalTracker = new EntropyTracker(targets);
  }
  return _globalTracker;
}

/** Replace the session-global tracker (e.g. at session start). */
export function resetSessionTracker(targets?: EntropyTargets): EntropyTracker {
  _globalTracker = new EntropyTracker(targets);
  return _globalTracker;
}
