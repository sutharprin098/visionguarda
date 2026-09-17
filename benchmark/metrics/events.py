"""CAM AI Tripwire & Zone Intrusion Event Analytics Metrics Engine.

Measures event detection TP, FP, FN, Precision, Recall, F1 score,
detection latency, false alarms per hour, and missed event rate.
"""

from typing import Dict, List
import numpy as np

from benchmark.dataset_schema import BenchmarkSample, EventAnnotation


class EventMetricsCalculator:
    """Evaluates Event / Analytics Alerts against ground-truth event logs."""

    def evaluate_events(self, samples: List[BenchmarkSample], total_stream_hours: float = 1.0) -> Dict[str, any]:
        tp_events = 0
        fp_events = 0
        fn_events = 0
        latencies_ms: List[float] = []

        for sample in samples:
            gt_events = sample.gt_events
            pred_events = sample.pred_events

            matched_preds = set()

            for gt in gt_events:
                best_match_idx = -1
                min_time_diff = float("inf")

                for p_idx, pred in enumerate(pred_events):
                    if p_idx in matched_preds:
                        continue
                    if pred.event_type == gt.event_type and pred.roi_name == gt.roi_name:
                        time_diff = abs(pred.timestamp_sec - gt.timestamp_sec)
                        if time_diff < min_time_diff and time_diff <= 2.0:  # 2-sec temporal window
                            min_time_diff = time_diff
                            best_match_idx = p_idx

                if best_match_idx != -1:
                    matched_preds.add(best_match_idx)
                    tp_events += 1
                    latencies_ms.append(min_time_diff * 1000.0)
                else:
                    fn_events += 1

            fp_events += len(pred_events) - len(matched_preds)

        precision = tp_events / max(1, tp_events + fp_events)
        recall = tp_events / max(1, tp_events + fn_events)
        f1 = (2 * precision * recall) / max(1e-6, precision + recall)

        false_alarms_per_hour = fp_events / max(0.1, total_stream_hours)
        avg_latency = float(np.mean(latencies_ms)) if latencies_ms else 0.0

        return {
            "tp_events": tp_events,
            "fp_events": fp_events,
            "fn_events": fn_events,
            "precision": round(precision * 100, 2),
            "recall": round(recall * 100, 2),
            "f1_score": round(f1 * 100, 2),
            "mean_detection_latency_ms": round(avg_latency, 2),
            "false_alarms_per_hour": round(false_alarms_per_hour, 2),
            "missed_events": fn_events,
        }
