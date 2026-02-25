//
//  AutomationRun.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import Foundation
import SwiftData

@Model
final class AutomationRun: Identifiable {
    var id: UUID
    var profileID: UUID
    var credentialID: UUID
    var startedAt: Date
    var completedAt: Date?
    var status: RunStatus
    var result: RunResult
    var logEntries: String // JSON array of log entries
    var sessionCookies: String? // JSON array of cookies
    var localStorageSnapshot: String? // JSON object
    var errorMessage: String?
    
    init(
        profileID: UUID,
        credentialID: UUID,
        status: RunStatus = .pending,
        result: RunResult = .unknown
    ) {
        self.id = UUID()
        self.profileID = profileID
        self.credentialID = credentialID
        self.startedAt = Date()
        self.completedAt = nil
        self.status = status
        self.result = result
        self.logEntries = "[]"
        self.sessionCookies = nil
        self.localStorageSnapshot = nil
        self.errorMessage = nil
    }
}

enum RunStatus: String, Codable {
    case pending = "Pending"
    case running = "Running"
    case completed = "Completed"
    case failed = "Failed"
    case cancelled = "Cancelled"
}

enum RunResult: String, Codable {
    case success = "Success"
    case declined = "Declined"
    case error = "Error"
    case challengeDetected = "Challenge Detected"
    case unknown = "Unknown"
}

struct LogEntry: Codable, Identifiable {
    let id: UUID
    let timestamp: Date
    let message: String
    let level: LogLevel
    
    init(message: String, level: LogLevel = .info) {
        self.id = UUID()
        self.timestamp = Date()
        self.message = message
        self.level = level
    }
}

enum LogLevel: String, Codable {
    case info = "Info"
    case warning = "Warning"
    case error = "Error"
    case success = "Success"
}
