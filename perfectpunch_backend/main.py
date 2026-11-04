from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI
import os, json, time, subprocess, sys
import logging
from datetime import datetime
import psycopg
from perfectpunch_backend.db.connection import DatabaseConfigurationError

# Load environment variables from .env (if present). Keeps secrets/config out of source.
load_dotenv()

# Create FastAPI application instance serving the backend API.
app = FastAPI(title="PerfectPunch API")

# ---- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Attempt to load optional in-process game router (provides in-memory game manager).
# If it fails, the local/demo session paths remain available.
try:
    from .api.routers import game
    from .api.routers.game import game_manager
    app.include_router(game.router)
    GAME_MANAGER_AVAILABLE = True
    print("✅ Game router loaded successfully")
except Exception as e:
    GAME_MANAGER_AVAILABLE = False
    game_manager = None
    print(f"⚠️ Error loading game router: {e}")

# Optional OpenAI client (used by the feedback/analysis route). Safe to be None.
OPENAI_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_KEY) if OPENAI_KEY else None

# -----------------------------
# Local session storage
# -----------------------------
# A simple local folder where session JSON payloads are saved when uploaded
# (used by `run_model.py` and for quick local debugging). Created if absent.
SESSIONS_DIR = "sessions"
os.makedirs(SESSIONS_DIR, exist_ok=True)

@app.post("/session/upload")
def upload_session(payload: dict):
    """Endpoint used by local clients to persist raw session payloads.

    The payload is written to `sessions/` with a timestamped filename and
    flushed to disk to avoid race conditions on quick uploads.
    """
    filename = f"{SESSIONS_DIR}/session_{int(time.time())}.json"
    with open(filename, "w") as f:
        json.dump(payload, f)
        f.flush()
        os.fsync(f.fileno())
    print(f"💾 Saved session file: {filename}")
    return {"status": "saved", "file": filename}


@app.get("/")
def root():
    """Health endpoint for quick connectivity checks."""
    return {"status": "backend running 🚀"}


