import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("camai", {
  activate: (licenseKey: string) => ipcRenderer.invoke("activate", licenseKey),
  getStoredSession: () => ipcRenderer.invoke("get-stored-session"),
  updateRefreshToken: (t: string) => ipcRenderer.invoke("update-refresh-token", t),
  deactivate: () => ipcRenderer.invoke("deactivate"),
  getConfig: () => ipcRenderer.invoke("get-config"),
  downloadModel: (args: any) => ipcRenderer.invoke("download-model", args),
  pauseDownload: (args: any) => ipcRenderer.invoke("pause-download", args),
  getDownloadStatus: (args: any) => ipcRenderer.invoke("get-download-status", args),
  onDownloadProgress: (modelName: string, cb: any) => {
    const channel = `download-progress:${modelName}`;
    const listener = (_evt: any, data: any) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  }
});
