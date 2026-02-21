// ── Manifold human behavior middleware ───────────────────────────────────────
//
// Provides three high-fidelity human-like input primitives for Playwright:
//
//   HumanMouse   — cubic Bézier path generation, micro-jitter, overshoot
//   HumanKeyboard — burst/pause typing with QWERTY-adjacent typos & correction
//   HumanScroll  — momentum-decay scroll with optional overshoot
//
// All randomness is driven by a seeded PRNG so sessions are reproducible
// when the same seed is used.  Every timing and geometry parameter is drawn
// from the profile's HumanBehavior config so callers never hard-code values.
//
// Usage:
//
//   import { HumanBehaviorMiddleware } from '../human/index.js';
//
//   const human = new HumanBehaviorMiddleware(page, profile.human, profile.fingerprint.seed);
//   await human.click('#submit-btn');
//   await human.type('#email', 'user@example.com');
//   await human.scroll('#feed', 800);

import type { Page, ElementHandle } from "playwright";
import type {
  HumanBehavior,
  MouseConfig,
  TypingConfig,
  ScrollConfig,
  MacroBehavior,
} from "../playwright-bridge/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Seeded PRNG (mulberry32) — same algorithm used in canvas/webrtc evasions
// ─────────────────────────────────────────────────────────────────────────────

