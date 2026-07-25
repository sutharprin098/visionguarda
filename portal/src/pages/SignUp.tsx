import { useState } from "react";
import { Link } from "react-router-dom";
import { Building2, User, ShieldCheck, Lock } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function SignUp() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountType, setAccountType] = useState<"personal" | "organization">("personal");

  async function signUpWithGoogle() {
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/app`,
        queryParams: { access_type: "offline", prompt: "select_account", state: accountType },
      },
    });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 ap-auth-bg">
      {/* Background Grid Pattern & Ambient Glowing Blobs */}
      <div className="absolute inset-0 ap-grid-bg pointer-events-none opacity-60" />
      <div className="ap-float absolute -right-20 top-12 h-96 w-96 rounded-full bg-sky-400/20 blur-3xl pointer-events-none" />
      <div className="ap-float absolute -left-20 bottom-12 h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl pointer-events-none delay-1000" />

      <div className="relative z-10 w-full max-w-md">
        {/* Brand Header */}
        <Link to="/" className="mb-8 flex items-center justify-center gap-3 group">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-sky-600 to-indigo-600 p-0.5 shadow-lg shadow-sky-500/20 transition-transform group-hover:scale-105">
            <img src="/favicon.svg" alt="CamAI" className="h-full w-full rounded-[14px] bg-white p-1.5" />
          </div>
          <div className="flex flex-col">
            <span className="ap-pixel-bold text-xl tracking-tight text-slate-900">CamAI</span>
            <span className="text-[10px] font-semibold tracking-wider text-sky-600 uppercase">Vision Intelligence</span>
          </div>
        </Link>

        {/* Main Card */}
        <div className="rounded-3xl border border-slate-200/90 bg-white/90 p-8 shadow-2xl shadow-slate-900/10 backdrop-blur-xl transition-all">
          <div className="text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50/80 px-3 py-1 text-[11px] font-semibold text-sky-700">
              <ShieldCheck className="h-3.5 w-3.5 text-sky-600" />
              <span>GET STARTED FREE</span>
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Create Account</h1>
            <p className="mt-1.5 text-sm text-slate-600">Join CamAI vision telemetry platform</p>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            {[
              { v: "personal" as const, icon: User, label: "Personal", desc: "For individual use" },
              { v: "organization" as const, icon: Building2, label: "Organization", desc: "For teams & enterprise" },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setAccountType(o.v)}
                className={`flex flex-col items-center gap-1.5 rounded-2xl border p-4 transition-all ${
                  accountType === o.v
                    ? "border-sky-500 bg-sky-50/80 text-sky-900 shadow-sm ring-1 ring-sky-500/50"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <o.icon size={20} className={accountType === o.v ? "text-sky-600" : "text-slate-400"} />
                <div className="text-xs font-bold">{o.label}</div>
                <div className="text-[10px] text-slate-500">{o.desc}</div>
              </button>
            ))}
          </div>

          <button
            id="google-signup-btn"
            onClick={signUpWithGoogle}
            disabled={busy}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white py-3.5 px-4 text-sm font-semibold text-slate-800 shadow-sm transition-all hover:border-slate-400 hover:bg-slate-50 hover:shadow-md active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? (
              <svg className="h-5 w-5 animate-spin text-sky-600" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.638-.057-1.252-.164-1.84H9v3.48h4.844a4.14 4.14 0 01-1.796 2.717v2.258h2.908C16.659 14.08 17.64 11.842 17.64 9.2z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
            )}
            <span>{busy ? "Redirecting..." : "Sign up with Google"}</span>
          </button>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-center text-xs font-medium text-rose-700">
              {error}
            </div>
          )}

          <div className="mt-5 text-center text-xs text-slate-500">
            By signing up, you agree to CamAI Terms of Service.
          </div>
        </div>

        <p className="mt-6 text-center text-sm font-medium text-slate-600">
          Already have an account?{" "}
          <Link to="/signin" className="font-semibold text-sky-600 hover:text-sky-700 hover:underline transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

