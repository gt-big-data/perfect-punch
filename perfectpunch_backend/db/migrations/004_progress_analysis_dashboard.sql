-- 004_progress_analysis_dashboard.sql

-- Ordering key for a user's history. session_timestamp is nullable and
-- created_at can lag behind the real session time, so fall back in that order.
CREATE INDEX IF NOT EXISTS game_sessions_user_ordered_idx
    ON game_sessions (user_id, (COALESCE(session_timestamp, end_time, created_at)) DESC, id DESC);

-- One row per session with the values the dashboard cards, trend charts and
-- session-history table need. Averages, personal bests and percent changes are
-- deliberately not stored. They depend on which session is being viewed, so the
-- API derives them from this view (previous 10 sessions for the same user).
-- Accuracy is 0-100. Reaction is milliseconds. Shares are ratios from 0 to 1.
-- speed_raw is average_punch_speed as stored, except a stored 0 becomes NULL.
-- Live games currently write 0 because no speed is measured, and a real average
-- of exactly 0 is not plausible. Remove the NULLIF once the game records speed.
-- Defense counts and shares are NULL for live sessions. Live games write
-- blocked as 0 and hit_count as the player's own successful punches, so those
-- numbers are not defense data. Remove the CASE once live games record defense.
-- target_hit_rate comes from the live-game payload (targets_hit / targets_spawned)
-- and is NULL for sessions that did not store those fields.
CREATE OR REPLACE VIEW v_session_summary AS
SELECT
    id,
    session_id,
    user_id,
    COALESCE(session_timestamp, end_time, created_at)                AS ordered_at,
    punches_thrown,
    correct_punches,
    average_accuracy                                                 AS accuracy,
    NULLIF(average_punch_speed, 0)                                   AS speed_raw,
    average_reaction_time_ms                                         AS reaction_ms,
    (session_data->>'targets_hit')::float8
        / NULLIF((session_data->>'targets_spawned')::float8, 0)      AS target_hit_rate,
    CASE WHEN session_data->'targets_spawned' IS NULL THEN blocked_count END AS blocked_count,
    CASE WHEN session_data->'targets_spawned' IS NULL THEN dodged_count END  AS dodged_count,
    CASE WHEN session_data->'targets_spawned' IS NULL THEN hit_count END AS hit_count,
    CASE WHEN session_data->'targets_spawned' IS NULL
         THEN blocked_count::float8 / NULLIF(blocked_count + dodged_count + hit_count, 0) END AS blocked_share,
    CASE WHEN session_data->'targets_spawned' IS NULL
         THEN dodged_count::float8  / NULLIF(blocked_count + dodged_count + hit_count, 0) END AS dodged_share,
    CASE WHEN session_data->'targets_spawned' IS NULL
         THEN hit_count::float8     / NULLIF(blocked_count + dodged_count + hit_count, 0) END AS hit_share,
    -- Added at the end of the column list so the view can be replaced safely.
    -- session_source is live when the payload carries targets_spawned (a live
    -- camera game), analysis when no session_data was stored (metrics payload).
    CASE
        WHEN session_data->'targets_spawned' IS NOT NULL THEN 'live'
        WHEN session_data IS NULL THEN 'analysis'
        ELSE 'other'
    END                                                              AS session_source,
    (session_data->>'targets_hit')::integer                          AS targets_hit,
    (session_data->>'targets_spawned')::integer                      AS targets_spawned
FROM game_sessions;

-- Per session and punch type accuracy / reaction / speed for the two by-type charts.
-- The save path writes either aggregate rows (analysis payloads with metrics) or
-- attempt rows (live games), never both for one session, so the two branches
-- below do not overlap. Attempt rows are rolled up here. response_time below 20
-- is treated as seconds and converted to ms, matching _millis in the service.
CREATE OR REPLACE VIEW v_session_punch_type_stats AS
SELECT
    g.user_id,
    g.session_id,
    COALESCE(g.session_timestamp, g.end_time, g.created_at) AS ordered_at,
    lower(p.punch_type)                                      AS punch_type,
    p.punch_accuracy                                         AS accuracy,
    p.reaction_time_ms                                       AS reaction_ms,
    NULLIF(p.punch_speed, 0)                                 AS speed_raw
FROM punches p
JOIN game_sessions g ON g.session_id = p.session_id
WHERE p.record_kind = 'aggregate'
UNION ALL
SELECT
    g.user_id,
    g.session_id,
    COALESCE(g.session_timestamp, g.end_time, g.created_at) AS ordered_at,
    lower(p.punch_type)                                      AS punch_type,
    AVG(CASE WHEN p.was_correct THEN 100.0 ELSE 0.0 END)     AS accuracy,
    AVG(CASE WHEN p.response_time < 20 THEN p.response_time * 1000 ELSE p.response_time END) AS reaction_ms,
    AVG(NULLIF(p.punch_speed, 0))                            AS speed_raw
FROM punches p
JOIN game_sessions g ON g.session_id = p.session_id
WHERE p.record_kind = 'attempt'
GROUP BY g.user_id, g.session_id, COALESCE(g.session_timestamp, g.end_time, g.created_at), lower(p.punch_type);