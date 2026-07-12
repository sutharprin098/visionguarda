import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut, Moon, Search, Sun } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { NAV } from "./nav";
import NotificationsBell from "./NotificationsBell";
import CommandPalette from "./CommandPalette";

export default function AppShell() {
  const { profile, org, can, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();

  return (
    <div className="flex h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img src="/favicon.svg" alt="CamAI" className="h-8 w-8 rounded-md" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink-1">CamAI</div>
            <div className="truncate text-xs text-ink-3">{org?.name}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4 pt-1">
          {NAV.map((g) => {
            const items = g.items.filter(
              (i) => (!i.perm || can(i.perm)) && (!i.superOnly || profile?.is_super_admin),
            );
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-ink-3">
                  {g.group}
                </div>
                <div className="space-y-0.5">
                  {items.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.end}
                      className={({ isActive }) =>
                        clsx(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition",
                          isActive
                            ? "bg-accent/15 font-medium text-accent"
                            : "text-ink-2 hover:bg-surface-2 hover:text-ink-1",
                        )
                      }
                    >
                      <n.icon size={15} />
                      {n.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm text-ink-1">{profile?.full_name}</div>
              <div className="truncate font-mono text-[10px] text-ink-3">{profile?.user_code}</div>
            </div>
            <button
              className="text-ink-3 hover:text-danger"
              title="Sign out"
              onClick={async () => { await signOut(); nav("/"); }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-end gap-1 border-b border-line bg-surface-1 px-4">
          <button
            className="mr-auto flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-3 transition hover:bg-surface-2"
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
          >
            <Search size={13} /> Search
            <kbd className="rounded border border-line px-1 text-[10px]">Ctrl K</kbd>
          </button>
          <button className="rounded-md p-2 text-ink-3 transition hover:bg-surface-2 hover:text-ink-1"
                  title="Toggle theme" onClick={toggle}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <NotificationsBell />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-8 py-8">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
