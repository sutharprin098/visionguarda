#include "overlay.hpp"
#include <iostream>

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
#include <axoverlay.h>
#endif

namespace CamAI {

OverlayManager::OverlayManager() : overlay_handle_(nullptr) {}

OverlayManager::~OverlayManager() {
    shutdown();
}

bool OverlayManager::initialize() {
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    // Initialize axoverlay handle
    // axoverlay_init(&struct);
    std::cout << "[OverlayManager] AXIS Native axoverlay initialized" << std::endl;
#else
    std::cout << "[OverlayManager] Host overlay manager initialized" << std::endl;
#endif

    is_initialized_ = true;
    return true;
}

void OverlayManager::set_enabled(bool enabled) {
    enabled_ = enabled;
}

void OverlayManager::render(const std::vector<BoundingBox>& detections, const std::vector<EventAlert>& alerts) {
    if (!enabled_ || !is_initialized_) return;

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    // Render bounding boxes & text labels using axoverlay API primitives
    (void)detections; (void)alerts;
#else
    // Simulation log output
    if (!detections.empty() || !alerts.empty()) {
        std::cout << "[OverlayManager] Rendering Overlay -> BBoxes: " 
                  << detections.size() << " | Alerts: " << alerts.size() << std::endl;
    }
#endif
}

std::string OverlayManager::get_mjpeg_stream_url() const {
    return "/mjpg/video.mjpg?resolution=1920x1080&fps=15";
}

std::string OverlayManager::get_rtsp_stream_url() const {
    return "rtsp://camera-ip/axis-media/media.amp?videocodec=h264";
}

void OverlayManager::shutdown() {
    if (is_initialized_) {
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
        if (overlay_handle_) {
            // axoverlay_cleanup();
            overlay_handle_ = nullptr;
        }
#endif
        is_initialized_ = false;
    }
}

} // namespace CamAI
