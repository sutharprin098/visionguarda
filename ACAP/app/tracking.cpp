#include "tracking.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>

namespace CamAI {

ByteTracker::ByteTracker(int max_lost, float high_thresh, float low_thresh)
    : max_lost_(max_lost), high_thresh_(high_thresh), low_thresh_(low_thresh) {}

void ByteTracker::reset() {
    tracks_.clear();
    next_id_ = 1;
}

void ByteTracker::predict_track(Track& track) {
    // Constant velocity Kalman predictor step
    track.state[0] += track.state[4]; // x + vx
    track.state[1] += track.state[5]; // y + vy
    track.state[2] += track.state[6]; // w + vw
    track.state[3] += track.state[7]; // h + vh

    track.bbox.x = track.state[0];
    track.bbox.y = track.state[1];
    track.bbox.w = track.state[2];
    track.bbox.h = track.state[3];
    track.time_since_update++;
    track.age++;
}

void ByteTracker::update_track(Track& track, const BoundingBox& det) {
    float vx = det.x - track.state[0];
    float vy = det.y - track.state[1];
    float vw = det.w - track.state[2];
    float vh = det.h - track.state[3];

    // Smooth velocity with alpha filter (0.3)
    track.state[4] = 0.7f * track.state[4] + 0.3f * vx;
    track.state[5] = 0.7f * track.state[5] + 0.3f * vy;
    track.state[6] = 0.7f * track.state[6] + 0.3f * vw;
    track.state[7] = 0.7f * track.state[7] + 0.3f * vh;

    track.state[0] = det.x;
    track.state[1] = det.y;
    track.state[2] = det.w;
    track.state[3] = det.h;

    track.bbox = det;
    track.bbox.track_id = track.id;
    track.hits++;
    track.time_since_update = 0;
}

static float calc_track_iou(const BoundingBox& a, const BoundingBox& b) {
    float x1 = std::max(a.x, b.x);
    float y1 = std::max(a.y, b.y);
    float x2 = std::min(a.x + a.w, b.x + b.w);
    float y2 = std::min(a.y + a.h, b.y + b.h);

    float inter = std::max(0.0f, x2 - x1) * std::max(0.0f, y2 - y1);
    float area_a = a.w * a.h;
    float area_b = b.w * b.h;
    float union_area = area_a + area_b - inter;

    if (union_area <= 0.0f) return 0.0f;
    return inter / union_area;
}

void ByteTracker::update(const std::vector<BoundingBox>& detections, std::vector<BoundingBox>& out_tracked) {
    out_tracked.clear();

    // 1. Predict all existing tracks
    for (auto& trk : tracks_) {
        predict_track(trk);
    }

    std::vector<BoundingBox> high_dets;
    std::vector<BoundingBox> low_dets;
    for (const auto& d : detections) {
        if (d.confidence >= high_thresh_) {
            high_dets.push_back(d);
        } else if (d.confidence >= low_thresh_) {
            low_dets.push_back(d);
        }
    }

    std::vector<bool> det_matched(high_dets.size(), false);
    std::vector<bool> trk_matched(tracks_.size(), false);

    // 2. First association with high score detections
    for (size_t t = 0; t < tracks_.size(); ++t) {
        float best_iou = 0.2f; // Minimum IoU threshold
        int best_d = -1;
        for (size_t d = 0; d < high_dets.size(); ++d) {
            if (det_matched[d]) continue;
            float iou = calc_track_iou(tracks_[t].bbox, high_dets[d]);
            if (iou > best_iou) {
                best_iou = iou;
                best_d = static_cast<int>(d);
            }
        }
        if (best_d != -1) {
            trk_matched[t] = true;
            det_matched[best_d] = true;
            update_track(tracks_[t], high_dets[best_d]);
        }
    }

    // 3. Second association with low score detections for unassigned tracks
    for (size_t t = 0; t < tracks_.size(); ++t) {
        if (trk_matched[t]) continue;
        float best_iou = 0.2f;
        int best_d = -1;
        for (size_t d = 0; d < low_dets.size(); ++d) {
            float iou = calc_track_iou(tracks_[t].bbox, low_dets[d]);
            if (iou > best_iou) {
                best_iou = iou;
                best_d = static_cast<int>(d);
            }
        }
        if (best_d != -1) {
            trk_matched[t] = true;
            update_track(tracks_[t], low_dets[best_d]);
        }
    }

    // 4. Create new tracks for unmatched high score detections
    for (size_t d = 0; d < high_dets.size(); ++d) {
        if (!det_matched[d]) {
            Track new_track;
            new_track.id = next_id_++;
            new_track.bbox = high_dets[d];
            new_track.bbox.track_id = new_track.id;
            new_track.age = 1;
            new_track.hits = 1;
            new_track.time_since_update = 0;
            new_track.state[0] = high_dets[d].x;
            new_track.state[1] = high_dets[d].y;
            new_track.state[2] = high_dets[d].w;
            new_track.state[3] = high_dets[d].h;
            new_track.state[4] = 0.0f;
            new_track.state[5] = 0.0f;
            new_track.state[6] = 0.0f;
            new_track.state[7] = 0.0f;
            tracks_.push_back(new_track);
        }
    }

    // 5. Clean lost tracks and collect active output
    std::vector<Track> active_tracks;
    for (auto& trk : tracks_) {
        if (trk.time_since_update <= max_lost_) {
            active_tracks.push_back(trk);
            if (trk.time_since_update == 0) {
                out_tracked.push_back(trk.bbox);
            }
        }
    }
    tracks_ = std::move(active_tracks);
}

} // namespace CamAI
