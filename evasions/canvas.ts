// @ts-nocheck
// ── Manifold evasion: Canvas 2D ───────────────────────────────────────────────
//
// Injects deterministic per-pixel noise into:
//   • CanvasRenderingContext2D.getImageData()
//   • HTMLCanvasElement.toDataURL()
//   • HTMLCanvasElement.toBlob()
//   • OffscreenCanvas variants
//
// Noise is position-keyed (same pixel → same delta) so visual output is
// stable across reads but differs per seed.  Intensity is kept ≤ ±3 LSB so
// CAPTCHAs and image-recognition pipelines are not visibly broken.

import type { EvasionConfig } from "./types.js";

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

function buildPrng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s ^ (s >>> 15), s | 1) ^ 0) >>> 0;
    s = (s ^ (s >>> 13)) >>> 0;
    s = (Math.imul(s, 0x45d9f3b) ^ 0) >>> 0;
    s = (s ^ (s >>> 16)) >>> 0;
    return s / 0x100000000;
  };
}

// ── Pixel-position hash ───────────────────────────────────────────────────────
// Returns a deterministic integer in [-maxDelta, +maxDelta] for (x, y, seed).

function pixelDelta(x: number, y: number, channel: number, seed: number, maxDelta: number): number {
  // Wang hash mix of position + channel + seed
  let h = ((x * 374761393) ^ (y * 668265263) ^ (channel * 2147483647) ^ seed) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (Math.imul(h, 0xc2b2ae35)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  // Map to signed [-maxDelta, +maxDelta]
  const range = maxDelta * 2 + 1;
  return (h % range) - maxDelta;
}

// ── Init script factory ───────────────────────────────────────────────────────

export function canvasEvasion(cfg: EvasionConfig): string {
  const { seed, canvas } = cfg;
  // Scale noise level (0–1) to a max per-channel delta (0–4 LSB).
  // We clamp hard at 4 to avoid visible artefacts.
  const maxDelta = Math.max(0, Math.min(4, Math.round(canvas.noiseLevel * 4)));

  if (maxDelta === 0) return "/* canvas evasion: noise disabled */";

  return /* js */ `(function () {
  'use strict';

  // ── Shared constants ──────────────────────────────────────────────────────
  const _SEED       = ${seed} >>> 0;
  const _MAX_DELTA  = ${maxDelta};

  // Wang hash: deterministic ±_MAX_DELTA for (x, y, channel, seed)
  function _delta(x, y, ch) {
    let h = ((x * 374761393) ^ (y * 668265263) ^ (ch * 2147483647) ^ _SEED) >>> 0;
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = (Math.imul(h, 0xc2b2ae35)) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    const range = _MAX_DELTA * 2 + 1;
    return (h % range) - _MAX_DELTA;
  }

  function _noiseImageData(imgData, originX, originY) {
    const d = imgData.data;
    const w = imgData.width;
    for (let i = 0; i < d.length; i += 4) {
      const px  = (i >>> 2) % w;
      const py  = ((i >>> 2) / w) | 0;
      const ax  = originX + px;
      const ay  = originY + py;
      d[i]     = Math.max(0, Math.min(255, d[i]     + _delta(ax, ay, 0)));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + _delta(ax, ay, 1)));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + _delta(ax, ay, 2)));
      // Alpha channel: leave untouched to avoid layout shifts
    }
    return imgData;
  }

  // ── CanvasRenderingContext2D.getImageData ─────────────────────────────────
  const _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'getImageData', {
    configurable: true,
    enumerable:   false,
    writable:     true,
    value: function getImageData(sx, sy, sw, sh, settings) {
      const img = settings !== undefined
        ? _origGetImageData.call(this, sx, sy, sw, sh, settings)
        : _origGetImageData.call(this, sx, sy, sw, sh);
      return _noiseImageData(img, sx | 0, sy | 0);
    },
  });

  // ── CanvasRenderingContext2D.getImageData (sw×sh overloads) ───────────────
  // Already covered above.

  // ── HTMLCanvasElement.toDataURL ───────────────────────────────────────────
  // Strategy: draw a noise overlay onto a temporary offscreen canvas, encode
  // that, then restore.  We do this by briefly overwriting pixel data.
  const _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    enumerable:   false,
    writable:     true,
    value: function toDataURL(type, quality) {
      const ctx = this.getContext('2d');
      if (!ctx || this.width === 0 || this.height === 0) {
        return type !== undefined && quality !== undefined
          ? _origToDataURL.call(this, type, quality)
          : type !== undefined
            ? _origToDataURL.call(this, type)
            : _origToDataURL.call(this);
      }
      // Read → noise → encode → restore
      const snap = _origGetImageData.call(ctx, 0, 0, this.width, this.height);
      const noisy = _noiseImageData(
        new ImageData(
          new Uint8ClampedArray(snap.data),
          snap.width,
          snap.height
        ),
        0, 0
      );
      ctx.putImageData(noisy, 0, 0);
      const result = type !== undefined && quality !== undefined
        ? _origToDataURL.call(this, type, quality)
        : type !== undefined
          ? _origToDataURL.call(this, type)
          : _origToDataURL.call(this);
      ctx.putImageData(snap, 0, 0);
      return result;
    },
  });

  // ── HTMLCanvasElement.toBlob ──────────────────────────────────────────────
  const _origToBlob = HTMLCanvasElement.prototype.toBlob;
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    enumerable:   false,
    writable:     true,
    value: function toBlob(callback, type, quality) {
      const ctx = this.getContext('2d');
      if (!ctx || this.width === 0 || this.height === 0) {
        return _origToBlob.call(this, callback, type, quality);
      }
      const snap = _origGetImageData.call(ctx, 0, 0, this.width, this.height);
      const noisy = _noiseImageData(
        new ImageData(new Uint8ClampedArray(snap.data), snap.width, snap.height),
        0, 0
      );
      ctx.putImageData(noisy, 0, 0);
      _origToBlob.call(
        this,
        function (blob) {
          ctx.putImageData(snap, 0, 0);
          if (typeof callback === 'function') callback(blob);
        },
        type,
        quality
      );
    },
  });

  // ── OffscreenCanvas.getContext / convertToBlob ────────────────────────────
  if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
    const _origOff = OffscreenCanvasRenderingContext2D.prototype.getImageData;
    if (_origOff) {
      Object.defineProperty(
        OffscreenCanvasRenderingContext2D.prototype,
        'getImageData',
        {
          configurable: true,
          enumerable:   false,
          writable:     true,
          value: function getImageData(sx, sy, sw, sh, settings) {
            const img = settings !== undefined
              ? _origOff.call(this, sx, sy, sw, sh, settings)
              : _origOff.call(this, sx, sy, sw, sh);
            return _noiseImageData(img, sx | 0, sy | 0);
          },
        }
      );
    }
  }

  // ── Guard against re-patching ─────────────────────────────────────────────
  Object.defineProperty(window, '__m_canvas_patched__', {
    value: true, writable: false, configurable: false
  });

})();`;
}

// ── Type re-export so index.ts can import EvasionConfig once ─────────────────
export type { EvasionConfig };
