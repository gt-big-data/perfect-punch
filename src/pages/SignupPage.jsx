import React, { useState } from "react";
import { supabase } from "../config/supabase";

export default function Signup({ onNavigate, onSignupSuccess }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (!supabase) {
      setMessage({
        type: "error",
        text: "Sign-up is not configured yet. Add the Supabase keys in the site settings.",
      });
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });

      if (error) {
        setMessage({ type: "error", text: error.message });
        return;
      }

      setMessage({ type: "success", text: "Account created. You can sign in now." });
      setName("");
      setEmail("");
      setPassword("");
      if (onSignupSuccess) {
        setTimeout(() => onSignupSuccess(), 900);
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Unexpected error. Check console." });
    } finally {
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

        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            style={{ marginTop: 10, width: "100%", padding: 10, background: "transparent", color: "#444", border: "1px solid #e6e9ef", borderRadius: 8, cursor: "pointer" }}
          >
            Back
          </button>
        )}

        <div style={{ fontSize: 12, color:"#666", marginTop:8 }}>A confirmation email may be sent depending on your Supabase settings.</div>

        {message && (
          <div style={{ marginTop: 12, color: message.type === "error" ? "#b00020" : "#006d32" }}>
            {message.text}
          </div>
        )}
      </form>
    </div>
  );
}
