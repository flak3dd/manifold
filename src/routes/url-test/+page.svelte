<script lang="ts">
    import { goto } from "$app/navigation";
    import { urlTestStore } from "$lib/stores/urltest.svelte";
    import { appStore } from "$lib/stores/app.svelte";
    import { profileStore } from "$lib/stores/profiles.svelte";
    import { proxyStore } from "$lib/stores/proxy.svelte";
    import { scrapeHandoff } from "$lib/stores/scrape-handoff.svelte";
    import type {
        UrlTestResult,
        UrlTestDetectedForm,
        ProfileTarget,
    } from "$lib/types";

    let targetUrl = $state("");
    let username = $state("");
    let password = $state("");
    let showPassword = $state(false);
    let showLoginFields = $state(false);

    let activeTest = $derived(urlTestStore.activeTest);
    let isRunning = $derived(urlTestStore.isRunning);
    let tests = $derived(urlTestStore.tests);
    let history = $derived(urlTestStore.history);
    let wsConnected = $derived(appStore.wsConnected);

    let screenshotTab = $state<"desktop" | "tablet" | "mobile">("desktop");
    let showScreenshotLightbox = $state<string | null>(null);
    let activeTab = $state<
        "results" | "forms" | "login" | "screenshots" | "history" | "create"
    >("results");

    // ── Profile Creation State ─────────────────────────────────────────────
    let profileName = $state("");
    let selectedProxyId = $state<string | null>(null);
    let selectedBehavior = $state<"bot" | "fast" | "normal" | "cautious">(
        "normal",
    );
    let profileTags = $state<string[]>([]);
    let tagInput = $state("");
    let creatingProfile = $state(false);
    let createSuccess = $state(false);

    // Derived
    let proxies = $derived(proxyStore.proxies);
    let suggestedName = $derived(() => {
        if (!activeTest) return "";
        try {
            const url = new URL(activeTest.url);
            const domain = url.hostname.replace("www.", "").split(".")[0];
            const timestamp = Date.now().toString(36).slice(-4).toUpperCase();
            return `${domain}-${timestamp}`;
        } catch {
            return `profile-${Date.now().toString(36).slice(-4)}`;
        }
    });

    // Extract domain for profile target
    let targetDomain = $derived(() => {
        if (!activeTest) return "";
        try {
            return new URL(activeTest.url).hostname;
        } catch {
            return "";
        }
    });

    let progressPct = $derived(
        activeTest?.progress
            ? Math.round(
                  ((activeTest.progress.testIndex +
                      (activeTest.progress.status === "done" ? 1 : 0)) /
                      activeTest.progress.totalTests) *
                      100,
              )
            : activeTest?.status === "completed"
              ? 100
              : 0,
    );

    function handleStartTest() {
        if (!targetUrl.trim()) return;
        let url = targetUrl.trim();
        if (!/^https?:\/\//i.test(url)) {
            url = "https://" + url;
        }
        urlTestStore.startTest(
            url,
            showLoginFields && username.trim() ? username.trim() : undefined,
            showLoginFields && password.trim() ? password.trim() : undefined,
        );
        activeTab = "results";
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter" && !isRunning) {
            handleStartTest();
        }
    }

    function statusBadge(status: UrlTestResult["status"]): string {
        switch (status) {
            case "PASS":
                return "badge-pass";
            case "WARN":
                return "badge-warn";
            case "FAIL":
                return "badge-fail";
            case "INFO":
                return "badge-info";
        }
    }

    function statusIcon(status: UrlTestResult["status"]): string {
        switch (status) {
            case "PASS":
                return "\u2713";
            case "WARN":
                return "\u26A0";
            case "FAIL":
                return "\u2717";
            case "INFO":
                return "i";
        }
    }

    function overallBadgeClass(status: string | null): string {
        switch (status) {
            case "PASS":
                return "overall-pass";
            case "WARN":
                return "overall-warn";
            case "FAIL":
                return "overall-fail";
            default:
                return "overall-info";
        }
    }

    function fmtMs(ms: number | null | undefined): string {
        if (ms == null) return "-";
        if (ms < 1000) return ms + "ms";
        return (ms / 1000).toFixed(1) + "s";
    }

    function relTime(iso: string | null): string {
        if (!iso) return "-";
        const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (s < 60) return s + "s ago";
        if (s < 3600) return Math.floor(s / 60) + "m ago";
        return Math.floor(s / 3600) + "h ago";
    }

    function truncateUrl(url: string, max = 60): string {
        if (url.length <= max) return url;
        return url.slice(0, max - 3) + "...";
    }

    /** Build form selectors from detected forms/login results and navigate to /automation */
    function extractSelectors() {
        if (!activeTest) return null;

        let uSelector = "";
        let pSelector = "";
        let sSelector = "";
        let successSelector = "";
        let failureSelector = "";
        let captchaSelector = "";
        let consentSelector = "";
        let totpSelector = "";
        let note = "";
        const noteParts: string[] = [];

        // ── 1. Prefer actual selectors from the live login test ──────────
        // The scraper resolves real CSS selectors during the login attempt
        // and sends them back on the loginResult — these are the most
        // reliable because they were actually used to interact with the page.
        const lr = activeTest.loginResult;
        if (lr) {
            // Core form selectors (directly resolved by Playwright)
            if (lr.usernameSelector) {
                uSelector = lr.usernameSelector;
                noteParts.push("username selector from live login");
            }
            if (lr.passwordSelector) {
                pSelector = lr.passwordSelector;
                noteParts.push("password selector from live login");
            }
            if (lr.submitSelector) {
                sSelector = lr.submitSelector;
                noteParts.push("submit selector from live login");
            }

            // Extended flow selectors detected during login
            if (lr.successSelector) {
                successSelector = lr.successSelector;
                noteParts.push(
                    `success indicator from login (${lr.successSignals?.length ?? 0} signals)`,
                );
            }
            if (lr.failureSelector) {
                failureSelector = lr.failureSelector;
                noteParts.push(
                    `failure indicator from login (${lr.failureSignals?.length ?? 0} signals)`,
                );
            }
            if (lr.captchaSelector) {
                captchaSelector = lr.captchaSelector;
                noteParts.push(
                    `CAPTCHA from login page: ${lr.captchaProviders?.join(", ") ?? "detected"}`,
                );
            }
            if (lr.consentSelector) {
                consentSelector = lr.consentSelector;
                noteParts.push(
                    `consent banner${lr.consentDismissed ? " (auto-dismissed)" : ""}`,
                );
            }
            if (lr.totpSelector) {
                totpSelector = lr.totpSelector;
                noteParts.push("TOTP/2FA field from login flow");
            }

            // Outcome summary
            if (lr.outcomeGuess === "success" && lr.postSubmitUrl) {
                noteParts.push(`login success → ${lr.postSubmitUrl}`);
            } else if (lr.outcomeGuess && lr.outcomeGuess !== "unknown") {
                noteParts.push(`login outcome: ${lr.outcomeGuess}`);
            }
            if (lr.isMultiStep) {
                noteParts.push("multi-step login flow");
            }
            if (lr.rateLimitSignals && lr.rateLimitSignals.length > 0) {
                noteParts.push(
                    `rate-limit signals: ${lr.rateLimitSignals.join(", ")}`,
                );
            }
        }

        // ── 2. Fall back to detected form metadata ───────────────────────
        // If the live login test didn't run (no credentials provided) or
        // didn't find certain fields, derive selectors from form detection.
        const loginForm =
            activeTest.forms.find(
                (f) => f.formType === "LOGIN" || f.formType === "login",
            ) ?? activeTest.forms[0];

        if (loginForm) {
            if (!uSelector) {
                const uField =
                    loginForm.fields.find(
                        (f) =>
                            f.type === "email" ||
                            f.autocomplete === "email" ||
                            f.autocomplete === "username" ||
                            f.name === "email" ||
                            f.name === "username" ||
                            f.name === "login",
                    ) ?? loginForm.fields.find((f) => f.type === "text");

                if (uField) {
                    uSelector = uField.id
                        ? `#${uField.id}`
                        : uField.name
                          ? `input[name="${uField.name}"]`
                          : `input[type="${uField.type}"]`;
                    noteParts.push("username from form detection");
                }
            }

            if (!pSelector) {
                const pField = loginForm.fields.find(
                    (f) => f.type === "password",
                );
                if (pField) {
                    pSelector = pField.id
                        ? `#${pField.id}`
                        : pField.name
                          ? `input[name="${pField.name}"]`
                          : 'input[type="password"]';
                    noteParts.push("password from form detection");
                }
            }

            if (!sSelector && loginForm.submitButtons.length > 0) {
                sSelector = loginForm.submitButtons[0];
                noteParts.push("submit from form detection");
            }

            noteParts.push(
                `${loginForm.formType} form (#${loginForm.formIndex}, ${loginForm.fields.length} fields)`,
            );
        }

        // ── 3. Last-resort generic fallbacks from boolean flags ──────────
        if (lr) {
            if (!uSelector && lr.usernameFieldFound) {
                uSelector =
                    'input[type="email"], input[name="username"], input[type="text"]';
                noteParts.push("username generic fallback");
            }
            if (!pSelector && lr.passwordFieldFound) {
                pSelector = 'input[type="password"]';
                noteParts.push("password generic fallback");
            }
            if (!sSelector && lr.submitButtonFound) {
                sSelector = 'button[type="submit"], input[type="submit"]';
                noteParts.push("submit generic fallback");
            }
        }

        // ── 4. Enrich with captcha / failure from test results ───────────
        // Only fall back to generic selectors if the login flow didn't
        // already give us specific ones.
        if (!captchaSelector) {
            const captchaResult = activeTest.results.find(
                (r) =>
                    r.name.toLowerCase().includes("captcha") &&
                    r.status === "WARN",
            );
            if (captchaResult) {
                captchaSelector =
                    ".g-recaptcha, .h-captcha, [class*='captcha']";
            }
        }

        if (!failureSelector) {
            const failResult = activeTest.results.find(
                (r) =>
                    r.name.toLowerCase().includes("error") ||
                    r.name.toLowerCase().includes("failure"),
            );
            if (failResult) {
                failureSelector =
                    "[class*='error'], [role='alert'], .alert-danger";
            }
        }

        note =
            noteParts.length > 0
                ? noteParts.join(" | ")
                : "Extracted from URL test results";

        return {
            url: activeTest.url,
            username_selector: uSelector,
            password_selector: pSelector,
            submit_selector: sSelector,
            success_selector: successSelector || undefined,
            failure_selector: failureSelector || undefined,
            captcha_selector: captchaSelector || undefined,
            consent_selector: consentSelector || undefined,
            totp_selector: totpSelector || undefined,
            detection_note: note,
        };
    }

    function handleUseInAutomation() {
        const selectors = extractSelectors();
        if (!selectors) return;
        scrapeHandoff.set(selectors);
        goto("/automation");
    }

    function handleStartProfileCreation() {
        if (!activeTest) return;
        profileName = suggestedName();
        selectedProxyId = null;
        selectedBehavior = "normal";
        profileTags = [];
        createSuccess = false;
        activeTab = "create";
    }

    async function handleCreateProfile() {
        if (!activeTest || !profileName.trim()) return;
        creatingProfile = true;
        createSuccess = false;

        try {
            const selectors = extractSelectors();

            // Build target from URL analysis
            const tags: ProfileTarget["tags"] = [];
            if (
                activeTest.loginResult?.captchaProviders?.includes("hCaptcha")
            ) {
                tags.push("captcha-hcaptcha");
            }
            if (
                activeTest.loginResult?.captchaProviders?.includes("reCAPTCHA")
            ) {
                tags.push("captcha-recaptcha");
            }
            if (activeTest.loginResult?.isMultiStep) {
                tags.push("mfa-required");
            }
            if (activeTest.loginResult?.rateLimitSignals?.length) {
                tags.push("rate-limit-sensitive");
            }

            const target: ProfileTarget = {
                url: activeTest.url,
                platform: targetDomain(),
                tags,
                optimized: false,
                snippet_ids: [],
            };

            // Create notes with detection info and selectors
            const noteLines: string[] = [];
            const lr = activeTest.loginResult;

            // Include selectors in notes for reference
            if (selectors?.username_selector) {
                noteLines.push(`Username: ${selectors.username_selector}`);
            }
            if (selectors?.password_selector) {
                noteLines.push(`Password: ${selectors.password_selector}`);
            }
            if (selectors?.submit_selector) {
                noteLines.push(`Submit: ${selectors.submit_selector}`);
            }
            if (selectors?.success_selector) {
                noteLines.push(`Success: ${selectors.success_selector}`);
            }
            if (selectors?.captcha_selector) {
                noteLines.push(`Captcha: ${selectors.captcha_selector}`);
            }
            if (selectors?.detection_note) {
                noteLines.push(`Detection: ${selectors.detection_note}`);
            }
            if (activeTest.forms.length > 0) {
                noteLines.push(`Forms detected: ${activeTest.forms.length}`);
            }
            if (lr?.captchaProviders && lr.captchaProviders.length > 0) {
                noteLines.push(`Captcha: ${lr.captchaProviders.join(", ")}`);
            }
            if (lr?.isMultiStep) {
                noteLines.push("Multi-step login flow");
            }

            // Create the profile with a random seed (fingerprint generated on backend)
            const profile = await profileStore.createProfile(
                {
                    name: profileName.trim(),
                    proxy_id: selectedProxyId ?? undefined,
                    behavior_profile: selectedBehavior,
                    tags: profileTags,
                    notes: noteLines.join("\n"),
                },
                target,
            );

            createSuccess = true;

            // Brief delay then offer next steps
            setTimeout(() => {
                // Keep on create tab to show success + next actions
            }, 500);
        } catch (e) {
            console.error("Failed to create profile:", e);
        } finally {
            creatingProfile = false;
        }
    }

    function addTag() {
        const tag = tagInput.trim();
        if (tag && !profileTags.includes(tag)) {
            profileTags = [...profileTags, tag];
        }
        tagInput = "";
    }

    function removeTag(tag: string) {
        profileTags = profileTags.filter((t) => t !== tag);
    }

    function handleTagKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") {
            e.preventDefault();
            addTag();
        }
    }
