"""Create a traceable, finite iFogSim workload description from a completed video report."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


JOB_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")
KNOWN_EVENT_TYPES = (
    "restricted_intrusion", "loitering", "wrong_direction", "crowd", "vehicle_stopping",
)


class WorkloadProfileError(ValueError):
    """The source report cannot produce a valid workload profile."""


def safe_display_filename(value: str) -> str:
    """Keep a short basename for display; never persist a caller's filesystem path."""
    name = str(value).replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(character for character in name if ord(character) >= 32 and ord(character) != 127)
    name = name.strip()[:200]
    if name in {"", ".", ".."}:
        return "unknown-video"
    return name


def _number(value: Any, field: str, *, minimum: float = 0.0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise WorkloadProfileError(f"{field} must be numeric.")
    converted = float(value)
    if not math.isfinite(converted) or converted < minimum:
        raise WorkloadProfileError(f"{field} must be finite and at least {minimum}.")
    return converted


def _integer(value: Any, field: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise WorkloadProfileError(f"{field} must be an integer at least {minimum}.")
    return value


def build_workload_profile(
    report: dict[str, Any],
    *,
    source_file_size_bytes: int,
    display_filename: str,
    source_classification: str,
    frame_interval: int,
    workload_settings: dict[str, Any],
) -> dict[str, Any]:
    """Build a schema-validated profile from measured report values and explicit assumptions."""
    job_id = report.get("jobId")
    if not isinstance(job_id, str) or not JOB_ID_PATTERN.fullmatch(job_id):
        raise WorkloadProfileError("Report jobId must be a 32-character lowercase hexadecimal ID.")
    if report.get("status") != "completed":
        raise WorkloadProfileError("Only a successfully completed analytics report can be profiled.")
    if source_classification not in {"not_labeled", "synthetic_test"}:
        raise WorkloadProfileError("source_classification must be not_labeled or synthetic_test.")

    video = report.get("video")
    processing = report.get("processing")
    classes = report.get("objectCountsByClass")
    events = report.get("events")
    if not isinstance(video, dict) or not isinstance(processing, dict) \
            or not isinstance(classes, dict) or not isinstance(events, list):
        raise WorkloadProfileError("Analytics report is missing video, processing, detection, or event data.")

    decoded_frames = _integer(video.get("frameCount"), "video.frameCount", minimum=1)
    processed_frames = _integer(video.get("processedFrameCount"), "video.processedFrameCount", minimum=1)
    interval = _integer(frame_interval, "frame_interval", minimum=1)
    if processed_frames > decoded_frames:
        raise WorkloadProfileError("Processed frames cannot exceed decoded source frames.")
    expected_processed = (decoded_frames + interval - 1) // interval
    if processed_frames != expected_processed:
        raise WorkloadProfileError(
            f"Processed frame count {processed_frames} does not match frame interval {interval} "
            f"for {decoded_frames} decoded frames (expected {expected_processed})."
        )

    fps = _number(video.get("fps"), "video.fps", minimum=0.000001)
    duration = _number(video.get("durationSeconds"), "video.durationSeconds", minimum=0.000001)
    width = _integer(video.get("width"), "video.width", minimum=1)
    height = _integer(video.get("height"), "video.height", minimum=1)
    file_bytes = _integer(source_file_size_bytes, "source_file_size_bytes", minimum=1)
    total_duration = _number(processing.get("processingDurationSeconds"),
                             "processing.processingDurationSeconds", minimum=0.000001)
    processing_fps = _number(processing.get("processingFps"), "processing.processingFps", minimum=0.000001)
    if abs(processing_fps - processed_frames / total_duration) > max(0.02, processing_fps * 0.01):
        raise WorkloadProfileError("Reported processing FPS is inconsistent with frame count and duration.")

    frames_per_tuple = _integer(workload_settings.get("frames_per_tuple", 1),
                                "workload_profile.frames_per_tuple", minimum=1)
    tuple_count = (processed_frames + frames_per_tuple - 1) // frames_per_tuple
    nominal_tuple_interval = interval * frames_per_tuple / fps
    effective_rate = tuple_count / duration
    configured_payload = workload_settings.get("tuple_payload_bytes")
    if configured_payload is not None:
        configured_payload = _integer(configured_payload, "workload_profile.tuple_payload_bytes", minimum=1)

    per_class: dict[str, dict[str, int]] = {}
    total_detections = 0
    total_unique = 0
    if not classes:
        raise WorkloadProfileError("No per-class observation counts were present in the analytics report.")
    for class_name, class_metrics in classes.items():
        if not isinstance(class_name, str) or not isinstance(class_metrics, dict):
            raise WorkloadProfileError("Per-class detection data has an invalid structure.")
        detections = _integer(class_metrics.get("trackedObservations"),
                              f"{class_name}.trackedObservations")
        unique_ids = _integer(class_metrics.get("uniqueTrackingIds"),
                              f"{class_name}.uniqueTrackingIds")
        if unique_ids > detections:
            raise WorkloadProfileError(f"{class_name} unique IDs exceed its tracked observations.")
        per_class[class_name] = {
            "trackedDetectionObservations": detections,
            "uniqueTrackingIds": unique_ids,
        }
        total_detections += detections
        total_unique += unique_ids

    event_count = _integer(report.get("eventCount"), "eventCount")
    if event_count != len(events):
        raise WorkloadProfileError("eventCount does not match the actual events array.")
    events_by_type = {event_type: 0 for event_type in KNOWN_EVENT_TYPES}
    for event in events:
        if not isinstance(event, dict) or not isinstance(event.get("event_type"), str):
            raise WorkloadProfileError("Anomaly event record has an invalid structure.")
        event_type = event["event_type"]
        events_by_type[event_type] = events_by_type.get(event_type, 0) + 1
    if sum(events_by_type.values()) != event_count:
        raise WorkloadProfileError("Anomaly type counts do not match the event total.")

    yolo_track_seconds = _number(processing.get("yoloByteTrackWallSeconds"),
                                 "processing.yoloByteTrackWallSeconds")
    anomaly_seconds = _number(processing.get("anomalyEvaluationWallSeconds"),
                              "processing.anomalyEvaluationWallSeconds")
    calibration = workload_settings.get("cpu_calibration", {})
    if not isinstance(calibration, dict):
        raise WorkloadProfileError("workload_profile.cpu_calibration must be an object.")
    mi_per_second_value = calibration.get("mi_per_wall_second")
    cpu_estimate = None
    calibration_status = "unavailable"
    reference_hardware = calibration.get("reference_hardware")
    calibration_method = calibration.get("method")
    if mi_per_second_value is not None:
        mi_per_second = _number(mi_per_second_value, "cpu_calibration.mi_per_wall_second", minimum=0.000001)
        if not reference_hardware or not calibration_method:
            raise WorkloadProfileError("CPU calibration needs a documented method and reference hardware.")
        cpu_estimate = {
            "videoAnalyzerMI": round(yolo_track_seconds * mi_per_second, 6),
            "eventDetectorMI": round(anomaly_seconds * mi_per_second, 6),
            "miPerWallSecond": mi_per_second,
            "referenceHardware": str(reference_hardware),
            "calibrationMethod": str(calibration_method),
        }
        calibration_status = "estimated_from_configured_calibration"
    else:
        cpu_estimate = {
            "videoAnalyzerMI": None,
            "eventDetectorMI": None,
            "miPerWallSecond": None,
            "referenceHardware": None if reference_hardware is None else str(reference_hardware),
            "calibrationMethod": None if calibration_method is None else str(calibration_method),
        }

    source_reported_frames = video.get("sourceReportedFrameCount")
    if isinstance(source_reported_frames, int) and source_reported_frames < 0:
        source_reported_frames = None
    elif source_reported_frames is not None:
        source_reported_frames = _integer(source_reported_frames, "video.sourceReportedFrameCount")

    profile = {
        "schemaVersion": 1,
        "jobId": job_id,
        "profileGeneratedAtUtc": datetime.now(timezone.utc).isoformat(),
        "sourceClassification": source_classification,
        "video": {
            "filename": safe_display_filename(display_filename),
            "durationSeconds": duration,
            "width": width,
            "height": height,
            "sourceFps": fps,
            "sourceReportedFrameCount": source_reported_frames,
            "decodedSourceFrameCount": decoded_frames,
            "processedFrameCount": processed_frames,
            "frameProcessingInterval": interval,
            "sourceFileSizeBytes": file_bytes,
        },
        "processing": {
            "processingDurationSeconds": total_duration,
            "averageProcessingFps": processing_fps,
            "averageProcessingSecondsPerProcessedFrame": total_duration / processed_frames,
            "yoloByteTrackWallSeconds": yolo_track_seconds,
            "averageYoloByteTrackWallSecondsPerProcessedFrame": yolo_track_seconds / processed_frames,
            "anomalyEvaluationWallSeconds": anomaly_seconds,
            "averageAnomalyEvaluationWallSecondsPerProcessedFrame": anomaly_seconds / processed_frames,
            "stageTimingSemantics": "Measured wall time; YOLO/ByteTrack and anomaly evaluation only, not calibrated CPU instructions.",
        },
        "detections": {
            "totalDetections": total_detections,
            "countSemantics": "Sum of trackedDetectionObservations returned across processed frames; not unique objects or discarded untracked raw model boxes.",
            "byClass": per_class,
            "totalUniqueTrackedObjects": total_unique,
        },
        "anomalies": {
            "totalEvents": event_count,
            "countsByType": events_by_type,
        },
        "iFogSimWorkload": {
            "virtualCameraSources": 1,
            "frameBatching": {
                "framesPerTuple": frames_per_tuple,
                "tupleCount": tuple_count,
                "strategy": "Finite trace: one tuple represents each batch of processed frame samples; a final partial batch is allowed.",
                "actualVideoFramesSentToSimulator": False,
            },
            "tuplePayloadBytes": configured_payload,
            "tuplePayloadBasis": "configured_assumption" if configured_payload is not None else "unavailable_not_serialized",
            "proposedTupleGenerationIntervalSeconds": nominal_tuple_interval,
            "tupleIntervalBasis": "Derived from frameProcessingInterval, framesPerTuple, and measured source FPS.",
            "effectiveTupleArrivalRatePerSecond": effective_rate,
            "effectiveRateBasis": "tupleCount divided by the actual video duration; finite-workload average.",
            "cpuDemand": {
                "status": calibration_status,
                **cpu_estimate,
                "unavailableReason": None if calibration_status != "unavailable" else
                    "No calibrated MI-per-wall-second factor exists for this hardware and workload.",
                "scope": "YOLO/ByteTrack maps to Video_Analyzer; anomaly evaluation maps to Event_Detector. Decode, drawing, and encoding are not included.",
            },
        },
    }
    validate_workload_profile(profile)
    return profile


def validate_workload_profile(profile: dict[str, Any]) -> None:
    """Validate ID/path safety, finite measurements, and frame-to-tuple consistency."""
    if profile.get("schemaVersion") != 1 or not JOB_ID_PATTERN.fullmatch(str(profile.get("jobId", ""))):
        raise WorkloadProfileError("Workload profile schema version or job ID is invalid.")
    filename = profile.get("video", {}).get("filename")
    if not isinstance(filename, str) or not filename or filename in {".", ".."} \
            or "/" in filename or "\\" in filename or any(ord(c) < 32 for c in filename):
        raise WorkloadProfileError("Workload profile filename must be a safe display name, not a path.")
    decoded = _integer(profile["video"]["decodedSourceFrameCount"], "decodedSourceFrameCount", minimum=1)
    processed = _integer(profile["video"]["processedFrameCount"], "processedFrameCount", minimum=1)
    interval = _integer(profile["video"]["frameProcessingInterval"], "frameProcessingInterval", minimum=1)
    if processed > decoded or processed != (decoded + interval - 1) // interval:
        raise WorkloadProfileError("Workload profile frame counts are inconsistent with the sampling interval.")
    frame_batch = profile["iFogSimWorkload"]["frameBatching"]
    frames_per_tuple = _integer(frame_batch["framesPerTuple"], "framesPerTuple", minimum=1)
    tuple_count = _integer(frame_batch["tupleCount"], "tupleCount", minimum=1)
    if tuple_count != (processed + frames_per_tuple - 1) // frames_per_tuple:
        raise WorkloadProfileError("Tuple count does not match processed frames and batch size.")
    for field, value in profile["processing"].items():
        if field.endswith("Seconds") or field.endswith("PerProcessedFrame") or field == "averageProcessingFps":
            if value is not None:
                _number(value, f"processing.{field}")
    _number(profile["iFogSimWorkload"]["proposedTupleGenerationIntervalSeconds"],
            "proposedTupleGenerationIntervalSeconds", minimum=0.000001)
    _number(profile["iFogSimWorkload"]["effectiveTupleArrivalRatePerSecond"],
            "effectiveTupleArrivalRatePerSecond", minimum=0.000001)


def write_workload_profile(profile: dict[str, Any], *, outputs_dir: Path) -> Path:
    """Write one exclusive JSON file per job under outputs/workloads/ without overwriting."""
    validate_workload_profile(profile)
    job_id = profile["jobId"]
    destination_dir = (outputs_dir / "workloads").resolve()
    outputs_root = outputs_dir.resolve()
    if not destination_dir.is_relative_to(outputs_root):
        raise WorkloadProfileError("Workload profiles must remain under the private outputs directory.")
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / f"{job_id}.json"
    encoded = json.dumps(profile, indent=2, ensure_ascii=False, allow_nan=False)
    try:
        with destination.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(encoded)
            stream.write("\n")
    except FileExistsError as exc:
        raise WorkloadProfileError(f"A workload profile already exists for job {job_id}; it was not overwritten.") from exc
    return destination
