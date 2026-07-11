import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("camai", {
  activate: (licenseKey: string) => ipcRenderer.invoke("activate", licenseKey),
  getStoredSession: () => ipcRenderer.invoke("get-stored-session"),
  updateRefreshToken: (t: string) => ipcRenderer.invoke("update-refresh-token", t),
  deactivate: () => ipcRenderer.invoke("deactivate"),
  getConfig: () => ipcRenderer.invoke("get-config"),
});
