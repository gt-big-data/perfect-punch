# Session Data Flow - How New Data is Displayed

## Overview
Each camera session automatically saves data to Azure Database for PostgreSQL, and the dashboard fetches and displays new data after each session.

The `/analysis/start` endpoint also saves each record from
`session_metrics.json` to `game_sessions` when `DATABASE_URL` is configured.
Its response reports `database_saved` and `saved_session_count`. Without
`DATABASE_URL`, analysis still returns metrics but logs that persistence was
skipped.

## How It Works

### 1. **During Game Session**
- User plays the game (with or without backend)
- All punch attempts, targets hit, and timing data are tracked in real-time

### 2. **When Session Ends**
- **With Backend**: When you click "End Game", the backend saves all session data to PostgreSQL automatically
- **Demo Mode** (no backend): Session data is saved to localStorage and can be retrieved by the dashboard

### 3. **Dashboard Display**
- Dashboard first checks localStorage for demo sessions (if session_id starts with 'demo-')
- Then checks the backend API for saved PostgreSQL sessions
- Finally falls back to static sample data if neither is available
- **Each session gets its own unique session_id**, so each game session will show different data

## Data Storage

### PostgreSQL Table: `game_sessions`
The backend automatically saves to PostgreSQL with this structure:
- `session_id`: Unique ID for each session
- `user_id`: User who played
- `start_time` / `end_time`: Session timestamps
- `score`, `accuracy`, `total_punches`: Summary stats
- `punch_attempts`: Array of all punch attempts with details
- `targets_hit` / `targets_spawned`: Target statistics

### LocalStorage (Demo Mode)
- Key format: `demo_session_{session_id}`
- Stores formatted dashboard data for offline viewing

## To See New Data After Each Session:

1. **Make sure backend is running** (with `DATABASE_URL` configured):
   ```bash
   ./start_backend.sh
   ```

2. **Play a session** - The game will track all your punches, targets, and timing

3. **Click "End Game"** - This triggers:
   - Backend saves to PostgreSQL
   - Dashboard navigation with session_id

4. **Dashboard loads** - It will:
   - Fetch the session data using the session_id
   - Calculate all metrics (accuracy, reaction times, etc.)
   - Display your actual session data

## Important Notes:

- **Each session is unique** - Every time you play, you get a new session_id
- **Data persists** - Saved sessions in PostgreSQL can be viewed later
- **Demo mode works** - Even without backend, data is saved locally and dashboard will show it
- **Real-time updates** - The dashboard reflects the actual game you just played

## Troubleshooting:

If you're seeing the same data repeatedly:
1. Check if backend is running: `http://localhost:8000/health`
2. Check browser console for any errors when ending game
3. Verify `DATABASE_URL` is set in the backend `.env`
4. Check that the `game_sessions` migration has been applied to PostgreSQL
