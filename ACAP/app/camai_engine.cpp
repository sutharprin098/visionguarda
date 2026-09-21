#include "camai_engine.hpp"
#include <iostream>
#include <chrono>

namespace CamAI {

CamAIEngine::CamAIEngine() {}

CamAIEngine::~CamAIEngine() {
    stop();
}

bool CamAIEngine::initialize(const std::string& model_path) {
    std::cout << "==================================================" << std::endl;
    std::cout << " CamAI ACAP Native Application Engine Initializing " << std::endl;
    std::cout << "==================================================" << std::endl;

    if (!config_manager_.initialize()) {
        std::cerr << "[CamAIEngine] ConfigManager init failed" << std::endl;
        return false;
    }

    // Register parameter change callback
    config_manager_.register_callback([this](const std::string& key, const std::string& value) {
        this->handle_config_change(key, value);
    });

    if (!video_pipeline_.initialize(1920, 1080, 15)) {
        std::cerr << "[CamAIEngine] VideoPipeline init failed" << std::endl;
        return false;
    }

    float conf_thresh = std::stof(config_manager_.get_value("ConfidenceThreshold", "0.45"));
    if (!inference_engine_.load_model(model_path, conf_thresh)) {
        std::cerr << "[CamAIEngine] InferenceEngine model load failed: " << model_path << std::endl;
        return false;
    }

    if (!event_producer_.initialize()) {
        std::cerr << "[CamAIEngine] EventProducer init failed" << std::endl;
        return false;
    }

    if (!overlay_manager_.initialize()) {
        std::cerr << "[CamAIEngine] OverlayManager init failed" << std::endl;
        return false;
    }

    // Initialize Reference Security Module
    security_module_ = std::make_unique<SecurityModule>();
    security_module_->initialize("");
    security_module_->update_config("IntrusionROICoords", config_manager_.get_value("IntrusionROICoords"));
    security_module_->update_config("TripwireCoords", config_manager_.get_value("TripwireCoords"));

    active_modules_.clear();
    active_modules_.push_back(security_module_.get());

    std::cout << "[CamAIEngine] CamAI ACAP Engine initialized successfully" << std::endl;
    return true;
}

void CamAIEngine::handle_config_change(const std::string& key, const std::string& value) {
    if (key == "ConfidenceThreshold") {
        try {
            float thresh = std::stof(value);
            inference_engine_.set_confidence_threshold(thresh);
        } catch (...) {}
    } else if (key == "EnableOverlay") {
        overlay_manager_.set_enabled(value == "true" || value == "1");
    } else {
        for (auto* mod : active_modules_) {
            if (mod) mod->update_config(key, value);
        }
    }
}

bool CamAIEngine::start() {
    if (is_running_) return true;

    if (!video_pipeline_.start()) {
        std::cerr << "[CamAIEngine] Failed to start video pipeline" << std::endl;
        return false;
    }

    is_running_ = true;
    processing_thread_ = std::thread(&CamAIEngine::process_loop, this);
    std::cout << "[CamAIEngine] Pipeline worker thread running" << std::endl;
    return true;
}

void CamAIEngine::process_loop() {
    while (is_running_) {
        VideoFrame frame;
        if (!video_pipeline_.capture_frame(frame)) {
            continue;
        }

        // Check resource governor for backpressure
        if (resource_governor_.should_drop_frame(0)) {
            resource_governor_.record_frame_dropped();
            video_pipeline_.release_frame(frame);
            continue;
        }

        // 1. Run hardware AI inference
        std::vector<BoundingBox> raw_dets;
        float inference_ms = 0.0f;
        inference_engine_.run_inference(frame, raw_dets, inference_ms);

        // 2. Multi-object tracking update
        std::vector<BoundingBox> tracked_dets;
        tracker_.update(raw_dets, tracked_dets);

        // 3. Assemble frame metadata
        FrameMetadata meta;
        meta.frame_index = frame.frame_index;
        meta.timestamp_ms = frame.timestamp_ms;
        meta.width = frame.width;
        meta.height = frame.height;
        meta.detections = tracked_dets;
        meta.inference_latency_ms = inference_ms;

        // 4. Run active analytics modules
        std::vector<EventAlert> alerts;
        for (auto* module : active_modules_) {
            if (module) {
                module->process_frame(meta, alerts);
            }
        }

        // 5. Emit AXIS Native events
        for (const auto& alert : alerts) {
            event_producer_.send_event(alert);
        }

        // 6. Update stream overlay
        overlay_manager_.render(tracked_dets, alerts);

        // 7. Record performance diagnostics & release buffer
        resource_governor_.record_frame_processed(inference_ms);
        video_pipeline_.release_frame(frame);
    }
}

SystemDiagnostics CamAIEngine::get_diagnostics() const {
    return resource_governor_.get_diagnostics();
}

void CamAIEngine::stop() {
    if (is_running_) {
        is_running_ = false;
        if (processing_thread_.joinable()) {
            processing_thread_.join();
        }
        video_pipeline_.stop();
        inference_engine_.shutdown();
        event_producer_.shutdown();
        overlay_manager_.shutdown();
        config_manager_.shutdown();
        std::cout << "[CamAIEngine] CamAI ACAP Engine stopped cleanly" << std::endl;
    }
}

} // namespace CamAI
