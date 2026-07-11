import { FormEvent, useState } from "react";
import { Cctv, KeyRound } from "lucide-react";
import { activateWithKey } from "../lib/session";

export default function Activation({ onActivated }: { onActivated: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const err = await activateWithKey(key);
    setBusy(false);
    if (err) return setError(err);
    onActivated();
  }

  // normalize as the user types: uppercase, grouped XXXX-XXXX-XXXX after prefix
  function format(v: string) {
    const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const parts = [raw.slice(0, 3), raw.slice(3, 7), raw.slice(7, 11), raw.slice(11, 15)].filter(Boolean);
    setKey(parts.join("-"));
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[#0b0d10]">
      <div className="w-full max-w-sm px-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Cctv size={26} />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-zinc-100">Welcome</h1>
        <p className="mt-1.5 text-sm text-zinc-500">
          Enter your license key to activate this device.
          <br />
          Everything else syncs automatically.
        </p>
        <form onSubmit={submit} className="mt-6">
          <div className="relative">
            <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              autoFocus
              value={key}
              onChange={(e) => format(e.target.value)}
              placeholder="LIC-XXXX-XXXX-XXXX"
              spellCheck={false}
              className="w-full rounded-md border border-line bg-surface-2 py-2.5 pl-9 pr-3 text-center font-mono text-sm tracking-widest text-zinc-100 placeholder-zinc-600 outline-none focus:border-accent/70"
            />
          </div>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          <button
            className="btn-primary mt-4 w-full py-2.5"
            disabled={busy || key.length < 19}
          >
            {busy ? "Activating…" : "Activate"}
          </button>
        </form>
        <p className="mt-6 text-xs text-zinc-600">
          Your license is bound to this machine's encrypted hardware fingerprint.
        </p>
      </div>
    </div>
  );
}
