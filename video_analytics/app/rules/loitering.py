"""Dwell-time rule with one alert per continuous region visit."""

from __future__ import annotations

from typing import Any

from ..domain import AnomalyEvent, TrackObservation
from .base import RegionTrackRule, make_event


class LoiteringRule(RegionTrackRule):
    name = "loitering"

    def __init__(self, *args, threshold_seconds: float, **kwargs):
        super().__init__(*args, **kwargs)
        self.threshold_seconds = threshold_seconds
        self.visits: dict[tuple[str, int], dict[str, Any]] = {}

    def drop_state(self, key: tuple[str, int]) -> None:
        self.visits.pop(key, None)

    def update(self, observations: list[TrackObservation], timestamp_seconds: float,
               frame: Any) -> list[AnomalyEvent]:
        events = []
        for region in self.regions:
            for observation in observations:
                if not self.applicable(region, observation):
                    continue
                key = (region.name, observation.tracking_id)
                self.last_seen[key] = timestamp_seconds
                if not self.inside(region, observation, frame):
                    self.visits.pop(key, None)
                    continue
                visit = self.visits.setdefault(key, {"entered": timestamp_seconds, "fired": False})
                elapsed = timestamp_seconds - visit["entered"]
                if elapsed >= self.threshold_seconds and not visit["fired"]:
                    visit["fired"] = True
                    events.append(make_event(self.name, timestamp_seconds, region,
                        object_class=observation.object_class, tracking_id=observation.tracking_id,
                        details={"reason": "Track remained in the configured region beyond the dwell threshold.",
                                 "durationSeconds": round(elapsed, 3),
                                 "thresholdSeconds": self.threshold_seconds}))
        self.prune(timestamp_seconds, {observation.tracking_id for observation in observations})
        return events
