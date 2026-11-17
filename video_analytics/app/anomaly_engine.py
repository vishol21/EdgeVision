"""Config-driven anomaly rule composition and truthful region coverage metadata."""

from __future__ import annotations

from typing import Any

from .domain import AnomalyEvent, Region, TrackObservation
from .rules.crowd import CrowdThresholdRule
from .rules.intrusion import RestrictedIntrusionRule
from .rules.loitering import LoiteringRule
from .rules.vehicle_stopping import VehicleStoppingRule
from .rules.wrong_direction import WrongDirectionRule


class AnomalyEngine:
    def __init__(self, regions: tuple[Region, ...], thresholds: dict[str, float | int | bool]):
        self.regions = regions
        timeout = float(thresholds.get("lost_track_timeout_seconds", 2.0))
        self.rules = [
            RestrictedIntrusionRule(regions, track_timeout_seconds=timeout),
            LoiteringRule(regions, track_timeout_seconds=timeout,
                          threshold_seconds=float(thresholds["loitering_seconds"])),
            WrongDirectionRule(regions, track_timeout_seconds=timeout,
                               min_travel_pixels=float(thresholds["wrong_direction_min_travel_pixels"]),
                               angle_tolerance_degrees=float(thresholds["wrong_direction_max_angle_degrees"])),
            CrowdThresholdRule(regions,
                               default_max_people=int(thresholds["crowd_max_people"]),
                               confirm_seconds=float(thresholds.get("crowd_confirm_seconds", 1.0))),
            VehicleStoppingRule(regions, track_timeout_seconds=timeout,
                                threshold_seconds=float(thresholds["vehicle_stopped_seconds"]),
                                max_displacement_pixels=float(thresholds["vehicle_stopped_max_displacement_pixels"])),
        ]
        self.active_rule_names = sorted({rule_name for region in regions for rule_name in region.rules})

    @property
    def rule_status(self) -> str:
        return "active" if self.active_rule_names else "not_configured"

    def update(self, observations: list[TrackObservation], timestamp_seconds: float,
               frame: Any) -> list[AnomalyEvent]:
        return [event for rule in self.rules
                for event in rule.update(observations, timestamp_seconds, frame)]

    def coverage(self) -> dict[str, Any]:
        return {
            "status": self.rule_status,
            "regionsConfigured": len(self.regions),
            "rulesEnabled": self.active_rule_names,
            "note": None if self.regions else "No regions are configured; region-based rules were not evaluated.",
        }
