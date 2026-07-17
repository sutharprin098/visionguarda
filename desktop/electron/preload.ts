import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("camai", {
  activate: (licenseKey: string) => ipcRenderer.invoke("activate", licenseKey),
  getStoredSession: () => ipcRenderer.invoke("get-stored-session"),
  updateRefreshToken: (t: string) => ipcRenderer.invoke("update-refresh-token", t),
  deactivate: () => ipcRenderer.invoke("deactivate"),
  getConfig: () => ipcRenderer.invoke("get-config"),
  capture: {
    getSources: () => ipcRenderer.invoke("get-capture-sources"),
    setSource: (sourceId: string | null) => ipcRenderer.invoke("set-capture-source", sourceId),
    sourceExists: (sourceId: string) => ipcRenderer.invoke("capture-source-exists", sourceId),
  },
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
  },
  engine: {
    start: () => ipcRenderer.invoke("engine-start"),
    stop: () => ipcRenderer.invoke("engine-stop"),
    restart: () => ipcRenderer.invoke("engine-restart"),
    getStatus: () => ipcRenderer.invoke("engine-get-status"),
    getLogs: () => ipcRenderer.invoke("engine-get-logs"),
    getPath: () => ipcRenderer.invoke("engine-get-path"),
    setPath: (args: { pythonPath: string; engineDir: string }) => ipcRenderer.invoke("engine-set-path", args),
    onLog: (cb: (line: string) => void) => {
      const listener = (_evt: any, line: string) => cb(line);
      ipcRenderer.on("engine:log", listener);
      return () => ipcRenderer.removeListener("engine:log", listener);
    },
    onStatus: (cb: (status: any) => void) => {
      const listener = (_evt: any, status: any) => cb(status);
      ipcRenderer.on("engine:status", listener);
      return () => ipcRenderer.removeListener("engine:status", listener);
    },
  },
  window: {
    setFullScreen: (value: boolean) => ipcRenderer.invoke("window-set-fullscreen", value),
    isFullScreen: () => ipcRenderer.invoke("window-is-fullscreen"),
    onFullScreen: (cb: (value: boolean) => void) => {
      const listener = (_evt: any, value: boolean) => cb(value);
      ipcRenderer.on("window:fullscreen", listener);
      return () => ipcRenderer.removeListener("window:fullscreen", listener);
    },
    onResized: (cb: (size: { width: number; height: number; fullscreen: boolean }) => void) => {
      const listener = (_evt: any, size: any) => cb(size);
      ipcRenderer.on("window:resized", listener);
      return () => ipcRenderer.removeListener("window:resized", listener);
    },
  },
  onPowerEvent: (cb: (evt: "suspend" | "resume" | "lock-screen" | "unlock-screen") => void) => {
    const listener = (_evt: any, name: any) => cb(name);
    ipcRenderer.on("power-event", listener);
    return () => ipcRenderer.removeListener("power-event", listener);
  },
});
