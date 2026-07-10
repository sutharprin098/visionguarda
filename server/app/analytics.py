import time
import cv2
import numpy as np

# --- Geometry Utilities ---

def ccw(A, B, C):
    """Check if points A, B, C are in counter-clockwise order."""
    return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0])

def check_line_intersection(A, B, C, D):
    """Check if line segment AB intersects segment CD."""
    return ccw(A, C, D) != ccw(B, C, D) and ccw(A, B, C) != ccw(A, B, D)

def get_point_line_side(P, A, B):
    """
    Determine which side of the line AB the point P lies on.
    Returns > 0 for one side, < 0 for the other, 0 on the line.
    """
    return (P[0] - A[0]) * (B[1] - A[1]) - (P[1] - A[1]) * (B[0] - A[0])


# --- Analytics Engines ---

class CameraAnalytics:
    def __init__(self, camera_id: str):
        self.camera_id = camera_id
        
        # Track history: {track_id: list of [x, y] centroids}
        self.track_history = {}
        self.track_history_maxlen = 30
        
        # New track state mappings
        self.track_classes = {}   # track_id -> class_name
        self.bbox_history = {}    # track_id -> bbox {x1, y1, x2, y2}
        self.track_speeds = {}    # track_id -> speed (km/h)
        self.track_last_pts = {}  # track_id -> (timestamp, (cx, cy))
        
        # Line-crossed tracker to avoid multiple counts: {line_id: set(track_ids)}
        self.crossed_ids = {}
        
        # Heatmap grid: 32x32 resolution
        self.heatmap_grid = np.zeros((32, 32), dtype=np.float32)
        
        # Global Counters
        self.counter_in = 0
        self.counter_out = 0
        self.counter_in_person = 0
        self.counter_out_person = 0
        self.counter_in_vehicle = 0
        self.counter_out_vehicle = 0
        
        # Alert timestamps to prevent spam: {alert_key: last_trigger_time}
        self.alert_cooldowns = {}
        self.cooldown_period = 3.0
        
        # --- Advanced Zone & Line Metrics Persistence ---
        # {zone_id: {track_id: enter_time}}
        self.zone_active_tracks = {}
        # {zone_id: list of dwell_time floats}
        self.zone_dwell_history = {}
        # {zone_id: max_occupancy}
        self.zone_max_occupancy = {}
        # {zone_id: entry_count}
        self.zone_entry_counts = {}
        # {zone_id: exit_count}
        self.zone_exit_counts = {}
        # {zone_id: count of frames occupied}
        self.zone_occupied_frames = {}
        # {zone_id: total frames evaluated}
        self.zone_total_frames = {}
        
        # {line_id: {in_count, out_count}}
        self.line_counters = {}

    def update(self, detections, zones, lines, frame_w: int = 640, frame_h: int = 480):
        active_track_ids = set()
        alerts = []
        now = time.time()
        
        # Read or initialize metadata tracking structures
        for zone in zones:
            z_id = zone["id"]
            if z_id not in self.zone_active_tracks:
                self.zone_active_tracks[z_id] = {}
            if z_id not in self.zone_dwell_history:
                self.zone_dwell_history[z_id] = []
            if z_id not in self.zone_max_occupancy:
                self.zone_max_occupancy[z_id] = 0
            if z_id not in self.zone_entry_counts:
                self.zone_entry_counts[z_id] = 0
            if z_id not in self.zone_exit_counts:
                self.zone_exit_counts[z_id] = 0
            if z_id not in self.zone_occupied_frames:
                self.zone_occupied_frames[z_id] = 0
            if z_id not in self.zone_total_frames:
                self.zone_total_frames[z_id] = 0
                
        for line in lines:
            l_id = line["id"]
            if l_id not in self.line_counters:
                self.line_counters[l_id] = {"in_count": 0, "out_count": 0}

        # Process active detections
        for det in detections:
            track_id = det.get("track_id")
            class_name = det.get("class", "person")
            
            if track_id is None:
                continue
            
            active_track_ids.add(track_id)
            self.track_classes[track_id] = class_name
            
            bbox = det["bbox"]
            
            # EMA Smoothing
            if track_id in self.bbox_history:
                alpha = 0.5
                old_bbox = self.bbox_history[track_id]
                bbox["x1"] = int(alpha * bbox["x1"] + (1 - alpha) * old_bbox["x1"])
                bbox["y1"] = int(alpha * bbox["y1"] + (1 - alpha) * old_bbox["y1"])
                bbox["x2"] = int(alpha * bbox["x2"] + (1 - alpha) * old_bbox["x2"])
                bbox["y2"] = int(alpha * bbox["y2"] + (1 - alpha) * old_bbox["y2"])
            self.bbox_history[track_id] = bbox
            
            # Centroid
            cx = (bbox["x1"] + bbox["x2"]) / 2.0 / frame_w
            cy = (bbox["y1"] + bbox["y2"]) / 2.0 / frame_h
            bottom_x = cx
            bottom_y = bbox["y2"] / frame_h  # bottom edge collision point
            
            # Speed Estimation
            speed = 0.0
            if track_id in self.track_last_pts:
                last_time, (last_cx, last_cy) = self.track_last_pts[track_id]
                dt = now - last_time
                if dt >= 0.1:
                    dx = cx - last_cx
                    dy = cy - last_cy
                    dist = np.sqrt(dx*dx + dy*dy)
                    raw_speed = (dist / dt) * 100.0 / (cy + 0.2)
                    
                    if class_name == "person":
                        raw_speed = min(raw_speed * 0.15, 15.0)
                    else:
                        raw_speed = min(raw_speed * 0.6, 120.0)
                        
                    if raw_speed < 1.5:
                        raw_speed = 0.0
                        
                    prev_speed = self.track_speeds.get(track_id, 0.0)
                    speed = 0.7 * prev_speed + 0.3 * raw_speed
                    self.track_speeds[track_id] = speed
                    self.track_last_pts[track_id] = (now, (cx, cy))
                else:
                    speed = self.track_speeds.get(track_id, 0.0)
            else:
                self.track_last_pts[track_id] = (now, (cx, cy))
                self.track_speeds[track_id] = 0.0
            
            det["speed"] = speed
            
            # Update Track History
            if track_id not in self.track_history:
                self.track_history[track_id] = []
            self.track_history[track_id].append([cx, cy])
            if len(self.track_history[track_id]) > self.track_history_maxlen:
                self.track_history[track_id].pop(0)

            # Accumulate Heatmap
            grid_x = min(max(int(cx * 32), 0), 31)
            grid_y = min(max(int(cy * 32), 0), 31)
            self.heatmap_grid[grid_y, grid_x] += 0.5

        # --- Advanced Zone Analytics ---
        zone_stats = {}
        for zone in zones:
            z_id = zone["id"]
            z_name = zone.get("name", "Zone")
            shape_type = zone.get("shapeType", "polygon")
            zone_type = zone.get("zoneType", "intrusion")
            max_occupancy = zone.get("maxOccupancy", 5)
            dwell_limit = zone.get("dwellLimit", 10)
            pts = zone["points"]
            
            self.zone_total_frames[z_id] += 1
            
            # 1. Identify which active tracks are inside this zone
            tracks_inside_this_frame = set()
            
            if len(pts) >= 2:
                for track_id in active_track_ids:
                    hist = self.track_history.get(track_id, [])
                    if not hist:
                        continue
                    # Check collision at the bottom edge (bottom-center)
                    px = hist[-1][0]
                    py = hist[-1][1]
                    
                    is_inside = False
                    if shape_type == "circle" and len(pts) >= 2:
                        # Circle is defined by center pts[0] and edge pts[1]
                        cx_c, cy_c = pts[0][0], pts[0][1]
                        ex_c, ey_c = pts[1][0], pts[1][1]
                        radius = np.sqrt((ex_c - cx_c)**2 + (ey_c - cy_c)**2)
                        dist = np.sqrt((px - cx_c)**2 + (py - cy_c)**2)
                        is_inside = dist <= radius
                    elif shape_type in ["rect", "rectangle"] and len(pts) >= 2:
                        x1 = min(pts[0][0], pts[1][0])
                        x2 = max(pts[0][0], pts[1][0])
                        y1 = min(pts[0][1], pts[1][1])
                        y2 = max(pts[0][1], pts[1][1])
                        is_inside = (x1 <= px <= x2) and (y1 <= py <= y2)
                    else:
                        # Polygon or Freehand Zone
                        poly_points = np.array(pts, dtype=np.float32)
                        is_inside = cv2.pointPolygonTest(poly_points, (px, py), False) >= 0
                        
                    if is_inside:
                        tracks_inside_this_frame.add(track_id)
            
            # 2. Compute Entry, Exit, and Dwell metrics
            people_count = 0
            vehicles_count = 0
            loitering_count = 0
            
            current_active = self.zone_active_tracks[z_id] # track_id -> enter_time
            
            # Entries
            for tid in tracks_inside_this_frame:
                if tid not in current_active:
                    current_active[tid] = now
                    self.zone_entry_counts[z_id] += 1
                    
                    # Entry alerts
                    class_name = self.track_classes.get(tid, "person")
                    is_vehicle = class_name in ["car", "bus", "truck", "motorcycle", "bicycle"]
                    alert_type = "vehicle_entry" if is_vehicle else "human_entry"
                    
                    alert_key = f"{alert_type}_{z_id}_{tid}"
                    if now - self.alert_cooldowns.get(alert_key, 0) > self.cooldown_period:
                        alerts.append({
                            "type": alert_type,
                            "message": f"{class_name.capitalize()} (ID: {tid}) entered {zone_type} Zone '{z_name}'",
                            "zone_id": z_id
                        })
                        self.alert_cooldowns[alert_key] = now
                        
            # Exits
            exited_tids = []
            for tid in list(current_active.keys()):
                if tid not in tracks_inside_this_frame:
                    enter_time = current_active.pop(tid)
                    exited_tids.append(tid)
                    self.zone_exit_counts[z_id] += 1
                    
                    # Calculate completed dwell duration
                    dwell_duration = now - enter_time
                    self.zone_dwell_history[z_id].append(dwell_duration)
                    if len(self.zone_dwell_history[z_id]) > 50:
                        self.zone_dwell_history[z_id].pop(0)
            
            # Current class classification inside zone
            for tid in tracks_inside_this_frame:
                cls_name = self.track_classes.get(tid, "person")
                if cls_name == "person":
                    people_count += 1
                else:
                    vehicles_count += 1
                
                # Check loitering
                enter_t = current_active.get(tid, now)
                time_inside = now - enter_t
                if time_inside > float(dwell_limit):
                    loitering_count += 1
                    alert_key = f"loitering_{z_id}_{tid}"
                    if now - self.alert_cooldowns.get(alert_key, 0) > 10.0:
                        alerts.append({
                            "type": "loitering",
                            "message": f"{cls_name.capitalize()} ID:{tid} loitering in '{z_name}' for {int(time_inside)}s",
                            "zone_id": z_id
                        })
                        self.alert_cooldowns[alert_key] = now

            # Overcrowding / Occupancy stats
            occupancy = people_count + vehicles_count
            if occupancy > 0:
                self.zone_occupied_frames[z_id] += 1
                
            self.zone_max_occupancy[z_id] = max(self.zone_max_occupancy[z_id], occupancy)
            
            # Overcrowding Warning
            if occupancy > int(max_occupancy):
                alert_key = f"overcrowding_{z_id}"
                if now - self.alert_cooldowns.get(alert_key, 0) > 10.0:
                    alerts.append({
                        "type": "overcrowding",
                        "message": f"Overcrowding Alert in '{z_name}': {occupancy}/{max_occupancy} objects detected!",
                        "zone_id": z_id
                    })
                    self.alert_cooldowns[alert_key] = now
                    
            # Zone Empty/Full transition alerts
            if occupancy == 0 and len(exited_tids) > 0:
                alert_key = f"zone_empty_{z_id}"
                if now - self.alert_cooldowns.get(alert_key, 0) > 5.0:
                    alerts.append({
                        "type": "zone_empty",
                        "message": f"Zone '{z_name}' is now empty",
                        "zone_id": z_id
                    })
                    self.alert_cooldowns[alert_key] = now
            elif occupancy >= int(max_occupancy) and occupancy > 0:
                alert_key = f"zone_full_{z_id}"
                if now - self.alert_cooldowns.get(alert_key, 0) > 10.0:
                    alerts.append({
                        "type": "zone_full",
                        "message": f"Zone '{z_name}' has reached capacity ({occupancy}/{max_occupancy})",
                        "zone_id": z_id
                    })
                    self.alert_cooldowns[alert_key] = now

            # Average dwell time calculation
            dwells = self.zone_dwell_history[z_id]
            avg_dwell = float(np.mean(dwells)) if dwells else 0.0
            
            # Utilization (frame occupancy ratio)
            util = float(self.zone_occupied_frames[z_id]) / max(1.0, float(self.zone_total_frames[z_id]))

            zone_stats[z_id] = {
                "people_count": people_count,
                "vehicles_count": vehicles_count,
                "occupancy": occupancy,
                "max_occupancy": self.zone_max_occupancy[z_id],
                "entry_count": self.zone_entry_counts[z_id],
                "exit_count": self.zone_exit_counts[z_id],
                "avg_dwell_time": round(avg_dwell, 1),
                "loitering_count": loitering_count,
                "utilization": round(util * 100, 1),
                "status": "danger" if loitering_count > 0 or occupancy > int(max_occupancy) else "normal"
            }

        # --- Advanced Line Crossing Analytics ---
        line_stats = {}
        for line in lines:
            l_id = line["id"]
            l_name = line.get("name", "Line")
            line_pts = line["points"]
            line_type = line.get("lineType", "crossing") # entry_counting, exit_counting, wrong_direction, etc
            
            if len(line_pts) < 2:
                continue
                
            A, B = line_pts[0], line_pts[1]
            
            if l_id not in self.crossed_ids:
                self.crossed_ids[l_id] = set()
                
            for track_id in active_track_ids:
                if track_id in self.crossed_ids[l_id]:
                    continue
                    
                hist = self.track_history.get(track_id, [])
                if len(hist) < 2:
                    continue
                    
                p_prev = hist[-2]
                p_curr = hist[-1]
                
                # Check line intersection
                if check_line_intersection(p_prev, p_curr, A, B):
                    self.crossed_ids[l_id].add(track_id)
                    
                    side_prev = get_point_line_side(p_prev, A, B)
                    side_curr = get_point_line_side(p_curr, A, B)
                    
                    class_name = self.track_classes.get(track_id, "person")
                    is_vehicle = class_name in ["car", "bus", "truck", "motorcycle", "bicycle"]
                    
                    # Crossing events
                    is_in = side_prev < 0 <= side_curr
                    is_out = side_prev > 0 >= side_curr
                    
                    if is_in:
                        self.line_counters[l_id]["in_count"] += 1
                        if is_vehicle:
                            self.counter_in_vehicle += 1
                        else:
                            self.counter_in_person += 1
                        self.counter_in += 1
                        
                        # Raise Alert
                        alert_key = f"crossing_{l_id}_{track_id}"
                        if now - self.alert_cooldowns.get(alert_key, 0) > self.cooldown_period:
                            alerts.append({
                                "type": "crossing",
                                "message": f"{class_name.capitalize()} crossed line '{l_name}' (Entry, ID: {track_id})",
                                "line_id": l_id
                            })
                            self.alert_cooldowns[alert_key] = now
                            
                    elif is_out:
                        self.line_counters[l_id]["out_count"] += 1
                        if is_vehicle:
                            self.counter_out_vehicle += 1
                        else:
                            self.counter_out_person += 1
                        self.counter_out += 1
                        
                        # Wrong Direction / Reverse checks
                        if line_type in ["one_way", "wrong_direction"]:
                            alert_key = f"wrong_dir_{l_id}_{track_id}"
                            if now - self.alert_cooldowns.get(alert_key, 0) > self.cooldown_period:
                                alerts.append({
                                    "type": "wrong_direction",
                                    "message": f"Wrong Direction Alarm: {class_name.capitalize()} (ID: {track_id}) crossed '{l_name}' backward!",
                                    "line_id": l_id
                                })
                                self.alert_cooldowns[alert_key] = now
                        else:
                            # Standard Exit Alert
                            alert_key = f"crossing_{l_id}_{track_id}"
                            if now - self.alert_cooldowns.get(alert_key, 0) > self.cooldown_period:
                                alerts.append({
                                    "type": "crossing",
                                    "message": f"{class_name.capitalize()} crossed line '{l_name}' (Exit, ID: {track_id})",
                                    "line_id": l_id
                                })
                                self.alert_cooldowns[alert_key] = now

            line_stats[l_id] = {
                "in_count": self.line_counters[l_id]["in_count"],
                "out_count": self.line_counters[l_id]["out_count"],
                "total_count": self.line_counters[l_id]["in_count"] + self.line_counters[l_id]["out_count"]
            }

        # Cleanup disappeared tracks (avoid memory leaks)
        dead_tracks = [tid for tid in list(self.track_history.keys()) if tid not in active_track_ids]
        for tid in dead_tracks:
            if tid in self.track_history: del self.track_history[tid]
            if tid in self.track_classes: del self.track_classes[tid]
            if tid in self.bbox_history: del self.bbox_history[tid]
            if tid in self.track_speeds: del self.track_speeds[tid]
            if tid in self.track_last_pts: del self.track_last_pts[tid]

            # Clean active track zone bindings
            for z_id in self.zone_active_tracks:
                if tid in self.zone_active_tracks[z_id]:
                    enter_t = self.zone_active_tracks[z_id].pop(tid)
                    dwell_duration = now - enter_t
                    self.zone_dwell_history[z_id].append(dwell_duration)

            for line_id in self.crossed_ids:
                self.crossed_ids[line_id].discard(tid)

            # alert_cooldowns keys are suffixed with the track_id (e.g.
            # "crossing_{line}_{tid}", "loitering_{zone}_{tid}") and are never
            # touched elsewhere. Track IDs churn constantly under ByteTrack,
            # so leaving these in place made the dict grow without bound for
            # the lifetime of the camera thread.
            suffix = f"_{tid}"
            for key in [k for k in self.alert_cooldowns if k.endswith(suffix)]:
                del self.alert_cooldowns[key]

        # Decay heatmap slightly
        self.heatmap_grid *= 0.995

        # Format track overlays for UI drawing (recent tail path)
        track_overlays = []
        for tid, pts in self.track_history.items():
            track_overlays.append({
                "track_id": tid,
                "class": self.track_classes.get(tid, "person"),
                "points": pts
            })

        # Serialize heatmap grid
        heatmap_list = self.heatmap_grid.tolist()

        return alerts, track_overlays, heatmap_list, zone_stats, line_stats

    def reset_counters(self):
        self.counter_in = 0
        self.counter_out = 0
        self.counter_in_person = 0
        self.counter_out_person = 0
        self.counter_in_vehicle = 0
        self.counter_out_vehicle = 0
        self.zone_active_tracks.clear()
        self.zone_dwell_history.clear()
        self.zone_max_occupancy.clear()
        self.zone_entry_counts.clear()
        self.zone_exit_counts.clear()
        self.zone_occupied_frames.clear()
        self.zone_total_frames.clear()
        self.line_counters.clear()
        self.crossed_ids.clear()
