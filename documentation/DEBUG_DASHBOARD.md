# Debugging Dashboard Data Issues

## Quick Check List

### 1. Check Browser Console
Open browser console (F12) and look for:
- ✅ "Demo session data saved to localStorage" - means data was saved
- ✅ "Loading demo session data from localStorage" - means dashboard found your data
- ⚠️ "No demo session data found" - means data wasn't saved or wrong session_id

### 2. Check localStorage
In browser console, run:
```javascript
// See all demo sessions
Object.keys(localStorage).filter(k => k.startsWith('demo_session_'))

// See latest session data
const keys = Object.keys(localStorage).filter(k => k.startsWith('demo_session_'));
const latest = keys.sort().reverse()[0];
console.log(JSON.parse(localStorage.getItem(latest)));
```

### 3. Verify Score is Updating
- Look at the camera screen - score should increase when you hit targets
- Check console for "Target hit! Score: X" messages
- Make sure "DEMO MODE" text appears at bottom of camera view

### 4. Check Session ID Flow
The session_id should be passed from camera to dashboard:
1. Camera creates: `demo-1234567890`
2. Saves to: `localStorage.setItem('demo_session_demo-1234567890', data)`
3. Dashboard receives: `sessionId = 'demo-1234567890'`
4. Dashboard loads: `localStorage.getItem('demo_session_demo-1234567890')`

## Common Issues

### Issue: Dashboard shows same data every time
**Solution**: Each session gets a new session_id. Check that:
- You're playing a new game (not refreshing the same session)
- The session_id changes each time you start a game
- localStorage has multiple entries with different session_ids

### Issue: Score is always 0
**Possible causes**:
1. Targets aren't being hit (check hit detection)
2. Score isn't being saved (check console logs)
3. Wrong session_id being loaded (check localStorage keys)

### Issue: PostgreSQL not connected
**This is OK for demo mode.** It saves to localStorage instead.
- PostgreSQL is needed only when using the backend for persistent sessions
- Demo mode (no backend) uses localStorage
- Both work fine for displaying data

## Testing Steps

1. **Play a game**:
   - Start camera session
   - Hit some targets (score should increase)
   - Click "End Game"

2. **Check console**:
   - Should see "Demo session data saved to localStorage"
   - Should see the score value in the log

3. **Check dashboard**:
   - Should see "Loading demo session data from localStorage"
   - Should see the score you got in the game

4. **Play another game**:
   - Should get a NEW session_id
   - Should see DIFFERENT data on dashboard

## Force Refresh Dashboard Data

If dashboard shows old data:
1. Clear localStorage: `localStorage.clear()` in console
2. Play a new game
3. Check dashboard again

Or manually check what's saved:
```javascript
// In browser console
const keys = Object.keys(localStorage).filter(k => k.startsWith('demo_session_'));
keys.forEach(key => {
  const data = JSON.parse(localStorage.getItem(key));
  console.log(key, 'Score:', data.summary?.score);
});
```
