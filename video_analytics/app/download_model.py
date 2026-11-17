"""Download and validate the configured pretrained detector into private models/."""

from __future__ import annotations

from .config import load_settings
from .detector import YoloDetector
from .processor import VideoProcessor


def main() -> int:
    settings = load_settings()
    tracker_config = VideoProcessor(settings)._tracker_config_path()
    detector = YoloDetector(settings, tracker_yaml=tracker_config)
    print(f"Model ready: {detector.model_path.name}")
    print(f"Size: {detector.model_manifest['sizeBytes']} bytes")
    print(f"SHA-256: {detector.model_manifest['sha256']}")
    print(f"License: {detector.model_manifest['license']}")
    print("Model task and configured COCO classes validated. No video was processed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
