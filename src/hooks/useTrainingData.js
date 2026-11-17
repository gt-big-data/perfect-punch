import { useEffect, useState } from "react";
import { fetchSessionHistory } from "../config/sessionStore";
import { TREND_WINDOW } from "../lib/trendAnalysis";

/**
 * Loads the session on screen plus the account's history behind it.
 *
 * Shared by the dashboard and the progress page so both always describe the
 * same session and the same past average.
 *
 * @returns {{ sessionData: object|null, pastSessions: object[], loading: boolean }}
 */
export function useTrainingData({ sessionId = null, metricsData = null } = {}) {
  const [sessionData, setSessionData] = useState(null);
  const [pastSessions, setPastSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  // ---------------------------------------------------------
  // 🚀 FETCH REAL SESSION DATA (METRICS FIRST, THEN LOCALSTORAGE, THEN API)
  // ---------------------------------------------------------
  useEffect(() => {
    setLoading(true);

    async function fetchData() {
      console.log("🔍 Fetching session data...", { sessionId, metricsData });

      // 0️⃣ FIRST: Check if metrics were passed directly from analysis
      if (metricsData) {
        try {
          console.log("✅ Using metrics data from analysis:", metricsData);
          // The metrics data from the analysis is already transformed
          const metrics = Array.isArray(metricsData) ? metricsData[0] : metricsData;
          console.log("📊 Transformed metrics structure:", {
            hasSession: !!metrics.session_id,
            hasSummary: !!metrics.summary,
            hasPunchAccuracy: !!metrics.punch_accuracy,
            hasReactionTimes: !!metrics.reaction_times,
            hasDefense: !!metrics.defense
          });
          setSessionData(metrics);
          setLoading(false);
          return;
        } catch (err) {
          console.error("❌ Error processing metrics data:", err);
        }
      }

      // 1️⃣ THEN: Try loading from localStorage (for demo sessions)
      if (sessionId && sessionId.startsWith('demo-')) {
        try {
          const storedKey = `demo_session_${sessionId}`;
          const storedData = localStorage.getItem(storedKey);
          
          if (storedData) {
            const data = JSON.parse(storedData);
            console.log("✅ Loaded demo session from localStorage:", data.session_id);
            console.log("📊 Session data structure:", {
              hasSummary: !!data.summary,
              hasPunchAccuracy: !!data.punch_accuracy,
              hasReactionTimes: !!data.reaction_times,
              hasDefense: !!data.defense,
              hasTimeline: !!data.timeline,
              timelineLength: data.timeline?.length || 0
            });
            setSessionData(data);
            setLoading(false);
            return;
          } else {
            console.warn("⚠️ Demo session not found in localStorage:", storedKey);
          }
        } catch (error) {
          console.error("❌ Error loading from localStorage:", error);
        }
      }

      // 2️⃣ SECOND: If no sessionId provided, check for latest demo session
      if (!sessionId) {
        try {
          const demoKeys = Object.keys(localStorage).filter(k => k.startsWith('demo_session_'));
          if (demoKeys.length > 0) {
            // Load all sessions and sort by timestamp (newest first)
            const sessions = demoKeys.map(key => {
              try {
                const storedData = localStorage.getItem(key);
                if (storedData) {
                  const data = JSON.parse(storedData);
                  return {
                    key,
                    data,
                    timestamp: data.timestamp ? new Date(data.timestamp).getTime() : 0
                  };
                }
              } catch (e) {
                console.error(`Error parsing session ${key}:`, e);
              }
              return null;
            }).filter(s => s !== null);
            
            // Sort by timestamp descending (newest first)
            sessions.sort((a, b) => b.timestamp - a.timestamp);
            
            if (sessions.length > 0) {
              const latestSession = sessions[0].data;
              console.log("✅ Loaded latest demo session from localStorage:", latestSession.session_id);
              console.log("📊 Session timestamp:", latestSession.timestamp);
              console.log("📊 Session data structure:", {
                hasSummary: !!latestSession.summary,
                hasPunchAccuracy: !!latestSession.punch_accuracy,
                hasReactionTimes: !!latestSession.reaction_times,
                hasDefense: !!latestSession.defense,
                hasTimeline: !!latestSession.timeline,
                timelineLength: latestSession.timeline?.length || 0,
                score: latestSession.summary?.score,
                totalPunches: latestSession.summary?.total_punches
              });
              setSessionData(latestSession);
              setLoading(false);
              return;
            }
          }
        } catch (error) {
          console.error("❌ Error loading latest demo session:", error);
        }
      }

      // 3️⃣ THIRD: Try API endpoint
      try {
        const API_BASE_URL =
          import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

        let url = `${API_BASE_URL}/session/latest`;
        if (sessionId) {
          url += `?session_id=${encodeURIComponent(sessionId)}`;
        }

        const response = await fetch(url, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`Backend error: ${response.status}`);
        }

        const data = await response.json();
        console.log("📊 LOADED SESSION FROM API:", data);

        // Accept demo_001 as fallback if no real data is available
        // This allows the dashboard to display something while waiting for real game data
        if (data.session_id === "demo_001") {
          console.warn("⚠️ Backend returned demo data - this is fallback data. Play a game to see your real session data.");
        }

        setSessionData(data);
      } catch (error) {
        console.error("❌ Failed to load session data:", error);
        setSessionData(null);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [sessionId]);

  // ---------------------------------------------------------
  // 📈 LOAD THE ACCOUNT'S PAST SESSIONS (for the trend section)
  // History comes from Supabase when signed in, falling back to this
  // device's cache otherwise. The session currently on screen is dropped so
  // it can never be compared against itself, and only sessions recorded
  // *before* it count as history.
  // ---------------------------------------------------------
  useEffect(() => {
    if (!sessionData) {
      setPastSessions([]);
      return;
    }

    let cancelled = false;

    async function loadHistory() {
      try {
        const all = await fetchSessionHistory({ limit: 50 });
        if (cancelled) return;

        const currentTime = new Date(sessionData.timestamp).getTime();

        const history = all
          .filter((s) => s.session_id !== sessionData.session_id)
          .map((s) => ({
            ...s,
            sortTime: s.timestamp ? new Date(s.timestamp).getTime() : 0,
          }))
          // If the current session has no usable timestamp, keep every stored
          // session rather than silently reporting "no history".
          .filter((s) => !Number.isFinite(currentTime) || s.sortTime < currentTime)
          .sort((a, b) => b.sortTime - a.sortTime)
          .slice(0, TREND_WINDOW);

        console.log(`📈 Loaded ${history.length} past session(s) for trend comparison`);
        setPastSessions(history);
      } catch (error) {
        console.error("❌ Error loading past sessions:", error);
        if (!cancelled) setPastSessions([]);
      }
    }

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [sessionData]);

  return { sessionData, pastSessions, loading };
}
