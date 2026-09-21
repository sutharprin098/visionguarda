#ifndef CAMAI_MODULE_INTERFACE_HPP
#define CAMAI_MODULE_INTERFACE_HPP

#include <string>
#include <vector>
#include <memory>
#include <chrono>

namespace CamAI {

struct BoundingBox {
    float x;      // Normalized 0.0 - 1.0
    float y;      // Normalized 0.0 - 1.0
    float w;      // Normalized 0.0 - 1.0
    float h;      // Normalized 0.0 - 1.0
    int class_id;
    float confidence;
    int track_id;
    std::string label;
};

struct EventAlert {
    std::string event_type;   // e.g. "INTRUSION", "LINE_CROSSING", "HELMET_MISSING"
    std::string module_name;  // e.g. "security", "ppe", "traffic"
    int track_id;
    BoundingBox bbox;
    float confidence;
    uint64_t timestamp_ms;
    std::string details;
};

struct FrameMetadata {
    uint64_t frame_index;
    uint64_t timestamp_ms;
    int width;
    int height;
    std::vector<BoundingBox> detections;
    std::vector<EventAlert> alerts;
    float inference_latency_ms;
    float total_fps;
};

class ICamAIModule {
public:
    virtual ~ICamAIModule() = default;

    virtual bool initialize(const std::string& config_params) = 0;
    virtual bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) = 0;
    virtual std::string get_name() const = 0;
    virtual void update_config(const std::string& key, const std::string& value) = 0;
    virtual void shutdown() = 0;
};

} // namespace CamAI

#endif // CAMAI_MODULE_INTERFACE_HPP
