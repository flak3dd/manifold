// @ts-nocheck
// ── Manifold evasion: Navigator + Permissions ─────────────────────────────────
//
// Spoofs three tightly-related navigator surfaces:
//
//   1. navigator.hardwareConcurrency
//        Returns the spoofed CPU thread count from the fingerprint profile.
//
//   2. navigator.deviceMemory
//        Returns the spoofed RAM bucket (0.25 | 0.5 | 1 | 2 | 4 | 8 | …).
//        Only exposed in secure contexts; gracefully skipped otherwise.
//
//   3. navigator.permissions.query()
//        Returns spoofed PermissionStatus objects for any permission name
//        listed in the profile's permissions map.  Unknown permissions fall
//        through to the real browser API so legitimate site logic is not broken.
//
// All overrides are applied to the prototype chain where possible so that
// frames / workers that inherit the same prototype also see consistent values.

import type { EvasionConfig } from "./types.js";

// ── Init-script factory ───────────────────────────────────────────────────────

export function navigatorEvasion(cfg: EvasionConfig): string {
  const { navigator: nav, permissions } = cfg;

  const concurrency   = Math.max(1, Math.round(nav.hardwareConcurrency));
  const deviceMemory  = nav.deviceMemory;          // already a valid bucket value
  const permsJson     = JSON.stringify(permissions); // e.g. {"notifications":"denied"}

  return /* js */`(function () {
  'use strict';

  // ── 1. hardwareConcurrency ────────────────────────────────────────────────
  //
  // Defined on NavigatorConcurrentHardware mixin → Navigator.prototype in
  // Chromium.  Overriding on the prototype propagates to all frames.

  (function _patchConcurrency() {
    const _TARGET = ${concurrency};
    const _proto  = Object.getPrototypeOf(navigator);

    try {
      Object.defineProperty(_proto, 'hardwareConcurrency', {
        get: () => _TARGET,
        set: () => {},
        enumerable:   true,
        configurable: true,
      });
    } catch (_) {
      // Prototype is frozen in some embeddings; fall back to own property.
      try {
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => _TARGET,
          set: () => {},
          enumerable:   true,
          configurable: true,
        });
      } catch (__) { /* best-effort */ }
    }
  })();

  // ── 2. deviceMemory ───────────────────────────────────────────────────────
  //
  // Only present in secure contexts (https / localhost).  We guard with an
  // existence check so the script doesn't throw on http pages.

  (function _patchDeviceMemory() {
    const _TARGET = ${deviceMemory};
    if (!('deviceMemory' in navigator)) return; // API not available

    const _proto = Object.getPrototypeOf(navigator);

    try {
      Object.defineProperty(_proto, 'deviceMemory', {
        get: () => _TARGET,
        set: () => {},
        enumerable:   true,
        configurable: true,
      });
    } catch (_) {
      try {
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => _TARGET,
          set: () => {},
          enumerable:   true,
          configurable: true,
        });
      } catch (__) { /* best-effort */ }
    }
  })();

  // ── 3. Permissions API ────────────────────────────────────────────────────
  //
  // navigator.permissions.query({ name }) returns a Promise<PermissionStatus>.
  // PermissionStatus extends EventTarget and exposes:
  //   .state       "granted" | "denied" | "prompt"
  //   .onchange    event handler
  //
  // Strategy:
  //   • For any permission name present in our spoof map, resolve immediately
  //     with a frozen PermissionStatus-like object.
  //   • All other names pass through to the real query() implementation.
  //
  // We also handle the case where navigator.permissions is undefined (some
  // old browsers / restricted contexts).

  (function _patchPermissions() {
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
      return;
    }

    // Spoof map: { permissionName → "granted" | "denied" | "prompt" }
    const _SPOOF_MAP = ${permsJson};

    const _origQuery = navigator.permissions.query.bind(navigator.permissions);

    // Build a minimal PermissionStatus object that passes duck-type checks.
    function _makeStatus(name, state) {
      // Try to inherit from the real PermissionStatus prototype for instanceof
      // checks used by advanced detection scripts.
      let proto = Object.prototype;
      try {
        // Obtain a real PermissionStatus to steal its prototype
        // We use a known-allowed name that every browser grants or prompts.
        // This is synchronous-ish via a pre-resolved promise trick — we cache
        // a real PermissionStatus prototype the first time we can.
        if (typeof _makeStatus._proto === 'undefined') {
          _makeStatus._proto = null; // sentinel: don't re-enter
          _origQuery({ name: 'notifications' }).then(function (ps) {
            _makeStatus._proto = Object.getPrototypeOf(ps);
          }).catch(function () {});
        }
        if (_makeStatus._proto) proto = _makeStatus._proto;
      } catch (_) {}

      const status = Object.create(proto);
      let _onchange = null;

      Object.defineProperties(status, {
        name: {
          value: name,
          writable: false,
          enumerable: true,
          configurable: true,
        },
        state: {
          value: state,
          writable: false,
          enumerable: true,
          configurable: true,
        },
        onchange: {
          get: () => _onchange,
          set: (v) => { _onchange = (typeof v === 'function') ? v : null; },
          enumerable:   true,
          configurable: true,
        },
        // EventTarget methods — no-ops since the state never changes
        addEventListener: {
          value: function addEventListener() {},
          writable: true, enumerable: true, configurable: true,
        },
        removeEventListener: {
          value: function removeEventListener() {},
          writable: true, enumerable: true, configurable: true,
        },
        dispatchEvent: {
          value: function dispatchEvent() { return true; },
          writable: true, enumerable: true, configurable: true,
        },
        toJSON: {
          value: function toJSON() { return { name, state }; },
          writable: true, enumerable: true, configurable: true,
        },
      });

      return status;
    }

    // Patched query function
    function _query(descriptor) {
      if (descriptor && typeof descriptor.name === 'string') {
        const name = descriptor.name;
        if (Object.prototype.hasOwnProperty.call(_SPOOF_MAP, name)) {
          const state = _SPOOF_MAP[name];
          return Promise.resolve(_makeStatus(name, state));
        }
      }
      // Fall through to real implementation for unknown permissions
      return _origQuery(descriptor);
    }

    // Install on the Permissions prototype so all access paths are covered
    try {
      const _PermProto = Object.getPrototypeOf(navigator.permissions);
      Object.defineProperty(_PermProto, 'query', {
        value: _query,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } catch (_) {
      // Fallback: install directly on the instance
      try {
        Object.defineProperty(navigator.permissions, 'query', {
          value: _query,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } catch (__) { /* best-effort */ }
    }

  })();

  // ── 4. navigator.webdriver hardening ─────────────────────────────────────
  //
  // Playwright sets navigator.webdriver = true by default.
  // We override it here as a belt-and-suspenders measure alongside
  // puppeteer-extra-plugin-stealth's own patch.

  (function _patchWebdriver() {
    try {
      const _proto = Object.getPrototypeOf(navigator);
      const desc   = Object.getOwnPropertyDescriptor(_proto, 'webdriver')
                  ?? Object.getOwnPropertyDescriptor(navigator, 'webdriver');
      if (desc && desc.configurable) {
        Object.defineProperty(_proto, 'webdriver', {
          get: () => undefined,
          set: () => {},
          enumerable:   false,
          configurable: true,
        });
      }
    } catch (_) { /* best-effort */ }
  })();

  // ── Guard ─────────────────────────────────────────────────────────────────
  Object.defineProperty(window, '__m_navigator_patched__', {
    value: true, writable: false, configurable: false,
  });

})();`;
}

export type { EvasionConfig };
