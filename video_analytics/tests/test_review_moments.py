import unittest
import json
import tempfile
from pathlib import Path
from dataclasses import replace
from types import SimpleNamespace
import numpy as np
from app.review_moments import ReviewMoments
from app.domain import TrackObservation
from app.tracker import ByteTrackTracker
from app.config import load_settings


def observation(t, x=20, identity=1, cls="person"):
    return TrackObservation(int(t * 10), t, 0, cls, identity, .9, (x-5, 15, x+5, 25), (x, 20))


class ReviewTests(unittest.TestCase):
    def setUp(self): self.frame = np.zeros((100, 100, 3), dtype=np.uint8)

    def test_normal_person_presence_is_not_an_incident(self):
        review = ReviewMoments()
        self.assertEqual(review.update([observation(0)], 0, self.frame), [])
        events = review.update([observation(.1)], .1, self.frame)
        self.assertEqual(events, [])
        self.assertEqual(review.update([observation(.2)], .2, self.frame), [])

    def test_collision_requires_approach_contact_and_motion_change(self):
        review = ReviewMoments()
        events = []
        for i, x in enumerate([0, 10, 14, 14, 14, 14, 14, 14, 14]):
            t = i*.1
            events += review.update([observation(t, x, 1, 'car'), observation(t, 20, 2, 'car')], t, self.frame)
        collisions = [e for e in events if e.event_type == 'possible_vehicle_collision_review']
        self.assertEqual(len(collisions), 1)
        self.assertEqual(collisions[0].details['relatedTrackingIds'], [1, 2])
        self.assertIn('not a confirmed', collisions[0].details['interpretation'])

    def test_stationary_overlapping_vehicles_are_not_a_collision(self):
        review = ReviewMoments()
        for i in range(20):
            t = i*.1
            self.assertEqual(review.update([observation(t, 10, 1, 'car'), observation(t, 12, 2, 'car')], t, self.frame), [])

    def test_vehicles_crossing_without_abrupt_motion_change_are_not_a_collision(self):
        review = ReviewMoments()
        events = []
        for i in range(12):
            t = i*.1
            events += review.update([observation(t, i*4, 1, 'car'), observation(t, 40-i*4, 2, 'car')], t, self.frame)
        self.assertNotIn('possible_vehicle_collision_review', [e.event_type for e in events])

    def test_tracking_gap_does_not_connect_unrelated_postures(self):
        review = ReviewMoments()
        review.update([replace(observation(0), bbox_xyxy=(15, 0, 25, 40))], 0, self.frame)
        for i in range(10):
            t = 3+i*.1
            self.assertEqual(review.update([replace(observation(t), bbox_xyxy=(0, 15, 40, 25))], t, self.frame), [])

    def test_person_posture_transition_must_persist(self):
        review = ReviewMoments()
        upright = observation(0)
        upright = replace(upright, bbox_xyxy=(15, 0, 25, 40))
        review.update([upright], 0, self.frame)
        events = []
        for i in range(1, 10):
            person = observation(i*.1)
            person = replace(person, bbox_xyxy=(0, 15, 40, 25))
            events += review.update([person], i*.1, self.frame)
        self.assertEqual([e.event_type for e in events], ['possible_fall_review'])

    def test_wide_person_without_upright_history_is_not_a_fall(self):
        review = ReviewMoments()
        for i in range(10):
            person = observation(i*.1)
            person = replace(person, bbox_xyxy=(0, 15, 40, 25))
            self.assertEqual(review.update([person], i*.1, self.frame), [])

    def test_sustained_motion_requires_confirmation_and_cooldown(self):
        review = ReviewMoments()
        events = []
        for i in range(10):
            events += review.update([observation(i*.1, 10+i*10, cls="car")], i*.1, self.frame)
        motion = [e for e in events if e.event_type == "rapid_movement_review"]
        self.assertEqual(len(motion), 1)
        self.assertGreaterEqual(motion[0].timestamp_seconds, .4)
        self.assertIn("Camera movement", motion[0].details["reason"])

    def test_disabled_and_bounded_review(self):
        review = ReviewMoments({"enabled": False})
        self.assertEqual(review.update([observation(0)], 0, self.frame), [])
        review = ReviewMoments({"max_moments": 2, "motion_confirm_seconds": .1})
        for i in range(20):
            review.update([observation(i*.1, i*20, identity=i//2)], i*.1, self.frame)
        self.assertLessEqual(review.count, 2)

    def test_history_pruning_does_not_lose_true_first_seen(self):
        class Array:
            def __init__(self, value): self.value = np.array(value)
            def cpu(self): return self
            def numpy(self): return self.value
        class Boxes:
            id = Array([1]); cls = Array([0]); conf = Array([.9])
            xyxy = Array([[0, 0, 10, 10]])
            def __len__(self): return 1
        detector = SimpleNamespace(track_frame=lambda frame: SimpleNamespace(boxes=Boxes()))
        tracker = ByteTrackTracker(detector, {0: "person"}, history_max_points=2)
        for i in range(5):
            Boxes.xyxy = Array([[i*10, 0, i*10+10, 10]])
            tracker.update(self.frame, frame_index=i, timestamp_seconds=float(i))
        summary = tracker.summaries()[0]
        self.assertEqual(summary["firstSeenSeconds"], 0)
        self.assertEqual(summary["lastSeenSeconds"], 4)
        self.assertEqual(summary["historyPointsStored"], 2)
        self.assertEqual(summary["observedFrames"], 5)
        self.assertEqual(summary["movementDistancePixels"], 40)

    def test_review_configuration_rejects_invalid_thresholds_and_unbounded_limits(self):
        original = json.loads((Path(__file__).parents[1] / 'config/settings.json').read_text())
        with tempfile.TemporaryDirectory(prefix='edgevision-review-config-') as directory:
            path = Path(directory) / 'settings.json'
            for options in [None, {"max_moments": 501}, {"max_moments": True},
                            {"speed_diagonals_per_second": -1}, {"enabled": "yes"}]:
                with self.subTest(options=options):
                    original['review_moments'] = options
                    path.write_text(json.dumps(original))
                    with self.assertRaises(ValueError): load_settings(path)


if __name__ == '__main__': unittest.main()
