// ── Manifold evasions — shared types ─────────────────────────────────────────
//
// Re-export the canonical EvasionConfig (and related types) from the
// playwright-bridge package so every evasion module can import from the
// same relative path ("./types.js") without referencing the bridge directly.

export type {
  EvasionConfig,
  UaBrand,
  WebRtcMode,
} from "../playwright-bridge/types.js";
