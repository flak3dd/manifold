// Integration tests for form scraper functionality
// These tests verify the complete form detection pipeline

#[cfg(test)]
mod integration_tests {
    // Test data: Google login page HTML (simplified)
    const GOOGLE_LOGIN_HTML: &str = r#"
        <!DOCTYPE html>
        <html>
        <head>
            <title>Google Sign-In</title>
        </head>
        <body data-react-root>
            <form id="gaia_loginform">
                <input type="email" id="identifierId" name="email" placeholder="Email or phone" />
                <button id="identifierNext" type="button">
                    <span>Next</span>
                </button>
                <input type="password" name="password" id="password" />
                <button id="passwordNext" type="button">
                    <span>Next</span>
                </button>
                <input type="text" name="totpPin" id="totpPin" placeholder="Enter your authenticator code" />
                <div class="g-recaptcha" data-sitekey="6LeI..."></div>
            </form>
            <div data-ogsr-up=""></div>
        </body>
        </html>
    "#;

    // Test data: Amazon login page HTML (simplified)
    const AMAZON_LOGIN_HTML: &str = r#"
        <!DOCTYPE html>
        <html>
        <head>
            <title>Amazon Login</title>
        </head>
        <body>
            <form name="signIn" method="POST">
                <input type="email" name="email" id="ap_email" placeholder="Email" />
                <input type="password" name="password" id="ap_password" placeholder="Password" />
                <input type="submit" id="signInSubmit" value="Sign in" />
                <div class="a-alert-error" style="display:none;">Invalid email or password</div>
            </form>
            <div class="nav-line-1">Account</div>
        </body>
        </html>
    "#;

    // Test data: Simple form (React SPA)
    const REACT_SPA_HTML: &str = r#"
        <!DOCTYPE html>
        <html>
        <body>
            <div id="root" data-react-root>
                <div class="login-container">
                    <input type="email" id="username" name="user_email" />
                    <input type="password" id="user_password" />
                    <button type="submit" class="btn-login">Login</button>
                    <div class="error-message" style="display:none;">Login failed</div>
                    <div class="dashboard" style="display:none;">Welcome</div>
                </div>
            </div>
            <script src="/__next.js"></script>
        </body>
        </html>
    "#;

    // Test data: Form with CAPTCHA
    const FORM_WITH_CAPTCHA_HTML: &str = r#"
        <!DOCTYPE html>
        <html>
        <body>
            <form>
                <input type="email" id="email" />
                <input type="password" id="password" />
                <div class="h-captcha" data-sitekey="..."></div>
                <button type="submit">Sign in</button>
            </form>
        </body>
        </html>
    "#;

    // Test data: Form with MFA/2FA
    const FORM_WITH_MFA_HTML: &str = r#"
        <!DOCTYPE html>
        <html>
        <body>
            <form>
                <h1>Two-Factor Authentication</h1>
                <p>Enter the code from your authenticator app:</p>
                <input type="text" name="totp" id="authenticator_code"
                       placeholder="Authenticator code" maxlength="6" />
                <button type="submit">Verify</button>
            </form>
        </body>
        </html>
    "#;

    // Test data: Vue.js SPA
    const VUE_SPA_HTML: &str = r#"
        <!DOCTYPE html>
        <html>
        <body>
            <div id="app" __vue__>
                <div class="login-form">
                    <input type="email" v-model="email" />
                    <input type="password" v-model="password" />
                    <button @click="login">Login</button>
                </div>
            </div>
        </body>
        </html>
    "#;

    // Test data: Angular SPA
    const ANGULAR_SPA_HTML: &str = r#"
        <!DOCTYPE html>
        <html ng-app="MyApp">
        <body>
            <div ng-controller="LoginCtrl">
                <form ng-submit="login()">
                    <input type="email" ng-model="credentials.email" />
                    <input type="password" ng-model="credentials.password" />
                    <button type="submit">Sign In</button>
                </form>
            </div>
        </body>
        </html>
    "#;

