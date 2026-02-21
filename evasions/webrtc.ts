// @ts-nocheck
// ── Manifold evasion: WebRTC ──────────────────────────────────────────────────
//
// Three modes (set via window.__M__.webrtc.mode):
//
//   "block"      — RTCPeerConnection is replaced with a stub that never fires
//                  any ICE candidates.  Safest; breaks sites that require WebRTC.
//
//   "fake_mdns"  — Real RTCPeerConnection works normally but all ICE candidates
//                  that would expose the host IP are rewritten:
//                    • host/srflx candidates → replaced with a seeded mDNS name
//                    • relay candidates      → kept (they already hide the IP)
//
//   "passthrough" — No interception; the real IP may leak.  Only safe when the
//                   browser is already behind a trusted proxy/VPN.
//
// Additionally, navigator.mediaDevices.getUserMedia and
// navigator.mediaDevices.enumerateDevices are shimmed to avoid device
// enumeration fingerprinting.

import type { EvasionConfig } from "./types.js";

export function webrtcEvasion(cfg: EvasionConfig): string {
  const { webrtc, seed } = cfg;
  const mode      = webrtc.mode;
  const fakeMdns  = webrtc.fakeMdns  ?? `${seed.toString(16).padStart(8,"0")}abcdef01.local`;
  const fakeIp    = webrtc.fakeIp    ?? "192.168.1.100";

  return /* js */`(function () {
  'use strict';

  const _MODE      = ${JSON.stringify(mode)};
  const _FAKE_MDNS = ${JSON.stringify(fakeMdns)};
  const _FAKE_IP   = ${JSON.stringify(fakeIp)};

  // ── Candidate rewriter ────────────────────────────────────────────────────
  //
  // SDP candidate line format (RFC 5245 §15.1):
  //   a=candidate:<foundation> <component> <transport> <priority>
  //              <connection-address> <port> typ <type>
  //              [raddr <rel-address>] [rport <rel-port>]
  //              [generation <gen>] [ufrag <ufrag>] [network-id <n>]

  const _HOST_RE   = /^(a=candidate:[^\s]+ \d+ \w+ \d+ )(\S+)( \d+ typ host.*)$/im;
  const _SRFLX_RE  = /^(a=candidate:[^\s]+ \d+ \w+ \d+ )(\S+)( \d+ typ srflx.*)$/im;
  const _RADDR_RE  = /raddr \S+/g;

  function _rewriteSdp(sdp) {
    if (_MODE === 'block') return sdp;

    return sdp
      // Replace host candidate IP with mDNS hostname
      .replace(/^(a=candidate:[^\s]+ \d+ \w+ \d+ )(\S+)( \d+ typ host.*)$/gim,
        (_, pre, _ip, post) => pre + _FAKE_MDNS + post
      )
      // Replace srflx candidate IP with fake IP, zero out raddr
      .replace(/^(a=candidate:[^\s]+ \d+ \w+ \d+ )(\S+)( \d+ typ srflx .*)(raddr )(\S+)(.*)/gim,
        (_, pre, _ip, mid, raddrKw, _raddr, tail) =>
          pre + _FAKE_IP + mid + raddrKw + _FAKE_IP + tail
      )
      // Scrub any remaining raddr that still contains a real IP
      .replace(/raddr (?:\d{1,3}\.){3}\d{1,3}/g, 'raddr 0.0.0.0')
      // Scrub IPv6 link-local in candidates
      .replace(/fe80::[^\s]*/gi, '::1');
  }

  function _rewriteCandidate(candidate) {
    if (!candidate || _MODE === 'block' || _MODE === 'passthrough') return candidate;

    // host candidate
    if (/typ host/i.test(candidate)) {
      return candidate.replace(
        /^(candidate:[^\s]+ \d+ \w+ \d+ )(\S+)( \d+ typ host)/i,
        (_, pre, _ip, post) => pre + _FAKE_MDNS + post
      );
    }
    // srflx candidate
    if (/typ srflx/i.test(candidate)) {
      return candidate
        .replace(
          /^(candidate:[^\s]+ \d+ \w+ \d+ )(\S+)( \d+ typ srflx)/i,
          (_, pre, _ip, post) => pre + _FAKE_IP + post
        )
        .replace(/raddr (?:\d{1,3}\.){3}\d{1,3}/gi, 'raddr 0.0.0.0');
    }
    // relay — pass through (already masking IP via TURN)
    return candidate;
  }

  // ── Block mode: full RTCPeerConnection stub ───────────────────────────────

  if (_MODE === 'block') {
    const _noop = () => {};
    const _rejectedPromise = () => Promise.reject(new DOMException('NotSupportedError'));

    class BlockedRTCPeerConnection extends EventTarget {
      constructor() { super(); }
      get localDescription()  { return null; }
      get remoteDescription() { return null; }
      get signalingState()    { return 'closed'; }
      get iceConnectionState(){ return 'closed'; }
      get iceGatheringState() { return 'complete'; }
      get connectionState()   { return 'closed'; }
      get canTrickleIceCandidates() { return null; }
      get sctp() { return null; }

      createOffer()  { return _rejectedPromise(); }
      createAnswer() { return _rejectedPromise(); }
      setLocalDescription()  { return _rejectedPromise(); }
      setRemoteDescription() { return _rejectedPromise(); }
      addIceCandidate()      { return Promise.resolve(); }
      close() {}
      addTrack()    { throw new DOMException('InvalidStateError'); }
      removeTrack() {}
      addTransceiver() { throw new DOMException('InvalidStateError'); }
      createDataChannel() { throw new DOMException('InvalidStateError'); }
      getConfiguration()  { return {}; }
      setConfiguration()  {}
      getStats()          { return Promise.resolve(new Map()); }
      getSenders()        { return []; }
      getReceivers()      { return []; }
      getTransceivers()   { return []; }
      restartIce()        {}
    }

    // Mirror static methods
    BlockedRTCPeerConnection.generateCertificate =
      RTCPeerConnection.generateCertificate
        ? RTCPeerConnection.generateCertificate.bind(RTCPeerConnection)
        : _rejectedPromise;

    // Replace globally
    Object.defineProperty(window, 'RTCPeerConnection', {
      get: () => BlockedRTCPeerConnection,
      set: _noop,
      configurable: false,
      enumerable: true,
    });
    if ('webkitRTCPeerConnection' in window) {
      Object.defineProperty(window, 'webkitRTCPeerConnection', {
        get: () => BlockedRTCPeerConnection,
        set: _noop,
        configurable: false,
        enumerable: true,
      });
    }

    // Also block RTCDataChannel and RTCSessionDescription constructors
    // (they still work but won't expose IPs — harmless to leave real ones)
  }

  // ── Fake-mDNS mode: intercept ICE candidates ──────────────────────────────

  if (_MODE === 'fake_mdns') {
    const _NativeRTC = window.RTCPeerConnection;

    class MaskedRTCPeerConnection extends _NativeRTC {
      constructor(config, constraints) {
        // Force mdns-candidate generation if browser supports it
        const patched = Object.assign({}, config);
        super(patched, constraints);

        // Intercept onicecandidate events emitted by the native object
        this.addEventListener('icecandidate', (evt) => {
          if (!evt.candidate) return; // end-of-candidates signal — pass through
          const raw = evt.candidate.candidate;
          if (!raw) return;
          const rewritten = _rewriteCandidate(raw);
          if (rewritten === raw) return; // nothing changed — event will fire normally

          // Stop the original event and re-dispatch with rewritten candidate
          evt.stopImmediatePropagation();
          const fakeEvt = new RTCPeerConnectionIceEvent('icecandidate', {
            candidate: new RTCIceCandidate({
              candidate:     rewritten,
              sdpMid:        evt.candidate.sdpMid,
              sdpMLineIndex: evt.candidate.sdpMLineIndex,
              usernameFragment: evt.candidate.usernameFragment,
            }),
          });
          this.dispatchEvent(fakeEvt);
          if (typeof this.onicecandidate === 'function') {
            this.onicecandidate(fakeEvt);
          }
        }, { capture: true });
      }

      // Rewrite SDP before handing it back to the page
      async createOffer(options) {
        const offer = await super.createOffer(options);
        return new RTCSessionDescription({
          type: offer.type,
          sdp:  _rewriteSdp(offer.sdp),
        });
      }

      async createAnswer(options) {
        const answer = await super.createAnswer(options);
        return new RTCSessionDescription({
          type: answer.type,
          sdp:  _rewriteSdp(answer.sdp),
        });
      }
    }

    // Mirror statics
    if (_NativeRTC.generateCertificate) {
      MaskedRTCPeerConnection.generateCertificate =
        _NativeRTC.generateCertificate.bind(_NativeRTC);
    }

    Object.defineProperty(window, 'RTCPeerConnection', {
      get: () => MaskedRTCPeerConnection,
      configurable: true,
      enumerable: true,
    });
    if ('webkitRTCPeerConnection' in window) {
      Object.defineProperty(window, 'webkitRTCPeerConnection', {
        get: () => MaskedRTCPeerConnection,
        configurable: true,
        enumerable: true,
      });
    }
  }

  // ── Media device enumeration shim ─────────────────────────────────────────
  //
  // Prevent device ID / label fingerprinting via enumerateDevices().
  // We return a realistic-looking but fixed set of device stubs.

  if (navigator.mediaDevices) {
    const _origEnum = navigator.mediaDevices.enumerateDevices.bind(
      navigator.mediaDevices
    );

    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      configurable: true,
      enumerable:   false,
      writable:     true,
      value: async function enumerateDevices() {
        const real = await _origEnum();

        // Strip real labels and replace device IDs with seeded stable IDs
        return real.map((dev, idx) => {
          // Build a seeded ID: deterministic per (seed, idx, kind)
          const h = (${seed} ^ (idx * 0x9e3779b9) ^ (dev.kind.charCodeAt(0) * 0x6b43a9b5)) >>> 0;
          const fakeId = h.toString(16).padStart(8, '0') +
            ((h * 0x517cc1b727220a95n) & 0xffffffffn).toString(16).padStart(8,'0');

          return {
            kind:       dev.kind,
            deviceId:   dev.deviceId   ? fakeId     : '',
            groupId:    dev.groupId    ? fakeId + '0' : '',
            label:      dev.label      ? ''          : '',
            toJSON:     () => ({ kind: dev.kind, deviceId: fakeId, groupId: fakeId + '0', label: '' }),
          };
        });
      },
    });
  }

  // ── Mark patched ──────────────────────────────────────────────────────────
  Object.defineProperty(window, '__m_webrtc_patched__', {
    value: _MODE, writable: false, configurable: false,
  });

})();`;
}

export type { EvasionConfig };
