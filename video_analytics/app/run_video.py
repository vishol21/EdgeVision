"""Run a local video through EdgeVision and print the private report path."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from .config import load_settings
from .processor import VideoProcessor
from .security import safe_upload_path, validate_video_file


def main() -> int:
    parser = argparse.ArgumentParser(description="Run YOLO + ByteTrack video analytics locally.")
    parser.add_argument("video", type=Path, help="Path to an input video file")
    parser.add_argument("--synthetic-test-input", action="store_true",
                        help="Label this run as synthetic test media in its workload profile.")
    parser.add_argument("--job-id", help="Use an existing 32-character job ID for report/profile association.")
    parser.add_argument("--display-filename", help="Safe display name to retain instead of the private staged upload name.")
    args = parser.parse_args()
    settings = load_settings()
    source = args.video.expanduser().resolve()
    if not source.is_file():
        parser.error("video path must point to an existing file")
    if source.suffix.lower() not in settings.allowed_extensions:
        parser.error(f"unsupported extension: {source.suffix}")
    if source.stat().st_size > settings.max_file_size_bytes:
        parser.error("video exceeds the configured upload size limit")

    private_copy = safe_upload_path(settings.uploads_dir, source.suffix)
    try:
        # Copy into the private workspace before validation and processing; reports expose no source path.
        with source.open("rb") as src, private_copy.open("xb") as dst:
            shutil.copyfileobj(src, dst, length=1024 * 1024)
        validate_video_file(private_copy, allowed_extensions=settings.allowed_extensions,
                            max_bytes=settings.max_file_size_bytes, uploads_dir=settings.uploads_dir)
        report = VideoProcessor(settings).process(
            private_copy,
            display_filename=args.display_filename or source.name,
            synthetic_test_input=args.synthetic_test_input,
            job_id=args.job_id,
        )
        print(f"Analytics report: {report}")
        report_data = json.loads(report.read_text(encoding="utf-8"))
        workload_profile = settings.outputs_dir / "workloads" / f"{report_data['jobId']}.json"
        print(f"Workload profile: {workload_profile}")
        return 0
    except Exception as exc:
        print(f"Video analytics failed: {exc}", file=sys.stderr)
        return 1
    finally:
        private_copy.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
