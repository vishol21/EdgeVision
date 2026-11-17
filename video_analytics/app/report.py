"""Machine-readable video report writing with private workspace-relative artifacts."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .domain import AnomalyEvent


@dataclass
class AnalyticsReport:
    job_id: str
    source_name: str
    status: str
    model: dict[str, Any]
    rule_coverage: dict[str, Any]
    video: dict[str, Any]
    processing: dict[str, Any]
    object_counts_by_class: dict[str, Any]
    tracking_summaries: list[dict[str, Any]]
    events: list[AnomalyEvent] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "sourceName": self.source_name,
            "status": self.status,
            "model": self.model,
            "ruleCoverage": self.rule_coverage,
            "video": self.video,
            "processing": self.processing,
            "objectCountsByClass": self.object_counts_by_class,
            "trackingSummaries": self.tracking_summaries,
            "eventCount": len(self.events),
            "events": [event.to_dict() for event in self.events],
        }


def write_report(report: AnalyticsReport, output_path: Path, *, outputs_dir: Path) -> Path:
    destination = output_path.resolve()
    root = outputs_dir.resolve()
    if not destination.is_relative_to(root):
        raise ValueError("Report must be written inside the private outputs directory.")
    root.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(report.to_dict(), indent=2, ensure_ascii=False, allow_nan=False)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(payload, encoding="utf-8")
    temporary.replace(destination)
    return destination
