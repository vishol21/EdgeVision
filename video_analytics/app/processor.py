"""OpenCV + YOLO + ByteTrack video processing and report orchestration."""

from __future__ import annotations

import time
import uuid
from collections import Counter, defaultdict
from dataclasses import replace
from pathlib import Path
from typing import Any

from .anomaly_engine import AnomalyEngine
from .config import Settings
from .detector import YoloDetector
from .report import AnalyticsReport, write_report
from .security import validate_video_file
from .tracker import ByteTrackTracker
from .workload_profile import build_workload_profile, safe_display_filename, write_workload_profile


VEHICLE_CLASSES = {"car", "bus", "motorcycle"}


class VideoProcessor:
    def __init__(self, settings: Settings, anomaly_engine: AnomalyEngine | None = None):
        self.settings = settings
        self.anomaly_engine = anomaly_engine or AnomalyEngine(settings.regions, settings.anomaly_thresholds)

    def process(self, video_path: Path, *, display_filename: str | None = None,
                synthetic_test_input: bool = False, job_id: str | None = None) -> Path:
        """Run real model inference and write one annotated video plus actual measurements."""
        import cv2

        validate_video_file(video_path, allowed_extensions=self.settings.allowed_extensions,
                             max_bytes=self.settings.max_file_size_bytes,
                             uploads_dir=self.settings.uploads_dir)
        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            capture.release()
            raise ValueError("OpenCV could not decode the uploaded video.")

        source_fps = float(capture.get(cv2.CAP_PROP_FPS))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        source_reported_frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if source_fps <= 0 or width <= 0 or height <= 0:
            capture.release()
            raise ValueError("Video metadata is invalid or unsupported.")
        source_file_size_bytes = video_path.stat().st_size
        safe_filename = safe_display_filename(display_filename or video_path.name)

        if job_id is None:
            job_id = uuid.uuid4().hex
        elif not isinstance(job_id, str) or len(job_id) != 32 \
                or any(character not in "0123456789abcdef" for character in job_id):
            raise ValueError("job_id must be a 32-character lowercase hexadecimal ID.")
        job_output = self.settings.outputs_dir / job_id
        job_evidence = self.settings.evidence_dir / job_id
        model_load_started = time.perf_counter()
        try:
            detector = YoloDetector(self.settings, tracker_yaml=self._tracker_config_path())
        except Exception:
            capture.release()
            raise
        model_load_seconds = time.perf_counter() - model_load_started
        tracker = ByteTrackTracker(detector, detector.class_names,
                                  history_max_points=self.settings.history_max_points)

        job_output.mkdir(parents=True, exist_ok=False)
        job_evidence.mkdir(parents=True, exist_ok=False)
        annotated_path = job_output / "annotated.mp4"
        output_fps = source_fps / self.settings.frame_interval
        writer = cv2.VideoWriter(str(annotated_path), cv2.VideoWriter_fourcc(*self.settings.output_fourcc),
                                 output_fps, (width, height))
        if not writer.isOpened():
            capture.release()
            writer.release()
            raise RuntimeError("OpenCV could not create the annotated MP4 output.")

        observation_counts: Counter[str] = Counter()
        observed_track_ids: dict[str, set[int]] = defaultdict(set)
        events = []
        frame_index = 0
        processed_frames = 0
        yolo_tracker_wall_seconds = 0.0
        anomaly_engine_wall_seconds = 0.0
        inference_started = time.perf_counter()
        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if frame_index % self.settings.frame_interval == 0:
                    timestamp = frame_index / source_fps
                    detector_started = time.perf_counter()
                    observations = tracker.update(frame, frame_index=frame_index,
                                                  timestamp_seconds=timestamp)
                    yolo_tracker_wall_seconds += time.perf_counter() - detector_started
                    anomaly_started = time.perf_counter()
                    new_events = self.anomaly_engine.update(observations, timestamp, frame)
                    anomaly_engine_wall_seconds += time.perf_counter() - anomaly_started
                    for observation in observations:
                        observation_counts[observation.object_class] += 1
                        observed_track_ids[observation.object_class].add(observation.tracking_id)

                    self._draw_tracks(cv2, frame, observations, tracker)
                    annotated_events = []
                    for event in new_events:
                        self._draw_event(cv2, frame, event.event_type)
                        evidence_path = job_evidence / f"{event.event_id}.jpg"
                        if not cv2.imwrite(str(evidence_path), frame):
                            raise RuntimeError("OpenCV could not save an event evidence frame.")
                        annotated_events.append(replace(
                            event,
                            evidence_frame=f"evidence/{job_id}/{evidence_path.name}",
                        ))
                    events.extend(annotated_events)
                    writer.write(frame)
                    processed_frames += 1
                frame_index += 1
        except Exception:
            capture.release()
            writer.release()
            raise
        finally:
            capture.release()
            writer.release()

        if frame_index == 0 or processed_frames == 0:
            raise ValueError("The uploaded video contains no decodable frames.")
        processing_duration = time.perf_counter() - inference_started
        class_counts = {
            class_name: {
                "trackedObservations": observation_counts.get(class_name, 0),
                "uniqueTrackingIds": len(observed_track_ids.get(class_name, set())),
            }
            for class_name in self.settings.supported_classes
        }
        relative_output = f"outputs/{job_id}/annotated.mp4"
        report = AnalyticsReport(
            job_id=job_id,
            source_name=safe_filename,
            status="completed",
            model={
                "filename": detector.model_manifest["filename"],
                "sha256": detector.model_manifest["sha256"],
                "license": detector.model_manifest["license"],
                "classFilter": list(self.settings.supported_classes),
            },
            rule_coverage=self.anomaly_engine.coverage(),
            video={
                "width": width,
                "height": height,
                "fps": source_fps,
                "sourceReportedFrameCount": source_reported_frame_count,
                "frameCount": frame_index,
                "processedFrameCount": processed_frames,
                "frameInterval": self.settings.frame_interval,
                "durationSeconds": round(frame_index / source_fps, 3),
                "annotatedOutputFps": output_fps,
                "annotatedVideo": relative_output,
                "evidenceDirectory": f"evidence/{job_id}",
            },
            processing={
                "modelLoadSeconds": round(model_load_seconds, 4),
                "processingDurationSeconds": round(processing_duration, 4),
                "processingFps": round(processed_frames / processing_duration, 3)
                if processing_duration > 0 else None,
                "yoloByteTrackWallSeconds": yolo_tracker_wall_seconds,
                "averageYoloByteTrackWallSecondsPerProcessedFrame": yolo_tracker_wall_seconds / processed_frames,
                "anomalyEvaluationWallSeconds": anomaly_engine_wall_seconds,
                "averageAnomalyEvaluationWallSecondsPerProcessedFrame": anomaly_engine_wall_seconds / processed_frames,
                "device": "cuda" if detector._cuda_available() else "cpu",
            },
            object_counts_by_class=class_counts,
            tracking_summaries=tracker.summaries(),
            events=events,
        )
        workload_profile = build_workload_profile(
            report.to_dict(),
            source_file_size_bytes=source_file_size_bytes,
            display_filename=safe_filename,
            source_classification="synthetic_test" if synthetic_test_input else "not_labeled",
            frame_interval=self.settings.frame_interval,
            workload_settings=self.settings.workload_profile,
        )
        write_workload_profile(workload_profile, outputs_dir=self.settings.outputs_dir)
        return write_report(report, job_output / "report.json", outputs_dir=self.settings.outputs_dir)

    def _tracker_config_path(self) -> Path:
        values = self.settings.tracker_options
        if self.settings.tracker_name != "bytetrack":
            raise ValueError("Only the configured ByteTrack tracker is supported in this phase.")
        config = self.settings.models_dir / "bytetrack.runtime.yaml"
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text(
            "tracker_type: bytetrack\n"
            + "".join(f"{key}: {value}\n" for key, value in values.items()),
            encoding="utf-8",
        )
        return config

    @staticmethod
    def _draw_tracks(cv2: Any, frame: Any, observations: list[Any], tracker: ByteTrackTracker) -> None:
        for observation in observations:
            x1, y1, x2, y2 = (int(value) for value in observation.bbox_xyxy)
            label = f"{observation.object_class} {observation.confidence:.2f} ID:{observation.tracking_id}"
            color = (60, 200, 150) if observation.object_class not in VEHICLE_CLASSES else (230, 170, 70)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(frame, label, (x1, max(16, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX,
                        0.5, color, 1, cv2.LINE_AA)
            trail = list(tracker.history[observation.tracking_id])[-20:]
            for first, second in zip(trail, trail[1:]):
                cv2.line(frame, tuple(map(int, first.center_xy)), tuple(map(int, second.center_xy)),
                         color, 1, cv2.LINE_AA)

    @staticmethod
    def _draw_event(cv2: Any, frame: Any, event_type: str) -> None:
        cv2.putText(frame, f"POTENTIAL EVENT: {event_type}", (12, 24),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (40, 40, 230), 2, cv2.LINE_AA)
