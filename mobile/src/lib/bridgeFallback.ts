/**
 * Web / Capacitor Android Polyfill for window.camai
 * Enforces Desktop-style Hardware License Key Activation on Mobile.
 */

if (typeof window !== "undefined" && !window.camai) {
  const SUPABASE_URL = "https://kuqyhceykvisqfyghiot.supabase.co";
  const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1cXloY2V5a3Zpc3FmeWdoaW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4Mzc1MjksImV4cCI6MjA5OTQxMzUyOX0.EvmBR-6sjtUO8UWBm9A0Sv9Ms5GMSs7BDsvw8fVZ8LI";

  (window as any).camai = {
    config: {
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      appType: "desktop",
      isPackaged: true,
    },
    getConfig: async () => (window as any).camai.config,

    activate: async (licenseKey: string) => {
      try {
        let rawId = localStorage.getItem("camai_mobile_raw_id");
        if (!rawId) {
          rawId = `camai-mobile-${Date.now()}-${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}`;
          localStorage.setItem("camai_mobile_raw_id", rawId);
        }
        const msgUint8 = new TextEncoder().encode(rawId);
        const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const fingerprintHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

        const res = await fetch(`${SUPABASE_URL}/functions/v1/activate-license`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: ANON_KEY },
          body: JSON.stringify({
            license_key: licenseKey.trim().toUpperCase(),
            fingerprint_hash: fingerprintHash,
            device_name: "CamAI Mobile Security Node",
            os_info: { os: "Android", userAgent: navigator.userAgent },
            hardware: { platform: "Mobile" },
            app_version: "1.0.0",
          }),
        });

        const body = await res.json();
        if (!res.ok) {
          return { ok: false, error: body.error ?? `Activation failed (${res.status})` };
        }

        const session = {
          access_token: body.access_token,
          refresh_token: body.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        };

        localStorage.setItem("camai.session", JSON.stringify(session));
        localStorage.setItem("camai_creds", JSON.stringify({
          refresh_token: body.refresh_token,
          device_id: body.device_id,
        }));

        return { ok: true, access_token: body.access_token, refresh_token: body.refresh_token };
      } catch (e: any) {
        return { ok: false, error: e?.message || "Activation failed — check network connection" };
      }
    },

    getStoredSession: async () => {
      const raw = localStorage.getItem("camai_creds");
      if (!raw) return { ok: false };
      try {
        const creds = JSON.parse(raw);
        return { ok: true, refresh_token: creds.refresh_token, device_id: creds.device_id };
      } catch {
        return { ok: false };
      }
    },

    updateRefreshToken: async (t: string) => {
      const raw = localStorage.getItem("camai_creds");
      if (raw) {
        try {
          const creds = JSON.parse(raw);
          creds.refresh_token = t;
          localStorage.setItem("camai_creds", JSON.stringify(creds));
        } catch {}
      }
      return { ok: true };
    },

    deactivate: async () => {
      localStorage.removeItem("camai.session");
      localStorage.removeItem("camai_creds");
      localStorage.removeItem("camai_bundle_cache");
      return { ok: true };
    },

    getWarmSession: async (force?: boolean) => {
      const raw = localStorage.getItem("camai.session");
      if (!raw) return { ok: false, reason: "no-creds" };

      try {
        const session = JSON.parse(raw);
        if (session.expires_at && session.expires_at > Math.floor(Date.now() / 1000) + 60) {
          return { ok: true, session };
        }
      } catch {}

      const credsRaw = localStorage.getItem("camai_creds");
      if (!credsRaw) return { ok: false, reason: "no-creds" };

      try {
        const creds = JSON.parse(credsRaw);
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: ANON_KEY },
          body: JSON.stringify({ refresh_token: creds.refresh_token }),
        });

        const body = await res.json();
        if (res.ok && body.access_token) {
          const session = {
            access_token: body.access_token,
            refresh_token: body.refresh_token || creds.refresh_token,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          };
          localStorage.setItem("camai.session", JSON.stringify(session));
          return { ok: true, session };
        }
        return { ok: false, reason: "no-creds" };
      } catch {
        return { ok: false, reason: "retry" };
      }
    },

    sessionStore: {
      get: async () => {
        const s = localStorage.getItem("camai.session");
        return s ? JSON.parse(s) : null;
      },
      set: async (session: any) => {
        if (session) localStorage.setItem("camai.session", JSON.stringify(session));
        else localStorage.removeItem("camai.session");
        return { ok: true };
      },
      remove: async () => {
        localStorage.removeItem("camai.session");
        return { ok: true };
      },
    },

    bundleCache: {
      get: async () => {
        const b = localStorage.getItem("camai_bundle_cache");
        return b ? JSON.parse(b) : null;
      },
      set: async (bundle: any) => {
        localStorage.setItem("camai_bundle_cache", JSON.stringify(bundle));
        return { ok: true };
      },
    },

    capture: {
      getSources: async () => [],
      setSource: async () => ({ ok: true }),
      sourceExists: async () => ({ exists: false }),
    },

    engine: {
      start: async () => ({ ok: true }),
      stop: async () => ({ ok: true }),
      restart: async () => ({ ok: true }),
      getStatus: async () => ({ state: "running", pid: 1, lastError: null, crashCount: 0, config: {} }),
      getLogs: async () => [],
      getPath: async () => ({}),
      getToken: async () => "",
      setPath: async () => ({ ok: true }),
      onLog: () => () => {},
      onStatus: () => () => {},
    },

    window: {
      setFullScreen: async (v: boolean) => ({ ok: true, fullscreen: v }),
      isFullScreen: async () => ({ ok: true, fullscreen: false }),
      onFullScreen: () => () => {},
      onResized: () => () => {},
    },

    onPowerEvent: () => () => {},
  };
}
