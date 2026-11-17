"""Vehicle direction check using net track displacement relative to a configured vector."""

from __future__ import annotations

from math import acos, degrees, hypot, radians, cos
from typing import Any

from ..domain import AnomalyEvent, TrackObservation
from .base import RegionTrackRule, make_event


class WrongDirectionRule(RegionTrackRule):
    name = "wrong_direction"

    def __init__(self, *args, min_travel_pixels: float, angle_tolerance_degrees: float, **kwargs):
        super().__init__(*args, **kwargs)
        self.min_travel_pixels = min_travel_pixels
        self.angle_tolerance_degrees = angle_tolerance_degrees
        self.anchors: dict[tuple[str, int], tuple[float, float]] = {}
        self.fired: set[tuple[str, int]] = set()

    def drop_state(self, key: tuple[str, int]) -> None:
        self.anchors.pop(key, None)
        self.fired.discard(key)

    def update(self, observations: list[TrackObservation], timestamp_seconds: float,
               frame: Any) -> list[AnomalyEvent]:
        events = []
        for region in self.regions:
            if region.expected_direction is None:
                continue
            dx_expected, dy_expected = region.expected_direction
            expected_norm = hypot(dx_expected, dy_expected)
            ux, uy = dx_expected / expected_norm, dy_expected / expected_norm
            for observation in observations:
                if observation.object_class not in {"car", "bus", "motorcycle"} \
                        or not self.applicable(region, observation):
                    continue
                key = (region.name, observation.tracking_id)
                self.last_seen[key] = timestamp_seconds
                if not self.inside(region, observation, frame):
                    self.anchors.pop(key, None)
                    self.fired.discard(key)
                    continue
                anchor = self.anchors.setdefault(key, observation.center_xy)
                travel_x = observation.center_xy[0] - anchor[0]
                travel_y = observation.center_xy[1] - anchor[1]
                distance = hypot(travel_x, travel_y)
                if distance < self.min_travel_pixels or key in self.fired:
                    continue
                cosine = (travel_x * ux + travel_y * uy) / distance
                angle = degrees(acos(max(-1.0, min(1.0, cosine))))
                if cosine <= -cos(radians(self.angle_tolerance_degrees)):
                    self.fired.add(key)
                    events.append(make_event(self.name, timestamp_seconds, region,
                        object_class=observation.object_class, tracking_id=observation.tracking_id,
                        details={"reason": "Vehicle displacement is opposite the configured direction.",
                                 "expectedDirection": [dx_expected, dy_expected],
                                 "displacementPixels": round(distance, 3),
                                 "angleFromExpectedDegrees": round(angle, 2),
                                 "minimumTravelPixels": self.min_travel_pixels}))
        self.prune(timestamp_seconds, {observation.tracking_id for observation in observations})
        return events
