"""Private upload validation helpers. Decode validation is performed by OpenCV."""

from __future__ import annotations

import uuid
from pathlib import Path


CONTAINER_SIGNATURES: dict[str, tuple[bytes, int]] = {
    ".mp4": (b"ftyp", 4),
    ".m4v": (b"ftyp", 4),
    ".mov": (b"ftyp", 4),
    ".avi": (b"RIFF", 0),
    ".mkv": (b"\x1aE\xdf\xa3", 0),
    ".webm": (b"\x1aE\xdf\xa3", 0),
}


class UploadValidationError(ValueError):
    """Raised when an uploaded file fails extension, size, or signature checks."""


def safe_upload_path(uploads_dir: Path, extension: str) -> Path:
    normalized = extension.lower()
    if normalized not in CONTAINER_SIGNATURES:
        raise UploadValidationError("Unsupported video extension.")
    directory = uploads_dir.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    target = (directory / f"{uuid.uuid4().hex}{normalized}").resolve()
    if not target.is_relative_to(directory):
        raise UploadValidationError("Invalid upload destination.")
    return target


def validate_video_file(path: Path, *, allowed_extensions: tuple[str, ...], max_bytes: int,
                        uploads_dir: Path) -> None:
    resolved = path.resolve(strict=True)
    root = uploads_dir.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise UploadValidationError("Video must be a file stored in the private uploads directory.")
    extension = resolved.suffix.lower()
    if extension not in allowed_extensions or extension not in CONTAINER_SIGNATURES:
        raise UploadValidationError("Unsupported video extension.")
    size = resolved.stat().st_size
    if size <= 0 or size > max_bytes:
        raise UploadValidationError("Video is empty or exceeds the configured size limit.")
    signature, offset = CONTAINER_SIGNATURES[extension]
    with resolved.open("rb") as stream:
        header = stream.read(16)
    if len(header) < offset + len(signature) or header[offset:offset + len(signature)] != signature:
        raise UploadValidationError("File content does not match its video extension.")
    if extension == ".avi" and header[8:12] != b"AVI ":
        raise UploadValidationError("AVI container signature is invalid.")
