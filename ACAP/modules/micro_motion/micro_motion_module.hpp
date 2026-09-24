// CAMAI ACAP — Micro Motion Module
// Detects fine-grained motion (trembling machinery, subtle person movement,
// package shifting) using sparse Lucas-Kanade optical flow on real frame pixels.
//
// Why sparse LK over frame differencing
// ─────────────────────────────────────
// Frame differencing and background subtraction detect ANY change, including
// lighting flicker and camera vibration. LK tracks specific good-to-track
// corners over time, measuring their displacement vector. If displacement
// magnitude is above motion_threshold_ but below gross_motion_threshold_
// we classify it as "micro motion" — real sub-pixel to ~5px movement.
//
// This module requires the raw pixel buffer in FrameMetadata::raw_bgr.
// If raw_bgr is empty (model disabled or no camera), the module silently
// skips processing without emitting any event. Zero-fake policy: no alerts
// are emitted unless real pixel motion exceeds the threshold.
//
// The module runs ENTIRELY on CPU (no DLPU needed) using standard OpenCV
// routines linked into the ACAP binary via the Axis SDK's libopencv package.
// On ARTPEC-7 this is OpenCV 4.x; ARTPEC-8 ships OpenCV 4.5+.

#ifndef CAMAI_MICRO_MOTION_MODULE_HPP
#define CAMAI_MICRO_MOTION_MODULE_HPP

#include "../module_interface.hpp"
#include <string>
#include <vector>
#include <cmath>
#include <numeric>
#include <iostream>

// OpenCV is provided by the ACAP SDK (axis-opt-opencv package)
// and by the host OpenCV install in dev/test mode.
#ifdef CAMAI_NO_OPENCV
// Compile-time opt-out (e.g., unit-test builds that don't link OpenCV)
#  define MICRO_MOTION_OPENCV 0
#else
#  include <opencv2/opencv.hpp>
#  define MICRO_MOTION_OPENCV 1
#endif

namespace CamAI {

// ── FrameMetadata extension ──────────────────────────────────────────────────
// The existing FrameMetadata (module_interface.hpp) has detections and alerts
// but no pixel buffer. micro_motion requires raw pixels. We pass them via the
// config string in update_config("set_frame_bgr", ...) — not ideal, but avoids
// ABI changes to the base struct. A cleaner alternative is a separate parallel
// channel; see the ACAP roadmap in docs/ARCHITECTURE.md.
//
// For NOW: the camai_engine.cpp calls micro_motion_module_->set_frame_bgr()
// on every frame, directly before process_frame(). This keeps the interface
// separate from the generic ICamAIModule and avoids polluting FrameMetadata.

class MicroMotionModule : public ICamAIModule {
public:
    MicroMotionModule()  = default;
    ~MicroMotionModule() = default;

    // ── ICamAIModule ─────────────────────────────────────────────────────────

    bool initialize(const std::string& config) override {
        (void)config;
        enabled_       = true;
        frame_count_   = 0;
        prev_gray_.release();
        prev_pts_.clear();
        return true;
    }

