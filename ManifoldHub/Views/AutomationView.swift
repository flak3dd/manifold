//
//  AutomationView.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import SwiftUI
import SwiftData

struct AutomationView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Profile.createdAt, order: .reverse) private var profiles: [Profile]
    @Query(sort: \Credential.createdAt, order: .reverse) private var credentials: [Credential]
    
    @StateObject private var automationService = AutomationService()
    @State private var selectedProfile: Profile?
    @State private var selectedCredential: Credential?
    @State private var showingRunHistory = false
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Configuration section
                Form {
                    Section("Configuration") {
                        Picker("Profile", selection: $selectedProfile) {
                            Text("Select Profile").tag(nil as Profile?)
                            ForEach(profiles) { profile in
                                Text(profile.name).tag(profile as Profile?)
                            }
                        }
                        
                        Picker("Credential", selection: $selectedCredential) {
                            Text("Select Credential").tag(nil as Credential?)
                            ForEach(credentials) { credential in
                                Text(credential.username).tag(credential as Credential?)
                            }
                        }
                    }
                    
                    if let profile = selectedProfile {
                        Section("Profile Details") {
                            LabeledContent("URL", value: profile.targetURL)
                            LabeledContent("Simulation", value: profile.simulationLevel.rawValue)
                            
                            if profile.siteProfile != nil {
                                Label("Site Profile Available", systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            } else {
                                Label("No Site Profile", systemImage: "exclamationmark.triangle")
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                }
                .frame(maxHeight: 300)
                
                Divider()
                
                // Run button
                VStack(spacing: 16) {
                    Button {
                        Task {
                            await startAutomation()
                        }
                    } label: {
                        if automationService.isRunning {
                            HStack {
                                ProgressView()
                                    .progressViewStyle(.circular)
                                    .tint(.white)
                                Text("Running...")
                            }
                        } else {
                            Label("Run Automation", systemImage: "play.circle.fill")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)
                    .disabled(
                        selectedProfile == nil ||
                        selectedCredential == nil ||
                        automationService.isRunning ||
                        selectedProfile?.siteProfile == nil
                    )
                    
                    if automationService.isRunning {
                        Button("Cancel") {
                            automationService.isRunning = false
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .padding()
                
                Divider()
                
                // Log section
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(automationService.logEntries) { entry in
                            LogEntryView(entry: entry)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .background(Color(uiColor: .secondarySystemBackground))
                
                // Result banner
                if !automationService.isRunning && automationService.result != .unknown {
                    ResultBanner(result: automationService.result)
                }
            }
            .navigationTitle("Automation")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingRunHistory = true
                    } label: {
                        Image(systemName: "clock")
                    }
                }
            }
            .sheet(isPresented: $showingRunHistory) {
                RunHistoryView()
            }
        }
    }
    
    private func startAutomation() async {
        guard let profile = selectedProfile,
              let credential = selectedCredential else {
            return
        }
        
        let run = AutomationRun(
            profileID: profile.id,
            credentialID: credential.id
        )
        
        modelContext.insert(run)
        
        do {
            try modelContext.save()
            
            await automationService.run(
                profile: profile,
                credential: credential,
                siteProfile: profile.siteProfile,
                run: run
            )
            
            // Update credential last used
            credential.lastUsedAt = Date()
            profile.lastUsedAt = Date()
            
            try? modelContext.save()
        } catch {
            print("Failed to start automation: \(error)")
        }
    }
}

struct LogEntryView: View {
    let entry: LogEntry
    
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(entry.timestamp.formatted(date: .omitted, time: .shortened))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 80, alignment: .leading)
            
            Text(entry.message)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(logColor)
        }
    }
    
    private var logColor: Color {
        switch entry.level {
        case .info: return .primary
        case .warning: return .orange
        case .error: return .red
        case .success: return .green
        }
    }
}

struct ResultBanner: View {
    let result: RunResult
    
    var body: some View {
        HStack {
            Image(systemName: resultIcon)
                .foregroundStyle(resultColor)
            Text(result.rawValue)
                .font(.headline)
                .foregroundStyle(resultColor)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(resultColor.opacity(0.1))
    }
    
    private var resultIcon: String {
        switch result {
        case .success: return "checkmark.circle.fill"
        case .declined: return "xmark.circle.fill"
        case .error: return "exclamationmark.triangle.fill"
        case .challengeDetected: return "shield.fill"
        case .unknown: return "questionmark.circle.fill"
        }
    }
    
    private var resultColor: Color {
        switch result {
        case .success: return .green
        case .declined: return .orange
        case .error: return .red
        case .challengeDetected: return .yellow
        case .unknown: return .gray
        }
    }
}

struct RunHistoryView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \AutomationRun.startedAt, order: .reverse) private var runs: [AutomationRun]
    
    var body: some View {
        NavigationStack {
            List {
                ForEach(runs) { run in
                    RunHistoryRowView(run: run)
                }
            }
            .navigationTitle("Run History")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Done") {
                        // Dismiss handled by sheet
                    }
                }
            }
        }
    }
}

struct RunHistoryRowView: View {
    let run: AutomationRun
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(run.result.rawValue)
                    .font(.headline)
                Spacer()
                Text(run.startedAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            
            if let completed = run.completedAt {
                Text("Duration: \(formatDuration(from: run.startedAt, to: completed))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            
            if let error = run.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(.vertical, 4)
    }
    
    private func formatDuration(from start: Date, to end: Date) -> String {
        let duration = end.timeIntervalSince(start)
        if duration < 60 {
            return String(format: "%.1fs", duration)
        } else {
            return String(format: "%.1fm", duration / 60)
        }
    }
}

#Preview {
    AutomationView()
        .modelContainer(for: [Profile.self, Credential.self, AutomationRun.self])
}
