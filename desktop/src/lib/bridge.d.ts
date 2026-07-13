export type EngineProcessState =
  | "not_configured" | "starting" | "running" | "restarting" | "crash_looping" | "stopped";

export interface EngineStatus {
  state: EngineProcessState;
  pid: number | null;
  lastError: string | null;
  crashCount: number;
  config: { pythonPath?: string; engineDir?: string };
}

export interface CamaiBridge {
  activate(licenseKey: string): Promise<{ ok: boolean; error?: string; access_token?: string; refresh_token?: string }>;
  getStoredSession(): Promise<{ ok: boolean; refresh_token?: string; device_id?: string }>;
  updateRefreshToken(token: string): Promise<{ ok: boolean }>;
  deactivate(): Promise<{ ok: boolean }>;
  getConfig(): Promise<{ supabaseUrl: string; anonKey: string; appType: "desktop" | "admin"; isPackaged: boolean }>;
  engine: {
    start(): Promise<{ ok: boolean }>;
    stop(): Promise<{ ok: boolean }>;
    restart(): Promise<{ ok: boolean }>;
    getStatus(): Promise<EngineStatus>;
    getLogs(): Promise<string[]>;
    getPath(): Promise<{ pythonPath?: string; engineDir?: string }>;
    setPath(args: { pythonPath: string; engineDir: string }): Promise<{ ok: boolean; error?: string }>;
    onLog(cb: (line: string) => void): () => void;
    onStatus(cb: (status: EngineStatus) => void): () => void;
  };
  onPowerEvent(cb: (evt: "suspend" | "resume" | "lock-screen" | "unlock-screen") => void): () => void;
}

declare global {
  interface Window {
    camai: CamaiBridge;
  }
}
export {};
