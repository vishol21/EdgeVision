from pathlib import Path
import unittest
import uuid

from app.config import load_settings
from app.security import UploadValidationError, safe_upload_path, validate_video_file


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = Path(__file__).resolve().parent / ".runtime"


class ConfigAndUploadTests(unittest.TestCase):
    def test_settings_have_valid_configurable_defaults(self):
        settings = load_settings()
        self.assertEqual(settings.confidence, 0.25)
        self.assertEqual(settings.frame_interval, 1)
        self.assertEqual(settings.tracker_name, "bytetrack")
        self.assertGreater(settings.max_file_size_bytes, 0)
        self.assertFalse(settings.anomaly_thresholds["possible_fall_enabled"])

    def test_safe_unique_names_use_only_an_allowed_suffix(self):
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        target = safe_upload_path(RUNTIME_DIR, ".MP4")
        self.assertEqual(target.suffix, ".mp4")
        self.assertNotIn("..", target.name)
        with self.assertRaises(UploadValidationError):
            safe_upload_path(RUNTIME_DIR, "../../outside.mp4")

    def test_upload_checks_extension_size_location_and_signature(self):
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        video = RUNTIME_DIR / f"signature-{uuid.uuid4().hex}.mp4"
        try:
            video.write_bytes(b"0000ftypisom\x00\x00\x00\x00")
            validate_video_file(video, allowed_extensions=(".mp4",), max_bytes=1024, uploads_dir=RUNTIME_DIR)
            video.write_bytes(b"not a video file")
            with self.assertRaises(UploadValidationError):
                validate_video_file(video, allowed_extensions=(".mp4",), max_bytes=1024, uploads_dir=RUNTIME_DIR)
            video.write_bytes(b"0000ftypisom\x00\x00\x00\x00")
            with self.assertRaises(UploadValidationError):
                validate_video_file(video, allowed_extensions=(".mp4",), max_bytes=4, uploads_dir=RUNTIME_DIR)
        finally:
            video.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