# -----------------------------
# Run punch analysis (blocking subprocess)
# -----------------------------
@app.post("/analysis/start")
def start_punch_analysis():
    """Trigger a local analysis run using the camera-based analysis script.

    This endpoint spawns `perfectpunch_backend.main_python_analysis` as a
    subprocess, waits (short timeout) and then returns the generated
    `session_metrics.json`. It is intended for local/demo usage where the
    backend can access a camera. The call is blocking and returns JSON.
    """
    try:
        print("🎥 Starting punch analysis...")

        # Prepare environment: enable on-screen display by default for local runs
        env = os.environ.copy()
        env['SHOW_DISPLAY'] = 'true'

        # Run the analysis module as a separate Python process. Keep the
        # working directory at the project root so relative paths inside the
        # analysis script behave as expected.
        result = subprocess.run(
            [sys.executable, "-m", "perfectpunch_backend.main_python_analysis"],
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            timeout=120,  # 2 minute timeout to avoid hanging callers
            env=env,
            capture_output=True,
            text=True,
        )

        # If the subprocess printed errors or crashed, return a helpful message
        if result.returncode != 0:
            print(f"❌ Analysis failed with return code {result.returncode}")
            output_lines = []
            if result.stdout:
                output_lines.extend([line.strip() for line in result.stdout.splitlines() if line.strip()])
            if result.stderr:
                output_lines.extend([line.strip() for line in result.stderr.splitlines() if line.strip()])

            detail = f"Analysis failed with return code {result.returncode}"
            if output_lines:
                preferred = None
                for line in reversed(output_lines):
                    upper_line = line.upper()
                    if "FATAL" in upper_line or "ERROR" in upper_line or "TRACEBACK" in upper_line or "EXCEPTION" in upper_line:
                        preferred = line
                        break
                detail += f". Last log: {(preferred or output_lines[-1])}"

            raise HTTPException(status_code=500, detail=detail)

        print("✅ Analysis completed successfully")

        # Read back the session metrics produced by the analysis script
        metrics_file = "session_metrics.json"
        if os.path.exists(metrics_file):
            with open(metrics_file, "r") as f:
                metrics = json.load(f)
            print(f"📊 Loaded metrics from {metrics_file}")

            database_saved = False
            saved_session_count = 0
            if os.getenv("DATABASE_URL"):
                if not isinstance(metrics, list):
                    raise HTTPException(
                        status_code=500,
                        detail="session_metrics.json must contain a list of session records.",
                    )

                from perfectpunch_backend.services.game_session_service import (
                    save_game_session,
                )

                try:
                    for session in metrics:
                        if not isinstance(session, dict) or not session.get("session_id"):
                            raise HTTPException(
                                status_code=500,
                                detail="Each analysis session must contain a session_id.",
                            )

                        save_game_session({
                            **session,
                            "user_id": session.get("user_id") or "anonymous",
                            "end_time": session.get("timestamp"),
                        })
                        saved_session_count += 1
                except (DatabaseConfigurationError, psycopg.Error) as error:
                    logging.exception("Failed to save analysis session to PostgreSQL")
                    raise HTTPException(
                        status_code=503,
                        detail="Analysis completed, but its session could not be saved to PostgreSQL.",
                    ) from error

                database_saved = True
            else:
                logging.warning(
                    "Analysis completed without database persistence because DATABASE_URL is unset."
                )

            return {
                "status": "success",
                "metrics": metrics,
                "database_saved": database_saved,
                "saved_session_count": saved_session_count,
            }
        else:
            raise HTTPException(status_code=500, detail="session_metrics.json not found")

    except subprocess.TimeoutExpired:
        # Subprocess took too long — notify the caller
        raise HTTPException(status_code=500, detail="Analysis timeout - took too long")
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# -----------------------------
#  GET ANALYSIS RESULTS ENDPOINT
# -----------------------------
@app.get("/analysis/results")
def get_analysis_results():
    """Return the most recent `session_metrics.json` produced by an analysis run.

    This is a convenience read endpoint so clients can poll for results without
    re-running the analysis process.
    """
    try:
        metrics_file = "session_metrics.json"
        if os.path.exists(metrics_file):
            with open(metrics_file, "r") as f:
                metrics = json.load(f)
            return {"status": "success", "metrics": metrics}
        else:
            return {"status": "no_data", "metrics": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# -----------------------------
#  Latest saved game session
# -----------------------------
@app.get("/session/latest")
def get_latest_session(session_id: str = Query(None, description="Optional session ID to fetch")):
    """Return the most recent saved session formatted for the dashboard.

    Resolution order:
    1. PostgreSQL, when configured
    2. Local `sessions/` folder (useful for offline/dev runs)
    3. In-memory GameManager session (if the router is enabled)
    4. Static demo fallback
    """

    # Prefer PostgreSQL when configured; do not mask connection failures with demo data.
    if os.getenv("DATABASE_URL"):
        try:
            from perfectpunch_backend.services.game_session_service import (
                get_game_session,
                get_latest_session as get_latest_database_session,
            )

            saved_session = (
                get_game_session(session_id)
                if session_id
                else get_latest_database_session()
            )
        except (DatabaseConfigurationError, psycopg.Error) as error:
            logging.exception("Failed to read game session from PostgreSQL")
            raise HTTPException(
                status_code=503,
                detail="Game session could not be loaded from the configured PostgreSQL database.",
            ) from error

        if saved_session:
            return saved_session

    # Try local saved session files for offline/dev runs.
    try:
        files = [f for f in os.listdir(SESSIONS_DIR) if f.endswith(".json")]
        if files:
            latest = max(files, key=lambda x: os.path.getctime(os.path.join(SESSIONS_DIR, x)))
            path = os.path.join(SESSIONS_DIR, latest)

            with open(path) as f:
                session_data = json.load(f)

            # Only accept sessions that contain punches (basic sanity check)
            if session_data.get("total_punches", 0) > 0:
                print(f"📄 Loaded LOCAL session: {latest}")
                return session_data
    except Exception as e:
        print("⚠️ Error loading local session:", e)

    # In-memory GameManager (used by the optional game router).
    if session_id and GAME_MANAGER_AVAILABLE and game_manager:
        stats = game_manager.get_session_stats(session_id)
        session = game_manager.get_session(session_id)

        if stats and session:
            print("📄 Loaded in-memory GameManager session")
            return {
                "session_id": session_id,
                "summary": stats,
                "punches": [vars(a) for a in session.punch_attempts]
            }

    # Static demo session (used when no real data is available).
    print("⚠️ Falling back to static demo session.")
    return {
        "session_id": "demo_001",
        "timestamp": "2025-11-17T14:00:00Z",
        "summary": {
            "score": 82,
            "avg_velocity": 5.87,
            "avg_reaction_time": 242,
            "accuracy": 93.2,
            "critical_prevention": 63.1,
            "total_punches": 23
        },
        "punch_accuracy": {"jab": 91, "hook": 88, "uppercut": 94},
        "reaction_times": {"jab": 210, "hook": 250, "uppercut": 266},
        "defense": {"blocked": 28, "dodged": 36, "hit": 36},
        "timeline": [
            {"t": 5, "velocity": 6.2, "accuracy": 95},
            {"t": 10, "velocity": 5.8, "accuracy": 93},
            {"t": 15, "velocity": 6.1, "accuracy": 92},
            {"t": 20, "velocity": 5.4, "accuracy": 90},
            {"t": 25, "velocity": 5.1, "accuracy": 88}
        ]
    }


# -----------------------------
# FEEDBACK ROUTE
# -----------------------------
class SessionData(BaseModel):
    summary: dict
    punches: list

@app.post("/session/feedback")
async def generate_feedback(session: SessionData):
    if not client:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a boxing coach."},
            {"role": "user", "content": f"Analyze this: {session.json()}"}
        ],
        temperature=0.7,
    )

    return {"feedback": response.choices[0].message.content}
