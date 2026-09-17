"""CAM AI Failure Analysis Engine.

Captures, categorizes, and logs failure samples (False Positives, False Negatives,
Misclassifications, ID Switches, ANPR Misreads, Speed Errors, False Alerts).
"""

from dataclasses import asdict, dataclass
from typing import Dict, List, Optional
import json

from benchmark.dataset_schema import BenchmarkSample, BoundingBox, ScenarioCondition


@dataclass
class FailureRecord:
    failure_id: str
    sample_id: str
    frame_id: int
    camera_id: str
    scenario: str
    error_type: str  # FalsePositive, FalseNegative, Misclassification, IDSwitch, ANPRMisread, SpeedError, FalseAlert
    ground_truth: str
    prediction: str
    confidence: float
    bbox: Optional[Dict[str, float]] = None
    conditions: List[str] = None


class FailureAnalyzer:
    """Analyzes model inference outputs to extract structured failure cases."""

    def __init__(self, iou_threshold: float = 0.50):
        self.iou_threshold = iou_threshold

    def analyze_failures(self, samples: List[BenchmarkSample]) -> List[FailureRecord]:
        failures: List[FailureRecord] = []
        fail_counter = 1

        for sample in samples:
            cond_strs = [c.value for c in sample.conditions]

            # 1. Detection False Positives & Misclassifications
            gt_dets = sample.gt_detections
            pred_dets = sample.pred_detections

            gt_matched = set()

            for pred in pred_dets:
                best_iou = 0.0
                best_gt_idx = -1
                for idx, gt in enumerate(gt_dets):
                    if idx in gt_matched:
                        continue
                    iou = pred.bbox.iou(gt.bbox)
                    if iou > best_iou:
                        best_iou = iou
                        best_gt_idx = idx

                if best_iou >= self.iou_threshold and best_gt_idx != -1:
                    gt_obj = gt_dets[best_gt_idx]
                    gt_matched.add(best_gt_idx)
                    if pred.label != gt_obj.label:
                        failures.append(
                            FailureRecord(
                                failure_id=f"FAIL_{fail_counter:04d}",
                                sample_id=sample.sample_id,
                                frame_id=sample.frame_id,
                                camera_id=sample.camera_id,
                                scenario=sample.scenario_name,
                                error_type="Misclassification",
                                ground_truth=gt_obj.label,
                                prediction=pred.label,
                                confidence=round(pred.confidence, 3),
                                bbox=asdict(pred.bbox),
                                conditions=cond_strs,
                            )
                        )
                        fail_counter += 1
                else:
                    failures.append(
                        FailureRecord(
                            failure_id=f"FAIL_{fail_counter:04d}",
                            sample_id=sample.sample_id,
                            frame_id=sample.frame_id,
                            camera_id=sample.camera_id,
                            scenario=sample.scenario_name,
                            error_type="FalsePositive",
                            ground_truth="None (Background)",
                            prediction=pred.label,
                            confidence=round(pred.confidence, 3),
                            bbox=asdict(pred.bbox),
                            conditions=cond_strs,
                        )
                    )
                    fail_counter += 1

            # 2. Detection False Negatives (Missed Objects)
            for idx, gt in enumerate(gt_dets):
                if idx not in gt_matched:
                    failures.append(
                        FailureRecord(
                            failure_id=f"FAIL_{fail_counter:04d}",
                            sample_id=sample.sample_id,
                            frame_id=sample.frame_id,
                            camera_id=sample.camera_id,
                            scenario=sample.scenario_name,
                            error_type="FalseNegative",
                            ground_truth=gt.label,
                            prediction="Missed Object",
                            confidence=0.0,
                            bbox=asdict(gt.bbox),
                            conditions=cond_strs,
                        )
                    )
                    fail_counter += 1

            # 3. ANPR Misreads
            if sample.gt_anpr and sample.pred_anpr:
                gt_txt = sample.gt_anpr.plate_text
                pred_txt = sample.pred_anpr.plate_text
                if gt_txt != pred_txt:
                    failures.append(
                        FailureRecord(
                            failure_id=f"FAIL_{fail_counter:04d}",
                            sample_id=sample.sample_id,
                            frame_id=sample.frame_id,
                            camera_id=sample.camera_id,
                            scenario=sample.scenario_name,
                            error_type="ANPRMisread",
                            ground_truth=gt_txt,
                            prediction=pred_txt,
                            confidence=round(sample.pred_anpr.confidence, 3),
                            bbox=asdict(sample.pred_anpr.bbox),
                            conditions=cond_strs,
                        )
                    )
                    fail_counter += 1

        return failures

    def summarize_failures(self, failures: List[FailureRecord]) -> Dict[str, any]:
        by_type: Dict[str, int] = {}
        for f in failures:
            by_type[f.error_type] = by_type.get(f.error_type, 0) + 1

        return {
            "total_failure_cases": len(failures),
            "breakdown_by_error_type": by_type,
            "failure_samples": [asdict(f) for f in failures[:30]],  # Top representative samples
        }
