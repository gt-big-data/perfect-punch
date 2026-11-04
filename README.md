# PerfectPunch Dashboard

A real-time boxing analysis platform that uses computer vision to track punches, analyze form, and provide detailed performance metrics through an interactive dashboard.

## Features

### 🥊 Real-Time Boxing Analysis
- **Camera-Based Tracking**: Uses MediaPipe Pose Detection to track your movements
- **Target System**: Spawns targets (Jab, Hook, Uppercut) that you can hit
- **Demo Mode**: Works without backend - saves session data to localStorage
- **Score Tracking**: Real-time score updates as you hit targets

### 📊 Interactive Dashboard
- **Performance Metrics**: Score, Average Punch Speed, Reaction Time, Accuracy, Critical Prevention, Total Punches
- **Visualizations**: 
  - Punch Accuracy by Type (Bar Chart)
  - Reaction Times by Punch Type (Bar Chart)
  - Defense Breakdown (Pie Chart)
  - Performance Over Session Timeline (Line Chart)
- **Session History**: Automatically loads your latest session data

## Tech Stack

### Frontend
- **React** 19.1.1 with Vite
- **Recharts** for data visualization
- **MediaPipe** for pose detection
- **Tailwind CSS** for styling
- **React Router** for navigation

### Backend
- **FastAPI** for API endpoints
- **WebSocket** support for real-time game updates
- **Azure Database for PostgreSQL** for game-session persistence
- **Supabase Auth** for user authentication
- **MediaPipe** for pose analysis

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- Python 3.11+
- Camera access (for webcam)

### Frontend Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Start development server:**
```bash
npm run dev
```

3. **Open browser:**
The app will be available at `http://localhost:5173`

### Backend Setup (Optional)

The app works in **demo mode** without the backend, but for full functionality:

1. **Create virtual environment:**
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. **Install Python dependencies:**
```bash
pip install -r requirements.txt
```

3. **Start FastAPI server:**
```bash
uvicorn perfectpunch_backend.main:app --reload
```

Run the command from the repository root. The backend will be available at
`http://localhost:8000`.

### PostgreSQL Setup

Set the backend-only `DATABASE_URL` environment variable to the Azure PostgreSQL
connection string. Keep this value out of frontend `VITE_*` variables and source
control. The backend requires TLS when connecting.

Apply the database migrations in order from the repository root, using the
project's Python PostgreSQL driver:

```powershell
python -m perfectpunch_backend.db.apply_migrations
```

Migration 003 organizes session summaries in `game_sessions`, flattened metric
values and descriptions in `session_metrics`, and per-punch-type metrics or game
attempts in `punches`. Existing JSON-backed sessions can be moved into the
structured columns and tables by running:

```powershell
python -m perfectpunch_backend.db.backfill_sessions
```

Supabase remains configured for authentication only. Azure resource provisioning
and FastAPI App Service deployment are not part of this code setup.

## How to Use

### Playing a Game

1. **Start the app** and navigate to Landing Page
2. **Click "Start Analysis"** to begin a game session
3. **Allow camera access** when prompted
4. **Hit targets** that appear on screen with your fists
5. **Watch your score** increase and timer count down
6. **Click "End Game"** when finished

### Viewing Your Dashboard

After ending a game:
- Automatically navigates to Dashboard
- Shows your session data:
  - Score and total punches
  - Performance metrics
  - Visual charts and graphs
  - Timeline of your session

### Demo Mode

If the backend is not available, the app automatically switches to **demo mode**:
- Game works with local camera
- Session data saves to browser localStorage
- Dashboard loads from localStorage
- Full functionality without server

## Project Structure

```
perfectpunch-dashboard/
├── src/
│   ├── pages/
│   │   ├── CameraMirror.jsx      # Camera view with game logic
│   │   ├── DashboardPage.jsx     # Analytics dashboard
│   │   ├── LandingPage.jsx       # Landing/home page
│   │   ├── LoginPage.jsx         # User authentication
│   │   └── SignupPage.jsx        # User registration
│   ├── contexts/
│   │   └── AuthContext.jsx       # Authentication context
│   └── App.jsx                   # Main app router
├── perfectpunch_backend/
│   ├── main.py                   # FastAPI application
│   ├── api/
│   │   └── routers/              # API route handlers
│   ├── services/                 # Business logic services
│   └── game/                     # Game management
└── public/                       # Static assets
```

## Data Flow

1. **Game Session Starts**: Camera initializes, targets spawn
2. **Hits Detected**: MediaPipe tracks pose, detects target hits
3. **Score Updates**: Real-time score and metrics calculated
4. **Session Ends**: Data saved to localStorage (demo) or backend
5. **Dashboard Loads**: Displays session metrics and visualizations

## Session Data Format

Sessions are saved with the following structure:
```json
{
  "session_id": "demo-1234567890",
  "timestamp": "2025-11-18T20:04:00.000Z",
  "summary": {
    "score": 120,
    "avg_velocity": 6.5,
    "avg_reaction_time": 245,
    "accuracy": 85.5,
    "critical_prevention": 75.0,
    "total_punches": 12
  },
  "punch_accuracy": {
    "jab": 90,
    "hook": 85,
    "uppercut": 82
  },
  "reaction_times": {
    "jab": 210,
    "hook": 250,
    "uppercut": 275
  },
  "defense": {
    "blocked": 0,
    "dodged": 3,
    "hit": 12
  },
  "timeline": [
    { "t": 5, "velocity": 5.5, "accuracy": 80 },
    { "t": 10, "velocity": 6.0, "accuracy": 85 },
    ...
  ]
}
```

## Environment Variables

Create a `.env` file for configuration:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run preview` - Preview production build

## Troubleshooting

### Camera Not Working
- Ensure camera permissions are granted in browser
- Check that no other application is using the camera
- Try refreshing the page

### Dashboard Not Showing Data
- Check browser console for errors
- Verify session data exists in localStorage
- Play a new game to generate fresh data

### Backend Connection Issues
- App automatically falls back to demo mode
- Game and dashboard work without backend
- Check `VITE_API_BASE_URL` in `.env` if backend is needed

## Contributing

This is the MVP version on the `mvp` branch. For development:
1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## License

[Add your license here]
