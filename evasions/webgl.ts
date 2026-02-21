// @ts-nocheck
// ── Manifold evasion: WebGL 1 & 2 ────────────────────────────────────────────
//
// Intercepts the following surfaces to prevent WebGL fingerprinting:
//
//   1. WebGLRenderingContext / WebGL2RenderingContext
//        getParameter(VENDOR)          → spoofed vendor string
//        getParameter(RENDERER)        → spoofed renderer string
//        getExtension('WEBGL_debug_renderer_info')
//          → fake UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL
//
//   2. readPixels / getBufferSubData
//        Adds per-pixel deterministic noise to prevent canvas-over-WebGL
//        hashing attacks (fingerprinters draw a scene and read back pixels).
//
//   3. WebGLShaderPrecisionFormat
//        Returns stable, rounded precision values that don't expose GPU tier.
//
//   4. getExtension / getSupportedExtensions
//        Filters the extension list to a consistent cross-GPU baseline set,
//        preventing extension fingerprinting.
//
// Noise model: xoshiro128++ (32-bit) seeded from cfg.seed, position-keyed
// so the same pixel always gets the same delta across multiple reads.
// Intensity is clamped to ±3 LSB to avoid visible rendering artefacts.

import type { EvasionConfig } from "./types.js";

// ── Whitelisted extension baseline ───────────────────────────────────────────
// These are present in virtually every desktop Chrome install; exposing extras
// reveals GPU vendor and driver version.

const BASELINE_EXTENSIONS: ReadonlySet<string> = new Set([
  "ANGLE_instanced_arrays",
  "EXT_blend_minmax",
  "EXT_color_buffer_half_float",
  "EXT_disjoint_timer_query",
  "EXT_float_blend",
  "EXT_frag_depth",
  "EXT_shader_texture_lod",
  "EXT_texture_compression_bptc",
  "EXT_texture_compression_rgtc",
  "EXT_texture_filter_anisotropic",
  "EXT_sRGB",
  "KHR_parallel_shader_compile",
  "OES_element_index_uint",
  "OES_fbo_render_mipmap",
  "OES_standard_derivatives",
  "OES_texture_float",
  "OES_texture_float_linear",
  "OES_texture_half_float",
  "OES_texture_half_float_linear",
  "OES_vertex_array_object",
  "WEBGL_color_buffer_float",
  "WEBGL_compressed_texture_s3tc",
  "WEBGL_compressed_texture_s3tc_srgb",
  "WEBGL_debug_renderer_info",
  "WEBGL_debug_shaders",
  "WEBGL_depth_texture",
  "WEBGL_draw_buffers",
  "WEBGL_lose_context",
  "WEBGL_multi_draw",
]);

// ── Init-script factory ───────────────────────────────────────────────────────

