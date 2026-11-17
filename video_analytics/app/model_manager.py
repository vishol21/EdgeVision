"""Fetch and validate only supported Ultralytics detection weights into private storage."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


SUPPORTED_MODEL_FILES = frozenset({
    "yolo26n.pt", "yolo26s.pt", "yolo26m.pt", "yolo26l.pt", "yolo26x.pt",
})
MINIMUM_WEIGHT_BYTES = 1_000_000
MAXIMUM_WEIGHT_BYTES = 100_000_000


class ModelWeightsError(RuntimeError):
    """A model is unavailable, invalid, or could not be safely downloaded."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_model_weights(model_path: Path, *, models_dir: Path, auto_download: bool,
                         release: str) -> tuple[Path, dict[str, object]]:
    models_root = models_dir.resolve()
    target = model_path.resolve()
    if target.parent != models_root or target.name not in SUPPORTED_MODEL_FILES:
        raise ModelWeightsError("Configured model must be a supported YOLO26 detection file in the private models directory.")
    if not target.is_file():
        if not auto_download:
            raise ModelWeightsError(f"Model weights are missing: {target.name}. Enable detection.auto_download or place the file in models/.")
        try:
            from ultralytics.utils.downloads import attempt_download_asset

            downloaded = Path(attempt_download_asset(
                target,
                repo="ultralytics/assets",
                release=release,
            )).resolve()
            if downloaded != target:
                raise ModelWeightsError("Ultralytics downloaded the model outside the configured private model directory.")
        except Exception as exc:
            if target.exists():
                target.unlink(missing_ok=True)
            raise ModelWeightsError(
                f"Could not download {target.name} from the official Ultralytics assets release {release}: {exc}"
            ) from exc

    if not target.is_file():
        raise ModelWeightsError(f"Model download did not create {target.name} in models/.")
    size = target.stat().st_size
    if size < MINIMUM_WEIGHT_BYTES or size > MAXIMUM_WEIGHT_BYTES:
        raise ModelWeightsError(f"Model file {target.name} has an invalid size ({size} bytes). Re-download the official weights.")
    manifest: dict[str, object] = {
        "filename": target.name,
        "source": f"https://github.com/ultralytics/assets/releases/download/{release}/{target.name}",
        "sha256": _sha256(target),
        "sizeBytes": size,
        "license": "AGPL-3.0",
    }
    manifest_path = models_root / f"{target.stem}.manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return target, manifest
