"""Bounded, explainable review suggestions, never a crime/action classifier."""
from math import hypot
from uuid import uuid4
from .domain import AnomalyEvent


class ReviewMoments:
    def __init__(self, options=None):
        options = options or {}
        self.enabled = options.get("enabled", True)
        self.threshold = float(options.get("speed_diagonals_per_second", 0.2))
        self.confirm = float(options.get("motion_confirm_seconds", 0.4))
        self.cooldown = float(options.get("cooldown_seconds", 8.0))
        self.limit = int(options.get("max_moments", 100))
        self.tracks = {}
        self.count = 0
        self.pairs = {}

    def update(self, observations, timestamp, frame):
        if not self.enabled or self.count >= self.limit:
            return []
        height, width = frame.shape[:2]
        diagonal = max(1.0, hypot(width, height))
        self.tracks = {k: v for k, v in self.tracks.items() if timestamp - v["last"].timestamp_seconds <= 2.0}
        events = []
        prior = {k: dict(v) for k, v in self.tracks.items()}
        for observation in observations:
            if self.count >= self.limit:
                break
            key = (observation.object_class, observation.tracking_id)
            previous = self.tracks.get(key)
            state = previous or {"last": observation, "samples": 0, "motion_since": None, "emitted": -1e9}
            state["samples"] += 1
            event_type = reason = None
            # Presence alone is never an unusual-activity event.
            x1, y1, x2, y2 = observation.bbox_xyxy
            aspect = (x2-x1) / max(1, y2-y1)
            if observation.object_class == "person":
                if aspect < .8:
                    state["upright_at"] = timestamp
                    state["wide_since"] = None
                elif aspect > 1.3 and timestamp-state.get("upright_at", -1e9) <= 2:
                    state.setdefault("wide_since", timestamp)
                    if state["wide_since"] is None:
                        state["wide_since"] = timestamp
                    if timestamp-state["wide_since"] >= self.confirm and timestamp-state["emitted"] >= self.cooldown:
                        event_type = "possible_fall_review"
                        reason = "A previously upright person track became wider than tall and stayed that way. Possible fall or posture change; bending, occlusion and box errors can look similar."
                        state["emitted"] = timestamp
                else:
                    state["wide_since"] = None
            if previous:
                last = previous["last"]
                delta = timestamp - last.timestamp_seconds
                speed = hypot(observation.center_xy[0] - last.center_xy[0], observation.center_xy[1] - last.center_xy[1]) / diagonal / delta if delta > 0 else 0
                if speed >= self.threshold and 0 < delta <= 1.0:
                    if state["motion_since"] is None:
                        state["motion_since"] = last.timestamp_seconds
                    if event_type is None and timestamp - state["motion_since"] >= self.confirm and timestamp - state["emitted"] >= self.cooldown:
                        event_type = "rapid_movement_review"
                        reason = "Sustained rapid movement by this " + observation.object_class + " track. This can indicate running or fast travel, not necessarily unusual behavior. Camera movement and tracking errors can also cause this; review the video."
                        state["emitted"] = timestamp
                else:
                    state["motion_since"] = None
            state["last"] = observation
            self.tracks[key] = state
            if event_type:
                self.count += 1
                events.append(AnomalyEvent(uuid4().hex, event_type, timestamp,
                    observation.object_class, observation.tracking_id, None, None,
                    {"kind": "review_suggestion", "reason": reason,
                     "interpretation": "Not a confirmed robbery, collision or safety assessment."}))
        vehicles = [o for o in observations if o.object_class in {"car", "bus", "motorcycle", "truck"}]
        active_pairs = {}
        for index, a in enumerate(vehicles):
            for b in vehicles[index+1:]:
                ka, kb = (a.object_class, a.tracking_id), (b.object_class, b.tracking_id)
                pa, pb = prior.get(ka), prior.get(kb)
                if not pa or not pb:
                    continue
                delta = timestamp-pa["last"].timestamp_seconds
                if not 0 < delta <= 1 or abs(pa["last"].timestamp_seconds-pb["last"].timestamp_seconds) > .01:
                    continue
                pair = tuple(sorted((ka, kb)))
                state = self.pairs.get(pair, {"emitted": -1e9, "approach_at": -1e9})
                old_distance = hypot(*(pa["last"].center_xy[i]-pb["last"].center_xy[i] for i in (0, 1)))
                distance = hypot(*(a.center_xy[i]-b.center_xy[i] for i in (0, 1)))
                if (old_distance-distance)/diagonal/delta > self.threshold:
                    state["approach_at"] = timestamp
                ax, ay, ar, ab = a.bbox_xyxy
                bx, by, br, bb = b.bbox_xyxy
                intersection = max(0, min(ar, br)-max(ax, bx))*max(0, min(ab, bb)-max(ay, by))
                smaller = max(1, min((ar-ax)*(ab-ay), (br-bx)*(bb-by)))
                changed = False
                for observation, previous in ((a, pa), (b, pb)):
                    velocity = tuple((observation.center_xy[i]-previous["last"].center_xy[i])/diagonal/delta for i in (0, 1))
                    old_velocity = previous.get("velocity")
                    if old_velocity and hypot(*old_velocity) >= self.threshold:
                        changed |= hypot(*velocity) < .35*hypot(*old_velocity) or sum(x*y for x, y in zip(velocity, old_velocity)) < 0
                contact = intersection/smaller >= .15 and timestamp-state["approach_at"] <= 1
                if contact and changed:
                    state["changed_at"] = timestamp
                if contact:
                    state.setdefault("contact_since", timestamp)
                else:
                    state.pop("contact_since", None)
                if contact and timestamp-state["contact_since"] >= self.confirm and timestamp-state.get("changed_at", -1e9) <= 1 and timestamp-state["emitted"] >= self.cooldown and self.count < self.limit:
                    events.append(AnomalyEvent(uuid4().hex, "possible_vehicle_collision_review", timestamp,
                        a.object_class, a.tracking_id, None, None,
                        {"kind": "review_suggestion", "relatedTrackingIds": [a.tracking_id, b.tracking_id],
                         "reason": "Two vehicle tracks approached, overlapped persistently, and at least one stopped sharply or reversed. Possible collision; perspective overlap, braking and tracking errors can produce the same cues.",
                         "interpretation": "Unvalidated image-space heuristic, not a confirmed accident."}))
                    self.count += 1
                    state["emitted"] = timestamp
                active_pairs[pair] = state
        self.pairs = active_pairs
        for observation in observations:
            key = (observation.object_class, observation.tracking_id)
            previous = prior.get(key)
            if previous:
                delta = timestamp-previous["last"].timestamp_seconds
                if 0 < delta <= 1:
                    self.tracks[key]["velocity"] = tuple((observation.center_xy[i]-previous["last"].center_xy[i])/diagonal/delta for i in (0, 1))
        return events
