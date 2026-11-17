"""People threshold event, emitted once per continuous over-threshold episode."""

from __future__ import annotations

from typing import Any

from ..domain import AnomalyEvent, Region, TrackObservation
from .base import make_event, point_in_region


class CrowdThresholdRule:
    name = "crowd"

    def __init__(self, regions: tuple[Region, ...], *, default_max_people: int,
                 confirm_seconds: float):
        self.regions = tuple(region for region in regions if self.name in region.rules)
        self.default_max_people = default_max_people
        self.confirm_seconds = confirm_seconds
        self.over_since: dict[str, float] = {}
        self.fired: set[str] = set()

    def update(self, observations: list[TrackObservation], timestamp_seconds: float,
               frame: Any) -> list[AnomalyEvent]:
        events = []
        for region in self.regions:
            people = {observation.tracking_id for observation in observations
                      if observation.object_class == "person"
                      and "person" in region.object_classes
                      and point_in_region(observation.center_xy, region, frame.shape)}
            count = len(people)
            maximum = region.max_people if region.max_people is not None else self.default_max_people
            if count <= maximum:
                self.over_since.pop(region.name, None)
                self.fired.discard(region.name)
                continue
            started = self.over_since.setdefault(region.name, timestamp_seconds)
            duration = timestamp_seconds - started
            if duration >= self.confirm_seconds and region.name not in self.fired:
                self.fired.add(region.name)
                events.append(make_event(self.name, timestamp_seconds, region,
                    object_class="person_group", tracking_id=None,
                    details={"reason": "Unique tracked people in the region exceeded the configured threshold.",
                             "estimatedPeopleCount": count,
                             "maximumPeople": maximum,
                             "confirmedDurationSeconds": round(duration, 3)}))
        return events
