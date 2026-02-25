//
//  ProfileListView.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import SwiftUI
import SwiftData

struct ProfileListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Profile.createdAt, order: .reverse) private var profiles: [Profile]
    @State private var showingAddProfile = false
    @State private var selectedProfile: Profile?
    
    var body: some View {
        NavigationStack {
            List {
                ForEach(profiles) { profile in
                    ProfileRowView(profile: profile)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            selectedProfile = profile
                        }
                }
                .onDelete(perform: deleteProfiles)
            }
            .navigationTitle("Profiles")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingAddProfile = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddProfile) {
                AddProfileView()
            }
            .sheet(item: $selectedProfile) { profile in
                EditProfileView(profile: profile)
            }
        }
    }
    
    private func deleteProfiles(offsets: IndexSet) {
        withAnimation {
            for index in offsets {
                modelContext.delete(profiles[index])
            }
        }
    }
}

struct ProfileRowView: View {
    let profile: Profile
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(profile.name)
                    .font(.headline)
                Spacer()
                StatusBadge(status: profile.status)
            }
            
            Text(profile.targetURL)
                .font(.caption)
                .foregroundStyle(.secondary)
            
            HStack(spacing: 16) {
                Label(profile.simulationLevel.rawValue, systemImage: "slider.horizontal.3")
                    .font(.caption)
                    .foregroundStyle(.cyan)
                
                if profile.proxyServer != nil {
                    Label("Proxy", systemImage: "network")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct StatusBadge: View {
    let status: ProfileStatus
    
    var body: some View {
        Text(status.rawValue)
            .font(.caption2)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(statusColor.opacity(0.2))
            .foregroundStyle(statusColor)
            .clipShape(Capsule())
    }
    
    private var statusColor: Color {
        switch status {
        case .idle: return .gray
        case .scanning: return .blue
        case .running: return .cyan
        case .error: return .red
        }
    }
}

#Preview {
    ProfileListView()
        .modelContainer(for: [Profile.self])
}
