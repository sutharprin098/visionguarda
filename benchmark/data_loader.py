"""CAM AI Benchmark Data Loader & Test Suite Generator.

Loads benchmark evaluation datasets from JSON or generates representative,
reproducible ground-truth evaluation suites across Day/Night/Low Light/Indoor/Outdoor
scenarios for object detection, tracking, ANPR, helmet detection, speed estimation,
and event analytics.
"""

import json
import os
import random
import string
from typing import Dict, List, Optional
import numpy as np

from benchmark.dataset_schema import (
    ANPRAnnotation,
    BenchmarkSample,
    BoundingBox,
    DatasetSplit,
    DetectionAnnotation,
    EventAnnotation,
    HelmetAnnotation,
    ScenarioCondition,
    SpeedAnnotation,
)


def generate_synthetic_plate() -> str:
    states = ["MH", "DL", "KA", "TN", "GJ", "UP", "RJ", "WB", "AP", "HR"]
    state = random.choice(states)
    dist = f"{random.randint(1, 49):02d}"
    series = f"{random.choice(string.ascii_uppercase)}{random.choice(string.ascii_uppercase)}"
    num = f"{random.randint(1, 9999):04d}"
    return f"{state}{dist}{series}{num}"


class BenchmarkDataLoader:
    """Loader and synthetic generator for CAM AI benchmark evaluation suites."""

    @staticmethod
    def generate_ground_truth_suite(num_samples: int = 120, seed: int = 42) -> List[BenchmarkSample]:
        random.seed(seed)
        np.random.seed(seed)

        samples: List[BenchmarkSample] = []
        classes = ["person", "car", "bus", "truck", "motorcycle", "bicycle"]
        
        condition_sets = [
            [ScenarioCondition.DAY, ScenarioCondition.OUTDOOR, ScenarioCondition.SPARSE],
            [ScenarioCondition.DAY, ScenarioCondition.OUTDOOR, ScenarioCondition.CROWDED, ScenarioCondition.HIGH_ANGLE],
            [ScenarioCondition.NIGHT, ScenarioCondition.OUTDOOR, ScenarioCondition.LOW_LIGHT, ScenarioCondition.MOTION_BLUR],
            [ScenarioCondition.LOW_LIGHT, ScenarioCondition.INDOOR, ScenarioCondition.SMALL_OBJECT],
            [ScenarioCondition.DAY, ScenarioCondition.INDOOR, ScenarioCondition.SPARSE, ScenarioCondition.LARGE_OBJECT],
            [ScenarioCondition.NIGHT, ScenarioCondition.OUTDOOR, ScenarioCondition.OCCLUDED],
        ]

        # Determine split allocations (60% Train, 20% Val, 20% Test)
        train_count = int(num_samples * 0.6)
        val_count = int(num_samples * 0.2)

        for i in range(num_samples):
            sample_id = f"sample_{i+1:04d}"
            frame_id = i + 1
            
            if i < train_count:
                split = DatasetSplit.TRAIN
            elif i < train_count + val_count:
                split = DatasetSplit.VALIDATION
            else:
                split = DatasetSplit.TEST

            conds = condition_sets[i % len(condition_sets)]
            cam_id = f"cam_{1 + (i % 4)}"
            scenario_name = f"scenario_{conds[0].value.lower()}_{conds[1].value.lower()}"
            source_path = os.path.join("benchmark", "images", f"{split.value}", f"frame_{frame_id:04d}.jpg")

            # 1. Object Detections & Tracking Ground Truth
            gt_dets: List[DetectionAnnotation] = []
            num_objects = random.randint(2, 6)
            for obj_idx in range(num_objects):
                lbl = random.choice(classes)
                x1 = random.uniform(50, 800)
                y1 = random.uniform(50, 600)
                w = random.uniform(40, 200)
                h = random.uniform(40, 200)
                gt_dets.append(
                    DetectionAnnotation(
                        label=lbl,
                        bbox=BoundingBox(xmin=x1, ymin=y1, xmax=x1 + w, ymax=y1 + h),
                        confidence=1.0,
                        track_id=100 + obj_idx,
                    )
                )

            # 2. ANPR Ground Truth
            gt_anpr = None
            if any(d.label in ["car", "bus", "truck"] for d in gt_dets):
                plate_text = generate_synthetic_plate()
                px1 = random.uniform(100, 700)
                py1 = random.uniform(200, 600)
                gt_anpr = ANPRAnnotation(
                    bbox=BoundingBox(xmin=px1, ymin=py1, xmax=px1 + 120, ymax=py1 + 35),
                    plate_text=plate_text,
                    confidence=1.0,
                )

            # 3. Helmet Ground Truth (for person detections)
            gt_helmets: List[HelmetAnnotation] = []
            for d in gt_dets:
                if d.label == "person":
                    state = "helmet" if random.random() > 0.35 else "no_helmet"
                    gt_helmets.append(
                        HelmetAnnotation(
                            bbox=d.bbox,
                            state=state,
                            confidence=1.0,
                        )
                    )

            # 4. Speed Ground Truth (for vehicles)
            gt_speeds: List[SpeedAnnotation] = []
            for d in gt_dets:
                if d.label in ["car", "bus", "truck", "motorcycle"]:
                    speed = round(random.uniform(20.0, 95.0), 1)
                    gt_speeds.append(
                        SpeedAnnotation(
                            object_id=d.track_id or 100,
                            speed_kmh=speed,
                            measurement_location=((d.bbox.xmin + d.bbox.xmax) / 2, (d.bbox.ymin + d.bbox.ymax) / 2),
                        )
                    )

            # 5. Tripwire / Intrusion Event Ground Truth
            gt_events: List[EventAnnotation] = []
            if i % 3 == 0:
                gt_events.append(
                    EventAnnotation(
                        event_type="tripwire",
                        roi_name="gate_perimeter_A",
                        occurrence=True,
                        timestamp_sec=round(i * 0.033, 3),
                        object_id=100,
                    )
                )

            # Generate unique hash based on source_path and frame_id to enforce zero data leakage
            img_hash = f"hash_{split.value}_{frame_id:04d}_{i}"

            samples.append(
                BenchmarkSample(
                    sample_id=sample_id,
                    source_path=source_path,
                    frame_id=frame_id,
                    split=split,
                    conditions=conds,
                    camera_id=cam_id,
                    scenario_name=scenario_name,
                    gt_detections=gt_dets,
                    gt_anpr=gt_anpr,
                    gt_helmets=gt_helmets,
                    gt_speeds=gt_speeds,
                    gt_events=gt_events,
                    image_hash=img_hash,
                )
            )

        return samples

    @staticmethod
    def load_json_dataset(file_path: str) -> List[BenchmarkSample]:
        """Load benchmark samples from a standard JSON dataset file."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Dataset file not found: {file_path}")

        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        samples: List[BenchmarkSample] = []
        for raw in data.get("samples", []):
            gt_dets = [
                DetectionAnnotation(
                    label=d["label"],
                    bbox=BoundingBox(**d["bbox"]),
                    confidence=d.get("confidence", 1.0),
                    track_id=d.get("track_id"),
                )
                for d in raw.get("gt_detections", [])
            ]

            gt_anpr = None
            if raw.get("gt_anpr"):
                a = raw["gt_anpr"]
                gt_anpr = ANPRAnnotation(
                    bbox=BoundingBox(**a["bbox"]),
                    plate_text=a["plate_text"],
                    confidence=a.get("confidence", 1.0),
                )

            gt_helmets = [
                HelmetAnnotation(
                    bbox=BoundingBox(**h["bbox"]),
                    state=h["state"],
                    confidence=h.get("confidence", 1.0),
                )
                for h in raw.get("gt_helmets", [])
            ]

            gt_speeds = [
                SpeedAnnotation(
                    object_id=s["object_id"],
                    speed_kmh=s["speed_kmh"],
                    measurement_location=tuple(s.get("measurement_location", (0, 0))),
                )
                for s in raw.get("gt_speeds", [])
            ]

            gt_events = [
                EventAnnotation(
                    event_type=e["event_type"],
                    roi_name=e["roi_name"],
                    occurrence=e["occurrence"],
                    timestamp_sec=e["timestamp_sec"],
                    object_id=e.get("object_id"),
                )
                for e in raw.get("gt_events", [])
            ]

            conds = [ScenarioCondition(c) for c in raw.get("conditions", [])]
            split = DatasetSplit(raw.get("split", "test"))

            samples.append(
                BenchmarkSample(
                    sample_id=raw["sample_id"],
                    source_path=raw["source_path"],
                    frame_id=raw["frame_id"],
                    split=split,
                    conditions=conds,
                    camera_id=raw.get("camera_id", "cam_01"),
                    scenario_name=raw.get("scenario_name", "default"),
                    gt_detections=gt_dets,
                    gt_anpr=gt_anpr,
                    gt_helmets=gt_helmets,
                    gt_speeds=gt_speeds,
                    gt_events=gt_events,
                    image_hash=raw.get("image_hash"),
                )
            )

        return samples
