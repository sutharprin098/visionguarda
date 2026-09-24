// Local evidence vault: every alert this node raises is written here with its
// cropped snapshot, its full frame and its metadata, automatically, whether or
// not anybody was looking at the card.
//
// WHY INDEXEDDB AND NOT THE CLOUD
//
// Because the alert redesign is not allowed to touch the schema, the edge
// functions or the engine's API — and it does not need to. The engine already
// writes its own annotated snapshot for the alerts IT raises (pipeline.py ->
// RECORDINGS_DIR, surfaced by /api/alerts), and report-events already syncs
// those to Supabase. This vault is the RENDERER's evidence of what it showed
// the operator: the crop it displayed, the frame it came from, the boxes it
// drew. It is additive, it is local, and deleting it loses nothing the engine
// holds.
//
// Blobs, not data URLs. A base64 data URL is ~33% larger and lives on the JS
// heap for as long as anything references it; a Blob lives in the browser's
// blob store and IndexedDB persists it natively. On a wall display that runs
// for weeks, that difference is the difference between a stable renderer and
// one that gets OOM-killed.

export interface EvidenceMeta {
  plate?: string | null;
  speed?: number | null;
  speedStatus?: string | null;
  overspeed?: boolean;
  trackStatus?: string | null;
  dwellSeconds?: number | null;
  direction?: string | null;
  fps?: number | null;
  device?: string | null;
  zoneName?: string | null;
  /** "detection" = cropped straight from its own box. "scene" = the event had
   *  no single owning box (a zone counter ticking), so the whole frame is the
   *  evidence and the card says so rather than pretending. */
  cropKind: "detection" | "scene";
  region?: { x: number; y: number; w: number; h: number } | null;
  zoom?: number | null;
  /** Width/height of the stored crop, so the card can size its image box to the
   *  picture instead of letterboxing it into a fixed frame. */
  aspect?: number | null;
  /** How many times the live crop has been refreshed while the subject stayed
   *  in view. 0 = the original snapshot is the only one taken. */
  refreshes?: number;
  lane?: string | number | null;
  plateConfidence?: number | null;
  plateFailure?: string | null;
}

export interface EvidenceRecord {
  id: string;
  ts: number;
  cameraId: string;
  cameraName: string;
  siteName: string;
  /** Catalogue title, e.g. "Helmet Not Detected". */
  title: string;
  group: string;
  severity: string;
  /** Engine class or analytic alert type — the raw key, kept for export. */
  sourceKey: string;
  confidence: number | null;
  trackId: number | null;
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
  /** Every detection in frame at capture time — this is what the modal redraws
   *  over the full frame, so the boxes shown are the boxes that were live. */
  frameDetections: unknown[];
  meta: EvidenceMeta;
  crop: Blob | null;
  full: Blob | null;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  /** Object lifecycle rows derived from the telemetry stream — see
   *  trackLedger.ts. Persisted so a reopened incident still has its history. */
  timeline?: Array<{ ts: number; kind: string; label: string; basis: string; detail?: string }>;
}

const DB_NAME = "camai-evidence";
const DB_VERSION = 1;
const STORE = "events";
/** Hard cap. ~2000 events at a ~150KB average is roughly 300MB — generous for a
 *  local vault and bounded, which is the point. Oldest go first. */
const MAX_RECORDS = 2000;
const PRUNE_SLACK = 200;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null); // private mode / storage disabled — alerts still work
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("ts", "ts");
        store.createIndex("cameraId", "cameraId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** Fire-and-forget: the caller is a UI event handler and must never await disk. */
export function saveEvidence(rec: EvidenceRecord): void {
  void (async () => {
    const db = await openDb();
    if (!db) return;
    try {
      tx(db, "readwrite").put(rec);
    } catch {
      return;
    }
    void prune();
  })();
}

export async function updateEvidence(
  id: string,
  patch: Partial<EvidenceRecord>,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const store = tx(db, "readwrite");
    const get = store.get(id);
    get.onsuccess = () => {
      const cur = get.result as EvidenceRecord | undefined;
      if (!cur) return resolve();
      store.put({ ...cur, ...patch });
      resolve();
    };
    get.onerror = () => resolve();
  });
}

/** Newest first. */
export async function listEvidence(limit = 200, cameraId?: string): Promise<EvidenceRecord[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const out: EvidenceRecord[] = [];
    let cursorReq: IDBRequest<IDBCursorWithValue | null>;
    try {
      cursorReq = tx(db, "readonly").index("ts").openCursor(null, "prev");
    } catch {
      resolve([]);
      return;
    }
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || out.length >= limit) return resolve(out);
      const rec = cursor.value as EvidenceRecord;
      if (!cameraId || rec.cameraId === cameraId) out.push(rec);
      cursor.continue();
    };
    cursorReq.onerror = () => resolve(out);
  });
}

export async function getEvidence(id: string): Promise<EvidenceRecord | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = tx(db, "readonly").get(id);
    req.onsuccess = () => resolve((req.result as EvidenceRecord) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function countEvidence(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    const req = tx(db, "readonly").count();
    req.onsuccess = () => resolve(req.result ?? 0);
    req.onerror = () => resolve(0);
  });
}

export async function deleteEvidence(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const req = tx(db, "readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

/**
 * One older page of the vault, for the Alerts page's "load more" — newest
 * first, strictly older than `beforeTs` when given. Filtering by camera or
 * severity happens after the cursor read: the store holds at most MAX_RECORDS
 * (2000), so a full-table scan per page is cheap and avoids a second index
 * for a filter combination that changes every time the operator touches a
 * dropdown.
 */
export async function listEvidencePage(opts: {
  beforeTs?: number | null;
  limit?: number;
  cameraId?: string | null;
  severity?: string | null;
}): Promise<EvidenceRecord[]> {
  const { beforeTs = null, limit = 50, cameraId = null, severity = null } = opts;
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const out: EvidenceRecord[] = [];
    let cursorReq: IDBRequest<IDBCursorWithValue | null>;
    try {
      const range = beforeTs != null ? IDBKeyRange.upperBound(beforeTs, true) : null;
      cursorReq = tx(db, "readonly").index("ts").openCursor(range, "prev");
    } catch {
      resolve([]);
      return;
    }
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || out.length >= limit) return resolve(out);
      const rec = cursor.value as EvidenceRecord;
      if ((!cameraId || rec.cameraId === cameraId) && (!severity || rec.severity === severity)) {
        out.push(rec);
      }
      cursor.continue();
    };
    cursorReq.onerror = () => resolve(out);
  });
}

export async function clearEvidence(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const req = tx(db, "readwrite").clear();
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

/** Trim to MAX_RECORDS, oldest first. Runs with slack so a busy camera isn't
 *  paying for a delete transaction on every single alert. */
let pruning = false;
async function prune(): Promise<void> {
  if (pruning) return;
  pruning = true;
  try {
    const total = await countEvidence();
    if (total <= MAX_RECORDS + PRUNE_SLACK) return;
    const db = await openDb();
    if (!db) return;
    const excess = total - MAX_RECORDS;
    await new Promise<void>((resolve) => {
      const store = tx(db, "readwrite");
      const req = store.index("ts").openCursor(null, "next");
      let removed = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || removed >= excess) return resolve();
        cursor.delete();
        removed++;
        cursor.continue();
      };
      req.onerror = () => resolve();
    });
  } finally {
    pruning = false;
  }
}
