#ifndef CAMAI_PPE_MODULE_HPP
#define CAMAI_PPE_MODULE_HPP

#include "../module_interface.hpp"
#include <unordered_map>
#include <string>
#include <vector>
#include <cmath>

namespace CamAI {

struct WorkerTrackState {
    int track_id{-1};
    bool has_helmet{false};
    bool has_vest{false};
    bool has_gloves{false};
    bool has_shoes{false};
    float confidence{0.0f};
    uint64_t first_seen_ms{0};
    uint64_t last_seen_ms{0};
    Point2D last_pos{0.0f, 0.0f};
};

class PPEModule : public ICamAIModule {
public:
    PPEModule() = default;
    ~PPEModule() override = default;

    bool initialize(const std::string& config) override {
        (void)config;
        worker_tracks_.clear();
        total_worker_count_ = 0;
        return true;
    }

    bool process_frame(const FrameMetadata& frame_meta, std::vector<EventAlert>& out_alerts) override {
        // Collect detections by class category
        std::vector<BoundingBox> persons;
        std::vector<BoundingBox> helmets;
        std::vector<BoundingBox> no_helmets;
        std::vector<BoundingBox> vests;
        std::vector<BoundingBox> no_vests;
        std::vector<BoundingBox> gloves;
        std::vector<BoundingBox> shoes;
        std::vector<BoundingBox> forklifts;
        std::vector<BoundingBox> fires;
        std::vector<BoundingBox> smokes;

        for (const auto& det : frame_meta.detections) {
            std::string lbl = det.label;
            int cid = det.class_id;

            if (cid == 0 || lbl == "person" || lbl == "worker" || lbl == "customer") {
                persons.push_back(det);
            } else if (lbl == "helmet" || cid == 80) {
                helmets.push_back(det);
            } else if (lbl == "no_helmet") {
                no_helmets.push_back(det);
            } else if (lbl == "vest" || lbl == "safety_vest") {
                vests.push_back(det);
            } else if (lbl == "no_vest") {
                no_vests.push_back(det);
            } else if (lbl == "gloves") {
                gloves.push_back(det);
            } else if (lbl == "shoes") {
                shoes.push_back(det);
            } else if (lbl == "forklift" || (lbl == "truck" && enable_forklift_)) {
                forklifts.push_back(det);
            } else if (lbl == "fire") {
                fires.push_back(det);
            } else if (lbl == "smoke") {
                smokes.push_back(det);
            }
        }

        // 1. FORKLIFT DETECTION
        if (enable_forklift_) {
            for (const auto& fl : forklifts) {
                if (fl.confidence >= forklift_conf_) {
                    EventAlert alert;
                    alert.event_type = "FORKLIFT_DETECTED";
                    alert.module_name = "factory";
                    alert.track_id = fl.track_id;
                    alert.bbox = fl;
                    alert.confidence = fl.confidence;
                    alert.timestamp_ms = frame_meta.timestamp_ms;
                    alert.details = "Industrial Vehicle / Forklift operating in active plant zone";
                    out_alerts.push_back(alert);
                }
            }
        }

        // 2. FIRE & SMOKE DETECTION
        if (enable_fire_) {
            for (const auto& f : fires) {
                if (f.confidence >= fire_conf_) {
                    EventAlert alert;
                    alert.event_type = "FIRE_HAZARD";
                    alert.module_name = "factory";
                    alert.track_id = f.track_id;
                    alert.bbox = f;
                    alert.confidence = f.confidence;
                    alert.timestamp_ms = frame_meta.timestamp_ms;
                    alert.details = "CRITICAL: Flame / Fire Hazard signature detected on plant floor";
                    out_alerts.push_back(alert);
                }
            }
        }
        if (enable_smoke_) {
            for (const auto& s : smokes) {
                if (s.confidence >= smoke_conf_) {
                    EventAlert alert;
                    alert.event_type = "SMOKE_HAZARD";
                    alert.module_name = "factory";
                    alert.track_id = s.track_id;
                    alert.bbox = s;
                    alert.confidence = s.confidence;
                    alert.timestamp_ms = frame_meta.timestamp_ms;
                    alert.details = "CRITICAL: Smoke plume / emission detected in facility";
                    out_alerts.push_back(alert);
                }
            }
        }

        // 3. WORKER & PPE ANALYTICS
        for (const auto& person : persons) {
            float cx = person.x + person.w * 0.5f;
            float cy = person.y + person.h * 0.5f;
            float head_top = person.y;
            float head_bottom = person.y + person.h * 0.35f;
            float body_top = person.y + person.h * 0.25f;
            float body_bottom = person.y + person.h * 0.75f;
            float feet_top = person.y + person.h * 0.75f;
            float feet_bottom = person.y + person.h;

            // Worker Detection Alert
            if (enable_worker_ && person.confidence >= worker_conf_) {
                EventAlert alert;
                alert.event_type = "WORKER_DETECTED";
                alert.module_name = "factory";
                alert.track_id = person.track_id;
                alert.bbox = person;
                alert.confidence = person.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "Plant worker active on monitored floor";
                out_alerts.push_back(alert);
            }

            // Fall Detection (Aspect ratio check: person lying down has w/h > 1.25)
            if (enable_fall_ && (person.w / std::max(0.001f, person.h)) > 1.25f && person.confidence >= fall_conf_) {
                EventAlert alert;
                alert.event_type = "FALL_DETECTED";
                alert.module_name = "factory";
                alert.track_id = person.track_id;
                alert.bbox = person;
                alert.confidence = person.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "MAN DOWN: Worker collapsed / fallen posture detected";
                out_alerts.push_back(alert);
            }

            // Helmet spatial association
            bool has_helmet = false;
            for (const auto& h : helmets) {
                float hcx = h.x + h.w * 0.5f;
                float hcy = h.y + h.h * 0.5f;
                if (hcx >= person.x && hcx <= (person.x + person.w) && hcy >= head_top && hcy <= head_bottom) {
                    has_helmet = true;
                    break;
                }
            }

            // Vest spatial association
            bool has_vest = false;
            for (const auto& v : vests) {
                float vcx = v.x + v.w * 0.5f;
                float vcy = v.y + v.h * 0.5f;
                if (vcx >= person.x && vcx <= (person.x + person.w) && vcy >= body_top && vcy <= body_bottom) {
                    has_vest = true;
                    break;
                }
            }

            // PPE / Helmet Compliance Alert
            if (enable_helmet_) {
                if (!has_helmet || !no_helmets.empty()) {
                    EventAlert alert;
                    alert.event_type = "NO_HELMET";
                    alert.module_name = "factory";
                    alert.track_id = person.track_id;
                    alert.bbox = person;
                    alert.confidence = person.confidence;
                    alert.timestamp_ms = frame_meta.timestamp_ms;
                    alert.details = "PPE Violation: No safety hard-hat detected on worker";
                    out_alerts.push_back(alert);
                } else {
                    EventAlert alert;
                    alert.event_type = "HELMET_COMPLIANT";
                    alert.module_name = "factory";
                    alert.track_id = person.track_id;
                    alert.bbox = person;
                    alert.confidence = person.confidence;
                    alert.timestamp_ms = frame_meta.timestamp_ms;
                    alert.details = "PPE Verified: Hard-hat helmet compliant";
                    out_alerts.push_back(alert);
                }
            }

            if (enable_vest_ && !has_vest) {
                EventAlert alert;
                alert.event_type = "NO_VEST";
                alert.module_name = "factory";
                alert.track_id = person.track_id;
                alert.bbox = person;
                alert.confidence = person.confidence;
                alert.timestamp_ms = frame_meta.timestamp_ms;
                alert.details = "PPE Violation: High-visibility safety vest missing";
                out_alerts.push_back(alert);
            }
        }

        return true;
    }

