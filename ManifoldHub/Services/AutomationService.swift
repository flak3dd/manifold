//
//  AutomationService.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import Foundation
import WebKit

@MainActor
class AutomationService: NSObject, ObservableObject {
    @Published var isRunning = false
    @Published var logEntries: [LogEntry] = []
    @Published var currentStatus: RunStatus = .pending
    @Published var result: RunResult = .unknown
    
    private var webView: WKWebView?
    private var currentRun: AutomationRun?
    
    func run(
        profile: Profile,
        credential: Credential,
        siteProfile: SiteProfile?,
        run: AutomationRun
    ) async {
        isRunning = true
        currentRun = run
        currentStatus = .running
        logEntries.removeAll()
        
        addLog("Starting automation for \(profile.name)", level: .info)
        
        // Load credentials from Keychain
        let passwordKey = KeychainService.keyForCredential(credential.id, field: "password")
        guard let password = KeychainService.load(forKey: passwordKey) else {
            addLog("Failed to load password from Keychain", level: .error)
            finishRun(result: .error, errorMessage: "Failed to load credentials")
            return
        }
        
        // Create webview
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: config)
        self.webView = webView
        webView.navigationDelegate = self
        
        addLog("Navigating to \(profile.targetURL)", level: .info)
        
        guard let url = URL(string: profile.targetURL) else {
            addLog("Invalid URL", level: .error)
            finishRun(result: .error, errorMessage: "Invalid URL")
            return
        }
        
        let request = URLRequest(url: url)
        webView.load(request)
        
        // Wait for page load
        do {
            try await waitForPageLoad()
            addLog("Page loaded", level: .success)
        } catch {
            addLog("Page load timeout", level: .error)
            finishRun(result: .error, errorMessage: "Page load timeout")
            return
        }
        
        // Check for challenges
        let hasChallenge = try await checkForChallenges()
        if hasChallenge {
            addLog("⚠️ Challenge detected (CAPTCHA/hCaptcha/Turnstile)", level: .warning)
            finishRun(result: .challengeDetected, errorMessage: "Bot protection challenge detected")
            return
        }
        
        // Fill form fields
        addLog("Filling form fields...", level: .info)
        
        if let usernameSelector = siteProfile?.usernameSelector {
            await fillField(selector: usernameSelector, value: credential.username, fieldType: "username")
        }
        
        await humanDelay(profile: profile)
        
        if let passwordSelector = siteProfile?.passwordSelector {
            await fillField(selector: passwordSelector, value: password, fieldType: "password")
        }
        
        await humanDelay(profile: profile)
        
        // Fill card fields if needed
        if let cardNumberSelector = siteProfile?.cardNumberSelector,
           let cardNumber = credential.cardNumber,
           let cardKey = KeychainService.load(forKey: KeychainService.keyForCredential(credential.id, field: "cardNumber")) {
            await fillField(selector: cardNumberSelector, value: cardKey, fieldType: "card number")
            await humanDelay(profile: profile)
        }
        
        // Submit form
        if let submitSelector = siteProfile?.submitButtonSelector {
            addLog("Clicking submit button", level: .info)
            await clickElement(selector: submitSelector)
        }
        
        // Wait for result
        try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds
        
        // Check result
        let success = try await checkForSuccess()
        
