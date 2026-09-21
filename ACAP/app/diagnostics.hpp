#ifndef CAMAI_DIAGNOSTICS_HPP
#define CAMAI_DIAGNOSTICS_HPP

#include <cstdint>
#include <string>
#include <atomic>

namespace CamAI {

struct SystemDiagnostics {
    float cpu_usage_pct;
    uint32_t ram_usage_mb;
    uint32_t max_ram_limit_mb;
    uint64_t processed_frames;
    uint64_t dropped_frames;
    float avg_inference_ms;
    float current_fps;
    bool backpressure_active;
};

class ResourceGovernor {
public:
    ResourceGovernor(uint32_t max_ram_mb = 256, uint32_t queue_limit = 5);
    ~ResourceGovernor() = default;

    bool should_drop_frame(uint32_t current_queue_size);
    void record_frame_processed(float inference_latency_ms);
    void record_frame_dropped();
    SystemDiagnostics get_diagnostics() const;
    void reset();

private:
    uint32_t max_ram_mb_{256};
    uint32_t queue_limit_{5};
    std::atomic<uint64_t> processed_frames_{0};
    std::atomic<uint64_t> dropped_frames_{0};
    std::atomic<float> total_inference_ms_{0.0f};
    uint64_t start_timestamp_ms_{0};
};

} // namespace CamAI

#endif // CAMAI_DIAGNOSTICS_HPP
