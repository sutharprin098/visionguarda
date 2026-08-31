import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Menu, Moon, Search, Sun, X, Shield, Activity, ChevronRight, Smartphone, ExternalLink, CheckCircle2 } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { supabase } from "../lib/supabase";
import { NAV } from "./nav";
import NotificationsBell from "./NotificationsBell";
import CommandPalette from "./CommandPalette";

export default function AppShell() {
  const { session, profile, org, can, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Redirect mobile auth flows away from desktop dashboard shell to dedicated callback handoff
  useEffect(() => {
    const isMobileAuthFlow = 
      searchParams.get("mobile") === "1" || 
      localStorage.getItem("camai_mobile_auth") === "1";

    if (isMobileAuthFlow) {
      const hash = window.location.hash || "";
      nav(`/auth/callback?mobile=1${hash}`, { replace: true });
    }
  }, [searchParams, nav]);

  const { data: orgSettings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("organization_settings").select("*").maybeSingle();
      return data;
    },
    enabled: !!org,
  });

  const branding = orgSettings?.branding;
  const brandName = branding?.name_override?.trim() || "CamAI";

  useEffect(() => {
    async function loadLogo() {
      if (branding?.logo_path) {
        const { data } = await supabase.storage
          .from("branding")
          .createSignedUrl(branding.logo_path, 3600);
        if (data?.signedUrl) setLogoUrl(data.signedUrl);
      } else {
        setLogoUrl(null);
      }
    }
    loadLogo();
  }, [branding?.logo_path]);

  const getInitials = (name?: string) => {
    if (!name) return "AI";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  return (
    <div className="app-shell flex h-screen bg-surface-0 text-ink-1 antialiased">
      {/* Backdrop — mobile off-canvas drawer */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm md:hidden animate-fade-in"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar Navigation */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-line/80 bg-surface-1/95 backdrop-blur-xl transition-all duration-300 ease-in-out md:static md:z-auto md:translate-x-0 shadow-xl md:shadow-none",
          navOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Brand & Organization Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-line/60">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 shadow-md overflow-hidden">
            {logoUrl ? (
              <img src={logoUrl} alt={brandName} className="h-7 w-7 object-contain" />
            ) : (
              <img src="/favicon.svg" alt="CamAI" className="h-6 w-6 brightness-200" />
            )}
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-surface-1" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-extrabold tracking-tight text-ink-1 truncate">{brandName}</span>
              <span className="rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-sky-700 dark:text-sky-400 shrink-0">CORE</span>
            </div>
            <div className="truncate text-xs font-medium text-ink-3">{org?.name ?? "Enterprise Node"}</div>
          </div>
          <button
            className="ml-auto rounded-lg p-1.5 text-ink-3 transition hover:bg-surface-2 hover:text-ink-1 md:hidden"
            onClick={() => setNavOpen(false)}
            title="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Live Node Status Card */}
        <div className="mx-3 mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2.5">
          {/* Same under-AA issue as the CORE badge above: emerald-600 on a
              5%-opacity tint measured ~3.6:1 in light mode. -700 clears AA. */}
          <div className="flex items-center justify-between text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Edge Core Online
            </span>
            <span className="font-mono text-[10px]">v1.0.4</span>
          </div>
        </div>

        {/* Navigation Group Items */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV.map((g) => {
            const items = g.items.filter(
              (i) => (!i.perm || can(i.perm)) && (!i.superOnly || profile?.is_super_admin),
            );
            if (!items.length) return null;
            return (
              <div key={g.group} className="space-y-1">
                <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-3">
                  {g.group}
                </div>
                <div className="space-y-1">
                  {items.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.end}
                      onClick={() => setNavOpen(false)}
                      className={({ isActive }) =>
                        clsx(
                          "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-150",
                          isActive
                            ? "bg-sky-500/10 text-sky-700 dark:text-sky-400 font-bold border border-sky-500/20 shadow-xs"
                            : "text-ink-2 hover:bg-surface-2/80 hover:text-ink-1",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span className="absolute left-0 h-4 w-1 rounded-r-full bg-sky-500 shadow-xs" />
                          )}
                          <n.icon size={16} className={clsx("transition-transform duration-150 group-hover:scale-110", isActive ? "text-sky-500" : "text-ink-3")} />
                          <span className="truncate">{n.label}</span>
                          {isActive && <ChevronRight size={13} className="ml-auto text-sky-500/60 opacity-0 group-hover:opacity-100 transition-opacity" />}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User Profile Footer */}
        <div className="border-t border-line/60 p-3 bg-surface-1">
          <div className="flex items-center gap-3 rounded-xl border border-line/60 bg-surface-2/40 p-2.5 transition hover:bg-surface-2/80">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-1 text-xs font-bold text-surface-0 shadow-xs">
              {getInitials(profile?.full_name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold text-ink-1">{profile?.full_name}</div>
              <div className="truncate font-mono text-[10px] font-medium text-ink-3">{profile?.user_code}</div>
            </div>
            <button
              className="rounded-lg p-1.5 text-ink-3 transition hover:bg-rose-500/10 hover:text-rose-500"
              title="Sign out"
              onClick={async () => { await signOut(); nav("/"); }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Navbar Header */}
        <header className="relative z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line/60 bg-surface-1/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-xl p-2 text-ink-3 transition hover:bg-surface-2 hover:text-ink-1 md:hidden"
              onClick={() => setNavOpen(true)}
              title="Open menu"
            >
              <Menu size={20} />
            </button>

            {/* Quick Command Search Trigger */}
            <button
              className="flex items-center gap-2.5 rounded-xl border border-line/80 bg-surface-2/50 px-3 py-1.5 text-xs font-medium text-ink-3 transition hover:bg-surface-2 hover:border-accent/40"
              onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
            >
              <Search size={14} className="text-accent" />
              <span className="hidden sm:inline">Search studio & commands…</span>
              <kbd className="hidden rounded-lg border border-line bg-surface-1 px-1.5 py-0.5 text-[10px] font-mono text-ink-2 sm:inline shadow-2xs">Ctrl K</kbd>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Live Sync Pulse */}
            <div className="hidden md:flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/5 px-3 py-1 text-xs font-medium text-sky-700 dark:text-sky-400">
              <Activity size={13} className="animate-pulse" />
              <span>Realtime Engine Synced</span>
            </div>

            {/* Theme Toggle */}
            <button
              className="rounded-xl p-2 text-ink-3 transition hover:bg-surface-2 hover:text-ink-1"
              title="Toggle theme"
              onClick={toggle}
            >
              {theme === "dark" ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} className="text-slate-600" />}
            </button>

            {/* Notification Bell */}
            <NotificationsBell />
          </div>
        </header>

        {/* Router Outlet Main Stage */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-surface-0 min-w-0">
          <div className="w-full max-w-[1600px] mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6 min-w-0">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette />

      <CommandPalette />
    </div>
  );
}

