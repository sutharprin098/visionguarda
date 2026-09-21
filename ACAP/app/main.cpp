#include "camai_engine.hpp"
#include <iostream>
#include <csignal>
#include <chrono>
#include <thread>

static std::atomic<bool> g_shutdown_requested{false};

void signal_handler(int signal) {
    if (signal == SIGINT || signal == SIGTERM) {
        std::cout << "\n[CamAI Main] Signal " << signal << " received. Requesting clean shutdown..." << std::endl;
        g_shutdown_requested = true;
    }
}

int main(int argc, char* argv[]) {
    std::cout << "Starting CamAI ACAP Native Application v1.0.0..." << std::endl;

    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    std::string model_path = "models/yolox_tiny.onnx";
    if (argc > 1) {
        model_path = argv[1];
    }

    CamAI::CamAIEngine engine;
    if (!engine.initialize(model_path)) {
        std::cerr << "[CamAI Main] Engine initialization failed" << std::endl;
        return 1;
    }

    if (!engine.start()) {
        std::cerr << "[CamAI Main] Engine start failed" << std::endl;
        return 1;
    }

    std::cout << "[CamAI Main] Engine running. Press Ctrl+C to stop..." << std::endl;

    int tick = 0;
    while (!g_shutdown_requested) {
        std::this_thread::sleep_for(std::chrono::seconds(2));
        tick++;

        auto diag = engine.get_diagnostics();
        std::cout << "[CamAI Telemetry] FPS: " << diag.current_fps 
                  << " | Latency: " << diag.avg_inference_ms << " ms"
                  << " | Processed: " << diag.processed_frames
                  << " | Dropped: " << diag.dropped_frames
                  << " | RAM: " << diag.ram_usage_mb << "/" << diag.max_ram_limit_mb << " MB"
                  << std::endl;

        // In test/demonstration mode, exit after 5 telemetry ticks (~10s) unless running as daemon
        if (argc > 2 && std::string(argv[2]) == "--test-run" && tick >= 5) {
            std::cout << "[CamAI Main] Test run duration completed. Stopping engine..." << std::endl;
            break;
        }
    }

    engine.stop();
    std::cout << "[CamAI Main] CamAI ACAP Application terminated cleanly." << std::endl;
    return 0;
}
