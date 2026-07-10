import axios from 'axios';
import type { DetectResponse, StatusResponse, DetectionRecord, ApiLogEntry } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000, // 30s — local inference is fast
});

// ── Detection ──────────────────────────────────────────────────────────────

export async function detectImage(blob: Blob): Promise<DetectResponse> {
  const form = new FormData();
  form.append('image', blob, 'frame.jpg');
  const { data } = await api.post<DetectResponse>('/detect', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

// ── Status ─────────────────────────────────────────────────────────────────

export async function fetchStatus(): Promise<StatusResponse> {
  const { data } = await api.get<StatusResponse>('/status');
  return data;
}

// ── History ────────────────────────────────────────────────────────────────

export async function fetchHistory(): Promise<{ count: number; history: DetectionRecord[] }> {
  const { data } = await api.get('/history');
  return data;
}

export async function clearHistory(): Promise<void> {
  await api.delete('/history');
}

// ── Logs ───────────────────────────────────────────────────────────────────

export async function fetchLogs(): Promise<{ count: number; logs: ApiLogEntry[] }> {
  const { data } = await api.get('/history/logs');
  return data;
}

export async function clearLogs(): Promise<void> {
  await api.delete('/history/logs');
}

export default api;
