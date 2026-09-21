#ifndef CAMAI_ENGINE_HPP
#define CAMAI_ENGINE_HPP

#include "video_pipeline.hpp"
#include "inference.hpp"
#include "tracking.hpp"
#include "events.hpp"
#include "overlay.hpp"
#include "config.hpp"
#include "diagnostics.hpp"
#include "../modules/module_interface.hpp"
#include "../modules/security/security_module.hpp"

#include <memory>
#include <thread>
#include <atomic>
#include <vector>

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
    ResourceGovernor resource_governor_;

    std::unique_ptr<SecurityModule> security_module_;
    std::vector<ICamAIModule*> active_modules_;

    void process_loop();
    void handle_config_change(const std::string& key, const std::string& value);
};

} // namespace CamAI

#endif // CAMAI_ENGINE_HPP
