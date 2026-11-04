# How to Get Real Data Working - Simple Steps

## The Problem
Your dashboard shows static `demo_001` data instead of your actual game data.

## Fast Solution (2 Options)

### Option 1: Use Demo Mode (Works Now - No Backend Needed)

**This already works!** Demo mode saves to localStorage.

1. **Open browser console** (F12)
2. **Clear old data**: `localStorage.clear()`
3. **Play a NEW game**:
   - Start camera
   - Hit targets (score increases)
   - Click "End Game"
4. **Check console** for:
   - "✅ Demo session data saved to localStorage"
   - "🚀 Navigating to dashboard with session_id: demo-xxxxx"
5. **Dashboard should show your data**

**If it doesn't work:**
- Check console for the session_id being passed
- Verify localStorage has the session: 
  ```javascript
  Object.keys(localStorage).filter(k => k.startsWith('demo_session_'))
  ```

### Option 2: Use Backend (For PostgreSQL Storage)

Configure `DATABASE_URL` for Azure Database for PostgreSQL, apply the migrations
documented in the README, then start the API from the repository root:

```powershell
uvicorn perfectpunch_backend.main:app --reload
```

## Recommendation

Use demo mode when no backend is needed; it saves session data to localStorage.
Use the backend when sessions need to persist in PostgreSQL.

For persistent backend storage, configure `DATABASE_URL` for Azure Database for PostgreSQL and apply the database migrations. LocalStorage remains available for development and testing.

## Test It Now

1. Clear localStorage: `localStorage.clear()` in console
2. Play a game
3. End game
4. Check dashboard - should show YOUR session_id and YOUR score

If it still shows `demo_001`, check the console logs to see what session_id the dashboard is looking for.
