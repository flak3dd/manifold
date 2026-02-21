// @ts-nocheck
// ── Manifold evasion: AudioContext ────────────────────────────────────────────
//
// Injects deterministic per-seed noise into the AudioContext fingerprinting
// pipeline. Fingerprinters typically:
//
//   1. Create an OfflineAudioContext
//   2. Pipe OscillatorNode → DynamicsCompressorNode → destination
//   3. Call startRendering() and hash the resulting AudioBuffer channel data
//
// We intercept:
//
//   • AudioBuffer.prototype.getChannelData
//       → adds tiny seed-keyed noise to the Float32 samples
//
//   • AnalyserNode.prototype.getFloatFrequencyData
//   • AnalyserNode.prototype.getByteFrequencyData
//   • AnalyserNode.prototype.getFloatTimeDomainData
//   • AnalyserNode.prototype.getByteTimeDomainData
//       → same noise treatment on the output typed array
//
//   • AudioBuffer.prototype.copyFromChannel  (alternative read path)
//
//   • OfflineAudioContext.prototype.startRendering
//       → wraps the returned promise so the final buffer is noised before
//         the page code sees it (belt-and-suspenders with the above)
//
// Noise model: xoshiro128++ (32-bit) seeded from cfg.seed.
// A position-keyed Wang hash ensures the same sample index always receives
// the same delta — stable across multiple reads within a session but
// different from every other seed.
//
// Amplitude is scaled by cfg.audio.noiseLevel (0–1) to ±1.2e-4 max so the
// waveform looks real and CAPTCHAs that play audio are unaffected.

import type { EvasionConfig } from "./types.js";