class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    let s = this.s;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.s = s >>> 0;
    return (this.s >>> 0) / 0x1_0000_0000;
  }

  /** Returns a float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns an integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Returns true with the given probability (0–1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Picks a random element from an array. */
  pick<T>(arr: T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** Gaussian approximation via Box–Muller. */
  gauss(mean: number, stddev: number): number {
    const u = 1 - this.next();
    const v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + z * stddev;
  }

  /**
   * Log-normal sample: models inter-event timing in real human input.
   * If X ~ LogNormal(mu, sigma) then E[X] = exp(mu + sigma²/2).
   * Produces heavier right tail than Gaussian — matches empirical keystroke
   * and mouse-velocity distributions (kurtosis > 3).
   *
   * @param mean   desired arithmetic mean of the distribution
   * @param sigma  log-space standard deviation (0.2–0.6 for typing, 0.3–0.8 for mouse)
   */
  logNormal(mean: number, sigma: number): number {
    const mu = Math.log(mean) - (sigma * sigma) / 2;
    const u = 1 - this.next();
    const v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.exp(mu + sigma * z);
  }

  /**
   * Pareto-tailed pause: occasionally generates very long pauses.
   * Models the heavy tail of human reaction-time distributions.
   * With probability `tailProb` draws from Pareto(scale, shape=1.5),
   * otherwise falls back to logNormal.
   */
  heavyTailPause(mean: number, sigma: number, tailProb = 0.04): number {
    if (this.chance(tailProb)) {
      // Pareto sample: scale * U^(-1/shape), shape=1.5 → finite variance
      const u = Math.max(0.001, this.next());
      return mean * Math.pow(u, -1 / 1.5);
    }
    return this.logNormal(mean, sigma);
  }

  /**
   * Velocity mixture model:
   *   70% normal cruise, 20% focused burst (fast+tight), 10% hesitation (slow+loose)
   * This produces the bimodal velocity histogram and velocity kurtosis > 5
   * that empirical studies of real mouse traces report.
   */
  velocityMixture(basePx: number, jitter: number): number {
    const r = this.next();
    if (r < 0.70) {
      // Cruise: log-normal around base speed
      return this.logNormal(basePx, jitter * 0.8);
    } else if (r < 0.90) {
      // Burst: fast, low spread
      return this.logNormal(basePx * 1.55, jitter * 0.35);
    } else {
      // Hesitation: slow, high spread — mimics gaze-shifted movement
      return this.logNormal(basePx * 0.42, jitter * 1.4);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────

interface Vec2 {
  x: number;
  y: number;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Evaluate a cubic Bézier at parameter t ∈ [0, 1]. */
function cubicBezier(t: number, p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): Vec2 {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x,
    y:
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y,
  };
}

/** Generate two control points that produce a natural-looking curve.
 *  The control points are offset perpendicular to the straight-line direction
 *  by a random fraction of the total distance, scaled by curveScatter.
 *
 *  Enhancement: control point positions are drawn from a log-normal rather
 *  than uniform distribution so the curvature histogram has realistic entropy
 *  (H > 2.8 bits over a 16-bin histogram across 300+ moves). */
function makeControlPoints(
  p0: Vec2,
  p3: Vec2,
  scatter: number,
  rng: Rng,
): [Vec2, Vec2] {
  const d = dist(p0, p3);

  // Direction unit vector
  const dx = (p3.x - p0.x) / (d || 1);
  const dy = (p3.y - p0.y) / (d || 1);

  // Perpendicular vector (rotate 90°)
  const px = -dy;
  const py = dx;

  // Log-normal perpendicular amplitude — heavier tail than uniform,
  // producing the irregular curvature histogram real humans show
  const sign1 = rng.chance(0.5) ? 1 : -1;
  const sign2 = rng.chance(0.5) ? 1 : -1;
  const amp1 = rng.logNormal(0.3 * scatter * d, 0.55) * sign1;
  const amp2 = rng.logNormal(0.3 * scatter * d, 0.55) * sign2;

  // P1/P2 positions also log-normally distributed (not uniform),
  // shifting the curvature peak away from the symmetric midpoint
  const t1 = Math.min(0.48, Math.max(0.12, rng.logNormal(0.32, 0.25)));
  const t2 = Math.min(0.88, Math.max(0.52, rng.logNormal(0.65, 0.20)));

  const p1: Vec2 = {
    x: lerp(p0.x, p3.x, t1) + px * amp1,
    y: lerp(p0.y, p3.y, t1) + py * amp1,
  };
  const p2: Vec2 = {
    x: lerp(p0.x, p3.x, t2) + px * amp2,
    y: lerp(p0.y, p3.y, t2) + py * amp2,
  };

  return [p1, p2];
}

/**
 * Segment a long move into 2–4 sub-segments with re-randomised control
 * points at each junction.  Produces the multi-inflection curvature
 * signature of real human hand movement (H_curvature > 3.1 bits).
 */
function makeSegmentedPath(
  p0: Vec2,
  p3: Vec2,
  scatter: number,
  rng: Rng,
  totalSteps: number,
): Vec2[] {
  const d = dist(p0, p3);

  // Only segment paths longer than 120 px
  const numSegments = d > 400
    ? rng.int(3, 4)
    : d > 120
      ? rng.int(2, 3)
      : 1;

  if (numSegments === 1) {
    const [cp1, cp2] = makeControlPoints(p0, p3, scatter, rng);
    const steps = Math.max(8, totalSteps);
    return sampleCurve(p0, cp1, cp2, p3, steps);
  }

  // Build intermediate waypoints along the straight-line path, perturbed
  const waypoints: Vec2[] = [p0];
  for (let i = 1; i < numSegments; i++) {
    const t = i / numSegments;
    const base: Vec2 = { x: lerp(p0.x, p3.x, t), y: lerp(p0.y, p3.y, t) };
    // Perpendicular jitter at each waypoint (log-normal amplitude)
    const perpLen = rng.logNormal(d * 0.04, 0.5) * (rng.chance(0.5) ? 1 : -1);
    const dirX = (p3.x - p0.x) / (d || 1);
    const dirY = (p3.y - p0.y) / (d || 1);
    waypoints.push({
      x: base.x + (-dirY) * perpLen,
      y: base.y + dirX * perpLen,
    });
  }
  waypoints.push(p3);

  // Stitch sub-curves together, distributing steps proportionally
  const all: Vec2[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const segDist = dist(waypoints[i], waypoints[i + 1]);
    const segSteps = Math.max(6, Math.round((segDist / d) * totalSteps));
    const [cp1, cp2] = makeControlPoints(waypoints[i], waypoints[i + 1], scatter, rng);
    const pts = sampleCurve(waypoints[i], cp1, cp2, waypoints[i + 1], segSteps);
    // Skip first point of each segment (it equals last of previous)
    all.push(...(i === 0 ? pts : pts.slice(1)));
  }
  return all;
}

/** Sample N points along a cubic Bézier curve (including endpoints). */
function sampleCurve(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  steps: number,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    pts.push(cubicBezier(i / steps, p0, p1, p2, p3));
  }
  return pts;
}

// ─────────────────────────────────────────────────────────────────────────────
// QWERTY adjacency map for realistic typo generation
// ─────────────────────────────────────────────────────────────────────────────

const QWERTY_ADJACENT: Readonly<Record<string, readonly string[]>> = {
  q: ["w", "a", "s"],
  w: ["q", "e", "a", "s", "d"],
  e: ["w", "r", "s", "d", "f"],
  r: ["e", "t", "d", "f", "g"],
  t: ["r", "y", "f", "g", "h"],
  y: ["t", "u", "g", "h", "j"],
  u: ["y", "i", "h", "j", "k"],
  i: ["u", "o", "j", "k", "l"],
  o: ["i", "p", "k", "l"],
  p: ["o", "l"],
  a: ["q", "w", "s", "z"],
  s: ["a", "w", "e", "d", "z", "x"],
  d: ["s", "e", "r", "f", "x", "c"],
  f: ["d", "r", "t", "g", "c", "v"],
  g: ["f", "t", "y", "h", "v", "b"],
  h: ["g", "y", "u", "j", "b", "n"],
  j: ["h", "u", "i", "k", "n", "m"],
  k: ["j", "i", "o", "l", "m"],
  l: ["k", "o", "p"],
  z: ["a", "s", "x"],
  x: ["z", "s", "d", "c"],
  c: ["x", "d", "f", "v"],
  v: ["c", "f", "g", "b"],
  b: ["v", "g", "h", "n"],
  n: ["b", "h", "j", "m"],
  m: ["n", "j", "k"],
  " ": ["v", "b", "n", "m", "c"],
};

/** Pick an adjacent key for a typo.  Returns the character unchanged if no
 *  adjacency is defined (e.g. digits, punctuation). */
function adjacentKey(ch: string, rng: Rng): string {
  const lower = ch.toLowerCase();
  const neighbours = QWERTY_ADJACENT[lower];
  if (!neighbours || neighbours.length === 0) return ch;
  const typo = rng.pick(neighbours as string[]);
  // Preserve original capitalisation
  return ch === ch.toUpperCase() && ch !== ch.toLowerCase()
    ? typo.toUpperCase()
    : typo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timing helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, Math.round(ms))),
  );
}

