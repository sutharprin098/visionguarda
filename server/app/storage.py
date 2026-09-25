import sqlite3
import json
import queue
import threading
import time
from datetime import datetime
from app.config import DB_PATH, RECORDINGS_DIR

# ---------------------------------------------------------------------------
# Async write queue — keeps all INSERT / UPDATE calls off the inference thread
# ---------------------------------------------------------------------------
# SQLite with WAL is safe for one writer thread + many readers. We funnel every
# write (insert_alert, insert_history_record, recording lifecycle) through this
# queue so the tracking loop never blocks on a commit(). Reads (get_* helpers
# called by REST endpoints) open their own short-lived connections as before —
# WAL lets them run concurrently with the background writer without blocking.

_write_queue: queue.Queue = queue.Queue(maxsize=4096)
_writer_thread: threading.Thread | None = None
_writer_started = threading.Event()


def _writer_loop():
    """Background thread: drain _write_queue, execute SQL, commit in batches."""
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")  # WAL + NORMAL is crash-safe and fast
    conn.execute("PRAGMA cache_size=-8192")    # 8 MB page cache
    conn.row_factory = sqlite3.Row
    _writer_started.set()
    BATCH = 32   # max rows per commit cycle
    while True:
        # Block until at least one item arrives, then drain up to BATCH more
        try:
            first = _write_queue.get(timeout=5.0)
        except queue.Empty:
            continue
        if first is None:  # shutdown sentinel
            break
        batch = [first]
        while len(batch) < BATCH:
            try:
                item = _write_queue.get_nowait()
            except queue.Empty:
                break
            if item is None:
                batch.append(item)
                break
            batch.append(item)
        try:
            for sql, params in batch:
                if sql is None:  # sentinel
                    break
                conn.execute(sql, params)
            conn.commit()
        except Exception as e:
            print(f"[storage] Write-queue batch failed: {e}", flush=True)
            try:
                conn.rollback()
            except Exception:
                pass
    conn.close()


def _ensure_writer():
    global _writer_thread
    if _writer_thread is None or not _writer_thread.is_alive():
        _writer_thread = threading.Thread(target=_writer_loop, name="DBWriter", daemon=True)
        _writer_thread.start()
        _writer_started.wait(timeout=5.0)


def _enqueue(sql: str, params: tuple):
    """Queue one write. Non-blocking: drops on full queue rather than stalling caller."""
    _ensure_writer()
    try:
        _write_queue.put_nowait((sql, params))
    except queue.Full:
        print("[storage] Write queue full — dropping one row.", flush=True)

