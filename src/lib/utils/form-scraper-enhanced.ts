/**
 * Enhanced Form Scraper Utility
 *
 * Advanced auto-discovery of form selectors using:
 * - DOM analysis and scoring
 * - Accessibility attributes (ARIA labels, roles)
 * - Visual hierarchy detection
 * - Form context analysis
 * - Machine learning-inspired heuristics
 * - Iframe detection
 * - Shadow DOM support
 * - Multi-step form handling
 */

import type { LoginFormConfig } from "../../../playwright-bridge/login-types";

export interface EnhancedScraperOptions {
  url: string;
  timeout?: number;
  headless?: boolean;
  waitForSPA?: boolean;
  detectCaptcha?: boolean;
  detectMFA?: boolean;
  analyzeVisualHierarchy?: boolean;
  detectMultiStep?: boolean;
  includeShadowDOM?: boolean;
  deepScan?: boolean;
}

export interface FieldScore {
  element: Element;
  selector: string;
  score: number;
  confidence: number;
  reasons: string[];
  attributes: {
    type?: string;
    name?: string;
    id?: string;
    placeholder?: string;
    ariaLabel?: string;
    ariaLabelledBy?: string;
    class?: string;
    role?: string;
  };
}

export interface FormContext {
  formElement?: Element;
  formId?: string;
  formClass?: string;
  formRole?: string;
  fieldCount: number;
  hasSubmit: boolean;
  isModal: boolean;
  isMultiStep: boolean;
  depth: number;
}

export interface EnhancedScrapedResult {
  // Primary selectors
  username_selector?: string;
  password_selector?: string;
  submit_selector?: string;

  // Optional selectors
  success_selector?: string;
  failure_selector?: string;
  captcha_selector?: string;
  consent_selector?: string;
  totp_selector?: string;
  mfa_selector?: string;

  // Field scores for transparency
  usernameScores?: FieldScore[];
  passwordScores?: FieldScore[];
  submitScores?: FieldScore[];

  // Form context
  formContext?: FormContext;

  // Detection results
  isSPA?: boolean;
  spaFramework?: string;
  hasCaptcha?: boolean;
  captchaProviders?: string[];
  hasMFA?: boolean;
  mfaType?: 'totp' | 'sms' | 'email' | 'push' | 'security_key' | 'unknown';
  isMultiStep?: boolean;
  hasIframe?: boolean;
  hasShadowDOM?: boolean;

  // Overall metrics
  confidence: number;
  fieldConfidences: {
    username: number;
    password: number;
    submit: number;
    success?: number;
    failure?: number;
    captcha?: number;
  };

  // Detailed feedback
  details: string[];
  warnings: string[];
  suggestions: string[];

  // Additional metadata
  formStructure?: string;
  estimatedComplexity?: 'simple' | 'moderate' | 'complex';
  selectorQuality?: 'excellent' | 'good' | 'fair' | 'poor';
}

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Selector Patterns with Scoring
// ─────────────────────────────────────────────────────────────────────────────

