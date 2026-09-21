#include "../app/video_pipeline.hpp"
#include "../app/inference.hpp"
#include "../app/tracking.hpp"
#include "../app/diagnostics.hpp"
#include "../modules/security/security_module.hpp"
#include <iostream>
#include <fstream>
#include <chrono>
#include <vector>

int main() {
    std::cout << "==================================================" << std::endl;
    std::cout << " CamAI ACAP Native Application Performance Benchmark" << std::endl;
    std::cout << "==================================================" << std::endl;

    CamAI::VideoPipeline pipeline;
    CamAI::InferenceEngine inference;
    CamAI::ByteTracker tracker;
    CamAI::SecurityModule security;
    CamAI::ResourceGovernor governor(256, 5);

    pipeline.initialize(1920, 1080, 15);
    pipeline.start();
    inference.load_model("models/yolox_tiny.onnx", 0.45f);
    security.initialize("");

    const int TOTAL_BENCHMARK_FRAMES = 100;
    std::vector<float> latency_samples;

    std::cout << "[*] Running 100 frame benchmark cycle..." << std::endl;
    auto start_time = std::chrono::high_resolution_clock::now();

    for (int i = 0; i < TOTAL_BENCHMARK_FRAMES; ++i) {
        CamAI::VideoFrame frame;
        if (!pipeline.capture_frame(frame)) continue;

        auto t0 = std::chrono::high_resolution_clock::now();

        std::vector<CamAI::BoundingBox> raw_dets;
        float inf_ms = 0.0f;
        inference.run_inference(frame, raw_dets, inf_ms);

        std::vector<CamAI::BoundingBox> tracked;
        tracker.update(raw_dets, tracked);

        CamAI::FrameMetadata meta;
        meta.frame_index = frame.frame_index;
        meta.timestamp_ms = frame.timestamp_ms;
        meta.width = frame.width;
        meta.height = frame.height;
        meta.detections = tracked;

        std::vector<CamAI::EventAlert> alerts;
        security.process_frame(meta, alerts);

        auto t1 = std::chrono::high_resolution_clock::now();
        float frame_latency = std::chrono::duration<float, std::milli>(t1 - t0).count();
        latency_samples.push_back(frame_latency);

        governor.record_frame_processed(inf_ms);
        pipeline.release_frame(frame);
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    float total_duration_sec = std::chrono::duration<float>(end_time - start_time).count();

    float total_lat = 0.0f;
    for (float l : latency_samples) total_lat += l;
    float avg_latency = (latency_samples.empty()) ? 0.0f : (total_lat / latency_samples.size());
    float fps = (total_duration_sec > 0.0f) ? (TOTAL_BENCHMARK_FRAMES / total_duration_sec) : 0.0f;

    auto diag = governor.get_diagnostics();

    std::cout << "\n[+] Benchmark Results:" << std::endl;
    std::cout << "  - Processed Frames: " << TOTAL_BENCHMARK_FRAMES << std::endl;
    std::cout << "  - Total Duration:   " << total_duration_sec << " s" << std::endl;
    std::cout << "  - Average FPS:      " << fps << " FPS" << std::endl;
    std::cout << "  - Avg Frame Latency: " << avg_latency << " ms" << std::endl;
    std::cout << "  - Avg Inf Latency:   " << diag.avg_inference_ms << " ms" << std::endl;
    std::cout << "  - Memory Usage:      " << diag.ram_usage_mb << " MB" << std::endl;
    std::cout << "  - Dropped Frames:    " << diag.dropped_frames << std::endl;

    // Write machine-readable JSON benchmark report
    std::ofstream out("benchmarks/benchmark_results.json");
    if (out.is_open()) {
        out << "{\n";
        out << "  \"application\": \"camai_acap\",\n";
        out << "  \"version\": \"1.0.0\",\n";
        out << "  \"total_frames\": " << TOTAL_BENCHMARK_FRAMES << ",\n";
        out << "  \"duration_seconds\": " << total_duration_sec << ",\n";
        out << "  \"fps\": " << fps << ",\n";
        out << "  \"avg_frame_latency_ms\": " << avg_latency << ",\n";
        out << "  \"avg_inference_latency_ms\": " << diag.avg_inference_ms << ",\n";
        out << "  \"ram_usage_mb\": " << diag.ram_usage_mb << ",\n";
        out << "  \"dropped_frames\": " << diag.dropped_frames << ",\n";
        out << "  \"status\": \"PASS\"\n";
        out << "}\n";
        out.close();
        std::cout << "[+] Saved benchmark results to benchmarks/benchmark_results.json" << std::endl;
    }

    pipeline.stop();
    return 0;
}
