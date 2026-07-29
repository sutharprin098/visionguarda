import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, ArrowLeft, Send, CheckCircle2, Lock, Sparkles, ShieldCheck } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import type { Permission } from "../lib/permissions";
import { Badge } from "./ui";

interface Props {
  /** Typed against the real `public.permissions` catalog on purpose: a key the
   *  database has never heard of can be granted to nobody, so gating a route on
   *  one locks out every user including the Organization Owner. That used to be
   *  a silent runtime lockout; it is now a build error. */
  perm?: Permission;
  superOnly?: boolean;
  moduleName?: string;
  customMessage?: string;
  children: ReactNode;
}

export default function PermissionGuard({
  perm,
  superOnly = false,
  moduleName = "this module",
  customMessage,
  children,
}: Props) {
  const { profile, can } = useAuth();
  const [requested, setRequested] = useState(false);
  const [requestNotes, setRequestNotes] = useState("");

  const isSuper = profile?.is_super_admin ?? false;
  const isAllowed = superOnly ? isSuper : perm ? can(perm) : true;

  if (isAllowed) {
    return <>{children}</>;
  }

  // Pre-configured custom block messages defined by Admin
  const defaultBlockMsg =
    customMessage ||
    `Access Restricted: Your assigned security role does not have permission to access ${moduleName}. Please request elevated privileges from your Organization Administrator.`;

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl card p-6 sm:p-8 space-y-6 text-center border border-rose-500/20 bg-surface-1 shadow-2xl relative overflow-hidden">
        {/* Glowing Background Glow */}
        <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-rose-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-20 -bottom-20 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

        {/* Security Shield Lock Icon */}
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/20 to-amber-500/20 border border-rose-500/30 text-rose-500 shadow-inner animate-pulse">
          <Lock size={32} />
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-rose-500" />
          </span>
        </div>

        {/* Access Blocked Banner */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-bold text-rose-500">
            <ShieldAlert size={13} />
            <span>ACCESS DENIED BY ADMIN</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-ink-1 tracking-tight">
            Restricted Module: {moduleName}
          </h2>
        </div>

        {/* Custom Admin Blocking Message Box */}
        <div className="rounded-xl border border-line bg-surface-2 p-4 text-left space-y-2">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-ink-3">
            <span className="flex items-center gap-1.5 text-rose-500">
              <ShieldCheck size={14} />
              <span>Admin Policy Restriction</span>
            </span>
            <Badge tone="default">Required: {perm || "SuperAdmin"}</Badge>
          </div>
          <p className="text-xs sm:text-sm font-medium text-ink-1 leading-relaxed">
            "{defaultBlockMsg}"
          </p>
        </div>

        {/* Interactive Access Request Box */}
        {!requested ? (
          <div className="rounded-xl border border-line/60 bg-surface-0 p-4 space-y-3 text-left">
            <label className="block text-xs font-bold text-ink-2">
              Need access to {moduleName}? Send request to Admin:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Reason for requesting permission (optional)..."
                value={requestNotes}
                onChange={(e) => setRequestNotes(e.target.value)}
                className="input flex-1 text-xs py-2"
              />
              <button
                onClick={() => setRequested(true)}
                className="btn-primary btn-sm shrink-0"
              >
                <Send size={13} /> Request Access
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-center justify-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={16} />
            <span>Access request sent to Organization Admin for review!</span>
          </div>
        )}

        {/* Footer Navigation */}
        <div className="pt-2 flex items-center justify-center gap-3">
          <Link to="/app" className="btn-ghost btn-sm">
            <ArrowLeft size={14} /> Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
