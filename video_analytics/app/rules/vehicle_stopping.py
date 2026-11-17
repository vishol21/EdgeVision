"""Stationary-vehicle timer with movement-based reset and duplicate suppression."""

from __future__ import annotations

from math import hypot
from typing import Any

from ..domain import AnomalyEvent, TrackObservation
from .base import RegionTrackRule, make_event


class VehicleStoppingRule(RegionTrackRule):
    name = "vehicle_stopping"

    def __init__(self, *args, threshold_seconds: float, max_displacement_pixels: float, **kwargs):
        super().__init__(*args, **kwargs)
        self.threshold_seconds = threshold_seconds
        self.max_displacement_pixels = max_displacement_pixels
        self.episodes: dict[tuple[str, int], dict[str, Any]] = {}

    def drop_state(self, key: tuple[str, int]) -> None:
        self.episodes.pop(key, None)

    def update(self, observations: list[TrackObservation], timestamp_seconds: float,
               frame: Any) -> list[AnomalyEvent]:
        events = []
        for region in self.regions:
            for observation in observations:
                if observation.object_class not in {"car", "bus", "motorcycle"} \
                        or not self.applicable(region, observation):
                    continue
                key = (region.name, observation.tracking_id)
                self.last_seen[key] = timestamp_seconds
                if not self.inside(region, observation, frame):
                    self.episodes.pop(key, None)
                    continue
                episode = self.episodes.setdefault(key, {
                    "started": timestamp_seconds, "anchor": observation.center_xy, "fired": False,
                })
                displacement = hypot(observation.center_xy[0] - episode["anchor"][0],
                                     observation.center_xy[1] - episode["anchor"][1])
                if displacement > self.max_displacement_pixels:
                    episode.update(started=timestamp_seconds, anchor=observation.center_xy, fired=False)
                    continue
                duration = timestamp_seconds - episode["started"]
                if duration >= self.threshold_seconds and not episode["fired"]:
                    episode["fired"] = True
                    events.append(make_event(self.name, timestamp_seconds, region,
                        object_class=observation.object_class, tracking_id=observation.tracking_id,
                        details={"reason": "Vehicle remained within the configured movement tolerance in a road region.",
                                 "stationaryDurationSeconds": round(duration, 3),
                                 "thresholdSeconds": self.threshold_seconds,
                                 "displacementPixels": round(displacement, 3),
                                 "maximumDisplacementPixels": self.max_displacement_pixels}))
        self.prune(timestamp_seconds, {observation.tracking_id for observation in observations})
        return events