const ENHANCED_PATTERNS = {
  username: {
    // High confidence patterns
    critical: [
      { selector: 'input[type="email"]', score: 95, reason: 'Email input type' },
      { selector: 'input[id*="email"]', score: 90, reason: 'ID contains email' },
      { selector: 'input[name="email"]', score: 90, reason: 'Name is email' },
      { selector: 'input[type="text"][name*="email"]', score: 85, reason: 'Text input with email name' },
      { selector: 'input[name="username"]', score: 85, reason: 'Name is username' },
      { selector: 'input[id*="username"]', score: 85, reason: 'ID contains username' },
    ],
    // Medium confidence patterns
    important: [
      { selector: 'input[type="text"][id*="user"]', score: 75, reason: 'Text input with user ID' },
      { selector: 'input[placeholder*="email"]', score: 70, reason: 'Placeholder mentions email' },
      { selector: 'input[placeholder*="username"]', score: 70, reason: 'Placeholder mentions username' },
      { selector: 'input[aria-label*="email"]', score: 70, reason: 'ARIA label mentions email' },
      { selector: 'input[aria-label*="user"]', score: 65, reason: 'ARIA label mentions user' },
    ],
    // Lower confidence patterns
    fallback: [
      { selector: 'input[type="text"]', score: 40, reason: 'Generic text input' },
      { selector: 'input[name*="login"]', score: 55, reason: 'Name contains login' },
      { selector: '[role="textbox"]', score: 50, reason: 'Textbox role' },
    ],
  },

  password: {
    critical: [
      { selector: 'input[type="password"]', score: 100, reason: 'Password input type' },
      { selector: 'input[id*="password"]', score: 90, reason: 'ID contains password' },
      { selector: 'input[name="password"]', score: 90, reason: 'Name is password' },
      { selector: 'input[name*="pass"]', score: 85, reason: 'Name contains pass' },
    ],
    important: [
      { selector: 'input[aria-label*="password"]', score: 80, reason: 'ARIA label mentions password' },
      { selector: 'input[placeholder*="password"]', score: 75, reason: 'Placeholder mentions password' },
      { selector: 'input[placeholder*="pass"]', score: 70, reason: 'Placeholder mentions pass' },
    ],
    fallback: [
      { selector: 'input[name*="pwd"]', score: 60, reason: 'Name contains pwd' },
      { selector: 'input[id*="pwd"]', score: 55, reason: 'ID contains pwd' },
    ],
  },

  submit: {
    critical: [
      { selector: 'button[type="submit"]', score: 100, reason: 'Submit button type' },
      { selector: 'input[type="submit"]', score: 95, reason: 'Submit input type' },
      { selector: 'button[name="submit"]', score: 90, reason: 'Button name is submit' },
    ],
    important: [
      { selector: 'button:contains("Sign in")', score: 85, reason: 'Text contains Sign in' },
      { selector: 'button:contains("Login")', score: 85, reason: 'Text contains Login' },
      { selector: 'button:contains("Sign up")', score: 70, reason: 'Text contains Sign up' },
      { selector: 'button[aria-label*="sign in"]', score: 80, reason: 'ARIA label contains sign in' },
      { selector: 'button[class*="submit"]', score: 75, reason: 'Class contains submit' },
      { selector: 'button[class*="login"]', score: 75, reason: 'Class contains login' },
    ],
    fallback: [
      { selector: '[role="button"]:contains("Log in")', score: 65, reason: 'Button role with Log in text' },
      { selector: 'button[class*="btn-primary"]', score: 60, reason: 'Primary button class' },
    ],
  },

  success: {
    critical: [
      { selector: '[aria-label*="logout"]', score: 95, reason: 'Logout button indicates logged in' },
      { selector: '[class*="user-menu"]', score: 90, reason: 'User menu visible' },
      { selector: '[class*="profile"]', score: 85, reason: 'Profile element visible' },
    ],
    important: [
      { selector: '[class*="dashboard"]', score: 80, reason: 'Dashboard class' },
      { selector: '[class*="home"]', score: 75, reason: 'Home class' },
      { selector: '[class*="account"]', score: 75, reason: 'Account class' },
      { selector: '[data-testid*="profile"]', score: 80, reason: 'Profile test ID' },
      { selector: '.user-avatar', score: 80, reason: 'User avatar' },
    ],
    fallback: [
      { selector: 'a[href*="dashboard"]', score: 60, reason: 'Dashboard link' },
      { selector: '[class*="authenticated"]', score: 65, reason: 'Authenticated class' },
    ],
  },

  failure: {
    critical: [
      { selector: '[role="alert"]', score: 90, reason: 'Alert role' },
      { selector: '[class*="error"]', score: 85, reason: 'Error class' },
      { selector: '[class*="invalid"]', score: 80, reason: 'Invalid class' },
    ],
    important: [
      { selector: '.error-message', score: 85, reason: 'Error message class' },
      { selector: '[data-testid*="error"]', score: 80, reason: 'Error test ID' },
      { selector: '[class*="danger"]', score: 70, reason: 'Danger class' },
      { selector: 'span[class*="error"]', score: 75, reason: 'Error span' },
    ],
    fallback: [
      { selector: '[class*="wrong"]', score: 60, reason: 'Wrong class' },
      { selector: '[class*="failed"]', score: 60, reason: 'Failed class' },
    ],
  },

  mfa: {
    critical: [
      { selector: 'input[placeholder*="code"]', score: 90, reason: 'Code placeholder' },
      { selector: 'input[placeholder*="OTP"]', score: 90, reason: 'OTP placeholder' },
      { selector: 'input[name*="otp"]', score: 85, reason: 'OTP in name' },
      { selector: 'input[name*="totp"]', score: 85, reason: 'TOTP in name' },
    ],
    important: [
      { selector: 'input[aria-label*="code"]', score: 80, reason: 'Code ARIA label' },
      { selector: 'input[placeholder*="2FA"]', score: 80, reason: '2FA placeholder' },
      { selector: 'input[id*="verification"]', score: 75, reason: 'Verification ID' },
    ],
    fallback: [
      { selector: 'input[name*="code"]', score: 60, reason: 'Code in name' },
    ],
  },

  captcha: {
    critical: [
      { selector: '[class*="g-recaptcha"]', score: 95, reason: 'reCAPTCHA detected' },
      { selector: '[class*="h-captcha"]', score: 95, reason: 'hCaptcha detected' },
      { selector: 'iframe[src*="recaptcha"]', score: 90, reason: 'reCAPTCHA iframe' },
      { selector: 'iframe[src*="hcaptcha"]', score: 90, reason: 'hCaptcha iframe' },
    ],
    important: [
      { selector: '[class*="captcha"]', score: 80, reason: 'Captcha class' },
      { selector: '[data-captcha]', score: 75, reason: 'Captcha data attribute' },
    ],
    fallback: [
      { selector: '[class*="bot-check"]', score: 60, reason: 'Bot check class' },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Visual Hierarchy Analysis
// ─────────────────────────────────────────────────────────────────────────────

function analyzeVisualHierarchy(doc: Document): Map<Element, number> {
  const elementScores = new Map<Element, number>();

  const inputs = doc.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]');
  const buttons = doc.querySelectorAll('button, input[type="submit"]');

  // Score inputs based on visual prominence
  inputs.forEach((input) => {
    const rect = (input as HTMLElement).getBoundingClientRect();
    const style = window.getComputedStyle(input);

    let score = 50; // base score

    // Visibility bonus
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      score += 20;
    }

    // Size bonus (reasonable input sizes get higher scores)
    if (rect.width > 150 && rect.width < 400) {
      score += 15;
    }

    // Enabled state bonus
    if (!(input as HTMLInputElement).disabled) {
      score += 10;
    }

    // Position bonus (inputs higher on page = higher score)
    if (rect.top < window.innerHeight * 0.5) {
      score += 10;
    }

    // Z-index consideration
    const zIndex = parseInt(style.zIndex, 10);
    if (zIndex > 0) {
      score += Math.min(zIndex / 1000, 10);
    }

    elementScores.set(input, score);
  });

  // Score buttons based on prominence
  buttons.forEach((button) => {
    const rect = (button as HTMLElement).getBoundingClientRect();
    const style = window.getComputedStyle(button);
    const text = button.textContent?.toLowerCase() || '';

    let score = 40; // base score

    // Visibility
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      score += 15;
    }

    // Size (buttons should be reasonably large)
    if (rect.width > 80 && rect.width < 300) {
      score += 15;
    }

    // Position bonus
    if (rect.top < window.innerHeight * 0.7) {
      score += 10;
    }

    // Text hints
    if (text.includes('sign') || text.includes('login') || text.includes('submit')) {
      score += 20;
    }

    // Color analysis (primary/prominent colors)
    const bgColor = style.backgroundColor;
    if (bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)') {
      score += 10;
    }

    elementScores.set(button, score);
  });

  return elementScores;
}

