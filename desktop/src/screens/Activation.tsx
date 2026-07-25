import { FormEvent, useState } from "react";
import { KeyRound, ShieldCheck, Lock } from "lucide-react";
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

  function format(v: string) {
    const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const parts = [raw.slice(0, 3), raw.slice(3, 7), raw.slice(7, 11), raw.slice(11, 15)].filter(Boolean);
    setKey(parts.join("-"));
  }

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-slate-50 px-6">
      {/* Dynamic light background elements */}
      <div className="absolute inset-0 bg-[radial-gradient(at_10%_10%,rgba(56,189,248,0.20)_0px,transparent_50%),radial-gradient(at_90%_15%,rgba(99,102,241,0.16)_0px,transparent_50%),radial-gradient(at_50%_85%,rgba(20,184,166,0.15)_0px,transparent_50%)] pointer-events-none" />
      <div className="absolute -left-20 top-12 h-96 w-96 rounded-full bg-sky-400/20 blur-3xl pointer-events-none" />
      <div className="absolute -right-20 bottom-12 h-96 w-96 rounded-full bg-indigo-400/20 blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {/* Brand Header */}
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-sky-600 to-indigo-600 p-0.5 shadow-lg shadow-sky-500/20">
            <img src="./favicon.svg" alt="CamAI" className="h-full w-full rounded-[14px] bg-white p-1.5" />
          </div>
          <div className="flex flex-col text-left">
            <span className="font-bold text-xl tracking-tight text-slate-900">CamAI Desktop</span>
            <span className="text-[10px] font-semibold tracking-wider text-sky-600 uppercase">Enterprise Node</span>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-slate-200/90 bg-white/90 p-8 shadow-2xl shadow-slate-900/10 backdrop-blur-xl transition-all">
          <div className="text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50/80 px-3 py-1 text-[11px] font-semibold text-sky-700">
              <ShieldCheck className="h-3.5 w-3.5 text-sky-600" />
              <span>HARDWARE LICENSE ACTIVATION</span>
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Activate Device</h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Enter your license key to bind this device to your CamAI workspace
            </p>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="relative">
              <KeyRound size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={key}
                onChange={(e) => format(e.target.value)}
                placeholder="LIC-XXXX-XXXX-XXXX"
                spellCheck={false}
                className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-4 text-center font-mono text-sm tracking-widest text-slate-900 placeholder-slate-400 outline-none transition-all focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
              />
            </div>
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-center text-xs font-medium text-rose-700">
                {error}
              </div>
            )}
            <button
              className="w-full rounded-xl bg-slate-900 py-3.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-slate-800 hover:shadow-lg disabled:opacity-60"
              disabled={busy || key.length < 18}
            >
              {busy ? "Activating Node…" : "Activate Node"}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Lock className="h-3.5 w-3.5 text-slate-400" />
            <span>Bound to DPAPI Hardware Fingerprint</span>
          </div>
        </div>

        <p className="mt-6 text-center text-xs font-medium text-slate-500">
          CamAI Enterprise Engine • Encrypted Synchronization Active
        </p>
      </div>
    </div>
  );
}

