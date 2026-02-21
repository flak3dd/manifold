# Random Profile Generator

Generate (x) amount of randomly generated profiles for automation with diverse fingerprints, proxies, and behavior patterns.

## Features

- **Batch Generation**: Generate 1 to 10,000 profiles at once
- **Randomized Fingerprints**: Each profile gets unique canvas noise, WebGL noise, audio noise, hardware specs
- **Proxy Assignment**: Randomly distribute proxies across generated profiles
- **Deterministic Mode**: Use seeds for reproducible profile generation
- **Custom Naming**: Auto-generated names or custom patterns with templates
- **Export/Import**: Save profiles as JSON for backup or sharing
- **Progress Tracking**: Real-time feedback during generation and saving
- **UI Component**: Full-featured Svelte component for easy integration

## API

### Core Functions

#### `generateRandomProfiles(options: RandomProfileGeneratorOptions): GeneratedProfile[]`

Generate multiple random profiles synchronously.

```typescript
import { generateRandomProfiles } from "$lib/utils/profile-generator";

// Basic usage
const profiles = generateRandomProfiles({ count: 50 });

// With proxies
const profiles = generateRandomProfiles({
  count: 50,
  proxyIds: ["proxy-1", "proxy-2", "proxy-3"],
});

// Deterministic (reproducible)
const profiles = generateRandomProfiles({
  count: 50,
  seed: 12345,
});
```

#### `generateRandomProfilesAsync(options, onProgress?): Promise<GeneratedProfile[]>`

Generate profiles asynchronously with progress callback for UI updates.

```typescript
import { generateRandomProfilesAsync } from "$lib/utils/profile-generator";

const profiles = await generateRandomProfilesAsync(
  { count: 1000, useAutoNames: true },
  (current, total) => {
    console.log(`Progress: ${current}/${total}`);
    updateProgressBar(current / total);
  }
);
```

#### `generateSingleRandomProfile(options): GeneratedProfile`

Convenience function to generate a single profile.

```typescript
import { generateSingleRandomProfile } from "$lib/utils/profile-generator";

const profile = generateSingleRandomProfile({
  proxyIds: ["proxy-1"],
  seed: 99999,
});
```

#### `generateRandomProfilesWithPattern(count, namePattern, options?): GeneratedProfile[]`

Generate profiles with custom name patterns.

```typescript
import { generateRandomProfilesWithPattern } from "$lib/utils/profile-generator";

const profiles = generateRandomProfilesWithPattern(
  100,
  (index, seed) => `shopify-account-${index + 1}`,
  { proxyIds: ["proxy-1", "proxy-2"] }
);
```

Pattern variables:
- `{index}` - Zero-based index (0, 1, 2...)
- `{index0}` - Same as {index}
- `{index1}` - One-based index (1, 2, 3...)
- `{seed}` - Hex seed value
- `{seedDec}` - Decimal seed value

#### `exportProfilesToJson(profiles): string`

Export profiles as JSON string.

```typescript
import { exportProfilesToJson } from "$lib/utils/profile-generator";

const json = exportProfilesToJson(generatedProfiles);
const blob = new Blob([json], { type: "application/json" });
// Download or save blob...
```

#### `importProfilesFromJson(json): GeneratedProfile[]`

Import profiles from JSON string.

```typescript
import { importProfilesFromJson } from "$lib/utils/profile-generator";

try {
  const profiles = importProfilesFromJson(jsonString);
} catch (e) {
  console.error("Import failed:", e.message);
}
```

## Options

### `RandomProfileGeneratorOptions`

```typescript
interface RandomProfileGeneratorOptions {
  /** Number of profiles to generate (1-10000) */
  count: number;

  /** Optional target URL to optimize profiles for */
  targetUrl?: string;

  /** Optional list of proxy IDs to randomly assign */
  proxyIds?: string[];

  /** Optional seed for deterministic randomization */
  seed?: number;

  /** Whether to use auto-generated friendly names */
  useAutoNames?: boolean;
}
```

## UI Component

### `BatchProfileGenerator.svelte`

Drop-in Svelte component for batch profile generation with full UI.

