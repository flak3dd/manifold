//
//  EditCredentialView.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import SwiftUI
import SwiftData

struct EditCredentialView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    
    @Bindable var credential: Credential
    
    @State private var password = ""
    @State private var cardNumber = ""
    @State private var cardCVV = ""
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Login") {
                    TextField("Username/Email", text: $credential.username)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                    SecureField("Password", text: $password)
                }
                
                Section("Payment Card") {
                    SecureField("Card Number", text: $cardNumber)
                        .keyboardType(.numberPad)
                    HStack {
                        TextField("Month", text: Binding(
                            get: { credential.cardExpiryMonth ?? "" },
                            set: { credential.cardExpiryMonth = $0.isEmpty ? nil : $0 }
                        ))
                        .keyboardType(.numberPad)
                        TextField("Year", text: Binding(
                            get: { credential.cardExpiryYear ?? "" },
                            set: { credential.cardExpiryYear = $0.isEmpty ? nil : $0 }
                        ))
                        .keyboardType(.numberPad)
                        SecureField("CVV", text: $cardCVV)
                            .keyboardType(.numberPad)
                    }
                }
            }
            .navigationTitle("Edit Credential")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        saveCredential()
                    }
                }
            }
            .onAppear {
                loadSensitiveData()
            }
        }
    }
    
    private func loadSensitiveData() {
        let passwordKey = KeychainService.keyForCredential(credential.id, field: "password")
        password = KeychainService.load(forKey: passwordKey) ?? ""
        
        let cardKey = KeychainService.keyForCredential(credential.id, field: "cardNumber")
        cardNumber = KeychainService.load(forKey: cardKey) ?? ""
        
        let cvvKey = KeychainService.keyForCredential(credential.id, field: "cardCVV")
        cardCVV = KeychainService.load(forKey: cvvKey) ?? ""
    }
    
    private func saveCredential() {
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
    let config = ModelConfiguration(isStoredOnDiskOnly: false)
    let container = try! ModelContainer(for: Credential.self, configurations: config)
    let credential = Credential(username: "test@example.com", password: "password")
    
    return EditCredentialView(credential: credential)
        .modelContainer(container)
}
