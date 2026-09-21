#ifndef CAMAI_TRACKING_HPP
#define CAMAI_TRACKING_HPP

#include "module_interface.hpp"
#include <vector>
#include <unordered_map>

namespace CamAI {

struct Track {
    int id;
    BoundingBox bbox;
    int age;
    int hits;
    int time_since_update;
    // Kalman filter state [x, y, w, h, vx, vy, vw, vh]
    float state[8];
};

class ByteTracker {
public:
    ByteTracker(int max_lost = 30, float high_thresh = 0.5f, float low_thresh = 0.1f);
    ~ByteTracker() = default;

    void update(const std::vector<BoundingBox>& detections, std::vector<BoundingBox>& out_tracked);
    void reset();

private:
    int next_id_{1};
    int max_lost_{30};
    float high_thresh_{0.5f};
    float low_thresh_{0.1f};
    std::vector<Track> tracks_;

    void predict_track(Track& track);
    void update_track(Track& track, const BoundingBox>& det);
};

} // namespace CamAI

#endif // CAMAI_TRACKING_HPP
