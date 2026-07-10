import { Router, Request, Response } from 'express';
import { getHistory, clearHistory, getLogs, clearLogs } from '../services/storageService';

const router = Router();

/**
 * GET /api/history
 * Returns the full detection history array (newest first).
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const history = getHistory();
    res.json({ success: true, count: history.length, history });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message ?? 'Failed to read history' });
  }
});

/**
 * DELETE /api/history
 * Clears the detection history.
 */
router.delete('/', (_req: Request, res: Response) => {
  try {
    clearHistory();
    res.json({ success: true, message: 'History cleared' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message ?? 'Failed to clear history' });
  }
});

/**
 * GET /api/history/logs
 * Returns API access logs.
 */
router.get('/logs', (_req: Request, res: Response) => {
  try {
    const logs = getLogs();
    res.json({ success: true, count: logs.length, logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message ?? 'Failed to read logs' });
  }
});

/**
 * DELETE /api/history/logs
 * Clears API logs.
 */
router.delete('/logs', (_req: Request, res: Response) => {
  try {
    clearLogs();
    res.json({ success: true, message: 'Logs cleared' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message ?? 'Failed to clear logs' });
  }
});

export default router;
