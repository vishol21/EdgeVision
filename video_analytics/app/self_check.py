"""Print installed inference/media versions and verify core imports without model downloads."""

from __future__ import annotations

import sys
from importlib.metadata import version


def main() -> int:
    import cv2
    import torch
    import torchvision
    import ultralytics
    from ultralytics.trackers.byte_tracker import BYTETracker

    print(f"Python: {sys.version.split()[0]}")
    print(f"PyTorch: {torch.__version__}")
    print(f"TorchVision: {torchvision.__version__}")
    print(f"OpenCV: {cv2.__version__}")
    print(f"Ultralytics: {ultralytics.__version__}")
    print(f"Flask: {version('flask')}")
    print(f"ByteTrack API: {BYTETracker.__name__}")
    tensor = torch.ones((2, 2)) @ torch.ones((2, 2))
    if tuple(tensor.shape) != (2, 2):
        raise RuntimeError("PyTorch CPU tensor check failed.")
    print("Dependency imports and PyTorch CPU operation passed. No model weights were loaded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
