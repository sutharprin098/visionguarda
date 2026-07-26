import { ShieldCheck, Lock, Key, Server, Cpu, Database, FileCheck, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function SecurityPolicy() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12 md:py-16 text-ink-1">
      {/* Header */}
      <div className="border-b border-line pb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <ShieldCheck size={14} /> Enterprise Security Architecture
        </div>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight md:text-4xl">
          Security & Compliance Policy
        </h1>
        <p className="mt-2 text-sm text-ink-3">
          Last updated: July 2026 • Hardened On-Premise & Cloud Infrastructure
        </p>
      </div>

      {/* Grid Overview */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-1 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Lock size={20} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink-1">AES-256-GCM Credentials</h3>
              <p className="text-xs text-ink-3">Zero plaintext RTSP passwords stored</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface-1 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
              <Database size={20} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink-1">Postgres RLS Isolation</h3>
              <p className="text-xs text-ink-3">Strict multi-tenant boundary checks</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface-1 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Key size={20} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink-1">SHA-256 Key Hashes</h3>
              <p className="text-xs text-ink-3">One-time reveal, unrecoverable keys</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface-1 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <Cpu size={20} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink-1">DPAPI Local Vault</h3>
              <p className="text-xs text-ink-3">OS-level encrypted token storage</p>
            </div>
          </div>
        </div>
      </div>

      {/* Detail Content */}
      <div className="mt-10 space-y-10 text-sm leading-relaxed text-ink-2">
        {/* Pillar 1 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <Server size={18} className="text-primary" /> 1. Edge-First Zero-Egress Architecture
          </h2>
          <p>
            CamAI is designed so that live video streams, IP camera passwords, and high-frequency MJPEG frame outputs stay completely within your local network firewall. The local FastAPI engine communicates directly with local camera IP addresses; video frames are never transmitted to cloud endpoints.
          </p>
        </section>

        {/* Pillar 2 */}
        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <Database size={18} className="text-primary" /> 2. Database Multi-Tenancy & Row-Level Security (RLS)
          </h2>
          <p>
            All cloud tables carry mandatory `org_id` foreign keys protected by PostgreSQL Row Level Security (RLS) policies.
          </p>
          <div className="rounded-lg border border-line bg-surface-1/70 p-4 text-xs font-mono text-ink-2">
            CREATE POLICY org_isolation ON public.cameras <br />
            USING (org_id = app.current_org_id());
          </div>
          <p className="text-xs text-ink-3">
            Even in the event of a compromised client token, database queries cannot return rows belonging to another organization.
          </p>
        </section>

        {/* Pillar 3 */}
        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <FileCheck size={18} className="text-primary" /> 3. Immutable Append-Only Audit Logging
          </h2>
          <p>
            CamAI records administrative actions in an append-only `audit_logs` table. Update and delete RLS policies do not exist on audit logs, preserving full historical chain-of-custody for enterprise compliance.
          </p>
        </section>

        {/* Security Disclosures */}
        <div className="mt-12 rounded-xl border border-line bg-surface-1 p-6 text-center">
          <h3 className="text-base font-bold text-ink-1">Reporting a Vulnerability</h3>
          <p className="mt-1 text-xs text-ink-3">
            If you discover a security flaw or vulnerability, please contact our security team directly.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Link to="/contact" className="btn-primary flex items-center gap-2">
              Report Security Issue <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