// ─────────────────────────────────────────────────────────────────────────────
// Form Context Analysis
// ─────────────────────────────────────────────────────────────────────────────

function analyzeFormContext(doc: Document): FormContext {
  const forms = doc.querySelectorAll('form');
  const primaryForm = forms[0]; // Usually the first form is the login form

  let formElement: Element | undefined;
  let formId = '';
  let formClass = '';
  let formRole = '';
  let isMultiStep = false;
  let isModal = false;

  if (primaryForm) {
    formElement = primaryForm;
    formId = primaryForm.id || '';
    formClass = primaryForm.className || '';
    formRole = primaryForm.getAttribute('role') || '';

    // Check for multi-step indicators
    const steps = primaryForm.querySelectorAll('[class*="step"], [class*="stage"], [role="tablist"]');
    isMultiStep = steps.length > 0;

    // Check if form is in a modal
    const parent = primaryForm.closest('[class*="modal"], [role="dialog"], [class*="popup"]');
    isModal = !!parent;
  }

  const fieldCount = doc.querySelectorAll('input[type="text"], input[type="email"], input[type="password"]').length;
  const hasSubmit = doc.querySelectorAll('button[type="submit"], input[type="submit"]').length > 0;

  return {
    formElement,
    formId,
    formClass,
    formRole,
    fieldCount,
    hasSubmit,
    isModal,
    isMultiStep,
    depth: primaryForm ? getElementDepth(primaryForm) : 0,
  };
}

