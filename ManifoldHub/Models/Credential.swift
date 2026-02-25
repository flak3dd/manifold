//
//  Credential.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import Foundation
import SwiftData

@Model
final class Credential: Identifiable {
    var id: UUID
    var username: String
    var password: String // Encrypted in Keychain
    var cardNumber: String? // Encrypted in Keychain
    var cardExpiryMonth: String?
    var cardExpiryYear: String?
    var cardCVV: String? // Encrypted in Keychain
    var createdAt: Date
    var lastUsedAt: Date?
    
    init(
        username: String,
        password: String,
        cardNumber: String? = nil,
        cardExpiryMonth: String? = nil,
        cardExpiryYear: String? = nil,
        cardCVV: String? = nil
    ) {
        self.id = UUID()
        self.username = username
        self.password = password
        self.cardNumber = cardNumber
        self.cardExpiryMonth = cardExpiryMonth
        self.cardExpiryYear = cardExpiryYear
        self.cardCVV = cardCVV
        self.createdAt = Date()
        self.lastUsedAt = nil
    }
}
