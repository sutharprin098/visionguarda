#include "../app/video_pipeline.hpp"
#include "../app/diagnostics.hpp"
#include <iostream>
#include <cassert>

void run_pipeline_tests() {
    std::cout << "[Test 1/4] Testing Video Pipeline & Resource Governor..." << std::endl;

    CamAI::VideoPipeline pipeline;
    assert(pipeline.initialize(1920, 1080, 15) == true);
    assert(pipeline.start() == true);

    CamAI::VideoFrame frame;
    assert(pipeline.capture_frame(frame) == true);
    assert(frame.width == 1920);
    assert(frame.height == 1080);
    assert(frame.buffer.size() > 0);
    pipeline.release_frame(frame);

    pipeline.stop();

    CamAI::ResourceGovernor governor(256, 5);
    assert(governor.should_drop_frame(2) == false);
    assert(governor.should_drop_frame(5) == true);

    std::cout << "  -> Video Pipeline & Governor test passed." << std::endl;
}