```svelte
<script>
  import BatchProfileGenerator from "$lib/components/BatchProfileGenerator.svelte";

  let showModal = false;

  function handleGenerationComplete(profiles) {
    console.log(`Generated ${profiles.length} profiles`);
    showModal = false;
  }
</script>

{#if showModal}
  <BatchProfileGenerator
    onClose={() => (showModal = false)}
    onProfilesGenerated={handleGenerationComplete}
  />
{/if}

<button onclick={() => (showModal = true)}>
  Generate Profiles
</button>
```

### Features

- Profile count input (1-10,000)
- Auto-name generation with friendly names (swift-falcon-AB12, etc.)
- Custom naming patterns with template variables
- Proxy selection (multi-select with select/deselect all)
- Deterministic seed option
- Real-time progress bars for generation and saving
- Profile preview (first 5 profiles)
- Export to JSON
- Save directly to database
- Error and success messages

## Examples

### Generate 100 Shopify automation profiles

```typescript
const profiles = generateRandomProfilesWithPattern(
  100,
  (index, seed) => `shopify-${String(index + 1).padStart(3, "0")}`,
  { proxyIds: ["proxy-1", "proxy-2", "proxy-3"] }
);
```

### Generate with specific threat level match

```typescript
const profiles = generateRandomProfiles({
  count: 50,
  targetUrl: "https://accounts.google.com",
  proxyIds: ["proxy-1"],
  useAutoNames: true,
});
```

### Reproducible generation

```typescript
// These will always generate the exact same profiles
const batch1 = generateRandomProfiles({
  count: 10,
  seed: 0xDEADBEEF,
});

const batch2 = generateRandomProfiles({
  count: 10,
  seed: 0xDEADBEEF,
});

// batch1 === batch2 (same profiles)
```

### Batch import/export

```typescript
// Export all profiles
const json = exportProfilesToJson(allProfiles);
saveToFile("profiles-backup.json", json);

// Later, import them back
const imported = importProfilesFromJson(backupJson);
for (const profile of imported) {
  await profileStore.createProfile(profile);
}
```

## Architecture

### Seeded Random Generator

The generator uses a linear congruential generator (LCG) for deterministic randomness:

```typescript
class SeededRandom {
  next(): number;           // 0-1 float
  nextInt(min, max): number; // min-max inclusive
  nextBool(prob): boolean;   // probability 0-1
  choice<T>(array): T;       // random element
  shuffle<T>(array): T[];    // Fisher-Yates
}
```

### Profile Generation Process

1. Create `SeededRandom` instance with optional seed
2. For each profile (0 to count-1):
   - Generate unique seed = `baseSeed + (index * 1000000)`
   - Generate fingerprint from seed
   - Randomly assign proxy if available
   - Generate profile name (auto or custom)
   - Randomly select behavior profile (bot/fast/normal/cautious)
3. Return array of `GeneratedProfile` objects

### Generated Profile Structure

```typescript
interface GeneratedProfile extends CreateProfilePayload {
  name: string;
  seed: number;
  proxy_id?: string;
  behavior_profile: BehaviorProfile;
  target?: ProfileTarget;
}
```

## Performance

- **Generation**: ~10ms per profile (synchronous)
- **Async generation**: Non-blocking with progress updates every 10 profiles
- **Memory**: ~2-3MB per 1000 profiles (before compression)
- **Storage**: ~1.5KB per profile in database

## Best Practices

1. **Use async generation** for >100 profiles to keep UI responsive
2. **Set seeds** for reproducible test data
3. **Distribute proxies** evenly across profiles with `proxyIds` array
4. **Export regularly** for backup and version control
5. **Validate imports** before bulk database operations
6. **Name patterns** should include index or seed for uniqueness

## Troubleshooting

### Generated profiles are too similar

**Cause**: Using same seed for multiple generations
**Solution**: Omit `seed` option or use different seeds

### Proxy assignment is uneven

**Cause**: Small proxy list with large profile count
**Solution**: Duplicate proxy IDs in `proxyIds` array, or accept randomness

### Generation takes too long

**Cause**: Using synchronous generation for large batches (>1000)
**Solution**: Use `generateRandomProfilesAsync` with progress callback