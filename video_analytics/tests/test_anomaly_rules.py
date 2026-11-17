"""Rule-state tests use controlled coordinates, not detector output or claimed events."""

import unittest

import numpy as np

from app.anomaly_engine import AnomalyEngine
from app.domain import Region, TrackObservation


FRAME = np.zeros((100, 100, 3), dtype=np.uint8)
ALL_CLASSES = ("person", "car", "bus", "motorcycle")
THRESHOLDS = {
    "loitering_seconds": 2.0,
    "wrong_direction_min_travel_pixels": 30.0,
    "wrong_direction_max_angle_degrees": 45.0,
    "crowd_max_people": 2,
    "crowd_confirm_seconds": 1.0,
    "vehicle_stopped_seconds": 2.0,
    "vehicle_stopped_max_displacement_pixels": 5.0,
    "lost_track_timeout_seconds": 2.0,
}


def region(*rules, expected_direction=None, max_people=None):
    return Region("test-zone", ((0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)),
                  tuple(rules), ALL_CLASSES, expected_direction, max_people)


def track(x, y, *, tracking_id=1, object_class="person", timestamp=0.0):
    return TrackObservation(0, timestamp, {"person": 0, "car": 2, "motorcycle": 3, "bus": 5}[object_class],
                            object_class, tracking_id, 0.9, (x - 5, y - 5, x + 5, y + 5), (x, y))


class AnomalyRuleTests(unittest.TestCase):
    def test_intrusion_does_not_claim_entry_when_track_first_appears_inside(self):
        engine = AnomalyEngine((region("restricted_intrusion"),), THRESHOLDS)
        self.assertEqual(engine.update([track(50, 50)], 0.0, FRAME), [])

    def test_restricted_intrusion_fires_once_per_entry_and_rearms_after_exit(self):
        engine = AnomalyEngine((region("restricted_intrusion"),), THRESHOLDS)
        self.assertEqual(engine.update([track(10, 50)], 0.0, FRAME), [])
        first = engine.update([track(30, 50)], 1.0, FRAME)
        self.assertEqual([event.event_type for event in first], ["restricted_intrusion"])
        self.assertEqual(engine.update([track(40, 50)], 2.0, FRAME), [])
        self.assertEqual(engine.update([track(10, 50)], 3.0, FRAME), [])
        again = engine.update([track(30, 50)], 4.0, FRAME)
        self.assertEqual(len(again), 1)
        self.assertNotEqual(first[0].event_id, again[0].event_id)

    def test_loitering_fires_at_threshold_once_then_rearms_after_leave(self):
        engine = AnomalyEngine((region("loitering"),), THRESHOLDS)
        self.assertEqual(engine.update([track(50, 50)], 0.0, FRAME), [])
        self.assertEqual(engine.update([track(50, 50)], 1.9, FRAME), [])
        first = engine.update([track(50, 50)], 2.0, FRAME)
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0].details["thresholdSeconds"], 2.0)
        self.assertEqual(engine.update([track(50, 50)], 3.0, FRAME), [])
        engine.update([track(10, 50)], 4.0, FRAME)
        engine.update([track(50, 50)], 5.0, FRAME)
        self.assertEqual(len(engine.update([track(50, 50)], 7.0, FRAME)), 1)

    def test_wrong_direction_uses_displacement_and_rearms_after_region_exit(self):
        engine = AnomalyEngine((region("wrong_direction", expected_direction=(1.0, 0.0)),), THRESHOLDS)
        engine.update([track(70, 50, object_class="car")], 0.0, FRAME)
        engine.update([track(55, 50, object_class="car")], 1.0, FRAME)
        event = engine.update([track(35, 50, object_class="car")], 2.0, FRAME)
        self.assertEqual(len(event), 1)
        self.assertEqual(event[0].event_type, "wrong_direction")
        self.assertGreater(event[0].details["angleFromExpectedDegrees"], 135.0)
        self.assertEqual(engine.update([track(25, 50, object_class="car")], 3.0, FRAME), [])
        engine.update([track(10, 50, object_class="car")], 4.0, FRAME)
        engine.update([track(70, 50, object_class="car")], 5.0, FRAME)
        engine.update([track(55, 50, object_class="car")], 6.0, FRAME)
        self.assertEqual(len(engine.update([track(35, 50, object_class="car")], 7.0, FRAME)), 1)

    def test_crowd_requires_confirmed_overage_and_rearms_below_limit(self):
        engine = AnomalyEngine((region("crowd", max_people=2),), THRESHOLDS)
        three = [track(30, 30, tracking_id=i) for i in (1, 2, 3)]
        self.assertEqual(engine.update(three, 0.0, FRAME), [])
        self.assertEqual(engine.update(three, 0.9, FRAME), [])
        first = engine.update(three, 1.0, FRAME)
        self.assertEqual(len(first), 1)
        self.assertIsNone(first[0].tracking_id)
        self.assertEqual(first[0].details["estimatedPeopleCount"], 3)
        self.assertEqual(engine.update(three, 1.5, FRAME), [])
        engine.update(three[:2], 1.6, FRAME)
        engine.update(three, 2.0, FRAME)
        self.assertEqual(len(engine.update(three, 3.0, FRAME)), 1)

    def test_vehicle_stop_fires_once_then_rearms_after_motion(self):
        engine = AnomalyEngine((region("vehicle_stopping"),), THRESHOLDS)
        engine.update([track(50, 50, object_class="car")], 0.0, FRAME)
        engine.update([track(52, 50, object_class="car")], 1.0, FRAME)
        event = engine.update([track(53, 50, object_class="car")], 2.0, FRAME)
        self.assertEqual(len(event), 1)
        self.assertEqual(event[0].event_type, "vehicle_stopping")
        self.assertEqual(engine.update([track(53, 50, object_class="car")], 3.0, FRAME), [])
        engine.update([track(70, 50, object_class="car")], 4.0, FRAME)
        engine.update([track(71, 50, object_class="car")], 5.0, FRAME)
        self.assertEqual(len(engine.update([track(72, 50, object_class="car")], 6.0, FRAME)), 1)


if __name__ == "__main__":
    unittest.main()
