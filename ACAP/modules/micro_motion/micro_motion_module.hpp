#ifndef CAMAI_MICRO_MOTION_MODULE_HPP
#define CAMAI_MICRO_MOTION_MODULE_HPP

#include "../module_interface.hpp"

namespace CamAI {

class MicroMotionModule : public ICamAIModule {
public:
    MicroMotionModule() = default;
    ~MicroMotionModule() override = default;

    bool initialize(const std::string& config) override { (void)config; return true; }
    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        (void)frame_meta; (void)out_alerts;
        // High-sensitivity optical flow micro-motion detection stub
        return true;
    }
    std::string get_name() const override { return "micro_motion"; }
    void update_config(const std::string& key, const std::string& val) override { (void)key; (void)val; }
    void shutdown() override {}
};

} // namespace CamAI

#endif // CAMAI_MICRO_MOTION_MODULE_HPP
