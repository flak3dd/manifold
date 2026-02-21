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
 *  by a random fraction of the total distance, scaled by curveScatter. */
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

  // Random perpendicular offsets (can be negative = curve left or right)
  const sign1 = rng.chance(0.5) ? 1 : -1;
  const sign2 = rng.chance(0.5) ? 1 : -1;
  const amp1 = rng.range(0.1, 0.5) * scatter * d * sign1;
  const amp2 = rng.range(0.1, 0.5) * scatter * d * sign2;

  // P1 is 25–45 % along the line, P2 is 55–75 % along
  const t1 = rng.range(0.25, 0.45);
  const t2 = rng.range(0.55, 0.75);

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

  /** Move the cursor to (x, y) along a cubic Bézier path. */
  async moveTo(target: Vec2): Promise<void> {
    const { cfg, rng, page } = this;
    const from = { ...this.current };
    const d = dist(from, target);

    if (d < 1) return; // already there

    // Number of steps: proportional to distance, scaled by speed
    // At base_speed_px_per_sec, move 1 px per step (capped).
    const speedPx = rng.gauss(
      cfg.base_speed_px_per_sec,
      cfg.base_speed_px_per_sec * cfg.speed_jitter,
    );
    // ~60 steps/sec of mouse events; compute how many steps fit in the travel time
    const travelSec = d / Math.max(1, speedPx);
    const steps = Math.max(8, Math.min(120, Math.round(travelSec * 60)));
    const stepMs = (travelSec * 1000) / steps;

    // Generate Bézier control points
    const [p1, p2] = makeControlPoints(from, target, cfg.curve_scatter, rng);
    const pts = sampleCurve(from, p1, p2, target, steps);

    // Overshoot: extend past the target, then snap back
    let overshootPt: Vec2 | null = null;
    if (rng.chance(cfg.overshoot_prob) && d > 20) {
      const overshootDist = rng.range(2, cfg.overshoot_max_px);
      const dx = (target.x - from.x) / d;
      const dy = (target.y - from.y) / d;
      overshootPt = {
        x: target.x + dx * overshootDist,
        y: target.y + dy * overshootDist,
      };
    }

    // Walk the path
    for (let i = 1; i < pts.length; i++) {
      let { x, y } = pts[i];

      // Micro-jitter on intermediate points (not the final one)
      if (i < pts.length - 1 && rng.chance(cfg.micro_jitter_prob)) {
        x += rng.range(-1.5, 1.5);
        y += rng.range(-1.5, 1.5);
      }

      await page.mouse.move(x, y);
      await sleep(stepMs);
    }

    // Move to overshoot point then correct back
    if (overshootPt) {
      await page.mouse.move(overshootPt.x, overshootPt.y);
      await sleep(rng.range(40, 120));
      await page.mouse.move(target.x, target.y);
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

  /** Full human click: move → optional pre-click pause → mousedown → mouseup. */
  async click(handle: ElementHandle): Promise<void> {
    const { cfg, rng, page } = this;
    const target = await this.moveToElement(handle);

    // Pre-click pause (hesitation before pressing)
    if (cfg.pre_click_pause_max_ms > 0) {
      await sleep(rng.range(20, cfg.pre_click_pause_max_ms));
    }

    // Hold duration: ~80–160 ms for a natural click
    const holdMs = rng.gauss(110, 20);

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

  /** Type a single character with realistic key-hold timing. */
  private async typeChar(ch: string, baseDelayMs: number): Promise<void> {
    const { page, rng } = this;
    // Jitter the per-character delay
    const jitter = rng.gauss(0, baseDelayMs * 0.15);
    const delay = Math.max(20, baseDelayMs + jitter);

    // Double-tap: occasionally a key bounces and the character appears twice
    if (rng.chance(this.cfg.double_tap_rate)) {
      await page.keyboard.type(ch, { delay: delay * 0.5 });
      // Wait, notice the duplicate, delete one
      await sleep(rng.range(80, 200));
      await page.keyboard.press("Backspace");
      await sleep(rng.range(40, 100));
    }

    await page.keyboard.type(ch, { delay });
  }

  /** Type `text` with burst/pause rhythm and occasional typos. */
  async type(text: string, preFocusPause = true): Promise<void> {
    const { cfg, rng } = this;

    // Optional "thinking" pause before starting to type a long field
    if (preFocusPause && cfg.think_before_long_fields && text.length > 10) {
      await sleep(rng.range(cfg.think_pause_min_ms, cfg.think_pause_max_ms));
    }

    const baseMs = wpmToMs(
      rng.gauss(cfg.base_wpm, cfg.base_wpm * (cfg.wpm_jitter / 100)),
    );

    let i = 0;
    while (i < text.length) {
      // Decide burst length for this chunk
      const burst = rng.int(cfg.burst_min_chars, cfg.burst_max_chars);
      const end = Math.min(i + burst, text.length);

      // Type the burst
      while (i < end) {
        const ch = text[i];

        // Typo injection
        if (rng.chance(cfg.typo_rate) && ch.trim().length > 0) {
          const wrong = adjacentKey(ch, rng);
          if (wrong !== ch) {
            // Type the wrong character
            await this.typeChar(wrong, baseMs);
            // Pause while "noticing" the mistake
            await sleep(
              rng.range(cfg.typo_correct_min_ms, cfg.typo_correct_max_ms),
            );
            // Delete it
            await this.page.keyboard.press("Backspace");
            await sleep(rng.range(30, 80));
            // Type the correct character
            await this.typeChar(ch, baseMs);
          } else {
            await this.typeChar(ch, baseMs);
          }
        } else {
          await this.typeChar(ch, baseMs);
        }

        i++;
      }

      // Inter-burst pause (if not at the end)
      if (i < text.length) {
        await sleep(rng.range(cfg.pause_min_ms, cfg.pause_max_ms));
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
