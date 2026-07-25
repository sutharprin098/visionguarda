import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck, Lock } from "lucide-react";
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 ap-auth-bg">
      <div className="absolute inset-0 ap-grid-bg pointer-events-none opacity-60" />
      <div className="ap-float absolute -right-20 top-12 h-96 w-96 rounded-full bg-sky-400/20 blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-3 group">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-sky-600 to-indigo-600 p-0.5 shadow-lg shadow-sky-500/20 transition-transform group-hover:scale-105">
            <img src="/favicon.svg" alt="CamAI" className="h-full w-full rounded-[14px] bg-white p-1.5" />
          </div>
          <div className="flex flex-col">
            <span className="ap-pixel-bold text-xl tracking-tight text-slate-900">CamAI</span>
            <span className="text-[10px] font-semibold tracking-wider text-sky-600 uppercase">Vision Intelligence</span>
          </div>
        </Link>

        <div className="rounded-3xl border border-slate-200/90 bg-white/90 p-8 shadow-2xl shadow-slate-900/10 backdrop-blur-xl transition-all">
          <div className="text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50/80 px-3 py-1 text-[11px] font-semibold text-sky-700">
              <ShieldCheck className="h-3.5 w-3.5 text-sky-600" />
              <span>NEW PASSWORD</span>
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Choose a new password</h1>
          </div>

          {done ? (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-center text-sm font-medium text-emerald-800">
              Password updated — redirecting to your workspace…
            </div>
          ) : invalid && !ready ? (
            <div className="mt-6 space-y-4 text-center">
              <p className="text-sm font-medium text-rose-600">This reset link is invalid or has expired.</p>
              <Link to="/forgot-password" className="block rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white">
                Request a new link
              </Link>
            </div>
          ) : !ready ? (
            <p className="mt-6 text-center text-sm text-slate-500">Verifying your reset link…</p>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <input
                className="w-full rounded-xl border border-slate-300 bg-white py-3 px-4 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                type="password"
                placeholder="New password (min 8 characters)"
                value={password}
                minLength={8}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
              <input
                className="w-full rounded-xl border border-slate-300 bg-white py-3 px-4 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                type="password"
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-center text-xs font-medium text-rose-700">
                  {error}
                </div>
              )}
              <button
                className="w-full rounded-xl bg-slate-900 py-3.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-slate-800 hover:shadow-lg disabled:opacity-60"
                disabled={busy}
              >
                {busy ? "Updating…" : "Update Password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

