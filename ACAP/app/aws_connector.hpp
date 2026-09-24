#ifndef CAMAI_AWS_CONNECTOR_HPP
#define CAMAI_AWS_CONNECTOR_HPP

#include <string>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>
#include <vector>

namespace CamAI {

class AWSConnector {
public:
    AWSConnector();
    ~AWSConnector();

    bool initialize(const std::string& api_url, const std::string& api_key);
    bool start();
    void stop();

    // Fire and forget: enqueues JSON telemetry for background transmission
    void enqueue_payload(const std::string& json_payload);

private:
    std::string api_url_;
    std::string api_key_;

    std::atomic<bool> is_running_{false};
    std::thread worker_thread_;

    std::queue<std::string> payload_queue_;
    std::mutex queue_mutex_;
    std::condition_variable queue_cv_;

    // Main background thread function
    void process_loop();
    
    // Perform synchronous libcurl POST request
    bool send_http_post(const std::string& json_payload);
};

} // namespace CamAI

#endif // CAMAI_AWS_CONNECTOR_HPP
