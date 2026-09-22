#ifndef CAMAI_VIDEO_PIPELINE_HPP
#define CAMAI_VIDEO_PIPELINE_HPP

#include <cstdint>
#include <vector>
#include <memory>
#include <mutex>
#include <string>

namespace CamAI {

struct VideoFrame {
    uint64_t frame_index;
    uint64_t timestamp_ms;
    int width;
    int height;
    int stride;
    std::vector<uint8_t> buffer; // NV12 or RGB data
    void* native_vdo_frame_ptr;  // Original vdo frame handle for release
};

class VideoPipeline {
public:
    VideoPipeline();
    ~VideoPipeline();

    bool initialize(int target_width = 1920, int target_height = 1080, int target_fps = 15);
    bool start();
    bool capture_frame(VideoFrame& out_frame);
    void release_frame(VideoFrame& frame);
    void stop();

    int get_width() const { return width_; }
    int get_height() const { return height_; }
    int get_fps() const { return target_fps_; }
    bool is_camera_connected() const { return camera_connected_; }
    uint64_t get_frame_counter() const { return frame_counter_; }
    uint64_t get_dropped_frames() const { return dropped_frames_; }
    uint64_t get_last_frame_timestamp() const { return last_frame_timestamp_; }

private:
    int width_{1920};
    int height_{1080};
    int target_fps_{15};
    bool running_{false};
    bool camera_connected_{false};
    uint64_t frame_counter_{0};
    uint64_t dropped_frames_{0};
    uint64_t last_frame_timestamp_{0};
    void* vdo_stream_handle_{nullptr};
    std::mutex pipeline_mutex_;
};

} // namespace CamAI

#endif // CAMAI_VIDEO_PIPELINE_HPP
