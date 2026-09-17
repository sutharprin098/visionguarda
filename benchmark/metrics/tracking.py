"""CAM AI Multi-Object Tracking (MOT) Metrics Engine.

Calculates standard multi-object tracking metrics: HOTA, IDF1, MOTA, ID switches,
False Positives, False Negatives, and Track Fragmentation.
"""

from collections import defaultdict
from typing import Dict, List, Set, Tuple
import numpy as np

from benchmark.dataset_schema import BenchmarkSample, BoundingBox


class TrackingMetricsCalculator:
    """Evaluates Multi-Object Tracking predictions against ground-truth track IDs."""

    def __init__(self, iou_threshold: float = 0.50):
        self.iou_threshold = iou_threshold

    def evaluate_tracking(self, samples: List[BenchmarkSample]) -> Dict[str, any]:
        """Calculates MOTA, IDF1, HOTA, ID switches, FP, FN, and Fragmentations."""
        total_gt_tracks = 0
        total_pred_tracks = 0
        total_fp = 0
        total_fn = 0
        total_id_switches = 0
        total_frag = 0

        # Mapping between GT track ID and Pred track ID
        gt_to_pred_map: Dict[int, int] = {}
        pred_to_gt_map: Dict[int, int] = {}
        
        gt_track_history: Dict[int, List[int]] = defaultdict(list)
        pred_track_history: Dict[int, List[int]] = defaultdict(list)

        matched_gt_total = 0
        all_gt_ids: Set[int] = set()
        all_pred_ids: Set[int] = set()

        for sample in samples:
            gt_dets = sample.gt_detections
            pred_dets = sample.pred_detections

            frame_gt_matched = set()
            frame_pred_matched = set()

            for g in gt_dets:
                if g.track_id is not None:
                    all_gt_ids.add(g.track_id)
            for p in pred_dets:
                if p.track_id is not None:
                    all_pred_ids.add(p.track_id)

            # Match detections in frame
            matched_pairs: List[Tuple[int, int]] = []
            for p_idx, p in enumerate(pred_dets):
                best_iou = 0.0
                best_g_idx = -1
                for g_idx, g in enumerate(gt_dets):
                    if g_idx in frame_gt_matched:
                        continue
                    iou = p.bbox.iou(g.bbox)
                    if iou > best_iou:
                        best_iou = iou
                        best_g_idx = g_idx

                if best_iou >= self.iou_threshold and best_g_idx != -1:
                    frame_gt_matched.add(best_g_idx)
                    frame_pred_matched.add(p_idx)
                    gt_obj = gt_dets[best_g_idx]
                    matched_pairs.append((best_g_idx, p_idx))

                    # Track ID switch check
                    gt_id = gt_obj.track_id
                    pred_id = p.track_id

                    if gt_id is not None and pred_id is not None:
                        if gt_id in gt_to_pred_map:
                            if gt_to_pred_map[gt_id] != pred_id:
                                total_id_switches += 1
                                total_frag += 1
                                gt_to_pred_map[gt_id] = pred_id
                        else:
                            gt_to_pred_map[gt_id] = pred_id

                        gt_track_history[gt_id].append(sample.frame_id)
                        pred_track_history[pred_id].append(sample.frame_id)

            fp = len(pred_dets) - len(frame_pred_matched)
            fn = len(gt_dets) - len(frame_gt_matched)

            total_fp += fp
            total_fn += fn
            matched_gt_total += len(frame_gt_matched)
            total_gt_tracks += len(gt_dets)

        # MOTA calculation
        mota = 1.0 - (total_fn + total_fp + total_id_switches) / max(1, total_gt_tracks)
        mota = max(0.0, mota)

        # IDF1 calculation approximation
        id_tp = matched_gt_total - total_id_switches
        id_fp = total_fp
        id_fn = total_fn
        idf1 = (2 * id_tp) / max(1e-6, 2 * id_tp + id_fp + id_fn)

        # HOTA calculation approximation (geometric mean of DetA and AssA)
        deta = matched_gt_total / max(1, total_gt_tracks + total_fp)
        assa = max(0.0, 1.0 - (total_id_switches / max(1, matched_gt_total)))
        hota = float(np.sqrt(deta * assa))

        return {
            "hota": round(hota * 100, 2),
            "idf1": round(idf1 * 100, 2),
            "mota": round(mota * 100, 2),
            "id_switches": total_id_switches,
            "false_positives": total_fp,
            "false_negatives": total_fn,
            "track_fragmentation": total_frag,
            "total_gt_tracks": len(all_gt_ids),
            "total_pred_tracks": len(all_pred_ids),
        }
