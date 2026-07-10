import axios from 'axios';
import { Detection } from '../types';

export interface AIProvider {
  detectPersons(imageBuffer: Buffer, mimeType?: string): Promise<{ detections: Detection[]; latency: number; segmentedImage: string | null; fps: number }>;
}

const PYTHON_MODEL_PORT = Number(process.env.PYTHON_MODEL_PORT ?? 5001);
const PYTHON_MODEL_HOST = process.env.PYTHON_MODEL_HOST ?? '127.0.0.1';
const PYTHON_MODEL_URL = `http://${PYTHON_MODEL_HOST}:${PYTHON_MODEL_PORT}`;

class PythonAiProvider implements AIProvider {
  async detectPersons(
    imageBuffer: Buffer,
    mimeType = 'image/jpeg'
  ): Promise<{ detections: Detection[]; latency: number; segmentedImage: string | null; fps: number }> {
    const t0 = Date.now();
    const base64 = imageBuffer.toString('base64');

    const response = await axios.post(
      `${PYTHON_MODEL_URL}/detect`,
      {
        image: base64,
        mimeType,
      },
      {
        timeout: 120000,
      }
    );

    const latency = Date.now() - t0;
    const data = response.data;
    if (!data || !data.success) {
      throw new Error(data?.detail ?? 'Python model server returned an error');
    }

    return {
      detections: data.detections ?? [],
      segmentedImage: data.segmentedImage ?? null,
      latency: data.latency ?? 0,
      fps: data.fps ?? 0,
    };
  }
}

export const aiProvider: AIProvider = new PythonAiProvider();
