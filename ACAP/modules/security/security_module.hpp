#ifndef CAMAI_SECURITY_MODULE_HPP
#define CAMAI_SECURITY_MODULE_HPP

#include "../module_interface.hpp"
#include <unordered_map>
#include <vector>
#include <string>

namespace CamAI {

struct SecurityTrackRecord {
    int track_id{-1};
    Point2D last_pos{0.0f, 0.0f};
    uint64_t first_seen_ms{0};
    uint64_t last_seen_ms{0};
    uint64_t stationary_start_ms{0};
    bool inside_roi{false};
};

class SecurityModule : public ICamAIModule {
public:
    SecurityModule();
    ~SecurityModule() override = default;

    bool initialize(const std::string& config_params) override;
    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override;
    std::string get_name() const override { return "security"; }
    void update_config(const std::string& key, const std::string& value) override;
    void shutdown() override;

    void set_intrusion_roi(const std::vector<Point2D>& polygon);
    void set_tripwire(const Point2D& p1, const Point2D& p2);

private:
    bool is_point_in_polygon(const Point2D& pt, const std::vector<Point2D>& poly);
    bool do_lines_intersect(const Point2D& p1, const Point2D& q1, const Point2D& p2, const Point2D& q2);

    bool enable_person_{true};
    bool enable_intrusion_{true};
    bool enable_restricted_area_{false};
    bool enable_perimeter_{true};
    bool enable_loitering_{false};
    bool enable_dwell_time_{false};
    bool enable_crowd_{false};
    bool enable_counting_{false};
    bool enable_object_left_{false};
    bool enable_object_removed_{false};
    bool enable_face_{false};
    bool enable_face_rec_{false};
    bool enable_fire_{false};
    bool enable_smoke_{false};
    bool enable_fall_{false};

    float loiter_threshold_sec_{30.0f};
    float dwell_threshold_sec_{15.0f};
    int crowd_threshold_{10};

    std::vector<Point2D> intrusion_roi_;
    struct LineSegment { Point2D p1; Point2D p2; } tripwire_;
    std::unordered_map<int, SecurityTrackRecord> tracks_;
};

} // namespace CamAI

#endif // CAMAI_SECURITY_MODULE_HPP