def get_db():
    """Open a read connection with WAL for concurrent read safety."""
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    _ensure_writer()  # Start background writer before any writes happen
    with get_db() as conn:
        # Cameras table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cameras (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL, -- 'webcam', 'usb', 'rtsp'
                source TEXT NOT NULL, -- '0', '1', or RTSP URL
                is_active INTEGER DEFAULT 1,
                zones TEXT DEFAULT '[]', -- JSON string of restricted zone polygons
                lines TEXT DEFAULT '[]',   -- JSON string of crossing lines
                rules TEXT DEFAULT '[]', -- JSON string of rule engine rules
                zone_profile TEXT DEFAULT NULL,
                profile_features TEXT DEFAULT '{}'
            )
        """)
        
        # Alter table if columns are missing on upgrade
        try:
            conn.execute("ALTER TABLE cameras ADD COLUMN rules TEXT DEFAULT '[]'")
        except sqlite3.OperationalError:
            pass

        try:
            conn.execute("ALTER TABLE cameras ADD COLUMN zone_profile TEXT DEFAULT NULL")
        except sqlite3.OperationalError:
            pass

        try:
            conn.execute("ALTER TABLE cameras ADD COLUMN profile_features TEXT DEFAULT '{}'")
        except sqlite3.OperationalError:
            pass

        for col, col_def in [
            ("host", "TEXT DEFAULT NULL"),
            ("port", "INTEGER DEFAULT NULL"),
            ("protocol", "TEXT DEFAULT 'rtsp'"),
            ("stream_path", "TEXT DEFAULT NULL"),
            ("vendor", "TEXT DEFAULT 'generic'"),
            ("mac_address", "TEXT DEFAULT NULL"),
            ("username", "TEXT DEFAULT NULL"),
            ("password", "TEXT DEFAULT NULL"),
        ]:
            try:
                conn.execute(f"ALTER TABLE cameras ADD COLUMN {col} {col_def}")
            except sqlite3.OperationalError:
                pass

        # Alerts table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS alerts (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                camera_id TEXT NOT NULL,
                alert_type TEXT NOT NULL, -- 'intrusion', 'crossing', 'loitering'
                message TEXT NOT NULL,
                screenshot_path TEXT,
                video_path TEXT,
                detail TEXT DEFAULT '{}', -- JSON: structured event fields
                                          -- (plate_text, speed, track_id, ...),
                                          -- mirrors Supabase alerts.detail jsonb
                FOREIGN KEY(camera_id) REFERENCES cameras(id) ON DELETE CASCADE
            )
        """)
        # Add detail on upgrade of an existing install.
        try:
            conn.execute("ALTER TABLE alerts ADD COLUMN detail TEXT DEFAULT '{}'")
        except sqlite3.OperationalError:
            pass

        # History table (compact metrics)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                camera_id TEXT NOT NULL,
                people_count INTEGER NOT NULL,
                max_confidence REAL,
                processing_time INTEGER,
                status TEXT NOT NULL,
                FOREIGN KEY(camera_id) REFERENCES cameras(id) ON DELETE CASCADE
            )
        """)

        # Recordings table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS recordings (
                id TEXT PRIMARY KEY,
                camera_id TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT,
                recording_type TEXT NOT NULL, -- 'continuous', 'event'
                file_path TEXT NOT NULL,
                FOREIGN KEY(camera_id) REFERENCES cameras(id) ON DELETE CASCADE
            )
        """)

        # Vehicle Speed Logs table (Enterprise Speed Analytics & Overspeed Events)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS vehicle_speed_logs (
                id TEXT PRIMARY KEY,
                camera_id TEXT NOT NULL,
                track_id INTEGER NOT NULL,
                vehicle_type TEXT NOT NULL,
                speed_kmh REAL NOT NULL,
                speed_limit_kmh REAL NOT NULL,
                is_overspeed INTEGER NOT NULL DEFAULT 0,
                lane TEXT,
                timestamp TEXT NOT NULL,
                snapshot_path TEXT,
                video_path TEXT,
                FOREIGN KEY(camera_id) REFERENCES cameras(id) ON DELETE CASCADE
            )
        """)

        # Purge legacy default camera seeds
        for legacy_id in ("cam_default", "live_webcam", "live_screenshare"):
            conn.execute("DELETE FROM cameras WHERE id = ?", (legacy_id,))

        # System configuration settings
        conn.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        conn.commit()

# --- Database APIs ---

# Cameras
def sanitize_camera_record(cam: dict) -> dict:
    """Strip sensitive server-side credentials before returning camera to frontend."""
    if not cam:
        return cam
    c = dict(cam)
    c.pop("password", None)
    c.pop("username", None)
    if "source" in c and c["source"]:
        # Mask inline basic auth passwords from source strings if present
        import re
        c["source"] = re.sub(r"://([^:]+):([^@]+)@", r"://\1:***@", str(c["source"]))
    return c

def get_all_cameras(safe: bool = True):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM cameras").fetchall()
        cams = [dict(row) for row in rows]
        return [sanitize_camera_record(c) for c in cams] if safe else cams

def get_camera(camera_id: str, safe: bool = True):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM cameras WHERE id = ?", (camera_id,)).fetchone()
        if not row:
            return None
        c = dict(row)
        return sanitize_camera_record(c) if safe else c

def get_camera_full(camera_id: str):
    """Internal backend method returning raw camera record including credentials."""
    return get_camera(camera_id, safe=False)

def save_camera(camera_id: str, name: str, type_: str, source: str, is_active: int, zones: str = "[]", lines: str = "[]", rules: str = "[]", zone_profile: str = None, profile_features: str = "{}"):
    with get_db() as conn:
        conn.execute("""
            INSERT INTO cameras (id, name, type, source, is_active, zones, lines, rules, zone_profile, profile_features)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                type=excluded.type,
                source=excluded.source,
                is_active=excluded.is_active,
                zones=excluded.zones,
                lines=excluded.lines,
                rules=excluded.rules,
                zone_profile=excluded.zone_profile,
                profile_features=excluded.profile_features
        """, (camera_id, name, type_, source, is_active, zones, lines, rules, zone_profile, profile_features))
        conn.commit()

def save_camera_enrolled(
    camera_id: str,
    name: str,
    type_: str,
    source: str,
    is_active: int = 1,
    zones: str = "[]",
    lines: str = "[]",
    rules: str = "[]",
    zone_profile: str = None,
    profile_features: str = "{}",
    host: str = None,
    port: int = None,
    protocol: str = "rtsp",
    stream_path: str = None,
    vendor: str = "generic",
    mac_address: str = None,
    username: str = None,
    password: str = None,
):
    with get_db() as conn:
        conn.execute("""
            INSERT INTO cameras (
                id, name, type, source, is_active, zones, lines, rules, zone_profile, profile_features,
                host, port, protocol, stream_path, vendor, mac_address, username, password
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                type=excluded.type,
                source=excluded.source,
                is_active=excluded.is_active,
                zones=excluded.zones,
                lines=excluded.lines,
                rules=excluded.rules,
                zone_profile=excluded.zone_profile,
                profile_features=excluded.profile_features,
                host=excluded.host,
                port=excluded.port,
                protocol=excluded.protocol,
                stream_path=excluded.stream_path,
                vendor=excluded.vendor,
                mac_address=excluded.mac_address,
                username=COALESCE(excluded.username, cameras.username),
                password=COALESCE(excluded.password, cameras.password)
        """, (
            camera_id, name, type_, source, is_active, zones, lines, rules, zone_profile, profile_features,
            host, port, protocol, stream_path, vendor, mac_address, username, password
        ))
        conn.commit()

def delete_camera(camera_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM cameras WHERE id = ?", (camera_id,))
        conn.commit()

# Alerts
def insert_alert(alert_id: str, camera_id: str, alert_type: str, message: str, screenshot_path: str = None, video_path: str = None, detail: dict = None):
    """Persist one event asynchronously (non-blocking). `detail` is structured,
    queryable event data (plate_text, speed_kmh, track_id, confidence, …) —
    the plate number and everything else live here as JSON, not buried in the
    message string, and this is the shape the Supabase `alerts.detail` jsonb
    column syncs to. timestamp is UTC ISO-8601 so it sorts and syncs unambiguously."""
    timestamp = datetime.utcnow().isoformat() + "Z"
    _enqueue(
        "INSERT INTO alerts (id, timestamp, camera_id, alert_type, message, screenshot_path, video_path, detail) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (alert_id, timestamp, camera_id, alert_type, message, screenshot_path, video_path,
         json.dumps(detail or {}))
    )

def get_recent_alerts(limit: int = 50):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT a.*, c.name as camera_name 
            FROM alerts a 
            LEFT JOIN cameras c ON a.camera_id = c.id 
            ORDER BY a.timestamp DESC LIMIT ?
        """, (limit,)).fetchall()
        return [dict(row) for row in rows]

