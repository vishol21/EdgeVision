"""Restricted-area entry transitions."""

from __future__ import annotations

from typing import Any

from ..domain import AnomalyEvent, TrackObservation
from .base import RegionTrackRule, make_event


class RestrictedIntrusionRule(RegionTrackRule):
    name = "restricted_intrusion"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.inside_state: dict[tuple[str, int], bool] = {}

    def drop_state(self, key: tuple[str, int]) -> None:
        self.inside_state.pop(key, None)

    def update(self, observations: list[TrackObservation], timestamp_seconds: float,
               frame: Any) -> list[AnomalyEvent]:
        events = []
        for region in self.regions:
            for observation in observations:
                if not self.applicable(region, observation):
                    continue
                key = (region.name, observation.tracking_id)
                self.last_seen[key] = timestamp_seconds
                is_inside = self.inside(region, observation, frame)
                was_inside = self.inside_state.get(key)
                # A newly acquired track already inside the polygon is not proof of an entry.
                if is_inside and was_inside is False:
                    events.append(make_event(self.name, timestamp_seconds, region,
                        object_class=observation.object_class, tracking_id=observation.tracking_id,
                        details={"reason": "Tracked object entered the configured restricted region.",
                                 "centerPixels": list(observation.center_xy)}))
                self.inside_state[key] = is_inside
        self.prune(timestamp_seconds, {observation.tracking_id for observation in observations})
        return events
