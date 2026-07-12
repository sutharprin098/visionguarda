import { BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { IncomingMessage } from "node:http";
import * as https from "node:https";
import * as http from "node:http";

// In-memory registry of active download controllers to allow pausing/resuming
const activeDownloads = new Map<string, {
  request: http.ClientRequest | null;
  aborted: boolean;
  downloadedBytes: number;
  totalBytes: number;
  lastProgressTime: number;
  lastProgressBytes: number;
  speed: number;
}>();

// Hardcoded public key for verifying signature (ECDSA, prime256v1 / secp256r1)
// In production, this key corresponds to the private key used by administrators to sign model packages.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEPmS0d1Y6DqB9TswXy2Z10DkP1YjC
e7U+L579c4ZtC2d8vD4gC2zO7q3N+Z1kS9yv7tJmE6n4hQ0P1YjCe7U+Lw==
-----END PUBLIC KEY-----`;

export function setupDownloadHandlers(ipcMain: any, getMainWindow: () => BrowserWindow | null) {
  
  // Start or resume a download
  ipcMain.handle("download-model", async (_evt: any, { url, modelName, expectedChecksum, signature }: {
    url: string;
    modelName: string;
    expectedChecksum: string;
    signature: string;
  }) => {
    const win = getMainWindow();
    if (!win) throw new Error("No main window active");

    const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.config');
    const destDir = path.join(appData, "CamAI", "models");
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const finalPath = path.join(destDir, modelName);
    const tempPath = finalPath + ".tmp";

    // If final file already exists and matches checksum, return success immediately
    if (fs.existsSync(finalPath)) {
      const existingChecksum = calculateFileChecksum(finalPath);
      if (existingChecksum === expectedChecksum) {
        return { ok: true, path: finalPath, status: "complete" };
      }
    }

    // Check if we are resuming
    let startOffset = 0;
    if (fs.existsSync(tempPath)) {
      startOffset = fs.statSync(tempPath).size;
    }

    // Initialize state
    const downloadKey = modelName;
    if (activeDownloads.has(downloadKey)) {
      // Already running or paused
      const existing = activeDownloads.get(downloadKey)!;
      if (existing.request && !existing.aborted) {
        return { ok: true, status: "downloading" };
      }
    }

    const state = {
      request: null as http.ClientRequest | null,
      aborted: false,
      downloadedBytes: startOffset,
      totalBytes: startOffset,
      lastProgressTime: Date.now(),
      lastProgressBytes: startOffset,
      speed: 0,
    };
    activeDownloads.set(downloadKey, state);

    performDownload(url, tempPath, startOffset, downloadKey, win, (success, errorMsg) => {
      activeDownloads.delete(downloadKey);
      if (success) {
        // Verify checksum
        const checksum = calculateFileChecksum(tempPath);
        if (checksum !== expectedChecksum) {
          try { fs.unlinkSync(tempPath); } catch {}
          win.webContents.send(`download-progress:${downloadKey}`, {
            status: "error",
            error: "Checksum verification failed"
          });
          return;
        }

        // Verify digital signature
        const signatureVerified = verifyDigitalSignature(tempPath, signature);
        if (!signatureVerified) {
          try { fs.unlinkSync(tempPath); } catch {}
          win.webContents.send(`download-progress:${downloadKey}`, {
            status: "error",
            error: "Digital signature verification failed"
          });
          return;
        }

        // Rename to final location
        try {
          if (fs.existsSync(finalPath)) {
            fs.unlinkSync(finalPath);
          }
          fs.renameSync(tempPath, finalPath);
          win.webContents.send(`download-progress:${downloadKey}`, {
            status: "complete",
            path: finalPath
          });
        } catch (renameErr: any) {
          win.webContents.send(`download-progress:${downloadKey}`, {
            status: "error",
            error: `Failed to finalize file: ${renameErr.message}`
          });
        }
      } else {
        win.webContents.send(`download-progress:${downloadKey}`, {
          status: state.aborted ? "paused" : "error",
          error: errorMsg || "Download failed"
        });
      }
    });

    return { ok: true, status: "started" };
  });

  // Pause a download
  ipcMain.handle("pause-download", (_evt: any, { modelName }: { modelName: string }) => {
    const downloadKey = modelName;
    const state = activeDownloads.get(downloadKey);
    if (state && state.request) {
      state.aborted = true;
      state.request.destroy();
      return { ok: true, status: "paused" };
    }
    return { ok: false, error: "Download not active" };
  });

  // Check download status
  ipcMain.handle("get-download-status", (_evt: any, { modelName }: { modelName: string }) => {
    const downloadKey = modelName;
    const state = activeDownloads.get(downloadKey);
    if (state) {
      return {
        ok: true,
        status: state.aborted ? "paused" : "downloading",
        downloadedBytes: state.downloadedBytes,
        totalBytes: state.totalBytes,
        speed: state.speed
      };
    }
    
    // Check if finalized file exists
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.config');
    const finalPath = path.join(appData, "CamAI", "models", modelName);
    if (fs.existsSync(finalPath)) {
      return { ok: true, status: "complete", path: finalPath };
    }

    // Check if partial file exists
    const tempPath = finalPath + ".tmp";
    if (fs.existsSync(tempPath)) {
      return { ok: true, status: "paused", downloadedBytes: fs.statSync(tempPath).size };
    }

    return { ok: true, status: "idle" };
  });
}

function performDownload(
  url: string,
  tempPath: string,
  startOffset: number,
  downloadKey: string,
  win: BrowserWindow,
  callback: (success: boolean, errorMsg?: string) => void
) {
  const protocol = url.startsWith("https") ? https : http;
  const state = activeDownloads.get(downloadKey)!;

  const headers: Record<string, string> = {};
  if (startOffset > 0) {
    headers["Range"] = `bytes=${startOffset}-`;
  }

  const req = protocol.get(url, { headers }, (res: IncomingMessage) => {
    const statusCode = res.statusCode || 0;
    
    // Handle redirect
    if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
      performDownload(res.headers.location, tempPath, startOffset, downloadKey, win, callback);
      return;
    }

    if (statusCode >= 400) {
      callback(false, `Server returned HTTP status ${statusCode}`);
      return;
    }

    const isPartial = statusCode === 206;
    if (startOffset > 0 && !isPartial) {
      // Server did not honor Range, restart from 0
      startOffset = 0;
      state.downloadedBytes = 0;
      try { fs.truncateSync(tempPath, 0); } catch {}
    }

    const contentLength = parseInt(res.headers["content-length"] || "0", 10);
    state.totalBytes = isPartial ? contentLength + startOffset : contentLength;

    const fileStream = fs.createWriteStream(tempPath, { flags: startOffset > 0 ? "a" : "w" });

    res.pipe(fileStream);

    res.on("data", (chunk: Buffer) => {
      state.downloadedBytes += chunk.length;
      
      const now = Date.now();
      const timeDiff = (now - state.lastProgressTime) / 1000;
      if (timeDiff >= 0.5) { // update progress UI every 500ms
        const bytesDiff = state.downloadedBytes - state.lastProgressBytes;
        state.speed = bytesDiff / timeDiff; // bytes/sec
        
        state.lastProgressTime = now;
        state.lastProgressBytes = state.downloadedBytes;

        const percent = state.totalBytes > 0 ? (state.downloadedBytes / state.totalBytes) * 100 : 0;
        const remainingSeconds = state.speed > 0 ? (state.totalBytes - state.downloadedBytes) / state.speed : 0;

        win.webContents.send(`download-progress:${downloadKey}`, {
          status: "downloading",
          downloadedBytes: state.downloadedBytes,
          totalBytes: state.totalBytes,
          percent: Math.round(percent),
          speed: Math.round(state.speed),
          remainingSeconds: Math.round(remainingSeconds),
        });
      }
    });

    fileStream.on("finish", () => {
      fileStream.close();
      if (!state.aborted) {
        callback(true);
      }
    });

    fileStream.on("error", (err) => {
      fileStream.close();
      callback(false, err.message);
    });
  });

  state.request = req;

  req.on("error", (err) => {
    if (state.aborted) {
      callback(false, "Download paused");
    } else {
      callback(false, err.message);
    }
  });
}

function calculateFileChecksum(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const fileBuffer = fs.readFileSync(filePath);
  hash.update(fileBuffer);
  return hash.digest("hex");
}

function verifyDigitalSignature(filePath: string, signatureB64: string): boolean {
  try {
    const verifier = crypto.createVerify("sha256");
    const fileBuffer = fs.readFileSync(filePath);
    verifier.update(fileBuffer);
    
    const signatureBuffer = Buffer.from(signatureB64, "base64");
    return verifier.verify(PUBLIC_KEY_PEM, signatureBuffer);
  } catch (e) {
    console.error("Signature verification error:", e);
    return false;
  }
}
