//
//  CredentialListView.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import SwiftUI
import SwiftData

struct CredentialListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Credential.createdAt, order: .reverse) private var credentials: [Credential]
    @State private var showingAddCredential = false
    @State private var selectedCredential: Credential?
    
    var body: some View {
        NavigationStack {
            List {
                ForEach(credentials) { credential in
                    CredentialRowView(credential: credential)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            selectedCredential = credential
                        }
                }
                .onDelete(perform: deleteCredentials)
            }
            .navigationTitle("Credentials")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingAddCredential = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddCredential) {
                AddCredentialView()
            }
            .sheet(item: $selectedCredential) { credential in
                EditCredentialView(credential: credential)
            }
        }
    }
    
    private func deleteCredentials(offsets: IndexSet) {
        withAnimation {
            for index in offsets {
                let credential = credentials[index]
                
                // Delete from Keychain
                let passwordKey = KeychainService.keyForCredential(credential.id, field: "password")
                let cardKey = KeychainService.keyForCredential(credential.id, field: "cardNumber")
                let cvvKey = KeychainService.keyForCredential(credential.id, field: "cardCVV")
                
                _ = KeychainService.delete(forKey: passwordKey)
                _ = KeychainService.delete(forKey: cardKey)
                _ = KeychainService.delete(forKey: cvvKey)
                
                modelContext.delete(credential)
            }
        }
    }
}

struct CredentialRowView: View {
    let credential: Credential
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(credential.username)
                .font(.headline)
            
            HStack {
                Label("Password", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                
                if credential.cardNumber != nil {
                    Label("Card", systemImage: "creditcard.fill")
                        .font(.caption)
                        .foregroundStyle(.cyan)
                }
            }
            
            if let lastUsed = credential.lastUsedAt {
                Text("Last used: \(lastUsed.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    CredentialListView()
        .modelContainer(for: [Credential.self])
}
