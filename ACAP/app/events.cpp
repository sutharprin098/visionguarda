#include "events.hpp"
#include <iostream>

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
#include <axevent.h>
#endif

namespace CamAI {

EventProducer::EventProducer() : ax_event_handler_(nullptr) {}

EventProducer::~EventProducer() {
    shutdown();
}

bool EventProducer::initialize() {
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    ax_event_handler_ = ax_event_handler_new();
    if (!ax_event_handler_) {
        std::cerr << "[EventProducer] Failed to create axevent handler" << std::endl;
        return false;
    }
    std::cout << "[EventProducer] AXIS Native axevent system initialized" << std::endl;
#else
    std::cout << "[EventProducer] Host simulation mode initialized" << std::endl;
#endif

    is_initialized_ = true;
    return true;
}

bool EventProducer::send_event(const EventAlert& alert) {
    if (!is_initialized_) return false;

    std::cout << "[EventProducer] EVENT EMITTED -> [" << alert.event_type 
              << "] Module: " << alert.module_name 
              << " | TrackID: " << alert.track_id 
              << " | Conf: " << alert.confidence 
              << " | Details: " << alert.details << std::endl;

#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
    if (ax_event_handler_) {
        AXEvent* event = ax_event_new();
        // Populate AXIS ONVIF Event Key-Value pairs
        // Topic: tns1:RuleEngine/CamAI/Security/Intrusion
        ax_event_key_value_set_add_key_value(ax_event_get_key_value_set(event),
                                             "eventType", NULL, alert.event_type.c_str(), AX_VALUE_TYPE_STRING, NULL);
        ax_event_key_value_set_add_key_value(ax_event_get_key_value_set(event),
                                             "module", NULL, alert.module_name.c_str(), AX_VALUE_TYPE_STRING, NULL);
        ax_event_key_value_set_add_key_value(ax_event_get_key_value_set(event),
                                             "trackId", NULL, &alert.track_id, AX_VALUE_TYPE_INT, NULL);
        ax_event_key_value_set_add_key_value(ax_event_get_key_value_set(event),
                                             "confidence", NULL, &alert.confidence, AX_VALUE_TYPE_DOUBLE, NULL);

        ax_event_handler_send_event(AX_EVENT_HANDLER(ax_event_handler_), event_declaration_id_, event, NULL);
        ax_event_free(event);
    }
#endif

    return true;
}

std::string EventProducer::generate_onvif_xml_metadata(const std::vector<BoundingBox>& detections, const std::vector<EventAlert>& alerts) {
    (void)alerts;
    std::string xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    xml += "<tt:MetadataStream xmlns:tt=\"http://www.onvif.org/ver10/schema\">\n";
    xml += "  <tt:VideoAnalytics>\n";
    xml += "    <tt:Frame UtcTime=\"2026-09-21T09:50:00Z\">\n";

    for (const auto& det : detections) {
        xml += "      <tt:Object ObjectId=\"" + std::to_string(det.track_id) + "\">\n";
        xml += "        <tt:Appearance>\n";
        xml += "          <tt:Class><tt:Type>" + det.label + "</tt:Type></tt:Class>\n";
        xml += "          <tt:Shape>\n";
        xml += "            <tt:BoundingBox left=\"" + std::to_string(det.x) + "\" top=\"" + std::to_string(det.y)
             + "\" right=\"" + std::to_string(det.x + det.w) + "\" bottom=\"" + std::to_string(det.y + det.h) + "\"/>\n";
        xml += "          </tt:Shape>\n";
        xml += "        </tt:Appearance>\n";
        xml += "      </tt:Object>\n";
    }

    xml += "    </tt:Frame>\n";
    xml += "  </tt:VideoAnalytics>\n";
    xml += "</tt:MetadataStream>\n";
    return xml;
}

void EventProducer::shutdown() {
    if (is_initialized_) {
#if defined(ACAP_NATIVE_BUILD) && ACAP_NATIVE_BUILD
        if (ax_event_handler_) {
            ax_event_handler_free(AX_EVENT_HANDLER(ax_event_handler_));
            ax_event_handler_ = nullptr;
        }
#endif
        is_initialized_ = false;
    }
}

} // namespace CamAI