        if success {
            addLog("✅ Success! Session captured", level: .success)
            
            // Capture session
            let cookies = try? await captureCookies()
            let localStorage = try? await captureLocalStorage()
            
            finishRun(
                result: .success,
                sessionCookies: cookies,
                localStorage: localStorage
            )
        } else {
            addLog("❌ Login failed or declined", level: .error)
            finishRun(result: .declined, errorMessage: "Login failed")
        }
    }
    
    private func waitForPageLoad() async throws {
        guard let webView = webView else { throw AutomationError.webViewNotReady }
        
        var attempts = 0
        while webView.isLoading && attempts < 30 {
            try await Task.sleep(nanoseconds: 100_000_000)
            attempts += 1
        }
        
        if webView.isLoading {
            throw AutomationError.timeout
        }
        
        try await Task.sleep(nanoseconds: 1_000_000_000)
    }
    
    private func checkForChallenges() async throws -> Bool {
        guard let webView = webView else { return false }
        
        let script = """
        (function() {
            return !!(
                document.querySelector('[data-sitekey]') ||
                document.querySelector('.g-recaptcha') ||
                document.querySelector('.h-captcha') ||
                document.querySelector('.cf-turnstile') ||
                document.querySelector('#arkose-frame') ||
                document.body?.textContent?.includes('Checking your browser')
            );
        })();
        """
        
        let result = try await webView.evaluateJavaScript(script)
        return (result as? Bool) ?? false
    }
    
    private func fillField(selector: String, value: String, fieldType: String) async {
        guard let webView = webView else { return }
        
        let simulator = HumanBehaviorSimulator()
        let typingSpeed = simulator.getTypingSpeed(for: .medium) // Use profile level
        
        addLog("Filling \(fieldType)...", level: .info)
        
        let script = """
        (function() {
            const el = document.querySelector('\(selector)');
            if (!el) return false;
            el.focus();
            el.value = '';
            return true;
        })();
        """
        
        do {
            let ready = try await webView.evaluateJavaScript(script) as? Bool ?? false
            if !ready { return }
            
            // Type with human-like behavior
            for char in value {
                let delay = simulator.getCharDelay(for: .medium)
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                
                let charScript = """
                (function() {
                    const el = document.querySelector('\(selector)');
                    if (el) {
                        el.value += '\(char)';
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                })();
                """
                try? await webView.evaluateJavaScript(charScript)
            }
            
            addLog("Human typing \(fieldType) (entropy \(String(format: "%.2f", simulator.getEntropy())))", level: .info)
        } catch {
            addLog("Failed to fill \(fieldType): \(error.localizedDescription)", level: .error)
        }
    }
    
    private func clickElement(selector: String) async {
        guard let webView = webView else { return }
        
        let script = """
        (function() {
            const el = document.querySelector('\(selector)');
            if (el) {
                el.click();
                return true;
            }
            return false;
        })();
        """
        
        do {
            let clicked = try await webView.evaluateJavaScript(script) as? Bool ?? false
            if !clicked {
                addLog("Failed to click element", level: .error)
            }
        } catch {
            addLog("Failed to click: \(error.localizedDescription)", level: .error)
        }
    }
    
    private func checkForSuccess() async throws -> Bool {
        guard let webView = webView else { return false }
        
        // Check URL change or success indicators
        let script = """
        (function() {
            const url = window.location.href;
            const bodyText = document.body?.textContent?.toLowerCase() || '';
            
            // Success indicators
            if (url.includes('/dashboard') || url.includes('/home') || 
                url.includes('/account') || bodyText.includes('welcome') ||
                bodyText.includes('success')) {
                return true;
            }
            
            // Failure indicators
            if (bodyText.includes('invalid') || bodyText.includes('incorrect') ||
                bodyText.includes('declined') || bodyText.includes('error')) {
                return false;
            }
            
            return null; // Unknown
        })();
        """
        
        let result = try await webView.evaluateJavaScript(script)
        
        if let success = result as? Bool {
            return success
        }
        
        // Fallback: check if we're still on login page
        let currentURL = webView.url?.absoluteString ?? ""
        return !currentURL.contains("/login") && !currentURL.contains("/signin")
    }
    
    private func captureCookies() async throws -> String {
        guard let webView = webView else { return "[]" }
        
        let script = """
        (function() {
            return document.cookie.split(';').map(c => {
                const [name, value] = c.trim().split('=');
                return { name: name, value: value || '' };
            });
        })();
        """
        
        let cookies = try await webView.evaluateJavaScript(script)
        
        if let jsonData = try? JSONSerialization.data(withJSONObject: cookies as Any),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            return jsonString
        }
        
        return "[]"
    }
    
    private func captureLocalStorage() async throws -> String {
        guard let webView = webView else { return "{}" }
        
        let script = """
        (function() {
            const storage = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) {
                    storage[key] = localStorage.getItem(key);
                }
            }
            return storage;
        })();
        """
        
        let storage = try await webView.evaluateJavaScript(script)
        
        if let jsonData = try? JSONSerialization.data(withJSONObject: storage as Any),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            return jsonString
        }
        
        return "{}"
    }
    
    private func humanDelay(profile: Profile) async {
        let delay = HumanBehaviorSimulator().getDelay(for: profile.simulationLevel)
        try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
    }
    
    private func finishRun(
        result: RunResult,
        sessionCookies: String? = nil,
        localStorage: String? = nil,
        errorMessage: String? = nil
    ) {
        isRunning = false
        currentStatus = .completed
        self.result = result
        
        if let run = currentRun {
            run.status = .completed
            run.result = result
            run.completedAt = Date()
            run.errorMessage = errorMessage
            run.sessionCookies = sessionCookies
            run.localStorageSnapshot = localStorage
            
            // Save log entries
            if let jsonData = try? JSONEncoder().encode(logEntries),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                run.logEntries = jsonString
            }
        }
    }
    
    private func addLog(_ message: String, level: LogLevel = .info) {
        let entry = LogEntry(message: message, level: level)
        logEntries.append(entry)
    }
}

extension AutomationService: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Navigation complete
    }
    
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        addLog("Navigation failed: \(error.localizedDescription)", level: .error)
    }
}

enum AutomationError: LocalizedError {
    case webViewNotReady
    case timeout
    
    var errorDescription: String? {
        switch self {
        case .webViewNotReady:
            return "WebView not ready"
        case .timeout:
            return "Operation timeout"
        }
    }
}
