import sqlite3
import json
import time
from datetime import datetime
from app.config import DB_PATH, RECORDINGS_DIR

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
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
                FOREIGN KEY(camera_id) REFERENCES cameras(id) ON DELETE CASCADE
            )
        """)

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

        # No default/placeholder cameras are seeded here. The desktop app is
        # the sole source of truth for which cameras exist — it registers
        # (POST /api/cameras) exactly what the cloud assigns to this device
        # (see desktop/src/lib/localEngine.ts syncCamerasToLocalEngine) and
        # nothing else. Seeding fake rows ("cam_default"/"live_webcam"/
        # "live_screenshare") here used to make this table diverge from the
        # cloud's camera list on every fresh install — the engine would
        # report 3+ "active" cameras nothing in the UI ever referenced,
        # while the one real cloud-assigned camera raced its own
        # registration. One-time migration below removes any of these rows
        # left over from that seeding on existing installs.
        for legacy_id in ("cam_default", "live_webcam", "live_screenshare"):
            conn.execute("DELETE FROM cameras WHERE id = ?", (legacy_id,))
        conn.commit()

# --- Database APIs ---

# Cameras
def get_all_cameras():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM cameras").fetchall()
        return [dict(row) for row in rows]

def get_camera(camera_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM cameras WHERE id = ?", (camera_id,)).fetchone()
        return dict(row) if row else None

def save_camera(camera_id: str, name: str, type_: str, source: str, is_active: int, zones: str = "[]", lines: str = "[]", rules: str = "[]", zone_profile: str = None, profile_features: str = "{}"):
    with get_db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO cameras (id, name, type, source, is_active, zones, lines, rules, zone_profile, profile_features)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (camera_id, name, type_, source, is_active, zones, lines, rules, zone_profile, profile_features))
        conn.commit()

def delete_camera(camera_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM cameras WHERE id = ?", (camera_id,))
        conn.commit()

# Alerts
def insert_alert(alert_id: str, camera_id: str, alert_type: str, message: str, screenshot_path: str = None, video_path: str = None):
    with get_db() as conn:
        timestamp = datetime.utcnow().isoformat() + "Z"
        conn.execute("""
            INSERT INTO alerts (id, timestamp, camera_id, alert_type, message, screenshot_path, video_path)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (alert_id, timestamp, camera_id, alert_type, message, screenshot_path, video_path))
        conn.commit()

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
    with get_db() as conn:
        timestamp = datetime.utcnow().isoformat() + "Z"
        conn.execute("""
            INSERT INTO history (id, timestamp, camera_id, people_count, max_confidence, processing_time, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (rec_id, timestamp, camera_id, people_count, max_conf, proc_time, status))
        conn.commit()

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
    with get_db() as conn:
        conn.execute("""
            INSERT INTO recordings (id, camera_id, start_time, recording_type, file_path)
            VALUES (?, ?, ?, ?, ?)
        """, (rec_id, camera_id, start_time, type_, file_path))
        conn.commit()

def end_recording_entry(rec_id: str, end_time: str):
    with get_db() as conn:
        conn.execute("UPDATE recordings SET end_time = ? WHERE id = ?", (end_time, rec_id))
        conn.commit()

def get_all_recordings():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT r.*, c.name as camera_name
            FROM recordings r
            LEFT JOIN cameras c ON r.camera_id = c.id
            ORDER BY r.start_time DESC
        """, ()).fetchall()
        records = [dict(row) for row in rows]

    # Filter out recordings whose file is missing or too small to contain a
    # valid MP4 container (moov atom etc). This happens when a recorder was
    # killed ungracefully (crash, force-kill, unclean shutdown) before
    # cv2.VideoWriter.release() could finalize the file — the DB row exists
    # and looks legitimate, but the video can never actually play. Without
    # this filter these show up in the Recordings UI as clickable cards that
    # open a playback modal with a permanently-broken <video>.
    # 1KB is comfortably below any real encoded segment (even a single
    # frame) and comfortably above an empty/header-only stub.
    MIN_VALID_SIZE_BYTES = 1024
    valid = []
    for rec in records:
        filename = (rec.get("file_path") or "").rsplit("/", 1)[-1]
        if not filename:
            continue
        path = RECORDINGS_DIR / filename
        try:
            if path.stat().st_size >= MIN_VALID_SIZE_BYTES:
                valid.append(rec)
        except FileNotFoundError:
            continue
    return valid

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
