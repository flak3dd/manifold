# Manifold Hub iOS App

A modern iOS automation tool built with SwiftUI, SwiftData, and async/await for website automation, credential testing, and session management.

## Features

### 1. Profile Management
- Create and manage browser profiles
- Configure target URLs and optional proxy settings
- Set simulation levels (Low/Medium/High/Paranoid)
- Track profile status and usage

### 2. Site Scanner
- Automatically detect login and payment form fields
- Identify security tokens (CSRF, XSRF, verification tokens)
- Detect bot protection systems (CAPTCHA, hCaptcha, Turnstile, Arkose, Cloudflare)
- Extract form selectors and save as site profiles

### 3. Credential Management
- Securely store credentials in Keychain
- Support for username/password and payment card details
- Encrypted storage for sensitive data

### 4. Automation Runner
- Run automated login/payment flows
- Human-like behavior simulation based on profile settings
- Real-time logging of automation progress
- Session capture (cookies, localStorage)
- Result tracking (Success/Declined/Error/Challenge Detected)

## Technical Stack

- **Swift 6**: Modern Swift with strict concurrency
- **SwiftUI**: Declarative UI framework
- **SwiftData**: Modern persistence framework
- **WKWebView**: Web content rendering and automation
- **Keychain Services**: Secure credential storage
- **async/await**: Modern asynchronous programming

## Project Structure

```
ManifoldHub/
├── ManifoldHubApp.swift      # App entry point
├── ContentView.swift         # Main tab view
├── Models/
│   ├── Profile.swift          # Profile model
│   ├── SiteProfile.swift      # Site scan results
│   ├── Credential.swift       # Credential model
│   └── AutomationRun.swift    # Run history
├── Views/
│   ├── ProfileListView.swift  # Profile list & management
│   ├── ScannerView.swift      # Site scanner UI
│   ├── CredentialListView.swift # Credential management
│   └── AutomationView.swift   # Automation runner
├── Services/
│   ├── KeychainService.swift  # Secure storage
│   ├── WebScannerService.swift # Site scanning logic
│   ├── AutomationService.swift # Automation execution
│   └── HumanBehaviorSimulator.swift # Human-like behavior
└── Info.plist                 # App configuration
```

## Setup

1. Open `ManifoldHub.xcodeproj` in Xcode 15+
2. Ensure deployment target is iOS 17.0+
3. Build and run on simulator or device

## Usage

1. **Create Profiles**: Add profiles with target URLs and simulation levels
2. **Scan Sites**: Use the scanner to analyze login/payment forms
3. **Add Credentials**: Store credentials securely
4. **Run Automation**: Select profile + credential and execute automation

## Security

- All sensitive data (passwords, card numbers, CVV) stored in iOS Keychain
- Proxy passwords encrypted at rest
- No network requests sent to external servers
- All processing happens locally on device

## Example Profiles

The app includes two example profiles on first launch:
- **PPSR Portal**: `https://transact.ppsr.gov.au`
- **Generic Site**: `https://example.com`

## Requirements

- iOS 17.0+
- Xcode 15.0+
- Swift 6.0+

## License

MIT License
