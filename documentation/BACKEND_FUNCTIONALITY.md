# What the Backend Does Now

## Overview
The backend is a FastAPI server that manages game sessions, processes punch detection, and stores session data.

## Main Functions

### 1. **Game Session Management** (`/game/sessions/*`)
- **Create Session**: `POST /game/sessions` - Creates a new game session
- **Start Session**: `POST /game/sessions/{id}/start` - Starts a game session
- **End Session**: `POST /game/sessions/{id}/end` - Ends a session and saves to PostgreSQL
- **Get Session**: `GET /game/sessions/{id}` - Retrieves session info
- **Get Stats**: `GET /game/sessions/{id}/stats` - Gets current game statistics

### 2. **Real-Time Game Communication** (`/game/sessions/{id}/ws`)
- **WebSocket Connection**: Real-time communication between frontend and backend
- Receives pose data from camera
- Processes punch detection using ML model
- Sends target spawn events
- Sends punch results and score updates
- Sends real-time stats updates

### 3. **Dashboard Data** (`/session/latest`)
- **Get Session Data**: `GET /session/latest?session_id=xxx`
- Fetches session data from:
  1. PostgreSQL (if session was saved)
  2. In-memory game manager (if session is active)
  3. Falls back to sample data
- Formats data for dashboard display

### 4. **Punch Classification** (`/punch-classify`)
- Uses ML model to classify punch types (jab, hook, uppercut)
- Processes pose landmarks to detect punches

### 5. **Session Storage**
- **Saves to PostgreSQL**: When session ends, automatically saves:
  - Session metadata (score, accuracy, duration)
  - All punch attempts with details
  - Target statistics
  - Timestamps

## Current Flow

### When You Play a Game:

1. **Frontend calls**: `POST /game/sessions` → Creates session
2. **Frontend calls**: `POST /game/sessions/{id}/start` → Starts game
3. **Frontend connects**: WebSocket to `/game/sessions/{id}/ws`
4. **Frontend sends**: Pose data every frame via WebSocket
5. **Backend processes**: 
   - Detects punches from pose data
   - Spawns targets
   - Validates hits
   - Updates score
6. **Frontend calls**: `POST /game/sessions/{id}/end` → Ends game
7. **Backend saves**: Session data to PostgreSQL
8. **Dashboard calls**: `GET /session/latest?session_id={id}` → Gets saved data

## What Happens Without Backend

If backend is not running:
- Frontend uses **demo mode**
- Saves to **localStorage** instead of PostgreSQL
- Still tracks score, targets, punches
- Dashboard reads from localStorage

## Key Features

✅ **Session Persistence**: Saves every game session to PostgreSQL
✅ **Real-Time Updates**: WebSocket for live game state  
✅ **Punch Detection**: ML model classifies punch types  
✅ **Score Tracking**: Tracks score, accuracy, reaction times  
✅ **Target Management**: Spawns and validates targets  
✅ **Dashboard Integration**: Provides formatted data for dashboard

## API Endpoints Summary

- `GET /` - Health check
- `GET /session/latest` - Get session data for dashboard
- `POST /game/sessions` - Create game session
- `POST /game/sessions/{id}/start` - Start session
- `POST /game/sessions/{id}/end` - End session (saves to PostgreSQL)
- `GET /game/sessions/{id}/stats` - Get session stats
- `WebSocket /game/sessions/{id}/ws` - Real-time game communication
