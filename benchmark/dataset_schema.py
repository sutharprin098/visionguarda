"""CAM AI Benchmark Dataset Schema & Data Leakage Validation Engine.

Defines standard data structures for ground truth, predictions, sample metadata,
and data leakage protection checks.
"""

import hashlib
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple


class ScenarioCondition(str, Enum):
    DAY = "Day"
    NIGHT = "Night"
    LOW_LIGHT = "LowLight"
    INDOOR = "Indoor"
    OUTDOOR = "Outdoor"
    CROWDED = "Crowded"
    SPARSE = "Sparse"
    HIGH_ANGLE = "HighAngle"
    LOW_ANGLE = "LowAngle"
    SMALL_OBJECT = "SmallObject"
    LARGE_OBJECT = "LargeObject"
    OCCLUDED = "Occluded"
    MOTION_BLUR = "MotionBlur"


class DatasetSplit(str, Enum):
    TRAIN = "train"
    VALIDATION = "val"
    TEST = "test"


@dataclass
class BoundingBox:
    xmin: float
    ymin: float
    xmax: float
    ymax: float

    @property
    def area(self) -> float:
        return max(0.0, self.xmax - self.xmin) * max(0.0, self.ymax - self.ymin)

    def iou(self, other: "BoundingBox") -> float:
        inter_xmin = max(self.xmin, other.xmin)
        inter_ymin = max(self.ymin, other.ymin)
        inter_xmax = min(self.xmax, other.xmax)
        inter_ymax = min(self.ymax, other.ymax)

        inter_width = max(0.0, inter_xmax - inter_xmin)
        inter_height = max(0.0, inter_ymax - inter_ymin)
        inter_area = inter_width * inter_height

        union_area = self.area + other.area - inter_area
        if union_area <= 0.0:
            return 0.0
        return inter_area / union_area


@dataclass
class DetectionAnnotation:
    label: str
    bbox: BoundingBox
    confidence: float = 1.0
    track_id: Optional[int] = None


@dataclass
class ANPRAnnotation:
    bbox: BoundingBox
    plate_text: str
    confidence: float = 1.0


@dataclass
class HelmetAnnotation:
    bbox: BoundingBox
    state: str  # "helmet" or "no_helmet"
    confidence: float = 1.0


@dataclass
class SpeedAnnotation:
    object_id: int
    speed_kmh: float
    measurement_location: Tuple[float, float] = (0.0, 0.0)


@dataclass
class EventAnnotation:
    event_type: str  # "tripwire", "intrusion", "loitering"
    roi_name: str
    occurrence: bool
    timestamp_sec: float
    object_id: Optional[int] = None


@dataclass
class BenchmarkSample:
    sample_id: str
    source_path: str
    frame_id: int
    split: DatasetSplit
    conditions: List[ScenarioCondition]
    camera_id: str
    scenario_name: str
    gt_detections: List[DetectionAnnotation] = field(default_factory=list)
    pred_detections: List[DetectionAnnotation] = field(default_factory=list)
    gt_anpr: Optional[ANPRAnnotation] = None
    pred_anpr: Optional[ANPRAnnotation] = None
    gt_helmets: List[HelmetAnnotation] = field(default_factory=list)
    pred_helmets: List[HelmetAnnotation] = field(default_factory=list)
    gt_speeds: List[SpeedAnnotation] = field(default_factory=list)
    pred_speeds: List[SpeedAnnotation] = field(default_factory=list)
    gt_events: List[EventAnnotation] = field(default_factory=list)
    pred_events: List[EventAnnotation] = field(default_factory=list)
    image_hash: Optional[str] = None


class DataLeakageChecker:
    """Verifies dataset isolation between TRAIN, VALIDATION, and TEST splits."""

    @staticmethod
    def compute_file_hash(file_path: str) -> str:
        hasher = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                while chunk := f.read(65536):
                    hasher.update(chunk)
            return hasher.hexdigest()
        except Exception:
            return hashlib.sha256(file_path.encode("utf-8")).hexdigest()

    @classmethod
    def audit_splits(cls, samples: List[BenchmarkSample]) -> Dict[str, any]:
        split_samples: Dict[DatasetSplit, Set[str]] = {
            DatasetSplit.TRAIN: set(),
            DatasetSplit.VALIDATION: set(),
            DatasetSplit.TEST: set(),
        }
        split_hashes: Dict[DatasetSplit, Set[str]] = {
            DatasetSplit.TRAIN: set(),
            DatasetSplit.VALIDATION: set(),
            DatasetSplit.TEST: set(),
        }

        duplicate_paths: List[str] = []

        for sample in samples:
            s = sample.split
            if sample.source_path in split_samples[s]:
                duplicate_paths.append(sample.source_path)
            split_samples[s].add(sample.source_path)

            img_hash = sample.image_hash or cls.compute_file_hash(sample.source_path)
            split_hashes[s].add(img_hash)

        # Check cross-split contamination
        train_val_overlap = split_hashes[DatasetSplit.TRAIN].intersection(split_hashes[DatasetSplit.VALIDATION])
        train_test_overlap = split_hashes[DatasetSplit.TRAIN].intersection(split_hashes[DatasetSplit.TEST])
        val_test_overlap = split_hashes[DatasetSplit.VALIDATION].intersection(split_hashes[DatasetSplit.TEST])

        has_leakage = bool(train_val_overlap or train_test_overlap or val_test_overlap)

        return {
            "valid": not has_leakage,
            "train_val_overlap_count": len(train_val_overlap),
            "train_test_overlap_count": len(train_test_overlap),
            "val_test_overlap_count": len(val_test_overlap),
            "has_leakage": has_leakage,
            "status": "VALID" if not has_leakage else "INVALID_LEAKAGE_DETECTED",
        }
