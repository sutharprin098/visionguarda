import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Standalone web browser fallback when not running inside Electron
if (typeof window !== "undefined" && !(window as any).camai) {
  const dummyFn = () => () => {};
  (window as any).camai = {
    config: {
      appType: "desktop",
      isDevelopment: true,
      supabaseUrl: "https://local-node.camai.cloud",
      anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.dummy",
    },
    getStoredSession: async () => ({ ok: true, session: { user: { email: "demo@camai.local" } } }),
    getWarmSession: async () => null,
    getConfig: async () => ({}),
    deactivate: async () => {},
    updateRefreshToken: async () => {},
    sessionStore: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
    },
    bundleCache: {
      get: async () => null,
      set: async () => {},
    },
    capture: {
      getSources: async () => [],
      setSource: async () => {},
      sourceExists: async () => false,
    },
    downloadModel: async () => {},
    pauseDownload: async () => {},
    getDownloadStatus: async () => ({}),
    onDownloadProgress: () => () => {},
    engine: {
      start: async () => ({ ok: true }),
      stop: async () => ({ ok: true }),
      restart: async () => ({ ok: true }),
      getStatus: async () => ({ online: true }),
      getLogs: async () => [],
      getPath: async () => "",
      getToken: async () => "",
      setPath: async () => {},
      onLog: () => () => {},
      onStatus: () => () => {},
    },
    zones: {
      get: async () => ({}),
      set: async () => ({}),
    },
    on: dummyFn,
    off: () => {},
    invoke: async () => ({}),
  };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

