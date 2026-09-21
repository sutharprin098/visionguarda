#ifndef CAMAI_OVERLAY_HPP
#define CAMAI_OVERLAY_HPP

#include "module_interface.hpp"
#include <vector>

namespace CamAI {

class OverlayManager {
public:
    OverlayManager();
    ~OverlayManager();

    bool initialize();
    void render(const std::vector<BoundingBox>& detections, const std::vector<EventAlert>& alerts);
    void set_enabled(bool enabled);
    bool is_enabled() const { return enabled_; }
    std::string get_mjpeg_stream_url() const;
    std::string get_rtsp_stream_url() const;
    void shutdown();

private:
    bool enabled_{true};
    bool is_initialized_{false};
    void* overlay_handle_{nullptr};
};

} // namespace CamAI

#endif // CAMAI_OVERLAY_HPP
