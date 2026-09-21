#include "../app/events.hpp"
#include "../app/config.hpp"
#include <iostream>
#include <cassert>

void run_event_tests() {
    std::cout << "[Test 4/4] Testing AXIS Event Producer & Config Manager..." << std::endl;

    CamAI::ConfigManager config;
    assert(config.initialize() == true);
    assert(config.get_value("ConfidenceThreshold") == "0.45");

    config.set_value("ConfidenceThreshold", "0.60");
    assert(config.get_value("ConfidenceThreshold") == "0.60");

    CamAI::EventProducer events;
    assert(events.initialize() == true);

    CamAI::EventAlert alert;
    alert.event_type = "INTRUSION";
    alert.module_name = "security";
    alert.track_id = 42;
    alert.confidence = 0.89f;
    alert.timestamp_ms = 1000;
    alert.details = "Unit Test Intrusion Event";

    assert(events.send_event(alert) == true);

    std::vector<CamAI::BoundingBox> dets;
    dets.push_back({0.1f, 0.2f, 0.3f, 0.4f, 0, 0.95f, 10, "Person"});
    std::string xml = events.generate_onvif_xml_metadata(dets, {});
    assert(xml.find("MetadataStream") != std::string::npos);
    assert(xml.find("ObjectId=\"10\"") != std::string::npos);

    events.shutdown();
    config.shutdown();

    std::cout << "  -> AXIS Event Producer & Config test passed." << std::endl;
}
