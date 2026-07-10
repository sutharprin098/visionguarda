import axios from 'axios';
import FormData from 'form-data';
import { Detection } from '../types';

export interface AIProvider {
  detectPersons(imageBuffer: Buffer, mimeType?: string): Promise<{
    detections: Detection[];
    latency: number;
    segmentedImage: string | null;
    masks: number[][][] | undefined;
    fps: number;
  }>;
  isReady(): Promise<boolean>;
}

const INFERENCE_URL = process.env.INFERENCE_URL ?? 'http://localhost:8001';

class LocalInferenceProvider implements AIProvider {
  async detectPersons(
    imageBuffer: Buffer,
    mimeType = 'image/jpeg'
  ) {
    const t0 = Date.now();

    const form = new FormData();
    form.append('image', imageBuffer, {
      filename: 'frame.jpg',
      contentType: mimeType,
    });

    let response: any;
    try {
      response = await axios.post(`${INFERENCE_URL}/detect`, form, {
        headers: form.getHeaders(),
        timeout: 15000,
        maxContentLength: 10 * 1024 * 1024,
        maxBodyLength: 10 * 1024 * 1024,
      });
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? 'Inference failed';
      throw new Error(msg);
    }

    const data = response.data;
    const latency = Date.now() - t0;

    const detections: Detection[] = (data.detections ?? []).map((d: any) => ({
      class: d.class ?? 'person',
      confidence: d.confidence ?? 0,
      bbox: d.bbox ?? { x1: 0, y1: 0, x2: 0, y2: 0 },
    }));

    return {
      detections,
      latency,
      segmentedImage: null,
      masks: data.masks as number[][][] | undefined,
      fps: data.fps ?? 0,
    };
  }

  async isReady(): Promise<boolean> {
    try {
      const res = await axios.get(`${INFERENCE_URL}/health`, { timeout: 3000 });
      return res.data?.modelLoaded === true;
    } catch {
      return false;
    }
  }
}

export const aiProvider: AIProvider = new LocalInferenceProvider();
