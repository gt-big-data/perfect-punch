ALTER TABLE game_sessions
    ALTER COLUMN session_data DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS fighter_id TEXT,
    ADD COLUMN IF NOT EXISTS session_timestamp TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS punches_thrown INTEGER,
    ADD COLUMN IF NOT EXISTS correct_punches INTEGER,
    ADD COLUMN IF NOT EXISTS score INTEGER,
    ADD COLUMN IF NOT EXISTS average_accuracy DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS average_reaction_time_ms DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS average_punch_speed DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS punches_avoided_percent DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS blocked_count INTEGER,
    ADD COLUMN IF NOT EXISTS dodged_count INTEGER,
    ADD COLUMN IF NOT EXISTS hit_count INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS game_sessions_session_id_uidx
    ON game_sessions (session_id);

CREATE TABLE IF NOT EXISTS session_metrics (
    session_id TEXT NOT NULL REFERENCES game_sessions (session_id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    value_path TEXT NOT NULL,
    numeric_value DOUBLE PRECISION,
    unit TEXT,
    description TEXT,
    PRIMARY KEY (session_id, category, metric_name, value_path)
);

ALTER TABLE punches
    ALTER COLUMN punch_hand DROP NOT NULL,
    ALTER COLUMN impact_force DROP NOT NULL,
    ALTER COLUMN punch_velocity DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS session_id TEXT,
    ADD COLUMN IF NOT EXISTS user_id TEXT,
    ADD COLUMN IF NOT EXISTS record_key TEXT,
    ADD COLUMN IF NOT EXISTS record_kind TEXT,
    ADD COLUMN IF NOT EXISTS punch_accuracy DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS reaction_time_ms DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS punch_speed DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS timing_perfect INTEGER,
    ADD COLUMN IF NOT EXISTS timing_good INTEGER,
    ADD COLUMN IF NOT EXISTS timing_miss INTEGER,
    ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS was_correct BOOLEAN,
    ADD COLUMN IF NOT EXISTS hit_target BOOLEAN,
    ADD COLUMN IF NOT EXISTS response_time DOUBLE PRECISION;

CREATE UNIQUE INDEX IF NOT EXISTS punches_session_record_uidx
    ON punches (session_id, record_key)
    WHERE session_id IS NOT NULL AND record_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS punches_session_id_idx
    ON punches (session_id);
