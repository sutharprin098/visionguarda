#include "security_module.hpp"
#include <iostream>
#include <sstream>
#include <cmath>
#include <algorithm>

namespace CamAI {

SecurityModule::SecurityModule() {
    intrusion_roi_ = {{0.1f, 0.1f}, {0.9f, 0.1f}, {0.9f, 0.9f}, {0.1f, 0.9f}};
    tripwire_ = {{0.1f, 0.5f}, {0.9f, 0.5f}};
}

bool SecurityModule::initialize(const std::string& config_params) {
    (void)config_params;
    tracks_.clear();
    return true;
}

void SecurityModule::set_intrusion_roi(const std::vector<Point2D>& polygon) {
    if (polygon.size() >= 3) intrusion_roi_ = polygon;
}

void SecurityModule::set_tripwire(const Point2D& p1, const Point2D& p2) {
    tripwire_ = {p1, p2};
}

bool SecurityModule::is_point_in_polygon(const Point2D& pt, const std::vector<Point2D>& poly) {
    if (poly.size() < 3) return false;
    bool inside = false;
    size_t n = poly.size();
    for (size_t i = 0, j = n - 1; i < n; j = i++) {
        if (((poly[i].y > pt.y) != (poly[j].y > pt.y)) &&
            (pt.x < (poly[j].x - poly[i].x) * (pt.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)) {
            inside = !inside;
        }
    }
    return inside;
}

static float ccw(Point2D A, Point2D B, Point2D C) {
    return (C.y - A.y) * (B.x - A.x) - (B.y - A.y) * (C.x - A.x);
}

bool SecurityModule::do_lines_intersect(const Point2D& p1, const Point2D& q1, const Point2D& p2, const Point2D& q2) {
    return (ccw(p1, p2, q2) * ccw(q1, p2, q2) < 0.0f) && (ccw(p1, q1, p2) * ccw(p1, q1, q2) < 0.0f);
}

bool SecurityModule::process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) {
    int person_count = 0;
    int crowd_in_zone = 0;

    for (const auto& det : frame_meta.detections) {
        std::string lbl = det.label;
        int cid = det.class_id;

        bool is_person = (cid == 0 || lbl == "person" || lbl == "worker" || lbl == "customer" || lbl == "intruder");
        bool is_vehicle = (cid == 2 || cid == 3 || cid == 5 || cid == 7 || lbl == "car" || lbl == "truck" || lbl == "motorcycle");
        bool is_item = (lbl == "backpack" || lbl == "handbag" || lbl == "suitcase" || lbl == "umbrella");
        bool is_fire = (lbl == "fire");
        bool is_smoke = (lbl == "smoke");
        bool is_face = (lbl == "face");

        if (is_person) person_count++;

        Point2D center = {det.x + det.w * 0.5f, det.y + det.h * 0.5f};
        Point2D feet = {det.x + det.w * 0.5f, det.y + det.h};

        // 1. PERSON DETECTION
        if (enable_person_ && is_person && det.confidence >= 0.40f) {
            EventAlert alert;
            alert.event_type = "PERSON_LOCATED";
            alert.module_name = "security";
            alert.track_id = det.track_id;
            alert.bbox = det;
            alert.confidence = det.confidence;
            alert.timestamp_ms = frame_meta.timestamp_ms;
            alert.details = "Subject tracked in perimeter view";
            out_alerts.push_back(alert);
        }

        // 2. INTRUSION & RESTRICTED AREA
        if ((enable_intrusion_ || enable_restricted_area_) && (is_person || is_vehicle)) {
            if (is_point_in_polygon(feet, intrusion_roi_)) {
                crowd_in_zone++;
                EventAlert alert;
                alert.event_type = enable_restricted_area_ ? "RESTRICTED_AREA_BREACH" : "INTRUSION";
                alert.module_name = "security";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = enable_restricted_area_ ? "Unauthorized presence in high-security restricted area" : "Object entered protected intrusion perimeter ROI";
                out_alerts.push_back(alert);
            }
        }

        // 3. PERIMETER TRIPWIRE
        if (enable_perimeter_ && det.track_id >= 0 && (is_person || is_vehicle)) {
            auto it = tracks_.find(det.track_id);
            if (it != tracks_.end()) {
                if (do_lines_intersect(it->second.last_pos, center, tripwire_.p1, tripwire_.p2)) {
                    EventAlert alert;
                    alert.event_type = "PERIMETER_LINE_CROSSING";
                    alert.module_name = "security";
                    alert.track_id = det.track_id;
                    alert.bbox = det;
                    alert.confidence = det.confidence;
                    alert.timestamp_ms = frame_meta.timestamp_ms;
                    alert.details = "Security tripwire boundary crossed";
                    out_alerts.push_back(alert);
                }
            }
        }

        // 4. LOITERING & DWELL TIME
        if (det.track_id >= 0 && is_person) {
            auto& trk = tracks_[det.track_id];
            if (trk.first_seen_ms == 0) {
                trk.track_id = det.track_id;
                trk.first_seen_ms = frame_meta.timestamp_ms;
            }
            trk.last_seen_ms = frame_meta.timestamp_ms;
            trk.last_pos = center;

            float dwell_sec = (frame_meta.timestamp_ms - trk.first_seen_ms) / 1000.0f;
            if (enable_loitering_ && dwell_sec >= loiter_threshold_sec_) {
                EventAlert alert;
                alert.event_type = "LOITERING_DETECTED";
                alert.module_name = "security";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "Subject loitering for " + std::to_string((int)dwell_sec) + "s in camera zone";
                out_alerts.push_back(alert);
            }
        }

        // 5. OBJECT LEFT BEHIND (ABANDONED)
        if (enable_object_left_ && is_item && det.confidence >= 0.45f) {
            EventAlert alert;
            alert.event_type = "OBJECT_ABANDONED";
            alert.module_name = "security";
            alert.track_id = det.track_id;
            alert.bbox = det;
            alert.confidence = det.confidence;
            alert.timestamp_ms = frame_meta.timestamp_ms;
            alert.details = "Unattended bag/item detected static in secure zone";
            out_alerts.push_back(alert);
        }

        // 6. FIRE & SMOKE
        if (enable_fire_ && is_fire && det.confidence >= 0.45f) {
            EventAlert alert;
            alert.event_type = "FIRE_ALARM";
            alert.module_name = "security";
            alert.track_id = det.track_id;
            alert.bbox = det;
            alert.confidence = det.confidence;
            alert.timestamp_ms = frame_meta.timestamp_ms;
            alert.details = "Flame/Fire detected in facility";
            out_alerts.push_back(alert);
        }
        if (enable_smoke_ && is_smoke && det.confidence >= 0.45f) {
            EventAlert alert;
            alert.event_type = "SMOKE_ALARM";
            alert.module_name = "security";
            alert.track_id = det.track_id;
            alert.bbox = det;
            alert.confidence = det.confidence;
            alert.timestamp_ms = frame_meta.timestamp_ms;
            alert.details = "Smoke plume detected";
            out_alerts.push_back(alert);
        }

        // 7. FALL DETECTION
        if (enable_fall_ && is_person && (det.w / std::max(0.001f, det.h)) > 1.25f && det.confidence >= 0.45f) {
            EventAlert alert;
            alert.event_type = "FALL_INCIDENT";
            alert.module_name = "security";
            alert.track_id = det.track_id;
            alert.bbox = det;
            alert.confidence = det.confidence;
            alert.timestamp_ms = frame_meta.timestamp_ms;
            alert.details = "Person down / sudden fall detected";
            out_alerts.push_back(alert);
        }
    }

    // 8. CROWD GATHERING
    if (enable_crowd_ && (person_count >= crowd_threshold_ || crowd_in_zone >= crowd_threshold_)) {
        EventAlert alert;
        alert.event_type = "CROWD_DENSITY_ALERT";
        alert.module_name = "security";
        alert.confidence = 0.90f;
        alert.timestamp_ms = frame_meta.timestamp_ms;
        alert.details = "High density crowd gathering (" + std::to_string(std::max(person_count, crowd_in_zone)) + " people)";
        out_alerts.push_back(alert);
    }

    return true;
}

void SecurityModule::update_config(const std::string& key, const std::string& value) {
    bool b_val = (value == "true" || value == "1");
    if (key == "person_detection" || key == "EnablePersonDetection") enable_person_ = b_val;
    else if (key == "intrusion_detection" || key == "EnableIntrusionDetection") enable_intrusion_ = b_val;
    else if (key == "restricted_area") enable_restricted_area_ = b_val;
    else if (key == "perimeter_protection" || key == "EnableSecurityModule") enable_perimeter_ = b_val;
    else if (key == "loitering") enable_loitering_ = b_val;
    else if (key == "dwell_time") enable_dwell_time_ = b_val;
    else if (key == "crowd_detection") enable_crowd_ = b_val;
    else if (key == "person_counting") enable_counting_ = b_val;
    else if (key == "object_left_behind") enable_object_left_ = b_val;
    else if (key == "object_removed") enable_object_removed_ = b_val;
    else if (key == "face_detection") enable_face_ = b_val;
    else if (key == "face_recognition") enable_face_rec_ = b_val;
    else if (key == "fire_detection") enable_fire_ = b_val;
    else if (key == "smoke_detection") enable_smoke_ = b_val;
    else if (key == "fall_detection") enable_fall_ = b_val;
    else if (key == "IntrusionROICoords") {
        std::vector<Point2D> pts;
        std::stringstream ss(value);
        std::string item;
        while (std::getline(ss, item, ';')) {
            float x, y;
            if (sscanf(item.c_str(), "%f,%f", &x, &y) == 2) {
                if (x > 1.0f) x /= 1920.0f;
                if (y > 1.0f) y /= 1080.0f;
                pts.push_back({x, y});
            }
        }
        if (pts.size() >= 3) intrusion_roi_ = pts;
    }
}

void SecurityModule::shutdown() {
    tracks_.clear();
}

} // namespace CamAI
