# Manifold Hub - Xcode Project Setup Guide

## Creating the Xcode Project

Since this is a SwiftUI app, you'll need to create an Xcode project. Follow these steps:

### Option 1: Create New Project in Xcode

1. Open Xcode
2. File → New → Project
3. Select **iOS** → **App**
4. Configure:
   - Product Name: `ManifoldHub`
   - Team: Your development team
   - Organization Identifier: `com.yourcompany` (or your domain)
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Storage: **SwiftData**
   - Minimum Deployment: **iOS 17.0**
5. Click **Next** and choose a location

### Option 2: Use Swift Package Manager

The project includes a `Package.swift` file. You can use it as a Swift Package:

```bash
swift package generate-xcodeproj
```

## Adding Files to Xcode

After creating the project, add all files from this directory:

1. **Models/** - All Swift model files
2. **Views/** - All SwiftUI view files  
3. **Services/** - All service files
4. **ManifoldHubApp.swift** - App entry point
5. **ContentView.swift** - Main content view
6. **Info.plist** - App configuration
7. **ManifoldHub.entitlements** - Keychain entitlements

### File Organization

In Xcode, organize files into groups:
- `Models/` group
- `Views/` group  
- `Services/` group
- `Resources/` group (Info.plist, entitlements)

## Configuration

### 1. Enable Keychain Access

1. Select your project in Xcode
2. Go to **Signing & Capabilities**
3. Click **+ Capability**
4. Add **Keychain Sharing**
5. Ensure the entitlements file is properly configured

### 2. Set Minimum iOS Version

1. Select your project target
2. Go to **General** tab
3. Set **Minimum Deployments** to **iOS 17.0**

### 3. Configure Info.plist

The `Info.plist` includes:
- App Transport Security settings (allows arbitrary loads for testing)
- Supported orientations
- Bundle identifiers

### 4. Build Settings

Ensure these build settings:
- **Swift Language Version**: Swift 6
- **iOS Deployment Target**: 17.0
- **Swift Data**: Enabled

## Running the App

1. Select a simulator or connected device
2. Press **Cmd+R** to build and run
3. The app will launch with example profiles pre-loaded

## Troubleshooting

### SwiftData Issues

If you see SwiftData errors:
- Ensure iOS 17.0+ deployment target
- Check that all models conform to `Identifiable`
- Verify `@Model` macro is available (requires Swift 5.9+)

### Keychain Issues

If Keychain access fails:
- Verify entitlements file is added to target
- Check Keychain Sharing capability is enabled
- Ensure bundle identifier matches entitlements

### WKWebView Issues

If web views don't load:
- Check Info.plist has `NSAppTransportSecurity` configured
- Verify network permissions if testing on device
- Check console for JavaScript errors

## Project Structure

```
ManifoldHub/
├── ManifoldHubApp.swift
├── ContentView.swift
├── Models/
│   ├── Profile.swift
│   ├── SiteProfile.swift
│   ├── Credential.swift
│   └── AutomationRun.swift
├── Views/
│   ├── ProfileListView.swift
│   ├── AddProfileView.swift
│   ├── EditProfileView.swift
│   ├── ScannerView.swift
│   ├── CredentialListView.swift
│   ├── AddCredentialView.swift
│   ├── EditCredentialView.swift
│   └── AutomationView.swift
├── Services/
│   ├── KeychainService.swift
│   ├── WebScannerService.swift
│   ├── AutomationService.swift
│   └── HumanBehaviorSimulator.swift
├── Info.plist
├── ManifoldHub.entitlements
└── README.md
```

## Next Steps

1. Build and run the app
2. Test profile creation
3. Test site scanning
4. Test credential storage
5. Test automation runs

For questions or issues, refer to the main README.md file.
