"""Typed project settings loaded from the private JSON configuration file."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .domain import Region

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path(os.environ.get("EDGEVISION_VIDEO_CONFIG", PROJECT_ROOT / "config" / "settings.json"))


@dataclass(frozen=True)
class Settings:
    project_root: Path
    confidence: float
    model_path: Path
    supported_classes: dict[str, int]
    max_file_size_bytes: int
    allowed_extensions: tuple[str, ...]
    frame_interval: int
    output_fourcc: str
    workload_profile: dict[str, Any]
    tracker_name: str
    tracker_options: dict[str, float | int]
    history_max_points: int
    anomaly_thresholds: dict[str, float | int | bool]
    regions: tuple[Region, ...]
    model_auto_download: bool
    model_assets_release: str

    @property
    def uploads_dir(self) -> Path:
        return self.project_root / "uploads"

    @property
    def outputs_dir(self) -> Path:
        return self.project_root / "outputs"

    @property
    def evidence_dir(self) -> Path:
        return self.project_root / "evidence"

    @property
    def models_dir(self) -> Path:
        return self.project_root / "models"


def load_settings(path: Path | None = None) -> Settings:
    config_path = path or CONFIG_PATH
    raw: dict[str, Any] = json.loads(config_path.read_text(encoding="utf-8"))
    detection = raw["detection"]
    upload = raw["upload"]
    processing = raw["processing"]
    tracking = raw["tracking"]

    confidence = float(detection["confidence"])
    if not 0.0 < confidence <= 1.0:
        raise ValueError("detection.confidence must be in (0, 1].")
    frame_interval = int(processing["frame_interval"])
    if frame_interval < 1:
        raise ValueError("processing.frame_interval must be at least 1.")
    max_size = int(upload["max_file_size_bytes"])
    if max_size < 1:
        raise ValueError("upload.max_file_size_bytes must be positive.")
    extensions = tuple(str(ext).lower() for ext in upload["allowed_extensions"])
    if not extensions or any(not ext.startswith(".") for ext in extensions):
        raise ValueError("upload.allowed_extensions must contain dotted extensions.")
    fourcc = str(processing["output_fourcc"])
    if len(fourcc) != 4:
        raise ValueError("processing.output_fourcc must contain exactly four characters.")

    workload = raw.get("workload_profile", {})
    frames_per_tuple = int(workload.get("frames_per_tuple", 1))
    if frames_per_tuple < 1:
        raise ValueError("workload_profile.frames_per_tuple must be at least 1.")
    tuple_payload_bytes_value = workload.get("tuple_payload_bytes")
    tuple_payload_bytes = None if tuple_payload_bytes_value is None else int(tuple_payload_bytes_value)
    if tuple_payload_bytes is not None and tuple_payload_bytes < 1:
        raise ValueError("workload_profile.tuple_payload_bytes must be null or positive.")
    cpu_calibration = workload.get("cpu_calibration", {})
    mi_per_wall_second_value = cpu_calibration.get("mi_per_wall_second")
    mi_per_wall_second = None if mi_per_wall_second_value is None else float(mi_per_wall_second_value)
    if mi_per_wall_second is not None and (not math.isfinite(mi_per_wall_second) or mi_per_wall_second <= 0):
        raise ValueError("cpu_calibration.mi_per_wall_second must be null or a finite positive value.")
    reference_hardware = cpu_calibration.get("reference_hardware")
    calibration_method = cpu_calibration.get("method")
    if mi_per_wall_second is not None and (not reference_hardware or not calibration_method):
        raise ValueError("A CPU calibration factor requires reference_hardware and method documentation.")

    classes = {str(name): int(class_id) for name, class_id in detection["supported_classes"].items()}
    expected_classes = {"person": 0, "car": 2, "motorcycle": 3, "bus": 5}
    if not classes or any(expected_classes.get(name) != class_id for name, class_id in classes.items()):
        raise ValueError("supported_classes must use the pretrained COCO person/car/motorcycle/bus class IDs.")
    region_names: set[str] = set()
    regions: list[Region] = []
    allowed_rules = {"restricted_intrusion", "loitering", "wrong_direction", "crowd", "vehicle_stopping"}
    for item in raw.get("regions", []):
        name = str(item["name"]).strip()
        polygon = tuple((float(point[0]), float(point[1])) for point in item["polygon"])
        rules = tuple(str(rule) for rule in item["rules"])
        object_classes = tuple(str(value) for value in item.get("object_classes", classes))
        if not name or name in region_names:
            raise ValueError("Region names must be non-empty and unique.")
        if len(polygon) < 3 or any(not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0) for x, y in polygon):
            raise ValueError(f"Region '{name}' needs at least three normalized polygon points in [0, 1].")
        if not rules or not set(rules).issubset(allowed_rules):
            raise ValueError(f"Region '{name}' contains an unsupported or empty rule list.")
        if not set(object_classes).issubset(classes):
            raise ValueError(f"Region '{name}' uses an unsupported object class.")
        direction_value = item.get("expected_direction")
        direction = None if direction_value is None else (float(direction_value[0]), float(direction_value[1]))
        if "wrong_direction" in rules and (direction is None or direction == (0.0, 0.0)):
            raise ValueError(f"Region '{name}' needs a non-zero expected_direction vector.")
        max_people = item.get("max_people")
        regions.append(Region(name, polygon, rules, object_classes, direction,
                              None if max_people is None else int(max_people)))
        region_names.add(name)

    project_root = config_path.resolve().parent.parent
    history_max_points = int(tracking.get("history_max_points", 300))
    if history_max_points < 2:
        raise ValueError("tracking.history_max_points must be at least 2.")
    return Settings(
        project_root=project_root,
        confidence=confidence,
        model_path=project_root / "models" / str(detection["model_filename"]),
        supported_classes=classes,
        max_file_size_bytes=max_size,
        allowed_extensions=extensions,
        frame_interval=frame_interval,
        output_fourcc=fourcc,
        workload_profile={
            "frames_per_tuple": frames_per_tuple,
            "tuple_payload_bytes": tuple_payload_bytes,
            "cpu_calibration": {
                "mi_per_wall_second": mi_per_wall_second,
                "reference_hardware": None if reference_hardware is None else str(reference_hardware),
                "method": None if calibration_method is None else str(calibration_method),
            },
        },
        tracker_name=str(tracking["tracker"]),
        tracker_options={key: value for key, value in tracking.items()
                         if key in {"track_buffer", "track_high_thresh", "track_low_thresh",
                                    "new_track_thresh", "match_thresh", "fuse_score"}},
        history_max_points=history_max_points,
        anomaly_thresholds={key: value for key, value in raw["anomaly_thresholds"].items()},
        regions=tuple(regions),
        model_auto_download=bool(detection.get("auto_download", False)),
        model_assets_release=str(detection.get("assets_release", "v8.4.0")),
    )
