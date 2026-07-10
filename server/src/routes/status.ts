import { Router, Request, Response } from 'express';
import { getHistoryCount } from '../services/storageService';
import { aiProvider } from '../services/inferenceService';

const router = Router();
const startTime = Date.now();

/**
 * GET /api/status
 * Returns server health and configuration status.
 */
router.get('/', async (_req: Request, res: Response) => {
  let localModelReady = false;
  try {
    localModelReady = await aiProvider.isReady();
  } catch {
    localModelReady = false;
  }

  res.json({
    server: 'online',
    localModelReady,
    historyCount: getHistoryCount(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

export default router;
