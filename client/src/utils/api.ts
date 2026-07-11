import axios from 'axios';
import type { StatusResponse } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000, // 30s — local inference is fast
});

// ── Status ─────────────────────────────────────────────────────────────────

export async function fetchStatus(): Promise<StatusResponse> {
  const { data } = await api.get<StatusResponse>('/status');
  return data;
}

// ── Detection history (compact per-frame metrics, not full images) ─────────

export interface HistoryRecord {
  id: string;
  timestamp: string;
  camera_id: string;
  camera_name: string;
  people_count: number;
  max_confidence: number | null;
  processing_time: number;
  status: 'human_found' | 'no_human' | string;
}

export async function fetchHistoryRecords(limit = 200): Promise<HistoryRecord[]> {
  const { data } = await api.get(`/history?limit=${limit}`);
  return Array.isArray(data) ? data : (data?.history ?? []);
}

export async function clearHistoryRecords(): Promise<void> {
  await api.delete('/history');
}

// ── Cameras ────────────────────────────────────────────────────────────────

export interface CameraRecord {
  id: string;
  name: string;
  type: string;
  source: string;
  is_active: number;
  zones: string;
  lines: string;
}

export async function fetchCameras(): Promise<CameraRecord[]> {
  const { data } = await api.get('/cameras');
  return data;
}

export async function saveCamera(payload: {
  id: string;
  name: string;
  type: string;
  source: string;
  is_active: boolean;
  zones?: string;
  lines?: string;
}): Promise<void> {
  await api.post('/cameras', payload);
}

export async function deleteCamera(id: string): Promise<void> {
  await api.delete(`/cameras/${id}`);
}

export async function uploadCameraVideo(file: File): Promise<{ path: string }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/cameras/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

// ── Alerts ─────────────────────────────────────────────────────────────────

export interface AlertRecord {
  id: string;
  timestamp: string;
  camera_id: string;
  camera_name: string;
  alert_type: string;
  message: string;
  screenshot_path?: string | null;
  video_path?: string | null;
}

export async function fetchAlerts(limit = 100): Promise<AlertRecord[]> {
  const { data } = await api.get(`/alerts?limit=${limit}`);
  return data;
}

export async function deleteAlert(id: string): Promise<void> {
  await api.delete(`/alerts/${id}`);
}

export async function clearAllAlerts(): Promise<void> {
  await api.delete('/alerts');
}

// ── Recordings ─────────────────────────────────────────────────────────────

export interface RecordingRecord {
  id: string;
  camera_id: string;
  camera_name: string;
  start_time: string;
  end_time: string | null;
  recording_type: 'continuous' | 'event';
  file_path: string;
}

export async function fetchRecordings(): Promise<RecordingRecord[]> {
  const { data } = await api.get('/recordings');
  return data;
}

// ── Display (per-camera MJPEG preview resolution/quality) ───────────────────

export async function updateCameraDisplay(cameraId: string, payload: { max_width?: number; quality?: number }): Promise<void> {
  await api.post(`/cameras/${cameraId}/display`, payload);
}

export async function setCameraRecording(cameraId: string, enabled: boolean): Promise<void> {
  await api.post(`/cameras/${cameraId}/recording`, { enabled });
}

export default api;
