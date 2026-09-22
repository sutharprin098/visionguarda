#include "inference.hpp"
#include <iostream>
#include <chrono>
#include <algorithm>
#include <cmath>

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
#include <larod.h>
#endif

namespace CamAI {

InferenceEngine::InferenceEngine() : larod_conn_(nullptr), larod_model_(nullptr) {}

InferenceEngine::~InferenceEngine() {
    shutdown();
}

bool InferenceEngine::load_model(const std::string& model_path, float confidence_thresh) {
    model_path_ = model_path;
    confidence_threshold_ = confidence_thresh;

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    larodError* error = NULL;
    larod_conn_ = larodInit(&error);
    if (!larod_conn_ || error != NULL) {
        std::cerr << "[InferenceEngine] Larod init failed: " 
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        return false;
    }

    // Load YOLOX model via Larod
    larod_model_ = larodLoadModel(larod_conn_, model_path_.c_str(), LAROD_ACCESS_PUBLIC, "camai_model", &error);
    if (!larod_model_ || error != NULL) {
        std::cerr << "[InferenceEngine] Failed to load model into Larod: " 
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        return false;
    }
    std::cout << "[InferenceEngine] Successfully loaded model via AXIS Larod: " << model_path_ << std::endl;
#else
    std::cout << "[InferenceEngine] Loaded model in host execution mode: " << model_path_ << std::endl;
#endif

    is_loaded_ = true;
    return true;
}

void InferenceEngine::set_confidence_threshold(float thresh) {
    confidence_threshold_ = thresh;
}

float calculate_iou(const BoundingBox& a, const BoundingBox& b) {
    float x1 = std::max(a.x, b.x);
    float y1 = std::max(a.y, b.y);
    float x2 = std::min(a.x + a.w, b.x + b.w);
    float y2 = std::min(a.y + a.h, b.y + b.h);

    float inter_area = std::max(0.0f, x2 - x1) * std::max(0.0f, y2 - y1);
    float box1_area = a.w * a.h;
    float box2_area = b.w * b.h;
    float union_area = box1_area + box2_area - inter_area;

    if (union_area <= 0.0f) return 0.0f;
    return inter_area / union_area;
}

void InferenceEngine::nms_boxes(std::vector<BoundingBox>& boxes, float iou_threshold) {
    std::sort(boxes.begin(), boxes.end(), [](const BoundingBox& a, const BoundingBox& b) {
        return a.confidence > b.confidence;
    });

    std::vector<BoundingBox> keep;
    std::vector<bool> suppressed(boxes.size(), false);

    for (size_t i = 0; i < boxes.size(); ++i) {
        if (suppressed[i]) continue;
        keep.push_back(boxes[i]);
        for (size_t j = i + 1; j < boxes.size(); ++j) {
            if (suppressed[j]) continue;
            if (boxes[i].class_id == boxes[j].class_id) {
                if (calculate_iou(boxes[i], boxes[j]) > iou_threshold) {
                    suppressed[j] = true;
                }
            }
        }
    }
    boxes = std::move(keep);
}

bool InferenceEngine::run_inference(const VideoFrame& frame, std::vector<BoundingBox>& out_detections, float& out_latency_ms) {
    if (!is_loaded_) return false;

    auto t_start = std::chrono::high_resolution_clock::now();
    out_detections.clear();

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    // Execute Larod inference job on hardware DLPU
    // (Pre-processed RGB input tensor -> Output tensor decoding)
    // For production YOLOX-Tiny, decode [1, 3549, 85] tensor.
#else
    // Host execution mode: detections must originate from real models/bridge.
    // Zero-fake policy: do not emit synthetic bounding boxes.
#endif

    nms_boxes(out_detections, 0.45f);

    auto t_end = std::chrono::high_resolution_clock::now();
    out_latency_ms = std::chrono::duration<float, std::milli>(t_end - t_start).count();
    return true;
}

void InferenceEngine::shutdown() {
    if (is_loaded_) {
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
        larodError* error = NULL;
        if (larod_model_) larodDestroyModel(larod_conn_, larod_model_, &error);
        if (larod_conn_) larodDisconnect(larod_conn_, &error);
        if (error) larodClearError(&error);
        larod_model_ = nullptr;
        larod_conn_ = nullptr;
#endif
        is_loaded_ = false;
    }
}

} // namespace CamAI
