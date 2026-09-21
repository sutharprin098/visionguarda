#include "../modules/security/security_module.hpp"
#include <iostream>
#include <cassert>

void run_roi_tests() {
    std::cout << "[Test 3/4] Testing Security Module ROI Intrusion & Tripwire Geometry..." << std::endl;

    std::vector<CamAI::Point2D> polygon = {
        {0.1f, 0.1f}, {0.8f, 0.1f}, {0.8f, 0.8f}, {0.1f, 0.8f}
    };

    CamAI::Point2D inside_pt{0.4f, 0.4f};
    CamAI::Point2D outside_pt{0.9f, 0.9f};

    assert(CamAI::SecurityModule::is_point_in_polygon(inside_pt, polygon) == true);
    assert(CamAI::SecurityModule::is_point_in_polygon(outside_pt, polygon) == false);

    // Line intersection test
    CamAI::Point2D p1{0.1f, 0.5f}, q1{0.9f, 0.5f}; // Tripwire line
    CamAI::Point2D p2{0.5f, 0.1f}, q2{0.5f, 0.9f}; // Crossing trajectory
    CamAI::Point2D p3{0.1f, 0.1f}, q3{0.2f, 0.2f}; // Non-crossing trajectory

    assert(CamAI::SecurityModule::do_lines_intersect(p1, q1, p2, q2) == true);
    assert(CamAI::SecurityModule::do_lines_intersect(p1, q1, p3, q3) == false);

    std::cout << "  -> ROI polygon & line-crossing math tests passed." << std::endl;
}
