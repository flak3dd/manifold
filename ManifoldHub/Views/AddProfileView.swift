//
//  AddProfileView.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import SwiftUI
import SwiftData

struct AddProfileView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    
    @State private var name = ""
    @State private var targetURL = ""
    @State private var proxyServer = ""
    @State private var proxyUsername = ""
    @State private var proxyPassword = ""
    @State private var simulationLevel: SimulationLevel = .medium
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Profile Details") {
                    TextField("Name", text: $name)
                    TextField("Target URL", text: $targetURL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                }
                
                Section("Proxy (Optional)") {
                    TextField("Server", text: $proxyServer)
                        .autocapitalization(.none)
                    TextField("Username", text: $proxyUsername)
                        .autocapitalization(.none)
                    SecureField("Password", text: $proxyPassword)
                }
                
                Section("Simulation Level") {
                    Picker("Level", selection: $simulationLevel) {
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
            .navigationTitle("Add Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saveProfile()
                    }
                    .disabled(name.isEmpty || targetURL.isEmpty)
                }
            }
        }
    }
    
    private func saveProfile() {
        let profile = Profile(
            name: name,
            targetURL: targetURL,
            proxyServer: proxyServer.isEmpty ? nil : proxyServer,
            proxyUsername: proxyUsername.isEmpty ? nil : proxyUsername,
            proxyPassword: proxyPassword.isEmpty ? nil : proxyPassword,
            simulationLevel: simulationLevel
        )
        
        modelContext.insert(profile)
        
        // Save proxy password to Keychain if provided
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
    AddProfileView()
        .modelContainer(for: [Profile.self])
}
