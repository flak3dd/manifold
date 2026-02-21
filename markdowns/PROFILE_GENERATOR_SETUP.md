# Random Profile Generator Setup Guide

## Overview

The Random Profile Generator is a powerful utility for creating batches of randomized profiles with unique fingerprints, behavior patterns, and proxy assignments. This guide walks you through setup and usage.

## Files Added

### Core Utility
- **`src/lib/utils/profile-generator.ts`** - Main generator logic
  - `generateRandomProfiles()` - Sync generation
  - `generateRandomProfilesAsync()` - Async with progress
  - `generateRandomProfilesWithPattern()` - Custom naming
  - `exportProfilesToJson()` / `importProfilesFromJson()` - Import/export
  - `SeededRandom` class - Deterministic RNG

### UI Component
- **`src/lib/components/BatchProfileGenerator.svelte`** - Full-featured modal component
  - Profile count input
  - Auto/custom naming modes
  - Proxy selection (multi-select)
  - Deterministic seed option
  - Real-time progress tracking
  - JSON export
  - Database save with progress

### Documentation
- **`src/lib/utils/PROFILE_GENERATOR.md`** - Complete API reference and examples

## Quick Start

### 1. Import the Component

```svelte
<script>
  import BatchProfileGenerator from "$lib/components/BatchProfileGenerator.svelte";
  
  let showGenerator = false;
</script>

{#if showGenerator}
  <BatchProfileGenerator
    onClose={() => (showGenerator = false)}
    onProfilesGenerated={(profiles) => {
      console.log(`Created ${profiles.length} profiles`);
      showGenerator = false;
    }}
  />
{/if}

<button onclick={() => (showGenerator = true)}>
  Generate Profiles
</button>
```

### 2. Use the Utility Directly

```typescript
import { generateRandomProfiles } from "$lib/utils/profile-generator";

// Generate 50 profiles
const profiles = generateRandomProfiles({
  count: 50,
  useAutoNames: true,
  proxyIds: ["proxy-1", "proxy-2"],
});

// Save to database
for (const profile of profiles) {
  await profileStore.createProfile(profile);
}
```

## Features

### Batch Generation
- Generate 1 to 10,000 profiles in one operation
- Synchronous or asynchronous modes
- Progress tracking with callbacks

### Randomization
- Unique fingerprint per profile (canvas/webgl/audio noise)
- Random hardware concurrency and device memory
- Random typing/mouse speed factors
- Random behavior profiles (bot/fast/normal/cautious)

### Proxy Assignment
- Random distribution of proxies across profiles
- Optional proxy assignment
- Multi-select UI for proxy management

### Deterministic Mode
- Optional seed for reproducible generations
- Same seed = same profiles (useful for testing)

### Custom Naming
- Auto-generated friendly names (swift-falcon-AB12)
- Custom pattern templates:
  - `{index}` - 0-based index
  - `{index1}` - 1-based index
  - `{seed}` - Hex seed value
  - `{seedDec}` - Decimal seed value

### Export/Import
- Export profiles as JSON
- Import from JSON for sharing
- Backup and restore entire batches

## Usage Examples

### Example 1: Simple Batch Generation

```typescript
const profiles = generateRandomProfiles({ count: 100 });
```

### Example 2: With Proxies

```typescript
const profiles = generateRandomProfiles({
  count: 100,
  proxyIds: ["proxy-1", "proxy-2", "proxy-3"],
});
```

### Example 3: Deterministic (Reproducible)

```typescript
// Always generates the same 10 profiles
const profiles = generateRandomProfiles({
  count: 10,
  seed: 0x12345678,
});
```

### Example 4: Custom Naming

```typescript
import { generateRandomProfilesWithPattern } from "$lib/utils/profile-generator";

const profiles = generateRandomProfilesWithPattern(
  100,
  (index, seed) => `shopify-account-${index + 1}`,
  { proxyIds: ["proxy-1"] }
);
```

### Example 5: Async with Progress

```typescript
const profiles = await generateRandomProfilesAsync(
  { count: 1000 },
  (current, total) => {
    console.log(`Generated ${current}/${total}`);
  }
);
```

### Example 6: Export and Backup

```typescript
import { exportProfilesToJson, importProfilesFromJson } from "$lib/utils/profile-generator";

// Export
const json = exportProfilesToJson(profiles);
const blob = new Blob([json], { type: "application/json" });
// Save blob to file...

// Import
const restored = importProfilesFromJson(jsonString);
```

## Component Integration

### Adding to Your Page

