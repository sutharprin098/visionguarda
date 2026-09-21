#ifndef CAMAI_SECURITY_MODULE_HPP
#define CAMAI_SECURITY_MODULE_HPP

#include "module_interface.hpp"
#include <unordered_map>
#include <vector>

namespace CamAI {

struct Point2D {
    float x;
    float y;
};

struct LineSegment {
    Point2D p1;
    Point2D p2;
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

    // Direct helper methods for unit testing
    void set_intrusion_roi(const std::vector<Point2D>& polygon);
    void set_tripwire(const Point2D& p1, const Point2D& p2);
    static bool is_point_in_polygon(const Point2D& pt, const std::vector<Point2D>& poly);
    static bool do_lines_intersect(const Point2D& p1, const Point2D& q1, const Point2D& p2, const Point2D& q2);

private:
    std::vector<Point2D> intrusion_roi_;
    LineSegment tripwire_;
    bool roi_enabled_{true};
    bool tripwire_enabled_{true};

    // Track history for line crossing sub-frame interpolation
    std::unordered_map<int, Point2D> last_track_positions_;
    std::unordered_map<int, uint64_t> track_first_seen_;
};

} // namespace CamAI

#endif // CAMAI_SECURITY_MODULE_HPP