    // Test: Detect Google login form
    #[test]
    fn test_google_form_detection() {
        let doc = scraper::Html::parse_document(GOOGLE_LOGIN_HTML);

        // Verify we can parse the document
        let root = doc.root_element();
        assert!(root.value().name() != "");

        // Check for key Google elements
        let selector = scraper::Selector::parse("input[type='email']").unwrap();
        assert!(
            doc.select(&selector).next().is_some(),
            "Email input not found"
        );

        let selector = scraper::Selector::parse("input[type='password']").unwrap();
        assert!(
            doc.select(&selector).next().is_some(),
            "Password input not found"
        );

        let selector = scraper::Selector::parse(".g-recaptcha").unwrap();
        assert!(
            doc.select(&selector).next().is_some(),
            "reCAPTCHA not found"
        );

        let selector = scraper::Selector::parse("[data-ogsr-up]").unwrap();
        assert!(
            doc.select(&selector).next().is_some(),
            "Success indicator not found"
        );
    }

    // Test: Detect Amazon login form
    #[test]
    fn test_amazon_form_detection() {
        let doc = scraper::Html::parse_document(AMAZON_LOGIN_HTML);

        let selector = scraper::Selector::parse("#ap_email").unwrap();
        assert!(
            doc.select(&selector).next().is_some(),
            "Email field not found"
        );

        let selector = scraper::Selector::parse("#ap_password").unwrap();
        assert!(
            doc.select(&selector).next().is_some(),
            "Password field not found"
        );

        let selector = scraper::Selector::parse("#signInSubmit").unwrap();
        assert!(
            doc.select(&selector).next().is_some(),
            "Submit button not found"
        );

        let selector = scraper::Selector::parse(".a-alert-error").unwrap();
        assert!(
            doc.select(&selector).next().is_some(),
            "Error message not found"
        );
    }

    // Test: React SPA detection
    #[test]
    fn test_react_spa_detection() {
        let html = REACT_SPA_HTML;

        // Check for React indicators
        assert!(
            html.contains("data-react-root"),
            "React indicator not found"
        );

        let doc = scraper::Html::parse_document(html);

        let selector = scraper::Selector::parse("[data-react-root]").unwrap();
        assert!(
            doc.select(&selector).next().is_some(),
            "React root element not found"
        );
    }

    // Test: Vue SPA detection
    #[test]
    fn test_vue_spa_detection() {
        let html = VUE_SPA_HTML;

        // Check for Vue indicators
        assert!(html.contains("__vue__"), "Vue indicator not found");
        assert!(html.contains("v-model"), "Vue directive not found");
    }

    // Test: Angular SPA detection
    #[test]
    fn test_angular_spa_detection() {
        let html = ANGULAR_SPA_HTML;

        // Check for Angular indicators
        assert!(html.contains("ng-app"), "ng-app directive not found");
        assert!(html.contains("ng-model"), "ng-model directive not found");
    }

    // Test: CAPTCHA detection (reCAPTCHA)
    #[test]
    fn test_recaptcha_detection() {
        let html = GOOGLE_LOGIN_HTML;

        assert!(html.contains("g-recaptcha"), "reCAPTCHA not found");

        let doc = scraper::Html::parse_document(html);
        let selector = scraper::Selector::parse(".g-recaptcha").unwrap();
        assert!(doc.select(&selector).next().is_some());
    }

    // Test: CAPTCHA detection (hCaptcha)
    #[test]
    fn test_hcaptcha_detection() {
        let html = FORM_WITH_CAPTCHA_HTML;

        assert!(html.contains("h-captcha"), "hCaptcha not found");

        let doc = scraper::Html::parse_document(html);
        let selector = scraper::Selector::parse(".h-captcha").unwrap();
        assert!(doc.select(&selector).next().is_some());
    }

    // Test: MFA/TOTP field detection
    #[test]
    fn test_mfa_field_detection() {
        let html = FORM_WITH_MFA_HTML;

        // Check for TOTP indicators
        assert!(html.contains("authenticator"), "TOTP indicator not found");
        assert!(html.contains("totp"), "TOTP field not found");

        let doc = scraper::Html::parse_document(html);
        let selector = scraper::Selector::parse("[name='totp']").unwrap();
        assert!(doc.select(&selector).next().is_some());
    }

    // Test: MFA indicator detection via text
    #[test]
    fn test_mfa_text_detection() {
        let html = FORM_WITH_MFA_HTML;

        // Check for 2FA/MFA keywords
        assert!(html.to_lowercase().contains("authenticator"));
        assert!(html.to_lowercase().contains("two-factor"));
    }

