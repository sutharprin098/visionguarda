#ifndef CAMAI_INFERENCE_HPP
#define CAMAI_INFERENCE_HPP

#include "module_interface.hpp"
#include "video_pipeline.hpp"
#include <string>
#include <vector>

namespace CamAI {

class InferenceEngine {
public:
    InferenceEngine();
    ~InferenceEngine();

    bool load_model(const std::string& model_path, float confidence_thresh = 0.45f);
    bool run_inference(const VideoFrame& frame, std::vector<BoundingBox>& out_detections, float& out_latency_ms);
    void set_confidence_threshold(float thresh);
    void shutdown();

private:
    std::string model_path_;
    float confidence_threshold_{0.45f};
    bool is_loaded_{false};
    void* larod_conn_{nullptr};
    void* larod_model_{nullptr};

    // Vectorized NMS post-processing
    void nms_boxes(std::vector<BoundingBox>& boxes, float iou_threshold = 0.45f);
};

} // namespace CamAI

#endif // CAMAI_INFERENCE_HPP
