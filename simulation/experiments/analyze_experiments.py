"""Validate paired experiment evidence and create descriptive summaries/plots."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import statistics

from run_experiments import COUNTS, validate_pair

METRICS = ("loopLatencyMs", "analyticsLatencyMs", "networkUsageMb", "energyJoules",
           "processedTuples", "wallClockMillis", "driverWallClockMillis", "simulationTimeSeconds")
DETERMINISTIC = ("loopLatencyMs", "analyticsLatencyMs", "networkUsageMb", "energyJoules", "processedTuples")
UNITS = {"loopLatencyMs": "raw_CloudSim_time_units", "analyticsLatencyMs": "raw_CloudSim_time_units",
         "networkUsageMb": "decimal_MB", "energyJoules": "model_J", "processedTuples": "tuple_arrivals",
         "wallClockMillis": "wall_clock_ms", "driverWallClockMillis": "wall_clock_ms",
         "simulationTimeSeconds": "raw_CloudSim_time_units"}


def describe(values: list[float]) -> dict:
    if len(values) < 2 or any(isinstance(value, bool) or not isinstance(value, (int, float))
                              or not math.isfinite(value) for value in values):
        raise ValueError("Descriptive statistics require at least two finite numeric observations.")
    return {"n": len(values), "mean": statistics.mean(values), "sampleStddev": statistics.stdev(values),
            "minimum": min(values), "maximum": max(values)}


def summarize(report: dict) -> dict:
    if report.get("status") != "completed":
        raise ValueError("Only completed experiment evidence can be summarized.")
    repeats = report["design"]["measuredRepetitionsPerCount"]
    if report["design"]["cameraCounts"] != list(COUNTS) or repeats < 2:
        raise ValueError("The required camera matrix or repetition count is missing.")
    if len(report["runs"]) != len(COUNTS) * repeats:
        raise ValueError("The measured experiment matrix is incomplete.")
    grouped = {count: [] for count in COUNTS}
    identities = {}
    seen = set()
    for pair in report["runs"]:
        count = pair["cameraCount"]
        repetition = pair["repetition"]
        if count not in grouped or not 1 <= repetition <= repeats or (count, repetition) in seen:
            raise ValueError("Unexpected or duplicate measured camera/repetition pair.")
        seen.add((count, repetition))
        identity = pair["cloud"]["result"]["workloadProfile"]["workloadProfileId"]
        validate_pair(pair, count, identity)
        if count in identities and identities[count] != identity:
            raise ValueError("Repeated runs did not retain the same workload profile identity.")
        identities[count] = identity
        grouped[count].append(pair)
    rows = []
    comparisons = []
    for count, pairs in grouped.items():
        if len(pairs) != repeats:
            raise ValueError("A camera count has an incomplete repetition set.")
        scenario_stats = {}
        for scenario in ("cloud", "edge"):
            stats = {}
            for metric in METRICS:
                values = [pair[scenario][metric] if metric == "driverWallClockMillis"
                          else pair[scenario]["result"]["metrics"][metric] for pair in pairs]
                stats[metric] = describe(values)
            scenario_stats[scenario] = stats
            rows.append({"cameraCount": count, "scenario": scenario,
                         "expectedTuples": count * 150, "statistics": stats,
                         "modeledMetricsExactlyRepeated": all(stats[key]["minimum"] == stats[key]["maximum"]
                                                              for key in DETERMINISTIC)})
        changes = {}
        for metric in METRICS:
            cloud = scenario_stats["cloud"][metric]["mean"]
            edge = scenario_stats["edge"][metric]["mean"]
            changes[metric] = (edge - cloud) / cloud * 100 if cloud != 0 else None
        comparisons.append({"cameraCount": count, "edgeChangeVsCloudPercent": changes})
    return {"schemaVersion": 1, "type": "descriptive_synthetic_workload_analysis",
            "sourceCommit": report["sourceCommit"], "repetitions": repeats,
            "warmupPairsExcluded": len(report["warmups"]),
            "latencyUnit": "raw CloudSim time units; legacy metric keys retain Ms suffix without conversion",
            "variationMeaning": "Sample standard deviation and min/max are descriptive; no confidence intervals or statistical-significance claim.",
            "comparisonMeaning": "100 * (edge mean - cloud mean) / cloud mean; positive means a larger value, not an improvement.",
            "units": UNITS,
            "rows": rows, "comparisons": comparisons}


def write_outputs(raw_path: Path, output: Path) -> dict:
    payload = raw_path.read_bytes()
    report = json.loads(payload)
    summary = summarize(report)
    summary["rawEvidenceSha256"] = hashlib.sha256(payload).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    (output / "summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    with (output / "summary.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["cameraCount", "scenario", "metric", "unit", "n", "mean", "sampleStddev", "minimum", "maximum"])
        for row in summary["rows"]:
            for metric, values in row["statistics"].items():
                writer.writerow([row["cameraCount"], row["scenario"], metric, UNITS[metric],
                                 *[values[key] for key in ("n", "mean", "sampleStddev", "minimum", "maximum")]])
    plot(summary, output / "overview.png")
    return summary


def plot(summary: dict, destination: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    definitions = [
        ("loopLatencyMs", "Full application loop", "CloudSim time units", 1),
        ("analyticsLatencyMs", "Arrival at event detector", "CloudSim time units", 1),
        ("networkUsageMb", "Modeled payload traffic", "MB (decimal)", 1),
        ("energyJoules", "Modeled device energy", "Model MJ", 1_000_000),
        ("processedTuples", "Results reaching cloud storage", "Tuple arrivals", 1),
        ("wallClockMillis", "Java measured runtime", "Wall-clock ms", 1)]
    fig, axes = plt.subplots(2, 3, figsize=(13, 8), layout="constrained")
    for ax, (key, title, unit, divisor) in zip(axes.flat, definitions):
        for scenario, color, marker, style in [("cloud", "#35618d", "s", "--"), ("edge", "#c15a29", "o", "-")]:
            records = [row["statistics"][key] for row in summary["rows"] if row["scenario"] == scenario]
            means = [row["mean"] / divisor for row in records]
            low = [row["minimum"] / divisor for row in records]
            high = [row["maximum"] / divisor for row in records]
            ax.plot(COUNTS, means, color=color, marker=marker, linestyle=style, linewidth=1.8,
                    label="Cloud-only" if scenario == "cloud" else "Edge-based")
            ax.fill_between(COUNTS, low, high, color=color, alpha=0.12)
        ax.set(title=title, xlabel="Virtual cameras", ylabel=unit, xticks=COUNTS)
        ax.grid(alpha=0.2)
        ax.spines[["top", "right"]].set_visible(False)
        ax.ticklabel_format(axis="y", style="plain", useOffset=False)
        ax.legend(frameon=False, fontsize=9)
    fig.suptitle(f"EdgeVision synthetic workload scaling | {summary['repetitions']} measured repetitions", fontsize=15)
    fig.supxlabel("Means with min–max bands; warm-up excluded. Model outputs are not hardware measurements.", fontsize=10)
    fig.savefig(destination, dpi=180)
    plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = write_outputs(args.raw, args.output or args.raw.parent)
    print(f"PASS complete paired matrix: {len(result['rows'])} scenario summaries, {result['repetitions']} measured repetitions each.")
