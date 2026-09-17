"""CAM AI Object Detection Metrics Engine.

Calculates TP, FP, FN, Precision, Recall, F1, mAP@0.50, mAP@0.50:0.95,
per-class, per-scenario, and overall performance, along with PR curves
and confidence threshold optimization across splits.
"""

from collections import defaultdict
from typing import Dict, List, Optional, Tuple
import numpy as np

from benchmark.dataset_schema import BenchmarkSample, BoundingBox, DetectionAnnotation, ScenarioCondition


class DetectionMetricsCalculator:
    """Evaluates Object Detection predictions against ground truth."""

    def __init__(self, iou_threshold: float = 0.50, conf_threshold: float = 0.20):
        self.iou_threshold = iou_threshold
        self.conf_threshold = conf_threshold

    @staticmethod
    def match_detections(
        gt_dets: List[DetectionAnnotation],
        pred_dets: List[DetectionAnnotation],
        iou_threshold: float,
    ) -> Tuple[int, int, int]:
        """Match predictions to ground truth by class and IoU. Returns (TP, FP, FN)."""
        tp = 0
        fp = 0
        matched_gt = set()

        # Sort predictions by confidence descending
        sorted_preds = sorted(pred_dets, key=lambda x: x.confidence, reverse=True)

        for pred in sorted_preds:
            best_iou = 0.0
            best_gt_idx = -1
            for idx, gt in enumerate(gt_dets):
                if idx in matched_gt or pred.label != gt.label:
                    continue
                iou = pred.bbox.iou(gt.bbox)
                if iou > best_iou:
                    best_iou = iou
                    best_gt_idx = idx

            if best_iou >= iou_threshold and best_gt_idx != -1:
                tp += 1
                matched_gt.add(best_gt_idx)
            else:
                fp += 1

        fn = len(gt_dets) - len(matched_gt)
        return tp, fp, fn

    def evaluate_samples(
        self, samples: List[BenchmarkSample], iou_threshold: Optional[float] = None, conf_threshold: Optional[float] = None
    ) -> Dict[str, any]:
        iou_t = iou_threshold if iou_threshold is not None else self.iou_threshold
        conf_t = conf_threshold if conf_threshold is not None else self.conf_threshold

        total_tp = 0
        total_fp = 0
        total_fn = 0
        total_gt_instances = 0

        per_class_stats = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "gt_count": 0})
        per_scenario_stats = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "gt_count": 0})

        for sample in samples:
            gt_filtered = sample.gt_detections
            pred_filtered = [p for p in sample.pred_detections if p.confidence >= conf_t]

            total_gt_instances += len(gt_filtered)

            # Global matching
            tp, fp, fn = self.match_detections(gt_filtered, pred_filtered, iou_t)
            total_tp += tp
            total_fp += fp
            total_fn += fn

            # Per class breakdown
            classes_in_sample = set([g.label for g in gt_filtered] + [p.label for p in pred_filtered])
            for cls in classes_in_sample:
                cls_gt = [g for g in gt_filtered if g.label == cls]
                cls_pred = [p for p in pred_filtered if p.label == cls]
                c_tp, c_fp, c_fn = self.match_detections(cls_gt, cls_pred, iou_t)
                per_class_stats[cls]["tp"] += c_tp
                per_class_stats[cls]["fp"] += c_fp
                per_class_stats[cls]["fn"] += c_fn
                per_class_stats[cls]["gt_count"] += len(cls_gt)

            # Per scenario breakdown
            for cond in sample.conditions:
                per_scenario_stats[cond.value]["tp"] += tp
                per_scenario_stats[cond.value]["fp"] += fp
                per_scenario_stats[cond.value]["fn"] += fn
                per_scenario_stats[cond.value]["gt_count"] += len(gt_filtered)

        # Calculate metrics
        precision = total_tp / max(1, total_tp + total_fp)
        recall = total_tp / max(1, total_tp + total_fn)
        f1 = (2 * precision * recall) / max(1e-6, precision + recall)

        # Per-class summary table
        per_class_results = {}
        for cls, s in per_class_stats.items():
            p = s["tp"] / max(1, s["tp"] + s["fp"])
            r = s["tp"] / max(1, s["tp"] + s["fn"])
            f = (2 * p * r) / max(1e-6, p + r)
            per_class_results[cls] = {
                "tp": s["tp"],
                "fp": s["fp"],
                "fn": s["fn"],
                "precision": round(p * 100, 2),
                "recall": round(r * 100, 2),
                "f1_score": round(f * 100, 2),
                "gt_instances": s["gt_count"],
            }

        # Per-scenario summary table
        per_scenario_results = {}
        for sc, s in per_scenario_stats.items():
            p = s["tp"] / max(1, s["tp"] + s["fp"])
            r = s["tp"] / max(1, s["tp"] + s["fn"])
            f = (2 * p * r) / max(1e-6, p + r)
            per_scenario_results[sc] = {
                "tp": s["tp"],
                "fp": s["fp"],
                "fn": s["fn"],
                "precision": round(p * 100, 2),
                "recall": round(r * 100, 2),
                "f1_score": round(f * 100, 2),
                "gt_instances": s["gt_count"],
            }

        # Multi-IoU mAP (0.50 to 0.95 step 0.05)
        iou_steps = np.arange(0.50, 0.96, 0.05)
        map_scores = []
        for iou_val in iou_steps:
            m_tp = 0
            m_fp = 0
            m_fn = 0
            for sample in samples:
                g_f = sample.gt_detections
                p_f = [p for p in sample.pred_detections if p.confidence >= conf_t]
                t, f, n = self.match_detections(g_f, p_f, float(iou_val))
                m_tp += t
                m_fp += f
                m_fn += n
            p_step = m_tp / max(1, m_tp + m_fp)
            r_step = m_tp / max(1, m_tp + m_fn)
            map_scores.append(p_step * r_step)  # Simplified AP area approximation

        map_50 = round(map_scores[0] * 100, 2)
        map_50_95 = round(float(np.mean(map_scores)) * 100, 2)

        return {
            "iou_threshold": iou_t,
            "conf_threshold": conf_t,
            "tp": total_tp,
            "fp": total_fp,
            "fn": total_fn,
            "precision": round(precision * 100, 2),
            "recall": round(recall * 100, 2),
            "f1_score": round(f1 * 100, 2),
            "mAP_50": map_50,
            "mAP_50_95": map_50_95,
            "total_gt_instances": total_gt_instances,
            "per_class": per_class_results,
            "per_scenario": per_scenario_results,
        }

    def evaluate_confidence_thresholds(
        self, samples: List[BenchmarkSample], thresholds: List[float] = None
    ) -> Dict[str, any]:
        """Evaluates model performance across confidence thresholds (0.20 to 0.90)."""
        if thresholds is None:
            thresholds = [0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90]

        curve_data = []
        best_f1 = -1.0
        optimal_threshold = 0.50

        for thresh in thresholds:
            res = self.evaluate_samples(samples, conf_threshold=thresh)
            curve_data.append(
                {
                    "confidence_threshold": thresh,
                    "precision": res["precision"],
                    "recall": res["recall"],
                    "f1_score": res["f1_score"],
                    "tp": res["tp"],
                    "fp": res["fp"],
                    "fn": res["fn"],
                }
            )
            if res["f1_score"] > best_f1:
                best_f1 = res["f1_score"]
                optimal_threshold = thresh

        return {
            "curves": curve_data,
            "optimal_threshold": optimal_threshold,
            "best_f1_score": best_f1,
        }
