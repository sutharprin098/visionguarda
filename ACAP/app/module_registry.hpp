#ifndef CAMAI_MODULE_REGISTRY_HPP
#define CAMAI_MODULE_REGISTRY_HPP

#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <memory>
#include <mutex>
#include "modules/module_interface.hpp"

namespace CamAI {

struct ModuleDescriptor {
    std::string module_id;
    std::string display_name;
    std::string profile;
    std::string category;
    bool enabled{false};
    std::string model;
    std::string backend;
    std::vector<std::string> input_requirements;
    std::vector<std::string> event_types;
    std::string overlay_type;
    std::string status{"OFF"}; // "OFF", "READY", "RUNNING", "ERROR", "BLOCKED"
    
    // Live metrics
    uint64_t inference_count{0};
    float actual_fps{0.0f};
    float actual_latency_ms{0.0f};
    uint64_t last_frame_id{0};
    uint64_t last_timestamp_ms{0};
    uint32_t error_count{0};
    std::string last_error{""};
};

class ModuleRegistry {
public:
    static ModuleRegistry& instance() {
        static ModuleRegistry reg;
        return reg;
    }

    void register_module(const ModuleDescriptor& desc, std::shared_ptr<ICamAIModule> instance) {
        std::lock_guard<std::mutex> lock(mutex_);
        descriptors_[desc.module_id] = desc;
        if (instance) {
            modules_[desc.module_id] = instance;
        }
    }

    void set_module_enabled(const std::string& module_id, bool enabled) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = descriptors_.find(module_id);
        if (it != descriptors_.end()) {
            it->second.enabled = enabled;
            it->second.status = enabled ? "READY" : "OFF";
        }
    }

    bool is_module_enabled(const std::string& module_id) const {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = descriptors_.find(module_id);
        return (it != descriptors_.end()) ? it->second.enabled : false;
    }

    std::vector<std::string> get_enabled_module_ids() const {
        std::lock_guard<std::mutex> lock(mutex_);
        std::vector<std::string> res;
        for (const auto& [id, desc] : descriptors_) {
            if (desc.enabled) res.push_back(id);
        }
        return res;
    }

    std::vector<ModuleDescriptor> get_all_descriptors() const {
        std::lock_guard<std::mutex> lock(mutex_);
        std::vector<ModuleDescriptor> res;
        for (const auto& [id, desc] : descriptors_) {
            res.push_back(desc);
        }
        return res;
    }

    std::shared_ptr<ICamAIModule> get_module(const std::string& module_id) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = modules_.find(module_id);
        return (it != modules_.end()) ? it->second : nullptr;
    }

    void record_module_execution(const std::string& module_id, uint64_t frame_id, uint64_t ts, float latency, float fps) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = descriptors_.find(module_id);
        if (it != descriptors_.end()) {
            it->second.inference_count++;
            it->second.last_frame_id = frame_id;
            it->second.last_timestamp_ms = ts;
            it->second.actual_latency_ms = latency;
            it->second.actual_fps = fps;
            it->second.status = "RUNNING";
        }
    }

    void record_module_error(const std::string& module_id, const std::string& err) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = descriptors_.find(module_id);
        if (it != descriptors_.end()) {
            it->second.error_count++;
            it->second.last_error = err;
            it->second.status = "ERROR";
        }
    }

private:
    ModuleRegistry() = default;
    mutable std::mutex mutex_;
    std::unordered_map<std::string, ModuleDescriptor> descriptors_;
    std::unordered_map<std::string, std::shared_ptr<ICamAIModule>> modules_;
};

} // namespace CamAI

#endif // CAMAI_MODULE_REGISTRY_HPP
