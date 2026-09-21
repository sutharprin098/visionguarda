#ifndef CAMAI_TRAFFIC_MODULE_HPP
#define CAMAI_TRAFFIC_MODULE_HPP

#include "../module_interface.hpp"

namespace CamAI {

class TrafficModule : public ICamAIModule {
public:
    TrafficModule() = default;
    ~TrafficModule() override = default;

    bool initialize(const std::string& config) override { (void)config; return true; }
    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        (void)frame_meta; (void)out_alerts;
        // Traffic speed estimation, vehicle classification, and ANPR integration stub
        return true;
    }
    std::string get_name() const override { return "traffic"; }
    void update_config(const std::string& key, const std::string& val) override { (void)key; (void)val; }
    void shutdown() override {}
};

} // namespace CamAI

#endif // CAMAI_TRAFFIC_MODULE_HPP
