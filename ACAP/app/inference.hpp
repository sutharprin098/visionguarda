#ifndef CAMAI_INFERENCE_HPP
#define CAMAI_INFERENCE_HPP

#include "module_interface.hpp"
#include "video_pipeline.hpp"
#include <string>
#include <vector>

namespace CamAI {

struct GridAnchor {
    int grid_x;
    int grid_y;
    int stride;
};

class InferenceEngine {
public:
    InferenceEngine();
    ~InferenceEngine();

    bool load_model(const std::string& model_path, float confidence_thresh = 0.45f);
    bool run_inference(const VideoFrame& frame, std::vector<BoundingBox>& out_detections, float& out_latency_ms);
    void set_confidence_threshold(float thresh);
    void shutdown();
    bool is_loaded() const { return is_loaded_; }

    // Decode raw YOLOX tensor outputs [1, num_anchors, 85]
    static void decode_yolox_tensor(
        const float* tensor_data,
        int num_anchors,
        int num_classes,
        int input_w,
        int input_h,
        float conf_thresh,
        std::vector<BoundingBox>& out_boxes
    );

    static std::string get_class_name(int class_id);

private:
    std::string model_path_;
    float confidence_threshold_{0.45f};
    bool is_loaded_{false};
    int input_width_{416};
    int input_height_{416};
    void* larod_conn_{nullptr};
    void* larod_model_{nullptr};

    // Vectorized NMS post-processing
    void nms_boxes(std::vector<BoundingBox>& boxes, float iou_threshold = 0.45f);
    static void generate_grids_and_strides(int target_w, int target_h, std::vector<GridAnchor>& out_anchors);
};

} // namespace CamAI

#endif // CAMAI_INFERENCE_HPP
