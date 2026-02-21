import { generateJa4Hash } from "../evasions/tls-bridge.js";

console.log("=== JA4 Hash Test ===");
const hash1 = generateJa4Hash(42);
const hash2 = generateJa4Hash(43);
console.log(`Seed 42: ${hash1}`);
console.log(`Seed 43: ${hash2}`);
console.log(`Different: ${hash1 !== hash2}`);
console.log("✅ Test completed");
