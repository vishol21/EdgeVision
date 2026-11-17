"""OpenCV media I/O check using generated shapes, not model detections."""

from pathlib import Path
import unittest

import cv2
import numpy as np

from app.config import load_settings
from app.security import validate_video_file


FIXTURE = Path(__file__).resolve().parent / "fixtures" / "synthetic_test_clip.avi"


def ensure_synthetic_clip() -> None:
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    if FIXTURE.is_file() and FIXTURE.stat().st_size > 0:
        return
    writer = cv2.VideoWriter(str(FIXTURE), cv2.VideoWriter_fourcc(*"MJPG"), 10.0, (160, 120))
    if not writer.isOpened():
        raise RuntimeError("OpenCV could not create the synthetic AVI fixture using MJPG.")
    try:
        for index in range(20):
            frame = np.zeros((120, 160, 3), dtype=np.uint8)
            left = 5 + index * 4
            cv2.rectangle(frame, (left, 40), (left + 20, 70), (255, 255, 255), -1)
            writer.write(frame)
    finally:
        writer.release()


class OpenCvVideoIoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ensure_synthetic_clip()

    def test_synthetic_video_can_be_opened_and_decoded(self):
        settings = load_settings()
        validate_video_file(FIXTURE, allowed_extensions=settings.allowed_extensions,
                            max_bytes=settings.max_file_size_bytes, uploads_dir=FIXTURE.parent)
        capture = cv2.VideoCapture(str(FIXTURE))
        self.assertTrue(capture.isOpened(), "Synthetic fixture must be readable by OpenCV.")
        self.assertEqual(int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), 160)
        self.assertEqual(int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)), 120)
        count = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            self.assertEqual(frame.shape[:2], (120, 160))
            count += 1
        capture.release()
        self.assertEqual(count, 20)


if __name__ == "__main__":
    unittest.main()
