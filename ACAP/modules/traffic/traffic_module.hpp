#ifndef CAMAI_TRAFFIC_MODULE_HPP
#define CAMAI_TRAFFIC_MODULE_HPP

#include "../module_interface.hpp"
#include <unordered_map>
#include <string>
#include <vector>
#include <cmath>

namespace CamAI {

struct TrafficTrackHistory {
    float last_x{0.0f};
    float last_y{0.0f};
    uint64_t last_ts{0};
    uint64_t first_ts{0};
    float initial_x{0.0f};
    float initial_y{0.0f};
    float last_speed_kmh{-1.0f};
};

class TrafficModule : public ICamAIModule {
public:
    TrafficModule() = default;
    ~TrafficModule() override = default;

    bool initialize(const std::string& config) override {
        (void)config;
        track_history_.clear();
        return true;
    }

    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        for (const auto& det : frame_meta.detections) {
            std::string lbl = det.label;
            int cid = det.class_id;

            bool is_vehicle = (cid == 2 || cid == 3 || cid == 5 || cid == 7 ||
                               lbl == "car" || lbl == "truck" || lbl == "bus" || lbl == "motorcycle" || lbl == "vehicle");
            bool is_plate = (lbl == "number_plate" || lbl == "plate");
            bool is_helmet = (lbl == "helmet" || lbl == "no_helmet");

            float cx = det.x + det.w * 0.5f;
            float cy = det.y + det.h * 0.5f;

            // 1. VEHICLE DETECTION & CLASSIFICATION
            if (enable_vehicle_ && is_vehicle && det.confidence >= 0.35f) {
                EventAlert alert;
                alert.event_type = "VEHICLE_DETECTED";
                alert.module_name = "traffic";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "Vehicle classified: " + lbl + " (Track #" + std::to_string(det.track_id) + ")";
                out_alerts.push_back(alert);
            }

            // 2. SPEED ESTIMATION & OVERSPEED
            if (is_vehicle && det.track_id >= 0) {
                auto& hist = track_history_[det.track_id];
                if (hist.first_ts == 0) {
                    hist.first_ts = frame_meta.timestamp_ms;
                    hist.initial_x = cx;
                    hist.initial_y = cy;
                } else {
                    uint64_t dt_ms = frame_meta.timestamp_ms - hist.last_ts;
                    if (dt_ms > 80 && dt_ms < 2000) {
                        float dx = (cx - hist.last_x) * static_cast<float>(frame_meta.width);
                        float dy = (cy - hist.last_y) * static_cast<float>(frame_meta.height);
                        float px_dist = std::sqrt(dx * dx + dy * dy);

                        if (meters_per_pixel_ > 0.0f) {
                            float speed_mps = (px_dist * meters_per_pixel_) / (static_cast<float>(dt_ms) / 1000.0f);
                            hist.last_speed_kmh = speed_mps * 3.6f;
                        }
                    }
                }
                hist.last_x = cx;
                hist.last_y = cy;
                hist.last_ts = frame_meta.timestamp_ms;

                if (enable_speed_ && hist.last_speed_kmh > speed_limit_kmh_) {
                    EventAlert alert;
                    alert.event_type = "OVERSPEED_VIOLATION";
                    alert.module_name = "traffic";
                    alert.track_id = det.track_id;
                    alert.bbox = det;
                    alert.confidence = det.confidence;
                    alert.timestamp_ms = frame_meta.timestamp_ms;
                    alert.details = "Vehicle #" + std::to_string(det.track_id) + " Speed: " +
                                    std::to_string(static_cast<int>(hist.last_speed_kmh)) + " km/h (Limit: " +
                                    std::to_string(static_cast<int>(speed_limit_kmh_)) + " km/h)";
                    out_alerts.push_back(alert);
                }

                // 3. WRONG WAY DRIVING (Trajectory vector check)
                if (enable_wrong_way_ && hist.last_ts - hist.first_ts > 500) {
                    float total_dy = cy - hist.initial_y;
                    // Northbound expected (dy < 0), if moving south (dy > 0.08)
                    if (allowed_direction_ == "north" && total_dy > 0.08f) {
                        EventAlert alert;
                        alert.event_type = "WRONG_WAY_VIOLATION";
                        alert.module_name = "traffic";
                        alert.track_id = det.track_id;
                        alert.bbox = det;
                        alert.confidence = det.confidence;
                        alert.timestamp_ms = frame_meta.timestamp_ms;
                        alert.details = "CRITICAL: Vehicle moving against permitted direction of travel";
                        out_alerts.push_back(alert);
                    }
                }
            }

            // 4. ANPR / NUMBER PLATE
            if (enable_anpr_ && (is_plate || !det.label.empty() && det.label.find("plate") != std::string::npos)) {
                EventAlert alert;
                alert.event_type = "ANPR_CAPTURED";
                alert.module_name = "traffic";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "License Plate Recognized: " + det.label;
                out_alerts.push_back(alert);
            }

            // 5. HELMET DETECTION
            if (enable_helmet_ && lbl == "no_helmet") {
                EventAlert alert;
                alert.event_type = "HELMET_VIOLATION";
                alert.module_name = "traffic";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "Traffic Safety: Helmetless motorcycle rider detected";
                out_alerts.push_back(alert);
            }
        }

        return true;
    }

    std::string get_name() const override { return "traffic"; }

    void update_config(const std::string& key, const std::string& val) override {
        bool b_val = (val == "true" || val == "1");
        if (key == "vehicle_detection" || key == "EnableTrafficModule") enable_vehicle_ = b_val;
        else if (key == "vehicle_classification") enable_classification_ = b_val;
        else if (key == "multi_object_tracking") enable_tracking_ = b_val;
        else if (key == "vehicle_counting") enable_counting_ = b_val;
        else if (key == "line_crossing") enable_line_crossing_ = b_val;
        else if (key == "wrong_way_detection") enable_wrong_way_ = b_val;
        else if (key == "speed_estimation") enable_speed_ = b_val;
        else if (key == "illegal_parking") enable_illegal_parking_ = b_val;
        else if (key == "stop_line_violation") enable_stop_line_ = b_val;
        else if (key == "u_turn_detection") enable_u_turn_ = b_val;
        else if (key == "anpr") enable_anpr_ = b_val;
        else if (key == "helmet_detection") enable_helmet_ = b_val;
        else if (key == "traffic_light_violation") enable_traffic_light_ = b_val;
        else if (key == "SpeedLimit") {
            try { speed_limit_kmh_ = std::stof(val); } catch (...) {}
        } else if (key == "MetersPerPixel" || key == "CalibrationScale") {
            try { meters_per_pixel_ = std::stof(val); } catch (...) {}
        } else if (key == "allowed_direction") {
            allowed_direction_ = val;
        }
    }

    void shutdown() override {
        track_history_.clear();
    }

private:
    bool enable_vehicle_{true};
    bool enable_classification_{false};
    bool enable_tracking_{true};
    bool enable_counting_{false};
    bool enable_line_crossing_{false};
    bool enable_wrong_way_{false};
    bool enable_speed_{false};
    bool enable_illegal_parking_{false};
    bool enable_stop_line_{false};
    bool enable_u_turn_{false};
    bool enable_anpr_{false};
    bool enable_helmet_{false};
    bool enable_traffic_light_{false};

    float speed_limit_kmh_{45.0f};
    float meters_per_pixel_{0.0f};
    std::string allowed_direction_{"north"};
    std::unordered_map<int, TrafficTrackHistory> track_history_;
};

} // namespace CamAI

#endif // CAMAI_TRAFFIC_MODULE_HPP
