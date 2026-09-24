#ifndef CAMAI_SMART_CITY_MODULE_HPP
#define CAMAI_SMART_CITY_MODULE_HPP

#include "../module_interface.hpp"
#include <string>
#include <vector>
#include <algorithm>

namespace CamAI {

class SmartCityModule : public ICamAIModule {
public:
    SmartCityModule() = default;
    ~SmartCityModule() override = default;

    bool initialize(const std::string& config) override {
        (void)config;
        return true;
    }

    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        int urban_people = 0;
        int urban_vehicles = 0;

        for (const auto& det : frame_meta.detections) {
            std::string lbl = det.label;
            int cid = det.class_id;

            bool is_person = (cid == 0 || lbl == "person");
            bool is_vehicle = (cid == 2 || cid == 3 || cid == 5 || cid == 7 || lbl == "car" || lbl == "bus" || lbl == "truck");

            if (is_person) urban_people++;
            if (is_vehicle) urban_vehicles++;

            // 1. URBAN MULTI-CLASS DETECTION
            if (enable_urban_ && det.confidence >= 0.40f) {
                EventAlert alert;
                alert.event_type = "URBAN_OBJECT_DETECTED";
                alert.module_name = "smart_city";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "Urban object mapped: " + lbl;
                out_alerts.push_back(alert);
            }

            // 2. BUS / DEDICATED LANE INTRUSION
            if (enable_bus_lane_ && is_vehicle && (lbl == "car" || lbl == "motorcycle") && det.confidence >= 0.45f) {
                EventAlert alert;
                alert.event_type = "DEDICATED_LANE_VIOLATION";
                alert.module_name = "smart_city";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "Private vehicle blocking dedicated transit/bus lane";
                out_alerts.push_back(alert);
            }

            // 3. MUNICIPAL ANPR
            if (enable_anpr_ && (lbl == "number_plate" || lbl == "plate")) {
                EventAlert alert;
                alert.event_type = "MUNICIPAL_ANPR_MATCH";
                alert.module_name = "smart_city";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "Municipal ANPR Corridor: Plate read logged";
                out_alerts.push_back(alert);
            }

            // 4. TWO-WHEELER HELMET COMPLIANCE
            if (enable_helmet_ && lbl == "no_helmet") {
                EventAlert alert;
                alert.event_type = "TWO_WHEELER_SAFETY_ALERT";
                alert.module_name = "smart_city";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "Urban Safety Violation: Helmetless rider detected on municipal roadway";
                out_alerts.push_back(alert);
            }
        }

        // 5. PUBLIC GATHERING & DENSITY
        if (enable_crowd_ && urban_people >= crowd_alert_threshold_) {
            EventAlert alert;
            alert.event_type = "PUBLIC_GATHERING_DENSITY";
            alert.module_name = "smart_city";
            alert.confidence = 0.92f;
            alert.timestamp_ms = frame_meta.timestamp_ms;
            alert.details = "High density public gathering detected in civic square (" + std::to_string(urban_people) + " citizens)";
            out_alerts.push_back(alert);
        }

        return true;
    }

    std::string get_name() const override { return "smart_city"; }

    void update_config(const std::string& key, const std::string& val) override {
        bool b_val = (val == "true" || val == "1");
        if (key == "urban_detection" || key == "EnableSmartCityModule") enable_urban_ = b_val;
        else if (key == "crowd_gathering") enable_crowd_ = b_val;
        else if (key == "bus_lane_intrusion") enable_bus_lane_ = b_val;
        else if (key == "anpr") enable_anpr_ = b_val;
        else if (key == "helmet_detection") enable_helmet_ = b_val;
    }

    void shutdown() override {}

private:
    bool enable_urban_{true};
    bool enable_crowd_{false};
    bool enable_bus_lane_{false};
    bool enable_anpr_{false};
    bool enable_helmet_{false};
    int crowd_alert_threshold_{25};
};

} // namespace CamAI

#endif // CAMAI_SMART_CITY_MODULE_HPP
