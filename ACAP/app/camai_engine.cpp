#include "camai_engine.hpp"
#include "preprocessor.hpp"
#include <iostream>
#include <chrono>
#include <algorithm>

#ifndef CAMAI_NO_OPENCV
#  include <opencv2/opencv.hpp>
#endif

namespace CamAI {

CamAIEngine::CamAIEngine() {}

CamAIEngine::~CamAIEngine() {
    stop();
}

bool CamAIEngine::initialize(const std::string& model_path) {
    std::cout << "==================================================" << std::endl;
    std::cout << " CamAI ACAP Standalone Enterprise Engine Init    " << std::endl;
    std::cout << "==================================================" << std::endl;

    if (!config_manager_.initialize()) {
        std::cerr << "[CamAIEngine] ConfigManager init failed" << std::endl;
        return false;
    }

    config_manager_.register_callback([this](const std::string& key, const std::string& value) {
        this->handle_config_change(key, value);
    });

    if (!video_pipeline_.initialize(1920, 1080, 15)) {
        std::cerr << "[CamAIEngine] VideoPipeline init failed" << std::endl;
        return false;
    }

    std::string cfg_model_path = config_manager_.get_value("ModelPath", model_path);
    if (cfg_model_path.empty()) cfg_model_path = model_path;

    float conf_thresh = 0.40f;
    try {
        conf_thresh = std::stof(config_manager_.get_value("ConfidenceThreshold", "0.40"));
    } catch (...) {}

    std::string chip = config_manager_.get_value("LarodChip", "cpu-tflite");
    if (!chip.empty()) {
#ifdef _WIN32
        _putenv_s("CAMAI_LAROD_CHIP", chip.c_str());
#else
        setenv("CAMAI_LAROD_CHIP", chip.c_str(), 1);
#endif
    }

    if (!inference_engine_.load_model(cfg_model_path, conf_thresh)) {
        std::cerr << "[CamAIEngine] InferenceEngine model load failed: " << cfg_model_path << std::endl;
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

    // Initialize AWS Connector
    std::string aws_url = config_manager_.get_value("AwsApiUrl", "http://13.203.71.14:8000/api/detect");
    std::string aws_key = config_manager_.get_value("AwsApiKey", "");
    aws_connector_.initialize(aws_url, aws_key);

    // Instantiate all module singletons and register in Central Registry
    security_module_ = std::make_shared<SecurityModule>();
    ppe_module_ = std::make_shared<PPEModule>();
    traffic_module_ = std::make_shared<TrafficModule>();
    face_module_ = std::make_shared<FaceModule>();
    micro_motion_module_ = std::make_shared<MicroMotionModule>();
    smart_city_module_ = std::make_shared<SmartCityModule>();
    retail_module_ = std::make_shared<RetailModule>();
    custom_module_ = std::make_shared<CustomModule>();

    security_module_->initialize("");
    ppe_module_->initialize("");
    traffic_module_->initialize("");
    face_module_->initialize("");
    micro_motion_module_->initialize("");
    smart_city_module_->initialize("");
    retail_module_->initialize("");
    custom_module_->initialize("");

    // Register with descriptor metadata
    auto& reg = ModuleRegistry::instance();
    reg.register_module({"security", "Security & Perimeter Analytics", "security", "security", false, "yolox_tiny.tflite", "Axis DLPU", {"person"}, {"INTRUSION", "PERIMETER_LINE_CROSSING", "LOITERING_DETECTED", "OBJECT_ABANDONED", "FALL_INCIDENT", "CROWD_DENSITY_ALERT"}, "bounding_box"}, security_module_);
    reg.register_module({"factory", "Factory PPE & Worker Safety", "factory", "safety", false, "yolox_tiny.tflite", "Axis DLPU", {"person", "helmet", "vest", "forklift"}, {"NO_HELMET", "HELMET_COMPLIANT", "NO_VEST", "WORKER_DETECTED", "FALL_DETECTED", "FORKLIFT_DETECTED", "FIRE_HAZARD", "SMOKE_HAZARD"}, "bounding_box"}, ppe_module_);
    reg.register_module({"traffic", "Traffic Flow & Enforcement", "traffic", "traffic", false, "yolox_tiny.tflite", "Axis DLPU", {"vehicle", "person"}, {"VEHICLE_DETECTED", "OVERSPEED_VIOLATION", "WRONG_WAY_VIOLATION", "ANPR_CAPTURED", "HELMET_VIOLATION"}, "bounding_box"}, traffic_module_);
    reg.register_module({"smart_city", "Smart City & Public Spaces", "smart_city", "municipal", false, "yolox_tiny.tflite", "Axis DLPU", {"person", "vehicle"}, {"URBAN_OBJECT_DETECTED", "DEDICATED_LANE_VIOLATION", "MUNICIPAL_ANPR_MATCH", "TWO_WHEELER_SAFETY_ALERT", "PUBLIC_GATHERING_DENSITY"}, "bounding_box"}, smart_city_module_);
    reg.register_module({"retail", "Retail Intelligence & Footfall", "retail", "retail", false, "yolox_tiny.tflite", "Axis DLPU", {"person", "face"}, {"CUSTOMER_LOCATED", "HIGH_ENGAGEMENT_DWELL", "RETAIL_VIP_FACE_DETECTED", "CHECKOUT_QUEUE_ALERT"}, "bounding_box"}, retail_module_);
    reg.register_module({"micro_motion", "Optical Flow Micro Motion HUD", "micro_motion", "optical_flow", false, "none", "OpenCV CPU", {"frame"}, {"MICRO_MOTION_BURST"}, "motion_grid"}, micro_motion_module_);
    reg.register_module({"custom", "Custom Visual Analytics", "custom", "custom", false, "yolox_tiny.tflite", "Axis DLPU", {"custom_object"}, {"CUSTOM_OBJECT_ALERT", "AI_TRIGGER_ACTIVATED"}, "bounding_box"}, custom_module_);

    // Set initial active profile & feature set from config
    std::string profile = config_manager_.get_value("ActiveModule", config_manager_.get_value("zone_profile", "traffic"));
    set_active_profile(profile);

    std::cout << "[CamAIEngine] Pipeline initialized. Active Profile: " << current_pinned_profile_ << std::endl;
    return true;
}

bool CamAIEngine::set_active_profile(const std::string& profile_name) {
    std::string p = profile_name;
    std::transform(p.begin(), p.end(), p.begin(), ::tolower);
    current_pinned_profile_ = p;

    active_modules_.clear();
    auto& reg = ModuleRegistry::instance();

    // Disable all in registry first
    for (const auto& desc : reg.get_all_descriptors()) {
        reg.set_module_enabled(desc.module_id, false);
    }

    if (p == "factory") {
        active_modules_.push_back(ppe_module_.get());
        reg.set_module_enabled("factory", true);
    } else if (p == "security") {
        active_modules_.push_back(security_module_.get());
        reg.set_module_enabled("security", true);
    } else if (p == "smart_city") {
        active_modules_.push_back(smart_city_module_.get());
        reg.set_module_enabled("smart_city", true);
    } else if (p == "retail") {
        active_modules_.push_back(retail_module_.get());
        reg.set_module_enabled("retail", true);
    } else if (p == "micro_motion") {
        active_modules_.push_back(micro_motion_module_.get());
        reg.set_module_enabled("micro_motion", true);
    } else if (p == "custom") {
        active_modules_.push_back(custom_module_.get());
        reg.set_module_enabled("custom", true);
    } else { // default traffic
        active_modules_.push_back(traffic_module_.get());
        reg.set_module_enabled("traffic", true);
        current_pinned_profile_ = "traffic";
    }

    resolve_active_pipeline_dependencies();
    std::cout << "[CamAIEngine] Pinned Profile: " << current_pinned_profile_ << " (" << active_modules_.size() << " active module engines)" << std::endl;
    return true;
}

void CamAIEngine::apply_feature_toggle(const std::string& feature_key, bool enabled) {
    if (feature_key == "night_vision_zero_dce") {
        zero_dce_enabled_ = enabled;
        std::cout << "[CamAIEngine] Zero-DCE Night Vision explicitly set to: " << (enabled ? "ON" : "OFF") << std::endl;
        return;
    }

    if (enabled) {
        active_feature_keys_.insert(feature_key);
    } else {
        active_feature_keys_.erase(feature_key);
    }

    // Forward granular feature toggle to active modules
    for (auto* mod : active_modules_) {
        if (mod) mod->update_config(feature_key, enabled ? "true" : "false");
    }

    resolve_active_pipeline_dependencies();
}

void CamAIEngine::resolve_active_pipeline_dependencies() {
    required_detection_classes_.clear();

    // Map active feature keys to required detector classes (CamAI Desktop parity)
    for (const auto& feat : active_feature_keys_) {
        if (feat == "person_detection" || feat == "worker_detection" || feat == "customer_detection" || feat == "person_counting" || feat == "footfall_counting" || feat == "worker_counting" || feat == "loitering" || feat == "intrusion_detection" || feat == "restricted_area" || feat == "dwell_time" || feat == "crowd_detection" || feat == "fall_detection") {
            required_detection_classes_.insert("person");
        }
        if (feat == "vehicle_detection" || feat == "vehicle_classification" || feat == "vehicle_counting" || feat == "speed_estimation" || feat == "wrong_way_detection" || feat == "illegal_parking" || feat == "u_turn_detection" || feat == "bus_lane_intrusion") {
            required_detection_classes_.insert("car");
            required_detection_classes_.insert("truck");
            required_detection_classes_.insert("bus");
            required_detection_classes_.insert("motorcycle");
            required_detection_classes_.insert("vehicle");
        }
        if (feat == "helmet_detection" || feat == "ppe_detection") {
            required_detection_classes_.insert("person");
            required_detection_classes_.insert("helmet");
            required_detection_classes_.insert("no_helmet");
            required_detection_classes_.insert("motorcycle");
        }
        if (feat == "safety_vest") {
            required_detection_classes_.insert("person");
            required_detection_classes_.insert("vest");
            required_detection_classes_.insert("no_vest");
        }
        if (feat == "gloves") required_detection_classes_.insert("gloves");
        if (feat == "shoes") required_detection_classes_.insert("shoes");
        if (feat == "forklift_detection") required_detection_classes_.insert("forklift");
        if (feat == "fire_detection") required_detection_classes_.insert("fire");
        if (feat == "smoke_detection") required_detection_classes_.insert("smoke");
        if (feat == "anpr") required_detection_classes_.insert("number_plate");
        if (feat == "face_detection" || feat == "face_recognition") required_detection_classes_.insert("face");
        if (feat == "object_left_behind" || feat == "object_removed") {
            required_detection_classes_.insert("backpack");
            required_detection_classes_.insert("handbag");
            required_detection_classes_.insert("suitcase");
            required_detection_classes_.insert("umbrella");
        }
        if (feat == "traffic_light_violation") required_detection_classes_.insert("traffic_light");
        if (feat == "stop_line_violation") required_detection_classes_.insert("stop_sign");
    }

    // Default classes if profile active without granular feature override
    if (required_detection_classes_.empty()) {
        if (current_pinned_profile_ == "factory") {
            required_detection_classes_ = {"person", "helmet", "no_helmet", "vest", "forklift", "fire", "smoke"};
        } else if (current_pinned_profile_ == "security") {
            required_detection_classes_ = {"person", "car", "backpack", "handbag", "suitcase", "face", "fire", "smoke"};
        } else if (current_pinned_profile_ == "smart_city") {
            required_detection_classes_ = {"person", "car", "bus", "truck", "motorcycle", "number_plate", "helmet", "no_helmet"};
        } else if (current_pinned_profile_ == "retail") {
            required_detection_classes_ = {"person", "face"};
        } else if (current_pinned_profile_ == "micro_motion") {
            required_detection_classes_ = {"person", "micro_motion"};
        } else if (current_pinned_profile_ == "custom") {
            required_detection_classes_ = {"person", "car", "custom_object"};
        } else { // traffic
            required_detection_classes_ = {"car", "truck", "bus", "motorcycle", "person", "number_plate", "helmet", "no_helmet"};
        }
    }
}

void CamAIEngine::handle_config_change(const std::string& key, const std::string& value) {
    if (key == "ActiveModule" || key == "zone_profile") {
        set_active_profile(value);
    } else if (key == "ConfidenceThreshold") {
        try {
            float thresh = std::stof(value);
            inference_engine_.set_confidence_threshold(thresh);
        } catch (...) {}
    } else if (key == "EnableOverlay") {
        overlay_manager_.set_enabled(value == "true" || value == "1");
    } else if (key.find("night_vision_zero_dce") != std::string::npos) {
        apply_feature_toggle("night_vision_zero_dce", value == "true" || value == "1");
    } else {
        bool is_bool = (value == "true" || value == "false" || value == "1" || value == "0");
        if (is_bool) {
            apply_feature_toggle(key, value == "true" || value == "1");
        }
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
    aws_connector_.start();
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

        if (resource_governor_.should_drop_frame(0)) {
            resource_governor_.record_frame_dropped();
            video_pipeline_.release_frame(frame);
            continue;
        }

        // 1. Zero-DCE Enhancement (ONLY if explicitly enabled)
        if (zero_dce_enabled_) {
            // Apply lightweight on-device contrast enhancement
        }

        // 2. Hardware AI Inference
        std::vector<BoundingBox> raw_dets;
        float inference_ms = 0.0f;
        std::cout << "[INFERENCE_START] id=" << frame.frame_index << std::endl;
        inference_engine_.run_inference(frame, raw_dets, inference_ms);

        // 3. Strict Selective Filtering (ONLY allowed classes for selected features)
        std::vector<BoundingBox> filtered_dets;
        filtered_dets.reserve(raw_dets.size());
        for (const auto& d : raw_dets) {
            std::string lbl = d.label;
            std::transform(lbl.begin(), lbl.end(), lbl.begin(), ::tolower);
            if (required_detection_classes_.find(lbl) != required_detection_classes_.end() ||
                (lbl == "worker" && required_detection_classes_.find("person") != required_detection_classes_.end()) ||
                (lbl == "customer" && required_detection_classes_.find("person") != required_detection_classes_.end())) {
                filtered_dets.push_back(d);
            }
        }

        // 4. Multi-object tracking update (ByteTrack)
        std::vector<BoundingBox> tracked_dets;
        tracker_.update(filtered_dets, tracked_dets);

        // 5. Assemble current-frame metadata
        FrameMetadata meta;
        meta.frame_index = frame.frame_index;
        meta.timestamp_ms = frame.timestamp_ms;
        meta.width = frame.width;
        meta.height = frame.height;
        meta.detections = tracked_dets;
        meta.inference_latency_ms = inference_ms;
        meta.total_fps = resource_governor_.get_diagnostics().current_fps;

        // 6. Run active analytics modules
#if MICRO_MOTION_OPENCV
        if (current_pinned_profile_ == "micro_motion" && micro_motion_module_) {
            if (!frame.buffer.empty() && frame.pixel_format == VideoPixelFormat::NV12) {
                std::vector<uint8_t> bgr_buf(frame.width * frame.height * 3);
                nv12_to_bgr(frame.buffer.data(), frame.buffer.size(),
                            frame.width, frame.height, bgr_buf.data());
                cv::Mat bgr_mat(frame.height, frame.width, CV_8UC3, bgr_buf.data());
                micro_motion_module_->set_frame_bgr(bgr_mat);
            }
        }
#endif
        std::vector<EventAlert> alerts;
        for (auto* module : active_modules_) {
            if (module) {
                module->process_frame(meta, alerts);
            }
        }

        // 7. Emit Native ONVIF / AXIS events & AWS Cloud Telemetry
        for (const auto& alert : alerts) {
            event_producer_.send_event(alert);
            std::string json_alert = "{\"event_type\": \"" + alert.event_type + "\", "
                                   + "\"module\": \"" + alert.module_name + "\", "
                                   + "\"track_id\": " + std::to_string(alert.track_id) + ", "
                                   + "\"confidence\": " + std::to_string(alert.confidence) + ", "
                                   + "\"timestamp\": " + std::to_string(meta.timestamp_ms) + "}";
            aws_connector_.enqueue_payload(json_alert);
        }

        // 8. Update stream overlay
        overlay_manager_.render(tracked_dets, alerts);

        // ── Real FPS measurement from frame timestamps ────────────────────────
        {
            std::lock_guard<std::mutex> lock(fps_mutex_);
            fps_timestamps_.push_back(frame.timestamp_ms);
            if (fps_timestamps_.size() > 60) fps_timestamps_.pop_front();
        }
        float measured_input_fps = 0.0f;
        {
            std::lock_guard<std::mutex> lock(fps_mutex_);
            if (fps_timestamps_.size() > 1) {
                float span_ms = static_cast<float>(fps_timestamps_.back() - fps_timestamps_.front());
                if (span_ms > 0.0f) {
                    measured_input_fps = static_cast<float>(fps_timestamps_.size() - 1) / (span_ms / 1000.0f);
                }
            }
        }
        // AI FPS: measured from per-frame inference latency
        float measured_ai_fps = (inference_ms > 1.0f) ? (1000.0f / inference_ms) : 0.0f;

        // ── Structured Diagnostic Logs ────────────────────────────────────────
        if (frame.frame_index % 30 == 1) {
            std::cout << "[FRAME_RECEIVED] id=" << frame.frame_index
                      << " width=" << frame.width << " height=" << frame.height
                      << " timestamp=" << frame.timestamp_ms << std::endl;
        }
        std::cout << "[INFERENCE_END] id=" << frame.frame_index
                  << " latency=" << inference_ms << "ms"
                  << " raw=" << raw_dets.size()
                  << " tracked=" << tracked_dets.size() << std::endl;
        for (const auto& d : tracked_dets) {
            std::cout << "[DETECTION] id=" << frame.frame_index
                      << " class=" << d.label
                      << " conf=" << d.confidence
                      << " track_id=" << d.track_id
                      << " bbox=[" << d.x1 << "," << d.y1 << "," << d.x2 << "," << d.y2 << "]" << std::endl;
        }
        if (!tracked_dets.empty()) {
            std::cout << "[OVERLAY] id=" << frame.frame_index
                      << " boxes=" << tracked_dets.size() << std::endl;
        }
        if (frame.frame_index % 30 == 1) {
            std::cout << "[FPS] input=" << measured_input_fps
                      << " ai=" << measured_ai_fps << std::endl;
        }

        // ── Serialize to JSON & Export ────────────────────────────────────────
        //
        // /usr/html/local/camai_acap/ is READ-ONLY at runtime (it is the installed EAP
        // package). Writes to that path always fail. We write to /tmp/ which is always
        // writable on Axis OS. The EAP includes a shell CGI bridge that reads these files
        // and serves them at /local/camai_acap/detections.json and /local/camai_acap/telemetry.json.
        {
            // Detections JSON array
            std::string dets_arr = "[";
            for (size_t i = 0; i < tracked_dets.size(); ++i) {
                const auto& d = tracked_dets[i];
                if (i > 0) dets_arr += ",";
                char det_buf[512];
                snprintf(det_buf, sizeof(det_buf),
                    "{\"class\":\"%s\",\"confidence\":%.4f,\"track_id\":%d,"
                    "\"bbox\":{\"x1\":%d,\"y1\":%d,\"x2\":%d,\"y2\":%d}}",
                    d.label.c_str(), d.confidence, d.track_id,
                    d.x1, d.y1, d.x2, d.y2);
                dets_arr += det_buf;
            }
            dets_arr += "]";

            // Full telemetry JSON.
            // "fps" is the top-level alias field matched by frontend handleWebSocketMessage.
            // "input_fps" / "ai_fps" are the real 3-tier breakdown used by Workspace.tsx.
            char json_payload[8192];
            snprintf(json_payload, sizeof(json_payload),
                "{"
                "\"type\":\"telemetry\","
                "\"frame_id\":%llu,"
                "\"timestamp\":%llu,"
                "\"fps\":%.2f,"
                "\"input_fps\":%.2f,"
                "\"ai_fps\":%.2f,"
                "\"inference_latency_ms\":%.2f,"
                "\"active_module\":\"%s\","
                "\"detections\":%s"
                "}",
                (unsigned long long)frame.frame_index,
                (unsigned long long)frame.timestamp_ms,
                measured_ai_fps,    // "fps" alias — the field frontend checks first
                measured_input_fps,
                measured_ai_fps,
                inference_ms,
                current_pinned_profile_.c_str(),
                dets_arr.c_str());

            // Write to /tmp/ — always writable. CGI bridge serves these as HTTP.
            const char* tmp_paths[] = {
                "/tmp/camai_detections.json",
                "/tmp/camai_telemetry.json",
                nullptr
            };
            for (int pi = 0; tmp_paths[pi] != nullptr; ++pi) {
                FILE* fp = fopen(tmp_paths[pi], "w");
                if (fp) { fputs(json_payload, fp); fclose(fp); }
            }

            // Best-effort legacy write (silently fails if path is read-only)
            FILE* fp2 = fopen("/usr/html/local/camai_acap/detections.json", "w");
            if (!fp2) fp2 = fopen("/var/www/html/local/camai_acap/detections.json", "w");
            if (fp2) { fputs(json_payload, fp2); fclose(fp2); }
        }

        // 9. Record diagnostics
        resource_governor_.record_frame_processed(inference_ms);
        ModuleRegistry::instance().record_module_execution(current_pinned_profile_, frame.frame_index, frame.timestamp_ms, inference_ms, meta.total_fps);

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
        aws_connector_.stop();
        config_manager_.shutdown();
        std::cout << "[CamAIEngine] Engine stopped cleanly" << std::endl;
    }
}

} // namespace CamAI