    std::string get_name() const override { return "factory"; }

    void update_config(const std::string& key, const std::string& val) override {
        bool b_val = (val == "true" || val == "1");
        if (key == "EnablePPEModule" || key == "ppe_detection") enable_ppe_ = b_val;
        else if (key == "helmet_detection") enable_helmet_ = b_val;
        else if (key == "safety_vest") enable_vest_ = b_val;
        else if (key == "gloves") enable_gloves_ = b_val;
        else if (key == "shoes") enable_shoes_ = b_val;
        else if (key == "worker_detection") enable_worker_ = b_val;
        else if (key == "worker_counting") enable_counting_ = b_val;
        else if (key == "forklift_detection") enable_forklift_ = b_val;
        else if (key == "fire_detection") enable_fire_ = b_val;
        else if (key == "smoke_detection") enable_smoke_ = b_val;
        else if (key == "fall_detection") enable_fall_ = b_val;
        else if (key == "restricted_machine_zone") enable_machine_zone_ = b_val;
        else if (key == "hazard_zone") enable_hazard_zone_ = b_val;
    }

    void shutdown() override {
        worker_tracks_.clear();
    }

private:
    bool enable_ppe_{true};
    bool enable_helmet_{true};
    bool enable_vest_{false};
    bool enable_gloves_{false};
    bool enable_shoes_{false};
    bool enable_worker_{false};
    bool enable_counting_{false};
    bool enable_forklift_{false};
    bool enable_fire_{false};
    bool enable_smoke_{false};
    bool enable_fall_{false};
    bool enable_machine_zone_{false};
    bool enable_hazard_zone_{false};

    float worker_conf_{0.40f};
    float forklift_conf_{0.45f};
    float fire_conf_{0.50f};
    float smoke_conf_{0.50f};
    float fall_conf_{0.50f};

    uint64_t total_worker_count_{0};
    std::unordered_map<int, WorkerTrackState> worker_tracks_;
};

} // namespace CamAI

#endif // CAMAI_PPE_MODULE_HPP