def clear_all_alerts():
    with get_db() as conn:
        conn.execute("DELETE FROM alerts")
        conn.commit()

# History
def insert_history_record(rec_id: str, camera_id: str, people_count: int, max_conf: float, proc_time: int, status: str):
    """Async non-blocking insert — does not stall the tracking thread."""
    timestamp = datetime.utcnow().isoformat() + "Z"
    _enqueue(
        "INSERT INTO history (id, timestamp, camera_id, people_count, max_confidence, processing_time, status) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (rec_id, timestamp, camera_id, people_count, max_conf, proc_time, status)
    )

def get_history(limit: int = 100):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT h.*, c.name as camera_name 
            FROM history h
            LEFT JOIN cameras c ON h.camera_id = c.id
            ORDER BY h.timestamp DESC LIMIT ?
        """, (limit,)).fetchall()
        return [dict(row) for row in rows]

def clear_all_history():
    with get_db() as conn:
        conn.execute("DELETE FROM history")
        conn.commit()

# Recordings
def start_recording_entry(rec_id: str, camera_id: str, start_time: str, type_: str, file_path: str):
    _enqueue(
        "INSERT INTO recordings (id, camera_id, start_time, recording_type, file_path) VALUES (?, ?, ?, ?, ?)",
        (rec_id, camera_id, start_time, type_, file_path)
    )

def end_recording_entry(rec_id: str, end_time: str):
    _enqueue(
        "UPDATE recordings SET end_time = ? WHERE id = ?",
        (end_time, rec_id)
    )

def get_all_recordings():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT r.*, c.name as camera_name
            FROM recordings r
            LEFT JOIN cameras c ON r.camera_id = c.id
            ORDER BY r.start_time DESC
        """, ()).fetchall()
        records = [dict(row) for row in rows]

    MIN_VALID_SIZE_BYTES = 1024
    valid = []
    seen_filenames = set()
    for rec in records:
        filename = (rec.get("file_path") or "").rsplit("/", 1)[-1]
        if not filename:
            continue
        path = RECORDINGS_DIR / filename
        try:
            if path.stat().st_size >= MIN_VALID_SIZE_BYTES:
                valid.append(rec)
                seen_filenames.add(filename)
        except FileNotFoundError:
            continue

    # Auto-discover local MP4 files in RECORDINGS_DIR missing from SQLite DB
    if RECORDINGS_DIR.exists():
        for p in RECORDINGS_DIR.glob("*.mp4"):
            if p.name in seen_filenames:
                continue
            try:
                st = p.stat()
                if st.st_size >= MIN_VALID_SIZE_BYTES:
                    # Extract camera_id / timestamp if filename matches pattern cam_{cid}_{ts}_(continuous|event).mp4
                    parts = p.stem.split("_")
                    cam_id = parts[1] if len(parts) >= 2 else "local"
                    rec_type = parts[-1] if len(parts) >= 3 and parts[-1] in ("continuous", "event") else "continuous"
                    dt_str = datetime.fromtimestamp(st.st_ctime).isoformat() + "Z"
                    valid.append({
                        "id": f"disk_{p.stem}",
                        "camera_id": cam_id,
                        "camera_name": f"Camera {cam_id[:4]}",
                        "start_time": dt_str,
                        "end_time": datetime.fromtimestamp(st.st_mtime).isoformat() + "Z",
                        "recording_type": rec_type,
                        "file_path": f"/history/recordings/{p.name}",
                    })
            except Exception:
                pass

    return sorted(valid, key=lambda r: r.get("start_time", ""), reverse=True)

