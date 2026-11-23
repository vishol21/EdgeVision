"""ByteTrack result normalization and bounded per-ID movement histories."""

from __future__ import annotations

from collections import defaultdict, deque
from math import hypot
from typing import Any

from .domain import TrackObservation


class ByteTrackTracker:
    """Uses persistent Ultralytics ByteTrack IDs and preserves their observed trajectories."""

    def __init__(self, detector: Any, class_names: dict[int, str], *, history_max_points: int = 300):
        self.detector = detector
        self.class_names = class_names
        self.history_max_points = history_max_points
        self.history: dict[int, deque[TrackObservation]] = defaultdict(
            lambda: deque(maxlen=self.history_max_points)
        )
        self.observation_counts: dict[int, int] = defaultdict(int)
        self.first_seen: dict[int, float] = {}
        self.path_lengths: dict[int, float] = defaultdict(float)

    def update(self, frame: Any, *, frame_index: int, timestamp_seconds: float) -> list[TrackObservation]:
        result = self.detector.track_frame(frame)
        boxes = getattr(result, "boxes", None)
        if boxes is None or boxes.id is None or len(boxes) == 0:
            return []
        coordinates = boxes.xyxy.cpu().numpy()
        classes = boxes.cls.cpu().numpy().astype(int)
        confidences = boxes.conf.cpu().numpy()
        tracking_ids = boxes.id.cpu().numpy().astype(int)
        observations: list[TrackObservation] = []
        for bbox, class_id, confidence, tracking_id in zip(coordinates, classes, confidences, tracking_ids):
            x1, y1, x2, y2 = (float(value) for value in bbox)
            observation = TrackObservation(
                frame_index=frame_index,
                timestamp_seconds=timestamp_seconds,
                class_id=int(class_id),
                object_class=self.class_names.get(int(class_id), f"class_{class_id}"),
                tracking_id=int(tracking_id),
                confidence=float(confidence),
                bbox_xyxy=(x1, y1, x2, y2),
                center_xy=((x1 + x2) / 2.0, (y1 + y2) / 2.0),
            )
            observations.append(observation)
            previous = self.history[observation.tracking_id]
            if previous:
                self.path_lengths[observation.tracking_id] += hypot(
                    observation.center_xy[0] - previous[-1].center_xy[0],
                    observation.center_xy[1] - previous[-1].center_xy[1])
            self.first_seen.setdefault(observation.tracking_id, timestamp_seconds)
            previous.append(observation)
            self.observation_counts[observation.tracking_id] += 1
        return observations

    def summaries(self) -> list[dict[str, Any]]:
        summaries = []
        for tracking_id, history in sorted(self.history.items()):
            if not history:
                continue
            points = list(history)
            path_length = sum(
                hypot(current.center_xy[0] - previous.center_xy[0],
                      current.center_xy[1] - previous.center_xy[1])
                for previous, current in zip(points, points[1:])
            )
            summaries.append({
                "trackingId": tracking_id,
                "objectClass": points[-1].object_class,
                "firstSeenSeconds": self.first_seen.get(tracking_id, points[0].timestamp_seconds),
                "lastSeenSeconds": points[-1].timestamp_seconds,
                "observedFrames": self.observation_counts[tracking_id],
                "historyPointsStored": len(points),
                "movementDistancePixels": round(self.path_lengths.get(tracking_id, path_length), 3),
                "movementHistory": [
                    {"timestampSeconds": point.timestamp_seconds,
                     "centerX": round(point.center_xy[0], 3),
                     "centerY": round(point.center_xy[1], 3)}
                    for point in points
                ],
            })
        return summaries
