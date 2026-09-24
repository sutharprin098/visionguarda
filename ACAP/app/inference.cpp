// CAMAI ACAP — Inference Engine
// Drives the complete model→detection pipeline:
//   1. Load model via Larod (on-camera) or host stub (dev builds).
//   2. Preprocess frame (VDO NV12 → letterboxed float32 BGR tensor).
//   3. Execute Larod inference job against the DLPU or CPU backend.
//   4. Decode raw YOLOX output tensor → BoundingBox list.
//   5. NMS post-processing.
//
// IMPORTANT — Real Detections Only
// ---------------------------------
// This engine NEVER generates synthetic bounding boxes. If the model is not
// loaded, if the frame is empty, or if Larod fails, it returns an empty list
// and logs an error. Callers must treat empty output as "no detections this
// frame" — not as an invitation to fabricate results.

#include "inference.hpp"
#include "preprocessor.hpp"
#include <iostream>
#include <chrono>
#include <algorithm>
#include <cmath>
#include <cstring>

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
// Larod C API — provided by the ACAP SDK (-llarod)
#include <larod.h>
// VDO types needed for buffer pointer access
#include <vdo-frame.h>
#endif

namespace CamAI {

// ──────────────────────────────────────────────────────────────────────────────
// COCO-80 class names — matches server/app/ai/backend.py::COCO_CLASS_MAP
// ──────────────────────────────────────────────────────────────────────────────
static const char* COCO_CLASSES[] = {
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
    "truck", "boat", "traffic light", "fire hydrant", "stop sign",
    "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep",
    "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard",
    "sports ball", "kite", "baseball bat", "baseball glove", "skateboard",
    "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork",
    "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
    "couch", "potted plant", "bed", "dining table", "toilet", "tv",
    "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave",
    "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
    "scissors", "teddy bear", "hair drier", "toothbrush"
};

std::string InferenceEngine::get_class_name(int class_id) {
    if (class_id >= 0 && class_id < 80) return COCO_CLASSES[class_id];
    return "object";
}

// ──────────────────────────────────────────────────────────────────────────────
// Constructor / Destructor
// ──────────────────────────────────────────────────────────────────────────────

InferenceEngine::InferenceEngine() : larod_conn_(nullptr), larod_model_(nullptr) {}

InferenceEngine::~InferenceEngine() {
    shutdown();
}

// ──────────────────────────────────────────────────────────────────────────────
// load_model()
// ──────────────────────────────────────────────────────────────────────────────

bool InferenceEngine::load_model(const std::string& model_path, float confidence_thresh) {
    model_path_          = model_path;
    confidence_threshold_ = confidence_thresh;
    input_width_         = INFER_W;
    input_height_        = INFER_H;

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    // ─── Larod initialisation ────────────────────────────────────────────────
    larodError* error = nullptr;

    larod_conn_ = larodInit(&error);
    if (!larod_conn_ || error) {
        std::cerr << "[InferenceEngine] larodInit failed: "
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        return false;
    }

    // Select backend.
    // ARTPEC-7: "cpu-tflite" or "axis-a8-dlpu-tflite"  (requires .tflite)
    // ARTPEC-8: "axis-a8-dlpu-tflite" or "cpu-tflite"  (requires .tflite)
    // The manifest ACAP setting CAMAI_LAROD_CHIP allows operators to override.
    // Default: "cpu-tflite" — always available, no special model format needed.
    const char* chip_env = getenv("CAMAI_LAROD_CHIP");
    const char* chip = (chip_env && chip_env[0]) ? chip_env : "cpu-tflite";

    std::cout << "[InferenceEngine] Larod backend chip: " << chip << std::endl;

    // List available chips for diagnostics
    larodDevice** dev_list = nullptr;
    size_t        dev_count = 0;
    larodError*   list_err = nullptr;
    if (larodGetDevices(larod_conn_, &dev_list, &dev_count, &list_err)) {
        std::cout << "[InferenceEngine] Available Larod devices (" << dev_count << "):";
        for (size_t i = 0; i < dev_count; ++i) {
            std::cout << " " << larodGetDeviceName(dev_list[i]);
        }
        std::cout << std::endl;
        larodFreeDevices(&dev_list, dev_count);
    } else {
        if (list_err) larodClearError(&list_err);
    }

    // Find the requested device
    larodDevice* device = nullptr;
    {
        larodError* dev_err = nullptr;
        larodDevice** devs2 = nullptr;
        size_t n2 = 0;
        if (larodGetDevices(larod_conn_, &devs2, &n2, &dev_err)) {
            for (size_t i = 0; i < n2; ++i) {
                if (std::string(larodGetDeviceName(devs2[i])) == chip) {
                    device = devs2[i];
                    break;
                }
            }
            if (!device) {
                std::cout << "[InferenceEngine] Chip '" << chip
                          << "' not found, falling back to cpu-tflite" << std::endl;
                for (size_t i = 0; i < n2; ++i) {
                    if (std::string(larodGetDeviceName(devs2[i])) == "cpu-tflite") {
                        device = devs2[i];
                        break;
                    }
                }
            }
            // Do NOT free devs2 — larodLoadModelByChip needs the pointer
        }
        if (dev_err) larodClearError(&dev_err);
    }

    // Load model
    // NOTE: Larod on ARTPEC-7/8 requires .tflite format.
    // Convert with: larod-convert --model yolox_tiny.onnx --format tflite
    // (in the ACAP SDK Docker container). The manifest setting ModelPath
    // points to the .tflite file; the default is "models/yolox_tiny.tflite".
    if (device) {
        larod_model_ = larodLoadModelByChip(larod_conn_, device,
                                             model_path_.c_str(),
                                             LAROD_ACCESS_PUBLIC,
                                             "camai_model", nullptr, &error);
    } else {
        // Absolute fallback: legacy larodLoadModel (deprecated but safe)
        larod_model_ = larodLoadModel(larod_conn_, model_path_.c_str(),
                                       LAROD_ACCESS_PUBLIC, "camai_model", &error);
    }

    if (!larod_model_ || error) {
        std::cerr << "[MODEL LOAD FAILED] path='" << model_path_ << "' err="
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        larodDisconnect(larod_conn_, nullptr);
        larod_conn_ = nullptr;
        return false;
    }

    std::cout << "[MODEL LOAD OK] path=" << model_path_
              << " input_w=" << input_width_ << " input_h=" << input_height_ << std::endl;
    std::cout << "[MODEL INPUT] w=" << input_width_ << " h=" << input_height_ << " format=BGR_FLOAT32" << std::endl;

    // Pre-allocate tensor buffers for input and output.
    size_t input_size  = static_cast<size_t>(input_width_ * input_height_ * 3) * sizeof(float);
    size_t output_size = 0;

    // Query output tensor shape from the loaded model
    larodTensor** out_tensors  = nullptr;
    size_t        out_count    = 0;
    larodError*   out_err      = nullptr;
    if (larodGetModelOutputs(larod_conn_, larod_model_, &out_tensors, &out_count, &out_err)) {
        if (out_count > 0 && out_tensors) {
            const larodTensorDims* dims = larodGetTensorDims(out_tensors[0]);
            if (dims) {
                output_size = sizeof(float);
                std::cout << "[RAW OUTPUT SHAPE] (";
                for (size_t d = 0; d < dims->n; ++d) {
                    output_size *= static_cast<size_t>(dims->dims[d]);
                    std::cout << dims->dims[d];
                    if (d + 1 < dims->n) std::cout << ",";
                }
                std::cout << ") bytes=" << output_size << std::endl;

                // Store for use in run_inference
                num_anchors_ = 1;
                for (size_t d = 1; d < dims->n - 1; ++d)
                    num_anchors_ *= dims->dims[d];
            }
        }
        larodFreeTensors(&out_tensors, out_count);
    } else {
        if (out_err) larodClearError(&out_err);
        num_anchors_ = (input_width_/8) * (input_height_/8)
                     + (input_width_/16)* (input_height_/16)
                     + (input_width_/32)* (input_height_/32);
        output_size = static_cast<size_t>(num_anchors_) * 85 * sizeof(float);
        std::cout << "[RAW OUTPUT SHAPE] Default YOLOX anchors=" << num_anchors_
                  << " bytes=" << output_size << std::endl;
    }

    input_buf_.resize(input_size / sizeof(float));
    output_buf_.resize(output_size / sizeof(float));
    is_loaded_ = true;

#else // ─── Host / dev mode ──────────────────────────────────────────────────
    std::cout << "[MODEL LOAD OK] Loaded in host mode (validation stub): "
              << model_path_ << " input=" << input_width_ << "x" << input_height_ << std::endl;
    num_anchors_ = (input_width_/8) * (input_height_/8)
                 + (input_width_/16)* (input_height_/16)
                 + (input_width_/32)* (input_height_/32);
    size_t input_size  = static_cast<size_t>(input_width_ * input_height_ * 3) * sizeof(float);
    size_t output_size = static_cast<size_t>(num_anchors_) * 85 * sizeof(float);
    input_buf_.resize(input_size / sizeof(float), 0.0f);
    output_buf_.resize(output_size / sizeof(float), 0.0f);
    is_loaded_ = true;
#endif

    return true;
}

void InferenceEngine::set_confidence_threshold(float thresh) {
    confidence_threshold_ = thresh;
}

// ──────────────────────────────────────────────────────────────────────────────
// YOLOX anchor grid generation
// ──────────────────────────────────────────────────────────────────────────────

void InferenceEngine::generate_grids_and_strides(
    int target_w, int target_h,
    std::vector<GridAnchor>& out_anchors)
{
    out_anchors.clear();
    const int strides[] = {8, 16, 32};
    for (int stride : strides) {
        int gy = target_h / stride;
        int gx = target_w / stride;
        for (int y = 0; y < gy; ++y)
            for (int x = 0; x < gx; ++x)
                out_anchors.push_back({x, y, stride});
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// YOLOX tensor decode — same logic as server/app/ai/backend.py::postprocess()
// Tensor layout: [num_anchors, 5 + num_classes]
//   feat[0..1] = x_offset, y_offset (relative to grid cell)
//   feat[2..3] = log-width, log-height
//   feat[4]    = objectness confidence
//   feat[5..]  = per-class confidence
// ──────────────────────────────────────────────────────────────────────────────

void InferenceEngine::decode_yolox_tensor(
    const float* tensor_data,
    int          num_anchors,
    int          num_classes,
    int          input_w,
    int          input_h,
    float        conf_thresh,
    std::vector<BoundingBox>& out_boxes)
{
    std::vector<GridAnchor> anchors;
    generate_grids_and_strides(input_w, input_h, anchors);
    int total = std::min(num_anchors, static_cast<int>(anchors.size()));
    int elem  = 5 + num_classes;

    for (int i = 0; i < total; ++i) {
        const float* feat = tensor_data + i * elem;
        float obj_conf = feat[4];
        // Quick pre-filter before class loop
        if (obj_conf < conf_thresh * 0.4f) continue;

        int   best_class = 0;
        float best_conf  = 0.0f;
        for (int c = 0; c < num_classes; ++c) {
            float cc = feat[5 + c];
            if (cc > best_conf) { best_conf = cc; best_class = c; }
        }

        float score = obj_conf * best_conf;
        if (score < conf_thresh) continue;

        // Decode box in input-tensor pixel space
        float x_ctr = (feat[0] + anchors[i].grid_x) * anchors[i].stride;
        float y_ctr = (feat[1] + anchors[i].grid_y) * anchors[i].stride;
        float w_px  = std::exp(feat[2]) * anchors[i].stride;
        float h_px  = std::exp(feat[3]) * anchors[i].stride;

        // Normalise to [0,1] in tensor space (pre-unproject)
        float nx = (x_ctr - w_px * 0.5f) / input_w;
        float ny = (y_ctr - h_px * 0.5f) / input_h;
        float nw = w_px / input_w;
        float nh = h_px / input_h;

        nx = std::max(0.0f, std::min(1.0f, nx));
        ny = std::max(0.0f, std::min(1.0f, ny));
        nw = std::max(0.0f, std::min(1.0f - nx, nw));
        nh = std::max(0.0f, std::min(1.0f - ny, nh));

        if (nw < 0.004f || nh < 0.004f) continue;

        BoundingBox box;
        box.x          = nx;
        box.y          = ny;
        box.w          = nw;
        box.h          = nh;
        box.class_id   = best_class;
        box.confidence = score;
        box.track_id   = -1;
        box.label      = get_class_name(best_class);
        out_boxes.push_back(box);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// NMS
// ──────────────────────────────────────────────────────────────────────────────

static float iou(const BoundingBox& a, const BoundingBox& b) {
    float x1 = std::max(a.x, b.x), y1 = std::max(a.y, b.y);
    float x2 = std::min(a.x + a.w, b.x + b.w);
    float y2 = std::min(a.y + a.h, b.y + b.h);
    float inter = std::max(0.0f, x2 - x1) * std::max(0.0f, y2 - y1);
    float uni   = a.w * a.h + b.w * b.h - inter;
    return (uni <= 0.0f) ? 0.0f : inter / uni;
}

void InferenceEngine::nms_boxes(std::vector<BoundingBox>& boxes, float iou_threshold) {
    std::sort(boxes.begin(), boxes.end(),
              [](const BoundingBox& a, const BoundingBox& b) {
                  return a.confidence > b.confidence;
              });

    std::vector<bool> suppressed(boxes.size(), false);
    std::vector<BoundingBox> keep;
    keep.reserve(boxes.size());

    for (size_t i = 0; i < boxes.size(); ++i) {
        if (suppressed[i]) continue;
        keep.push_back(boxes[i]);
        for (size_t j = i + 1; j < boxes.size(); ++j) {
            if (suppressed[j]) continue;
            if (boxes[i].class_id == boxes[j].class_id &&
                iou(boxes[i], boxes[j]) > iou_threshold) {
                suppressed[j] = true;
            }
        }
    }
    boxes = std::move(keep);
}

// ──────────────────────────────────────────────────────────────────────────────
// run_inference() — Main inference execution
// ──────────────────────────────────────────────────────────────────────────────

bool InferenceEngine::run_inference(
    const VideoFrame& frame,
    std::vector<BoundingBox>& out_detections,
    float& out_latency_ms)
{
    if (!is_loaded_) {
        std::cerr << "[InferenceEngine] run_inference called but model not loaded" << std::endl;
        return false;
    }

    auto t_start = std::chrono::high_resolution_clock::now();
    out_detections.clear();

    // ── Step 1: Preprocess frame ──────────────────────────────────────────────
    LetterboxParams lp{};
    if (!preprocess_frame(frame, input_buf_.data(), lp)) {
        std::cerr << "[InferenceEngine] Frame preprocessing failed on frame "
                  << frame.frame_index << std::endl;
        auto t_end = std::chrono::high_resolution_clock::now();
        out_latency_ms = std::chrono::duration<float, std::milli>(t_end - t_start).count();
        return false;
    }

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    // ── Step 2: Larod inference ───────────────────────────────────────────────
    if (!larod_conn_ || !larod_model_) {
        std::cerr << "[InferenceEngine] Larod connection/model is null on frame "
                  << frame.frame_index << std::endl;
        return false;
    }

    larodError* error = nullptr;

    // Build input tensor map
    // Input name is typically "images" or "input" — we use index 0.
    larodTensor** in_tensors = nullptr;
    size_t        in_count   = 0;
    if (!larodGetModelInputs(larod_conn_, larod_model_, &in_tensors, &in_count, &error)) {
        std::cerr << "[InferenceEngine] larodGetModelInputs failed: "
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        return false;
    }

    if (in_count == 0 || !in_tensors) {
        std::cerr << "[InferenceEngine] Model reports zero input tensors" << std::endl;
        larodFreeTensors(&in_tensors, in_count);
        return false;
    }

    // Allocate Larod map and attach input buffer
    larodMap* input_map = larodCreateMap(&error);
    if (!input_map) {
        std::cerr << "[InferenceEngine] larodCreateMap (input) failed: "
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        larodFreeTensors(&in_tensors, in_count);
        return false;
    }

    const size_t input_bytes = static_cast<size_t>(input_width_ * input_height_ * 3) * sizeof(float);
    if (!larodSetTensorFdAndProps(input_map, in_tensors[0],
                                  input_buf_.data(), input_bytes, &error)) {
        std::cerr << "[InferenceEngine] Failed to set input tensor: "
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        larodDestroyMap(input_map, nullptr);
        larodFreeTensors(&in_tensors, in_count);
        return false;
    }
    larodFreeTensors(&in_tensors, in_count);

    // Get output tensor list
    larodTensor** out_tensors = nullptr;
    size_t        out_count   = 0;
    if (!larodGetModelOutputs(larod_conn_, larod_model_, &out_tensors, &out_count, &error)) {
        std::cerr << "[InferenceEngine] larodGetModelOutputs failed: "
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        larodDestroyMap(input_map, nullptr);
        return false;
    }

    if (out_count == 0 || !out_tensors) {
        std::cerr << "[InferenceEngine] Model reports zero output tensors" << std::endl;
        larodDestroyMap(input_map, nullptr);
        return false;
    }

    const size_t output_bytes = output_buf_.size() * sizeof(float);

    larodMap* output_map = larodCreateMap(&error);
    if (!output_map) {
        std::cerr << "[InferenceEngine] larodCreateMap (output) failed: "
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        larodDestroyMap(input_map, nullptr);
        larodFreeTensors(&out_tensors, out_count);
        return false;
    }

    if (!larodSetTensorFdAndProps(output_map, out_tensors[0],
                                   output_buf_.data(), output_bytes, &error)) {
        std::cerr << "[InferenceEngine] Failed to set output tensor: "
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        larodDestroyMap(output_map, nullptr);
        larodDestroyMap(input_map, nullptr);
        larodFreeTensors(&out_tensors, out_count);
        return false;
    }
    larodFreeTensors(&out_tensors, out_count);

    // Create inference job
    larodJobRequest* job = larodCreateJobRequest(larod_conn_, larod_model_,
                                                  input_map, output_map, nullptr, &error);
    if (!job) {
        std::cerr << "[InferenceEngine] larodCreateJobRequest failed: "
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        larodDestroyMap(output_map, nullptr);
        larodDestroyMap(input_map, nullptr);
        return false;
    }

    // Run synchronous inference (blocks until done)
    if (!larodRunJob(larod_conn_, job, &error)) {
        std::cerr << "[InferenceEngine] larodRunJob failed on frame "
                  << frame.frame_index << ": "
                  << (error ? error->msg : "unknown") << std::endl;
        if (error) larodClearError(&error);
        larodDestroyJobRequest(larod_conn_, job, nullptr);
        larodDestroyMap(output_map, nullptr);
        larodDestroyMap(input_map, nullptr);
        return false;
    }

    larodDestroyJobRequest(larod_conn_, job, nullptr);
    larodDestroyMap(output_map, nullptr);
    larodDestroyMap(input_map, nullptr);

    // output_buf_ now contains the raw model output

#else
    // ── Host mode — no real inference ────────────────────────────────────────
    // Zero-fake policy: do not emit synthetic detections.
    // output_buf_ remains all-zeros → decode produces no boxes.
    // This is intentional: host builds exist for compilation validation and
    // unit-testing the postprocessing and tracking paths with test frames.
    (void)frame;
#endif

    // ── Step 3: Decode output tensor ─────────────────────────────────────────
    // YOLOX output: [1, num_anchors, 85]  (batch=1 implicit, skip first dim)
    // num_anchors_ set during load_model() from actual tensor shape.
    if (!output_buf_.empty()) {
        decode_yolox_tensor(
            output_buf_.data(),
            num_anchors_,
            80,                      // COCO-80 classes
            input_width_,
            input_height_,
            confidence_threshold_,
            out_detections);

        // ── Step 4: Unproject letterbox coordinates back to original frame ────
        for (auto& box : out_detections) {
            float ux, uy, uw, uh;
            unproject_box(
                box.x * input_width_,  box.y * input_height_,
                box.w * input_width_,  box.h * input_height_,
                lp, ux, uy, uw, uh);
            box.x = ux;
            box.y = uy;
            box.w = uw;
            box.h = uh;
        }
    }

    // ── Step 5: NMS ──────────────────────────────────────────────────────────
    nms_boxes(out_detections, 0.45f);

    auto t_end = std::chrono::high_resolution_clock::now();
    out_latency_ms = std::chrono::duration<float, std::milli>(t_end - t_start).count();

    if (!out_detections.empty()) {
        std::cout << "[MODEL INFERENCE OK] frame=" << frame.frame_index
                  << " latency=" << out_latency_ms << "ms"
                  << " count=" << out_detections.size() << std::endl;
        for (const auto& det : out_detections) {
            std::cout << "  -> [DETECTION] class=" << det.label
                      << " conf=" << det.confidence
                      << " bbox=[" << det.x << ", " << det.y << ", " << det.w << ", " << det.h << "]"
                      << std::endl;
        }
    }

    return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// shutdown()
// ──────────────────────────────────────────────────────────────────────────────

void InferenceEngine::shutdown() {
    if (is_loaded_) {
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
        larodError* error = nullptr;
        if (larod_model_) {
            larodDestroyModel(larod_conn_, larod_model_, &error);
            if (error) larodClearError(&error);
            larod_model_ = nullptr;
        }
        if (larod_conn_) {
            larodDisconnect(larod_conn_, &error);
            if (error) larodClearError(&error);
            larod_conn_ = nullptr;
        }
#endif
        input_buf_.clear();
        output_buf_.clear();
        is_loaded_ = false;
        std::cout << "[InferenceEngine] Shutdown complete" << std::endl;
    }
}

} // namespace CamAI
