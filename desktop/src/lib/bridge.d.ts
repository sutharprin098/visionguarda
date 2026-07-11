export interface CamaiBridge {
  activate(licenseKey: string): Promise<{ ok: boolean; error?: string; access_token?: string; refresh_token?: string }>;
  getStoredSession(): Promise<{ ok: boolean; refresh_token?: string; device_id?: string }>;
  updateRefreshToken(token: string): Promise<{ ok: boolean }>;
  deactivate(): Promise<{ ok: boolean }>;
  getConfig(): Promise<{ supabaseUrl: string; anonKey: string }>;
}

declare global {
  interface Window {
    camai: CamaiBridge;
  }
}
export {};
