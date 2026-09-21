#include "diagnostics.hpp"
#include <chrono>

namespace CamAI {

ResourceGovernor::ResourceGovernor(uint32_t max_ram_mb, uint32_t queue_limit)
    : max_ram_mb_(max_ram_mb), queue_limit_(queue_limit) {
    start_timestamp_ms_ = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

void ResourceGovernor::reset() {
    processed_frames_ = 0;
    dropped_frames_ = 0;
    total_inference_ms_ = 0.0f;
    start_timestamp_ms_ = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

bool ResourceGovernor::should_drop_frame(uint32_t current_queue_size) {
    // If queue exceeds limit, enforce DROP_OLDEST backpressure rule
    return (current_queue_size >= queue_limit_);
}

void ResourceGovernor::record_frame_processed(float inference_latency_ms) {
    processed_frames_++;
    total_inference_ms_ = total_inference_ms_ + inference_latency_ms;
}

void ResourceGovernor::record_frame_dropped() {
    dropped_frames_++;
}

SystemDiagnostics ResourceGovernor::get_diagnostics() const {
    SystemDiagnostics diag;
    diag.cpu_usage_pct = 18.5f; // Estimated baseline
    diag.ram_usage_mb = 112;    // Pre-allocated static pool footprint
    diag.max_ram_limit_mb = max_ram_mb_;
    diag.processed_frames = processed_frames_.load();
    diag.dropped_frames = dropped_frames_.load();

    uint64_t now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    float elapsed_sec = (now_ms - start_timestamp_ms_) / 1000.0f;

    diag.current_fps = (elapsed_sec > 0.0f) ? (diag.processed_frames / elapsed_sec) : 0.0f;
    diag.avg_inference_ms = (diag.processed_frames > 0) ? (total_inference_ms_.load() / diag.processed_frames) : 0.0f;
    diag.backpressure_active = (diag.dropped_frames > 0);
    return diag;
}

} // namespace CamAI
