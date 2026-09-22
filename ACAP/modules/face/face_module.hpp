#ifndef CAMAI_FACE_MODULE_HPP
#define CAMAI_FACE_MODULE_HPP

#include "../module_interface.hpp"
#include <unordered_map>
#include <vector>
#include <string>

namespace CamAI {

struct DetectedFace {
    int track_id;
    float bbox_x, bbox_y, bbox_w, bbox_h;
    float confidence;
    std::string recognized_name;
    float match_score;
    uint64_t last_seen_ms;
};

class FaceModule : public ICamAIModule {
public:
    FaceModule() = default;
    ~FaceModule() override = default;

    bool initialize(const std::string& config_params) override {
        (void)config_params;
        enabled_ = true;
        min_confidence_ = 0.50f;
        recognition_threshold_ = 0.65f;
        tracked_faces_.clear();
        return true;
    }

    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        if (!enabled_) return true;

        for (const auto& det : frame_meta.detections) {
            // Check for Face / Person detections
            if (det.label == "face" || det.class_id == 0 || det.label == "person") {
                DetectedFace face{};
                face.track_id = det.track_id;
                face.bbox_x = det.x;
                face.bbox_y = det.y;
                face.bbox_w = det.w;
                face.bbox_h = det.h;
                face.confidence = det.confidence;
                face.recognized_name = (det.track_id >= 0) ? ("Person_" + std::to_string(det.track_id)) : "Unassigned";
                face.last_seen_ms = frame_meta.timestamp_ms;

                if (det.track_id >= 0) {
                    tracked_faces_[det.track_id] = face;
                }

                // Emit Face Event Alert if newly tracked with high confidence
                if (det.confidence >= min_confidence_) {
                    EventAlert alert{};
                    alert.event_type = "FACE_DETECTED";
                    alert.module_name = "face";
                    alert.track_id = det.track_id;
                    alert.bbox = det;
                    alert.confidence = det.confidence;
                    alert.timestamp_ms = frame_meta.timestamp_ms;
                    alert.details = "Face / Subject located: " + face.recognized_name + " (Track #" + std::to_string(det.track_id) + ")";
                    out_alerts.push_back(alert);
                }
            }
        }
        return true;
    }

    std::string get_name() const override { return "face_tracking"; }

    void update_config(const std::string& key, const std::string& value) override {
        if (key == "EnableFaceTracking") {
            enabled_ = (value == "true" || value == "1");
        } else if (key == "FaceConfidenceThreshold") {
            try { min_confidence_ = std::stof(value); } catch (...) {}
        }
    }

    void shutdown() override {
        tracked_faces_.clear();
    }

private:
    bool enabled_{true};
    float min_confidence_{0.50f};
    float recognition_threshold_{0.65f};
    std::unordered_map<int, DetectedFace> tracked_faces_;
};

} // namespace CamAI

#endif // CAMAI_FACE_MODULE_HPP
