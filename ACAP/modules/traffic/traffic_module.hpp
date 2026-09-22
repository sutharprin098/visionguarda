#ifndef CAMAI_TRAFFIC_MODULE_HPP
#define CAMAI_TRAFFIC_MODULE_HPP

#include "../module_interface.hpp"
#include <unordered_map>
#include <string>
#include <vector>
#include <cmath>

namespace CamAI {

struct TrackPositionRecord {
    float x;
    float y;
    uint64_t timestamp_ms;
};

class TrafficModule : public ICamAIModule {
public:
    TrafficModule() = default;
    ~TrafficModule() override = default;

    bool initialize(const std::string& config) override {
        (void)config;
        enabled_ = true;
        speed_limit_kmh_ = 45.0f;
        meters_per_pixel_ = 0.0f; // 0.0f means uncalibrated
        track_history_.clear();
        return true;
    }

    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        if (!enabled_) return true;

        for (const auto& det : frame_meta.detections) {
            // Check for vehicle classes: car (2), motorcycle (3), bus (5), truck (7)
            bool is_vehicle = (det.class_id == 2 || det.class_id == 3 || det.class_id == 5 || det.class_id == 7 ||
                               det.label == "car" || det.label == "vehicle" || det.label == "truck" || det.label == "bus");
            if (!is_vehicle) continue;

            float cx = det.x + det.w * 0.5f;
            float cy = det.y + det.h * 0.5f;

            float calculated_speed_kmh = -1.0f; // Uncalibrated default

            if (det.track_id >= 0) {
                auto it = track_history_.find(det.track_id);
                if (it != track_history_.end()) {
                    uint64_t dt_ms = frame_meta.timestamp_ms - it->second.timestamp_ms;
                    if (dt_ms > 100 && dt_ms < 2000) {
                        float dx_pixels = (cx - it->second.x) * static_cast<float>(frame_meta.width);
                        float dy_pixels = (cy - it->second.y) * static_cast<float>(frame_meta.height);
                        float pixel_dist = std::sqrt(dx_pixels * dx_pixels + dy_pixels * dy_pixels);

                        if (meters_per_pixel_ > 0.0f) {
                            float meters_dist = pixel_dist * meters_per_pixel_;
                            float speed_mps = meters_dist / (static_cast<float>(dt_ms) / 1000.0f);
                            calculated_speed_kmh = speed_mps * 3.6f;
                        }
                    }
                }
                track_history_[det.track_id] = {cx, cy, frame_meta.timestamp_ms};
            }

            // Emit real vehicle detection / overspeed event
            if (det.confidence >= 0.40f) {
                EventAlert alert;
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.module_name = "traffic";

                if (calculated_speed_kmh > 0.0f) {
                    if (calculated_speed_kmh > speed_limit_kmh_) {
                        alert.event_type = "OVERSPEED_VIOLATION";
                        alert.details = "Vehicle #" + std::to_string(det.track_id) + " Speed: " +
                                        std::to_string(static_cast<int>(calculated_speed_kmh)) + " km/h (Limit: " +
                                        std::to_string(static_cast<int>(speed_limit_kmh_)) + " km/h)";
                        out_alerts.push_back(alert);
                    }
                } else {
                    // Uncalibrated state
                    alert.event_type = "VEHICLE_TRACKED";
                    alert.details = "Vehicle (" + det.label + ") Tracked #" + std::to_string(det.track_id) + " [SPEED UNCALIBRATED]";
                }
            }
        }

        return true;
    }

    std::string get_name() const override { return "traffic"; }

    void update_config(const std::string& key, const std::string& val) override {
        if (key == "EnableTrafficModule") {
            enabled_ = (val == "true" || val == "1");
        } else if (key == "SpeedLimit") {
            try { speed_limit_kmh_ = std::stof(val); } catch (...) {}
        } else if (key == "MetersPerPixel" || key == "CalibrationScale") {
            try { meters_per_pixel_ = std::stof(val); } catch (...) {}
        }
    }

    void shutdown() override {
        track_history_.clear();
    }

private:
    bool enabled_{true};
    float speed_limit_kmh_{45.0f};
    float meters_per_pixel_{0.0f}; // 0.0f indicates SPEED UNCALIBRATED
    std::unordered_map<int, TrackPositionRecord> track_history_;
};

} // namespace CamAI

#endif // CAMAI_TRAFFIC_MODULE_HPP
