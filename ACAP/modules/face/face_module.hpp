#ifndef CAMAI_FACE_MODULE_HPP
#define CAMAI_FACE_MODULE_HPP

#include "../module_interface.hpp"
#include <unordered_map>
#include <vector>
#include <string>

namespace CamAI {

struct FaceLandmarks {
    float right_eye_x, right_eye_y;
    float left_eye_x, left_eye_y;
    float nose_tip_x, nose_tip_y;
    float mouth_right_x, mouth_right_y;
    float mouth_left_x, mouth_left_y;
};

struct DetectedFace {
    int track_id;
    float bbox_x, bbox_y, bbox_w, bbox_h;
    float confidence;
    FaceLandmarks landmarks;
    std::string recognized_name;
    float match_score;
};

class FaceModule : public ICamAIModule {
public:
    FaceModule() = default;
    ~FaceModule() override = default;

    bool initialize(const std::string& config_params) override {
        enabled_ = true;
        min_confidence_ = 0.50f;
        recognition_threshold_ = 0.65f;
        return true;
    }

    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        if (!enabled_) return true;

        for (const auto& obj : frame_meta.detected_objects) {
            // Check for Face / Head / Person detections
            if (obj.class_name == "face" || obj.class_name == "person" || obj.class_id == 0) {
                DetectedFace face{};
                face.track_id = obj.track_id;
                face.bbox_x = obj.bbox_x;
                face.bbox_y = obj.bbox_y;
                face.bbox_w = obj.bbox_w;
                face.bbox_h = obj.bbox_h;
                face.confidence = obj.confidence;
                face.recognized_name = "Person_" + std::to_string(obj.track_id);

                tracked_faces_[obj.track_id] = face;

                // Emit Face Event Alert if newly tracked
                if (obj.confidence >= min_confidence_) {
                    EventAlert alert{};
                    alert.event_type = "FACE_DETECTED";
                    alert.track_id = obj.track_id;
                    alert.label = "Face Detected (#" + std::to_string(obj.track_id) + ")";
                    alert.confidence = obj.confidence;
                    alert.timestamp_ms = frame_meta.timestamp_ms;
                    alert.roi_name = "Face_Tracker_Zone";
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
            min_confidence_ = std::stof(value);
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