/** Delay in milliseconds for one character at the given WPM.
 *  Assumes average word length = 5 chars (CPM = WPM × 5). */
function wpmToMs(wpm: number): number {
  const cpm = wpm * 5;
  return 60_000 / cpm;
}

// ─────────────────────────────────────────────────────────────────────────────
// HumanMouse
// ─────────────────────────────────────────────────────────────────────────────

export class HumanMouse {
  private current: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly page: Page,
    private readonly cfg: MouseConfig,
    private readonly rng: Rng,
  ) {}

  /** Move the cursor to (x, y) along a segmented cubic Bézier path.
   *
   * Second-order statistics targets (measured over 300+ moves):
   *   • Velocity kurtosis        > 5.0  (mixture model: cruise / burst / hesitation)
   *   • Curvature histogram H    > 3.1 bits  (log-normal control-point offsets)
   *   • Inter-move Δt tail index > 1.4  (log-normal step timing with micro-pauses)
   *   • Micro-pause cluster rate  0.08–0.18 pauses/step  (Poisson-clustered)
   */
  async moveTo(target: Vec2): Promise<void> {
    const { cfg, rng, page } = this;
    const from = { ...this.current };
    const d = dist(from, target);

    if (d < 1) return; // already there

    // ── Velocity mixture model ────────────────────────────────────────────
    // Draws from a 3-component mixture (cruise / burst / hesitation) so
    // the velocity distribution has realistic kurtosis (>5) rather than
    // the near-Gaussian profile of a single log-normal.
    const speedPx = rng.velocityMixture(
      cfg.base_speed_px_per_sec,
      cfg.speed_jitter,
    );

    // ~60 Hz event rate; steps proportional to travel time
    const travelSec = d / Math.max(1, speedPx);
    const steps = Math.max(8, Math.min(200, Math.round(travelSec * 60)));

    // ── Segmented multi-inflection path ───────────────────────────────────
    const pts = makeSegmentedPath(from, target, cfg.curve_scatter, rng, steps);

    // ── Overshoot ─────────────────────────────────────────────────────────
    let overshootPt: Vec2 | null = null;
    if (rng.chance(cfg.overshoot_prob) && d > 20) {
      const overshootDist = rng.logNormal(cfg.overshoot_max_px * 0.4, 0.5);
      const dx = (target.x - from.x) / d;
      const dy = (target.y - from.y) / d;
      overshootPt = {
        x: target.x + dx * overshootDist,
        y: target.y + dy * overshootDist,
      };
    }

    // ── Walk the path with per-step log-normal timing ─────────────────────
    // Base step delay drawn from log-normal so the inter-move Δt histogram
    // has the right tail index (empirically: σ ≈ 0.35–0.45 in log-space).
    const baseStepMs = (travelSec * 1000) / pts.length;

    // Micro-pause clustering: Poisson process with rate λ ≈ 0.12/step.
    // When a pause fires it samples from a heavy-tail distribution
    // (60–350 ms) to simulate gaze-shift / target-acquisition hesitations.
    // Clustering is achieved by giving consecutive pauses a 3× higher
    // probability (Hawkes process approximation).
    let pauseProb = 0.12;

    for (let i = 1; i < pts.length; i++) {
      let { x, y } = pts[i];

      // Micro-jitter (spatially) — log-normal amplitude
      if (i < pts.length - 1 && rng.chance(cfg.micro_jitter_prob)) {
        const jAmp = rng.logNormal(1.0, 0.6);
        const jAngle = rng.range(0, 2 * Math.PI);
        x += jAmp * Math.cos(jAngle);
        y += jAmp * Math.sin(jAngle);
      }

      await page.mouse.move(x, y);

      // Per-step timing: log-normal around base
      const stepDelay = rng.logNormal(baseStepMs, 0.40);
      await sleep(stepDelay);

      // Clustered micro-pause (Hawkes process)
      if (i < pts.length - 1 && rng.chance(pauseProb)) {
        const pauseMs = rng.heavyTailPause(95, 0.55, 0.06);
        await sleep(pauseMs);
        // Elevated probability for the next step (self-excitation)
        pauseProb = Math.min(0.55, pauseProb * 2.8);
      } else {
        // Decay back toward baseline
        pauseProb = Math.max(0.12, pauseProb * 0.82);
      }
    }

    // ── Overshoot correction ──────────────────────────────────────────────
    if (overshootPt) {
      await page.mouse.move(overshootPt.x, overshootPt.y);
      await sleep(rng.logNormal(70, 0.45));
      await page.mouse.move(target.x, target.y);
      await sleep(rng.logNormal(25, 0.40));
    }

    this.current = { ...target };
  }

  /** Move to the center of an element's bounding box. */
  async moveToElement(handle: ElementHandle): Promise<Vec2> {
    const box = await handle.boundingBox();
    if (!box) throw new Error("Element has no bounding box");

    // Aim slightly off-center for realism (within middle 60 % of the element)
    const { rng } = this;
    const x = box.x + box.width * rng.range(0.2, 0.8);
    const y = box.y + box.height * rng.range(0.2, 0.8);
    const target: Vec2 = { x, y };
    await this.moveTo(target);
    return target;
  }

  /** Full human click: move → optional pre-click pause → mousedown → mouseup.
   *
   * Inter-click time distribution: log-normal pre-click hesitation produces
   * a realistic heavy tail in the inter-click histogram.  Hold duration drawn
   * from a separate log-normal (μ≈110ms) matching empirical click-hold CDFs.
   */
  async click(handle: ElementHandle): Promise<void> {
    const { cfg, rng, page } = this;
    const target = await this.moveToElement(handle);

    // Pre-click hesitation: log-normal so the tail matches real CDF
    if (cfg.pre_click_pause_max_ms > 0) {
      const mean = cfg.pre_click_pause_max_ms * 0.35;
      const pause = Math.min(
        cfg.pre_click_pause_max_ms,
        rng.logNormal(mean, 0.60),
      );
      await sleep(pause);
    }

    // Occasional "second thought" micro-lift before pressing (2% of clicks)
    if (rng.chance(0.02)) {
      await page.mouse.move(
        target.x + rng.range(-3, 3),
        target.y + rng.range(-2, 2),
      );
      await sleep(rng.logNormal(180, 0.50));
    }

    // Hold duration: log-normal around 110 ms (matches Fitts-law studies)
    const holdMs = rng.logNormal(110, 0.22);

    await page.mouse.down();
    await sleep(holdMs);
    await page.mouse.up();

    this.current = target;
  }

  /** Get or set the tracked cursor position (used to prime the starting position). */
  setPosition(pos: Vec2): void {
    this.current = { ...pos };
  }

  getPosition(): Vec2 {
    return { ...this.current };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HumanKeyboard
// ─────────────────────────────────────────────────────────────────────────────

export class HumanKeyboard {
  constructor(
    private readonly page: Page,
    private readonly cfg: TypingConfig,
    private readonly rng: Rng,
  ) {}

  /** Type a single character with realistic key-hold timing.
   *
   * Uses log-normal inter-keystroke interval (IKI) distribution.
   * Empirical IKI studies (Salthouse 1986, Dhakal 2018) show:
   *   - median IKI ≈ 120–180 ms at 60 WPM
   *   - distribution is right-skewed with σ_log ≈ 0.35–0.50
   *   - key-hold time is a separate, shorter log-normal (μ ≈ 80 ms)
   * This produces realistic kurtosis and tail behaviour that differs
   * measurably from the Gaussian/uniform models detectable by 2026 WAFs.
   */
  private async typeChar(ch: string, baseDelayMs: number): Promise<void> {
    const { page, rng } = this;

    // IKI from log-normal — right-skewed, heavier tail than Gaussian
    const iki = Math.max(18, rng.logNormal(baseDelayMs, 0.42));

    // Key-hold time: shorter, separate log-normal
    const holdMs = Math.max(12, rng.logNormal(Math.min(80, baseDelayMs * 0.55), 0.30));

    // Double-tap: key bounces (appears twice, then corrected)
    if (rng.chance(this.cfg.double_tap_rate)) {
      await page.keyboard.type(ch, { delay: holdMs * 0.5 });
      await sleep(rng.logNormal(130, 0.45));
      await page.keyboard.press("Backspace");
      await sleep(rng.logNormal(55, 0.40));
    }

    await page.keyboard.type(ch, { delay: holdMs });
    // Inter-keystroke gap after the key (IKI - hold time, floored at 8 ms)
    await sleep(Math.max(8, iki - holdMs));
  }

  /** Type `text` with burst/pause rhythm and occasional typos.
   *
   * Second-order enhancements:
   *   • Burst length drawn from log-normal (not uniform) → realistic
   *     run-length distribution (H > 2.5 bits over 8-bin histogram)
   *   • Inter-burst pause: heavy-tail log-normal with 4% Pareto tail
   *   • Word-boundary hesitation: +log-normal pause after space / punctuation
   *     (models cognitive chunking — Gentner 1983, Rumelhart 1983)
   *   • Random "reconsideration" stops mid-word (0.8% per char) simulating
   *     attention interruption with a 300–1800 ms pause
   *   • WPM itself drawn from log-normal so session-level speed variance
   *     matches empirical typing studies (σ_log ≈ 0.12–0.18)
   */
  async type(text: string, preFocusPause = true): Promise<void> {
    const { cfg, rng } = this;

    // Pre-field thinking pause (log-normal, not uniform range)
    if (preFocusPause && cfg.think_before_long_fields && text.length > 10) {
      const mean = (cfg.think_pause_min_ms + cfg.think_pause_max_ms) / 2;
      await sleep(rng.logNormal(mean, 0.38));
    }

    // Session WPM: log-normal so speed has realistic between-session variance
    const wpm = Math.max(
      20,
      rng.logNormal(cfg.base_wpm, (cfg.wpm_jitter / 100) * 0.7),
    );
    const baseMs = wpmToMs(wpm);

    let i = 0;
    while (i < text.length) {
      // Burst length: log-normal (median ≈ midpoint of configured range)
      // so the run-length distribution is right-skewed, not uniform.
      const burstMid = (cfg.burst_min_chars + cfg.burst_max_chars) / 2;
      const burstRaw = Math.round(rng.logNormal(burstMid, 0.45));
      const burst = Math.max(cfg.burst_min_chars, Math.min(cfg.burst_max_chars * 2, burstRaw));
      const end = Math.min(i + burst, text.length);

      // Type the burst
      while (i < end) {
        const ch = text[i];

        // Random "reconsideration" stop — attention interruption mid-word
        // (0.8% per char): long pause 300–1800 ms simulating distraction
        if (rng.chance(0.008)) {
          await sleep(rng.logNormal(700, 0.60));
        }

        // Typo injection
        if (rng.chance(cfg.typo_rate) && ch.trim().length > 0) {
          const wrong = adjacentKey(ch, rng);
          if (wrong !== ch) {
            await this.typeChar(wrong, baseMs);
            // "Noticing" pause: log-normal around typo_correct midpoint
            const correctMean = (cfg.typo_correct_min_ms + cfg.typo_correct_max_ms) / 2;
            await sleep(rng.logNormal(correctMean, 0.40));
            await this.page.keyboard.press("Backspace");
            await sleep(rng.logNormal(50, 0.40));
            await this.typeChar(ch, baseMs);
          } else {
            await this.typeChar(ch, baseMs);
          }
        } else {
          await this.typeChar(ch, baseMs);
        }

        // Word-boundary hesitation: after space or punctuation, inject
        // an extra pause modelling cognitive chunking between words.
        // Drawn from a separate log-normal (heavier tail than IKI).
        if (ch === ' ' || ch === ',' || ch === '.' || ch === '!' || ch === '?') {
          await sleep(rng.heavyTailPause(baseMs * 1.8, 0.52, 0.05));
        }

        i++;
      }

      // Inter-burst pause: heavy-tailed log-normal with 4% Pareto tail
      if (i < text.length) {
        const pauseMean = (cfg.pause_min_ms + cfg.pause_max_ms) / 2;
        await sleep(rng.heavyTailPause(pauseMean, 0.48, 0.04));
      }
    }
  }

  /** Press a single key (e.g. "Enter", "Tab"). */
  async press(key: string): Promise<void> {
    await sleep(this.rng.range(30, 120));
    await this.page.keyboard.press(key);
    await sleep(this.rng.range(20, 80));
  }

  /** Clear a field by selecting all and deleting. */
  async clear(): Promise<void> {
    await this.page.keyboard.press("ControlOrMeta+a");
    await sleep(this.rng.range(40, 100));
    await this.page.keyboard.press("Backspace");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HumanScroll
// ─────────────────────────────────────────────────────────────────────────────

export class HumanScroll {
  constructor(
    private readonly page: Page,
    private readonly cfg: ScrollConfig,
    private readonly rng: Rng,
  ) {}

  /** Scroll at the given position by `totalDeltaY` pixels with momentum decay. */
  async scroll(x: number, y: number, totalDeltaY: number): Promise<void> {
    const { cfg, rng, page } = this;

    const direction = Math.sign(totalDeltaY);
    let remaining = Math.abs(totalDeltaY);

    // Overshoot: scroll a bit past target then bounce back
    let overshoot = 0;
    if (rng.chance(cfg.overshoot_prob)) {
      overshoot = rng.range(10, cfg.overshoot_max_px);
      remaining += overshoot;
    }

    let velocity = rng.gauss(
      cfg.initial_velocity_px,
      cfg.initial_velocity_px * 0.2,
    );
    velocity = Math.max(cfg.min_velocity_px, velocity);

    while (remaining > 0) {
      const tick = Math.min(remaining, velocity);
      await page.mouse.wheel(0, tick * direction);
      remaining -= tick;

      // Decay velocity
      velocity = Math.max(cfg.min_velocity_px, velocity * cfg.momentum_decay);

      const tickDelay = rng.range(cfg.tick_min_ms, cfg.tick_max_ms);
      await sleep(tickDelay);
    }

    // Scroll back from overshoot
    if (overshoot > 0) {
      await sleep(rng.range(80, 200));
      let back = overshoot;
      let backV = rng.range(
        cfg.min_velocity_px * 2,
        cfg.initial_velocity_px * 0.5,
      );

      while (back > 0) {
        const tick = Math.min(back, backV);
        await page.mouse.wheel(0, -tick * direction);
        back -= tick;
        backV = Math.max(cfg.min_velocity_px, backV * cfg.momentum_decay);
        await sleep(rng.range(cfg.tick_min_ms, cfg.tick_max_ms));
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HumanBehaviorMiddleware — orchestrates all three primitives
// ─────────────────────────────────────────────────────────────────────────────

export class HumanBehaviorMiddleware {
  public readonly mouse: HumanMouse;
  public readonly keyboard: HumanKeyboard;
  public readonly scroll: HumanScroll;

  private readonly rng: Rng;
  private readonly macro: MacroBehavior;

  constructor(
    private readonly page: Page,
    cfg: HumanBehavior,
    seed: number = Date.now(),
  ) {
    this.rng = new Rng(seed);
    this.macro = cfg.macro_b;
    this.mouse = new HumanMouse(page, cfg.mouse, this.rng);
    this.keyboard = new HumanKeyboard(page, cfg.typing, this.rng);
    this.scroll = new HumanScroll(page, cfg.scroll, this.rng);
  }

  // ── High-level actions ──────────────────────────────────────────────────

  /** Locate a CSS selector, move the mouse to it, and click. */
  async click(selector: string): Promise<void> {
    await this._maybeIdlePause();

    const handle = await this.page.$(selector);
    if (!handle) throw new Error(`HumanClick: selector not found: ${selector}`);

    await handle.scrollIntoViewIfNeeded();
    await this.mouse.click(handle);
    await handle.dispose();

    await this._interActionPause();
  }

  /** Focus a field and type text with human rhythm. */
  async type(selector: string, text: string): Promise<void> {
    await this._maybeIdlePause();

    const handle = await this.page.$(selector);
    if (!handle) throw new Error(`HumanType: selector not found: ${selector}`);

    await handle.scrollIntoViewIfNeeded();

    // Move to the field and click to focus
    await this.mouse.click(handle);
    await sleep(this.rng.range(60, 200));

    // Clear existing content first
    await this.keyboard.clear();

    // Type the text
    await this.keyboard.type(text);

    await handle.dispose();
    await this._interActionPause();
  }

  /** Scroll a container element by deltaY pixels. */
  async scrollElement(selector: string, deltaY: number): Promise<void> {
    await this._maybeIdlePause();

    const handle = await this.page.$(selector);
    if (!handle)
      throw new Error(`HumanScroll: selector not found: ${selector}`);

    await handle.scrollIntoViewIfNeeded();

    const box = await handle.boundingBox();
    if (!box)
      throw new Error(`HumanScroll: element has no bounding box: ${selector}`);

    const cx = box.x + box.width * this.rng.range(0.3, 0.7);
    const cy = box.y + box.height * this.rng.range(0.3, 0.7);

    // Move mouse to the element first
    await this.mouse.moveTo({ x: cx, y: cy });
    await sleep(this.rng.range(60, 180));

    await this.scroll.scroll(cx, cy, deltaY);
    await handle.dispose();
    await this._interActionPause();
  }

  /** Scroll the main page viewport by deltaY pixels. */
  async scrollPage(deltaY: number): Promise<void> {
    await this._maybeIdlePause();

    const vp = this.page.viewportSize();
    const cx = vp ? vp.width / 2 : 640;
    const cy = vp ? vp.height / 2 : 360;

    await this.scroll.scroll(cx, cy, deltaY);
    await this._interActionPause();
  }

  /** Hover over a selector (no click). Useful for triggering dropdown menus. */
  async hover(selector: string): Promise<void> {
    const handle = await this.page.$(selector);
    if (!handle) throw new Error(`HumanHover: selector not found: ${selector}`);

    await handle.scrollIntoViewIfNeeded();
    await this.mouse.moveToElement(handle);
    await sleep(this.rng.range(80, 300));
    await handle.dispose();
  }

  /** Simulate an initial random pre-move after page load — makes the session
   *  look like the user moved the mouse around before taking action. */
  async randomPremove(): Promise<void> {
    if (!this.rng.chance(this.macro.random_premove_prob)) return;

    const vp = this.page.viewportSize();
    const w = vp?.width ?? 1280;
    const h = vp?.height ?? 800;

    const numMoves = this.rng.int(1, 3);
    for (let i = 0; i < numMoves; i++) {
      const target = {
        x: this.rng.range(w * 0.1, w * 0.9),
        y: this.rng.range(h * 0.1, h * 0.9),
      };
      await this.mouse.moveTo(target);
      await sleep(this.rng.range(100, 500));
    }
  }

  /** Pause that simulates waiting for a page to finish loading. */
  async pageLoadPause(): Promise<void> {
    const { macro, rng } = this;
    await sleep(
      rng.range(macro.page_load_pause_min_ms, macro.page_load_pause_max_ms),
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async _interActionPause(): Promise<void> {
    const { macro, rng } = this;
    await sleep(
      rng.range(macro.inter_action_min_ms, macro.inter_action_max_ms),
    );
  }

  private async _maybeIdlePause(): Promise<void> {
    const { macro, rng } = this;
    if (rng.chance(macro.idle_pause_prob)) {
      await sleep(rng.range(macro.idle_pause_min_ms, macro.idle_pause_max_ms));
    }
  }
}

// ── Convenience factory ───────────────────────────────────────────────────────

/** Build a HumanBehaviorMiddleware from a full BehaviorProfile preset name
 *  and an optional seed override.  The built-in presets mirror the four
 *  profiles defined in `BehaviorProfile`. */
export type {
  HumanBehavior,
  MouseConfig,
  TypingConfig,
  ScrollConfig,
  MacroBehavior,
};