def delete_single_alert(alert_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT screenshot_path FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        if row and row["screenshot_path"]:
            filename = row["screenshot_path"].split("/")[-1]
            file_path = RECORDINGS_DIR / filename
            if file_path.exists():
                try:
                    file_path.unlink()
                except Exception as e:
                    print(f"[storage] Failed to delete alert snapshot file: {e}")
        conn.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
        conn.commit()


# --- Vehicle Speed Detection Database API ---

def insert_vehicle_speed_log(log_id: str, camera_id: str, track_id: int, vehicle_type: str, speed_kmh: float, speed_limit_kmh: float, is_overspeed: bool, lane: str = None, snapshot_path: str = None, video_path: str = None):
    """Async non-blocking insert into vehicle_speed_logs."""
    timestamp = datetime.utcnow().isoformat() + "Z"
    _enqueue(
        "INSERT INTO vehicle_speed_logs (id, camera_id, track_id, vehicle_type, speed_kmh, speed_limit_kmh, is_overspeed, lane, timestamp, snapshot_path, video_path) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (log_id, camera_id, int(track_id), str(vehicle_type), float(speed_kmh), float(speed_limit_kmh), 1 if is_overspeed else 0, lane, timestamp, snapshot_path, video_path)
    )

def get_vehicle_speed_logs(camera_id: str = None, limit: int = 100, is_overspeed: bool = None):
    with get_db() as conn:
        query = "SELECT s.*, c.name as camera_name FROM vehicle_speed_logs s LEFT JOIN cameras c ON s.camera_id = c.id"
        params = []
        conditions = []
        if camera_id:
            conditions.append("s.camera_id = ?")
            params.append(camera_id)
        if is_overspeed is not None:
            conditions.append("s.is_overspeed = ?")
            params.append(1 if is_overspeed else 0)
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY s.timestamp DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(query, tuple(params)).fetchall()
        return [dict(row) for row in rows]

def get_speed_dashboard_stats(camera_id: str = None):
    with get_db() as conn:
        query_base = "FROM vehicle_speed_logs"
        params = []
        if camera_id:
            query_base += " WHERE camera_id = ?"
            params.append(camera_id)

        agg = conn.execute(
            f"SELECT COUNT(*) as total_vehicles, "
            f"COALESCE(MAX(speed_kmh), 0) as max_speed, "
            f"COALESCE(AVG(speed_kmh), 0) as avg_speed, "
            f"SUM(CASE WHEN is_overspeed = 1 THEN 1 ELSE 0 END) as total_overspeed "
            f"{query_base}",
            tuple(params)
        ).fetchone()

        by_type_rows = conn.execute(
            f"SELECT vehicle_type, COUNT(*) as count, MAX(speed_kmh) as max_spd, AVG(speed_kmh) as avg_spd "
            f"{query_base} GROUP BY vehicle_type",
            tuple(params)
        ).fetchall()

        by_lane_rows = conn.execute(
            f"SELECT lane, COUNT(*) as count, MAX(speed_kmh) as max_spd, AVG(speed_kmh) as avg_spd "
            f"{query_base} GROUP BY lane",
            tuple(params)
        ).fetchall()

        return {
            "total_vehicles": agg["total_vehicles"] if agg else 0,
            "max_speed": round(agg["max_speed"], 1) if agg else 0.0,
            "avg_speed": round(agg["avg_speed"], 1) if agg else 0.0,
            "total_overspeed": agg["total_overspeed"] if agg else 0,
            "by_vehicle_type": {row["vehicle_type"]: {"count": row["count"], "max_speed": round(row["max_spd"], 1), "avg_speed": round(row["avg_spd"], 1)} for row in by_type_rows if row["vehicle_type"]},
            "by_lane": {row["lane"] or "Default": {"count": row["count"], "max_speed": round(row["max_spd"], 1), "avg_speed": round(row["avg_spd"], 1)} for row in by_lane_rows if row["lane"]}
        }


def get_recording_settings() -> dict:
    """Retrieve recording configuration (segment minutes and detection burn-in flag)."""
    with get_db() as conn:
        row_seg = conn.execute("SELECT value FROM system_settings WHERE key = 'recording_segment_minutes'").fetchone()
        row_det = conn.execute("SELECT value FROM system_settings WHERE key = 'recording_with_detections'").fetchone()
        seg = int(row_seg["value"]) if row_seg else 10
        det = (row_det["value"].lower() in ("true", "1")) if row_det else True
        return {"segment_minutes": seg, "record_with_detections": det}


def save_recording_settings(segment_minutes: int, record_with_detections: bool):
    """Persist recording configuration settings."""
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('recording_segment_minutes', ?)", (str(int(segment_minutes)),))
        conn.execute("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('recording_with_detections', ?)", ("true" if record_with_detections else "false",))
        conn.commit()
