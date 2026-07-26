import { FileText, ShieldAlert, Check, HelpCircle, Scale, AlertTriangle, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function Terms() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12 md:py-16 text-ink-1">
      {/* Header */}
      <div className="border-b border-line pb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
          <Scale size={14} /> Legal Agreement
        </div>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight md:text-4xl">
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-ink-3">
          Last updated: July 2026 • Enterprise License & Software Agreement
        </p>
      </div>

      {/* Main Legal Content */}
      <div className="mt-10 space-y-10 text-sm leading-relaxed text-ink-2">
        {/* Intro notice */}
        <div className="rounded-xl border border-line bg-surface-1 p-5 text-xs text-ink-2">
          <p className="font-semibold text-ink-1 mb-1">IMPORTANT NOTICE:</p>
          PLEASE READ THESE TERMS OF SERVICE CAREFULLY BEFORE ACTIVATING OR USING THE CAMAI PLATFORM, DESKTOP SOFTWARE, OR WEB PORTAL SERVICES. BY SIGNING UP OR ENTERING A LICENSE KEY, YOU AGREE TO BE BOUND BY THIS AGREEMENT.
        </div>

        {/* Section 1 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-primary">1</span>
            Software Grant & Licensing
          </h2>
          <p>
            Subject to your compliance with these Terms and active subscription/license entitlement, CamAI grants your organization a <strong>non-exclusive, non-transferable, revocable license</strong> to install and execute the CamAI Desktop software and access the Web Portal.
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs">
            <li><strong>Seat Enforcement:</strong> Each license key grants activation for up to the maximum number of hardware devices specified (`max_devices`).</li>
            <li><strong>Device Binding:</strong> Desktop activations bind to an anonymized SHA-256 hardware fingerprint. Deactivating a seat in the portal revokes that hardware's sync capability immediately.</li>
            <li><strong>No Reverse Engineering:</strong> You agree not to decompile, reverse engineer, or extract proprietary neural network pipeline components or license validation logic.</li>
          </ul>
        </section>

        {/* Section 2 */}
        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-primary">2</span>
            Hardware Requirements & Local Execution
          </h2>
          <p>
            CamAI processes computer vision pipelines (CamAI Vision Core, ByteTrack, Speed Estimation, ANPR, Face Recognition) on local user-provided hardware.
          </p>
          <div className="rounded-lg border border-line bg-surface-1 p-4 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-ink-1 font-semibold">
              <Check size={16} className="text-emerald-500" /> Customer Hardware Responsibility
            </div>
            <p className="text-ink-3">
              You are solely responsible for ensuring your workstations, servers, and IP cameras satisfy the hardware prerequisites (e.g., CUDA-compatible NVIDIA GPU, OpenVINO iGPU, or high-performance CPU, along with adequate RTSP network bandwidth).
            </p>
          </div>
        </section>

        {/* Section 3 */}
        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-primary">3</span>
            Legal Compliance & CCTV Regulations
          </h2>
          <p>
            Video surveillance and AI analytics are subject to regional laws, GDPR, workplace privacy acts, and public monitoring regulations.
          </p>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2 font-semibold mb-1">
              <AlertTriangle size={16} className="text-amber-500" /> Compliance Mandatory
            </div>
            You agree to use CamAI in full compliance with all applicable local and international laws regarding public camera placement, facial recognition consent, employee monitoring, and data protection. CamAI assumes no liability for illegal camera placement or unnotified video recording.
          </div>
        </section>

        {/* Section 4 */}
        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-primary">4</span>
            Intellectual Property Rights
          </h2>
          <p>
            All right, title, and interest in and to the CamAI platform—including computer vision algorithms, ByteTrack adaptations, UI designs, documentation, and database schemas—remain the exclusive property of CamAI.
          </p>
        </section>

        {/* Section 5 */}
        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-primary">5</span>
            Disclaimer of Warranties & Limitation of Liability
          </h2>
          <p>
            THE CAMAI PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-ink-3">
            <li>CamAI does not warrant that AI detection, vehicle speed estimations, or ANPR OCR will be 100% error-free in all adverse weather, lighting, or camera angle conditions.</li>
            <li>In no event shall CamAI be liable for indirect, incidental, or consequential damages arising out of system outages, camera hardware failures, or network interruptions.</li>
          </ul>
        </section>

        {/* Section 6 */}
        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-primary">6</span>
            Termination & License Suspension
          </h2>
          <p>
            We reserve the right to suspend or terminate license activations if an organization breaches these Terms, attempts key forgery, or fails to maintain an active subscription.
          </p>
        </section>

        {/* Navigation buttons */}
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-line pt-8">
          <Link to="/privacy" className="btn-ghost flex items-center gap-2 text-xs">
            <FileText size={15} /> Read Privacy Policy
          </Link>
          <Link to="/contact" className="btn-primary flex items-center gap-2 text-xs">
            Questions? Contact Support <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}
