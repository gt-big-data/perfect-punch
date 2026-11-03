import React, { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

export default function Signup() {
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const supabaseRef = useRef(null);

  useEffect(() => {
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        supabaseRef.current = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      } catch (err) {
        // If createClient throws, keep ref null and log for debugging
        console.error("Failed to create Supabase client:", err);
        supabaseRef.current = null;
      }
    }
  }, [SUPABASE_URL, SUPABASE_ANON_KEY]);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, -apple-system', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 680 }}>
          <h2 style={{ marginTop: 0 }}>Supabase configuration missing</h2>
          <p style={{ color: '#444' }}>
            The VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY environment variables are not available in the frontend.
            Make sure <code>.env.local</code> exists at the project root and contains:
          </p>
          <pre style={{ background: '#f3f4f6', padding: 12, borderRadius: 6 }}>
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
          </pre>
          <p style={{ color: '#444' }}>Then restart the dev server: <code>npm run dev</code></p>
        </div>
      </div>
    );
  }

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setBusy(true);

    const supabase = supabaseRef.current;
    if (!supabase) {
      setMessage({ type: "error", text: "Supabase client not initialized. Check console." });
      setBusy(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp(
        { email, password, options: {data : {full_name: name,},}},
      );

      if (error) {
        setMessage({ type: "error", text: error.message });
        setBusy(false);
        return;
      }

      setMessage({ type: "success", text: "Success! Redirecting…" });
      setName("");
      setEmail("");
      setPassword("");
      setBusy(false);

      setTimeout(() => { window.location.href = "/"; }, 900);
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Unexpected error. Check console." });
      setBusy(false);
    }
  };

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "#f6f7fb", padding: 20
    }}>
      <form onSubmit={handleSubmit} style={{
        width: 360, background: "#fff", padding: 28, borderRadius: 10,
        boxShadow: "0 8px 30px rgba(20,20,50,0.06)"
      }}>
        <h2 style={{ margin: 0, marginBottom: 12, color: '#1a1a1a' }}>Create your PerfectPunch Account:</h2>

        <label style={{ display: "block", fontSize: 13, color: "#444", marginTop: 12 }}>Full name</label>
        <input required value={name} onChange={e => setName(e.target.value)} placeholder="Ava Smith" autoComplete="name"
          style={{ width: "100%", padding: 10, marginTop:6, borderRadius:8, border: "1px solid #e6e9ef" }} />

        <label style={{ display: "block", fontSize: 13, color: "#444", marginTop: 12 }}>Email</label>
        <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email"
          style={{ width: "100%", padding: 10, marginTop:6, borderRadius:8, border: "1px solid #e6e9ef" }} />

        <label style={{ display: "block", fontSize: 13, color: "#444", marginTop: 12 }}>Password</label>
        <input required type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" minLength={6}
          style={{ width: "100%", padding: 10, marginTop:6, borderRadius:8, border: "1px solid #e6e9ef" }} />

        <button type="submit" disabled={busy}
          style={{ marginTop: 18, width: "100%", padding: 10, background: "#0b5cff", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
          {busy ? "Signing up…" : "Sign up"}
        </button>

        <div style={{ fontSize: 12, color:"#666", marginTop:8 }}>A magic link or confirmation email may be sent depending on your Supabase settings.</div>

        {message && (
          <div style={{ marginTop: 12, color: message.type === "error" ? "#b00020" : "#006d32" }}>
            {message.text}
          </div>
        )}
      </form>
    </div>
  );
}