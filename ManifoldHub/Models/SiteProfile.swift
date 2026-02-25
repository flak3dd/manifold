//
//  SiteProfile.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import Foundation
import SwiftData

@Model
final class SiteProfile: Identifiable {
    var id: UUID
    var url: String
    var scannedAt: Date
    
    // Field selectors (JSON strings)
    var usernameSelector: String?
    var passwordSelector: String?
    var cardNumberSelector: String?
    var cardExpiryMonthSelector: String?
    var cardExpiryYearSelector: String?
    var cardCVVSelector: String?
    var nameSelector: String?
    var submitButtonSelector: String?
    
    // Security tokens
    var csrfTokenSelector: String?
    var verificationTokenSelector: String?
    var xsrfTokenSelector: String?
    
    // Detected protections
    var hasCaptcha: Bool
    var hasHCaptcha: Bool
    var hasTurnstile: Bool
    var hasArkose: Bool
    var hasCloudflare: Bool
    
    // Important endpoints
    var loginEndpoint: String?
    var authEndpoint: String?
    var sessionEndpoint: String?
    var paymentEndpoint: String?
    
    // Raw scan data (JSON)
    var rawScanData: String?
    
    init(
        url: String,
        scannedAt: Date = Date()
    ) {
        self.id = UUID()
        self.url = url
        self.scannedAt = scannedAt
        self.hasCaptcha = false
        self.hasHCaptcha = false
        self.hasTurnstile = false
        self.hasArkose = false
        self.hasCloudflare = false
    }
}

struct FieldSelector: Codable {
    let selector: String
    let type: FieldType
    let confidence: Double
}

enum FieldType: String, Codable {
    case username
    case email
    case password
    case cardNumber
    case cardExpiryMonth
    case cardExpiryYear
    case cardCVV
    case name
    case submit
    case unknown
}