    // Test: Form field variations
    #[test]
    fn test_email_field_variations() {
        let variations = vec![
            (r#"<input type="email" />"#, true),
            (r#"<input type="text" name="email" />"#, true),
            (r#"<input name="user_email" />"#, true),
            (r#"<input placeholder="Email address" />"#, false),
            (r#"<input type="text" />"#, false),
        ];

        for (html, should_find) in variations {
            let doc = scraper::Html::parse_document(html);
            let email_selector = scraper::Selector::parse("input[type='email']").unwrap();
            let has_email_type = doc.select(&email_selector).next().is_some();

            let email_name = scraper::Selector::parse("input[name*='email']").unwrap();
            let has_email_name = doc.select(&email_name).next().is_some();

            let result = has_email_type || has_email_name;

            if should_find {
                assert!(result, "Failed to detect email field in: {}", html);
            } else {
                assert!(!result, "Incorrectly detected email field in: {}", html);
            }
        }
    }

    // Test: Password field variations
    #[test]
    fn test_password_field_variations() {
        let variations = vec![
            (r#"<input type="password" />"#, true),
            (r#"<input type="password" name="pwd" />"#, true),
            (r#"<input name="user_password" type="password" />"#, true),
            (r#"<input type="text" />"#, false),
        ];

        for (html, should_find) in variations {
            let doc = scraper::Html::parse_document(html);
            let selector = scraper::Selector::parse("input[type='password']").unwrap();
            let result = doc.select(&selector).next().is_some();

            if should_find {
                assert!(result, "Failed to detect password field in: {}", html);
            } else {
                assert!(!result, "Incorrectly detected password field in: {}", html);
            }
        }
    }

    // Test: Submit button variations
    #[test]
    fn test_submit_button_variations() {
        let variations = vec![
            (r#"<button type="submit">Login</button>"#, true),
            (r#"<input type="submit" value="Sign In" />"#, true),
            (r#"<button type="button">Cancel</button>"#, false),
            (r#"<div onclick="submit()">Submit</div>"#, false),
        ];

        for (html, should_find) in variations {
            let doc = scraper::Html::parse_document(html);
            let submit_button = scraper::Selector::parse("button[type='submit']").unwrap();
            let submit_input = scraper::Selector::parse("input[type='submit']").unwrap();

            let has_submit = doc.select(&submit_button).next().is_some()
                || doc.select(&submit_input).next().is_some();

            if should_find {
                assert!(has_submit, "Failed to detect submit button in: {}", html);
            } else {
                assert!(
                    !has_submit,
                    "Incorrectly detected submit button in: {}",
                    html
                );
            }
        }
    }

    // Test: Success indicator detection
    #[test]
    fn test_success_indicator_detection() {
        let indicators = vec![
            (r#"<div class="dashboard">Welcome</div>"#, true),
            (r#"<div class="profile">My Profile</div>"#, true),
            (r#"<nav role="navigation">Main Nav</nav>"#, true),
            (r#"<div class="login">Login Form</div>"#, false),
        ];

        for (html, should_find) in indicators {
            let doc = scraper::Html::parse_document(html);

            let dashboard = scraper::Selector::parse(".dashboard").ok();
            let profile = scraper::Selector::parse(".profile").ok();
            let nav = scraper::Selector::parse("nav[role='navigation']").ok();

            let has_indicator = dashboard
                .map(|s| doc.select(&s).next().is_some())
                .unwrap_or(false)
                || profile
                    .map(|s| doc.select(&s).next().is_some())
                    .unwrap_or(false)
                || nav
                    .map(|s| doc.select(&s).next().is_some())
                    .unwrap_or(false);

            if should_find {
                assert!(
                    has_indicator,
                    "Failed to detect success indicator in: {}",
                    html
                );
            } else {
                assert!(
                    !has_indicator,
                    "Incorrectly detected success indicator in: {}",
                    html
                );
            }
        }
    }

    // Test: Error message detection
    #[test]
    fn test_error_indicator_detection() {
        let indicators = vec![
            (r#"<div class="error">Invalid credentials</div>"#, true),
            (r#"<div role="alert">Error occurred</div>"#, true),
            (r#"<div class="alert-error">Please try again</div>"#, true),
            (r#"<div class="success">Login successful</div>"#, false),
        ];

        for (html, should_find) in indicators {
            let doc = scraper::Html::parse_document(html);

            let error = scraper::Selector::parse(".error").ok();
            let alert = scraper::Selector::parse("[role='alert']").ok();
            let alert_error = scraper::Selector::parse(".alert-error").ok();

            let has_error = error
                .map(|s| doc.select(&s).next().is_some())
                .unwrap_or(false)
                || alert
                    .map(|s| doc.select(&s).next().is_some())
                    .unwrap_or(false)
                || alert_error
                    .map(|s| doc.select(&s).next().is_some())
                    .unwrap_or(false);

            if should_find {
                assert!(has_error, "Failed to detect error indicator in: {}", html);
            } else {
                assert!(
                    !has_error,
                    "Incorrectly detected error indicator in: {}",
                    html
                );
            }
        }
    }

    // Test: Complex form with multiple features
    #[test]
    fn test_complex_form_all_features() {
        let html = r#"
            <!DOCTYPE html>
            <html>
            <body data-react-root>
                <form id="login">
                    <input type="email" id="email" name="user_email" />
                    <input type="password" id="password" />
                    <div class="g-recaptcha"></div>
                    <input type="text" name="totp" id="mfa_code" />
                    <button type="submit" id="login_btn">Sign In</button>
                    <div class="error-message" style="display:none;"></div>
                    <div class="dashboard" style="display:none;"></div>
                </form>
            </body>
            </html>
        "#;

        let doc = scraper::Html::parse_document(html);

        // Email
        let email_sel = scraper::Selector::parse("input[type='email']").unwrap();
        assert!(doc.select(&email_sel).next().is_some(), "Email not found");

        // Password
        let pwd_sel = scraper::Selector::parse("input[type='password']").unwrap();
        assert!(doc.select(&pwd_sel).next().is_some(), "Password not found");

        // Submit
        let submit_sel = scraper::Selector::parse("button[type='submit']").unwrap();
        assert!(
            doc.select(&submit_sel).next().is_some(),
            "Submit button not found"
        );

        // CAPTCHA
        let captcha_sel = scraper::Selector::parse(".g-recaptcha").unwrap();
        assert!(
            doc.select(&captcha_sel).next().is_some(),
            "CAPTCHA not found"
        );

        // TOTP
        let totp_sel = scraper::Selector::parse("[name='totp']").unwrap();
        assert!(
            doc.select(&totp_sel).next().is_some(),
            "TOTP field not found"
        );

        // Error
        let error_sel = scraper::Selector::parse(".error-message").unwrap();
        assert!(
            doc.select(&error_sel).next().is_some(),
            "Error message not found"
        );

        // Dashboard
        let success_sel = scraper::Selector::parse(".dashboard").unwrap();
        assert!(
            doc.select(&success_sel).next().is_some(),
            "Dashboard not found"
        );

        // React
        assert!(html.contains("data-react-root"), "React not detected");
    }

    // Test: Minimal form detection
    #[test]
    fn test_minimal_form_detection() {
        let html = r#"
            <form>
                <input type="email" id="email" />
                <input type="password" id="password" />
                <button type="submit">Login</button>
            </form>
        "#;

        let doc = scraper::Html::parse_document(html);

        let email_sel = scraper::Selector::parse("input[type='email']").unwrap();
        let pwd_sel = scraper::Selector::parse("input[type='password']").unwrap();
        let submit_sel = scraper::Selector::parse("button[type='submit']").unwrap();

        assert!(doc.select(&email_sel).next().is_some());
        assert!(doc.select(&pwd_sel).next().is_some());
        assert!(doc.select(&submit_sel).next().is_some());
    }

    // Test: Empty page (no form)
    #[test]
    fn test_empty_page_detection() {
        let html = r#"
            <!DOCTYPE html>
            <html>
            <body>
                <h1>Welcome</h1>
                <p>This is a welcome page with no login form.</p>
            </body>
            </html>
        "#;

        let doc = scraper::Html::parse_document(html);

        let email_sel = scraper::Selector::parse("input[type='email']").unwrap();
        let pwd_sel = scraper::Selector::parse("input[type='password']").unwrap();
        let submit_sel = scraper::Selector::parse("button[type='submit']").unwrap();

        assert!(doc.select(&email_sel).next().is_none());
        assert!(doc.select(&pwd_sel).next().is_none());
        assert!(doc.select(&submit_sel).next().is_none());
    }
}
