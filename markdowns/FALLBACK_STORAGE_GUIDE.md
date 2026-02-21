# Fallback Storage Guide

## Overview

When Manifold runs in **web-only mode** (without the Tauri backend), profiles are automatically saved to **localStorage** as a fallback mechanism. This allows you to continue using the application without losing your data.

## When Fallback Storage Is Used

Fallback storage activates automatically when:

1. **Tauri is not available** - Running in browser without Tauri desktop app
2. **Tauri commands fail** - Backend connection issues
3. **Development mode** - Testing without running `tauri dev`

## How It Works

### Profile Creation

**With Tauri (Normal):**
```
Create Profile → Tauri Backend → Database → Local Cache
```

**Without Tauri (Fallback):**
```
Create Profile → localStorage (browser storage)
```

When you create a profile:
1. The app tries to use Tauri's `create_profile` command
2. If Tauri is unavailable, it creates the profile locally
3. Profile is saved to browser's `localStorage`
4. You see console message: `[profileStore] Tauri unavailable, creating profile in localStorage`

### Profile Loading

When you load profiles:
1. App tries to fetch from Tauri backend
2. If Tauri unavailable, loads from localStorage
3. You see console message: `[profileStore] Tauri unavailable, loading from localStorage`

### Profile Updates

Updates work the same way:
1. Try Tauri first
2. Fall back to localStorage if unavailable
3. Changes persist across browser sessions

### Profile Deletion

