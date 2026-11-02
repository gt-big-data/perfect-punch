"""Hosted API entry point: uvicorn perfectpunch_backend.main:app."""
from dataclasses import asdict
from datetime import datetime, timezone
import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Process/App Service environment variables take precedence over the local .env.
load_dotenv()

from perfectpunch_backend.config import allowed_origins
from perfectpunch_backend.entra_auth import CurrentUser, get_current_user
from perfectpunch_backend.api.routers import game
from perfectpunch_backend.api.stats_router import router as stats_router
from perfectpunch_backend.services import game_session_service
from perfectpunch_backend.supabase_client import StorageUnavailable


class FeedbackRequest(BaseModel):
    # Fetch the owned session on the server, rather than trusting client metrics.
    session_id: str = Field(min_length=1, max_length=200)


def owned_dashboard_session(user_id: str, session_id: str | None = None):
    manager = game.game_manager
    if manager:
        if session_id:
            session = manager.get_session(session_id)
            if session and session.user_id != user_id:
                raise HTTPException(status_code=404, detail="Session not found")
        else:
            sessions = [s for s in manager.active_sessions.values() if s.user_id == user_id]
            session = max(sessions, key=lambda s: s.start_time) if sessions else None
        if session:
            return {
                "session_id": session.id,
                "user_id": session.user_id,
                "timestamp": datetime.fromtimestamp(session.start_time, timezone.utc).isoformat(),
                "summary": manager.get_session_stats(session.id),
                "punches": [asdict(attempt) for attempt in session.punch_attempts],
            }

    try:
        if session_id:
            saved = game_session_service.get_game_session(session_id, user_id)
        else:
            saved = game_session_service.get_latest_session(user_id)
    except StorageUnavailable:
        raise HTTPException(status_code=503, detail="Session storage is unavailable")
    if not saved or str(saved.get("user_id")) != user_id:
        raise HTTPException(status_code=404, detail="Session not found")
    return saved


def generate_session_feedback(session_data):
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Feedback is not configured")
    try:
        from openai import OpenAI
    except ImportError:
        raise HTTPException(status_code=503, detail="Feedback is unavailable")
    try:
        response = OpenAI(api_key=key).chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a boxing coach."},
                {"role": "user", "content": f"Analyze this session: {session_data}"},
            ],
            temperature=0.7,
        )
        return {"feedback": response.choices[0].message.content}
    except Exception:
        raise HTTPException(status_code=502, detail="Feedback service is unavailable")


def create_app():
    app = FastAPI(title="PerfectPunch API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(game.router)
    app.include_router(stats_router)

    @app.get("/")
    def root():
        return {"status": "backend running"}

    @app.get("/session/latest")
    def get_latest_session(
        session_id: str | None = Query(default=None, max_length=200),
        user: CurrentUser = Depends(get_current_user),
    ):
        return owned_dashboard_session(user.id, session_id)

    @app.post("/session/feedback")
    def feedback(request: FeedbackRequest, user: CurrentUser = Depends(get_current_user)):
        owned_session = owned_dashboard_session(user.id, request.session_id)
        return generate_session_feedback(owned_session)

    # These legacy endpoints used shared local files and a camera on the SERVER.
    # They cannot safely serve account data. The website now uses CameraMirror.
    @app.post("/session/upload")
    @app.post("/analysis/start")
    @app.get("/analysis/results")
    def legacy_local_endpoint(user: CurrentUser = Depends(get_current_user)):
        raise HTTPException(status_code=410, detail="Use the browser game and session API")

    return app


app = create_app()
