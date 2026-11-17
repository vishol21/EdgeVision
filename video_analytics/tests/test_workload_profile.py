"""Finite workload-profile tests use measured-shaped input values, not simulator results."""

import unittest
import uuid
from copy import deepcopy
from pathlib import Path

from app.config import load_settings
from app.workload_profile import (
    WorkloadProfileError,
    build_workload_profile,
    safe_display_filename,
    write_workload_profile,
)


def sample_report(job_id="a" * 32):
    return {
        "jobId": job_id,
        "status": "completed",
        "eventCount": 0,
        "events": [],
        "video": {
            "width": 640,
            "height": 480,
            "fps": 10.0,
            "sourceReportedFrameCount": 20,
            "frameCount": 20,
            "processedFrameCount": 10,
            "frameInterval": 2,
            "durationSeconds": 2.0,
        },
        "processing": {
            "processingDurationSeconds": 0.5,
            "processingFps": 20.0,
            "yoloByteTrackWallSeconds": 0.25,
            "anomalyEvaluationWallSeconds": 0.01,
        },
        "objectCountsByClass": {
            "person": {"trackedObservations": 6, "uniqueTrackingIds": 3},
            "car": {"trackedObservations": 4, "uniqueTrackingIds": 2},
            "motorcycle": {"trackedObservations": 0, "uniqueTrackingIds": 0},
            "bus": {"trackedObservations": 0, "uniqueTrackingIds": 0},
        },
    }


class WorkloadProfileTests(unittest.TestCase):
    def setUp(self):
        self.settings = load_settings()

    def make_profile(self, report=None, settings=None, **kwargs):
        active = settings or self.settings
        return build_workload_profile(
            report or sample_report(),
            source_file_size_bytes=100_000,
            display_filename=r"C:\private\videos\gate.mp4",
            source_classification="synthetic_test",
            frame_interval=2,
            workload_settings=active.workload_profile,
            **kwargs,
        )

    def test_profile_separates_observations_from_unique_objects_and_marks_unknown_inputs(self):
        profile = self.make_profile()
        self.assertEqual(profile["detections"]["totalDetections"], 10)
        self.assertEqual(profile["detections"]["totalUniqueTrackedObjects"], 5)
        self.assertEqual(profile["detections"]["byClass"]["person"]["trackedDetectionObservations"], 6)
        self.assertEqual(profile["video"]["filename"], "gate.mp4")
        self.assertEqual(profile["sourceClassification"], "synthetic_test")
        self.assertIsNone(profile["iFogSimWorkload"]["tuplePayloadBytes"])
        self.assertIsNone(profile["iFogSimWorkload"]["cpuDemand"]["videoAnalyzerMI"])
        self.assertEqual(profile["anomalies"]["totalEvents"], 0)
        self.assertEqual(sum(profile["anomalies"]["countsByType"].values()), 0)

    def test_frame_sampling_and_batching_produce_consistent_finite_tuple_counts(self):
        profile = self.make_profile()
        workload = profile["iFogSimWorkload"]
        self.assertEqual(workload["virtualCameraSources"], 1)
        self.assertEqual(workload["frameBatching"]["framesPerTuple"], 1)
        self.assertEqual(workload["frameBatching"]["tupleCount"], 10)
        self.assertAlmostEqual(workload["proposedTupleGenerationIntervalSeconds"], 0.2)
        self.assertAlmostEqual(workload["effectiveTupleArrivalRatePerSecond"], 5.0)
        self.assertFalse(workload["frameBatching"]["actualVideoFramesSentToSimulator"])

    def test_configured_batch_size_and_payload_are_labeled_as_assumptions(self):
        customized = deepcopy(self.settings.workload_profile)
        customized["frames_per_tuple"] = 3
        customized["tuple_payload_bytes"] = 2048
        profile = self.make_profile(settings=type("SettingsCopy", (), {"workload_profile": customized})())
        workload = profile["iFogSimWorkload"]
        self.assertEqual(workload["frameBatching"]["tupleCount"], 4)
        self.assertEqual(workload["tuplePayloadBytes"], 2048)
        self.assertEqual(workload["tuplePayloadBasis"], "configured_assumption")
        self.assertAlmostEqual(workload["proposedTupleGenerationIntervalSeconds"], 0.6)

    def test_cpu_demand_is_only_derived_when_documented_calibration_is_configured(self):
        customized = deepcopy(self.settings.workload_profile)
        customized["cpu_calibration"] = {
            "mi_per_wall_second": 100.0,
            "reference_hardware": "calibration reference host",
            "method": "documented benchmark mapping",
        }
        profile = self.make_profile(settings=type("SettingsCopy", (), {"workload_profile": customized})())
        cpu = profile["iFogSimWorkload"]["cpuDemand"]
        self.assertEqual(cpu["status"], "estimated_from_configured_calibration")
        self.assertEqual(cpu["videoAnalyzerMI"], 25.0)
        self.assertEqual(cpu["eventDetectorMI"], 1.0)

    def test_invalid_ids_frames_and_nonfinite_times_are_rejected(self):
        invalid_id = sample_report("../unsafe")
        with self.assertRaises(WorkloadProfileError):
            self.make_profile(report=invalid_id)
        inconsistent = sample_report()
        inconsistent["video"]["processedFrameCount"] = 9
        with self.assertRaises(WorkloadProfileError):
            self.make_profile(report=inconsistent)
        negative = sample_report()
        negative["processing"]["anomalyEvaluationWallSeconds"] = -0.1
        with self.assertRaises(WorkloadProfileError):
            self.make_profile(report=negative)

    def test_event_counts_are_derived_only_from_actual_event_records(self):
        report = sample_report()
        report["eventCount"] = 1
        report["events"] = [{"event_type": "loitering"}]
        profile = self.make_profile(report=report)
        self.assertEqual(profile["anomalies"]["totalEvents"], 1)
        self.assertEqual(profile["anomalies"]["countsByType"]["loitering"], 1)
        self.assertEqual(sum(profile["anomalies"]["countsByType"].values()), 1)

    def test_profiles_have_safe_unique_paths_and_never_overwrite(self):
        first_id = uuid.uuid4().hex
        second_id = uuid.uuid4().hex
        first = self.make_profile(report=sample_report(first_id))
        second = self.make_profile(report=sample_report(second_id))
        root = self.settings.outputs_dir
        first_path = second_path = None
        try:
            first_path = write_workload_profile(first, outputs_dir=root)
            second_path = write_workload_profile(second, outputs_dir=root)
            self.assertNotEqual(first_path, second_path)
            self.assertEqual(first_path.parent, root / "workloads")
            original = first_path.read_bytes()
            with self.assertRaises(WorkloadProfileError):
                write_workload_profile(first, outputs_dir=root)
            self.assertEqual(first_path.read_bytes(), original)
        finally:
            if first_path:
                first_path.unlink(missing_ok=True)
            if second_path:
                second_path.unlink(missing_ok=True)

    def test_display_filename_never_contains_a_caller_path(self):
        self.assertEqual(safe_display_filename(r"C:\camera\north gate.mp4"), "north gate.mp4")
        self.assertEqual(safe_display_filename("../../"), "unknown-video")


if __name__ == "__main__":
    unittest.main()
