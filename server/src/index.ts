import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import detectRouter from './routes/detect';
import historyRouter from './routes/history';
import statusRouter from './routes/status';
import { appendLog } from './services/storageService';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// ── Middleware ─────────────────────────────────────────────────────────────

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Static uploads directory (for future saved images)
const uploadsDir = path.join(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsDir));

// ── Request Logging Middleware ─────────────────────────────────────────────

app.use((req, res, next) => {
  const id = uuidv4();
  const start = Date.now();
  const requestSize = parseInt(req.headers['content-length'] ?? '0', 10);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const responseSize = parseInt(res.getHeader('content-length') as string ?? '0', 10);

    // Only log non-detect endpoints to reduce disk I/O
    if (!req.path.startsWith('/api/detect')) {
      try {
        appendLog({
          id,
          timestamp: new Date().toISOString(),
          endpoint: req.path,
          method: req.method,
          statusCode: res.statusCode,
          duration,
          requestSize,
          responseSize,
        });
      } catch { /* non-fatal */ }
    }
  });

  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────

app.use('/api/detect', detectRouter);
app.use('/api/history', historyRouter);
app.use('/api/status', statusRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server Error]', err);
  res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
});

// ── Start Python Inference Server ──────────────────────────────────────────

function startPythonServer(): ChildProcess | null {
  const pythonScript = path.join(__dirname, '..', 'python', 'inference_server.py');
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  console.log(`\n[Node] Starting Python inference server...`);
  console.log(`[Node] Script: ${pythonScript}`);

  try {
    const proc = spawn(pythonCmd, [pythonScript], {
      cwd: path.join(__dirname, '..', 'python'),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) console.log(`[python] ${line}`);
      });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach((line: string) => {
        // Filter out common Flask/YOLO noise
        if (line.includes('WARNING') || line.includes('FutureWarning')) return;
        if (line.trim()) console.error(`[python] ${line}`);
      });
    });

    proc.on('exit', (code) => {
      console.error(`[Node] Python inference server exited with code ${code}`);
      // Auto-restart after 3 seconds
      setTimeout(() => {
        console.log('[Node] Restarting Python inference server...');
        startPythonServer();
      }, 3000);
    });

    return proc;
  } catch (err) {
    console.error('[Node] Failed to start Python server:', err);
    return null;
  }
}

// ── Start ──────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`\n🚀 CamAI Server running on http://localhost:${PORT}`);
  console.log(`   Inference backend: Local YOLO11n-seg (Python)`);
  console.log(`   Environment: ${process.env.NODE_ENV ?? 'development'}\n`);

  // Start the Python inference server
  startPythonServer();
});

// Set server timeout to 2 minutes to handle slow model loading
server.timeout = 120000;

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Node] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Node] Terminating...');
  process.exit(0);
});

export default app;
