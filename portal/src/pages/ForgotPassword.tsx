import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Cctv, ArrowLeft } from "lucide-react";
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
    // Don't reveal whether the email exists — always show the same
    // confirmation, matching standard practice against account enumeration.
    if (error && error.status && error.status >= 500) return setError(error.message);
    setSent(true);
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
          <h1 className="text-lg font-semibold text-ink-1">Reset your password</h1>
          {sent ? (
            <p className="mt-3 text-sm text-ink-2">
              If an account exists for <span className="text-ink-1">{email}</span>, a password reset link has been sent.
              Check your inbox and follow the link to choose a new password.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-ink-3">Enter your account email and we'll send a reset link.</p>
              <form onSubmit={submit} className="mt-5 space-y-3">
                <input className="input" type="email" placeholder="Email" value={email}
                       onChange={(e) => setEmail(e.target.value)} required autoFocus />
                {error && <p className="text-sm text-danger">{error}</p>}
                <button className="btn-primary w-full" disabled={busy}>
                  {busy ? "Sending…" : "Send Reset Link"}
                </button>
              </form>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-sm text-ink-3">
          <Link to="/signin" className="flex items-center justify-center gap-1.5 text-accent hover:underline">
            <ArrowLeft size={13} /> Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
