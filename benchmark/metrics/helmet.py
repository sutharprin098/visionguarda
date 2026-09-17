"""CAM AI Helmet Detection Metrics Engine.

Measures Precision, Recall, F1 score, and confusion matrix for RT-DETR
rider helmet / no-helmet classification on person bounding box crops.
"""

from typing import Dict, List
import numpy as np

from benchmark.dataset_schema import BenchmarkSample, HelmetAnnotation


class HelmetMetricsCalculator:
    """Evaluates Helmet / No Helmet classification performance."""

    def __init__(self, iou_threshold: float = 0.50):
        self.iou_threshold = iou_threshold

    def evaluate_helmets(self, samples: List[BenchmarkSample]) -> Dict[str, any]:
        # Confusion matrix categories: [Helmet, No_Helmet]
        # Rows: Ground Truth, Columns: Prediction
        conf_matrix = {
            "helmet": {"helmet": 0, "no_helmet": 0, "missed": 0},
            "no_helmet": {"helmet": 0, "no_helmet": 0, "missed": 0},
        }

        total_gt_helmets = 0
        total_gt_no_helmets = 0

        for sample in samples:
            gt_helmets = sample.gt_helmets
            pred_helmets = sample.pred_helmets

            matched_pred = set()

            for gt in gt_helmets:
                if gt.state == "helmet":
                    total_gt_helmets += 1
                else:
                    total_gt_no_helmets += 1

                best_iou = 0.0
                best_pred_idx = -1
                for p_idx, pred in enumerate(pred_helmets):
                    if p_idx in matched_pred:
                        continue
                    iou = gt.bbox.iou(pred.bbox)
                    if iou > best_iou:
                        best_iou = iou
                        best_pred_idx = p_idx

                if best_iou >= self.iou_threshold and best_pred_idx != -1:
                    matched_pred.add(best_pred_idx)
                    pred_state = pred_helmets[best_pred_idx].state
                    conf_matrix[gt.state][pred_state] += 1
                else:
                    conf_matrix[gt.state]["missed"] += 1

        # Calculate metrics for "helmet"
        h_tp = conf_matrix["helmet"]["helmet"]
        h_fp = conf_matrix["no_helmet"]["helmet"]
        h_fn = conf_matrix["helmet"]["no_helmet"] + conf_matrix["helmet"]["missed"]
        h_p = h_tp / max(1, h_tp + h_fp)
        h_r = h_tp / max(1, h_tp + h_fn)
        h_f1 = (2 * h_p * h_r) / max(1e-6, h_p + h_r)

        # Calculate metrics for "no_helmet"
        nh_tp = conf_matrix["no_helmet"]["no_helmet"]
        nh_fp = conf_matrix["helmet"]["no_helmet"]
        nh_fn = conf_matrix["no_helmet"]["helmet"] + conf_matrix["no_helmet"]["missed"]
        nh_p = nh_tp / max(1, nh_tp + nh_fp)
        nh_r = nh_tp / max(1, nh_tp + nh_fn)
        nh_f1 = (2 * nh_p * nh_r) / max(1e-6, nh_p + nh_r)

        overall_acc = (h_tp + nh_tp) / max(1, total_gt_helmets + total_gt_no_helmets)

        return {
            "total_gt_instances": total_gt_helmets + total_gt_no_helmets,
            "overall_accuracy": round(overall_acc * 100, 2),
            "helmet_class": {
                "precision": round(h_p * 100, 2),
                "recall": round(h_r * 100, 2),
                "f1_score": round(h_f1 * 100, 2),
                "gt_count": total_gt_helmets,
            },
            "no_helmet_class": {
                "precision": round(nh_p * 100, 2),
                "recall": round(nh_r * 100, 2),
                "f1_score": round(nh_f1 * 100, 2),
                "gt_count": total_gt_no_helmets,
            },
            "confusion_matrix": conf_matrix,
        }
