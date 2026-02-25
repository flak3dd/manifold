//
//  WebScannerService.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import Foundation
import WebKit

@MainActor
class WebScannerService: NSObject, ObservableObject {
    @Published var isScanning = false
    @Published var progressLog: [String] = []
    @Published var scanResult: SiteProfile?
    
    private var webView: WKWebView?
    private var completionHandler: ((SiteProfile) -> Void)?
    
    func scan(url: String) async throws -> SiteProfile {
        isScanning = true
        progressLog.removeAll()
        addLog("Starting scan for: \(url)")
        
        let siteProfile = SiteProfile(url: url)
        
        // Create hidden webview
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: config)
        self.webView = webView
        
        webView.navigationDelegate = self
        
        addLog("Loading page...")
        guard let url = URL(string: url) else {
            throw ScannerError.invalidURL
        }
        
        let request = URLRequest(url: url)
        webView.load(request)
        
        // Wait for page load
        try await waitForPageLoad()
        
        addLog("Page loaded, analyzing content...")
        
        // Detect fields
        let fields = try await detectFields()
        addLog("Detected \(fields.count) input fields")
        
        // Map fields to site profile
        for field in fields {
            switch field.type {
            case .username, .email:
                siteProfile.usernameSelector = field.selector
            case .password:
                siteProfile.passwordSelector = field.selector
            case .cardNumber:
                siteProfile.cardNumberSelector = field.selector
            case .cardExpiryMonth:
                siteProfile.cardExpiryMonthSelector = field.selector
            case .cardExpiryYear:
                siteProfile.cardExpiryYearSelector = field.selector
            case .cardCVV:
                siteProfile.cardCVVSelector = field.selector
            case .name:
                siteProfile.nameSelector = field.selector
            case .submit:
                siteProfile.submitButtonSelector = field.selector
            case .unknown:
                break
            }
        }
        
        // Detect security tokens
        addLog("Scanning for security tokens...")
        let tokens = try await detectSecurityTokens()
        if let csrf = tokens.csrf {
            siteProfile.csrfTokenSelector = csrf
            addLog("Found CSRF token")
        }
        if let verification = tokens.verification {
            siteProfile.verificationTokenSelector = verification
            addLog("Found verification token")
        }
        if let xsrf = tokens.xsrf {
            siteProfile.xsrfTokenSelector = xsrf
            addLog("Found XSRF token")
        }
        
        // Detect bot protections
        addLog("Checking for bot protections...")
        let protections = try await detectProtections()
        siteProfile.hasCaptcha = protections.hasCaptcha
        siteProfile.hasHCaptcha = protections.hasHCaptcha
        siteProfile.hasTurnstile = protections.hasTurnstile
        siteProfile.hasArkose = protections.hasArkose
        siteProfile.hasCloudflare = protections.hasCloudflare
        
        if protections.hasCaptcha { addLog("⚠️ CAPTCHA detected") }
        if protections.hasHCaptcha { addLog("⚠️ hCaptcha detected") }
        if protections.hasTurnstile { addLog("⚠️ Turnstile detected") }
        if protections.hasArkose { addLog("⚠️ Arkose detected") }
        if protections.hasCloudflare { addLog("⚠️ Cloudflare challenge detected") }
        
        // Detect endpoints
        addLog("Analyzing network requests...")
        let endpoints = try await detectEndpoints()
        siteProfile.loginEndpoint = endpoints.login
        siteProfile.authEndpoint = endpoints.auth
        siteProfile.sessionEndpoint = endpoints.session
        siteProfile.paymentEndpoint = endpoints.payment
        
        addLog("✅ Scan complete!")
        isScanning = false
        scanResult = siteProfile
        
