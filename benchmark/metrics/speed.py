"""CAM AI Speed Estimation Metrics Engine.

Calculates MAE, RMSE, MAPE, error bias, percentage within ±5 km/h and ±10 km/h,
and per-sample error logs against calibrated speed ground truth.
"""

from typing import Dict, List, Optional
import numpy as np

from benchmark.dataset_schema import BenchmarkSample, SpeedAnnotation


class SpeedMetricsCalculator:
    """Evaluates Vehicle Speed Estimation predictions against ground truth."""

    def evaluate_speed(self, samples: List[BenchmarkSample]) -> Dict[str, any]:
        gt_speeds: List[float] = []
        pred_speeds: List[float] = []
        errors: List[float] = []
        abs_errors: List[float] = []
        rel_errors: List[float] = []
        sample_logs: List[Dict[str, any]] = []

        within_5_count = 0
        within_10_count = 0

        for sample in samples:
            for gt in sample.gt_speeds:
                # Find matching prediction for object
                pred_match: Optional[SpeedAnnotation] = None
                for pred in sample.pred_speeds:
                    if pred.object_id == gt.object_id:
                        pred_match = pred
                        break

                if pred_match is not None:
                    gt_s = gt.speed_kmh
                    pred_s = pred_match.speed_kmh

                    err = pred_s - gt_s
                    abs_err = abs(err)
                    rel_err = (abs_err / max(1e-3, gt_s)) * 100.0

                    gt_speeds.append(gt_s)
                    pred_speeds.append(pred_s)
                    errors.append(err)
                    abs_errors.append(abs_err)
                    rel_errors.append(rel_err)

                    if abs_err <= 5.0:
                        within_5_count += 1
                    if abs_err <= 10.0:
                        within_10_count += 1

                    sample_logs.append(
                        {
                            "sample_id": sample.sample_id,
                            "object_id": gt.object_id,
                            "ground_truth_kmh": gt_s,
                            "predicted_kmh": round(pred_s, 1),
                            "absolute_error_kmh": round(abs_err, 2),
                            "relative_error_pct": round(rel_err, 2),
                        }
                    )

        if not gt_speeds:
            return {
                "status": "NOT ENOUGH VALIDATED DATA",
                "message": "No calibrated ground truth speed measurements available in evaluation split.",
            }

        mae = float(np.mean(abs_errors))
        rmse = float(np.sqrt(np.mean(np.square(errors))))
        mape = float(np.mean(rel_errors))
        bias = float(np.mean(errors))

        pct_within_5 = (within_5_count / len(gt_speeds)) * 100.0
        pct_within_10 = (within_10_count / len(gt_speeds)) * 100.0

        return {
            "status": "VALID",
            "total_samples": len(gt_speeds),
            "mae_kmh": round(mae, 2),
            "rmse_kmh": round(rmse, 2),
            "mape_pct": round(mape, 2),
            "bias_kmh": round(bias, 2),
            "pct_within_5_kmh": round(pct_within_5, 2),
            "pct_within_10_kmh": round(pct_within_10, 2),
            "per_sample_breakdown": sample_logs,
        }
