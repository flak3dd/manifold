//
//  ScannerView.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import SwiftUI
import SwiftData

struct ScannerView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Profile.createdAt, order: .reverse) private var profiles: [Profile]
    
    @StateObject private var scanner = WebScannerService()
    @State private var urlInput = ""
    @State private var selectedProfile: Profile?
    @State private var showingSaveDialog = false
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Input section
                VStack(spacing: 16) {
                    TextField("Enter URL to scan", text: $urlInput)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .disabled(scanner.isScanning)
                    
                    Picker("Profile", selection: $selectedProfile) {
                        Text("None").tag(nil as Profile?)
                        ForEach(profiles) { profile in
                            Text(profile.name).tag(profile as Profile?)
                        }
                    }
                    .disabled(scanner.isScanning)
                    
                    Button {
                        Task {
                            await startScan()
                        }
                    } label: {
                        if scanner.isScanning {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(.white)
                        } else {
                            Label("Scan Site", systemImage: "magnifyingglass")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)
                    .disabled(urlInput.isEmpty || scanner.isScanning)
                }
                .padding()
                .background(Color(uiColor: .systemBackground))
                
                Divider()
                
                // Progress log
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(scanner.progressLog.enumerated()), id: \.offset) { _, log in
                            Text(log)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .background(Color(uiColor: .secondarySystemBackground))
            }
            .navigationTitle("Site Scanner")
            .sheet(isPresented: $showingSaveDialog) {
                if let result = scanner.scanResult {
                    SaveSiteProfileView(siteProfile: result, profile: selectedProfile)
                }
            }
            .onChange(of: scanner.scanResult) { _, newValue in
                if newValue != nil {
                    showingSaveDialog = true
                }
            }
        }
    }
    
    private func startScan() async {
        do {
            let result = try await scanner.scan(url: urlInput)
            
            // Auto-save to selected profile if available
            if let profile = selectedProfile {
                profile.siteProfile = result
                try? modelContext.save()
            }
        } catch {
            scanner.addLog("❌ Scan failed: \(error.localizedDescription)")
        }
    }
}

struct SaveSiteProfileView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    
    let siteProfile: SiteProfile
    let profile: Profile?
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Scan Results") {
                    LabeledContent("URL", value: siteProfile.url)
                    LabeledContent("Scanned", value: siteProfile.scannedAt.formatted())
                    
                    if siteProfile.hasCaptcha || siteProfile.hasHCaptcha || 
                       siteProfile.hasTurnstile || siteProfile.hasArkose || 
                       siteProfile.hasCloudflare {
                        Label("Bot Protections Detected", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                }
                
                Section("Detected Fields") {
                    if siteProfile.usernameSelector != nil {
                        LabeledContent("Username", value: siteProfile.usernameSelector ?? "")
                    }
                    if siteProfile.passwordSelector != nil {
                        LabeledContent("Password", value: siteProfile.passwordSelector ?? "")
                    }
                    if siteProfile.cardNumberSelector != nil {
                        LabeledContent("Card Number", value: siteProfile.cardNumberSelector ?? "")
                    }
                    if siteProfile.submitButtonSelector != nil {
                        LabeledContent("Submit Button", value: siteProfile.submitButtonSelector ?? "")
                    }
                }
            }
            .navigationTitle("Scan Results")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        if profile == nil {
                            modelContext.insert(siteProfile)
                            try? modelContext.save()
                        }
                        dismiss()
                    }
                }
            }
        }
    }
}

#Preview {
    ScannerView()
        .modelContainer(for: [Profile.self, SiteProfile.self])
}
