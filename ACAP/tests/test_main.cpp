#include <iostream>

// Declarations of module test runners
void run_pipeline_tests();
void run_tracking_tests();
void run_roi_tests();
void run_event_tests();

int main() {
    std::cout << "==================================================" << std::endl;
    std::cout << " Running CamAI ACAP C++ Unit & Component Tests     " << std::endl;
    std::cout << "==================================================" << std::endl;

    try {
        run_pipeline_tests();
        run_tracking_tests();
        run_roi_tests();
        run_event_tests();
        std::cout << "\n[PASS] All CamAI ACAP Unit Tests Passed Successfully!" << std::endl;
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "\n[FAIL] Unit Test Exception: " << e.what() << std::endl;
        return 1;
    }
}
