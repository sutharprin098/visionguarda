// Shared types mirroring server/src/types/index.ts

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
  track_id?: number | null;
}

export interface DetectResponse {
  success: boolean;
  people: number;
  detections: Detection[];
  segmentedImage: string | null;
  masks?: number[][][]; // polygon contour points per person [[x,y], [x,y], ...]
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
  uptime: number;
  modelLoaded: boolean;
  cameraThreadsActive: number;
  cameras: Record<string, {
    name: string;
    running: boolean;
    fps: number;
    latency: number;
    counters: { in: number; out: number };
  }>;
  selectedModel: string;
  // Heterogeneous bag: top-level status/selected/device fields plus one
  // ModelBenchmark entry per model key — indexed access is cast at call sites.
  benchmark: Record<string, any>;
  recommendation: {
    should_switch: boolean;
    message: string;
    suggested_model: string;
  };
}

export type Theme = 'dark' | 'light';

export interface AppState {
  isDetecting: boolean;
  lastDetection: DetectResponse | null;
  fps: number;
  cameraActive: boolean;
  error: string | null;
}

export interface OverlaySettings {
  showBoundingBox: boolean;
  showSegmentationMask: boolean;
  showPerson: boolean;
  showVehicle: boolean;
  showPersonId: boolean;
  showVehicleId: boolean;
  showClassName: boolean;
  showConfidence: boolean;
  showSpeed: boolean;
  showDirectionArrow: boolean;
  showMotionTrail: boolean;
  showTrackingPath: boolean;
  showZoneName: boolean;
  showZoneBorder: boolean;
  showZoneFill: boolean;
  showLineCrossingStatus: boolean;
  showIntrusionStatus: boolean;
  showLoiteringTimer: boolean;
  showPersonCount: boolean;
  showVehicleCount: boolean;
  showCameraFps: boolean;
  showAiFps: boolean;
  showLatency: boolean;
  showTimestamp: boolean;
  showCameraName: boolean;
  showHeatmap: boolean;
  showEventLabels: boolean;
  showRecordingStatus: boolean;

  // Customization
  colors: {
    boundingBox: string;
    segmentationMask: string;
    personId: string;
    vehicleId: string;
    className: string;
    confidence: string;
    speed: string;
    directionArrow: string;
    motionTrail: string;
    trackingPath: string;
    zoneName: string;
    zoneBorder: string;
    zoneFill: string;
    hudText: string;
    heatmap: string;
  };
  transparency: number;
  borderWidth: number;
  fontSize: number;
  labelStyle: 'solid' | 'transparent' | 'outline';
}

export interface OverlayProfile {
  id: string;
  name: string;
  settings: OverlaySettings;
}

