import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Cctv } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function ResetPassword() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const readyRef = useRef(false);
  useEffect(() => {
    // The reset-link redirect carries a recovery token in the URL that
    // supabase-js (detectSessionInUrl: true, the default) exchanges for a
    // session automatically. onAuthStateChange fires PASSWORD_RECOVERY once
    // that's done; getSession() covers the case where it already happened
    // before this listener was attached.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        readyRef.current = true;
        setReady(true);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        readyRef.current = true;
        setReady(true);
      }
    });
    const timeout = setTimeout(() => {
      if (!readyRef.current) setInvalid(true);
    }, 5000);
    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    setDone(true);
    setTimeout(() => nav("/app"), 1500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/20 text-accent">
            <Cctv size={20} />
          </div>
          <span className="font-semibold text-ink-1">CamAI</span>
        </Link>
        <div className="card p-6">
          <h1 className="text-lg font-semibold text-ink-1">Choose a new password</h1>
          {done ? (
            <p className="mt-3 text-sm text-ok">Password updated — taking you to your dashboard…</p>
          ) : invalid && !ready ? (
            <>
              <p className="mt-3 text-sm text-danger">
                This reset link is invalid or has expired.
              </p>
              <Link to="/forgot-password" className="btn-primary mt-4 block w-full text-center">
                Request a new link
              </Link>
            </>
          ) : !ready ? (
            <p className="mt-3 text-sm text-ink-3">Verifying your reset link…</p>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-3">
              <input className="input" type="password" placeholder="New password (min 8 characters)" value={password}
                     minLength={8} onChange={(e) => setPassword(e.target.value)} required autoFocus />
              <input className="input" type="password" placeholder="Confirm new password" value={confirm}
                     onChange={(e) => setConfirm(e.target.value)} required />
              {error && <p className="text-sm text-danger">{error}</p>}
              <button className="btn-primary w-full" disabled={busy}>
                {busy ? "Updating…" : "Update Password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
