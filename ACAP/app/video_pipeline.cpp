#include "video_pipeline.hpp"
#include <iostream>
#include <chrono>
#include <thread>
#include <cstring>

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
#include <vdo-stream.h>
#include <vdo-frame.h>
#endif

namespace CamAI {

VideoPipeline::VideoPipeline() : vdo_stream_handle_(nullptr) {}

VideoPipeline::~VideoPipeline() {
    stop();
}

bool VideoPipeline::initialize(int target_width, int target_height, int target_fps) {
    std::lock_guard<std::mutex> lock(pipeline_mutex_);
    width_ = target_width;
    height_ = target_height;
    target_fps_ = target_fps;

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    VdoMap* settings = vdo_map_new();
    vdo_map_set_uint32(settings, "width", width_);
    vdo_map_set_uint32(settings, "height", height_);
    vdo_map_set_uint32(settings, "framerate", target_fps_);

    GError* error = NULL;
    vdo_stream_handle_ = vdo_stream_new(settings, &error);
    g_object_unref(settings);

    if (!vdo_stream_handle_ || error != NULL) {
        std::cerr << "[VDO] FAILED to create VDO stream: " 
                  << (error ? error->message : "unknown") << std::endl;
        if (error) g_error_free(error);
        camera_connected_ = false;
        return false;
    }
    std::cout << "[VDO] stream opened: " 
              << width_ << "x" << height_ << " @" << target_fps_ << "FPS" << std::endl;
#else
    std::cout << "[VDO] Host execution mode initialized: "
              << width_ << "x" << height_ << " @" << target_fps_ << "FPS" << std::endl;
#endif

    return true;
}

bool VideoPipeline::start() {
    std::lock_guard<std::mutex> lock(pipeline_mutex_);
    running_ = true;
    camera_connected_ = true;

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    if (vdo_stream_handle_) {
        GError* error = NULL;
        if (!vdo_stream_start(VDO_STREAM(vdo_stream_handle_), &error)) {
            std::cerr << "[VDO] FAILED to start VDO stream: " 
                      << (error ? error->message : "unknown") << std::endl;
            if (error) g_error_free(error);
            running_ = false;
            camera_connected_ = false;
            return false;
        }
        std::cout << "[VDO] stream started successfully" << std::endl;
    }
#endif
    return running_;
}

bool VideoPipeline::capture_frame(VideoFrame& out_frame) {
    if (!running_) {
        camera_connected_ = false;
        return false;
    }

    uint64_t now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    if (vdo_stream_handle_) {
        GError* error = NULL;
        VdoFrame* vdo_frame = vdo_stream_get_frame(VDO_STREAM(vdo_stream_handle_), &error);
        if (!vdo_frame || error != NULL) {
            std::cerr << "[VDO] FAILED get_frame: " << (error ? error->message : "null frame") << std::endl;
            if (error) g_error_free(error);
            dropped_frames_++;
            camera_connected_ = false;
            return false;
        }

        frame_counter_++;
        last_frame_timestamp_ = now_ms;
        camera_connected_ = true;

        uint8_t* buffer_data = (uint8_t*)vdo_frame_get_buffer(vdo_frame);
        size_t   buffer_size = vdo_frame_get_size(vdo_frame);

        // VDO delivers NV12 on all current ARTPEC hardware.
        // NV12 size = W*H (Y-plane) + W*H/2 (interleaved UV) = W*H*3/2.
        const size_t expected_nv12 = static_cast<size_t>(width_ * height_ * 3 / 2);
        if (buffer_size < expected_nv12) {
            std::cerr << "[VDO] FAILED buffer too small: "
                      << buffer_size << " < " << expected_nv12
                      << " (frame " << frame_counter_ << ")" << std::endl;
            vdo_stream_release_frame(VDO_STREAM(vdo_stream_handle_), vdo_frame);
            dropped_frames_++;
            return false;
        }

        out_frame.frame_index           = frame_counter_;
        out_frame.timestamp_ms          = now_ms;
        out_frame.width                 = width_;
        out_frame.height                = height_;
        out_frame.stride                = width_;        // NV12 stride = width
        out_frame.pixel_format          = VideoPixelFormat::NV12;
        out_frame.buffer.assign(buffer_data, buffer_data + expected_nv12);
        out_frame.native_vdo_frame_ptr  = (void*)vdo_frame;

        if (frame_counter_ % 30 == 1) {
            std::cout << "[VDO] frame received id=" << frame_counter_
                      << " resolution=" << width_ << "x" << height_
                      << " timestamp=" << now_ms
                      << " fps=" << target_fps_ << std::endl;
        }
        return true;
    }
#endif

    frame_counter_++;
    last_frame_timestamp_ = now_ms;
    camera_connected_ = true;

    out_frame.frame_index           = frame_counter_;
    out_frame.timestamp_ms          = now_ms;
    out_frame.width                 = width_;
    out_frame.height                = height_;
    out_frame.stride                = width_;
    out_frame.pixel_format          = VideoPixelFormat::BGR_HOST; // host / test mode
    out_frame.buffer.clear();                                      // no pixel data in host mode
    out_frame.native_vdo_frame_ptr  = nullptr;

    if (frame_counter_ % 30 == 1) {
        std::cout << "[VDO] frame received id=" << frame_counter_
                  << " resolution=" << width_ << "x" << height_
                  << " timestamp=" << now_ms
                  << " fps=" << target_fps_ << std::endl;
    }

    // Pace the host-mode loop to the configured target FPS
    std::this_thread::sleep_for(std::chrono::milliseconds(1000 / target_fps_));
    return true;
}

void VideoPipeline::release_frame(VideoFrame& frame) {
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    if (frame.native_vdo_frame_ptr && vdo_stream_handle_) {
        vdo_stream_release_frame(VDO_STREAM(vdo_stream_handle_), VDO_FRAME(frame.native_vdo_frame_ptr));
        frame.native_vdo_frame_ptr = nullptr;
    }
#else
    (void)frame;
#endif
}

void VideoPipeline::stop() {
    std::lock_guard<std::mutex> lock(pipeline_mutex_);
    if (running_) {
        running_ = false;
        camera_connected_ = false;
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
        if (vdo_stream_handle_) {
            vdo_stream_stop(VDO_STREAM(vdo_stream_handle_));
            g_object_unref(vdo_stream_handle_);
            vdo_stream_handle_ = nullptr;
        }
#endif
    }
}

} // namespace CamAI
