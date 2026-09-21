#ifndef CAMAI_EVENTS_HPP
#define CAMAI_EVENTS_HPP

#include "module_interface.hpp"
#include <string>
#include <vector>

namespace CamAI {

class EventProducer {
public:
    EventProducer();
    ~EventProducer();

    bool initialize();
    bool send_event(const EventAlert& alert);
    std::string generate_onvif_xml_metadata(const std::vector<BoundingBox>& detections, const std::vector<EventAlert>& alerts);
    void shutdown();

private:
    bool is_initialized_{false};
    void* ax_event_handler_{nullptr};
    uint32_t event_declaration_id_{0};
};

} // namespace CamAI

#endif // CAMAI_EVENTS_HPP
