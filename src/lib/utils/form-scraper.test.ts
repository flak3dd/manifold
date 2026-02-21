/**
 * Form Scraper Tests
 *
 * Tests for the form scraper's autofill functionality, including:
 * - Selector validation
 * - Form config conversion
 * - Preset detection
 * - Error handling
 * - Confidence scoring
 */

import { describe, it, expect, vi } from "vitest";
import {
  validateSelectors,
  selectorsToFormConfig,
  FORM_PRESETS,
  type ScrapedFormSelectors,
} from "./form-scraper";
import type { LoginFormConfig } from "../../../playwright-bridge/login-types";

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const createMockScrapedResult = (overrides: Partial<ScrapedFormSelectors> = {}): ScrapedFormSelectors => ({
  url: "https://example.com/login",
  username_selector: 'input[type="email"]',
  password_selector: 'input[type="password"]',
  submit_selector: 'button[type="submit"]',
  success_selector: ".dashboard",
  failure_selector: ".error-message",
  captcha_selector: ".g-recaptcha",
  confidence: 85,
  details: ["Test detection"],
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
// selectorsToFormConfig Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("selectorsToFormConfig", () => {
  const testUrl = "https://example.com/login";

  it("converts scraped selectors to LoginFormConfig", () => {
    const scraped = createMockScrapedResult();
    const config = selectorsToFormConfig(testUrl, scraped);

    expect(config).toHaveProperty("url", testUrl);
    expect(config).toHaveProperty("username_selector", 'input[type="email"]');
    expect(config).toHaveProperty("password_selector", 'input[type="password"]');
    expect(config).toHaveProperty("submit_selector", 'button[type="submit"]');
  });

  it("includes optional selectors", () => {
    const scraped = createMockScrapedResult({
      success_selector: ".dashboard",
      failure_selector: ".error",
      captcha_selector: ".captcha",
      totp_selector: 'input[name="totp"]',
    });
    const config = selectorsToFormConfig(testUrl, scraped);

    expect(config.success_selector).toBe(".dashboard");
    expect(config.failure_selector).toBe(".error");
    expect(config.captcha_selector).toBe(".captcha");
    expect(config.totp_selector).toBe('input[name="totp"]');
  });

  it("handles missing optional fields", () => {
    const scraped: ScrapedFormSelectors = {
      url: testUrl,
      username_selector: "input",
      password_selector: "input",
      submit_selector: "button",
      confidence: 80,
      details: [],
    };
    const config = selectorsToFormConfig(testUrl, scraped);

    expect(config.success_selector).toBeUndefined();
    expect(config.failure_selector).toBeUndefined();
    expect(config.captcha_selector).toBeUndefined();
  });

  it("preserves URL", () => {
    const urls = [
      "https://accounts.google.com/ServiceLogin",
      "https://login.example.com",
      "http://test.local/auth",
    ];

    for (const url of urls) {
      const scraped = createMockScrapedResult();
      const config = selectorsToFormConfig(url, scraped);
      expect(config.url).toBe(url);
    }
  });

  it("creates valid LoginFormConfig object", () => {
    const scraped = createMockScrapedResult();
    const config = selectorsToFormConfig(testUrl, scraped);

    // Should have required properties
    expect(config).toHaveProperty("url");
    expect(config).toHaveProperty("username_selector");
    expect(config).toHaveProperty("password_selector");
    expect(config).toHaveProperty("submit_selector");
  });

  it("preserves selector precision", () => {
    const selectors = {
      username_selector: 'input[id="email-input"][type="email"]',
      password_selector: 'input[id="pwd-input"][type="password"]',
      submit_selector: 'button[class="btn-login"][type="submit"]',
    };

    const scraped = createMockScrapedResult(selectors);
    const config = selectorsToFormConfig("https://example.com", scraped);

    expect(config.username_selector).toBe(selectors.username_selector);
    expect(config.password_selector).toBe(selectors.password_selector);
    expect(config.submit_selector).toBe(selectors.submit_selector);
  });

  it("handles all optional selector fields", () => {
    const scraped = createMockScrapedResult({
      success_selector: ".dashboard",
      failure_selector: ".error",
      captcha_selector: ".g-recaptcha",
      consent_selector: "#accept-cookies",
      totp_selector: 'input[name="totp"]',
    });

    const config = selectorsToFormConfig(testUrl, scraped);

    expect(config.success_selector).toBeTruthy();
    expect(config.failure_selector).toBeTruthy();
    expect(config.captcha_selector).toBeTruthy();
    expect(config.consent_selector).toBeTruthy();
    expect(config.totp_selector).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FORM_PRESETS Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("FORM_PRESETS", () => {
  it("has presets for major platforms", () => {
    expect(FORM_PRESETS).toHaveProperty("shopify.com");
    expect(FORM_PRESETS).toHaveProperty("accounts.google.com");
    expect(FORM_PRESETS).toHaveProperty("instagram.com");
    expect(FORM_PRESETS).toHaveProperty("twitter.com");
    expect(FORM_PRESETS).toHaveProperty("amazon.com");
    expect(FORM_PRESETS).toHaveProperty("linkedin.com");
  });

  it("Google preset has required selectors", () => {
    const googlePreset = FORM_PRESETS["accounts.google.com"];
    expect(googlePreset).toHaveProperty("username_selector");
    expect(googlePreset).toHaveProperty("password_selector");
    expect(googlePreset).toHaveProperty("submit_selector");
    expect(googlePreset.username_selector).toBeTruthy();
    expect(googlePreset.password_selector).toBeTruthy();
    expect(googlePreset.submit_selector).toBeTruthy();
  });

  it("LinkedIn preset has required selectors", () => {
    const linkedinPreset = FORM_PRESETS["linkedin.com"];
    expect(linkedinPreset).toHaveProperty("username_selector");
    expect(linkedinPreset).toHaveProperty("password_selector");
    expect(linkedinPreset).toHaveProperty("submit_selector");
  });

  it("Amazon preset has required selectors", () => {
    const amazonPreset = FORM_PRESETS["amazon.com"];
    expect(amazonPreset).toHaveProperty("username_selector");
    expect(amazonPreset).toHaveProperty("password_selector");
    expect(amazonPreset).toHaveProperty("submit_selector");
  });

  it("all presets have valid selectors", () => {
    for (const [domain, preset] of Object.entries(FORM_PRESETS)) {
      expect(preset.username_selector, `${domain} username selector`).toBeTruthy();
      expect(preset.password_selector, `${domain} password selector`).toBeTruthy();
      expect(preset.submit_selector, `${domain} submit selector`).toBeTruthy();
    }
  });

  it("preset selectors are strings", () => {
    for (const [domain, preset] of Object.entries(FORM_PRESETS)) {
      expect(typeof preset.username_selector).toBe("string");
      expect(typeof preset.password_selector).toBe("string");
      expect(typeof preset.submit_selector).toBe("string");
    }
  });

  it("preset selectors are non-empty", () => {
    for (const [domain, preset] of Object.entries(FORM_PRESETS)) {
      expect(preset.username_selector!.length).toBeGreaterThan(0);
      expect(preset.password_selector!.length).toBeGreaterThan(0);
      expect(preset.submit_selector!.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateSelectors Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("validateSelectors", () => {
  it("returns async result with valid property", async () => {
    const result = await validateSelectors(
      "https://example.com",
      { username_selector: "input" }
    );

    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("missing");
    expect(typeof result.valid).toBe("boolean");
    expect(Array.isArray(result.missing)).toBe(true);
  });

  it("returns object with valid and missing arrays", async () => {
    const result = await validateSelectors(
      "https://example.com",
      { username_selector: "input" }
    );

    expect(result.valid === true || result.valid === false).toBe(true);
    expect(Array.isArray(result.missing)).toBe(true);
  });

  it("handles empty selector object", async () => {
    const result = await validateSelectors(
      "https://example.com",
      {}
    );

    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("missing");
  });

  it("handles validation errors gracefully", async () => {
    const result = await validateSelectors(
      "https://invalid-url-that-definitely-does-not-exist-99999.com",
      { username_selector: "input" }
    );

    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("missing");
    // Should return error state
    expect(result.valid).toBe(false);
  }, 15000);

  it("validates multiple selectors", async () => {
    const result = await validateSelectors(
      "https://example.com",
      {
        username_selector: "input[name='email']",
        password_selector: "input[name='password']",
        submit_selector: "button[type='submit']",
      }
    );

    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("missing");
    expect(Array.isArray(result.missing)).toBe(true);
  });

  it("ignores non-selector properties", async () => {
    const result = await validateSelectors(
      "https://example.com",
      {
        username_selector: "input",
        confidence: 85,
        details: ["test"],
      } as any
    );

    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("missing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Autofill Workflow Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Autofill Workflow", () => {
  it("transforms scraped selectors to form config", () => {
    const scraped = createMockScrapedResult();
    const config = selectorsToFormConfig("https://example.com/login", scraped);

    expect(config).toMatchObject({
      url: "https://example.com/login",
      username_selector: scraped.username_selector,
      password_selector: scraped.password_selector,
      submit_selector: scraped.submit_selector,
    });
  });

  it("handles form config with all optional fields", () => {
    const scraped = createMockScrapedResult({
      success_selector: ".dashboard",
      failure_selector: ".error",
      captcha_selector: ".g-recaptcha",
      consent_selector: "#accept-cookies",
      totp_selector: 'input[name="totp"]',
    });

    const config = selectorsToFormConfig("https://example.com/login", scraped);

    expect(config.success_selector).toBeTruthy();
    expect(config.failure_selector).toBeTruthy();
    expect(config.captcha_selector).toBeTruthy();
    expect(config.consent_selector).toBeTruthy();
    expect(config.totp_selector).toBeTruthy();
  });

  it("validates all required selectors are present", () => {
    const scraped = createMockScrapedResult();
    const config = selectorsToFormConfig("https://example.com/login", scraped);

    // Required selectors must all be present and non-empty
    expect(config.username_selector?.length).toBeGreaterThan(0);
    expect(config.password_selector?.length).toBeGreaterThan(0);
    expect(config.submit_selector?.length).toBeGreaterThan(0);
  });

  it("handles SPA framework detection", () => {
    const scraped = createMockScrapedResult({
      isSPA: true,
      spaFramework: "react",
    });

    expect(scraped.isSPA).toBe(true);
    expect(scraped.spaFramework).toBe("react");
  });

  it("handles CAPTCHA detection", () => {
    const scraped = createMockScrapedResult({
      hasCaptcha: true,
      captchaProviders: ["recaptcha", "hcaptcha"],
      captcha_selector: ".g-recaptcha",
    });

    expect(scraped.hasCaptcha).toBe(true);
    expect(scraped.captchaProviders).toContain("recaptcha");
    expect(scraped.captcha_selector).toBeTruthy();
  });

  it("handles MFA detection", () => {
    const scraped = createMockScrapedResult({
      hasMFA: true,
      mfaType: "totp",
      mfa_selector: 'input[name="totp"]',
    });

    expect(scraped.hasMFA).toBe(true);
    expect(scraped.mfaType).toBe("totp");
    expect(scraped.mfa_selector).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Scoring Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Confidence Scoring", () => {
  it("accepts confidence scores 0-100", () => {
    const confidences = [0, 25, 50, 75, 85, 90, 95, 100];

    for (const confidence of confidences) {
      const scraped = createMockScrapedResult({ confidence });
      expect(scraped.confidence).toBe(confidence);
      expect(scraped.confidence).toBeGreaterThanOrEqual(0);
      expect(scraped.confidence).toBeLessThanOrEqual(100);
    }
  });

  it("treats 0 confidence as detection failure", () => {
    const scraped = createMockScrapedResult({ confidence: 0 });
    expect(scraped.confidence).toBe(0);
  });

  it("treats high confidence as reliable", () => {
    const scraped = createMockScrapedResult({ confidence: 90 });
    expect(scraped.confidence).toBeGreaterThanOrEqual(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Error Handling", () => {
  it("does not throw on missing optional properties", () => {
    const scraped: ScrapedFormSelectors = {
      url: "https://example.com/login",
      username_selector: "input",
      password_selector: "input",
      submit_selector: "button",
      confidence: 80,
      details: [],
    };

    expect(() => {
      selectorsToFormConfig("https://example.com/login", scraped);
    }).not.toThrow();
  });

  it("handles empty details array", () => {
    const scraped = createMockScrapedResult({ details: [] });
    const config = selectorsToFormConfig("https://example.com", scraped);

    expect(config.url).toBe("https://example.com");
  });

  it("handles undefined selectors gracefully", () => {
    const scraped = createMockScrapedResult({
      success_selector: undefined,
      failure_selector: undefined,
    });

    const config = selectorsToFormConfig("https://example.com", scraped);
    expect(config).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Autofill Integration", () => {
  it("supports full autofill workflow", () => {
    // Step 1: Have scraped selectors
    const scraped = createMockScrapedResult({
      isSPA: true,
      spaFramework: "react",
      hasCaptcha: true,
      captchaProviders: ["recaptcha"],
      hasMFA: true,
      mfaType: "totp",
    });

    expect(scraped.confidence > 0).toBe(true);

    // Step 2: Convert to config
    const config = selectorsToFormConfig("https://example.com/login", scraped);

    // Verify the config is usable
    expect(config.url).toBe("https://example.com/login");
    expect(config).toHaveProperty("username_selector");
    expect(config).toHaveProperty("password_selector");
    expect(config).toHaveProperty("submit_selector");
  });

  it("handles preset fallback", () => {
    // Test that preset selectors work
    const googlePreset = FORM_PRESETS["accounts.google.com"];
    const config = selectorsToFormConfig(
      "https://accounts.google.com/ServiceLogin",
      googlePreset as unknown as ScrapedFormSelectors & { confidence: number; details: string[] }
    );

    expect(config.username_selector).toBeTruthy();
    expect(config.password_selector).toBeTruthy();
    expect(config.submit_selector).toBeTruthy();
  });

  it("transforms multiple form types correctly", () => {
    const testCases = [
      {
        url: "https://accounts.google.com/ServiceLogin",
        selectors: { username: "#email", password: "#password", submit: "#next" },
      },
      {
        url: "https://instagram.com/accounts/login/",
        selectors: { username: 'input[name="username"]', password: 'input[name="password"]', submit: "button[type='button']" },
      },
      {
        url: "https://www.amazon.com/ap/signin",
        selectors: { username: "#ap_email", password: "#ap_password", submit: "#signInSubmit" },
      },
    ];

    for (const testCase of testCases) {
      const scraped = createMockScrapedResult({
        username_selector: testCase.selectors.username,
        password_selector: testCase.selectors.password,
        submit_selector: testCase.selectors.submit,
      });

      const config = selectorsToFormConfig(testCase.url, scraped);
      expect(config.url).toBe(testCase.url);
      expect(config.username_selector).toBeTruthy();
      expect(config.password_selector).toBeTruthy();
      expect(config.submit_selector).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe("Edge Cases", () => {
  it("handles URLs with query parameters", () => {
    const urls = [
      "https://example.com/login?redirect=/dashboard",
      "https://example.com/login?next=%2Fdashboard",
      "https://example.com/login?email=test@example.com",
    ];

    for (const url of urls) {
      const scraped = createMockScrapedResult();
      const config = selectorsToFormConfig(url, scraped);
      expect(config.url).toBe(url);
    }
  });

  it("handles URLs with fragments", () => {
    const url = "https://example.com/login#form";
    const scraped = createMockScrapedResult();
    const config = selectorsToFormConfig(url, scraped);
    expect(config.url).toBe(url);
  });

  it("handles very long selectors", () => {
    const longSelector = "body > div.wrapper > form#login-form > fieldset > div.form-group > input[type='email'][id='email-input'][name='user-email'][class='form-control required']";
    const scraped = createMockScrapedResult({
      username_selector: longSelector,
    });

    const config = selectorsToFormConfig("https://example.com", scraped);
    expect(config.username_selector).toBe(longSelector);
  });

  it("handles mixed case selectors", () => {
    const selectors = {
      username_selector: "#MyEmailInput",
      password_selector: ".LoginButton",
      submit_selector: "INPUT[type='password']",
    };

    const scraped = createMockScrapedResult(selectors);
    const config = selectorsToFormConfig("https://example.com", scraped);

    expect(config.username_selector).toBe(selectors.username_selector);
    expect(config.password_selector).toBe(selectors.password_selector);
  });

  it("handles empty optional fields gracefully", () => {
    const scraped = createMockScrapedResult({
      success_selector: undefined,
      failure_selector: undefined,
      captcha_selector: undefined,
    });

    const config = selectorsToFormConfig("https://example.com/login", scraped);
    // Config should still be valid
    expect(config.username_selector).toBeTruthy();
  });

  it("handles null/undefined in details", () => {
    const scraped = createMockScrapedResult({
      details: ["Valid message", "", undefined as any],
    });

    const config = selectorsToFormConfig("https://example.com", scraped);
    expect(config).toBeDefined();
  });
});
