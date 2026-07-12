import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { Organization, Profile } from "../lib/types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  org: Organization | null;
  permissions: string[];
  loading: boolean;
  can: (perm: string) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadIdentity(s: Session | null) {
    if (!s) {
      setProfile(null);
      setOrg(null);
      setPermissions([]);
      return;
    }
    try {
      // .maybeSingle(): a missing profile/org row (mid-provisioning, or a
      // profile an admin removed) must not throw — it should just render
      // as "no identity yet" instead of wedging the whole app on a
      // rejected Promise.all with loading stuck true forever.
      const [{ data: prof }, { data: orgRow }, { data: perms }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", s.user.id).maybeSingle(),
        supabase.from("organizations").select("*").maybeSingle(),
        supabase
          .from("user_roles")
          .select("roles(role_permissions(permission))")
          .eq("user_id", s.user.id),
      ]);
      setProfile(prof ?? null);
      setOrg(orgRow ?? null);
      setPermissions([
        ...new Set(
          (perms ?? []).flatMap((r: any) =>
            (r.roles?.role_permissions ?? []).map((p: any) => p.permission),
          ),
        ),
      ]);
    } catch (e) {
      console.error("Failed to load identity", e);
      setProfile(null);
      setOrg(null);
      setPermissions([]);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadIdentity(data.session);
      setLoading(false);
    }).catch((e) => {
      console.error("Failed to restore session", e);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, s) => {
      setSession(s);
      await loadIdentity(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Realtime: role/permission changes apply without re-login
  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel("self-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${session.user.id}` },
        () => loadIdentity(session),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${session.user.id}` },
        () => loadIdentity(session),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [session?.user.id]);

  return (
    <Ctx.Provider
      value={{
        session,
        profile,
        org,
        permissions,
        loading,
        can: (perm) => profile?.is_super_admin || permissions.includes(perm),
        refresh: () => loadIdentity(session),
        signOut: async () => {
          try {
            await supabase.auth.signOut();
          } catch (e) {
            // An already-expired/invalid token 403s the server-side revoke —
            // that's not a reason to leave the UI stuck "logged in". Force
            // local state clear either way; onAuthStateChange handles the
            // clean-signOut path, this is the fallback for the throw path.
            console.error("signOut request failed, clearing local session anyway", e);
            setSession(null);
            setProfile(null);
            setOrg(null);
            setPermissions([]);
          }
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
