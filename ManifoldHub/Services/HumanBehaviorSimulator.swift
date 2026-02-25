//
//  HumanBehaviorSimulator.swift
//  Manifold Hub
//
//  Created on 2026-02-23.
//

import Foundation

struct HumanBehaviorSimulator {
    private var entropy: Double = 0.0
    
    init() {
        entropy = Double.random(in: 0.5...0.95)
    }
    
    func getDelay(for level: SimulationLevel) -> Double {
        let baseDelay = level.delayRange.lowerBound
        let variance = level.delayRange.upperBound - level.delayRange.lowerBound
        let randomFactor = Double.random(in: 0.0...1.0)
        
        return baseDelay + (variance * randomFactor)
    }
    
    func getTypingSpeed(for level: SimulationLevel) -> Int {
        let range = level.typingSpeedWPM
        return Int.random(in: range)
    }
    
    func getCharDelay(for level: SimulationLevel) -> Double {
        let wpm = getTypingSpeed(for: level)
        let charsPerSecond = Double(wpm) / 60.0 * 5.0 // Average 5 chars per word
        let baseDelay = 1.0 / charsPerSecond
        
        // Add variance
        let variance = baseDelay * 0.3
        return baseDelay + Double.random(in: -variance...variance)
    }
    
    func getEntropy() -> Double {
        return entropy
    }
    
    mutating func updateEntropy() {
        entropy = Double.random(in: 0.5...0.95)
    }
}
