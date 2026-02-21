// @ts-nocheck
// ── Manifold evasion: Client Hints + Screen/Viewport ─────────────────────────
//
// Covers two tightly-coupled fingerprint surfaces:
//
//   1. UA-CH (User-Agent Client Hints)
//        navigator.userAgentData   — brands, mobile, platform
//        getHighEntropyValues()    — platformVersion, architecture, bitness,
//                                    fullVersionList, uaFullVersion, model,
//                                    formFactor, wow64
//        Sec-CH-UA* request headers are kept consistent via the companion
//        route-interceptor exported as `installClientHintsRoute`.
//
//   2. Screen / Viewport / Letterboxing
//        screen.{width,height,availWidth,availHeight,colorDepth,pixelDepth}
//        window.{devicePixelRatio,outerWidth,outerHeight,screenX,screenY,
//                screenLeft,screenTop}
//        window.{innerWidth,innerHeight} are already set correctly by
//        Playwright's viewport option, so we only assert the value is
//        consistent rather than overriding it.
//
// Letterboxing model (maximised Chrome window):
//   outerWidth  = availWidth
//   outerHeight = availHeight
//   innerWidth  = viewportWidth   (Playwright-managed)
//   innerHeight = viewportHeight  (Playwright-managed)
//   chrome_h    = outerHeight - innerHeight  (toolbars; typically 74 px)
//   screenX/Y   = 0

import type { EvasionConfig } from "./types.js";

// ── Init-script factory ───────────────────────────────────────────────────────

