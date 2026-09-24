#ifndef CAMAI_CUSTOM_MODULE_HPP
#define CAMAI_CUSTOM_MODULE_HPP

#include "../module_interface.hpp"
#include <string>
#include <vector>

namespace CamAI {

class CustomModule : public ICamAIModule {
public:
    CustomModule() = default;
    ~CustomModule() override = default;

    bool initialize(const std::string& config) override {
        (void)config;
        return true;
    }

    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        int target_count = 0;

        for (const auto& det : frame_meta.detections) {
            target_count++;

            // 1. CUSTOM DETECTION ZONE
            if (enable_custom_detection_ && det.confidence >= custom_conf_) {
                EventAlert alert;
                alert.event_type = "CUSTOM_OBJECT_ALERT";
                alert.module_name = "custom";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "Custom Object Rule Triggered: " + det.label + " (conf: " + std::to_string(det.confidence) + ")";
                out_alerts.push_back(alert);
            }
        }

        // 2. AI TRIGGER (Count threshold or presence)
        if (enable_ai_trigger_ && target_count >= trigger_count_threshold_) {
            EventAlert alert;
            alert.event_type = "AI_TRIGGER_ACTIVATED";
            alert.module_name = "custom";
            alert.confidence = 0.95f;
            alert.timestamp_ms = frame_meta.timestamp_ms;
            alert.details = "AI Logic Trigger Fired: Threshold met (" + std::to_string(target_count) + " objects in view)";
            out_alerts.push_back(alert);
        }

        return true;
    }

    std::string get_name() const override { return "custom"; }

    void update_config(const std::string& key, const std::string& val) override {
        bool b_val = (val == "true" || val == "1");
        if (key == "custom_detection" || key == "EnableCustomModule") enable_custom_detection_ = b_val;
        else if (key == "custom_counting") enable_custom_counting_ = b_val;
        else if (key == "ai_trigger") enable_ai_trigger_ = b_val;
    }

    void shutdown() override {}

private:
    bool enable_custom_detection_{true};
    bool enable_custom_counting_{false};
    bool enable_ai_trigger_{false};
    float custom_conf_{0.40f};
    int trigger_count_threshold_{1};
};

} // namespace CamAI

#endif // CAMAI_CUSTOM_MODULE_HPP
