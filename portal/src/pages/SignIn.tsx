import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ShieldCheck, Lock, Smartphone, CheckCircle } from "lucide-react";

export default function SignIn() {
  const [searchParams] = useSearchParams();
  const isMobileFlow = searchParams.get("mobile") === "1" || localStorage.getItem("camai_mobile_auth") === "1";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [userSession, setUserSession] = useState<any>(null);

  useEffect(() => {
    if (searchParams.get("mobile") === "1") {
      localStorage.setItem("camai_mobile_auth", "1");
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUserSession(session);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setUserSession(session);
      }
    });

    return () => subscription.unsubscribe();
  }, [searchParams]);

  // Automatically open mobile deep link camai://auth#access_token=... when session is active
  useEffect(() => {
    if (userSession && isMobileFlow) {
      const at = userSession.access_token || "";
      const rt = userSession.refresh_token || "";
      const deepLink = `camai://auth#access_token=${at}&refresh_token=${rt}`;
      
      const timer = setTimeout(() => {
        window.location.href = deepLink;
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [userSession, isMobileFlow]);

  async function signInWithGoogle() {
    setBusy(true);
    setError("");
    const redirectTarget = isMobileFlow
      ? `${window.location.origin}/auth/callback?mobile=1`
      : `${window.location.origin}/auth/callback`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectTarget,
        queryParams: { access_type: "offline", prompt: "select_account" },
      },
    });
    setBusy(false);
    if (error) setError(error.message);
  }

  const handleReturnToMobile = () => {
    localStorage.removeItem("camai_mobile_auth");
    if (userSession?.access_token) {
      window.location.href = `camai://auth#access_token=${userSession.access_token}&refresh_token=${userSession.refresh_token}`;
    } else {
      window.location.href = "camai://auth";
    }
  };

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
          {userSession && isMobileFlow ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
                <CheckCircle size={32} />
              </div>
              <div>
                <h2 className="ap-pixel-bold text-lg text-[var(--ap-ink)]">Authentication Complete!</h2>
                <p className="ap-pixel text-[10px] text-[var(--ap-ink-2)] mt-1">
                  Logged in as <strong className="text-[var(--ap-ink)]">{userSession.user?.email}</strong>
                </p>
              </div>
              <button
                onClick={handleReturnToMobile}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 text-white ap-pixel text-[11px] font-bold shadow-lg active:scale-95 transition-all"
              >
                OPEN CAMAI MOBILE APP
              </button>
            </div>
          ) : (
            <>
              {/* Eyebrow & Titles */}
              <div className="text-center">
                <span className="ap-chip text-[9px] mb-3">
                  {isMobileFlow ? <Smartphone size={13} className="text-sky-400" /> : <ShieldCheck size={13} className="text-[var(--ap-accent)]" />}
                  <span>{isMobileFlow ? "MOBILE AUTHENTICATION BRIDGE" : "SECURE ACCESS PORTAL"}</span>
                </span>
                <h1 className="ap-pixel-bold text-xl text-[var(--ap-ink)] mt-2">
                  {isMobileFlow ? "Sign In to CamAI Mobile" : "Welcome Back"}
                </h1>
                <p className="ap-pixel text-[9.5px] text-[var(--ap-ink-2)] mt-1.5 leading-relaxed">
                  {isMobileFlow
                    ? "Authenticate with Google to sync your Mobile Vision AI Grid"
                    : "Sign in to manage your vision telemetry workspace"}
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
            </>
          )}
        </div>

        {/* Footer Link */}
        <div className="mt-6 flex flex-col items-center gap-2 ap-pixel text-[9.5px] text-[var(--ap-ink-2)]">
          <p>
            New to CamAI?{" "}
            <Link to="/signup" className="ap-pixel-bold text-[var(--ap-ink)] hover:text-[var(--ap-accent)] underline transition-colors">
              Create an account
            </Link>
          </p>
          <a
            href="/downloads/CamAI-Mobile-v1.0.1.apk"
            download="CamAI-Mobile-v1.0.1.apk"
            className="text-[9px] text-[var(--ap-accent)] hover:underline font-semibold flex items-center gap-1 mt-1"
          >
            <span>📱 Download Android App (.apk)</span>
          </a>
        </div>
      </div>
    </div>
  );
}
