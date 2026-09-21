#include "security_module.hpp"
#include <iostream>
#include <sstream>
#include <cmath>
#include <algorithm>

namespace CamAI {

SecurityModule::SecurityModule() {
    // Default ROI box (centered)
    intrusion_roi_ = {{0.1f, 0.1f}, {0.9f, 0.1f}, {0.9f, 0.9f}, {0.1f, 0.9f}};
    // Default Tripwire line
    tripwire_ = {{0.1f, 0.5f}, {0.9f, 0.5f}};
}

bool SecurityModule::initialize(const std::string& config_params) {
    (void)config_params;
    last_track_positions_.clear();
    track_first_seen_.clear();
    return true;
}

void SecurityModule::set_intrusion_roi(const std::vector<Point2D>& polygon) {
    if (polygon.size() >= 3) {
        intrusion_roi_ = polygon;
    }
}

void SecurityModule::set_tripwire(const Point2D& p1, const Point2D& p2) {
    tripwire_ = {p1, p2};
}

// Ray-casting algorithm for point-in-polygon check
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

// Orientation cross product helper
static float ccw(Point2D A, Point2D B, Point2D C) {
    return (C.y - A.y) * (B.x - A.x) - (B.y - A.y) * (C.x - A.x);
}

// Line intersection logic
bool SecurityModule::do_lines_intersect(const Point2D& p1, const Point2D& q1, const Point2D& p2, const Point2D& q2) {
    return (ccw(p1, p2, q2) * ccw(q1, p2, q2) < 0.0f) && (ccw(p1, q1, p2) * ccw(p1, q1, q2) < 0.0f);
}

bool SecurityModule::process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) {
    for (const auto& det : frame_meta.detections) {
        // Person (0) or Vehicle (2, 3, 5, 7)
        if (det.class_id != 0 && det.class_id != 2 && det.class_id != 3 && det.class_id != 5 && det.class_id != 7) {
            continue;
        }

        Point2D center = {det.x + det.w * 0.5f, det.y + det.h * 0.5f};
        Point2D feet = {det.x + det.w * 0.5f, det.y + det.h};

        // 1. Intrusion Detection
        if (roi_enabled_ && is_point_in_polygon(feet, intrusion_roi_)) {
            EventAlert alert;
            alert.event_type = "INTRUSION";
            alert.module_name = "security";
            alert.track_id = det.track_id;
            alert.bbox = det;
            alert.confidence = det.confidence;
            alert.timestamp_ms = frame_meta.timestamp_ms;
            alert.details = "Object entered restricted perimeter ROI";
            out_alerts.push_back(alert);
        }

        // 2. Line Crossing / Tripwire Detection
        if (tripwire_enabled_ && det.track_id >= 0) {
            auto it = last_track_positions_.find(det.track_id);
            if (it != last_track_positions_.end()) {
                Point2D prev_pos = it->second;
                if (do_lines_intersect(prev_pos, center, tripwire_.p1, tripwire_.p2)) {
                    EventAlert alert;
                    alert.event_type = "LINE_CROSSING";
                    alert.module_name = "security";
                    alert.track_id = det.track_id;
                    alert.bbox = det;
                    alert.confidence = det.confidence;
                    alert.timestamp_ms = frame_meta.timestamp_ms;
                    alert.details = "Object crossed tripwire boundary";
                    out_alerts.push_back(alert);
                }
            }
            last_track_positions_[det.track_id] = center;
        }
    }
    return true;
}

void SecurityModule::update_config(const std::string& key, const std::string& value) {
    if (key == "IntrusionROICoords") {
        // Parse semicolon-separated coordinates: "x1,y1;x2,y2;..."
        std::vector<Point2D> pts;
        std::stringstream ss(value);
        std::string item;
        while (std::getline(ss, item, ';')) {
            float x, y;
            if (sscanf(item.c_str(), "%f,%f", &x, &y) == 2) {
                // Normalize if given in pixel coords > 1.0
                if (x > 1.0f) x /= 1920.0f;
                if (y > 1.0f) y /= 1080.0f;
                pts.push_back({x, y});
            }
        }
        if (pts.size() >= 3) {
            intrusion_roi_ = pts;
        }
    } else if (key == "TripwireCoords") {
        float x1, y1, x2, y2;
        if (sscanf(value.c_str(), "%f,%f;%f,%f", &x1, &y1, &x2, &y2) == 4) {
            if (x1 > 1.0f) x1 /= 1920.0f;
            if (y1 > 1.0f) y1 /= 1080.0f;
            if (x2 > 1.0f) x2 /= 1920.0f;
            if (y2 > 1.0f) y2 /= 1080.0f;
            tripwire_ = {{x1, y1}, {x2, y2}};
        }
    } else if (key == "EnableSecurityModule") {
        roi_enabled_ = (value == "true" || value == "1");
        tripwire_enabled_ = roi_enabled_;
    }
}

void SecurityModule::shutdown() {
    last_track_positions_.clear();
    track_first_seen_.clear();
}

} // namespace CamAI