export function clientHintsEvasion(cfg: EvasionConfig): string {
  const { uaCh, screen: s } = cfg;

  // Outer window = full available desktop area (maximised window)
  const outerW = s.availWidth;
  const outerH = s.availHeight;

  // Serialise brand list once
  const brandsJson       = JSON.stringify(uaCh.brands);
  // Full-version list is the same set; real Chrome only exposes the same
  // three brands in getHighEntropyValues({ hints: ['fullVersionList'] }).
  const fullVersionJson  = JSON.stringify(uaCh.brands);

  return /* js */`(function () {
  'use strict';

  // ── Shared config ─────────────────────────────────────────────────────────
  const _BRANDS            = ${brandsJson};
  const _MOBILE            = ${uaCh.mobile};
  const _PLATFORM          = ${JSON.stringify(uaCh.platform)};
  const _PLATFORM_VERSION  = ${JSON.stringify(uaCh.platformVersion)};
  const _ARCHITECTURE      = ${JSON.stringify(uaCh.architecture)};
  const _BITNESS           = ${JSON.stringify(uaCh.bitness)};
  const _FULL_VERSION_LIST = ${fullVersionJson};
  const _UA_FULL_VERSION   = ${JSON.stringify(uaCh.brands[uaCh.brands.length - 1]?.version ?? "")};

  const _SCR_W    = ${s.width};
  const _SCR_H    = ${s.height};
  const _AVAIL_W  = ${s.availWidth};
  const _AVAIL_H  = ${s.availHeight};
  const _COLOR_D  = ${s.colorDepth};
  const _DPR      = ${s.pixelRatio};
  const _OUTER_W  = ${outerW};
  const _OUTER_H  = ${outerH};

  // ── 1. navigator.userAgentData ────────────────────────────────────────────

  // Map of high-entropy hint name → value
  const _highEntropyMap = {
    brands:          _BRANDS,
    mobile:          _MOBILE,
    platform:        _PLATFORM,
    platformVersion: _PLATFORM_VERSION,
    architecture:    _ARCHITECTURE,
    bitness:         _BITNESS,
    fullVersionList: _FULL_VERSION_LIST,
    uaFullVersion:   _UA_FULL_VERSION,
    model:           '',
    formFactor:      [],
    wow64:           false,
  };

  // Build a NavigatorUAData-like object whose prototype chain satisfies
  // instanceof checks performed by some detection scripts.
  const _uaDataProto = (typeof NavigatorUAData !== 'undefined')
    ? NavigatorUAData.prototype
    : Object.prototype;

  const _uaData = Object.create(_uaDataProto);

  Object.defineProperties(_uaData, {
    brands: {
      get: () => _BRANDS.map(b => Object.freeze({ brand: b.brand, version: b.version })),
      enumerable: true,
      configurable: true,
    },
    mobile: {
      get: () => _MOBILE,
      enumerable: true,
      configurable: true,
    },
    platform: {
      get: () => _PLATFORM,
      enumerable: true,
      configurable: true,
    },
    getHighEntropyValues: {
      value: function getHighEntropyValues(hints) {
        if (!Array.isArray(hints)) {
          return Promise.reject(new TypeError('hints must be an array'));
        }
        const result = {};
        for (const hint of hints) {
          if (Object.prototype.hasOwnProperty.call(_highEntropyMap, hint)) {
            result[hint] = _highEntropyMap[hint];
          }
        }
        return Promise.resolve(result);
      },
      writable: false,
      enumerable: true,
      configurable: true,
    },
    toJSON: {
      value: function toJSON() {
        return { brands: _BRANDS, mobile: _MOBILE, platform: _PLATFORM };
      },
      writable: false,
      enumerable: true,
      configurable: true,
    },
  });

  Object.freeze(_uaData);

  Object.defineProperty(navigator, 'userAgentData', {
    get: () => _uaData,
    set: () => {},           // silently reject writes
    enumerable: true,
    configurable: true,
  });

  // ── 2. screen.* overrides ─────────────────────────────────────────────────

  // We override the getters on the Screen prototype so that all access paths
  // (window.screen.width, self.screen.width, etc.) return our values.
  const _screenProps = {
    width:       _SCR_W,
    height:      _SCR_H,
    availWidth:  _AVAIL_W,
    availHeight: _AVAIL_H,
    colorDepth:  _COLOR_D,
    pixelDepth:  _COLOR_D,
  };

  const _ScreenProto = Object.getPrototypeOf(screen);
  for (const [prop, val] of Object.entries(_screenProps)) {
    try {
      Object.defineProperty(_ScreenProto, prop, {
        get: (function (v) { return () => v; })(val),
        set: () => {},
        enumerable:   true,
        configurable: true,
      });
    } catch (_) {
      // Fallback: define directly on the screen object if prototype is sealed
      try {
        Object.defineProperty(screen, prop, {
          get: (function (v) { return () => v; })(val),
          set: () => {},
          enumerable:   true,
          configurable: true,
        });
      } catch (__) { /* best-effort */ }
    }
  }

  // ── 3. devicePixelRatio ───────────────────────────────────────────────────

  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      get: () => _DPR,
      set: () => {},
      enumerable:   true,
      configurable: true,
    });
  } catch (_) { /* viewport DPR is correct if Playwright launched with the right scale */ }

  // ── 4. Outer window dimensions (letterboxing) ─────────────────────────────
  //
  // In a real maximised Chrome window the outer size equals the available
  // desktop area. In headless Playwright the outer dimensions default to the
  // viewport size (no simulated browser chrome). We override them so that
  // detection scripts see a believable chrome height difference.

  for (const [prop, val] of [['outerWidth', _OUTER_W], ['outerHeight', _OUTER_H]]) {
    try {
      Object.defineProperty(window, prop, {
        get: (function (v) { return () => v; })(val),
        set: () => {},
        enumerable:   true,
        configurable: true,
      });
    } catch (_) { /* best-effort */ }
  }

  // ── 5. screenX / screenY / screenLeft / screenTop ─────────────────────────
  //
  // A maximised window sits at (0, 0) on the primary monitor.

  for (const prop of ['screenX', 'screenY', 'screenLeft', 'screenTop']) {
    try {
      Object.defineProperty(window, prop, {
        get: () => 0,
        set: () => {},
        enumerable:   true,
        configurable: true,
      });
    } catch (_) { /* best-effort */ }
  }

  // ── 6. matchMedia DPR consistency ────────────────────────────────────────
  //
  // Some scripts probe devicePixelRatio via
  //   window.matchMedia('(device-pixel-ratio: 2)').matches
  // We intercept matchMedia and patch the result for DPR queries.

  const _origMatchMedia = window.matchMedia.bind(window);
  Object.defineProperty(window, 'matchMedia', {
    value: function matchMedia(query) {
      const mql = _origMatchMedia(query);
      // Normalise DPR queries
      const dprMatch = query.match(/\\(\\s*(?:-webkit-)?device-pixel-ratio\\s*:\\s*([\\d.]+)\\s*\\)/);
      if (dprMatch) {
        const queried = parseFloat(dprMatch[1]);
        const matches = Math.abs(queried - _DPR) < 0.001;
        return Object.defineProperties(Object.create(Object.getPrototypeOf(mql)), {
          matches:    { value: matches, writable: false, enumerable: true, configurable: true },
          media:      { value: mql.media, writable: false, enumerable: true, configurable: true },
          onchange:   { value: null, writable: true, enumerable: true, configurable: true },
          addListener:    { value: mql.addListener.bind(mql),    enumerable: true, configurable: true },
          removeListener: { value: mql.removeListener.bind(mql), enumerable: true, configurable: true },
          addEventListener:    { value: mql.addEventListener.bind(mql),    enumerable: true, configurable: true },
          removeEventListener: { value: mql.removeEventListener.bind(mql), enumerable: true, configurable: true },
          dispatchEvent: { value: mql.dispatchEvent.bind(mql), enumerable: true, configurable: true },
        });
      }
      return mql;
    },
    writable: true,
    enumerable: true,
    configurable: true,
  });

  // ── Guard ─────────────────────────────────────────────────────────────────
  Object.defineProperty(window, '__m_ch_patched__', {
    value: true, writable: false, configurable: false,
  });

})();`;
}

