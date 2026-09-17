"""CAM AI ANPR & License Plate OCR Metrics Engine.

Measures plate localization detection (P/R/F1) and character-level OCR accuracy,
Character Error Rate (CER), Levenshtein distance, and exact match rate.
"""

import re
from typing import Dict, List, Tuple
import numpy as np

from benchmark.dataset_schema import ANPRAnnotation, BenchmarkSample


def normalize_plate_text(text: str) -> str:
    """Strip spaces, hyphens, non-alphanumeric, and convert to uppercase."""
    if not text:
        return ""
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def levenshtein_distance(s1: str, s2: str) -> int:
    """Computes Levenshtein edit distance between two strings."""
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)

    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row

    return previous_row[-1]


class ANPRMetricsCalculator:
    """Evaluates License Plate Localization and OCR against ground truth."""

    def __init__(self, iou_threshold: float = 0.50):
        self.iou_threshold = iou_threshold

    def evaluate_anpr(self, samples: List[BenchmarkSample]) -> Dict[str, any]:
        total_gt_plates = 0
        total_pred_plates = 0

        # Localization stats
        loc_tp = 0
        loc_fp = 0
        loc_fn = 0

        # OCR stats
        exact_matches = 0
        total_edit_distance = 0
        total_gt_chars = 0
        incorrect_plates = 0

        sample_details: List[Dict[str, any]] = []

        for sample in samples:
            gt_anpr = sample.gt_anpr
            pred_anpr = sample.pred_anpr

            if gt_anpr is None and pred_anpr is None:
                continue

            if gt_anpr is not None:
                total_gt_plates += 1
            if pred_anpr is not None:
                total_pred_plates += 1

            if gt_anpr is not None and pred_anpr is not None:
                iou = gt_anpr.bbox.iou(pred_anpr.bbox)
                if iou >= self.iou_threshold:
                    loc_tp += 1
                    
                    # OCR Comparison
                    gt_norm = normalize_plate_text(gt_anpr.plate_text)
                    pred_norm = normalize_plate_text(pred_anpr.plate_text)

                    edit_dist = levenshtein_distance(gt_norm, pred_norm)
                    total_edit_distance += edit_dist
                    total_gt_chars += len(gt_norm)

                    is_exact = (gt_norm == pred_norm)
                    if is_exact:
                        exact_matches += 1
                    else:
                        incorrect_plates += 1

                    sample_details.append(
                        {
                            "sample_id": sample.sample_id,
                            "gt_text": gt_anpr.plate_text,
                            "pred_text": pred_anpr.plate_text,
                            "gt_normalized": gt_norm,
                            "pred_normalized": pred_norm,
                            "exact_match": is_exact,
                            "edit_distance": edit_dist,
                            "iou": round(iou, 3),
                        }
                    )
                else:
                    loc_fp += 1
                    loc_fn += 1
                    incorrect_plates += 1
            elif gt_anpr is not None and pred_anpr is None:
                loc_fn += 1
                incorrect_plates += 1
            elif gt_anpr is None and pred_anpr is not None:
                loc_fp += 1

        # Calculate Plate Detection Metrics
        det_p = loc_tp / max(1, loc_tp + loc_fp)
        det_r = loc_tp / max(1, loc_tp + loc_fn)
        det_f1 = (2 * det_p * det_r) / max(1e-6, det_p + det_r)

        # Calculate OCR Metrics
        exact_match_acc = (exact_matches / max(1, total_gt_plates)) * 100.0
        cer = (total_edit_distance / max(1, total_gt_chars)) * 100.0
        char_accuracy = max(0.0, 100.0 - cer)

        return {
            "total_plates": total_gt_plates,
            "detected_plates": loc_tp,
            "correct_exact_plates": exact_matches,
            "incorrect_plates": incorrect_plates,
            "detection_precision": round(det_p * 100, 2),
            "detection_recall": round(det_r * 100, 2),
            "detection_f1": round(det_f1 * 100, 2),
            "exact_match_accuracy": round(exact_match_acc, 2),
            "character_error_rate_cer": round(cer, 2),
            "character_accuracy": round(char_accuracy, 2),
            "sample_details": sample_details,
        }
