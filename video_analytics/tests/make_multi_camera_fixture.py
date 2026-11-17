"""Generate a second moving-shape clip for batch I/O tests, not detection accuracy."""
from pathlib import Path
import cv2
import numpy as np


def main():
    destination = Path(__file__).parent / '.runtime' / 'second-camera.avi'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file():
        return
    writer = cv2.VideoWriter(str(destination), cv2.VideoWriter_fourcc(*'MJPG'), 4.0, (160, 120))
    if not writer.isOpened():
        raise RuntimeError('Could not generate the second-camera MJPG fixture.')
    try:
        for index in range(12):
            frame = np.zeros((120, 160, 3), dtype=np.uint8)
            cv2.rectangle(frame, (5 + index * 4, 40), (25 + index * 4, 70), (255, 255, 255), -1)
            writer.write(frame)
    finally:
        writer.release()


if __name__ == '__main__':
    main()
