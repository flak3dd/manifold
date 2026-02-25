//
//  ManifoldHubApp.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import SwiftUI
import SwiftData

@main
struct ManifoldHubApp: App {
    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            Profile.self,
            SiteProfile.self,
            Credential.self,
            AutomationRun.self
        ])
        let modelConfiguration = ModelConfiguration(schema: schema, isStoredOnDiskOnly: false)
        
        do {
            let container = try ModelContainer(for: schema, configurations: [modelConfiguration])
            
            // Add example data on first launch
            Task { @MainActor in
                await addExampleData(to: container)
            }
            
            return container
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
        .modelContainer(sharedModelContainer)
    }
    
    @MainActor
    private func addExampleData(to container: ModelContainer) async {
        let context = container.mainContext
        let descriptor = FetchDescriptor<Profile>()
        
        do {
            let existingProfiles = try context.fetch(descriptor)
            
            // Only add examples if no profiles exist
            guard existingProfiles.isEmpty else { return }
            
            // Example 1: PPSR
            let ppsrProfile = Profile(
                name: "PPSR Portal",
                targetURL: "https://transact.ppsr.gov.au",
                proxyServer: nil,
                proxyUsername: nil,
                proxyPassword: nil,
                simulationLevel: .high
            )
            context.insert(ppsrProfile)
            
            // Example 2: Generic
            let genericProfile = Profile(
                name: "Generic Site",
                targetURL: "https://example.com",
                proxyServer: nil,
                proxyUsername: nil,
                proxyPassword: nil,
                simulationLevel: .medium
            )
            context.insert(genericProfile)
            
            try context.save()
        } catch {
            print("Failed to add example data: \(error)")
        }
    }
}
