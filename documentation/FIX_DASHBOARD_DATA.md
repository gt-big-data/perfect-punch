# Why Dashboard Shows demo_001 (Static Data)

## The Problem

Your dashboard is showing `Session: demo_001 | 11/17/2025, 9:00:00 AM` which is **static fallback data**, not your actual game data.

## Root Causes

1. **Backend 404 Error**: `POST /game/sessions` returns 404
   - Game router has import errors
   - Sessions can't be created
   - Falls back to demo mode

2. **Import Errors**: 
   - `attempted relative import with no known parent package`
   - Game manager not loading properly

3. **Dashboard Fallback**:
   - Can't find your session data
   - Falls back to `/sample_session.json` (demo_001)

## What I Fixed

✅ Fixed import paths in game router  
✅ Added better error handling  
✅ Added logging to track data flow  
✅ Replaced Supabase session persistence with PostgreSQL

## How to Test Now

1. **Check browser console** when you:
   - Start a game → Should see session creation
   - End game → Should see "Demo session data saved"
   - Load dashboard → Should see "Loading demo session data"

2. **Check backend terminal** for:
   - Successful PostgreSQL session save (if backend is configured)
   - Or import errors (if still broken)

3. **Play a NEW game**:
   - Each game gets a unique session_id
   - Old sessions won't update
   - Need to play a fresh game to see new data

## Quick Debug Steps

### In Browser Console:
```javascript
// Check what sessions are saved
Object.keys(localStorage).filter(k => k.startsWith('demo_session_'))

// See the latest session
const keys = Object.keys(localStorage).filter(k => k.startsWith('demo_session_'));
const latest = keys.sort().reverse()[0];
console.log(JSON.parse(localStorage.getItem(latest)));
```

### Check if session_id is being passed:
- Look for: `🔍 Dashboard fetching data for sessionId: demo-xxxxx`
- If it shows `null` → session_id not being passed
- If it shows `demo-xxxxx` → check if that key exists in localStorage

## The Real Issue

The dashboard shows `demo_001` because:
1. It can't find your actual session data
2. Falls back to static sample data
3. This happens when:
   - session_id is null/undefined
   - localStorage doesn't have the session
   - API call fails

**Solution**: Make sure you're playing a NEW game session (not refreshing an old one), and check the console logs to see where the data flow breaks.