        return siteProfile
    }
    
    private func waitForPageLoad() async throws {
        guard let webView = webView else { throw ScannerError.webViewNotReady }
        
        var attempts = 0
        while webView.isLoading && attempts < 30 {
            try await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
            attempts += 1
        }
        
        if webView.isLoading {
            throw ScannerError.timeout
        }
        
        // Additional wait for dynamic content
        try await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
    }
    
    private func detectFields() async throws -> [FieldSelector] {
        guard let webView = webView else { throw ScannerError.webViewNotReady }
        
        let script = """
        (function() {
            const fields = [];
            const inputs = document.querySelectorAll('input, select, textarea, button');
            
            inputs.forEach((el, idx) => {
                const type = el.type?.toLowerCase() || '';
                const name = el.name?.toLowerCase() || '';
                const id = el.id?.toLowerCase() || '';
                const placeholder = el.placeholder?.toLowerCase() || '';
                const className = el.className?.toLowerCase() || '';
                const text = el.textContent?.toLowerCase() || '';
                
                let fieldType = 'unknown';
                let confidence = 0.5;
                
                // Username/Email detection
                if (type === 'email' || name.includes('email') || id.includes('email') || 
                    placeholder.includes('email') || className.includes('email')) {
                    fieldType = 'email';
                    confidence = 0.9;
                } else if (name.includes('user') || id.includes('user') || 
                          placeholder.includes('username') || placeholder.includes('user')) {
                    fieldType = 'username';
                    confidence = 0.85;
                }
                
                // Password detection
                if (type === 'password' || name.includes('pass') || id.includes('pass') || 
                    placeholder.includes('password')) {
                    fieldType = 'password';
                    confidence = 0.95;
                }
                
                // Card number detection
                if (name.includes('card') && (name.includes('number') || name.includes('num'))) {
                    fieldType = 'cardNumber';
                    confidence = 0.9;
                }
                
                // Card expiry detection
                if (name.includes('expiry') || name.includes('exp')) {
                    if (name.includes('month') || id.includes('month')) {
                        fieldType = 'cardExpiryMonth';
                        confidence = 0.85;
                    } else if (name.includes('year') || id.includes('year')) {
                        fieldType = 'cardExpiryYear';
                        confidence = 0.85;
                    }
                }
                
                // CVV detection
                if (name.includes('cvv') || name.includes('cvc') || name.includes('csc') || 
                    id.includes('cvv') || id.includes('cvc')) {
                    fieldType = 'cardCVV';
                    confidence = 0.9;
                }
                
                // Name detection
                if ((name.includes('name') || id.includes('name') || placeholder.includes('name')) && 
                    type !== 'password') {
                    fieldType = 'name';
                    confidence = 0.8;
                }
                
                // Submit button detection
                if (el.tagName === 'BUTTON' || type === 'submit' || 
                    text.includes('login') || text.includes('submit') || 
                    text.includes('pay') || text.includes('continue')) {
                    fieldType = 'submit';
                    confidence = 0.8;
                }
                
                if (fieldType !== 'unknown') {
                    // Generate selector
                    let selector = '';
                    if (id) {
                        selector = `#${id}`;
                    } else if (name) {
                        selector = `[name="${name}"]`;
                    } else {
                        selector = `${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
                    }
                    
                    fields.push({
                        selector: selector,
                        type: fieldType,
                        confidence: confidence
                    });
                }
            });
            
            return fields;
        })();
        """
        
        let result = try await webView.evaluateJavaScript(script)
        
        guard let array = result as? [[String: Any]] else {
            return []
        }
        
        var fields: [FieldSelector] = []
        for item in array {
            if let selector = item["selector"] as? String,
               let typeStr = item["type"] as? String,
               let type = FieldType(rawValue: typeStr),
               let confidence = item["confidence"] as? Double {
                let field = FieldSelector(selector: selector, type: type, confidence: confidence)
                fields.append(field)
            }
        }
        
        return fields
    }
    
    private func detectSecurityTokens() async throws -> (csrf: String?, verification: String?, xsrf: String?) {
        guard let webView = webView else { throw ScannerError.webViewNotReady }
        
        let script = """
        (function() {
            const tokens = { csrf: null, verification: null, xsrf: null };
            
            // Find hidden inputs with token names
            const inputs = document.querySelectorAll('input[type="hidden"]');
            inputs.forEach(input => {
                const name = input.name?.toLowerCase() || '';
                const value = input.value || '';
                
                if (name.includes('csrf') || name.includes('__requestverificationtoken')) {
                    tokens.csrf = `input[name="${input.name}"]`;
                } else if (name.includes('verification') || name.includes('token')) {
                    tokens.verification = `input[name="${input.name}"]`;
                } else if (name.includes('xsrf') || name.includes('_token')) {
                    tokens.xsrf = `input[name="${input.name}"]`;
                }
            });
            
            // Check meta tags
            const metaTags = document.querySelectorAll('meta[name*="token"], meta[name*="csrf"]');
            metaTags.forEach(meta => {
                const name = meta.name?.toLowerCase() || '';
                if (name.includes('csrf')) {
                    tokens.csrf = `meta[name="${meta.name}"]`;
                }
            });
            
            return tokens;
        })();
        """
        
        let result = try await webView.evaluateJavaScript(script)
        
        guard let dict = result as? [String: String] else {
            return (nil, nil, nil)
        }
        
        return (dict["csrf"], dict["verification"], dict["xsrf"])
    }
    
    private func detectProtections() async throws -> (hasCaptcha: Bool, hasHCaptcha: Bool, hasTurnstile: Bool, hasArkose: Bool, hasCloudflare: Bool) {
        guard let webView = webView else { throw ScannerError.webViewNotReady }
        
        let script = """
        (function() {
            const protections = {
                hasCaptcha: false,
                hasHCaptcha: false,
                hasTurnstile: false,
                hasArkose: false,
                hasCloudflare: false
            };
            
            // Check for reCAPTCHA
            if (document.querySelector('[data-sitekey]') || 
                document.querySelector('.g-recaptcha') ||
                window.grecaptcha) {
                protections.hasCaptcha = true;
            }
            
            // Check for hCaptcha
            if (document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey')?.startsWith('hcaptcha') ||
                document.querySelector('.h-captcha') ||
                window.hcaptcha) {
                protections.hasHCaptcha = true;
            }
            
            // Check for Turnstile
            if (document.querySelector('.cf-turnstile') ||
                document.querySelector('[data-sitekey]')?.className?.includes('cf-turnstile') ||
                window.turnstile) {
                protections.hasTurnstile = true;
            }
            
            // Check for Arkose
            if (document.querySelector('#arkose-frame') ||
                document.querySelector('[data-enforcement-token]') ||
                window.arkose) {
                protections.hasArkose = true;
            }
            
            // Check for Cloudflare
            if (document.querySelector('#challenge-form') ||
                document.querySelector('.cf-browser-verification') ||
                document.body?.textContent?.includes('Checking your browser')) {
                protections.hasCloudflare = true;
            }
            
            return protections;
        })();
        """
        
        let result = try await webView.evaluateJavaScript(script)
        
        guard let dict = result as? [String: Bool] else {
            return (false, false, false, false, false)
        }
        
        return (
            dict["hasCaptcha"] ?? false,
            dict["hasHCaptcha"] ?? false,
            dict["hasTurnstile"] ?? false,
            dict["hasArkose"] ?? false,
            dict["hasCloudflare"] ?? false
        )
    }
    
    private func detectEndpoints() async throws -> (login: String?, auth: String?, session: String?, payment: String?) {
        // This would require intercepting network requests
        // For now, return common patterns
        return (nil, nil, nil, nil)
    }
    
    private func addLog(_ message: String) {
        let timestamp = DateFormatter.logFormatter.string(from: Date())
        progressLog.append("[\(timestamp)] \(message)")
    }
}

extension WebScannerService: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Page loaded
    }
    
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        addLog("❌ Navigation failed: \(error.localizedDescription)")
    }
}

enum ScannerError: LocalizedError {
    case invalidURL
    case webViewNotReady
    case timeout
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .webViewNotReady:
            return "WebView not ready"
        case .timeout:
            return "Scan timeout"
        }
    }
}

extension DateFormatter {
    static let logFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()
}
