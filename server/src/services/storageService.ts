import fs from 'fs';
import path from 'path';
import { DetectionRecord, ApiLogEntry } from '../types';

const HISTORY_DIR = path.join(process.cwd(), 'history');
const HISTORY_FILE = path.join(HISTORY_DIR, 'detections.json');
const LOGS_FILE = path.join(HISTORY_DIR, 'api_logs.json');

// Ensure the history directory exists
function ensureDir() {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

function readJSON<T>(filePath: string, defaultValue: T): T {
  ensureDir();
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function writeJSON<T>(filePath: string, data: T): void {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Detection History ─────────────────────────────────────────────────────

export function getHistory(): DetectionRecord[] {
  return readJSON<DetectionRecord[]>(HISTORY_FILE, []);
}

export function appendHistory(record: DetectionRecord): void {
  const history = getHistory();
  history.unshift(record); // newest first
  // Keep last 500 records to avoid unbounded growth
  const trimmed = history.slice(0, 500);
  writeJSON(HISTORY_FILE, trimmed);
}

export function clearHistory(): void {
  writeJSON(HISTORY_FILE, []);
}

export function getHistoryCount(): number {
  return getHistory().length;
}

// ─── API Logs ──────────────────────────────────────────────────────────────

export function getLogs(): ApiLogEntry[] {
  return readJSON<ApiLogEntry[]>(LOGS_FILE, []);
}

export function appendLog(entry: ApiLogEntry): void {
  const logs = getLogs();
  logs.unshift(entry);
  const trimmed = logs.slice(0, 1000);
  writeJSON(LOGS_FILE, trimmed);
}

export function clearLogs(): void {
  writeJSON(LOGS_FILE, []);
}