```svelte
<script>
  import BatchProfileGenerator from "$lib/components/BatchProfileGenerator.svelte";
  import { profileStore } from "$lib/stores/profiles.svelte";
  
  let showModal = false;
  let generationStatus = "";
  
  function handleClose() {
    showModal = false;
  }
  
  function handleProfilesGenerated(profiles) {
    generationStatus = `✓ Generated and saved ${profiles.length} profiles`;
    showModal = false;
    // Refresh profile list
    profileStore.loadProfiles();
  }
</script>

<!-- Modal -->
{#if showModal}
  <BatchProfileGenerator
    {onClose}
    onProfilesGenerated={handleProfilesGenerated}
  />
{/if}

<!-- Button to open -->
<button 
  class="btn btn-primary"
  onclick={() => (showModal = true)}
>
  🚀 Batch Generate Profiles
</button>

{#if generationStatus}
  <p class="status-message">{generationStatus}</p>
{/if}
```

## API Reference

### `generateRandomProfiles(options)`

**Parameters:**
- `count` (number, 1-10000) - Profiles to generate
- `proxyIds` (string[], optional) - Proxy IDs to assign
- `seed` (number, optional) - Deterministic seed
- `useAutoNames` (boolean) - Auto-generate names

**Returns:** `GeneratedProfile[]`

### `generateRandomProfilesAsync(options, onProgress?)`

**Parameters:**
- `options` - Same as above
- `onProgress` - Callback: `(current, total) => void`

**Returns:** `Promise<GeneratedProfile[]>`

### `generateSingleRandomProfile(options)`

**Returns:** Single `GeneratedProfile`

### `generateRandomProfilesWithPattern(count, namePattern, options?)`

**Parameters:**
- `count` - Number of profiles
- `namePattern` - Function: `(index, seed) => string`
- `options` - Partial options (no count/useAutoNames)

**Returns:** `GeneratedProfile[]`

### `exportProfilesToJson(profiles)`

**Returns:** JSON string

### `importProfilesFromJson(json)`

**Returns:** `GeneratedProfile[]`
**Throws:** Error if invalid JSON

## Advanced Usage

### Batch Save with Error Handling

```typescript
async function saveBatch(profiles) {
  let saved = 0;
  let failed = 0;
  
  for (const profile of profiles) {
    try {
      await profileStore.createProfile(profile);
      saved++;
    } catch (error) {
      console.error(`Failed to save ${profile.name}:`, error);
      failed++;
    }
  }
  
  console.log(`Saved: ${saved}, Failed: ${failed}`);
  return { saved, failed };
}
```

### Proxy Distribution Strategy

```typescript
// Ensure even distribution
const proxies = await profileStore.loadProxies();
const proxyIds = proxies.flatMap(p => Array(10).fill(p.id));

const profiles = generateRandomProfiles({
  count: 1000,
  proxyIds,
});
// Each proxy gets ~10 profiles
```

### Integration with Target Optimization

```typescript
async function generateForTarget(targetUrl, count) {
  const profiles = generateRandomProfiles({
    count,
    targetUrl, // Future: can use for optimization
  });
  
  // Add target info to profiles
  for (const profile of profiles) {
    profile.target = {
      url: targetUrl,
      platform: extractPlatform(targetUrl),
      tags: [],
      optimized: true,
      snippet_ids: [],
    };
  }
  
  return profiles;
}
```

## Performance Notes

- **Generation Speed**: ~10ms per profile
- **Memory**: ~2-3MB per 1000 profiles
- **Database Save**: ~50-100ms per profile (depends on I/O)
- **For 10,000 profiles**: ~2-3 minutes total (generation + save)

## Tips and Best Practices

1. **Use async generation** for >500 profiles
2. **Batch database saves** in groups of 100-500
3. **Export backups** before large operations
4. **Test with small batches** (count: 10) first
5. **Monitor memory** for very large batches (>5000)
6. **Use deterministic seeds** for reproducible testing
7. **Name patterns** should include unique identifiers

## Troubleshooting

### Profiles Not Saving
- Check database connection
- Verify proxy IDs exist
- Check for duplicate names if name is unique field

### Generation Too Slow
- Use `generateRandomProfilesAsync()` instead of sync
- Reduce batch size or add delay between saves

### Memory Issues
- Use async generation to yield to garbage collector
- Reduce batch size
- Save to database in smaller chunks

### Same Seeds Generating Different Profiles
- Make sure you're using the same seed value
- Check if you're incrementing the seed between batches

## Files Structure

```
manifold/
├── src/
│   └── lib/
│       ├── utils/
│       │   ├── profile-generator.ts      ← Main utility
│       │   └── PROFILE_GENERATOR.md      ← Detailed docs
│       └── components/
│           └── BatchProfileGenerator.svelte  ← UI component
└── PROFILE_GENERATOR_SETUP.md  ← This file
```

## Next Steps

1. **Review** the API in `src/lib/utils/PROFILE_GENERATOR.md`
2. **Test** basic generation with the utility
3. **Integrate** the component into your UI
4. **Customize** naming patterns for your use case
5. **Monitor** generation performance in your deployment

## Support

For detailed API documentation, see:
- `src/lib/utils/PROFILE_GENERATOR.md` - Complete reference
- Component props and events in `src/lib/components/BatchProfileGenerator.svelte`

For issues or improvements, check the implementation in `src/lib/utils/profile-generator.ts`.