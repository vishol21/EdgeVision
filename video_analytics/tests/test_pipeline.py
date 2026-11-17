"""Pipeline integration and failure-path tests. No synthetic detection labels are asserted."""

import json
import shutil
import unittest
import uuid
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import cv2

from app.config import load_settings
from app.detector import YoloDetector
from app.model_manager import ModelWeightsError
from app.processor import VideoProcessor
from app.security import safe_upload_path
from app.tracker import ByteTrackTracker


VIDEO_ROOT = Path(__file__).resolve().parents[1]
SYNTHETIC_CLIP = Path(__file__).resolve().parent / "fixtures" / "synthetic_test_clip.avi"


class PipelineTests(unittest.TestCase):
    def test_missing_model_weights_fail_clearly_without_downloading(self):
        settings = load_settings()
        temporary_root = settings.project_root / "models" / f"missing-test-{uuid.uuid4().hex}"
        custom_settings = replace(
            settings,
            project_root=temporary_root,
            model_path=temporary_root / "models" / "yolo26n.pt",
            model_auto_download=False,
        )
        with self.assertRaisesRegex(ModelWeightsError, "weights are missing"):
            YoloDetector(custom_settings, tracker_yaml=custom_settings.models_dir / "tracker.yaml")

    def test_invalid_video_content_is_rejected_by_opencv(self):
        settings = load_settings()
        upload = safe_upload_path(settings.uploads_dir, ".mp4")
        try:
            upload.write_bytes(b"0000ftypisom" + b"\x00" * 64)
            with self.assertRaisesRegex(ValueError, "could not decode"):
                VideoProcessor(settings).process(upload)
        finally:
            upload.unlink(missing_ok=True)

    def test_empty_detection_result_is_a_valid_empty_frame(self):
        detector = SimpleNamespace(track_frame=lambda frame: SimpleNamespace(
            boxes=SimpleNamespace(id=None),
        ))
        tracker = ByteTrackTracker(detector, {0: "person"})
        observations = tracker.update(None, frame_index=0, timestamp_seconds=0.0)
        self.assertEqual(observations, [])
        self.assertEqual(tracker.summaries(), [])

    def test_external_job_id_must_be_safe_and_fixed_length(self):
        settings = load_settings()
        upload = safe_upload_path(settings.uploads_dir, ".avi")
        shutil.copyfile(SYNTHETIC_CLIP, upload)
        try:
            with self.assertRaisesRegex(ValueError, "job_id must be a 32-character"):
                VideoProcessor(settings).process(upload, job_id="not-a-job-id")
        finally:
            upload.unlink(missing_ok=True)

    @unittest.skipUnless((VIDEO_ROOT / "models" / "yolo26n.pt").is_file(),
                         "Download the configured YOLO26n weights to run model-backed integration.")
    def test_real_model_pipeline_on_synthetic_clip_checks_io_and_report_only(self):
        """The generated shape clip validates decoding/writing, not real-world model accuracy."""
        settings = load_settings()
        upload = safe_upload_path(settings.uploads_dir, ".avi")
        shutil.copyfile(SYNTHETIC_CLIP, upload)
        api_job_id = uuid.uuid4().hex
        output_dir = evidence_dir = workload_profile_path = None
        try:
            # Sampling keeps the integration check small; detections are whatever the real model returns.
            run_settings = replace(settings, frame_interval=5)
            report_path = VideoProcessor(run_settings).process(
                upload, display_filename="synthetic_test_clip.avi", synthetic_test_input=True,
                job_id=api_job_id,
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            job_id = report["jobId"]
            self.assertEqual(job_id, api_job_id)
            output_dir = settings.outputs_dir / job_id
            evidence_dir = settings.evidence_dir / job_id
            workload_profile_path = settings.outputs_dir / "workloads" / f"{job_id}.json"
            self.assertEqual(report["status"], "completed")
            self.assertEqual(report["video"]["frameCount"], 20)
            self.assertEqual(report["video"]["processedFrameCount"], 4)
            self.assertGreater(report["processing"]["processingDurationSeconds"], 0)
            self.assertGreater(report["processing"]["processingFps"], 0)
            self.assertEqual(set(report["objectCountsByClass"]), {"person", "car", "motorcycle", "bus"})
            self.assertEqual(report["ruleCoverage"]["status"], "not_configured")
            self.assertEqual(report["eventCount"], 0)
            self.assertIn("not evaluated", report["ruleCoverage"]["note"])

            workload_profile = json.loads(workload_profile_path.read_text(encoding="utf-8"))
            self.assertEqual(workload_profile["sourceClassification"], "synthetic_test")
            self.assertEqual(workload_profile["video"]["filename"], "synthetic_test_clip.avi")
            self.assertEqual(workload_profile["iFogSimWorkload"]["virtualCameraSources"], 1)
            self.assertEqual(workload_profile["iFogSimWorkload"]["frameBatching"]["tupleCount"], 4)
            self.assertIsNone(workload_profile["iFogSimWorkload"]["cpuDemand"]["videoAnalyzerMI"])
            self.assertIsNone(workload_profile["iFogSimWorkload"]["tuplePayloadBytes"])

            annotated = VIDEO_ROOT / report["video"]["annotatedVideo"]
            capture = cv2.VideoCapture(str(annotated))
            self.assertTrue(capture.isOpened())
            read_count = 0
            while True:
                ok, _ = capture.read()
                if not ok:
                    break
                read_count += 1
            capture.release()
            self.assertEqual(read_count, 4)
        finally:
            upload.unlink(missing_ok=True)
            if output_dir and output_dir.is_dir():
                shutil.rmtree(output_dir)
            if evidence_dir and evidence_dir.is_dir():
                shutil.rmtree(evidence_dir)
            if workload_profile_path:
                workload_profile_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
