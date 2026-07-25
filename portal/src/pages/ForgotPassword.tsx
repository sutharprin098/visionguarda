import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, Mail } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error && error.status && error.status >= 500) return setError(error.message);
    setSent(true);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 ap-auth-bg">
      <div className="absolute inset-0 ap-grid-bg pointer-events-none opacity-60" />
      <div className="ap-float absolute -left-20 top-12 h-96 w-96 rounded-full bg-sky-400/20 blur-3xl pointer-events-none" />

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
              <span>RECOVERY</span>
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Reset your password</h1>
            <p className="mt-1.5 text-sm text-slate-600">We'll send a secure link to your inbox</p>
          </div>

          {sent ? (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-center text-sm font-medium text-emerald-800">
              If an account exists for <span className="font-bold text-emerald-950">{email}</span>, a password reset link has been sent. Check your inbox to proceed.
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                  type="email"
                  placeholder="Enter your account email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-center text-xs font-medium text-rose-700">
                  {error}
                </div>
              )}
              <button
                className="w-full rounded-xl bg-slate-900 py-3.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-slate-800 hover:shadow-lg disabled:opacity-60"
                disabled={busy}
              >
                {busy ? "Sending…" : "Send Reset Link"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm font-medium text-slate-600">
          <Link to="/signin" className="inline-flex items-center gap-1.5 text-sky-600 hover:text-sky-700 hover:underline">
            <ArrowLeft size={15} /> Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

