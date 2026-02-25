//
//  Profile.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import Foundation
import SwiftData

@Model
final class Profile: Identifiable {
    var id: UUID
    var name: String
    var targetURL: String
    var proxyServer: String?
    var proxyUsername: String?
    var proxyPassword: String? // Encrypted in Keychain
    var simulationLevel: SimulationLevel
    var status: ProfileStatus
    var createdAt: Date
    var lastUsedAt: Date?
    
    @Relationship(deleteRule: .cascade) var siteProfile: SiteProfile?
    @Relationship(deleteRule: .cascade) var automationRuns: [AutomationRun]?
    
    init(
        name: String,
        targetURL: String,
        proxyServer: String? = nil,
        proxyUsername: String? = nil,
        proxyPassword: String? = nil,
        simulationLevel: SimulationLevel = .medium,
        status: ProfileStatus = .idle
    ) {
        self.id = UUID()
        self.name = name
        self.targetURL = targetURL
        self.proxyServer = proxyServer
        self.proxyUsername = proxyUsername
        self.proxyPassword = proxyPassword
        self.simulationLevel = simulationLevel
        self.status = status
        self.createdAt = Date()
        self.lastUsedAt = nil
    }
}

enum SimulationLevel: String, Codable, CaseIterable {
    case low = "Low"
    case medium = "Medium"
    case high = "High"
    case paranoid = "Paranoid"
    
    var description: String {
        switch self {
        case .low:
            return "Basic delays only"
        case .medium:
            return "Mouse/typing variance"
        case .high:
            return "Full entropy simulation"
        case .paranoid:
            return "Maximum anti-detection"
        }
    }
    
    var delayRange: ClosedRange<Double> {
        switch self {
        case .low: return 0.1...0.3
        case .medium: return 0.2...0.8
        case .high: return 0.5...2.0
        case .paranoid: return 1.0...4.0
        }
    }
    
    var typingSpeedWPM: ClosedRange<Int> {
        switch self {
        case .low: return 60...80
        case .medium: return 40...60
        case .high: return 25...45
        case .paranoid: return 15...30
        }
    }
}

enum ProfileStatus: String, Codable {
    case idle = "Idle"
    case scanning = "Scanning"
    case running = "Running"
    case error = "Error"
}
