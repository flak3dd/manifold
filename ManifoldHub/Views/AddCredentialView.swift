//
//  AddCredentialView.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import SwiftUI
import SwiftData

struct AddCredentialView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    
    @State private var username = ""
    @State private var password = ""
    @State private var cardNumber = ""
    @State private var cardExpiryMonth = ""
    @State private var cardExpiryYear = ""
    @State private var cardCVV = ""
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Login") {
                    TextField("Username/Email", text: $username)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                    SecureField("Password", text: $password)
                }
                
                Section("Payment Card (Optional)") {
                    TextField("Card Number", text: $cardNumber)
                        .keyboardType(.numberPad)
                    HStack {
                        TextField("Month", text: $cardExpiryMonth)
                            .keyboardType(.numberPad)
                        TextField("Year", text: $cardExpiryYear)
                            .keyboardType(.numberPad)
                        TextField("CVV", text: $cardCVV)
                            .keyboardType(.numberPad)
                    }
                }
            }
            .navigationTitle("Add Credential")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saveCredential()
                    }
                    .disabled(username.isEmpty || password.isEmpty)
                }
            }
        }
    }
    
    private func saveCredential() {
        let credential = Credential(
            username: username,
            password: password,
            cardNumber: cardNumber.isEmpty ? nil : cardNumber,
            cardExpiryMonth: cardExpiryMonth.isEmpty ? nil : cardExpiryMonth,
            cardExpiryYear: cardExpiryYear.isEmpty ? nil : cardExpiryYear,
            cardCVV: cardCVV.isEmpty ? nil : cardCVV
        )
        
        modelContext.insert(credential)
        
        // Save sensitive data to Keychain
        let passwordKey = KeychainService.keyForCredential(credential.id, field: "password")
        _ = KeychainService.save(password, forKey: passwordKey)
        
        if !cardNumber.isEmpty {
            let cardKey = KeychainService.keyForCredential(credential.id, field: "cardNumber")
            _ = KeychainService.save(cardNumber, forKey: cardKey)
        }
        
        if !cardCVV.isEmpty {
            let cvvKey = KeychainService.keyForCredential(credential.id, field: "cardCVV")
            _ = KeychainService.save(cardCVV, forKey: cvvKey)
        }
        
        do {
            try modelContext.save()
            dismiss()
        } catch {
            print("Failed to save credential: \(error)")
        }
    }
}

#Preview {
    AddCredentialView()
        .modelContainer(for: [Credential.self])
}
