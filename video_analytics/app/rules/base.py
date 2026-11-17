"""Shared geometry, event creation, and track-state expiry for rule implementations."""

from __future__ import annotations

import uuid
from typing import Any

from ..domain import AnomalyEvent, Region, TrackObservation


def point_in_region(point: tuple[float, float], region: Region, frame_shape: tuple[int, ...]) -> bool:
    height, width = frame_shape[:2]
    polygon = [(x * width, y * height) for x, y in region.polygon]
    x, y = point
    inside = False
    previous_x, previous_y = polygon[-1]
    for current_x, current_y in polygon:
        cross = (current_y > y) != (previous_y > y)
        if cross:
            intersection_x = (previous_x - current_x) * (y - current_y) / (previous_y - current_y) + current_x
            if x < intersection_x:
                inside = not inside
        # Treat points on polygon edges as inside, avoiding unstable boundary toggles.
        area = (x - current_x) * (previous_y - current_y) - (y - current_y) * (previous_x - current_x)
        if abs(area) < 1e-7 and min(current_x, previous_x) <= x <= max(current_x, previous_x) \
                and min(current_y, previous_y) <= y <= max(current_y, previous_y):
            return True
        previous_x, previous_y = current_x, current_y
    return inside


def make_event(event_type: str, timestamp: float, region: Region, *, object_class: str,
               tracking_id: int | None, details: dict[str, Any]) -> AnomalyEvent:
    return AnomalyEvent(
        event_id=uuid.uuid4().hex,
        event_type=event_type,
        timestamp_seconds=round(float(timestamp), 3),
        object_class=object_class,
        tracking_id=tracking_id,
        region=region.to_dict(),
        evidence_frame=None,
        details=details,
    )


class RegionTrackRule:
    name = ""

    def __init__(self, regions: tuple[Region, ...], *, track_timeout_seconds: float):
        self.regions = tuple(region for region in regions if self.name in region.rules)
        self.track_timeout_seconds = track_timeout_seconds
        self.last_seen: dict[tuple[str, int], float] = {}

    @staticmethod
    def applicable(region: Region, observation: TrackObservation) -> bool:
        return observation.object_class in region.object_classes

    @staticmethod
    def inside(region: Region, observation: TrackObservation, frame: Any) -> bool:
        return point_in_region(observation.center_xy, region, frame.shape)

    def prune(self, now: float, active_ids: set[int]) -> None:
        stale = [key for key, last_seen in self.last_seen.items()
                 if key[1] not in active_ids and now - last_seen > self.track_timeout_seconds]
        for key in stale:
            self.last_seen.pop(key, None)
            self.drop_state(key)

    def drop_state(self, key: tuple[str, int]) -> None:
        pass

    def update(self, observations: list[TrackObservation], timestamp_seconds: float,
               frame: Any) -> list[AnomalyEvent]:
        raise NotImplementedError
