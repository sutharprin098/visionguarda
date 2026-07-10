import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { aiProvider } from '../services/inferenceService';
import { appendHistory } from '../services/storageService';
import { DetectResponse, DetectionRecord } from '../types';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
});

let frameCount = 0;

router.post('/', upload.single('image'), async (req: Request, res: Response) => {
  const requestStart = Date.now();
  frameCount++;
  const currentFrame = frameCount;

  if (!req.file) {
    res.status(400).json({ success: false, error: 'No image provided' });
    return;
  }

  const imageBuffer = req.file.buffer;
  const mimeType = req.file.mimetype || 'image/jpeg';

  try {
    const result = await aiProvider.detectPersons(imageBuffer, mimeType);

    const processingTime = Date.now() - requestStart;
    const timestamp = new Date().toISOString();
    const id = uuidv4();
    const peopleCount = result.detections.length;
    const status: 'human_found' | 'no_human' = peopleCount > 0 ? 'human_found' : 'no_human';

    const maxConfidence =
      result.detections.length > 0
        ? Math.max(...result.detections.map((d) => d.confidence))
        : null;

    // Save to history every 20th frame to reduce disk I/O
    if (currentFrame % 20 === 0) {
      const record: DetectionRecord = {
        id,
        timestamp,
        imageBase64: imageBuffer.toString('base64'),
        detections: result.detections,
        segmentedImage: null,
        masks: result.masks,
        peopleCount,
        confidence: maxConfidence,
        processingTime,
        yoloLatency: result.latency,
        samLatency: 0,
        fps: result.fps,
        status,
      };
      try { appendHistory(record); } catch { /* non-fatal */ }
    }

    const response: DetectResponse = {
      success: true,
      people: peopleCount,
      detections: result.detections,
      segmentedImage: null,
      masks: result.masks,
      processingTime,
      yoloLatency: result.latency,
      samLatency: 0,
      fps: result.fps,
      status,
      timestamp,
      id,
    };

    res.json(response);
  } catch (err: any) {
    const msg: string = err?.message ?? 'Unknown error';
    console.error(`[detect] Frame #${currentFrame} error:`, msg);
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
