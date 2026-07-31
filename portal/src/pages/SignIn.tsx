import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ShieldCheck, Lock, ArrowRight } from "lucide-react";

export default function SignIn() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signInWithGoogle() {
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/app`,
        queryParams: { access_type: "offline", prompt: "select_account" },
      },
    });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 ap-page selection:bg-[var(--ap-accent-soft)]">
      {/* Background Architectural Grid Pattern */}
      <div className="absolute inset-0 ap-grid-bg pointer-events-none" />

      <div className="relative z-10 w-full max-w-md my-12">
        {/* Brand Header */}
        <Link to="/" className="mb-8 flex items-center justify-center gap-3 group">
          <img src="/favicon.svg" alt="CamAI" className="h-9 w-9 rounded-xl shadow-sm transition-transform group-hover:scale-105" />
          <div className="flex flex-col leading-none">
            <span className="ap-pixel-bold text-xl tracking-tight text-[var(--ap-ink)]">CamAI</span>
            <span className="ap-pixel text-[8px] tracking-[0.14em] text-[var(--ap-accent)] uppercase mt-0.5">VISION INTELLIGENCE</span>
          </div>
        </Link>

        {/* Glass Card */}
        <div className="ap-card p-8 shadow-xl bg-[var(--ap-surface)] border border-[var(--ap-border)]">
          {/* Eyebrow & Titles */}
          <div className="text-center">
            <span className="ap-chip text-[9px] mb-3">
              <ShieldCheck size={13} className="text-[var(--ap-accent)]" />
              <span>SECURE ACCESS PORTAL</span>
            </span>
            <h1 className="ap-pixel-bold text-xl text-[var(--ap-ink)] mt-2">Welcome Back</h1>
            <p className="ap-pixel text-[9.5px] text-[var(--ap-ink-2)] mt-1.5 leading-relaxed">
              Sign in to manage your vision telemetry workspace
            </p>
          </div>

          {/* Google Sign In Button */}
          <button
            id="google-signin-btn"
            onClick={signInWithGoogle}
            disabled={busy}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl border border-[var(--ap-border)] bg-[var(--ap-surface-2)] hover:bg-[var(--ap-border)] py-3.5 px-4 ap-pixel text-[10px] text-[var(--ap-ink)] shadow-sm transition-all active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? (
              <svg className="h-4 w-4 animate-spin text-[var(--ap-accent)]" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.638-.057-1.252-.164-1.84H9v3.48h4.844a4.14 4.14 0 01-1.796 2.717v2.258h2.908C16.659 14.08 17.64 11.842 17.64 9.2z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
            )}
            <span>{busy ? "AUTHENTICATING..." : "CONTINUE WITH GOOGLE"}</span>
          </button>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-center ap-pixel text-[9px] text-rose-700">
              {error}
            </div>
          )}

          {/* Security Note */}
          <div className="mt-6 pt-4 border-t border-[var(--ap-border)] flex items-center justify-center gap-2 ap-pixel text-[8.5px] text-[var(--ap-ink-2)]">
            <Lock size={12} className="text-[var(--ap-accent)]" />
            <span>256-BIT ENCRYPTED SINGLE SIGN-ON</span>
          </div>
        </div>

        {/* Footer Link */}
        <p className="mt-6 text-center ap-pixel text-[9.5px] text-[var(--ap-ink-2)]">
          New to CamAI?{" "}
          <Link to="/signup" className="ap-pixel-bold text-[var(--ap-ink)] hover:text-[var(--ap-accent)] underline transition-colors">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
