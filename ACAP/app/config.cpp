#include "config.hpp"
#include <iostream>

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
#include <axparameter.h>
#endif

namespace CamAI {

ConfigManager::ConfigManager() : ax_parameter_handle_(nullptr) {}

ConfigManager::~ConfigManager() {
    shutdown();
}

bool ConfigManager::initialize() {
    // Default initial parameters
    local_cache_["EnableSecurityModule"] = "true";
    local_cache_["ConfidenceThreshold"] = "0.45";
    local_cache_["EnableOverlay"] = "true";
    local_cache_["MaxProcessingFPS"] = "15";
    local_cache_["IntrusionROICoords"] = "100,100;500,100;500,400;100,400";
    local_cache_["TripwireCoords"] = "200,300;600,300";
    local_cache_["AwsApiUrl"] = "http://13.203.71.14:8000/api/detect";
    local_cache_["AwsApiKey"] = "";

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    GError* error = NULL;
    ax_parameter_handle_ = ax_parameter_new("camai_acap", &error);
    if (!ax_parameter_handle_ || error != NULL) {
        std::cerr << "[ConfigManager] Failed to create axparameter: " 
                  << (error ? error->message : "unknown") << std::endl;
        if (error) g_error_free(error);
        return false;
    }
    std::cout << "[ConfigManager] AXIS Native axparameter system initialized" << std::endl;
#else
    std::cout << "[ConfigManager] Host configuration manager initialized" << std::endl;
#endif

    is_initialized_ = true;
    return true;
}

std::string ConfigManager::get_value(const std::string& key, const std::string& default_val) const {
    auto it = local_cache_.find(key);
    if (it != local_cache_.end()) {
        return it->second;
    }
    return default_val;
}

bool ConfigManager::set_value(const std::string& key, const std::string& value) {
    local_cache_[key] = value;
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    if (ax_parameter_handle_) {
        GError* error = NULL;
        ax_parameter_set(AX_PARAMETER(ax_parameter_handle_), key.c_str(), value.c_str(), TRUE, &error);
        if (error) g_error_free(error);
    }
#endif
    if (change_callback_) {
        change_callback_(key, value);
    }
    return true;
}

void ConfigManager::register_callback(ParameterCallback cb) {
    change_callback_ = cb;
}

void ConfigManager::shutdown() {
    if (is_initialized_) {
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
        if (ax_parameter_handle_) {
            ax_parameter_free(AX_PARAMETER(ax_parameter_handle_));
            ax_parameter_handle_ = nullptr;
        }
#endif
        is_initialized_ = false;
    }
}

} // namespace CamAI
