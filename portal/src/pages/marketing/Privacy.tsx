import { Shield, Lock, Eye, Server, Cpu, Database, FileText, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12 md:py-16 text-ink-1">
      {/* Header */}
      <div className="border-b border-line pb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
          <Shield size={14} /> Legal & Privacy
        </div>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight md:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-ink-3">
          Last updated: July 2026 • Enterprise On-Premise Guarantee
        </p>
      </div>

      {/* Key Summary Cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface-1 p-4 shadow-sm">
          <Cpu className="h-6 w-6 text-primary" />
          <h3 className="mt-2 text-sm font-semibold">Zero Video Egress</h3>
          <p className="mt-1 text-xs text-ink-3">
            Live CCTV feeds & RTSP streams never leave your local hardware network.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface-1 p-4 shadow-sm">
          <Lock className="h-6 w-6 text-emerald-500" />
          <h3 className="mt-2 text-sm font-semibold">Encrypted Vault</h3>
          <p className="mt-1 text-xs text-ink-3">
            Camera credentials are protected with AES-256-GCM encryption at rest.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface-1 p-4 shadow-sm">
          <Database className="h-6 w-6 text-indigo-500" />
          <h3 className="mt-2 text-sm font-semibold">Multi-Tenant Isolation</h3>
          <p className="mt-1 text-xs text-ink-3">
            Database records isolated via PostgreSQL Row Level Security (RLS).
          </p>
        </div>
      </div>

      {/* Main Legal Content */}
      <div className="mt-10 space-y-10 text-sm leading-relaxed text-ink-2">
        {/* Section 1 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-primary">1</span>
            Edge-First Privacy Guarantee
          </h2>
          <p>
            At CamAI, privacy is built directly into our software architecture. Unlike legacy cloud-based CCTV services that stream raw video to remote servers, CamAI operates as an <strong>edge-first video analytics engine</strong>.
          </p>
          <div className="rounded-lg border border-line bg-surface-1/50 p-4">
            <h4 className="font-semibold text-ink-1 text-xs uppercase tracking-wider mb-2">What this means for your organization:</h4>
            <ul className="space-y-1.5 text-xs text-ink-2">
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 shrink-0" />
                <span><strong>No Video Storage in Cloud:</strong> RTSP streams, MJPEG frames, and raw video clips are decoded and processed 100% locally on your local GPU/CPU hardware.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-emerald-500 mt-0.5 shrink-0" />
                <span><strong>No Biometric Aggregation:</strong> Facial recognition vectors, ANPR plate logs, and helmet/PPE analytics are retained strictly within your local or self-hosted database.</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Section 2 */}
        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-primary">2</span>
            Information We Collect
          </h2>
          <p>
            To manage licenses, authenticate accounts, and sync system configuration between the Web Portal and Desktop applications, we collect minimal operational metadata:
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Account Information:</strong> Name, work email, organization name, and encrypted password hash provided during signup or invite.
            </li>
            <li>
              <strong>Device & Hardware Telemetry:</strong> Anonymized hardware fingerprint (CPU model, motherboard ID, MachineGuid, OS version) generated during desktop license activation to enforce device seat limits.
            </li>
            <li>
              <strong>System Audit Logs:</strong> Timestamped record of administrative actions (e.g., camera added, role permissions modified, license key generated).
            </li>
            <li>
              <strong>Integration Credentials:</strong> Optional Telegram bot tokens or custom SMTP server details configured by your administrator for alert dispatch.
            </li>
          </ul>
        </section>

        {/* Section 3 */}
        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-primary">3</span>
            How We Protect Your Data
          </h2>
          <p>
            We deploy military-grade security controls to ensure data integrity across all environments:
          </p>
          <div className="grid gap-4 sm:grid-cols-2 mt-4">
            <div className="rounded-lg border border-line bg-surface-1 p-4">
              <h4 className="font-semibold text-ink-1 flex items-center gap-2">
                <Lock size={16} className="text-primary" /> License Key Hashing
              </h4>
              <p className="mt-1 text-xs text-ink-3">
                License keys are stored in our database strictly as SHA-256 hashes. Plaintext keys are revealed only once upon creation and cannot be recovered by server operators.
              </p>
            </div>
            <div className="rounded-lg border border-line bg-surface-1 p-4">
              <h4 className="font-semibold text-ink-1 flex items-center gap-2">
                <Server size={16} className="text-primary" /> Camera Secret Encryption
              </h4>
              <p className="mt-1 text-xs text-ink-3">
                RTSP camera URLs and passwords are encrypted using AES-256-GCM. The decryption key is held securely in isolated Edge Function runtime secrets.
              </p>
            </div>
          </div>
        </section>

        {/* Section 4 */}
        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-primary">4</span>
            Data Sharing & Third Parties
          </h2>
          <p>
            CamAI does <strong>not sell, rent, or monetize</strong> your organization data or usage metrics. We engage trusted enterprise infrastructure providers strictly to deliver core platform services:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Supabase:</strong> For cloud auth, database RLS, and realtime configuration sync.</li>
            <li><strong>GitHub Releases:</strong> For verified desktop installer binary distributions and checksum validation.</li>
            <li><strong>Telegram API:</strong> If enabled by your admin for instant alert notifications.</li>
          </ul>
        </section>

        {/* Section 5 */}
        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-primary">5</span>
            Your Rights & Control
          </h2>
          <p>
            As an administrator or user of CamAI, you retain full control over your telemetry and account:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Deactivate or revoke registered desktop devices at any time.</li>
            <li>Export full CSV/PDF audit logs of organization events.</li>
            <li>Request complete deletion of your organization account and associated metadata.</li>
          </ul>
        </section>

        {/* Contact Footer */}
        <div className="mt-12 rounded-xl border border-line bg-surface-1 p-6 text-center">
          <h3 className="text-base font-bold text-ink-1">Have questions about our Privacy Policy?</h3>
          <p className="mt-1 text-xs text-ink-3">
            Contact our Data Protection & Compliance team for enterprise inquiries.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Link to="/contact" className="btn-primary">
              Contact Compliance <FileText size={15} />
            </Link>
            <Link to="/terms" className="btn-ghost">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
