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

  // ── mDNS hostname: UUID format matching real Chromium RTCIceCandidate ──────
  // Chrome generates mDNS hostnames as lowercase UUID v4 (RFC 4122 §4.4)
  // with the variant bits set correctly.  The plain 16-hex format is a known
  // synthetic fingerprint that DataDome / Cloudflare BM v2 pattern-match on.
  //
  // UUID v4 layout:  xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
  //   bits 48–51 forced to 0100 (version 4)
  //   bits 64–65 forced to 10   (variant 1, RFC 4122)
  //
  // We derive all 122 random bits from the profile seed so the hostname is
  // stable within a profile but unique across profiles.
  function _seedUUID(s: number): string {
    // Four 32-bit words from a simple LCG chain on the seed
    const a = ((s  * 0x6364136d + 0x1442a36) >>> 0);
    const b = ((a  * 0x6364136d + 0x1442a36) >>> 0);
    const c = ((b  * 0x6364136d + 0x1442a36) >>> 0);
    const d = ((c  * 0x6364136d + 0x1442a36) >>> 0);
    const hex = (n: number) => n.toString(16).padStart(8, "0");
    const h = hex(a) + hex(b) + hex(c) + hex(d);
    // Force version=4 (nibble 12) and variant=10xx (nibble 16)
    const v4 = h.slice(0, 12) + "4" + h.slice(13, 16) +
               (((parseInt(h[16], 16) & 0x3) | 0x8)).toString(16) +
               h.slice(17, 32);
    return [
      v4.slice(0, 8),
      v4.slice(8, 12),
      v4.slice(12, 16),
      v4.slice(16, 20),
      v4.slice(20, 32),
    ].join("-") + ".local";
  }

  const fakeMdns = webrtc.fakeMdns ?? _seedUUID(seed);
  const fakeIp   = webrtc.fakeIp   ?? "192.168.1.100";

  // ── Realistic ICE candidate priority encoder ─────────────────────────────
  // ICE priority = (2^24 × type_pref) + (2^8 × local_pref) + (256 - component)
  // Real Chrome values (component=1, local_pref=32767):
  //   host :  2122260223  (type_pref=126)
  //   srflx:  1686052607  (type_pref=100)
  //   prflx:  1845501695  (type_pref=110)
  //   relay:   33562367   (type_pref=  2)
  // Detectors look for deviation from these bit-patterns as a synthetic signal.
  // We keep the real priority from the native stack and only rewrite the IP.

  return /* js */`(function () {
  'use strict';

  const _MODE      = ${JSON.stringify(mode)};
  const _FAKE_MDNS = ${JSON.stringify(fakeMdns)};
  const _FAKE_IP   = ${JSON.stringify(fakeIp)};

  // Validate that _FAKE_MDNS is UUID format (catches legacy configs)
  const _MDNS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.local$/i;
  const _SAFE_MDNS = _MDNS_UUID_RE.test(_FAKE_MDNS)
    ? _FAKE_MDNS
    : (() => {
        // Fallback: derive UUID from the legacy hex hostname's bytes
        const h = _FAKE_MDNS.replace('.local','').replace(/-/g,'').padEnd(32,'0').slice(0,32);
        return [h.slice(0,8),h.slice(8,12),'4'+h.slice(13,16),
                (((parseInt(h[16],16)&3)|8).toString(16))+h.slice(17,20),
                h.slice(20,32)].join('-') + '.local';
      })();

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
        // Replace host candidate IP with UUID mDNS hostname
        .replace(/^(a=candidate:[^\s]+ \d+ \w+ \d+ )(\S+)( \d+ typ host.*)$/gim,
          (_, pre, _ip, post) => pre + _SAFE_MDNS + post
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

    // host candidate — replace IP with UUID mDNS name
    // Priority bits must remain untouched (derived from native stack)
    if (/typ host/i.test(candidate)) {
      return candidate.replace(
        /^(candidate:[^\s]+ \d+ \w+ \d+ )(\S+)( \d+ typ host)/i,
        (_, pre, _ip, post) => pre + _SAFE_MDNS + post
      );
    }
    // srflx candidate — replace IP, preserve priority and all other fields
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
          // Build a seeded device ID: UUID v4 format (matches real Chrome device IDs)
                  const _s0 = (${seed} ^ (idx * 0x9e3779b9) ^ (dev.kind.charCodeAt(0) * 0x6b43a9b5)) >>> 0;
                  const _s1 = (_s0 * 0x6364136d + 0x1442a36) >>> 0;
                  const _s2 = (_s1 * 0x6364136d + 0x1442a36) >>> 0;
                  const _s3 = (_s2 * 0x6364136d + 0x1442a36) >>> 0;
                  const _dh = _s0.toString(16).padStart(8,'0') + _s1.toString(16).padStart(8,'0') +
                              _s2.toString(16).padStart(8,'0') + _s3.toString(16).padStart(8,'0');
                  const fakeId = [_dh.slice(0,8), _dh.slice(8,12),
                                  '4' + _dh.slice(13,16),
                                  (((parseInt(_dh[16],16)&3)|8).toString(16)) + _dh.slice(17,20),
                                  _dh.slice(20,32)].join('-');

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