Deletions happen locally first:
1. Remove from memory
2. Save updated list to localStorage
3. Attempt Tauri deletion (optional, doesn't fail if unavailable)

## Storage Details

### Storage Location
- **Key**: `manifold_profiles` in browser localStorage
- **Format**: JSON array of Profile objects
- **Persistence**: Persists until you clear browser data

### Storage Limits
- Most browsers: 5-10MB per domain
- With typical profile size (~2-5KB), you can store **1000-5000 profiles**

### Data Structure

Profiles stored include:
```typescript
{
  id: string;                    // UUID
  name: string;                  // Profile name
  fingerprint: Fingerprint;      // Browser fingerprint
  human: HumanBehavior;          // Behavior profile
  proxy_id: string | null;       // Associated proxy
  notes: string;                 // Profile notes
  tags: string[];                // Tags
  status: "idle" | "running" | "error";
  created_at: string;            // ISO timestamp
}
```

## Usage

### No Changes Required

You don't need to do anything special. The fallback works automatically:

1. Create profiles normally - they save to localStorage if Tauri unavailable
2. Load the app - profiles load from localStorage if needed
3. Update/delete profiles - changes persist

### Monitoring Fallback Usage

Check browser console (F12) for messages:

```
[profileStore] Tauri unavailable, creating profile in localStorage
[profileStore] Tauri unavailable, loading from localStorage
[profileStore] Failed to load from localStorage: [error]
```

### Accessing Stored Data

In browser DevTools:

1. Open DevTools (F12)
2. Go to **Application** or **Storage** tab
3. Click **Local Storage**
4. Find domain entry
5. Look for key: `manifold_profiles`
6. Value is a JSON array of profiles

### Syncing Back to Database

When Tauri becomes available again:

1. Load app with Tauri running
2. New profiles are saved to database
3. Existing localStorage profiles remain (can be migrated manually if needed)

**Note**: There's no automatic sync. Old localStorage data doesn't overwrite database data.

## Limitations

### Storage Limitations

- **Size**: Limited to browser's localStorage quota (~5-10MB)
- **Persistence**: Deleted when browser data is cleared
- **Scope**: Per browser/domain only
- **No Cloud Sync**: Data stays local, not synced across devices

### Feature Limitations

When using fallback storage, these features may be limited:

- ❌ **Proxy validation** - Can't validate proxies without backend
- ❌ **Fingerprint generation** - Uses fallback generation
- ❌ **Advanced features** - Features requiring backend may not work
- ⚠️ **No backup** - Only stored in browser, not synced

## Troubleshooting

### Profiles Not Saving

**Problem**: Profiles created in fallback mode don't persist

**Causes**:
- Browser localStorage disabled
- Private/incognito mode (data cleared on close)
- Storage quota exceeded
- localStorage corruption

**Solutions**:
1. Check if localStorage is enabled in browser settings
2. Exit private/incognito mode
3. Clear some browser data to free space
4. Check browser console for errors
5. Try a different browser

### Profiles Lost After Browser Restart

**Problem**: Profiles disappear when browser closes

**Causes**:
- Using private/incognito mode (clears data on close)
- Browser settings auto-clear storage
- localStorage corruption

**Solutions**:
1. Don't use private mode for persistent data
2. Check browser settings for storage auto-clear
3. Enable regular browsing mode
4. Consider using browser with persistent localStorage

### Can't Load Profiles

**Problem**: Error when loading profiles from fallback

**Causes**:
- localStorage corrupted
- Invalid JSON in storage
- Storage quota exceeded

**Solutions**:
1. Check browser console for exact error
2. Clear browser data (warning: deletes all profiles)
3. Try different browser
4. Check browser's privacy/security settings

## Performance

### Speed

- **Fallback create**: ~10ms (instant)
- **Fallback update**: ~10ms (instant)
- **Fallback delete**: ~10ms (instant)
- **Fallback load**: ~50ms (depends on profile count)

Fallback storage is actually **faster** than Tauri for local operations.

### Memory Usage

- Per profile: ~2-5KB
- 100 profiles: ~200-500KB
- 1000 profiles: ~2-5MB

## When to Use Fallback vs Tauri

### Use Fallback When

✅ Developing/testing without running Tauri
✅ Need temporary storage during browser session
✅ Don't have access to Tauri backend
✅ Testing UI without database connection

### Use Tauri When

✅ Running production desktop app
✅ Need persistent database storage
✅ Sharing profiles across devices
✅ Need advanced automation features
✅ Full feature support needed

## Migration from Fallback to Tauri

To move profiles from fallback storage to Tauri database:

1. **Export from fallback**:
   - Profiles are in browser localStorage
   - Copy the `manifold_profiles` JSON array

2. **Open DevTools** (F12):
   - Go to Storage → Local Storage
   - Find `manifold_profiles` key
   - Copy entire JSON array

3. **Import to Tauri**:
   - Run app with Tauri backend
   - Use profile import feature
   - Paste copied JSON
   - Profiles sync to database

## Security Considerations

### Data Safety

- ⚠️ **Not encrypted** - localStorage data is plain text
- ⚠️ **Browser access** - Any JavaScript can read it
- ⚠️ **No authentication** - No access control
- ⚠️ **Visible in DevTools** - Easy to inspect

### Sensitive Data

**Don't store in localStorage**:
- API keys
- Secrets
- Credentials (except username)
- Passwords in notes field

**Safe to store**:
- Profile names
- Fingerprints
- Proxy references
- Behavior settings

## Best Practices

1. **Use Tauri for Production**
   - Always use Tauri backend for real automation
   - Fallback is for development/testing only

2. **Don't Rely on Fallback for Critical Data**
   - Export regularly if needed
   - Consider it temporary storage
   - Sync to database when possible

3. **Monitor Console Messages**
   - Watch for fallback activation messages
   - May indicate missing Tauri backend
   - Check if this is intentional

4. **Clear Stale Data**
   - Old fallback data accumulates
   - Clear browser cache periodically
   - Prevents storage quota issues

5. **Test Both Modes**
   - Test with Tauri (normal mode)
   - Test without Tauri (fallback mode)
   - Ensure functionality in both

## Advanced: Debugging Storage

### Check Storage Contents

In browser console:
```javascript
// Get all profiles
JSON.parse(localStorage.getItem('manifold_profiles'))

// Get profile count
JSON.parse(localStorage.getItem('manifold_profiles')).length

// Check storage size
localStorage.getItem('manifold_profiles').length + ' characters'

// Clear storage (careful!)
localStorage.removeItem('manifold_profiles')
```

### Monitor Storage Usage

```javascript
// Check localStorage quota
navigator.storage.estimate().then(({usage, quota}) => {
  console.log(`Using ${usage} of ${quota} bytes`);
  console.log(`${((usage/quota)*100).toFixed(1)}% full`);
})
```

### Enable Storage Debugging

In console, watch for:
```
[profileStore] Tauri unavailable, creating profile in localStorage
[profileStore] Failed to save to localStorage: [error]
[profileStore] Failed to load from localStorage: [error]
```

## FAQ

**Q: Will my fallback profiles sync to database?**
A: No automatic sync. Use export/import to migrate manually.

**Q: Can I use fallback storage in production?**
A: Not recommended. Always use Tauri for production.

**Q: How much data can I store?**
A: ~5-10MB total, typically 1000-5000 profiles.

**Q: What happens when I clear browser data?**
A: All fallback profiles are deleted. Tauri database unaffected.

**Q: Can I backup fallback profiles?**
A: Yes, export JSON from DevTools or use browser's export feature.

**Q: Why is fallback slower sometimes?**
A: Large localStorage operations (10,000+ profiles) can be slow.

**Q: Is fallback data encrypted?**
A: No, it's plain text. Don't store sensitive data.

**Q: Can multiple browsers share fallback data?**
A: No, each browser has separate localStorage.

## Support

For issues with fallback storage:

1. Check browser console for error messages
2. Verify localStorage is enabled
3. Try clearing browser cache
4. Check storage quota usage
5. Test in different browser
6. Report detailed error with console output

## Related Documentation

- Vite configuration: `vite.config.js`
- Profile store: `src/lib/stores/profiles.svelte.ts`
- Storage helpers: `src/lib/stores/profiles.svelte.ts` (localStorage functions)
- Automation guide: `AUTOMATION.md`