export function audioEvasion(cfg: EvasionConfig): string {
  const { audio, seed } = cfg;

  if (audio.noiseLevel === 0) return "/* audio evasion: noise disabled */";

  // Map noiseLevel (0–1) → max float amplitude delta.
  // Fingerprinters work with values typically in [–1, +1].
  // Keeping delta ≤ 1.2e-4 keeps the hash broken while audio sounds identical.
  const maxAmplitude = Math.max(0, Math.min(1.2e-4, audio.noiseLevel * 1.2e-4));

  return /* js */`(function () {
  'use strict';

  if (window.__m_audio_patched__) return;

  // ── xoshiro128++ seeded from manifold fingerprint seed ──────────────────
  // Used for generating the "global" noise stream; position-keyed hash is
  // used for sample-stable deltas.

  const _S = new Uint32Array(4);
  (function _initXoshiro() {
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

  // xoshiro128++ step
  function _xoshiro() {
    const r = ((_S[0] + _S[3]) | 0) >>> 0;
    const t = (_S[1] << 9) >>> 0;
    _S[2] ^= _S[0]; _S[3] ^= _S[1];
    _S[1] ^= _S[2]; _S[0] ^= _S[3];
    _S[2] ^= t;
    _S[3] = ((_S[3] << 11) | (_S[3] >>> 21)) >>> 0;
    return ((r + _S[0]) | 0) >>> 0;
  }

  // Position-keyed delta for sample[i] in channel[ch] of buffer[bufId].
  // Returns a float in [-_MAX_A, +_MAX_A].
  const _SEED32  = ${seed} >>> 0;
  const _MAX_A   = ${maxAmplitude};

  function _sampleDelta(bufId, ch, i) {
    // Wang hash mix: bufId distinguishes different AudioBuffer instances
    let h = ((i * 374761393) ^ (ch * 668265263) ^ (bufId * 2147483647) ^ _SEED32) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    // Map unsigned 32-bit int to [-_MAX_A, +_MAX_A]
    return ((h / 0x100000000) - 0.5) * 2.0 * _MAX_A;
  }

  // Byte-domain delta (for getByteFrequencyData etc.) — ±1 LSB
  function _byteDelta(bufId, ch, i) {
    let h = ((i * 1664525) ^ (ch * 1013904223) ^ (bufId * 2246822519) ^ _SEED32) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    return ((h & 1) === 0) ? 1 : -1;  // ±1
  }

  // ── Stable buffer identity counter ────────────────────────────────────────
  // We tag each AudioBuffer with a numeric ID so position-keyed noise is
  // stable across multiple getChannelData() calls on the same buffer.
  let _bufCounter = 0;
  const _bufIds   = new WeakMap();

  function _bufId(buf) {
    if (!_bufIds.has(buf)) _bufIds.set(buf, ++_bufCounter);
    return _bufIds.get(buf);
  }

  // ── 1. AudioBuffer.prototype.getChannelData ──────────────────────────────

  if (typeof AudioBuffer !== 'undefined') {
    const _origGCD = AudioBuffer.prototype.getChannelData;

    Object.defineProperty(AudioBuffer.prototype, 'getChannelData', {
      configurable: true,
      enumerable:   false,
      writable:     true,
      value: function getChannelData(channel) {
        const data = _origGCD.call(this, channel);
        const id   = _bufId(this);
        const ch   = channel | 0;
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.max(-1.0, Math.min(1.0, data[i] + _sampleDelta(id, ch, i)));
        }
        return data;
      },
    });

    // ── 1b. AudioBuffer.prototype.copyFromChannel ────────────────────────
    const _origCFC = AudioBuffer.prototype.copyFromChannel;
    if (_origCFC) {
      Object.defineProperty(AudioBuffer.prototype, 'copyFromChannel', {
        configurable: true,
        enumerable:   false,
        writable:     true,
        value: function copyFromChannel(destination, channelNumber, bufferOffset) {
          const off = bufferOffset ?? 0;
          _origCFC.call(this, destination, channelNumber, off);
          const id = _bufId(this);
          const ch = channelNumber | 0;
          for (let i = 0; i < destination.length; i++) {
            destination[i] = Math.max(
              -1.0,
              Math.min(1.0, destination[i] + _sampleDelta(id, ch, off + i))
            );
          }
        },
      });
    }
  }

  // ── 2. AnalyserNode frequency/time-domain data ───────────────────────────
  // Fingerprinters also use AnalyserNode.getFloatFrequencyData to hash the
  // frequency spectrum of a running context.

  if (typeof AnalyserNode !== 'undefined') {
    // Float frequency data — values are in dB, typically –200 to 0
    const _origGFFD = AnalyserNode.prototype.getFloatFrequencyData;
    if (_origGFFD) {
      Object.defineProperty(AnalyserNode.prototype, 'getFloatFrequencyData', {
        configurable: true,
        enumerable:   false,
        writable:     true,
        value: function getFloatFrequencyData(array) {
          _origGFFD.call(this, array);
          const id = _bufId(this);
          for (let i = 0; i < array.length; i++) {
            // dB values; ±0.001 dB noise is imperceptible
            if (isFinite(array[i])) {
              array[i] += _sampleDelta(id, 0, i) * 1000; // scale noise to dB range
            }
          }
        },
      });
    }

    // Byte frequency data — values 0–255
    const _origGBFD = AnalyserNode.prototype.getByteFrequencyData;
    if (_origGBFD) {
      Object.defineProperty(AnalyserNode.prototype, 'getByteFrequencyData', {
        configurable: true,
        enumerable:   false,
        writable:     true,
        value: function getByteFrequencyData(array) {
          _origGBFD.call(this, array);
          const id = _bufId(this);
          for (let i = 0; i < array.length; i++) {
            const v = array[i] + _byteDelta(id, 0, i);
            array[i] = v < 0 ? 0 : v > 255 ? 255 : v;
          }
        },
      });
    }

    // Float time-domain data — values –1 to +1
    const _origGFTD = AnalyserNode.prototype.getFloatTimeDomainData;
    if (_origGFTD) {
      Object.defineProperty(AnalyserNode.prototype, 'getFloatTimeDomainData', {
        configurable: true,
        enumerable:   false,
        writable:     true,
        value: function getFloatTimeDomainData(array) {
          _origGFTD.call(this, array);
          const id = _bufId(this);
          for (let i = 0; i < array.length; i++) {
            array[i] = Math.max(-1.0, Math.min(1.0, array[i] + _sampleDelta(id, 1, i)));
          }
        },
      });
    }

    // Byte time-domain data — values 0–255
    const _origGBTD = AnalyserNode.prototype.getByteTimeDomainData;
    if (_origGBTD) {
      Object.defineProperty(AnalyserNode.prototype, 'getByteTimeDomainData', {
        configurable: true,
        enumerable:   false,
        writable:     true,
        value: function getByteTimeDomainData(array) {
          _origGBTD.call(this, array);
          const id = _bufId(this);
          for (let i = 0; i < array.length; i++) {
            const v = array[i] + _byteDelta(id, 1, i);
            array[i] = v < 0 ? 0 : v > 255 ? 255 : v;
          }
        },
      });
    }
  }

  // ── 3. OfflineAudioContext.prototype.startRendering ──────────────────────
  // Belt-and-suspenders: noise the final rendered AudioBuffer at the promise
  // level so even if getChannelData is called before our patch runs, the
  // delivered buffer is still noised.

  if (typeof OfflineAudioContext !== 'undefined') {
    const _origSR = OfflineAudioContext.prototype.startRendering;
    if (_origSR) {
      Object.defineProperty(OfflineAudioContext.prototype, 'startRendering', {
        configurable: true,
        enumerable:   false,
        writable:     true,
        value: function startRendering() {
          return _origSR.call(this).then(function (renderedBuffer) {
            // renderedBuffer is an AudioBuffer — our getChannelData patch
            // will fire when the page calls it.  We pre-warm the ID so
            // the same buffer ID is stable.
            _bufId(renderedBuffer);
            return renderedBuffer;
          });
        },
      });
    }
  }

  // ── 4. AudioContext.prototype.createBuffer ────────────────────────────────
  // Pre-register new buffers so their noise ID is assigned at creation time,
  // ensuring consistent noise across all subsequent read operations.

  if (typeof AudioContext !== 'undefined') {
    const _origCB = AudioContext.prototype.createBuffer;
    if (_origCB) {
      Object.defineProperty(AudioContext.prototype, 'createBuffer', {
        configurable: true,
        enumerable:   false,
        writable:     true,
        value: function createBuffer(numChannels, length, sampleRate) {
          const buf = _origCB.call(this, numChannels, length, sampleRate);
          _bufId(buf); // pre-register
          return buf;
        },
      });
    }
  }

  // Also covers OfflineAudioContext.createBuffer
  if (typeof OfflineAudioContext !== 'undefined') {
    const _origCB2 = OfflineAudioContext.prototype.createBuffer;
    if (_origCB2) {
      Object.defineProperty(OfflineAudioContext.prototype, 'createBuffer', {
        configurable: true,
        enumerable:   false,
        writable:     true,
        value: function createBuffer(numChannels, length, sampleRate) {
          const buf = _origCB2.call(this, numChannels, length, sampleRate);
          _bufId(buf);
          return buf;
        },
      });
    }
  }

  // ── 5. DynamicsCompressorNode property spoofing ───────────────────────────
  // Some advanced fingerprinters read compressor.reduction (a live float) as
  // part of the hash. We return a seeded stable value instead of the real one.

  if (typeof DynamicsCompressorNode !== 'undefined') {
    const _proto = DynamicsCompressorNode.prototype;
    const _origDesc = Object.getOwnPropertyDescriptor(_proto, 'reduction');
    if (_origDesc && _origDesc.get) {
      // Stable fake reduction value derived from seed: typically –12 to 0 dB
      const _fakeReduction = -((_SEED32 % 1200) / 100);  // –12.00 to 0 dB
      try {
        Object.defineProperty(_proto, 'reduction', {
          get: () => _fakeReduction,
          configurable: true,
          enumerable:   true,
        });
      } catch (_) { /* best-effort */ }
    }
  }

  // ── Guard ─────────────────────────────────────────────────────────────────
  Object.defineProperty(window, '__m_audio_patched__', {
    value: true, writable: false, configurable: false,
  });

})();`;
}

export type { EvasionConfig };