// ── Playwright route-level header injector ────────────────────────────────────
//
// Call this after creating a BrowserContext / Page to keep Sec-CH-UA* request
// headers in sync with the JS-level userAgentData override above.
//
// Usage (in your bridge/session bootstrap):
//
//   import { installClientHintsRoute } from '../evasions/client-hints.js';
//   await installClientHintsRoute(page, cfg);

import type { Page, Route, Request } from "playwright";

// Chrome's canonical navigation-request header order (regular headers only;
// pseudo-headers are managed by Chromium's H2 stack automatically).
const CHROME_HEADER_ORDER: ReadonlyArray<string> = [
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "upgrade-insecure-requests",
  "user-agent",
  "accept",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-user",
  "sec-fetch-dest",
  "accept-encoding",
  "accept-language",
  // Cookie goes last (browser default)
  "cookie",
];

// Sub-resource requests (XHR/fetch/img/script) don't send upgrade-insecure or
// sec-fetch-user; they do send sec-ch-ua trio + origin/referer.
const CHROME_SUBRESOURCE_ORDER: ReadonlyArray<string> = [
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "origin",
  "user-agent",
  "accept",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "referer",
  "accept-encoding",
  "accept-language",
  "cookie",
];

/** Reorder a headers map to match Chrome's typical on-the-wire order.
 *  Headers not present in the reference order are appended at the end
 *  in their original relative order. */
function reorderHeaders(
  headers: Record<string, string>,
  order: ReadonlyArray<string>
): Record<string, string> {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    lower[k.toLowerCase()] = v;
  }

  const result: Record<string, string> = {};

  for (const name of order) {
    if (name in lower) {
      result[name] = lower[name];
    }
  }
  // Append any headers not covered by the reference order
  for (const [k, v] of Object.entries(lower)) {
    if (!(k in result)) {
      result[k] = v;
    }
  }
  return result;
}

/** Builds the Sec-CH-UA header value from a brand list.
 *  e.g. `"Not/A)Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"` */
function buildSecChUa(brands: Array<{ brand: string; version: string }>): string {
  return brands
    .map(({ brand, version }) => `"${brand}";v="${version}"`)
    .join(", ");
}

export async function installClientHintsRoute(
  page: Page,
  cfg: EvasionConfig
): Promise<void> {
  const { uaCh, headers: hdrCfg, navigator: nav } = cfg;

  const secChUa         = buildSecChUa(uaCh.brands);
  const secChUaMobile   = uaCh.mobile ? "?1" : "?0";
  const secChUaPlatform = `"${uaCh.platform}"`;
  const acceptLanguage  = hdrCfg.acceptLanguage;
  const userAgent       = nav.userAgent;

  await page.route("**/*", async (route: Route, request: Request) => {
    const rtype = request.resourceType();
    const isNav = rtype === "document";
    const order = isNav ? CHROME_HEADER_ORDER : CHROME_SUBRESOURCE_ORDER;

    const existing = request.headers();

    // Inject / overwrite Client Hint headers
    const patched: Record<string, string> = {
      ...existing,
      "sec-ch-ua":          secChUa,
      "sec-ch-ua-mobile":   secChUaMobile,
      "sec-ch-ua-platform": secChUaPlatform,
      "accept-language":    acceptLanguage,
      "user-agent":         userAgent,
    };

    // Remove headers that headless Playwright sometimes adds spuriously
    delete patched["sec-ch-ua-full-version-list"];  // only sent after opt-in
    delete patched["sec-ch-ua-arch"];               // only sent after opt-in

    const ordered = reorderHeaders(patched, order);

    try {
      await route.continue({ headers: ordered });
    } catch {
      // Route may have been aborted elsewhere; ignore.
    }
  });
}

export type { EvasionConfig };