</script>

{#if showScreenshotLightbox}
    <div
        class="lightbox"
        role="button"
        tabindex="-1"
        onclick={() => {
            showScreenshotLightbox = null;
        }}
        onkeydown={(e) => {
            if (e.key === "Escape") showScreenshotLightbox = null;
        }}
    >
        <div
            class="lightbox-inner"
            role="presentation"
            onclick={(e) => e.stopPropagation()}
        >
            <div class="lightbox-header">
                <span class="section-label">Screenshot</span>
                <button
                    class="icon-btn"
                    aria-label="Close screenshot preview"
                    onclick={() => {
                        showScreenshotLightbox = null;
                    }}
                >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <path
                            d="M1.5 1.5l8 8M9.5 1.5l-8 8"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />
                    </svg>
                </button>
            </div>
            <img
                src={showScreenshotLightbox}
                alt="Screenshot"
                class="lightbox-img"
            />
        </div>
    </div>
{/if}

<div class="page">
    <!-- ── Header ──────────────────────────────────────────────────────── -->
    <div class="page-header">
        <div class="header-left">
            <span class="page-title">URL Test</span>
            {#if activeTest}
                <span
                    class="run-badge"
                    class:run-badge-live={activeTest.status === "running"}
                >
                    {#if activeTest.status === "running"}
                        <span class="dot dot-running"></span>
                        Running
                    {:else if activeTest.status === "completed"}
                        <span class="dot dot-success"></span>
                        {activeTest.overallStatus ?? "Done"}
                    {:else if activeTest.status === "error"}
                        <span class="dot dot-error"></span>
                        Error
                    {:else}
                        <span class="dot dot-idle"></span>
                        Idle
                    {/if}
                </span>
            {/if}
        </div>
        <div class="header-actions">
            {#if activeTest?.status === "completed"}
                <button
                    class="btn btn-primary btn-sm"
                    onclick={handleStartProfileCreation}
                >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <circle
                            cx="5.5"
                            cy="5.5"
                            r="4"
                            stroke="currentColor"
                            stroke-width="1.2"
                        />
                        <path
                            d="M5.5 3.5v4M3.5 5.5h4"
                            stroke="currentColor"
                            stroke-width="1.2"
                            stroke-linecap="round"
                        />
                    </svg>
                    Create Profile
                </button>
                <button
                    class="btn btn-secondary btn-sm"
                    onclick={handleUseInAutomation}
                >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <path
                            d="M1 5.5h9M6.5 1L10 5.5 6.5 10"
                            stroke="currentColor"
                            stroke-width="1.2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    </svg>
                    Automation
                </button>
                <button
                    class="btn btn-ghost btn-sm"
                    onclick={() =>
                        urlTestStore.downloadReport(activeTest?.id ?? "")}
                >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <path
                            d="M1 7v2.5a1 1 0 001 1h7a1 1 0 001-1V7M5.5 1v6.5M3 5l2.5 2.5L8 5"
                            stroke="currentColor"
                            stroke-width="1.2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    </svg>
                    Export
                </button>
            {/if}
        </div>
    </div>

    <!-- ── URL Input Bar ──────────────────────────────────────────────── -->
    <div class="input-bar">
        <div class="url-row">
            <div class="url-field-wrap">
                <svg
                    class="url-icon"
                    width="13"
                    height="13"
                    viewBox="0 0 13 13"
                    fill="none"
                >
                    <circle
                        cx="6.5"
                        cy="6.5"
                        r="5"
                        stroke="currentColor"
                        stroke-width="1.3"
                    />
                    <path
                        d="M6.5 1.5c-2 1.5-2 9 0 10M6.5 1.5c2 1.5 2 9 0 10M1.5 6.5h10"
                        stroke="currentColor"
                        stroke-width="1"
                        opacity="0.5"
                    />
                </svg>
                <input
                    class="url-input"
                    type="url"
                    placeholder="https://example.com"
                    bind:value={targetUrl}
                    onkeydown={handleKeydown}
                    disabled={isRunning}
                />
            </div>
            <button
                class="toggle-login-btn"
                class:active={showLoginFields}
                onclick={() => {
                    showLoginFields = !showLoginFields;
                }}
                title="Add login credentials for full login test"
            >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <rect
                        x="1.5"
                        y="4.5"
                        width="9"
                        height="6"
                        rx="1.2"
                        stroke="currentColor"
                        stroke-width="1.2"
                    />
                    <path
                        d="M3.5 4.5V3a2.5 2.5 0 015 0v1.5"
                        stroke="currentColor"
                        stroke-width="1.2"
                        stroke-linecap="round"
                    />
                    <circle cx="6" cy="8" r="1" fill="currentColor" />
                </svg>
                Login
            </button>
            <button
                class="run-btn"
                onclick={handleStartTest}
                disabled={isRunning || !targetUrl.trim()}
            >
                {#if isRunning}
                    <span class="spin">&#9696;</span>
                    Running...
                {:else}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 1l8 5-8 5V1z" fill="currentColor" />
                    </svg>
                    Run Test
                {/if}
            </button>
        </div>

        {#if showLoginFields}
            <div class="login-fields fade-in">
                <div class="login-field">
                    <label class="field-label" for="urltest-username">Username / Email</label>
                    <input
                        id="urltest-username"
                        class="input mono"
                        type="text"
                        placeholder="user@example.com"
                        bind:value={username}
                        onkeydown={handleKeydown}
                        disabled={isRunning}
                        autocomplete="username"
                    />
                </div>
                <div class="login-field">
                    <label class="field-label" for="urltest-password">Password</label>
                    <div class="password-wrap">
                        <input
                            id="urltest-password"
                            class="input mono password-input"
                            type={showPassword ? "text" : "password"}
                            placeholder="password"
                            bind:value={password}
                            onkeydown={handleKeydown}
                            disabled={isRunning}
                            autocomplete="current-password"
                        />
                        <button
                            class="eye-btn"
                            onclick={() => {
                                showPassword = !showPassword;
                            }}
                            title={showPassword
                                ? "Hide password"
                                : "Show password"}
                        >
                            {#if showPassword}
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 14 14"
                                    fill="none"
                                >
                                    <path
                                        d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"
                                        stroke="currentColor"
                                        stroke-width="1.2"
                                    />
                                    <circle
                                        cx="7"
                                        cy="7"
                                        r="2"
                                        stroke="currentColor"
                                        stroke-width="1.2"
                                    />
                                </svg>
                            {:else}
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 14 14"
                                    fill="none"
                                >
                                    <path
                                        d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"
                                        stroke="currentColor"
                                        stroke-width="1.2"
                                    />
                                    <path
                                        d="M2 2l10 10"
                                        stroke="currentColor"
                                        stroke-width="1.2"
                                        stroke-linecap="round"
                                    />
                                </svg>
                            {/if}
                        </button>
                    </div>
                </div>
                <div class="login-hint">
                    <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                        opacity="0.5"
                    >
                        <circle
                            cx="5"
                            cy="5"
                            r="4"
                            stroke="currentColor"
                            stroke-width="1.1"
                        />
                        <path
                            d="M5 4v3M5 2.5a.5.5 0 110 1 .5.5 0 010-1"
                            stroke="currentColor"
                            stroke-width="1"
                            stroke-linecap="round"
                        />
                    </svg>
                    <span
                        >Credentials are used for a live login test. They are
                        never stored or transmitted outside the test session.</span
                    >
                </div>
            </div>
        {/if}

        {#if !wsConnected}
            <div class="ws-warning">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                        d="M6 1L1 10h10L6 1z"
                        stroke="currentColor"
                        stroke-width="1.2"
                        stroke-linejoin="round"
                    />
                    <path
                        d="M6 5v2M6 8.5a.5.5 0 110 1 .5.5 0 010-1"
                        stroke="currentColor"
                        stroke-width="1"
                        stroke-linecap="round"
                    />
                </svg>
                Scraper WebSocket not connected. Start the scraper with
                <code>npm run scraper</code>
            </div>
        {/if}
    </div>

    <!-- ── Progress Bar ───────────────────────────────────────────────── -->
    {#if activeTest}
        <div class="progress-section">
            <div class="progress-bar-track">
                <div
                    class="progress-bar-fill"
                    style:width="{progressPct}%"
                ></div>
            </div>
            <div class="progress-meta">
                {#if activeTest.progress && activeTest.status === "running"}
                    <span class="progress-label">
                        {activeTest.progress.testIndex + 1}/{activeTest.progress
                            .totalTests}
                        &mdash; {activeTest.progress.testName}
                    </span>
                {:else if activeTest.status === "completed"}
                    <span class="progress-label done">
                        All tests completed in {fmtMs(activeTest.durationMs)}
                    </span>
                {:else if activeTest.status === "error"}
                    <span class="progress-label error-text">
                        Error: {activeTest.error}
                    </span>
                {/if}
                {#if activeTest.summary}
                    <span class="progress-summary">
                        <span class="ps pass"
                            >{activeTest.summary.pass} pass</span
                        >
                        <span class="ps warn"
                            >{activeTest.summary.warn} warn</span
                        >
                        <span class="ps fail"
                            >{activeTest.summary.fail} fail</span
                        >
                        <span class="ps info"
                            >{activeTest.summary.info} info</span
                        >
                    </span>
                {/if}
            </div>
        </div>
    {/if}

    <!-- ── Overall Status Badge ───────────────────────────────────────── -->
    {#if activeTest?.status === "completed" && activeTest.overallStatus}
        <div class="overall-badge-row">
            <div
                class="overall-badge {overallBadgeClass(
                    activeTest.overallStatus,
                )}"
            >
                <span class="overall-icon"
                    >{statusIcon(activeTest.overallStatus)}</span
                >
                <span class="overall-text"
                    >Overall: {activeTest.overallStatus}</span
                >
                <span class="overall-url mono"
                    >{truncateUrl(activeTest.url)}</span
                >
                <span class="overall-time">{fmtMs(activeTest.durationMs)}</span>
            </div>
        </div>
    {/if}

    <!-- ── Tab Bar ────────────────────────────────────────────────────── -->
    {#if activeTest}
        <div class="tab-bar">
            <button
                class="tab"
                class:active={activeTab === "results"}
                onclick={() => {
                    activeTab = "results";
                }}
            >
                Results
                {#if activeTest.results.length > 0}
                    <span class="tab-count">{activeTest.results.length}</span>
                {/if}
            </button>
            <button
                class="tab"
                class:active={activeTab === "forms"}
                onclick={() => {
                    activeTab = "forms";
                }}
            >
                Forms
                {#if activeTest.forms.length > 0}
                    <span class="tab-count">{activeTest.forms.length}</span>
                {/if}
            </button>
            {#if activeTest.loginResult}
                <button
                    class="tab"
                    class:active={activeTab === "login"}
                    onclick={() => {
                        activeTab = "login";
                    }}
                >
                    Login Test
                    {#if activeTest.loginResult.submitted}
                        <span class="tab-pip live">&bull;</span>
                    {/if}
                </button>
            {/if}
            <button
                class="tab"
                class:active={activeTab === "screenshots"}
                onclick={() => {
                    activeTab = "screenshots";
                }}
            >
                Screenshots
            </button>
            <button
                class="tab"
                class:active={activeTab === "history"}
                onclick={() => {
                    activeTab = "history";
                }}
            >
                History
                {#if history.length > 0}
                    <span class="tab-count muted">{history.length}</span>
                {/if}
            </button>
            {#if activeTest?.status === "completed"}
                <button
                    class="tab tab-create"
                    class:active={activeTab === "create"}
                    onclick={() => {
                        activeTab = "create";
                        if (!profileName) profileName = suggestedName();
                    }}
                >
                    ➕ Create Profile
                </button>
            {/if}
        </div>
    {/if}

    <!-- ── Tab Content ────────────────────────────────────────────────── -->
    <div class="page-body">
        {#if !activeTest}
            <div class="empty">
                <svg
                    width="40"
                    height="40"
                    viewBox="0 0 40 40"
                    fill="none"
                    opacity="0.15"
                >
                    <circle
                        cx="20"
                        cy="20"
                        r="16"
                        stroke="currentColor"
                        stroke-width="1.5"
                    />
                    <path
                        d="M20 8c-5 4-5 20 0 24M20 8c5 4 5 20 0 24M8 20h24"
                        stroke="currentColor"
                        stroke-width="1"
                    />
                    <path
                        d="M12 13h16M12 27h16"
                        stroke="currentColor"
                        stroke-width="0.8"
                        opacity="0.4"
                    />
                </svg>
                <span class="empty-title">URL Test</span>
                <span class="empty-hint"
                    >Enter a target URL above and click <strong>Run Test</strong
                    > to analyse the site for forms, security, bot protection, and
                    more.</span
                >
            </div>
        {:else if activeTab === "results"}
            <!-- ── Results Table ─────────────────────────────────────── -->
            <div class="results-panel">
                {#if activeTest.results.length === 0 && activeTest.status === "running"}
                    <div class="empty-mini">
                        <span class="spin-lg">&#9696;</span>
                        <p class="empty-text">Running tests...</p>
                    </div>
                {:else}
                    <div class="results-table-wrap">
                        <table class="results-table">
                            <thead>
                                <tr>
                                    <th style="width:30px">#</th>
                                    <th style="width:70px">Status</th>
                                    <th style="width:200px">Test</th>
                                    <th>Detail</th>
                                    <th style="width:70px">Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each activeTest.results as result, i}
                                    <tr
                                        class:row-pass={result.status ===
                                            "PASS"}
                                        class:row-warn={result.status ===
                                            "WARN"}
                                        class:row-fail={result.status ===
                                            "FAIL"}
                                    >
                                        <td class="mono muted">{i + 1}</td>
                                        <td>
                                            <span
                                                class="badge {statusBadge(
                                                    result.status,
                                                )}"
                                            >
                                                <span class="badge-icon"
                                                    >{statusIcon(
                                                        result.status,
                                                    )}</span
                                                >
                                                {result.status}
                                            </span>
                                        </td>
                                        <td class="test-name">{result.name}</td>
                                        <td class="test-detail mono"
                                            >{result.detail}</td
                                        >
                                        <td class="mono muted"
                                            >{fmtMs(result.durationMs)}</td
                                        >
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {/if}
            </div>
        {:else if activeTab === "forms"}
            <!-- ── Forms Panel ───────────────────────────────────────── -->
            <div class="forms-panel">
                {#if activeTest.forms.length === 0}
                    <div class="empty-mini">
                        <p class="empty-text">
                            No forms detected on this page.
                        </p>
                        <p class="empty-hint">
                            The page may use dynamic JS rendering or
                            non-standard form elements.
                        </p>
                    </div>
                {:else}
                    {#each activeTest.forms as form}
                        <div class="form-card">
                            <div class="form-card-header">
                                <span
                                    class="form-type-badge"
                                    class:form-reg={form.formType ===
                                        "REGISTRATION"}
                                    class:form-login={form.formType === "LOGIN"}
                                >
                                    {form.formType}
                                </span>
                                <span class="mono muted" style="font-size:10px"
                                    >Form #{form.formIndex} &middot; {form.method}
                                    &middot; {form.fields.length} fields</span
                                >
                                {#if form.submitButtons.length > 0}
                                    <span class="form-submits mono"
                                        >Submits: [{form.submitButtons.join(
                                            ", ",
                                        )}]</span
                                    >
                                {/if}
                            </div>
                            <div class="form-fields-grid">
                                {#each form.fields as field}
                                    <div class="form-field-row">
                                        <span class="ff-type mono"
                                            >{field.tag}[{field.type}]</span
                                        >
                                        <span class="ff-name mono"
                                            >{field.name ||
                                                field.id ||
                                                "?"}</span
                                        >
                                        {#if field.required}
                                            <span class="ff-req">required</span>
                                        {/if}
                                        {#if field.placeholder}
                                            <span class="ff-ph muted"
                                                >"{field.placeholder}"</span
                                            >
                                        {/if}
                                        {#if field.label}
                                            <span class="ff-label muted"
                                                >&larr; {field.label}</span
                                            >
                                        {/if}
                                        {#if field.autocomplete}
                                            <span class="tag tag-accent"
                                                >{field.autocomplete}</span
                                            >
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>
        {:else if activeTab === "login"}
            <!-- ── Login Test Panel ──────────────────────────────────── -->
            <div class="login-panel">
                {#if activeTest.loginResult}
                    {@const lr = activeTest.loginResult}
                    <div class="login-result-card">
                        <div class="lr-header">
                            <span
                                class="badge {lr.submitted &&
                                lr.outcomeGuess === 'success'
                                    ? 'badge-pass'
                                    : lr.submitted &&
                                        lr.outcomeGuess === 'wrong_credentials'
                                      ? 'badge-info'
                                      : lr.submitted
                                        ? 'badge-warn'
                                        : 'badge-fail'}"
                            >
                                {#if lr.submitted && lr.outcomeGuess === "success"}
                                    Login Success
                                {:else if lr.submitted && lr.outcomeGuess === "wrong_credentials"}
                                    Wrong Credentials
                                {:else if lr.submitted && lr.outcomeGuess === "captcha_block"}
                                    CAPTCHA Block
                                {:else if lr.submitted && lr.outcomeGuess === "rate_limited"}
                                    Rate Limited
                                {:else if lr.submitted}
                                    Outcome Unknown
                                {:else}
                                    Not Submitted
                                {/if}
                            </span>
                            {#if lr.isMultiStep}
                                <span class="tag tag-accent">Multi-step</span>
                            {/if}
                            {#if lr.urlChanged}
                                <span class="tag">URL changed</span>
                            {/if}
                        </div>

                        <!-- ── Core fields grid ──────────────────────── -->
                        <div class="lr-grid">
                            <div class="lr-item">
                                <span class="lr-key">Navigated to Login</span>
                                <span class="lr-val"
                                    >{lr.navigatedToLogin ? "Yes" : "No"}</span
                                >
                            </div>
                            {#if lr.loginUrl}
                                <div class="lr-item">
                                    <span class="lr-key">Login URL</span>
                                    <span class="lr-val mono"
                                        >{lr.loginUrl}</span
                                    >
                                </div>
                            {/if}
                            <div class="lr-item">
                                <span class="lr-key">Username Field</span>
                                <span class="lr-val">
                                    {lr.usernameFieldFound
                                        ? "\u2713 Found"
                                        : "\u2717 Not found"}
                                    {#if lr.usernameSelector}
                                        <span
                                            class="mono muted"
                                            style="font-size:10px; display:block; margin-top:2px"
                                            >{lr.usernameSelector}</span
                                        >
                                    {/if}
                                </span>
                            </div>
                            <div class="lr-item">
                                <span class="lr-key">Password Field</span>
                                <span class="lr-val">
                                    {lr.passwordFieldFound
                                        ? "\u2713 Found"
                                        : "\u2717 Not found"}
                                    {#if lr.passwordSelector}
                                        <span
                                            class="mono muted"
                                            style="font-size:10px; display:block; margin-top:2px"
                                            >{lr.passwordSelector}</span
                                        >
                                    {/if}
                                </span>
                            </div>
                            <div class="lr-item">
                                <span class="lr-key">Submit Button</span>
                                <span class="lr-val">
                                    {lr.submitButtonFound
                                        ? "\u2713 Found"
                                        : "\u2717 Not found"}
                                    {#if lr.submitSelector}
                                        <span
                                            class="mono muted"
                                            style="font-size:10px; display:block; margin-top:2px"
                                            >{lr.submitSelector}</span
                                        >
                                    {/if}
                                </span>
                            </div>
                            <div class="lr-item">
                                <span class="lr-key">Submitted</span>
                                <span class="lr-val"
                                    >{lr.submitted ? "Yes" : "No"}</span
                                >
                            </div>
                            {#if lr.postSubmitUrl}
                                <div class="lr-item" style="grid-column: 1/-1">
                                    <span class="lr-key">Post-Submit URL</span>
                                    <span class="lr-val mono"
                                        >{lr.postSubmitUrl}</span
                                    >
                                </div>
                            {/if}
                            {#if lr.postLoginPageTitle}
                                <div class="lr-item">
                                    <span class="lr-key">Page Title</span>
                                    <span class="lr-val"
                                        >{lr.postLoginPageTitle}</span
                                    >
                                </div>
                            {/if}
                            {#if lr.outcomeGuess}
                                <div class="lr-item">
                                    <span class="lr-key">Outcome</span>
                                    <span class="lr-val">{lr.outcomeGuess}</span
                                    >
                                </div>
                            {/if}
                            {#if lr.isMultiStep && lr.multiStepDetail}
                                <div class="lr-item" style="grid-column: 1/-1">
                                    <span class="lr-key">Multi-Step</span>
                                    <span class="lr-val"
                                        >{lr.multiStepDetail}</span
                                    >
                                </div>
                            {/if}
                            <div class="lr-item" style="grid-column: 1/-1">
                                <span class="lr-key">Detail</span>
                                <span class="lr-val mono" style="font-size:10px"
                                    >{lr.detail}</span
                                >
                            </div>
                        </div>

                        <!-- ── Detected selectors ────────────────────── -->
                        {#if lr.successSelector || lr.failureSelector || lr.captchaSelector || lr.consentSelector || lr.totpSelector}
                            <div class="lr-selectors-section">
                                <span class="section-label"
                                    >Detected Selectors</span
                                >
                                <div class="lr-grid">
                                    {#if lr.successSelector}
                                        <div class="lr-item">
                                            <span class="lr-key"
                                                >Success Indicator</span
                                            >
                                            <span
                                                class="lr-val mono"
                                                style="font-size:10px"
                                                >{lr.successSelector}</span
                                            >
                                        </div>
                                    {/if}
                                    {#if lr.failureSelector}
                                        <div class="lr-item">
                                            <span class="lr-key"
                                                >Failure Indicator</span
                                            >
                                            <span
                                                class="lr-val mono"
                                                style="font-size:10px"
                                                >{lr.failureSelector}</span
                                            >
                                        </div>
                                    {/if}
                                    {#if lr.captchaSelector}
                                        <div class="lr-item">
                                            <span class="lr-key">CAPTCHA</span>
                                            <span
                                                class="lr-val mono"
                                                style="font-size:10px"
                                                >{lr.captchaSelector}</span
                                            >
                                        </div>
                                    {/if}
                                    {#if lr.consentSelector}
                                        <div class="lr-item">
                                            <span class="lr-key"
                                                >Consent Banner</span
                                            >
                                            <span
                                                class="lr-val mono"
                                                style="font-size:10px"
                                                >{lr.consentSelector}{lr.consentDismissed
                                                    ? " (dismissed)"
                                                    : ""}</span
                                            >
                                        </div>
                                    {/if}
                                    {#if lr.totpSelector}
                                        <div class="lr-item">
                                            <span class="lr-key"
                                                >TOTP / 2FA</span
                                            >
                                            <span
                                                class="lr-val mono"
                                                style="font-size:10px"
                                                >{lr.totpSelector}</span
                                            >
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        {/if}

                        <!-- ── Signal lists ──────────────────────────── -->
                        {#if lr.successSignals && lr.successSignals.length > 0}
                            <div class="lr-signals-section">
                                <span
                                    class="section-label"
                                    style="color:var(--success)"
                                    >Success Signals ({lr.successSignals
                                        .length})</span
                                >
                                <div class="lr-signal-list">
                                    {#each lr.successSignals as sig}
                                        <span
                                            class="tag"
                                            style="border-color:var(--success-dim); color:var(--success)"
                                            >{sig}</span
                                        >
                                    {/each}
                                </div>
                            </div>
                        {/if}
                        {#if lr.failureSignals && lr.failureSignals.length > 0}
                            <div class="lr-signals-section">
                                <span
                                    class="section-label"
                                    style="color:var(--error)"
                                    >Failure Signals ({lr.failureSignals
                                        .length})</span
                                >
                                <div class="lr-signal-list">
                                    {#each lr.failureSignals as sig}
                                        <span
                                            class="tag"
                                            style="border-color:var(--error-dim); color:var(--error)"
                                            >{sig}</span
                                        >
                                    {/each}
                                </div>
                            </div>
                        {/if}
                        {#if lr.captchaProviders && lr.captchaProviders.length > 0}
                            <div class="lr-signals-section">
                                <span
                                    class="section-label"
                                    style="color:var(--warning)"
                                    >CAPTCHA Providers</span
                                >
                                <div class="lr-signal-list">
                                    {#each lr.captchaProviders as cp}
                                        <span class="tag tag-warn">{cp}</span>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                        {#if lr.rateLimitSignals && lr.rateLimitSignals.length > 0}
                            <div class="lr-signals-section">
                                <span
                                    class="section-label"
                                    style="color:var(--warning)"
                                    >Rate-Limit / Lockout Signals ({lr
                                        .rateLimitSignals.length})</span
                                >
                                <div class="lr-signal-list">
                                    {#each lr.rateLimitSignals as sig}
                                        <span class="tag tag-warn">{sig}</span>
                                    {/each}
                                </div>
                            </div>
                        {/if}

                        <!-- ── Screenshots ───────────────────────────── -->
                        {#if lr.preLoginScreenshot || lr.screenshot}
                            <div class="lr-screenshots-row">
                                {#if lr.preLoginScreenshot}
                                    <div class="lr-screenshot">
                                        <span class="section-label"
                                            >Pre-Login (Form)</span
                                        >
                                        <button
                                            class="thumb-btn"
                                            type="button"
                                            aria-label="Open pre-login screenshot"
                                            onclick={() => {
                                                showScreenshotLightbox =
                                                    "data:image/png;base64," +
                                                    lr.preLoginScreenshot;
                                            }}
                                        >
                                            <img
                                                src="data:image/png;base64,{lr.preLoginScreenshot}"
                                                alt="Pre-login screenshot"
                                                class="screenshot-thumb"
                                            />
                                        </button>
                                    </div>
                                {/if}
                                {#if lr.screenshot}
                                    <div class="lr-screenshot">
                                        <span class="section-label"
                                            >Post-Login Result</span
                                        >
                                        <button
                                            class="thumb-btn"
                                            type="button"
                                            aria-label="Open post-login screenshot"
                                            onclick={() => {
                                                showScreenshotLightbox =
                                                    "data:image/png;base64," +
                                                    lr.screenshot;
                                            }}
                                        >
                                            <img
                                                src="data:image/png;base64,{lr.screenshot}"
                                                alt="Post-login screenshot"
                                                class="screenshot-thumb"
                                            />
                                        </button>
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {:else}
                    <div class="empty-mini">
                        <p class="empty-text">No login test was performed.</p>
                        <p class="empty-hint">
                            Enable the login fields and provide credentials to
                            run a login test.
                        </p>
                    </div>
                {/if}
            </div>
        {:else if activeTab === "screenshots"}
            <!-- ── Screenshots Panel ─────────────────────────────────── -->
            <div class="screenshots-panel">
                {#if activeTest.screenshots.desktop || activeTest.screenshots.tablet || activeTest.screenshots.mobile}
                    <div class="ss-tab-bar">
                        {#each ["desktop", "tablet", "mobile"] as vp}
                            {@const label =
                                vp.charAt(0).toUpperCase() + vp.slice(1)}
                            {@const hasImg =
                                !!activeTest.screenshots[
                                    vp as "desktop" | "tablet" | "mobile"
                                ]}
                            <button
                                class="ss-tab"
                                class:active={screenshotTab === vp}
                                disabled={!hasImg}
                                onclick={() => {
                                    screenshotTab = vp as
                                        | "desktop"
                                        | "tablet"
                                        | "mobile";
                                }}
                            >
                                {label}
                                {#if hasImg}
                                    <span class="ss-dot"></span>
                                {/if}
                            </button>
                        {/each}
                    </div>
                    {#if activeTest.screenshots[screenshotTab]}
                        {@const dataUrl = urlTestStore.getScreenshotDataUrl(
                            activeTest,
                            screenshotTab,
                        )}
                        {#if dataUrl}
                            <div class="ss-preview">
                                <button
                                    class="thumb-btn"
                                    type="button"
                                    aria-label={`Open ${screenshotTab} screenshot`}
                                    onclick={() => {
                                        showScreenshotLightbox = dataUrl;
                                    }}
                                >
                                    <img
                                        src={dataUrl}
                                        alt="{screenshotTab} screenshot"
                                        class="ss-img"
                                        class:ss-tablet={screenshotTab === "tablet"}
                                        class:ss-mobile={screenshotTab === "mobile"}
                                    />
                                </button>
                            </div>
                        {/if}
                    {/if}
                {:else}
                    <div class="empty-mini">
                        <p class="empty-text">No screenshots captured yet.</p>
                        <p class="empty-hint">
                            Screenshots are taken during the test run.
                        </p>
                    </div>
                {/if}
            </div>
        {:else if activeTab === "create"}
            <div class="create-panel">
                {#if createSuccess}
                    <div class="create-success">
                        <div class="success-icon">✓</div>
                        <h3 class="success-title">Profile Created!</h3>
                        <p class="success-desc">
                            <strong>{profileName}</strong> is ready for {targetDomain()}
                        </p>
                        <div class="success-actions">
                            <a href="/" class="btn btn-primary">
                                Go to Dashboard
                            </a>
                            <button
                                class="btn btn-secondary"
                                onclick={handleUseInAutomation}
                            >
                                Run Automation
                            </button>
                            <button
                                class="btn btn-ghost"
                                onclick={() => {
                                    createSuccess = false;
                                    activeTab = "results";
                                }}
                            >
                                Continue Testing
                            </button>
                        </div>
                    </div>
                {:else}
                    <div class="create-form">
                        <h3 class="create-title">
                            Create Profile from Analysis
                        </h3>
                        <p class="create-desc">
                            Create a browser profile tailored for <strong
                                >{targetDomain()}</strong
                            > with all detected selectors and settings pre-configured.
                        </p>

                        <div class="create-grid">
                            <div class="create-field">
                                <label class="field-label" for="urltest-profile-name">Profile Name</label>
                                <input
                                    id="urltest-profile-name"
                                    type="text"
                                    class="input"
                                    bind:value={profileName}
                                    placeholder={suggestedName()}
                                />
                            </div>

                            <div class="create-field">
                                <label class="field-label" for="urltest-proxy-id"
                                    >Proxy (Optional)</label
                                >
                                <select
                                    id="urltest-proxy-id"
                                    class="input"
                                    bind:value={selectedProxyId}
                                >
                                    <option value={null}>No proxy</option>
                                    {#each proxies as proxy}
                                        <option value={proxy.id}>
                                            {proxy.name} ({proxy.country ||
                                                "Unknown"})
                                        </option>
                                    {/each}
                                </select>
                            </div>

                            <div class="create-field">
                                <label class="field-label" for="urltest-behavior"
                                    >Behavior Profile</label
                                >
                                <select
                                    id="urltest-behavior"
                                    class="input"
                                    bind:value={selectedBehavior}
                                >
                                    <option value="cautious"
                                        >Cautious (slower, more human-like)</option
                                    >
                                    <option value="normal"
                                        >Normal (balanced)</option
                                    >
                                    <option value="fast"
                                        >Fast (quicker actions)</option
                                    >
                                    <option value="bot">Bot (no delays)</option>
                                </select>
                            </div>

                            <div class="create-field">
                                <label class="field-label" for="urltest-tags">Tags</label>
                                <div class="tags-input-wrap">
                                    <input
                                        id="urltest-tags"
                                        type="text"
                                        class="input"
                                        bind:value={tagInput}
                                        placeholder="Add tag..."
                                        onkeydown={handleTagKeydown}
                                    />
                                    <button class="btn btn-sm" onclick={addTag}
                                        >Add</button
                                    >
                                </div>
                                {#if profileTags.length > 0}
                                    <div class="tags-list">
                                        {#each profileTags as tag}
                                            <span class="tag">
                                                {tag}
                                                <button
                                                    class="tag-remove"
                                                    onclick={() =>
                                                        removeTag(tag)}
                                                    >×</button
                                                >
                                            </span>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>

                        <div class="create-summary">
                            <h4 class="summary-title">
                                Included from Analysis
                            </h4>
                            <div class="summary-grid">
                                {#if activeTest?.loginResult?.usernameSelector}
                                    <span class="summary-item"
                                        >✓ Username selector</span
                                    >
                                {/if}
                                {#if activeTest?.loginResult?.passwordSelector}
                                    <span class="summary-item"
                                        >✓ Password selector</span
                                    >
                                {/if}
                                {#if activeTest?.loginResult?.submitSelector}
                                    <span class="summary-item"
                                        >✓ Submit selector</span
                                    >
                                {/if}
                                {#if activeTest?.loginResult?.captchaSelector}
                                    <span class="summary-item warn"
                                        >⚠ Captcha detected</span
                                    >
                                {/if}
                                {#if activeTest?.loginResult?.isMultiStep}
                                    <span class="summary-item"
                                        >✓ Multi-step flow</span
                                    >
                                {/if}
                                {#if activeTest?.forms.length > 0}
                                    <span class="summary-item"
                                        >{activeTest.forms.length} form(s)</span
                                    >
                                {/if}
                            </div>
                        </div>

                        <div class="create-actions">
                            <button
                                class="btn btn-primary"
                                onclick={handleCreateProfile}
                                disabled={creatingProfile ||
                                    !profileName.trim()}
                            >
                                {creatingProfile
                                    ? "Creating..."
                                    : "Create Profile"}
                            </button>
                            <button
                                class="btn btn-ghost"
                                onclick={() => (activeTab = "results")}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                {/if}
            </div>
        {:else if activeTab === "history"}
            <!-- ── History Panel ──────────────────────────────────────── -->
            <div class="history-panel">
                {#if history.length === 0}
                    <div class="empty-mini">
                        <p class="empty-text">No test history yet.</p>
                        <p class="empty-hint">
                            Run a URL test to see results here.
                        </p>
                    </div>
                {:else}
                    <div class="history-actions-bar">
                        <button
                            class="btn btn-ghost btn-sm"
                            onclick={() => urlTestStore.clearHistory()}
                        >
                            Clear History
                        </button>
                    </div>
                    <div class="history-list">
                        {#each history as test (test.id)}
                            <div
                                class="history-card"
                                class:active={test.id === activeTest?.id}
                                role="button"
                                tabindex="0"
                                onclick={() => {
                                    urlTestStore.setActiveTest(test.id);
                                    activeTab = "results";
                                }}
                                onkeydown={(e) => {
                                    if (e.key === "Enter") {
                                        urlTestStore.setActiveTest(test.id);
                                        activeTab = "results";
                                    }
                                }}
                            >
                                <div class="hc-top">
                                    <span class="mono hc-url"
                                        >{truncateUrl(test.url, 50)}</span
                                    >
                                    {#if test.overallStatus}
                                        <span
                                            class="badge {statusBadge(
                                                test.overallStatus,
                                            )}"
                                            style="font-size:10px"
                                        >
                                            {test.overallStatus}
                                        </span>
                                    {:else if test.status === "error"}
                                        <span
                                            class="badge badge-fail"
                                            style="font-size:10px">ERROR</span
                                        >
                                    {/if}
                                </div>
                                <div class="hc-bottom">
                                    <span class="muted" style="font-size:10px"
                                        >{relTime(test.startedAt)} &middot; {fmtMs(
                                            test.durationMs,
                                        )}</span
                                    >
                                    {#if test.summary}
                                        <span class="hc-stats">
                                            <span class="ps pass"
                                                >{test.summary.pass}P</span
                                            >
                                            <span class="ps warn"
                                                >{test.summary.warn}W</span
                                            >
                                            <span class="ps fail"
                                                >{test.summary.fail}F</span
                                            >
                                        </span>
                                    {/if}
                                    {#if test.username}
                                        <span
                                            class="tag tag-accent"
                                            style="font-size:9px">login</span
                                        >
                                    {/if}
                                    <button
                                        class="icon-btn danger"
                                        aria-label="Delete test"
                                        style="margin-left:auto"
                                        onclick={(e) => {
                                            e.stopPropagation();
                                            urlTestStore.deleteTest(test.id);
                                        }}
                                    >
                                        <svg
                                            width="9"
                                            height="9"
                                            viewBox="0 0 9 9"
                                            fill="none"
                                        >
                                            <path
                                                d="M1 1l7 7M8 1L1 8"
                                                stroke="currentColor"
                                                stroke-width="1.3"
                                                stroke-linecap="round"
                                            />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
    /* ── Page layout ─────────────────────────────────────────────── */
    .page {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 20px;
        border-bottom: 1px solid var(--border-subtle);
        flex-shrink: 0;
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .page-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: 0.01em;
    }

    .page-body {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 0;
    }

    /* ── Run badge ────────────────────────────────────────────────── */
    .run-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 10px;
        border-radius: 99px;
        font-size: 11px;
        font-weight: 600;
        background: var(--surface-3);
        color: var(--text-muted);
    }

    .run-badge-live {
        background: var(--accent-glow-md);
        color: var(--accent);
    }

    .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .dot-running {
        background: var(--accent);
        animation: pulse-dot 1.5s ease-in-out infinite;
    }

    .dot-success {
        background: var(--success);
    }

    .dot-error {
        background: var(--error);
    }

    .dot-idle {
        background: var(--text-faint);
    }

    /* ── Input bar ───────────────────────────────────────────────── */
    .input-bar {
        padding: 12px 20px;
        border-bottom: 1px solid var(--border-subtle);
        background: var(--surface-1);
        flex-shrink: 0;
    }

    .url-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .url-field-wrap {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 0 10px;
        transition: border-color 0.15s;
    }

    .url-field-wrap:focus-within {
        border-color: var(--accent);
    }

    .url-icon {
        flex-shrink: 0;
        color: var(--text-muted);
    }

    .url-input {
        flex: 1;
        background: none;
        border: none;
        outline: none;
        color: var(--text-primary);
        font-family: "JetBrains Mono", monospace;
        font-size: 12px;
        padding: 7px 0;
    }

    .url-input::placeholder {
        color: var(--text-faint);
    }

    .url-input:disabled {
        opacity: 0.5;
    }

    .toggle-login-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 12px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.12s;
    }

    .toggle-login-btn:hover {
        border-color: var(--border-hover);
        color: var(--text-secondary);
    }

    .toggle-login-btn.active {
        background: var(--accent-glow-md);
        border-color: var(--accent-muted);
        color: var(--accent);
    }

    .run-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 16px;
        font-size: 11px;
        font-weight: 700;
        color: var(--bg);
        background: var(--accent);
        border: none;
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition:
            background 0.12s,
            opacity 0.12s;
        white-space: nowrap;
    }

    .run-btn:hover:not(:disabled) {
        background: var(--accent-dim);
    }

    .run-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    /* ── Login fields ────────────────────────────────────────────── */
    .login-fields {
        display: flex;
        gap: 12px;
        margin-top: 10px;
        align-items: flex-end;
        flex-wrap: wrap;
    }

    .login-field {
        flex: 1;
        min-width: 180px;
    }

    .field-label {
        display: block;
        font-size: 10px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin-bottom: 4px;
    }

    .input {
        width: 100%;
        padding: 6px 10px;
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-primary);
        font-size: 12px;
        outline: none;
        transition: border-color 0.15s;
    }

    .input:focus {
        border-color: var(--accent);
    }

    .input:disabled {
        opacity: 0.5;
    }

    .mono {
        font-family: "JetBrains Mono", monospace;
    }

    .password-wrap {
        position: relative;
    }

    .password-input {
        padding-right: 32px;
    }

    .eye-btn {
        position: absolute;
        right: 4px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
    }

    .eye-btn:hover {
        color: var(--text-secondary);
    }

    .login-hint {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 10px;
        color: var(--text-faint);
        margin-top: 6px;
        width: 100%;
    }

    .ws-warning {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        padding: 6px 10px;
        background: var(--warning-glow);
        border: 1px solid rgba(251, 191, 36, 0.2);
        border-radius: var(--radius-sm);
        font-size: 11px;
        color: var(--warning);
    }

    .ws-warning code {
        background: var(--surface-4);
        padding: 1px 5px;
        border-radius: 3px;
        font-size: 10px;
    }

    /* ── Progress bar ────────────────────────────────────────────── */
    .progress-section {
        padding: 8px 20px;
        border-bottom: 1px solid var(--border-subtle);
        flex-shrink: 0;
    }

    .progress-bar-track {
        width: 100%;
        height: 4px;
        background: var(--surface-4);
        border-radius: 2px;
        overflow: hidden;
    }

    .progress-bar-fill {
        height: 100%;
        background: var(--accent);
        border-radius: 2px;
        transition: width 0.3s ease;
    }

    .progress-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 4px;
    }

    .progress-label {
        font-size: 10px;
        color: var(--text-muted);
    }

    .progress-label.done {
        color: var(--success);
    }

    .error-text {
        color: var(--error) !important;
    }

    .progress-summary {
        display: flex;
        gap: 8px;
    }

    .ps {
        font-size: 10px;
        font-weight: 600;
    }

    .ps.pass {
        color: var(--success);
    }

    .ps.warn {
        color: var(--warning);
    }

    .ps.fail {
        color: var(--error);
    }

    .ps.info {
        color: var(--info);
    }

    /* ── Overall badge ───────────────────────────────────────────── */
    .overall-badge-row {
        padding: 8px 20px;
        border-bottom: 1px solid var(--border-subtle);
        flex-shrink: 0;
    }

    .overall-badge {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        border-radius: var(--radius);
        font-size: 12px;
        font-weight: 600;
    }

    .overall-pass {
        background: var(--success-glow);
        color: var(--success);
        border: 1px solid rgba(52, 211, 153, 0.2);
    }

    .overall-warn {
        background: var(--warning-glow);
        color: var(--warning);
        border: 1px solid rgba(251, 191, 36, 0.2);
    }

    .overall-fail {
        background: var(--error-glow);
        color: var(--error);
        border: 1px solid rgba(248, 113, 113, 0.2);
    }

    .overall-info {
        background: var(--surface-3);
        color: var(--info);
        border: 1px solid var(--border);
    }

    .overall-icon {
        font-size: 16px;
    }

    .overall-text {
        font-weight: 700;
    }

    .overall-url {
        color: inherit;
        opacity: 0.7;
        font-size: 11px;
    }

    .overall-time {
        margin-left: auto;
        font-size: 11px;
        opacity: 0.6;
        font-family: "JetBrains Mono", monospace;
    }

    /* ── Tab bar ─────────────────────────────────────────────────── */
    .tab-bar {
        display: flex;
        gap: 0;
        padding: 0 20px;
        border-bottom: 1px solid var(--border-subtle);
        flex-shrink: 0;
        background: var(--surface-1);
    }

    .tab {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 8px 14px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        transition:
            color 0.12s,
            border-color 0.12s;
    }

    .tab:hover {
        color: var(--text-secondary);
    }

    .tab.active {
        color: var(--text-primary);
        border-bottom-color: var(--accent);
    }

    .tab.tab-create {
        color: var(--accent);
        font-weight: 500;
    }

    .tab.tab-create.active {
        color: var(--accent);
        border-bottom-color: var(--accent);
    }

    .tab-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 14px;
        padding: 0 4px;
        border-radius: 99px;
        font-size: 10px;
        font-weight: 600;
        background: var(--surface-4);
        color: var(--text-muted);
    }

    .tab-count.muted {
        background: var(--surface-3);
    }

    .tab-pip {
        font-size: 8px;
    }

    .tab-pip.live {
        color: var(--success);
        animation: pulse-dot 2s ease-in-out infinite;
    }

    /* ── Results table ───────────────────────────────────────────── */
    .results-panel,
    .forms-panel,
    .login-panel,
    .screenshots-panel,
    .history-panel {
        padding: 12px 20px;
    }

    .results-table-wrap {
        overflow-x: auto;
    }

    .results-table {
        width: 100%;
        border-collapse: collapse;
    }

    .results-table th,
    .results-table td {
        padding: 6px 10px;
        text-align: left;
        font-size: 11px;
        border-bottom: 1px solid var(--border-subtle);
    }

    .results-table th {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        background: var(--surface-2);
        position: sticky;
        top: 0;
        z-index: 2;
    }

    .results-table tbody tr {
        transition: background 0.1s;
    }

    .results-table tbody tr:hover {
        background: var(--surface-2);
    }

    .results-table tr.row-pass {
        border-left: 2px solid var(--success);
    }

    .results-table tr.row-warn {
        border-left: 2px solid var(--warning);
    }

    .results-table tr.row-fail {
        border-left: 2px solid var(--error);
    }

    .test-name {
        font-weight: 600;
        color: var(--text-primary);
        white-space: nowrap;
    }

    .test-detail {
        font-size: 10px;
        color: var(--text-secondary);
        max-width: 500px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .muted {
        color: var(--text-muted);
    }

    /* ── Badges ──────────────────────────────────────────────────── */
    .badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 99px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
    }

    .badge-icon {
        font-size: 10px;
    }

    .badge-pass {
        background: var(--success-glow);
        color: var(--success);
    }

    .badge-warn {
        background: var(--warning-glow);
        color: var(--warning);
    }

    .badge-fail {
        background: var(--error-glow);
        color: var(--error);
    }

    .badge-info {
        background: rgba(56, 189, 248, 0.1);
        color: var(--info);
    }

    /* ── Form cards ──────────────────────────────────────────────── */
    .form-card {
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        margin-bottom: 12px;
        overflow: hidden;
    }

    .form-card-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        background: var(--surface-3);
        border-bottom: 1px solid var(--border-subtle);
        flex-wrap: wrap;
    }

    .form-type-badge {
        padding: 2px 8px;
        border-radius: 99px;
        font-size: 10px;
        font-weight: 700;
        background: var(--surface-4);
        color: var(--text-muted);
    }

    .form-type-badge.form-reg {
        background: var(--accent-glow-md);
        color: var(--accent);
    }

    .form-type-badge.form-login {
        background: var(--success-glow);
        color: var(--success);
    }

    .form-submits {
        font-size: 10px;
        color: var(--text-muted);
    }

    .form-fields-grid {
        padding: 8px 12px;
    }

    .form-field-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 0;
        border-bottom: 1px solid var(--border-subtle);
        flex-wrap: wrap;
    }

    .form-field-row:last-child {
        border-bottom: none;
    }

    .ff-type {
        font-size: 10px;
        color: var(--accent);
        min-width: 100px;
    }

    .ff-name {
        font-size: 10px;
        color: var(--text-primary);
        font-weight: 600;
    }

    .ff-req {
        font-size: 9px;
        color: var(--error);
        font-weight: 700;
    }

    .ff-ph,
    .ff-label {
        font-size: 10px;
    }

    .tag {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: 99px;
        font-size: 9px;
        font-weight: 600;
        background: var(--surface-4);
        color: var(--text-muted);
    }

    .tag-accent {
        background: var(--accent-glow);
        color: var(--accent);
    }

    .tag-warn {
        background: var(--warning-glow);
        color: var(--warning);
    }

    /* ── Login result ────────────────────────────────────────────── */
    .login-result-card {
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        overflow: hidden;
    }

    .lr-header {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 10px 14px;
        border-bottom: 1px solid var(--border-subtle);
        background: var(--surface-3);
    }

    .lr-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 12px 14px;
    }

    .lr-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .lr-key {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .lr-val {
        font-size: 11px;
        color: var(--text-primary);
    }

    .lr-screenshot {
        padding: 12px 14px;
        border-top: 1px solid var(--border-subtle);
    }

    .lr-screenshots-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        padding: 12px 14px;
        border-top: 1px solid var(--border-subtle);
    }

    @media (max-width: 700px) {
        .lr-screenshots-row {
            grid-template-columns: 1fr;
        }
    }

    .lr-selectors-section {
        padding: 12px 14px;
        border-top: 1px solid var(--border-subtle);
        background: var(--surface-3);
    }

    .lr-selectors-section .lr-grid {
        padding: 8px 0 0;
    }

    .lr-signals-section {
        padding: 10px 14px;
        border-top: 1px solid var(--border-subtle);
    }

    .lr-signal-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 6px;
    }

    .thumb-btn {
        display: inline-flex;
        padding: 0;
        border: none;
        background: transparent;
        cursor: pointer;
    }

    .screenshot-thumb {
        margin-top: 6px;
        max-width: 100%;
        max-height: 300px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--border);
        cursor: pointer;
        transition: opacity 0.12s;
    }

    .screenshot-thumb:hover {
        opacity: 0.85;
    }

    .section-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }

    /* ── Screenshots panel ───────────────────────────────────────── */
    .ss-tab-bar {
        display: flex;
        gap: 6px;
        margin-bottom: 12px;
    }

    .ss-tab {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 5px 12px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        background: var(--surface-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.12s;
    }

    .ss-tab:hover:not(:disabled) {
        border-color: var(--border-hover);
    }

    .ss-tab.active {
        background: var(--accent-glow-md);
        border-color: var(--accent-muted);
        color: var(--accent);
    }

    .ss-tab:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .ss-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--success);
    }

    .ss-preview {
        display: flex;
        justify-content: center;
    }

    .ss-img {
        max-width: 100%;
        max-height: 600px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        cursor: pointer;
        transition: opacity 0.12s;
    }

    .ss-img:hover {
        opacity: 0.9;
    }

    .ss-img.ss-tablet {
        max-width: 768px;
    }

    .ss-img.ss-mobile {
        max-width: 375px;
    }

    /* ── History panel ───────────────────────────────────────────── */
    .history-actions-bar {
        margin-bottom: 8px;
    }

    .history-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .history-card {
        padding: 8px 12px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition:
            background 0.1s,
            border-color 0.1s;
    }

    .history-card:hover {
        background: var(--surface-3);
        border-color: var(--border-hover);
    }

    .history-card.active {
        border-color: var(--accent-muted);
    }

    .hc-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }

    .hc-url {
        font-size: 11px;
        color: var(--text-primary);
        font-weight: 600;
    }

    .hc-bottom {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
    }

    .hc-stats {
        display: flex;
        gap: 6px;
    }

    /* ── Empty states ────────────────────────────────────────────── */
    .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 48px 24px;
        text-align: center;
        flex: 1;
    }

    .empty-title {
        font-size: 14px;
        font-weight: 700;
        color: var(--text-muted);
    }

    .empty-hint {
        font-size: 11px;
        color: var(--text-faint);
        max-width: 320px;
    }

    .empty-mini {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 32px 16px;
        text-align: center;
    }

    .empty-text {
        font-size: 12px;
        color: var(--text-muted);
    }

    /* ── Lightbox ────────────────────────────────────────────────── */
    .lightbox {
        position: fixed;
        inset: 0;
        z-index: 999;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
    }

    .lightbox-inner {
        max-width: 90vw;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        background: var(--surface-2);
        border-radius: var(--radius);
        overflow: hidden;
    }

    .lightbox-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid var(--border-subtle);
        background: var(--surface-3);
    }

    .lightbox-img {
        max-width: 100%;
        max-height: calc(90vh - 40px);
        object-fit: contain;
    }

    /* ── Buttons ─────────────────────────────────────────────────── */
    .btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: none;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-weight: 600;
        transition:
            background 0.12s,
            opacity 0.12s;
    }

    .btn-sm {
        padding: 4px 10px;
        font-size: 11px;
    }

    .btn-secondary {
        background: var(--surface-4);
        color: var(--text-secondary);
        border: 1px solid var(--border);
    }

    .btn-secondary:hover {
        background: var(--surface-5);
        border-color: var(--border-hover);
    }

    .btn-ghost {
        background: none;
        color: var(--text-muted);
    }

    .btn-ghost:hover {
        color: var(--text-secondary);
        background: var(--surface-3);
    }

    .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: var(--radius-sm);
        border: none;
        background: none;
        color: var(--text-muted);
        cursor: pointer;
        transition:
            background 0.12s,
            color 0.12s;
    }

    .icon-btn:hover {
        background: var(--surface-4);
        color: var(--text-secondary);
    }

    .icon-btn.danger:hover {
        background: var(--error-glow);
        color: var(--error);
    }

    /* ── Spinner ─────────────────────────────────────────────────── */
    .spin {
        display: inline-block;
        animation: spin 0.8s linear infinite;
        font-size: 13px;
    }

    .spin-lg {
        display: inline-block;
        animation: spin 0.8s linear infinite;
        font-size: 24px;
        color: var(--accent);
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    @keyframes pulse-dot {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.35;
        }
    }

    /* ── Fade in ─────────────────────────────────────────────────── */
    .fade-in {
        animation: fadeIn 0.15s ease;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(-4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    /* ── Create Profile Panel ────────────────────────────────────── */
    .create-panel {
        padding: 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 400px;
    }

    .create-form {
        max-width: 480px;
        width: 100%;
    }

    .create-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--fg);
        margin: 0 0 6px;
    }

    .create-desc {
        font-size: 12px;
        color: var(--fg-muted);
        margin: 0 0 20px;
        line-height: 1.5;
    }

    .create-grid {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .create-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .tags-input-wrap {
        display: flex;
        gap: 6px;
    }

    .tags-input-wrap .input {
        flex: 1;
    }

    .tags-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 6px;
    }

    .tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background: var(--bg-2);
        border: 1px solid var(--border);
        border-radius: 10px;
        font-size: 10px;
        color: var(--fg-muted);
    }

    .tag-remove {
        background: none;
        border: none;
        color: var(--fg-muted);
        cursor: pointer;
        font-size: 12px;
        line-height: 1;
        padding: 0;
        margin-left: 2px;
    }

    .tag-remove:hover {
        color: var(--red);
    }

    .create-summary {
        margin-top: 20px;
        padding: 12px;
        background: var(--bg-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
    }

    .summary-title {
        font-size: 11px;
        font-weight: 600;
        color: var(--fg-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0 0 8px;
    }

    .summary-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .summary-item {
        font-size: 11px;
        color: var(--green);
        background: rgba(var(--green-rgb), 0.1);
        padding: 3px 8px;
        border-radius: 4px;
    }

    .summary-item.warn {
        color: var(--orange);
        background: rgba(var(--orange-rgb), 0.1);
    }

    .create-actions {
        margin-top: 20px;
        display: flex;
        gap: 8px;
    }

    /* ── Create Success ────────────────────────────────────────────── */
    .create-success {
        text-align: center;
        padding: 40px 20px;
    }

    .success-icon {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: var(--green);
        color: white;
        font-size: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 16px;
    }

    .success-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--fg);
        margin: 0 0 8px;
    }

    .success-desc {
        font-size: 13px;
        color: var(--fg-muted);
        margin: 0 0 24px;
    }

    .success-actions {
        display: flex;
        gap: 10px;
        justify-content: center;
        flex-wrap: wrap;
    }
</style>
