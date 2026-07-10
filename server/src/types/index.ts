// Shared TypeScript interfaces for the CamAI application

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Detection {
  class: string;
  confidence: number;
  bbox: BoundingBox;
  trackId?: number;
}

export interface SegmentResult {
  mask: string;
  segmentedImage: string;
}

export interface DetectionRecord {
  id: string;
  timestamp: string;
  imageBase64: string;
  detections: Detection[];
  segmentedImage: string | null;
  masks?: number[][][];
  peopleCount: number;
  confidence: number | null;
  processingTime: number;
  yoloLatency: number;
  samLatency: number;
  fps: number;
  status: 'human_found' | 'no_human';
}

export interface DetectResponse {
  success: boolean;
  people: number;
  detections: Detection[];
  segmentedImage: string | null;
  masks?: number[][][]; // polygon contour points per person
  processingTime: number;
  yoloLatency: number;
  samLatency: number;
  fps: number;
  status: 'human_found' | 'no_human';
  timestamp: string;
  id: string;
  error?: string;
}

export interface StatusResponse {
  server: 'online';
  localModelReady: boolean;
  historyCount: number;
  uptime: number;
  version: string;
  timestamp: string;
}

export interface ApiLogEntry {
  id: string;
  timestamp: string;
  endpoint: string;
  method: string;
  statusCode: number;
  duration: number;
  requestSize: number;
  responseSize: number;
  error?: string;
}