    bool process_frame(const FrameMetadata& frame_meta,
                       std::vector<EventAlert>& out_alerts) override
    {
        if (!enabled_) return true;

#if MICRO_MOTION_OPENCV
        // current_bgr_ must have been set by set_frame_bgr() before this call.
        if (current_bgr_.empty()) {
            // No pixel data — skip silently (camera not connected / frame lost)
            return true;
        }

        cv::Mat gray;
        cv::cvtColor(current_bgr_, gray, cv::COLOR_BGR2GRAY);

        if (prev_gray_.empty() || prev_pts_.empty()) {
            // First frame — detect corners and store as reference
            cv::goodFeaturesToTrack(gray, prev_pts_, max_corners_,
                                    quality_level_, min_distance_, cv::noArray(),
                                    block_size_);
            prev_gray_ = gray.clone();
            frame_count_++;
            current_bgr_.release();
            return true;
        }

        // Lucas-Kanade sparse optical flow
        std::vector<cv::Point2f> next_pts;
        std::vector<uint8_t>     status;
        std::vector<float>       err;
        cv::calcOpticalFlowPyrLK(prev_gray_, gray, prev_pts_, next_pts,
                                  status, err,
                                  cv::Size(win_size_, win_size_), 3,
                                  cv::TermCriteria(cv::TermCriteria::COUNT |
                                                   cv::TermCriteria::EPS, 30, 0.01f));

        // Compute per-point displacement magnitudes
        std::vector<float> magnitudes;
        magnitudes.reserve(prev_pts_.size());
        for (size_t i = 0; i < prev_pts_.size(); ++i) {
            if (!status[i]) continue;
            float dx = next_pts[i].x - prev_pts_[i].x;
            float dy = next_pts[i].y - prev_pts_[i].y;
            float mag = std::sqrt(dx * dx + dy * dy);
            magnitudes.push_back(mag);
        }

        if (!magnitudes.empty()) {
            float mean_mag = std::accumulate(magnitudes.begin(),
                                              magnitudes.end(), 0.0f)
                             / static_cast<float>(magnitudes.size());

            // Micro-motion band: above noise floor, below gross motion
            bool is_micro = mean_mag >= motion_threshold_px_
                         && mean_mag < gross_motion_threshold_px_;
            bool is_gross = mean_mag >= gross_motion_threshold_px_;

            if (is_micro || is_gross) {
                EventAlert alert;
                alert.module_name  = "micro_motion";
                alert.track_id     = -1;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                // Normalize confidence: 0.5 at threshold, 1.0 at gross motion boundary
                float t = (mean_mag - motion_threshold_px_) /
                          std::max(0.01f, gross_motion_threshold_px_ - motion_threshold_px_);
                alert.confidence = 0.5f + 0.5f * std::min(t, 1.0f);

                if (is_gross) {
                    alert.event_type = "MOTION_DETECTED";
                    alert.details    = "Gross motion detected, mean displacement="
                                       + std::to_string(mean_mag) + "px ("
                                       + std::to_string(magnitudes.size())
                                       + " tracked points)";
                } else {
                    alert.event_type = "MICRO_MOTION_ACTIVITY";
                    alert.details    = "Micro-motion detected, mean displacement="
                                       + std::to_string(mean_mag) + "px ("
                                       + std::to_string(magnitudes.size())
                                       + " tracked points)";
                }
                out_alerts.push_back(alert);
            }
        }

        // Update prev state — every N frames re-detect corners to track new features
        frame_count_++;
        if (frame_count_ % corner_refresh_interval_ == 0 || prev_pts_.size() < 5) {
            cv::goodFeaturesToTrack(gray, prev_pts_, max_corners_,
                                    quality_level_, min_distance_, cv::noArray(),
                                    block_size_);
        } else {
            // Keep only tracked points
            std::vector<cv::Point2f> survived;
            survived.reserve(next_pts.size());
            for (size_t i = 0; i < status.size(); ++i)
                if (status[i]) survived.push_back(next_pts[i]);
            prev_pts_ = std::move(survived);
        }

        prev_gray_ = gray.clone();
        current_bgr_.release();

#else // No OpenCV — cannot compute real flow
        (void)frame_meta;
        (void)out_alerts;
        // Silently idle — zero-fake policy means we never emit synthetic events
        std::cout << "[MicroMotionModule] OpenCV not available — optical flow disabled" << std::endl;
        enabled_ = false;
#endif
        return true;
    }

    std::string get_name() const override { return "micro_motion"; }

    void update_config(const std::string& key, const std::string& val) override {
        if (key == "EnableMicroMotion") {
            enabled_ = (val == "true" || val == "1");
        } else if (key == "MicroMotionSensitivity") {
            try {
                // Sensitivity 0.0–1.0: maps to motion_threshold_px 0.5px–8px (inverted)
                float s = std::stof(val);
                s = std::max(0.0f, std::min(1.0f, s));
                motion_threshold_px_ = 8.0f * (1.0f - s) + 0.5f * s;
            } catch (...) {}
        } else if (key == "GrossMotionThreshold") {
            try { gross_motion_threshold_px_ = std::stof(val); } catch (...) {}
        }
    }

    void shutdown() override {
#if MICRO_MOTION_OPENCV
        prev_gray_.release();
        current_bgr_.release();
#endif
        prev_pts_.clear();
        frame_count_ = 0;
    }

    // ── Non-interface accessor — called by camai_engine.cpp ─────────────────
    // Provides the raw BGR frame for this processing cycle.
    // Must be called immediately before process_frame().
#if MICRO_MOTION_OPENCV
    void set_frame_bgr(const cv::Mat& bgr) {
        current_bgr_ = bgr;
    }
#else
    void set_frame_bgr(const void*) {}
#endif

private:
    bool    enabled_{true};
    int     frame_count_{0};

    // LK parameters
    float   motion_threshold_px_{1.5f};   // px displacement to classify as micro-motion
    float   gross_motion_threshold_px_{20.0f};  // above this → gross motion event
    int     max_corners_{100};
    double  quality_level_{0.01};
    double  min_distance_{10.0};
    int     block_size_{3};
    int     win_size_{15};
    int     corner_refresh_interval_{30};  // Re-detect corners every N frames

#if MICRO_MOTION_OPENCV
    cv::Mat                   prev_gray_;
    cv::Mat                   current_bgr_;
    std::vector<cv::Point2f>  prev_pts_;
#else
    std::vector<float>        prev_pts_;  // Placeholder, unused
#endif
};

} // namespace CamAI

#endif // CAMAI_MICRO_MOTION_MODULE_HPP
