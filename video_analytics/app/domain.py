"""Shared, model-independent video analytics data structures."""

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class Region:
    name: str
    polygon: tuple[tuple[float, float], ...]
    rules: tuple[str, ...]
    object_classes: tuple[str, ...]
    expected_direction: tuple[float, float] | None = None
    max_people: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "polygon": [list(point) for point in self.polygon],
            "coordinateSpace": "normalized",
            "rules": list(self.rules),
        }


@dataclass(frozen=True)
class TrackObservation:
    frame_index: int
    timestamp_seconds: float
    class_id: int
    object_class: str
    tracking_id: int
    confidence: float
    bbox_xyxy: tuple[float, float, float, float]
    center_xy: tuple[float, float]


@dataclass(frozen=True)
class AnomalyEvent:
    event_id: str
    event_type: str
    timestamp_seconds: float
    object_class: str
    tracking_id: int | None
    region: dict[str, Any] | None
    evidence_frame: str | None
    details: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
