//
//  EditProfileView.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import SwiftUI
import SwiftData

struct EditProfileView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    
    @Bindable var profile: Profile
    
    @State private var proxyPassword = ""
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Profile Details") {
                    TextField("Name", text: $profile.name)
                    TextField("Target URL", text: $profile.targetURL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                }
                
                Section("Proxy") {
                    TextField("Server", text: Binding(
                        get: { profile.proxyServer ?? "" },
                        set: { profile.proxyServer = $0.isEmpty ? nil : $0 }
                    ))
                    .autocapitalization(.none)
                    
                    TextField("Username", text: Binding(
                        get: { profile.proxyUsername ?? "" },
                        set: { profile.proxyUsername = $0.isEmpty ? nil : $0 }
                    ))
                    .autocapitalization(.none)
                    
                    SecureField("Password", text: $proxyPassword)
                }
                
                Section("Simulation Level") {
                    Picker("Level", selection: $profile.simulationLevel) {
                        ForEach(SimulationLevel.allCases, id: \.self) { level in
                            VStack(alignment: .leading) {
                                Text(level.rawValue)
                                Text(level.description)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .tag(level)
                        }
                    }
                }
            }
            .navigationTitle("Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        saveProfile()
                    }
                }
            }
            .onAppear {
                loadProxyPassword()
            }
        }
    }
    
    private func loadProxyPassword() {
        let key = KeychainService.keyForProfile(profile.id, field: "proxyPassword")
        proxyPassword = KeychainService.load(forKey: key) ?? ""
    }
    
    private func saveProfile() {
        // Save proxy password to Keychain if changed
        if !proxyPassword.isEmpty {
            let key = KeychainService.keyForProfile(profile.id, field: "proxyPassword")
            _ = KeychainService.save(proxyPassword, forKey: key)
        }
        
        do {
            try modelContext.save()
            dismiss()
        } catch {
            print("Failed to save profile: \(error)")
        }
    }
}

#Preview {
    let config = ModelConfiguration(isStoredOnDiskOnly: false)
    let container = try! ModelContainer(for: Profile.self, configurations: config)
    let profile = Profile(name: "Test", targetURL: "https://example.com")
    
    return EditProfileView(profile: profile)
        .modelContainer(container)
}
