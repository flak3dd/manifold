//
//  ContentView.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import SwiftUI

struct ContentView: View {
    @State private var selectedTab = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            ProfileListView()
                .tabItem {
                    Label("Profiles", systemImage: "person.2.fill")
                }
                .tag(0)
            
            ScannerView()
                .tabItem {
                    Label("Scanner", systemImage: "magnifyingglass")
                }
                .tag(1)
            
            CredentialListView()
                .tabItem {
                    Label("Credentials", systemImage: "key.fill")
                }
                .tag(2)
            
            AutomationView()
                .tabItem {
                    Label("Automation", systemImage: "play.circle.fill")
                }
                .tag(3)
        }
        .tint(.cyan)
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Profile.self, SiteProfile.self, Credential.self, AutomationRun.self])
}