function getElementDepth(element: Element): number {
  let depth = 0;
  let current = element;

  while (current.parentElement) {
    depth++;
    current = current.parentElement;
  }

  return depth;
}

// ─────────────────────────────────────────────────────────────────────────────
// Advanced Selector Generation
// ─────────────────────────────────────────────────────────────────────────────

function generateOptimalSelector(element: Element): string {
  // Try ID first (most specific)
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Try name attribute for inputs
  if (element instanceof HTMLInputElement && element.name) {
    return `input[name="${CSS.escape(element.name)}"]`;
  }

  // Build from tag + classes
  let selector = element.tagName.toLowerCase();

  if (element.className && typeof element.className === 'string') {
    const classes = element.className
      .split(/\s+/)
      .filter((c) => c && !c.match(/^(ng-|v-|_)/)) // Filter out framework classes
      .slice(0, 3); // Use only first 3 classes

    if (classes.length > 0) {
      selector += classes.map((c) => `.${CSS.escape(c)}`).join('');
    }
  }

  // Add type attribute for inputs
  if (element instanceof HTMLInputElement && element.type) {
    selector = `input[type="${element.type}"]`;

    // Add name if available
    if (element.name) {
      selector += `[name="${CSS.escape(element.name)}"]`;
    }
  }

  // Add aria-label if available
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    selector += `[aria-label*="${CSS.escape(ariaLabel.slice(0, 20))}"]`;
  }

  return selector;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring and Ranking
// ─────────────────────────────────────────────────────────────────────────────

