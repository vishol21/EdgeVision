"""Ultralytics YOLO detection adapter with explicit private weight management."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import Settings
from .model_manager import ModelWeightsError, ensure_model_weights


class YoloDetector:
    def __init__(self, settings: Settings, *, tracker_yaml: Path):
        self.model_path, self.model_manifest = ensure_model_weights(
            settings.model_path,
            models_dir=settings.models_dir,
            auto_download=settings.model_auto_download,
            release=settings.model_assets_release,
        )
        try:
            from ultralytics import YOLO

            self._model: Any = YOLO(str(self.model_path))
        except Exception as exc:
            raise ModelWeightsError(f"Could not load YOLO weights {self.model_path.name}: {exc}") from exc
        if getattr(self._model, "task", None) != "detect":
            raise ModelWeightsError(f"{self.model_path.name} is not a YOLO object-detection model.")
        self.confidence = settings.confidence
        self.classes = list(settings.supported_classes.values())
        self.class_names = {class_id: class_name
                            for class_name, class_id in settings.supported_classes.items()}
        self.tracker_yaml = tracker_yaml
        names = self._model.names
        for class_name, class_id in settings.supported_classes.items():
            model_class = names.get(class_id) if isinstance(names, dict) else names[class_id]
            if str(model_class).lower() != class_name.lower():
                raise ModelWeightsError(
                    f"Configured class {class_name}={class_id} does not match the loaded model class {model_class!r}."
                )

    def track_frame(self, frame: Any) -> Any:
        """Run one persistent YOLO+ByteTrack step and return Ultralytics' raw result."""
        try:
            results = self._model.track(
                source=frame,
                persist=True,
                tracker=str(self.tracker_yaml),
                conf=self.confidence,
                classes=self.classes,
                verbose=False,
                device="0" if self._cuda_available() else "cpu",
            )
        except Exception as exc:
            raise RuntimeError(f"YOLO/ByteTrack inference failed: {exc}") from exc
        return results[0] if results else None

    @staticmethod
    def _cuda_available() -> bool:
        try:
            import torch

            return bool(torch.cuda.is_available())
        except Exception:
            return False
