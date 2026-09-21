#include "../app/tracking.hpp"
#include <iostream>
#include <cassert>

void run_tracking_tests() {
    std::cout << "[Test 2/4] Testing C++ ByteTrack Multi-Object Tracker..." << std::endl;

    CamAI::ByteTracker tracker(30, 0.5f, 0.1f);

    std::vector<CamAI::BoundingBox> dets_frame1;
    CamAI::BoundingBox b1{0.20f, 0.30f, 0.10f, 0.20f, 0, 0.90f, -1, "Person"};
    dets_frame1.push_back(b1);

    std::vector<CamAI::BoundingBox> tracked1;
    tracker.update(dets_frame1, tracked1);
    assert(tracked1.size() == 1);
    int assigned_id = tracked1[0].track_id;
    assert(assigned_id > 0);

    // Frame 2: Slightly moved person
    std::vector<CamAI::BoundingBox> dets_frame2;
    CamAI::BoundingBox b2{0.21f, 0.31f, 0.10f, 0.20f, 0, 0.88f, -1, "Person"};
    dets_frame2.push_back(b2);

    std::vector<CamAI::BoundingBox> tracked2;
    tracker.update(dets_frame2, tracked2);
    assert(tracked2.size() == 1);
    assert(tracked2[0].track_id == assigned_id); // Zero ID switch

    std::cout << "  -> ByteTrack persistence test passed (ID: " << assigned_id << " preserved)." << std::endl;
}
