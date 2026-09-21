#ifndef CAMAI_CONFIG_HPP
#define CAMAI_CONFIG_HPP

#include <string>
#include <unordered_map>
#include <functional>

namespace CamAI {

using ParameterCallback = std::function<void(const std::string& key, const std::string& value)>;

class ConfigManager {
public:
    ConfigManager();
    ~ConfigManager();

    bool initialize();
    std::string get_value(const std::string& key, const std::string& default_val = "") const;
    bool set_value(const std::string& key, const std::string& value);
    void register_callback(ParameterCallback cb);
    void shutdown();

private:
    bool is_initialized_{false};
    void* ax_parameter_handle_{nullptr};
    std::unordered_map<std::string, std::string> local_cache_;
    ParameterCallback change_callback_;
};

} // namespace CamAI

#endif // CAMAI_CONFIG_HPP
