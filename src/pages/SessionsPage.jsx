import React, { useEffect, useState } from "react";
import { useApiFetch } from "../hooks/useApiFetch";

const SessionsPage = ({ onOpen, onBack }) => {
  const apiFetch = useApiFetch();
  const [sessions, setSessions] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await apiFetch("/stats", { cache: "no-store" });
        const rows = await response.json();
        if (!cancelled) setSessions(Array.isArray(rows) ? rows : []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load sessions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [apiFetch]);

  return (
    <main style={{
      minHeight: "100vh", color: "white", padding: "40px 20px",
      background: "linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0a0a0f 100%)",
    }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <button type="button" onClick={onBack} style={backStyle}>← Home</button>
        <h1 style={{ fontSize: "2.4rem", margin: "24px 0 8px" }}>Your sessions</h1>
        <p style={{ color: "#b0b0b8", marginTop: 0 }}>Every saved round for this account.</p>
        {loading && <p>Loading…</p>}
        {error && <p style={{ color: "#ff8a80" }}>{error}</p>}
        {!loading && !error && sessions.length === 0 && <p>No saved sessions yet. Finish a round to see it here.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sessions.map((session) => {
            const when = session.timestamp ? new Date(session.timestamp) : null;
            const label = when && !Number.isNaN(when.getTime())
              ? when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
              : "Saved session";
            return (
              <button
                key={session.session_id}
                type="button"
                onClick={() => onOpen(session.session_id)}
                style={rowStyle}
              >
                <strong>{label}</strong>
                <span style={{ color: "#b0b0b8" }}>
                  Score {session.summary?.score ?? session.score ?? 0}
                  {" · "}
                  {session.summary?.total_punches ?? 0} punches
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
};

const backStyle = {
  background: "transparent", color: "white", border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 12, padding: "10px 16px", cursor: "pointer",
};

const rowStyle = {
  textAlign: "left", color: "white", background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "16px 20px",
  cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 16,
};

export default SessionsPage;
