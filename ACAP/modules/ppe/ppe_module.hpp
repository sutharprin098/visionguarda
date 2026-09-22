#ifndef CAMAI_PPE_MODULE_HPP
#define CAMAI_PPE_MODULE_HPP

#include "../module_interface.hpp"
#include <unordered_map>
#include <string>
#include <vector>

namespace CamAI {

struct PersonPPEState {
    int track_id;
    bool has_helmet;
    bool has_vest;
    float confidence;
    uint64_t last_seen_ms;
};

class PPEModule : public ICamAIModule {
public:
    PPEModule() = default;
    ~PPEModule() override = default;

    bool initialize(const std::string& config) override {
        (void)config;
        enabled_ = true;
        min_confidence_ = 0.45f;
        track_states_.clear();
        return true;
    }

    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        if (!enabled_) return true;

        // 1. Identify all person and helmet detections
        std::vector<BoundingBox> persons;
        std::vector<BoundingBox> helmets;

        for (const auto& det : frame_meta.detections) {
            if (det.class_id == 0 || det.label == "person") {
                persons.push_back(det);
            } else if (det.label == "helmet" || det.class_id == 80) { // Custom or COCO extension
                helmets.push_back(det);
            }
        }

        // 2. Associate helmets with persons via spatial overlap in the head region (upper 30% of bbox)
        for (const auto& person : persons) {
            float head_top = person.y;
            float head_bottom = person.y + person.h * 0.35f;
            float head_left = person.x;
            float head_right = person.x + person.w;

            bool found_helmet = false;
            float best_helmet_conf = 0.0f;

            for (const auto& helmet : helmets) {
                float h_cx = helmet.x + helmet.w * 0.5f;
                float h_cy = helmet.y + helmet.h * 0.5f;

                if (h_cx >= head_left && h_cx <= head_right && h_cy >= head_top && h_cy <= head_bottom) {
                    found_helmet = true;
                    if (helmet.confidence > best_helmet_conf) {
                        best_helmet_conf = helmet.confidence;
                    }
                }
            }

            PersonPPEState& state = track_states_[person.track_id];
            state.track_id = person.track_id;
            state.has_helmet = found_helmet;
            state.confidence = found_helmet ? best_helmet_conf : person.confidence;
            state.last_seen_ms = frame_meta.timestamp_ms;

            // 3. Emit real alerts with genuine inference rationale
            if (person.confidence >= min_confidence_) {
                EventAlert alert;
                alert.track_id = person.track_id;
                alert.bbox = person;
                alert.confidence = state.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.module_name = "ppe";

                if (found_helmet) {
                    alert.event_type = "HELMET_COMPLIANT";
                    alert.details = "PPE Verified: Hard-hat/helmet detected on tracked worker (#" + std::to_string(person.track_id) + ")";
                } else if (strict_enforcement_) {
                    alert.event_type = "NO_HELMET";
                    alert.details = "PPE Violation: No safety helmet detected on tracked worker (#" + std::to_string(person.track_id) + ")";
                    out_alerts.push_back(alert);
                }
            }
        }

        return true;
    }

    std::string get_name() const override { return "ppe"; }

    void update_config(const std::string& key, const std::string& val) override {
        if (key == "EnablePPEModule") {
            enabled_ = (val == "true" || val == "1");
        } else if (key == "PPEStrictEnforcement") {
            strict_enforcement_ = (val == "true" || val == "1");
        } else if (key == "PPEConfidenceThreshold") {
            try { min_confidence_ = std::stof(val); } catch (...) {}
        }
    }

    void shutdown() override {
        track_states_.clear();
    }

private:
    bool enabled_{true};
    bool strict_enforcement_{true};
    float min_confidence_{0.45f};
    std::unordered_map<int, PersonPPEState> track_states_;
};

} // namespace CamAI

#endif // CAMAI_PPE_MODULE_HPP
