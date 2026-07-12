import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { User, Building2, Copy, Check } from "lucide-react";
import clsx from "clsx";
import { supabase, invokeFn } from "../lib/supabase";

type AccountType = "personal" | "organization";
interface Keys { user_code: string; org_code: string; license_key: string }

export default function SignUp() {
  const nav = useNavigate();
  const [type, setType] = useState<AccountType>("personal");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState<Keys | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data:
          type === "personal"
            ? { account_type: "personal", full_name: name }
            : { account_type: "organization", org_name: name },
      },
    });
    if (err) {
      setBusy(false);
      return setError(err.message);
    }
    try {
      // one-time credential reveal (deleted server-side after this call)
      const res = await invokeFn<{ delivered: boolean } & Keys>("my-keys");
      if (res.delivered) setKeys(res);
      else nav("/app");
    } catch {
      nav("/app");
    }
    setBusy(false);
  }

  if (keys) return <KeysReveal keys={keys} isOrg={type === "organization"} onDone={() => nav("/app")} />;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2.5">
          <img src="/favicon.svg" alt="CamAI" className="h-9 w-9 rounded-md" />
          <span className="font-semibold text-ink-1">CamAI</span>
        </Link>
        <div className="card p-6">
          <h1 className="text-lg font-semibold text-ink-1">Create account</h1>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(
              [
                { v: "personal", icon: User, label: "Personal" },
                { v: "organization", icon: Building2, label: "Organization" },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setType(o.v)}
                className={clsx(
                  "flex flex-col items-center gap-1.5 rounded-md border p-3 text-sm transition",
                  type === o.v
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-line text-ink-2 hover:bg-surface-2",
                )}
              >
                <o.icon size={17} />
                {o.label}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <input
              className="input"
              placeholder={type === "personal" ? "Full name" : "Organization name"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input className="input" type="email" placeholder="Email" value={email}
                   onChange={(e) => setEmail(e.target.value)} required />
            <input className="input" type="password" placeholder="Password (min 8 characters)"
                   value={password} minLength={8}
                   onChange={(e) => setPassword(e.target.value)} required />
            {error && <p className="text-sm text-danger">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? "Creating…" : "Create Account"}
            </button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-ink-3">
          Already registered?{" "}
          <Link to="/signin" className="text-accent hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

function KeysReveal({ keys, isOrg, onDone }: { keys: Keys; isOrg: boolean; onDone: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-lg font-semibold text-ink-1">Your credentials</h1>
        <p className="mt-1 text-sm text-warn">
          Save these now — the license key is shown only once.
        </p>
        <div className="mt-5 space-y-3">
          <KeyRow label="User ID" value={keys.user_code} />
          <KeyRow label="Organization ID" value={keys.org_code} />
          <KeyRow label={isOrg ? "Admin License" : "License Key"} value={keys.license_key} highlight />
        </div>
        <p className="mt-4 text-xs text-ink-3">
          Use the license key to activate the CamAI Windows desktop app. You can manage and reset
          licenses anytime from the portal.
        </p>
        <button className="btn-primary mt-5 w-full" onClick={onDone}>
          Continue to Dashboard
        </button>
      </div>
    </div>
  );
}

function KeyRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={clsx("rounded-md border p-3", highlight ? "border-accent/50 bg-accent/5" : "border-line bg-surface-2")}>
      <div className="text-xs font-medium uppercase tracking-wider text-ink-3">{label}</div>
      <div className="mt-1 flex items-center justify-between">
        <code className="font-mono text-sm text-ink-1">{value}</code>
        <button
          className="text-ink-3 hover:text-ink-1"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
        </button>
      </div>
    </div>
  );
}
