#ifndef CAMAI_RETAIL_MODULE_HPP
#define CAMAI_RETAIL_MODULE_HPP

#include "../module_interface.hpp"
#include <unordered_map>
#include <string>
#include <vector>

namespace CamAI {

struct RetailCustomerTrack {
    int track_id{-1};
    uint64_t first_seen_ms{0};
    uint64_t last_seen_ms{0};
    Point2D last_pos{0.0f, 0.0f};
};

class RetailModule : public ICamAIModule {
public:
    RetailModule() = default;
    ~RetailModule() override = default;

    bool initialize(const std::string& config) override {
        (void)config;
        tracks_.clear();
        footfall_count_ = 0;
        return true;
    }

    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        int customer_count = 0;

        for (const auto& det : frame_meta.detections) {
            std::string lbl = det.label;
            int cid = det.class_id;

            bool is_person = (cid == 0 || lbl == "person" || lbl == "customer" || lbl == "staff");
            bool is_face = (lbl == "face");

            if (is_person) customer_count++;

            Point2D center = {det.x + det.w * 0.5f, det.y + det.h * 0.5f};

            // 1. CUSTOMER & STAFF DETECTION
            if (enable_customer_ && is_person && det.confidence >= 0.40f) {
                EventAlert alert;
                alert.event_type = "CUSTOMER_LOCATED";
                alert.module_name = "retail";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "Store visitor/associate active in aisle";
                out_alerts.push_back(alert);
            }

            // 2. SHELF & PRODUCT DWELL TIME
            if (is_person && det.track_id >= 0) {
                auto& trk = tracks_[det.track_id];
                if (trk.first_seen_ms == 0) {
                    trk.track_id = det.track_id;
                    trk.first_seen_ms = frame_meta.timestamp_ms;
                }
                trk.last_seen_ms = frame_meta.timestamp_ms;
                trk.last_pos = center;

                float dwell_sec = (frame_meta.timestamp_ms - trk.first_seen_ms) / 1000.0f;
                if (enable_shelf_dwell_ && dwell_sec >= dwell_threshold_sec_) {
                    EventAlert alert;
                    alert.event_type = "HIGH_ENGAGEMENT_DWELL";
                    alert.module_name = "retail";
                    alert.track_id = det.track_id;
                    alert.bbox = det;
                    alert.confidence = det.confidence;
                    alert.timestamp_ms = frame_meta.timestamp_ms;
                    alert.details = "Customer engagement dwell (" + std::to_string((int)dwell_sec) + "s) at product display";
                    out_alerts.push_back(alert);
                }
            }

            // 3. VIP / DEMOGRAPHICS FACE DETECTION
            if (enable_face_ && is_face && det.confidence >= 0.50f) {
                EventAlert alert;
                alert.event_type = "RETAIL_VIP_FACE_DETECTED";
                alert.module_name = "retail";
                alert.track_id = det.track_id;
                alert.bbox = det;
                alert.confidence = det.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "VIP Demographics / Customer face scanned";
                out_alerts.push_back(alert);
            }
        }

        // 4. CHECKOUT QUEUE LENGTH
        if (enable_queue_ && customer_count >= queue_alert_threshold_) {
            EventAlert alert;
            alert.event_type = "CHECKOUT_QUEUE_ALERT";
            alert.module_name = "retail";
            alert.confidence = 0.90f;
            alert.timestamp_ms = frame_meta.timestamp_ms;
            alert.details = "Register queue length exceeded threshold (" + std::to_string(customer_count) + " waiting customers)";
            out_alerts.push_back(alert);
        }

        return true;
    }

    std::string get_name() const override { return "retail"; }

    void update_config(const std::string& key, const std::string& val) override {
        bool b_val = (val == "true" || val == "1");
        if (key == "customer_detection" || key == "EnableRetailModule") enable_customer_ = b_val;
        else if (key == "footfall_counting") enable_footfall_ = b_val;
        else if (key == "shelf_dwell_time") enable_shelf_dwell_ = b_val;
        else if (key == "checkout_queue_monitoring") enable_queue_ = b_val;
        else if (key == "face_detection") enable_face_ = b_val;
    }

    void shutdown() override {
        tracks_.clear();
    }

private:
    bool enable_customer_{true};
    bool enable_footfall_{false};
    bool enable_shelf_dwell_{false};
    bool enable_queue_{false};
    bool enable_face_{false};

    float dwell_threshold_sec_{15.0f};
    int queue_alert_threshold_{5};
    uint64_t footfall_count_{0};
    std::unordered_map<int, RetailCustomerTrack> tracks_;
};

} // namespace CamAI

#endif // CAMAI_RETAIL_MODULE_HPP
