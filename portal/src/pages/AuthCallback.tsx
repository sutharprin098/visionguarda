import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Smartphone, ExternalLink, CheckCircle2, ShieldCheck } from "lucide-react";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const isMobile = localStorage.getItem("camai_mobile_auth") === "1" || searchParams.get("mobile") === "1";

  useEffect(() => {
    let mounted = true;

    async function handleCallback() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (session) {
          if (mounted) setStatus("success");

          if (isMobile) {
            const at = session.access_token || "";
            const rt = session.refresh_token || "";
            const customUrl = `camai://auth#access_token=${at}&refresh_token=${rt}`;
            
            if (mounted) setDeepLink(customUrl);

            // Auto trigger custom scheme link so native Android/iOS app opens automatically
            setTimeout(() => {
              window.location.href = customUrl;
            }, 200);
          } else {
            setTimeout(() => {
              navigate("/app", { replace: true });
            }, 800);
          }
        }
      } catch (err: any) {
        console.error("Callback error:", err);
        if (mounted) {
          setStatus("error");
          setErrorMsg(err.message || "Failed to finalize authentication");
        }
      }
    }

    handleCallback();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && mounted) {
        setStatus("success");
        if (isMobile) {
          const at = session.access_token || "";
          const rt = session.refresh_token || "";
          const customUrl = `camai://auth#access_token=${at}&refresh_token=${rt}`;
          setDeepLink(customUrl);
          window.location.href = customUrl;
        } else {
          navigate("/app", { replace: true });
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, searchParams, isMobile]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 ap-page selection:bg-[var(--ap-accent-soft)]">
      <div className="absolute inset-0 ap-grid-bg pointer-events-none" />

      <div className="relative z-10 w-full max-w-md my-12 text-center">
        <div className="mb-6 flex items-center justify-center gap-3">
          <img src="/favicon.svg" alt="CamAI" className="h-10 w-10 rounded-xl shadow-md" />
          <div className="flex flex-col text-left leading-none">
            <span className="ap-pixel-bold text-2xl tracking-tight text-[var(--ap-ink)]">CamAI</span>
            <span className="ap-pixel text-[8.5px] tracking-[0.14em] text-[var(--ap-accent)] uppercase mt-0.5">VISION INTELLIGENCE</span>
          </div>
        </div>

        <div className="ap-card p-8 shadow-2xl bg-[var(--ap-surface)] border border-[var(--ap-border)]">
          {status === "loading" && (
            <div className="space-y-4 py-4">
              <div className="w-12 h-12 mx-auto border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin" />
              <h2 className="ap-pixel-bold text-lg text-[var(--ap-ink)]">Finalizing Sign In...</h2>
              <p className="ap-pixel text-[10px] text-[var(--ap-ink-2)]">Establishing secure Vision Grid session token</p>
            </div>
          )}

          {status === "success" && (
            <div className="space-y-5 py-2">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
                <CheckCircle2 size={36} />
              </div>

              <div>
                <h2 className="ap-pixel-bold text-lg text-[var(--ap-ink)]">Authentication Complete!</h2>
                <p className="ap-pixel text-[10px] text-[var(--ap-ink-2)] mt-1">
                  {isMobile ? "Returning to CamAI Mobile App..." : "Redirecting to your Vision Studio workspace..."}
                </p>
              </div>

              {isMobile && deepLink && (
                <div className="space-y-3 pt-2">
                  <a
                    href={deepLink}
                    className="flex items-center justify-center gap-2.5 w-full py-4 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold ap-pixel text-[11px] shadow-lg active:scale-95 transition-all"
                  >
                    <Smartphone size={16} />
                    <span>OPEN CAMAI MOBILE APP</span>
                    <ExternalLink size={14} />
                  </a>

                  <a
                    href={deepLink.startsWith('camai://') ? `intent://auth#${deepLink.split('#')[1]}#Intent;scheme=camai;package=com.camai.mobile;end;` : deepLink}
                    className="ap-pixel text-[9.5px] text-sky-600 hover:text-sky-500 block mx-auto pt-1 font-semibold"
                  >
                    Try Android Intent link
                  </a>

                  <button
                    onClick={() => {
                      localStorage.removeItem("camai_mobile_auth");
                      navigate("/app");
                    }}
                    className="ap-pixel text-[9.5px] text-[var(--ap-ink-2)] hover:underline block mx-auto pt-1"
                  >
                    Continue on Web Portal instead
                  </button>
                </div>
              )}
            </div>
          )}

          {status === "error" && (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-center ap-pixel text-[10px] text-rose-700">
                {errorMsg}
              </div>
              <button
                onClick={() => navigate("/signin")}
                className="w-full py-3 px-4 rounded-xl bg-[var(--ap-surface-2)] border border-[var(--ap-border)] ap-pixel text-[10px] text-[var(--ap-ink)] hover:bg-[var(--ap-border)] transition-colors"
              >
                Back to Sign In
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