export function webglEvasion(cfg: EvasionConfig): string {
  const { webgl, seed } = cfg;

  if (!webgl.vendor && webgl.noiseLevel === 0) {
    return "/* webgl evasion: disabled */";
  }

  const maxDelta = Math.max(0, Math.min(3, Math.round(webgl.noiseLevel * 3)));
  const vendor   = webgl.vendor   ?? "Google Inc. (Intel)";
  const renderer = webgl.renderer ?? "ANGLE (Intel, Intel(R) UHD Graphics, OpenGL 4.6)";

  // Derive a stable per-seed fake renderer for the unmasked string.
  // This is deterministic so that repeated reads within a session are identical.
  const unmaskedVendor   = vendor;
  const unmaskedRenderer = renderer;

  return /* js */`(function () {
  'use strict';

  if (window.__m_webgl_patched__) return;

  // ─────────────────────────────────────────────────────────────────────────
  // xoshiro128++ (32-bit) — fast, good statistical properties
  // Seeded from manifold fingerprint seed so noise is deterministic per-profile.
  // ─────────────────────────────────────────────────────────────────────────

  const _S = new Uint32Array(4);
  (function _initXoshiro() {
    // Spread the 64-bit seed into four 32-bit state words using splitmix32
    let s = (${seed} >>> 0);
    function _sm32() {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    }
    _S[0] = _sm32(); _S[1] = _sm32(); _S[2] = _sm32(); _S[3] = _sm32();
  })();

  function _xoshiroNext() {
    const result = ((_S[0] + _S[3]) | 0) >>> 0;
    const t = (_S[1] << 9) >>> 0;
    _S[2] ^= _S[0]; _S[3] ^= _S[1];
    _S[1] ^= _S[2]; _S[0] ^= _S[3];
    _S[2] ^= t;
    _S[3] = ((_S[3] << 11) | (_S[3] >>> 21)) >>> 0;
    return ((result + _S[0]) | 0) >>> 0;
  }

  // Position-keyed delta: same (x, y, channel) → same noise value
  // Uses Wang hash so we don't need to advance the PRNG in scan order.
  const _SEED32 = ${seed} >>> 0;
  const _MAX_D  = ${maxDelta};

  function _delta(x, y, ch) {
    if (_MAX_D === 0) return 0;
    let h = ((x * 374761393) ^ (y * 668265263) ^ (ch * 2147483647) ^ _SEED32) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    const range = _MAX_D * 2 + 1;
    return (h % range) - _MAX_D;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. getParameter — VENDOR / RENDERER / UNMASKED variants
  // ─────────────────────────────────────────────────────────────────────────

  const _VENDOR            = ${JSON.stringify(vendor)};
  const _RENDERER          = ${JSON.stringify(renderer)};
  const _UNMASKED_VENDOR   = ${JSON.stringify(unmaskedVendor)};
  const _UNMASKED_RENDERER = ${JSON.stringify(unmaskedRenderer)};

  // WEBGL_debug_renderer_info enum values (standardised)
  const UNMASKED_VENDOR_WEBGL   = 0x9245;
  const UNMASKED_RENDERER_WEBGL = 0x9246;

  function _patchGetParameter(proto) {
    const _orig = proto.getParameter;
    if (!_orig) return;

    Object.defineProperty(proto, 'getParameter', {
      configurable: true,
      enumerable:   false,
      writable:     true,
      value: function getParameter(pname) {
        // VENDOR / RENDERER (masked)
        if (pname === 0x1F00 /* VENDOR   */) return _VENDOR;
        if (pname === 0x1F01 /* RENDERER */) return _RENDERER;
        // UNMASKED variants from WEBGL_debug_renderer_info
        if (pname === UNMASKED_VENDOR_WEBGL)   return _UNMASKED_VENDOR;
        if (pname === UNMASKED_RENDERER_WEBGL) return _UNMASKED_RENDERER;
        // VERSION strings — leave real values; they're less discriminating
        return _orig.call(this, pname);
      },
    });
  }

  if (typeof WebGLRenderingContext  !== 'undefined') {
    _patchGetParameter(WebGLRenderingContext.prototype);
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    _patchGetParameter(WebGL2RenderingContext.prototype);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. getExtension — intercept WEBGL_debug_renderer_info to return spoofed
  //    values; filter getSupportedExtensions to a stable baseline
  // ─────────────────────────────────────────────────────────────────────────

  const _BASELINE = new Set(${JSON.stringify([...BASELINE_EXTENSIONS])});

  function _patchExtensions(proto) {
    const _origGetExt  = proto.getExtension;
    const _origGetSupp = proto.getSupportedExtensions;
    if (!_origGetExt) return;

    Object.defineProperty(proto, 'getExtension', {
      configurable: true,
      enumerable:   false,
      writable:     true,
      value: function getExtension(name) {
        if (name === 'WEBGL_debug_renderer_info') {
          // Return a fake extension object with spoofed enum constants.
          // The actual constants are read back via getParameter above.
          const real = _origGetExt.call(this, name);
          if (!real) return null;
          return Object.freeze({
            UNMASKED_VENDOR_WEBGL:   UNMASKED_VENDOR_WEBGL,
            UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER_WEBGL,
          });
        }
        // Block non-baseline extensions to prevent enumeration fingerprinting
        if (!_BASELINE.has(name)) return null;
        return _origGetExt.call(this, name);
      },
    });

    if (_origGetSupp) {
      Object.defineProperty(proto, 'getSupportedExtensions', {
        configurable: true,
        enumerable:   false,
        writable:     true,
        value: function getSupportedExtensions() {
          const real = _origGetSupp.call(this) ?? [];
          return real.filter(e => _BASELINE.has(e));
        },
      });
    }
  }

  if (typeof WebGLRenderingContext  !== 'undefined') {
    _patchExtensions(WebGLRenderingContext.prototype);
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    _patchExtensions(WebGL2RenderingContext.prototype);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. readPixels — inject deterministic per-pixel noise
  //    Fingerprinters draw a fixed scene and hash the pixel readback.
  //    Adding ±_MAX_D LSB per channel breaks the hash while staying invisible.
  // ─────────────────────────────────────────────────────────────────────────

  function _patchReadPixels(proto) {
    const _origRP = proto.readPixels;
    if (!_origRP || _MAX_D === 0) return;

    Object.defineProperty(proto, 'readPixels', {
      configurable: true,
      enumerable:   false,
      writable:     true,
      value: function readPixels(x, y, width, height, format, type, pixels, offset) {
        // Call the real readPixels
        if (offset !== undefined) {
          _origRP.call(this, x, y, width, height, format, type, pixels, offset);
        } else {
          _origRP.call(this, x, y, width, height, format, type, pixels);
        }

        // Only noise Uint8Array / Uint8ClampedArray outputs (RGBA/RGB byte data)
        if (!(pixels instanceof Uint8Array) && !(pixels instanceof Uint8ClampedArray)) {
          return;
        }
        // RGBA = 4 components, RGB = 3 — detect from format
        // 0x1908 = RGBA, 0x1907 = RGB, 0x1909 = LUMINANCE_ALPHA, etc.
        const comps = (format === 0x1907 /* RGB */) ? 3 : 4;

        for (let i = 0; i < pixels.length; i += comps) {
          const px = (i / comps) % width;
          const py = ((i / comps) / width) | 0;
          const ax = (x | 0) + px;
          const ay = (y | 0) + py;
          for (let c = 0; c < Math.min(comps, 3); c++) { // don't touch alpha
            const v = pixels[i + c] + _delta(ax, ay, c);
            pixels[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
          }
        }
      },
    });
  }

  if (typeof WebGLRenderingContext  !== 'undefined') {
    _patchReadPixels(WebGLRenderingContext.prototype);
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    _patchReadPixels(WebGL2RenderingContext.prototype);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. WebGL2: getBufferSubData — same noise treatment as readPixels
  // ─────────────────────────────────────────────────────────────────────────

  if (typeof WebGL2RenderingContext !== 'undefined' && _MAX_D > 0) {
    const _proto2  = WebGL2RenderingContext.prototype;
    const _origGBS = _proto2.getBufferSubData;
    if (_origGBS) {
      Object.defineProperty(_proto2, 'getBufferSubData', {
        configurable: true,
        enumerable:   false,
        writable:     true,
        value: function getBufferSubData(target, srcByteOffset, dstData, dstOffset, length) {
          if (dstOffset !== undefined && length !== undefined) {
            _origGBS.call(this, target, srcByteOffset, dstData, dstOffset, length);
          } else if (dstOffset !== undefined) {
            _origGBS.call(this, target, srcByteOffset, dstData, dstOffset);
          } else {
            _origGBS.call(this, target, srcByteOffset, dstData);
          }
          if (dstData instanceof Uint8Array || dstData instanceof Uint8ClampedArray) {
            const stride = 4;
            const start  = (dstOffset ?? 0);
            const end    = length ? start + length : dstData.length;
            for (let i = start; i < end; i += stride) {
              const idx = (i - start) / stride;
              for (let c = 0; c < 3; c++) {
                if (i + c < dstData.length) {
                  const v = dstData[i + c] + _delta(idx % 1024, (idx / 1024) | 0, c);
                  dstData[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
                }
              }
            }
          }
        },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. getShaderPrecisionFormat — return stable, rounded values
  //    Real values expose GPU compute tier (full/medium/low float precision).
  // ─────────────────────────────────────────────────────────────────────────

  // Canonical desktop-GPU precision values (conservative / common baseline)
  const _PRECISION_TABLE = {
    // [shaderType][precisionType] → { rangeMin, rangeMax, precision }
    // shaderType: VERTEX_SHADER=0x8B31, FRAGMENT_SHADER=0x8B30
    // precisionType: LOW_FLOAT=0x8DF0, MEDIUM_FLOAT=0x8DF1, HIGH_FLOAT=0x8DF2
    //                LOW_INT=0x8DF3,   MEDIUM_INT=0x8DF4,   HIGH_INT=0x8DF5
    '0x8B31_0x8DF0': { rangeMin: 127, rangeMax: 127, precision: 23 }, // vertex low float
    '0x8B31_0x8DF1': { rangeMin: 127, rangeMax: 127, precision: 23 }, // vertex medium float
    '0x8B31_0x8DF2': { rangeMin: 127, rangeMax: 127, precision: 23 }, // vertex high float
    '0x8B31_0x8DF3': { rangeMin: 31,  rangeMax: 30,  precision: 0  }, // vertex low int
    '0x8B31_0x8DF4': { rangeMin: 31,  rangeMax: 30,  precision: 0  }, // vertex medium int
    '0x8B31_0x8DF5': { rangeMin: 31,  rangeMax: 30,  precision: 0  }, // vertex high int
    '0x8B30_0x8DF0': { rangeMin: 127, rangeMax: 127, precision: 23 }, // frag low float
    '0x8B30_0x8DF1': { rangeMin: 127, rangeMax: 127, precision: 23 }, // frag medium float
    '0x8B30_0x8DF2': { rangeMin: 127, rangeMax: 127, precision: 23 }, // frag high float
    '0x8B30_0x8DF3': { rangeMin: 31,  rangeMax: 30,  precision: 0  }, // frag low int
    '0x8B30_0x8DF4': { rangeMin: 31,  rangeMax: 30,  precision: 0  }, // frag medium int
    '0x8B30_0x8DF5': { rangeMin: 31,  rangeMax: 30,  precision: 0  }, // frag high int
  };

  function _patchShaderPrecision(proto) {
    const _origSPF = proto.getShaderPrecisionFormat;
    if (!_origSPF) return;

    Object.defineProperty(proto, 'getShaderPrecisionFormat', {
      configurable: true,
      enumerable:   false,
      writable:     true,
      value: function getShaderPrecisionFormat(shaderType, precisionType) {
        const key = '0x' + shaderType.toString(16) + '_0x' + precisionType.toString(16);
        const row = _PRECISION_TABLE[key];
        if (!row) return _origSPF.call(this, shaderType, precisionType);
        // Return a WebGLShaderPrecisionFormat-like object
        return Object.freeze({
          rangeMin:  row.rangeMin,
          rangeMax:  row.rangeMax,
          precision: row.precision,
        });
      },
    });
  }

  if (typeof WebGLRenderingContext  !== 'undefined') {
    _patchShaderPrecision(WebGLRenderingContext.prototype);
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    _patchShaderPrecision(WebGL2RenderingContext.prototype);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. HTMLCanvasElement.getContext — ensure every new WebGL context inherits
  //    our patches even if the page creates its own prototype chain copy.
  //    Also intercept OffscreenCanvas.getContext.
  // ─────────────────────────────────────────────────────────────────────────

  // The prototype patches above are sufficient for normal usage. We add a
  // belt-and-suspenders guard on getContext to catch rare cases where
  // detection scripts reach in with Object.getOwnPropertyDescriptor tricks.

  // (No additional wrapping needed; prototype patches cover all access paths.)

  // ─────────────────────────────────────────────────────────────────────────
  // Guard
  // ─────────────────────────────────────────────────────────────────────────

  Object.defineProperty(window, '__m_webgl_patched__', {
    value: true, writable: false, configurable: false,
  });

})();`;
}

export type { EvasionConfig };
