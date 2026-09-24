#include "aws_connector.hpp"
#include <iostream>
#include <chrono>

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
#include <curl/curl.h>
#endif

namespace CamAI {

AWSConnector::AWSConnector() {}

AWSConnector::~AWSConnector() {
    stop();
}

bool AWSConnector::initialize(const std::string& api_url, const std::string& api_key) {
    api_url_ = api_url;
    api_key_ = api_key;
    
    if (api_url_.empty()) {
        std::cout << "[AWSConnector] Disabled (No API URL configured)" << std::endl;
        return false;
    }
    
    std::cout << "[AWSConnector] Initialized for URL: " << api_url_ << std::endl;
    return true;
}

bool AWSConnector::start() {
    if (api_url_.empty() || is_running_) return false;
    
    is_running_ = true;
    worker_thread_ = std::thread(&AWSConnector::process_loop, this);
    std::cout << "[AWSConnector] Background telemetry thread started" << std::endl;
    return true;
}

void AWSConnector::enqueue_payload(const std::string& json_payload) {
    if (!is_running_ || api_url_.empty()) return;
    
    std::lock_guard<std::mutex> lock(queue_mutex_);
    // Limit queue size to prevent memory explosion if network is down
    if (payload_queue_.size() < 1000) {
        payload_queue_.push(json_payload);
        queue_cv_.notify_one();
    } else {
        std::cerr << "[AWSConnector] Queue full, dropping telemetry frame!" << std::endl;
    }
}

void AWSConnector::process_loop() {
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    curl_global_init(CURL_GLOBAL_ALL);
#endif

    while (is_running_) {
        std::string payload;
        {
            std::unique_lock<std::mutex> lock(queue_mutex_);
            queue_cv_.wait_for(lock, std::chrono::milliseconds(100), [this]() {
                return !payload_queue_.empty() || !is_running_;
            });
            
            if (!is_running_ && payload_queue_.empty()) break;
            if (payload_queue_.empty()) continue;
            
            payload = payload_queue_.front();
            payload_queue_.pop();
        }
        
        if (!payload.empty()) {
            send_http_post(payload);
        }
    }

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    curl_global_cleanup();
#endif
}

bool AWSConnector::send_http_post(const std::string& json_payload) {
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    CURL* curl = curl_easy_init();
    if (!curl) return false;
    
    struct curl_slist* headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    if (!api_key_.empty()) {
        std::string auth_header = "x-api-key: " + api_key_;
        headers = curl_slist_append(headers, auth_header.c_str());
    }
    
    curl_easy_setopt(curl, CURLOPT_URL, api_url_.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_payload.c_str());
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L); // 5 seconds timeout
    
    CURLcode res = curl_easy_perform(curl);
    
    if (res != CURLE_OK) {
        std::cerr << "[AWSConnector] curl_easy_perform() failed: " 
                  << curl_easy_strerror(res) << std::endl;
    }
    
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    
    return (res == CURLE_OK);
#else
    // Host simulation mode - do not actually perform HTTP requests without curl
    std::cout << "[AWSConnector] [SIMULATION] POST to " << api_url_ << " -> " << json_payload.substr(0, 50) << "..." << std::endl;
    return true;
#endif
}

void AWSConnector::stop() {
    if (is_running_) {
        is_running_ = false;
        queue_cv_.notify_all();
        if (worker_thread_.joinable()) {
            worker_thread_.join();
        }
        
        // Empty queue
        std::lock_guard<std::mutex> lock(queue_mutex_);
        while (!payload_queue_.empty()) payload_queue_.pop();
        
        std::cout << "[AWSConnector] Background thread stopped" << std::endl;
    }
}

} // namespace CamAI