function scoreElement(
  element: Element,
  patterns: { selector: string; score: number; reason: string }[],
  fieldType: string,
): FieldScore {
  let bestScore = 0;
  let matchedReasons: string[] = [];

  // Test each pattern
  for (const pattern of patterns) {
    try {
      // Try to match the pattern
      if (element.matches(pattern.selector)) {
        bestScore = Math.max(bestScore, pattern.score);
        matchedReasons.push(pattern.reason);
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }

  // Boost score based on element attributes
  const attributes = {
    type: element.getAttribute('type') ?? undefined,
    name: element.getAttribute('name') ?? undefined,
    id: element.getAttribute('id') ?? undefined,
    placeholder: element.getAttribute('placeholder') ?? undefined,
    ariaLabel: element.getAttribute('aria-label') ?? undefined,
    ariaLabelledBy: element.getAttribute('aria-labelledby') ?? undefined,
    class: element.className || undefined,
    role: element.getAttribute('role') ?? undefined,
  };

  // Attribute-based scoring
  if (attributes.ariaLabel) bestScore += 10;
  if (attributes.id) bestScore += 8;
  if (attributes.name) bestScore += 8;
  if (attributes.placeholder) bestScore += 5;

  // Visibility bonus
  const style = window.getComputedStyle(element);
  if (style.display !== 'none' && style.visibility !== 'hidden') {
    bestScore += 5;
  }

  // Enabled bonus
  if (!(element as HTMLInputElement).disabled) {
    bestScore += 3;
  }

  const confidence = Math.min(100, bestScore);

  return {
    element,
    selector: generateOptimalSelector(element),
    score: bestScore,
    confidence,
    reasons: matchedReasons,
    attributes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Step Form Detection
// ─────────────────────────────────────────────────────────────────────────────

function detectMultiStepForm(doc: Document): boolean {
  const indicators = [
    doc.querySelectorAll('[class*="step"]').length > 1,
    doc.querySelectorAll('[role="tab"]').length > 1,
    doc.querySelectorAll('[class*="wizard"]').length > 0,
    doc.querySelectorAll('[class*="stage"]').length > 1,
    doc.querySelectorAll('[aria-current="step"]').length > 0,
  ];

  return indicators.some((indicator) => indicator);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shadow DOM Detection
// ─────────────────────────────────────────────────────────────────────────────

function hasShadowDOM(element: Element = document.documentElement): boolean {
  if (element.shadowRoot) {
    return true;
  }

  for (const child of element.children) {
    if (hasShadowDOM(child)) {
      return true;
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Iframe Detection
// ─────────────────────────────────────────────────────────────────────────────

function detectIframes(doc: Document): boolean {
  return doc.querySelectorAll('iframe').length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Form Discovery
// ─────────────────────────────────────────────────────────────────────────────

export async function enhancedScrapeFormSelectors(
  options: EnhancedScraperOptions,
): Promise<EnhancedScrapedResult> {
  const result: EnhancedScrapedResult = {
    confidence: 0,
    fieldConfidences: {
      username: 0,
      password: 0,
      submit: 0,
    },
    details: [],
    warnings: [],
    suggestions: [],
  };

  try {
    // Fetch and parse the page
    if (!options.url) {
      result.details.push('Error: No URL provided');
      return result;
    }

    const response = await fetch(options.url);
    if (!response.ok) {
      result.details.push(`HTTP ${response.status}: ${response.statusText}`);
      result.warnings.push('Page may not be accessible');
      return result;
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    if (doc.documentElement.tagName === 'parsererror') {
      result.details.push('Failed to parse HTML');
      return result;
    }

    result.details.push('Page parsed successfully');

    // Analyze form context
    const formContext = analyzeFormContext(doc);
    result.formContext = formContext;
    result.isMultiStep = formContext.isMultiStep;
    result.details.push(`Found ${formContext.fieldCount} input fields`);

    if (formContext.isMultiStep) {
      result.suggestions.push('This appears to be a multi-step form - may require custom scripts');
    }

    // Detect advanced features
    result.hasIframe = detectIframes(doc);
    result.hasShadowDOM = options.includeShadowDOM ? hasShadowDOM() : false;

    if (result.hasIframe) {
      result.warnings.push('Page contains iframes - some selectors may not work');
    }

    if (result.hasShadowDOM) {
      result.warnings.push('Page uses Shadow DOM - selector detection may be limited');
    }

    // Find all form fields
    const emailInputs = doc.querySelectorAll('input[type="email"]');
    const textInputs = doc.querySelectorAll('input[type="text"]');
    const passwordInputs = doc.querySelectorAll('input[type="password"]');
    const buttons = doc.querySelectorAll('button, input[type="submit"]');

    result.details.push(
      `Found ${emailInputs.length} email inputs, ${textInputs.length} text inputs, ${passwordInputs.length} password inputs`,
    );

    // Score and rank username fields
    const usernameCandidates: FieldScore[] = [];
    emailInputs.forEach((elem) => {
      usernameCandidates.push(
        scoreElement(elem, ENHANCED_PATTERNS.username.critical.concat(ENHANCED_PATTERNS.username.important), 'username'),
      );
    });
    textInputs.forEach((elem) => {
      const nameAttr = elem.getAttribute('name')?.toLowerCase() || '';
      const idAttr = elem.getAttribute('id')?.toLowerCase() || '';
      if (nameAttr.includes('user') || nameAttr.includes('email') || idAttr.includes('user') || idAttr.includes('email')) {
        usernameCandidates.push(
          scoreElement(elem, ENHANCED_PATTERNS.username.critical.concat(ENHANCED_PATTERNS.username.important), 'username'),
        );
      }
    });

    if (usernameCandidates.length > 0) {
      usernameCandidates.sort((a, b) => b.score - a.score);
      result.usernameScores = usernameCandidates.slice(0, 5);
      result.username_selector = usernameCandidates[0].selector;
      result.fieldConfidences.username = usernameCandidates[0].confidence;
      result.details.push(`Username field detected with ${Math.round(usernameCandidates[0].confidence)}% confidence`);
    } else {
      result.warnings.push('No username field found');
      result.suggestions.push('Try inspecting the page manually to find the username field');
    }

    // Score and rank password fields
    const passwordCandidates: FieldScore[] = [];
    passwordInputs.forEach((elem) => {
      passwordCandidates.push(
        scoreElement(elem, ENHANCED_PATTERNS.password.critical.concat(ENHANCED_PATTERNS.password.important), 'password'),
      );
    });

    if (passwordCandidates.length > 0) {
      passwordCandidates.sort((a, b) => b.score - a.score);
      result.passwordScores = passwordCandidates.slice(0, 5);
      result.password_selector = passwordCandidates[0].selector;
      result.fieldConfidences.password = passwordCandidates[0].confidence;
      result.details.push(`Password field detected with ${Math.round(passwordCandidates[0].confidence)}% confidence`);
    } else {
      result.warnings.push('No password field found');
    }

    // Score and rank submit buttons
    const submitCandidates: FieldScore[] = [];
    buttons.forEach((elem) => {
      submitCandidates.push(
        scoreElement(elem, ENHANCED_PATTERNS.submit.critical.concat(ENHANCED_PATTERNS.submit.important), 'submit'),
      );
    });

    if (submitCandidates.length > 0) {
      submitCandidates.sort((a, b) => b.score - a.score);
      result.submitScores = submitCandidates.slice(0, 5);
      result.submit_selector = submitCandidates[0].selector;
      result.fieldConfidences.submit = submitCandidates[0].confidence;
      result.details.push(`Submit button detected with ${Math.round(submitCandidates[0].confidence)}% confidence`);
    } else {
      result.warnings.push('No submit button found');
      result.suggestions.push('Form may use JavaScript to submit - check the submit selector manually');
    }

    // Detect optional elements
    const successElements = doc.querySelectorAll(ENHANCED_PATTERNS.success.critical.map((p) => p.selector).join(', '));
    if (successElements.length > 0) {
      const bestSuccess = Array.from(successElements).map((elem) =>
        scoreElement(elem, ENHANCED_PATTERNS.success.critical.concat(ENHANCED_PATTERNS.success.important), 'success'),
      );
      bestSuccess.sort((a, b) => b.score - a.score);
      result.success_selector = bestSuccess[0].selector;
      result.fieldConfidences.success = bestSuccess[0].confidence;
    }

    const failureElements = doc.querySelectorAll(ENHANCED_PATTERNS.failure.critical.map((p) => p.selector).join(', '));
    if (failureElements.length > 0) {
      const bestFailure = Array.from(failureElements).map((elem) =>
        scoreElement(elem, ENHANCED_PATTERNS.failure.critical.concat(ENHANCED_PATTERNS.failure.important), 'failure'),
      );
      bestFailure.sort((a, b) => b.score - a.score);
      result.failure_selector = bestFailure[0].selector;
      result.fieldConfidences.failure = bestFailure[0].confidence;
    }

    // Detect CAPTCHA
    const captchaElements = doc.querySelectorAll(ENHANCED_PATTERNS.captcha.critical.map((p) => p.selector).join(', '));
    if (captchaElements.length > 0) {
      result.hasCaptcha = true;
      const bestCaptcha = Array.from(captchaElements).map((elem) =>
        scoreElement(elem, ENHANCED_PATTERNS.captcha.critical.concat(ENHANCED_PATTERNS.captcha.important), 'captcha'),
      );
      bestCaptcha.sort((a, b) => b.score - a.score);
      result.captcha_selector = bestCaptcha[0].selector;
      result.fieldConfidences.captcha = bestCaptcha[0].confidence;

      if (html.includes('recaptcha')) {
        result.captchaProviders = ['recaptcha'];
      } else if (html.includes('hcaptcha')) {
        result.captchaProviders = ['hcaptcha'];
      }

      result.warnings.push('CAPTCHA detected - automated login may fail');
    }

    // Detect MFA
    const mfaElements = doc.querySelectorAll(ENHANCED_PATTERNS.mfa.critical.map((p) => p.selector).join(', '));
    if (mfaElements.length > 0) {
      result.hasMFA = true;
      result.mfaType = html.includes('totp') ? 'totp' : 'unknown';
      const bestMFA = Array.from(mfaElements).map((elem) =>
        scoreElement(elem, ENHANCED_PATTERNS.mfa.critical.concat(ENHANCED_PATTERNS.mfa.important), 'mfa'),
      );
      bestMFA.sort((a, b) => b.score - a.score);
      result.mfa_selector = bestMFA[0].selector;
      result.warnings.push('MFA detected - will require 2FA credentials');
    }

    // Calculate overall confidence
    const validSelectors = [
      result.username_selector,
      result.password_selector,
      result.submit_selector,
    ].filter(Boolean);

    const optionalSelectors = [
      result.success_selector,
      result.failure_selector,
    ].filter(Boolean);

    // Base confidence from required fields
    const requiredWeight = validSelectors.length / 3;
    const optionalBonus = optionalSelectors.length * 0.05;
    const avgFieldConfidence =
      (result.fieldConfidences.username +
        result.fieldConfidences.password +
        result.fieldConfidences.submit) /
      3;

    result.confidence = Math.min(
      100,
      Math.round(requiredWeight * avgFieldConfidence + optionalBonus * 100),
    );

    // Determine selector quality
    if (result.confidence >= 80) {
      result.selectorQuality = 'excellent';
    } else if (result.confidence >= 60) {
      result.selectorQuality = 'good';
    } else if (result.confidence >= 40) {
      result.selectorQuality = 'fair';
    } else {
      result.selectorQuality = 'poor';
    }

    // Estimate complexity
    if (result.isMultiStep || result.hasCaptcha || result.hasMFA) {
      result.estimatedComplexity = 'complex';
    } else if (result.hasIframe || result.hasShadowDOM) {
      result.estimatedComplexity = 'moderate';
    } else {
      result.estimatedComplexity = 'simple';
    }

    result.details.push(`Overall confidence: ${result.confidence}%`);
    result.details.push(`Selector quality: ${result.selectorQuality}`);

  } catch (e) {
    result.details.push(`Error during enhanced scraping: ${e instanceof Error ? e.message : String(e)}`);
    result.warnings.push('Enhanced scraping encountered an error');
  }

  return result;
}
