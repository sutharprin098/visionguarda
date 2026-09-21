#ifndef CAMAI_CUSTOM_MODULE_HPP
#define CAMAI_CUSTOM_MODULE_HPP

#include "../module_interface.hpp"

namespace CamAI {

class CustomModule : public ICamAIModule {
public:
    CustomModule() = default;
    ~CustomModule() override = default;

    bool initialize(const std::string& config) override { (void)config; return true; }
    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        (void)frame_meta; (void)out_alerts;
        // User custom plug-in AI analytics stub
        return true;
    }
    std::string get_name() const override { return "custom"; }
    void update_config(const std::string& key, const std::string& val) override { (void)key; (void)val; }
    void shutdown() override {}
};

} // namespace CamAI

#endif // CAMAI_CUSTOM_MODULE_HPP
