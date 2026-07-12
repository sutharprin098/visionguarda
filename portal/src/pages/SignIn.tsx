import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Cctv } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function SignIn() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(error.message);
    nav("/app");
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
          <h1 className="text-lg font-semibold text-ink-1">Sign in</h1>
          <p className="mt-1 text-sm text-ink-3">Welcome back to your workspace.</p>
          <form onSubmit={submit} className="mt-5 space-y-3">
            <input className="input" type="email" placeholder="Email" value={email}
                   onChange={(e) => setEmail(e.target.value)} required />
            <input className="input" type="password" placeholder="Password" value={password}
                   onChange={(e) => setPassword(e.target.value)} required />
            <div className="text-right">
              <Link to="/forgot-password" className="text-xs text-accent hover:underline">Forgot password?</Link>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-ink-3">
          No account?{" "}
          <Link to="/signup" className="text-accent hover:underline">Create one</Link>
        </p>
      </div>
    </div>
  );
}
