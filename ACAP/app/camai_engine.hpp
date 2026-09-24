#ifndef CAMAI_ENGINE_HPP
#define CAMAI_ENGINE_HPP

#include "video_pipeline.hpp"
#include "inference.hpp"
#include "tracking.hpp"
#include "events.hpp"
#include "overlay.hpp"
#include "config.hpp"
#include "aws_connector.hpp"
#include "diagnostics.hpp"
#include "module_registry.hpp"
#include "../modules/module_interface.hpp"
#include "../modules/security/security_module.hpp"
#include "../modules/ppe/ppe_module.hpp"
#include "../modules/traffic/traffic_module.hpp"
#include "../modules/face/face_module.hpp"
#include "../modules/micro_motion/micro_motion_module.hpp"
#include "../modules/smart_city/smart_city_module.hpp"
#include "../modules/retail/retail_module.hpp"
#include "../modules/custom/custom_module.hpp"

#include <memory>
#include <thread>
#include <atomic>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <mutex>
#include <deque>

namespace CamAI {

class CamAIEngine {
public:
    CamAIEngine();
    ~CamAIEngine();

    bool initialize(const std::string& model_path = "models/yolox_tiny.onnx");
    bool start();
    void stop();
    void run();

    SystemDiagnostics get_diagnostics() const;

private:
    std::atomic<bool> is_running_{false};
    std::thread processing_thread_;

    VideoPipeline video_pipeline_;
    InferenceEngine inference_engine_;
    ByteTracker tracker_;
    EventProducer event_producer_;
    OverlayManager overlay_manager_;
    ConfigManager config_manager_;
    AWSConnector aws_connector_;
    ResourceGovernor resource_governor_;

    std::shared_ptr<SecurityModule> security_module_;
    std::shared_ptr<PPEModule> ppe_module_;
    std::shared_ptr<TrafficModule> traffic_module_;
    std::shared_ptr<FaceModule> face_module_;
    std::shared_ptr<MicroMotionModule> micro_motion_module_;
    std::shared_ptr<SmartCityModule> smart_city_module_;
    std::shared_ptr<RetailModule> retail_module_;
    std::shared_ptr<CustomModule> custom_module_;

    std::vector<ICamAIModule*> active_modules_;
    std::string current_pinned_profile_{"traffic"};

    // Granular feature gating & dependency resolution
    bool zero_dce_enabled_{false};
    std::unordered_set<std::string> active_feature_keys_;
    std::unordered_set<std::string> required_detection_classes_;

    // Real measured FPS tracking
    mutable std::mutex fps_mutex_;
    std::deque<uint64_t> fps_timestamps_;

    void process_loop();
    void handle_config_change(const std::string& key, const std::string& value);
    bool set_active_profile(const std::string& profile_name);
    void apply_feature_toggle(const std::string& feature_key, bool enabled);
    void resolve_active_pipeline_dependencies();
};

} // namespace CamAI

#endif // CAMAI_ENGINE_HPP
