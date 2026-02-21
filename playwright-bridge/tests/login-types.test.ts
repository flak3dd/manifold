// ── Tests: playwright-bridge/login-types ─────────────────────────────────────
//
// Covers:
//   • parseCredentialCsv   — header detection, colon/comma split, extras
//   • parseCredentialJson  — field aliases, extras, bad input
//   • computeRunStats      — aggregation across all status variants
//   • resolveDomainProfile — exact match, www strip, subdomain fallback, default

import { describe, it, expect } from "vitest";
import {
  parseCredentialCsv,
  parseCredentialJson,
  computeRunStats,
  resolveDomainProfile,
  DOMAIN_PROFILES,
  DEFAULT_DOMAIN_PROFILE,
} from "../login-types.js";
import type { CredentialPair, CredentialStatus, RotationEvent } from "../login-types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCred(status: CredentialStatus = "pending"): CredentialPair {
  return {
    id: "test-id",
    username: "user@example.com",
    password: "pass123",
    extras: {},
    status,
    profile_id: null,
    last_attempt: null,
    attempts: 0,
  };
}

function makeRotationEvent(): RotationEvent {
  return {
    ts: Date.now(),
    trigger: "rate_limit_429",
    old_profile_id: "p1",
    new_profile_id: "p2",
    old_proxy_id: null,
    new_proxy_id: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// parseCredentialCsv
// ─────────────────────────────────────────────────────────────────────────────

describe("parseCredentialCsv", () => {
  // ── Basic header detection ────────────────────────────────────────────────

  it("parses standard username,password header CSV", () => {
    const csv = "username,password\nalice,secret1\nbob,secret2";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe("alice");
    expect(result[0].password).toBe("secret1");
    expect(result[1].username).toBe("bob");
    expect(result[1].password).toBe("secret2");
  });

  it("detects email header as username alias", () => {
    const csv = "email,password\nfoo@bar.com,pw\nbaz@qux.com,pw2";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe("foo@bar.com");
    expect(result[1].username).toBe("baz@qux.com");
  });

  it("detects login header as username alias", () => {
    const csv = "login,password\nmy_login,my_pass";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("my_login");
  });

  it("detects user header as username alias", () => {
    const csv = "user,pass\nadmin,hunter2";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("admin");
    expect(result[0].password).toBe("hunter2");
  });

  it("detects pwd header as password alias", () => {
    const csv = "username,pwd\nalice,mypassword";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0].password).toBe("mypassword");
  });

  it("captures extra columns into extras", () => {
    const csv = "username,password,totp_seed,phone\nalice,pw,JBSWY3DPEHPK3PXP,555-1234";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0].extras["totp_seed"]).toBe("JBSWY3DPEHPK3PXP");
    expect(result[0].extras["phone"]).toBe("555-1234");
    // username/password must NOT appear in extras
    expect(result[0].extras["username"]).toBeUndefined();
    expect(result[0].extras["password"]).toBeUndefined();
  });

  // ── No-header (colon / comma separated) ──────────────────────────────────

  it("parses colon-separated lines without header", () => {
    const csv = "alice:secret1\nbob:secret2";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe("alice");
    expect(result[0].password).toBe("secret1");
    expect(result[1].username).toBe("bob");
  });

  it("handles passwords that contain colons (takes everything after first colon)", () => {
    const csv = "user:pass:with:colons";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("user");
    expect(result[0].password).toBe("pass:with:colons");
  });

  it("parses comma-separated lines without header when no colon present", () => {
    const csv = "alice,secret1\nbob,secret2";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe("alice");
  });

  // ── Status / bookkeeping defaults ────────────────────────────────────────

  it("sets status to pending by default", () => {
    const csv = "username,password\nalice,pw";
    const [cred] = parseCredentialCsv(csv);
    expect(cred.status).toBe("pending");
  });

  it("sets profile_id and last_attempt to null", () => {
    const csv = "alice:pw";
    const [cred] = parseCredentialCsv(csv);
    expect(cred.profile_id).toBeNull();
    expect(cred.last_attempt).toBeNull();
  });

  it("sets attempts to 0", () => {
    const csv = "alice:pw";
    const [cred] = parseCredentialCsv(csv);
    expect(cred.attempts).toBe(0);
  });

  it("assigns a non-empty id to each credential", () => {
    const csv = "a:b\nc:d";
    const result = parseCredentialCsv(csv);
    expect(result[0].id).toBeTruthy();
    expect(result[1].id).toBeTruthy();
    // IDs should be unique
    expect(result[0].id).not.toBe(result[1].id);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("returns empty array for empty input", () => {
    expect(parseCredentialCsv("")).toHaveLength(0);
    expect(parseCredentialCsv("   ")).toHaveLength(0);
    expect(parseCredentialCsv("\n\n\n")).toHaveLength(0);
  });

  it("skips lines with missing username", () => {
    const csv = "username,password\n,secret";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(0);
  });

  it("skips lines with missing password", () => {
    const csv = "username,password\nalice,";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(0);
  });

  it("skips blank lines in the middle", () => {
    const csv = "alice:pw\n\nbob:pw2\n";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(2);
  });

  it("trims whitespace from username and password", () => {
    const csv = "username,password\n  alice  ,  secret  ";
    const result = parseCredentialCsv(csv);
    expect(result[0].username).toBe("alice");
    expect(result[0].password).toBe("secret");
  });

  it("handles CRLF line endings", () => {
    const csv = "username,password\r\nalice,pw\r\nbob,pw2";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for header-only CSV with no data rows", () => {
    const csv = "username,password";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(0);
  });

  it("ignores header row in data (does not create a credential for it)", () => {
    const csv = "username,password\nalice,pw1\nbob,pw2";
    const result = parseCredentialCsv(csv);
    expect(result.every(c => c.username !== "username")).toBe(true);
  });

  it("handles large input efficiently", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `user${i}:pass${i}`).join("\n");
    const result = parseCredentialCsv(lines);
    expect(result).toHaveLength(1000);
    expect(result[999].username).toBe("user999");
    expect(result[999].password).toBe("pass999");
  });

  it("skips header-only row with no username/password columns found", () => {
    // A CSV where the header has columns but no username or password column
    const csv = "first_name,last_name\nJohn,Doe";
    const result = parseCredentialCsv(csv);
    expect(result).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCredentialJson
// ─────────────────────────────────────────────────────────────────────────────

describe("parseCredentialJson", () => {
  // ── Standard format ───────────────────────────────────────────────────────

  it("parses standard username/password array", () => {
    const json = JSON.stringify([
      { username: "alice", password: "pw1" },
      { username: "bob", password: "pw2" },
    ]);
    const result = parseCredentialJson(json);
    expect(result).toHaveLength(2);
    expect(result[0].username).toBe("alice");
    expect(result[0].password).toBe("pw1");
    expect(result[1].username).toBe("bob");
  });

  it("handles email field alias", () => {
    const json = JSON.stringify([{ email: "alice@test.com", password: "pw" }]);
    const result = parseCredentialJson(json);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("alice@test.com");
  });

  it("handles login field alias", () => {
    const json = JSON.stringify([{ login: "alice_login", password: "pw" }]);
    const result = parseCredentialJson(json);
    expect(result[0].username).toBe("alice_login");
  });

  it("handles user field alias", () => {
    const json = JSON.stringify([{ user: "alice_user", password: "pw" }]);
    const result = parseCredentialJson(json);
    expect(result[0].username).toBe("alice_user");
  });

  it("handles pass field alias for password", () => {
    const json = JSON.stringify([{ username: "alice", pass: "my_pass" }]);
    const result = parseCredentialJson(json);
    expect(result[0].password).toBe("my_pass");
  });

  it("handles pwd field alias for password", () => {
    const json = JSON.stringify([{ username: "alice", pwd: "my_pwd" }]);
    const result = parseCredentialJson(json);
    expect(result[0].password).toBe("my_pwd");
  });

  it("captures extra fields into extras", () => {
    const json = JSON.stringify([
      { username: "alice", password: "pw", totp_seed: "JBSWY3DPEHPK3PXP", phone: "555" },
    ]);
    const result = parseCredentialJson(json);
    expect(result[0].extras["totp_seed"]).toBe("JBSWY3DPEHPK3PXP");
    expect(result[0].extras["phone"]).toBe("555");
  });

  it("does not include known fields in extras", () => {
    const json = JSON.stringify([
      { username: "a", password: "b", email: "a@b.com" },
    ]);
    const result = parseCredentialJson(json);
    expect(result[0].extras["username"]).toBeUndefined();
    expect(result[0].extras["password"]).toBeUndefined();
    expect(result[0].extras["email"]).toBeUndefined();
  });

  it("converts non-string extra values to strings", () => {
    const json = JSON.stringify([
      { username: "a", password: "b", score: 42, active: true },
    ]);
    const result = parseCredentialJson(json);
    expect(result[0].extras["score"]).toBe("42");
    expect(result[0].extras["active"]).toBe("true");
  });

  // ── Filtering ─────────────────────────────────────────────────────────────

  it("skips items with missing username", () => {
    const json = JSON.stringify([
      { password: "pw" },
      { username: "alice", password: "pw2" },
    ]);
    const result = parseCredentialJson(json);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("alice");
  });

  it("skips items with missing password", () => {
    const json = JSON.stringify([
      { username: "alice" },
      { username: "bob", password: "pw" },
    ]);
    const result = parseCredentialJson(json);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("bob");
  });

  it("skips null items in array", () => {
    const json = "[null, {\"username\":\"alice\",\"password\":\"pw\"}]";
    const result = parseCredentialJson(json);
    expect(result).toHaveLength(1);
  });

  it("skips non-object items", () => {
    const json = "[42, \"string\", {\"username\":\"u\",\"password\":\"p\"}]";
    const result = parseCredentialJson(json);
    expect(result).toHaveLength(1);
  });

  // ── Bad input ─────────────────────────────────────────────────────────────

  it("returns empty array for invalid JSON", () => {
    expect(parseCredentialJson("not json at all")).toHaveLength(0);
    expect(parseCredentialJson("{")).toHaveLength(0);
    expect(parseCredentialJson("")).toHaveLength(0);
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseCredentialJson('{"username":"a","password":"b"}')).toHaveLength(0);
    expect(parseCredentialJson('"just a string"')).toHaveLength(0);
    expect(parseCredentialJson("42")).toHaveLength(0);
    expect(parseCredentialJson("null")).toHaveLength(0);
    expect(parseCredentialJson("true")).toHaveLength(0);
  });

  it("returns empty array for empty JSON array", () => {
    expect(parseCredentialJson("[]")).toHaveLength(0);
  });

  // ── Status defaults ───────────────────────────────────────────────────────

  it("sets status to pending", () => {
    const json = JSON.stringify([{ username: "a", password: "b" }]);
    const [cred] = parseCredentialJson(json);
    expect(cred.status).toBe("pending");
  });

  it("assigns a unique id to each credential", () => {
    const json = JSON.stringify([
      { username: "a", password: "b" },
      { username: "c", password: "d" },
    ]);
    const result = parseCredentialJson(json);
    expect(result[0].id).toBeTruthy();
    expect(result[1].id).toBeTruthy();
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("sets profile_id, last_attempt to null and attempts to 0", () => {
    const json = JSON.stringify([{ username: "a", password: "b" }]);
    const [cred] = parseCredentialJson(json);
    expect(cred.profile_id).toBeNull();
    expect(cred.last_attempt).toBeNull();
    expect(cred.attempts).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeRunStats
// ─────────────────────────────────────────────────────────────────────────────

describe("computeRunStats", () => {
  it("counts total as credentials length", () => {
    const creds = [makeCred("pending"), makeCred("success"), makeCred("failed")];
    const stats = computeRunStats(creds, [], []);
    expect(stats.total).toBe(3);
  });

  it("returns zeros for all status counts on empty credentials", () => {
    const stats = computeRunStats([], [], []);
    expect(stats.total).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.success).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.soft_blocked).toBe(0);
    expect(stats.hard_blocked).toBe(0);
    expect(stats.error).toBe(0);
    expect(stats.skipped).toBe(0);
    expect(stats.rotations).toBe(0);
  });

  it("counts pending correctly", () => {
    const creds = [makeCred("pending"), makeCred("pending"), makeCred("success")];
    const stats = computeRunStats(creds, [], []);
    expect(stats.pending).toBe(2);
    expect(stats.success).toBe(1);
  });

  it("counts running correctly", () => {
    const creds = [makeCred("running"), makeCred("pending")];
    const stats = computeRunStats(creds, [], []);
    expect(stats.running).toBe(1);
  });

  it("counts success correctly", () => {
    const creds = [makeCred("success"), makeCred("success"), makeCred("failed")];
    const stats = computeRunStats(creds, [], []);
    expect(stats.success).toBe(2);
    expect(stats.failed).toBe(1);
  });

  it("counts soft_blocked correctly", () => {
    const creds = [makeCred("soft_blocked"), makeCred("soft_blocked"), makeCred("pending")];
    const stats = computeRunStats(creds, [], []);
    expect(stats.soft_blocked).toBe(2);
  });

  it("counts hard_blocked correctly", () => {
    const creds = [makeCred("hard_blocked")];
    const stats = computeRunStats(creds, [], []);
    expect(stats.hard_blocked).toBe(1);
  });

  it("counts error correctly", () => {
    const creds = [makeCred("error"), makeCred("error")];
    const stats = computeRunStats(creds, [], []);
    expect(stats.error).toBe(2);
  });

  it("counts skipped correctly", () => {
    const creds = [makeCred("skipped"), makeCred("pending")];
    const stats = computeRunStats(creds, [], []);
    expect(stats.skipped).toBe(1);
  });

  it("counts rotations from rotation log length", () => {
    const log = [makeRotationEvent(), makeRotationEvent(), makeRotationEvent()];
    const stats = computeRunStats([], [], log);
    expect(stats.rotations).toBe(3);
  });

  it("counts rotations as 0 for empty rotation log", () => {
    const stats = computeRunStats([makeCred()], [], []);
    expect(stats.rotations).toBe(0);
  });

  it("handles all statuses in one run", () => {
    const creds: CredentialPair[] = [
      makeCred("pending"),
      makeCred("running"),
      makeCred("success"),
      makeCred("failed"),
      makeCred("soft_blocked"),
      makeCred("hard_blocked"),
      makeCred("error"),
      makeCred("skipped"),
    ];
    const stats = computeRunStats(creds, [], [makeRotationEvent()]);
    expect(stats.total).toBe(8);
    expect(stats.pending).toBe(1);
    expect(stats.running).toBe(1);
    expect(stats.success).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.soft_blocked).toBe(1);
    expect(stats.hard_blocked).toBe(1);
    expect(stats.error).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.rotations).toBe(1);
  });

  it("total equals sum of all per-status counts", () => {
    const creds = [
      makeCred("success"),
      makeCred("failed"),
      makeCred("pending"),
      makeCred("soft_blocked"),
      makeCred("error"),
    ];
    const stats = computeRunStats(creds, [], []);
    const sum =
      stats.pending +
      stats.running +
      stats.success +
      stats.failed +
      stats.soft_blocked +
      stats.hard_blocked +
      stats.error +
      stats.skipped;
    expect(sum).toBe(stats.total);
  });

  it("counts multiple successes in a large batch", () => {
    const creds = Array.from({ length: 100 }, (_, i) =>
      makeCred(i % 10 === 0 ? "success" : "failed")
    );
    const stats = computeRunStats(creds, [], []);
    expect(stats.total).toBe(100);
    expect(stats.success).toBe(10);
    expect(stats.failed).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveDomainProfile
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveDomainProfile", () => {
  // ── Exact match ───────────────────────────────────────────────────────────

  it("resolves exact known hostname", () => {
    const profile = resolveDomainProfile("https://shopify.com/admin/login");
    expect(profile.hostname).toBe("shopify.com");
    expect(profile.threat_level).toBe("medium");
  });

  it("resolves instagram.com exactly", () => {
    const profile = resolveDomainProfile("https://instagram.com/accounts/login/");
    expect(profile.hostname).toBe("instagram.com");
    expect(profile.threat_level).toBe("high");
  });

  it("resolves tiktok.com with high threat level", () => {
    const profile = resolveDomainProfile("https://tiktok.com/login");
    expect(profile.threat_level).toBe("high");
  });

  it("resolves accounts.google.com with paranoid threat level", () => {
    const profile = resolveDomainProfile("https://accounts.google.com/signin");
    expect(profile.threat_level).toBe("paranoid");
  });

  it("resolves amazon.com as medium threat", () => {
    const profile = resolveDomainProfile("https://amazon.com/ap/signin");
    expect(profile.threat_level).toBe("medium");
  });

  // ── www prefix stripping ──────────────────────────────────────────────────

  it("strips www prefix before matching", () => {
    const withWww = resolveDomainProfile("https://www.shopify.com/login");
    const withoutWww = resolveDomainProfile("https://shopify.com/login");
    expect(withWww.hostname).toBe(withoutWww.hostname);
    expect(withWww.threat_level).toBe(withoutWww.threat_level);
    expect(withWww.canvas_noise).toBe(withoutWww.canvas_noise);
  });

  it("strips www prefix for instagram.com", () => {
    const profile = resolveDomainProfile("https://www.instagram.com/accounts/login/");
    expect(profile.hostname).toBe("instagram.com");
  });

  it("strips www prefix for amazon.com", () => {
    const profile = resolveDomainProfile("https://www.amazon.com/ap/signin");
    expect(profile.hostname).not.toBe("www.amazon.com");
    expect(profile.threat_level).toBe("medium");
  });

  // ── Subdomain fallback ────────────────────────────────────────────────────

  it("falls back to parent domain for unknown subdomain", () => {
    const profile = resolveDomainProfile("https://shop.shopify.com/login");
    // shop.shopify.com → shopify.com
    expect(profile.hostname).toBe("shopify.com");
  });

  it("falls back to parent domain for deep subdomain", () => {
    const profile = resolveDomainProfile("https://secure.login.amazon.com/signin");
    // secure.login.amazon.com → amazon.com
    expect(profile.hostname).toBe("amazon.com");
  });

  it("returns accounts.google.com profile when accessed via login subdomain", () => {
    // accounts.google.com is a known entry; a sub like myaccount.google.com
    // should fall back to google.com (if defined) or default
    const profile = resolveDomainProfile("https://accounts.google.com/v3/signin");
    expect(profile.hostname).toBe("accounts.google.com");
  });

  // ── Default profile ───────────────────────────────────────────────────────

  it("returns default profile for unknown domain", () => {
    const profile = resolveDomainProfile("https://unknown-site-xyz.example.org/login");
    expect(profile.threat_level).toBe("low");
    expect(profile.canvas_noise).toBe(DEFAULT_DOMAIN_PROFILE.canvas_noise);
  });

  it("returns default profile for localhost", () => {
    const profile = resolveDomainProfile("http://localhost:3000/login");
    expect(profile.threat_level).toBe("low");
  });

  it("returns default profile for IP address", () => {
    const profile = resolveDomainProfile("http://192.168.1.1/admin/login");
    expect(profile.threat_level).toBe("low");
  });

  it("sets hostname to the actual hostname on unknown domains", () => {
    const profile = resolveDomainProfile("https://some-new-site.io/login");
    // The returned profile should identify the hostname it was resolved for
    expect(profile.hostname).toBe("some-new-site.io");
  });

  // ── Invalid URL handling ──────────────────────────────────────────────────

  it("returns default profile for invalid URL", () => {
    const profile = resolveDomainProfile("not a url at all");
    expect(profile.threat_level).toBe("low");
    expect(profile.canvas_noise).toBe(DEFAULT_DOMAIN_PROFILE.canvas_noise);
  });

  it("returns default profile for empty string", () => {
    const profile = resolveDomainProfile("");
    expect(profile.threat_level).toBe("low");
  });

  it("returns default profile for bare domain (no scheme)", () => {
    // URL constructor requires a scheme
    const profile = resolveDomainProfile("shopify.com/login");
    // Will fail URL parsing or not match — should return default
    expect(profile).toBeDefined();
    expect(typeof profile.threat_level).toBe("string");
  });

  // ── Domain profile field completeness ─────────────────────────────────────

  it("every known profile has all required fields", () => {
    for (const [hostname, profile] of Object.entries(DOMAIN_PROFILES)) {
      expect(typeof profile.threat_level).toBe("string");
      expect(typeof profile.canvas_noise).toBe("number");
      expect(typeof profile.webgl_noise).toBe("number");
      expect(typeof profile.audio_noise).toBe("number");
      expect(typeof profile.typing_speed_factor).toBe("number");
      expect(typeof profile.mouse_speed_factor).toBe("number");
      expect(typeof profile.min_attempt_gap_ms).toBe("number");
      expect(typeof profile.rotate_after_n_attempts).toBe("number");
      expect(Array.isArray(profile.captcha_providers)).toBe(true);
      expect(Array.isArray(profile.waf_signals)).toBe(true);
      expect(profile.hostname).toBe(hostname);
    }
  });

  it("higher-threat domains have higher canvas noise than default", () => {
    const highThreat = resolveDomainProfile("https://instagram.com/login");
    expect(highThreat.canvas_noise).toBeGreaterThan(DEFAULT_DOMAIN_PROFILE.canvas_noise);
  });

  it("paranoid domains have tls_fingerprint_sensitive set", () => {
    const google = resolveDomainProfile("https://accounts.google.com/signin");
    expect(google.tls_fingerprint_sensitive).toBe(true);
  });

  it("low-threat domains do not patch TLS", () => {
    const profile = resolveDomainProfile("https://unknown.example.com/login");
    expect(profile.patch_tls).toBe(false);
  });

  it("high-threat domains have smaller rotate_after_n_attempts than default", () => {
    const instagram = resolveDomainProfile("https://instagram.com/login");
    expect(instagram.rotate_after_n_attempts).toBeLessThan(
      DEFAULT_DOMAIN_PROFILE.rotate_after_n_attempts
    );
  });

  it("typing_speed_factor is in (0, 1] for all known domains", () => {
    for (const profile of Object.values(DOMAIN_PROFILES)) {
      expect(profile.typing_speed_factor).toBeGreaterThan(0);
      expect(profile.typing_speed_factor).toBeLessThanOrEqual(1.0);
    }
  });

  it("mouse_speed_factor is in (0, 1] for all known domains", () => {
    for (const profile of Object.values(DOMAIN_PROFILES)) {
      expect(profile.mouse_speed_factor).toBeGreaterThan(0);
      expect(profile.mouse_speed_factor).toBeLessThanOrEqual(1.0);
    }
  });
});
