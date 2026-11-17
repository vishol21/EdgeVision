"""Evaluate unchanged synthetic and recording-derived models; never read historical jobs."""
from __future__ import annotations

import argparse
import copy
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess
import time
import uuid

from run_experiments import ROOT, COUNTS, checked, validate_pair as validate_synthetic
from analyze_experiments import METRICS, DETERMINISTIC, UNITS, describe

CASE_IDS = [f"virtual-{n}" for n in COUNTS] + ["clip-a", "clip-b", "recordings-2", "recordings-5", "recordings-10"]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def expected_source(source):
    p = source["workloadProfile"]
    w, v = p["iFogSimWorkload"], p["video"]
    count = w["frameBatching"]["tupleCount"]
    interval = w["proposedTupleGenerationIntervalSeconds"]
    return {"cameraId": source["cameraId"], "jobId": source["jobId"], "tupleCount": count,
            "tupleIntervalSeconds": interval, "durationSeconds": v["durationSeconds"],
            "sourceClassification": "synthetic_test", "generatedTuples": count, "processedTuples": count,
            "videoAnalyzerMIPerTupleUsed": 1000, "eventDetectorMIPerTupleUsed": 2000,
            "cameraTuplePayloadBytesUsed": 20000}


def expected_horizon(case):
    if case["family"] != "recordings":
        return 2000
    last = max((s["workloadProfile"]["iFogSimWorkload"]["frameBatching"]["tupleCount"] - 1) *
               s["workloadProfile"]["iFogSimWorkload"]["proposedTupleGenerationIntervalSeconds"]
               for s in case["inputProfile"]["sources"])
    # Production conservative drain horizon with baseline analyzer/detector/storage and payload inputs.
    return max(2000, math.ceil(last + case["tupleCount"] * (4 * 3500 / 2800 + 2 * 22500 / 10000) + 500))


def validate(pair, case):
    """Validate actual output against immutable input, not merely against the other scenario."""
    if pair["caseId"] != case["caseId"]:
        raise ValueError("Case identity mismatch")
    if pair.get("order") not in (["cloud", "edge"], ["edge", "cloud"]):
        raise ValueError("Invalid scenario order")
    if case["family"] == "virtual":
        validate_synthetic(pair, case["cameraCount"], case["identity"])
    profiles = []
    for scenario in ("cloud", "edge"):
        record = pair[scenario]["result"]
        if record["scenario"] != scenario:
            raise ValueError("Scenario identity mismatch")
        metrics, meta = record["metrics"], record["workloadProfile"]
        for metric in METRICS:
            value = pair[scenario][metric] if metric == "driverWallClockMillis" else metrics[metric]
            if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0:
                raise ValueError("Invalid numeric metric: " + metric)
        if metrics["processedTuples"] != case["tupleCount"] or metrics["simulationTimeSeconds"] != expected_horizon(case):
            raise ValueError("Incomplete arrivals or unexpected horizon")
        if case["family"] != "virtual":
            p = case["inputProfile"]
            if meta["jobId"] != p["jobId"] or meta["generatedTuples"] != case["tupleCount"] or meta["tupleCountFromProfile"] != case["tupleCount"]:
                raise ValueError("Profile identity/count mismatch")
            if meta["simulatedVideoFramesSent"] is not False or meta["tupleIntervalsMatchProfile"] is not True:
                raise ValueError("Profile timing/frame boundary mismatch")
            if meta["virtualCameraSources"] != case["cameraCount"]:
                raise ValueError("Camera count mismatch")
            if case["family"] == "recordings":
                sources = meta["sources"]
                if len(sources) != case["cameraCount"] or len({s["cameraId"] for s in sources}) != len(sources) or len({s["jobId"] for s in sources}) != len(sources):
                    raise ValueError("Duplicate/missing sources")
                for actual, original in zip(sources, p["sources"]):
                    expected = expected_source(original)
                    if any(actual.get(key) != value for key, value in expected.items()):
                        raise ValueError("Source identity/trace/assumption mismatch")
                    interval, count = expected["tupleIntervalSeconds"], expected["tupleCount"]
                    if actual["tupleIntervalsMatchProfile"] is not True or not 0 <= actual["maxIntervalDeviationSeconds"] <= 1e-7:
                        raise ValueError("Actual source interval mismatch")
                    if abs(actual["lastEmissionSeconds"] - actual["firstEmissionSeconds"] - (count - 1) * interval) > 1e-7:
                        raise ValueError("Actual source emission span mismatch")
            else:
                w, v = p["iFogSimWorkload"], p["video"]
                expected = {"sourceClassification": "synthetic_test", "durationSeconds": v["durationSeconds"],
                            "sourceFps": v["sourceFps"], "processedFrameCount": v["processedFrameCount"],
                            "frameProcessingInterval": v["frameProcessingInterval"],
                            "framesPerTuple": w["frameBatching"]["framesPerTuple"],
                            "tupleGenerationIntervalSeconds": w["proposedTupleGenerationIntervalSeconds"]}
                if any(meta.get(key) != value for key, value in expected.items()) or not 0 <= meta["maxTupleIntervalDeviationSeconds"] <= 1e-7:
                    raise ValueError("Single recording trace mismatch")
                span = meta["actualLastTupleEmissionTimeSeconds"] - meta["actualFirstTupleEmissionTimeSeconds"]
                if abs(span - (case["tupleCount"] - 1) * expected["tupleGenerationIntervalSeconds"]) > 1e-7:
                    raise ValueError("Single recording emission span mismatch")
                assumptions = meta["simulationAssumptions"]
                if any(assumptions[k] != value for k, value in {"videoAnalyzerMIPerTupleUsed": 1000,
                        "eventDetectorMIPerTupleUsed": 2000, "cameraTuplePayloadBytesUsed": 20000}.items()):
                    raise ValueError("Unexpected default assumptions")
        profiles.append(meta)
    if profiles[0] != profiles[1]:
        raise ValueError("Paired profile metadata mismatch")


def summarize(raw):
    if raw.get("status") != "completed" or raw.get("type") != "stage7_evaluation":
        raise ValueError("Incomplete evaluation")
    repetitions = raw["repetitions"]
    if isinstance(repetitions, bool) or not isinstance(repetitions, int) or repetitions < 2:
        raise ValueError("At least two repetitions required")
    cases = raw["cases"]
    if [c["caseId"] for c in cases] != CASE_IDS or len(raw["runs"]) != len(cases) * repetitions or len(raw["warmups"]) != 1:
        raise ValueError("Incomplete case matrix/warmup")
    grouped = {c["caseId"]: [] for c in cases}
    lookup = {c["caseId"]: c for c in cases}
    validate(raw["warmups"][0], lookup["virtual-5"])
    seen, profiles = set(), {}
    for pair in raw["runs"]:
        key = (pair["caseId"], pair["repetition"])
        if key in seen or key[0] not in lookup or isinstance(key[1], bool) or not isinstance(key[1], int) or not 1 <= key[1] <= repetitions:
            raise ValueError("Duplicate/invalid case repetition")
        seen.add(key)
        case = lookup[key[0]]
        validate(pair, case)
        meta = pair["cloud"]["result"]["workloadProfile"]
        if key[0] in profiles and profiles[key[0]] != meta:
            raise ValueError("Profile changed across repetitions")
        profiles[key[0]] = meta
        grouped[key[0]].append(pair)
    rows, comparisons = [], []
    for case in cases:
        scenario_stats = {}
        for scenario in ("cloud", "edge"):
            stats = {metric: describe([p[scenario][metric] if metric == "driverWallClockMillis" else p[scenario]["result"]["metrics"][metric]
                                      for p in grouped[case["caseId"]]]) for metric in METRICS}
            scenario_stats[scenario] = stats
            rows.append({"caseId": case["caseId"], "family": case["family"], "cameraCount": case["cameraCount"],
                         "scenario": scenario, "statistics": stats,
                         "modeledMetricsExactlyRepeated": all(stats[k]["minimum"] == stats[k]["maximum"] for k in DETERMINISTIC)})
        changes = {k: 100 * (scenario_stats["edge"][k]["mean"] - scenario_stats["cloud"][k]["mean"]) / scenario_stats["cloud"][k]["mean"]
                   if scenario_stats["cloud"][k]["mean"] else None for k in METRICS}
        comparisons.append({"caseId": case["caseId"], "edgeChangeVsCloudPercent": changes})
    return {"schemaVersion": 1, "repetitions": repetitions, "units": UNITS, "rows": rows, "comparisons": comparisons,
            "variationMeaning": "Descriptive sample standard deviation/min/max only; no significance claim.",
            "comparisonMeaning": "100*(edge-cloud)/cloud; positive means larger, not better."}


def prepare_profiles(output):
    """Run the production CLI against synthetic clips in an isolated private pipeline root."""
    pipeline = output / "pipeline"
    for name in ("config", "models"):
        (pipeline / name).mkdir(parents=True)
    for source, dest in [(ROOT / "video_analytics/config/settings.json", pipeline / "config/settings.json"),
                         (ROOT / "video_analytics/models/yolo26n.pt", pipeline / "models/yolo26n.pt")]:
        shutil.copyfile(source, dest)
    config = json.loads((pipeline / "config/settings.json").read_text())
    if config["processing"]["frame_interval"] != 1 or config["workload_profile"]["frames_per_tuple"] != 1:
        raise ValueError("Evaluation requires approved default one-frame sampling/batching")
    if config["regions"]:
        raise ValueError("Evaluation baseline expects unconfigured regions")
    # Fail rather than download/change the model if the selected local weights cannot load.
    config["detection"]["auto_download"] = False
    save(pipeline / "config/settings.json", config)
    python = ROOT / "video_analytics/.venv/Scripts/python.exe"
    checked([str(python), str(ROOT / "video_analytics/tests/make_multi_camera_fixture.py")])
    fixtures = [ROOT / "video_analytics/tests/fixtures/synthetic_test_clip.avi", ROOT / "video_analytics/tests/.runtime/second-camera.avi"]
    env = dict(os.environ, EDGEVISION_VIDEO_CONFIG=str(pipeline / "config/settings.json"))
    evidence, profiles = [], []
    for name, fixture, expected_frames in zip(("clip-a", "clip-b"), fixtures, (20, 12)):
        job_id = uuid.uuid4().hex
        start = time.perf_counter()
        run = subprocess.run([str(python), "-m", "app.run_video", str(fixture), "--synthetic-test-input", "--job-id", job_id],
                             cwd=ROOT / "video_analytics", env=env, capture_output=True, text=True, timeout=300)
        elapsed = time.perf_counter() - start
        if run.returncode:
            raise RuntimeError("Isolated fixture analysis failed: " + run.stderr)
        profile = json.loads((pipeline / "outputs/workloads" / f"{job_id}.json").read_text())
        report = json.loads((pipeline / "outputs" / job_id / "report.json").read_text())
        if profile["sourceClassification"] != "synthetic_test" or report["video"]["processedFrameCount"] != expected_frames or report["status"] != "completed":
            raise ValueError("Unexpected analyzed fixture")
        profiles.append(profile)
        evidence.append({"caseId": name, "fixtureSha256": digest(fixture), "profile": profile,
                         "processing": report["processing"], "video": report["video"],
                         "model": report.get("model"), "ruleCoverage": report["ruleCoverage"],
                         "reportSha256": digest(pipeline / "outputs" / job_id / "report.json"),
                         "externalPipelineWallSeconds": elapsed})
        print("PASS isolated YOLO26n/ByteTrack analysis:", name, expected_frames, "frames", flush=True)
    return profiles, evidence, {"originalConfigSha256": digest(ROOT / "video_analytics/config/settings.json"),
                               "isolatedConfigSha256": digest(pipeline / "config/settings.json"),
                               "modelSha256": digest(pipeline / "models/yolo26n.pt")}


def make_cases(profiles):
    cases = [{"caseId": f"virtual-{n}", "family": "virtual", "cameraCount": n, "tupleCount": n * 150,
              "identity": uuid.uuid4().hex} for n in COUNTS]
    for name, profile in zip(("clip-a", "clip-b"), profiles):
        cases.append({"caseId": name, "family": "single", "cameraCount": 1,
                      "tupleCount": profile["iFogSimWorkload"]["frameBatching"]["tupleCount"], "inputProfile": profile})
    for n in (2, 5, 10):
        sources = []
        for index in range(n):
            p = copy.deepcopy(profiles[index % 2])
            p["jobId"] = uuid.uuid4().hex
            sources.append({"cameraId": uuid.uuid4().hex, "jobId": p["jobId"], "workloadProfile": p})
        profile = {"schemaVersion": 2, "profileType": "multi_video", "jobId": uuid.uuid4().hex,
                   "aggregationPolicy": "concurrent_start_independent_traces", "cameraCount": n,
                   "durationSeconds": max(s["workloadProfile"]["video"]["durationSeconds"] for s in sources),
                   "tupleCount": sum(s["workloadProfile"]["iFogSimWorkload"]["frameBatching"]["tupleCount"] for s in sources), "sources": sources}
        cases.append({"caseId": f"recordings-{n}", "family": "recordings", "cameraCount": n,
                      "tupleCount": profile["tupleCount"], "inputProfile": profile,
                      "provenance": "Alternating copies of clip-a/clip-b measured profiles; new logical IDs, not new footage or re-analysis."})
    return cases


def write_outputs(raw_path, destination):
    raw = json.loads(raw_path.read_text())
    summary = summarize(raw)
    summary["rawEvidenceSha256"] = digest(raw_path)
    destination.mkdir(parents=True, exist_ok=True)
    save(destination / "summary.json", summary)
    with (destination / "summary.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["caseId", "family", "cameraCount", "scenario", "metric", "unit", "n", "mean", "sampleStddev", "minimum", "maximum"])
        for row in summary["rows"]:
            for metric, stats in row["statistics"].items():
                writer.writerow([row[k] for k in ("caseId", "family", "cameraCount", "scenario")] + [metric, UNITS[metric]] +
                                [stats[k] for k in ("n", "mean", "sampleStddev", "minimum", "maximum")])
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    for family, ids in (("virtual", CASE_IDS[:6]), ("recordings", CASE_IDS[6:])):
        fig, axes = plt.subplots(2, 3, figsize=(13, 8), layout="constrained")
        for ax, (metric, title, unit, divisor) in zip(axes.flat, [
            ("loopLatencyMs", "Full application loop", "CloudSim units", 1),
            ("analyticsLatencyMs", "Arrival at event detector", "CloudSim units", 1),
            ("networkUsageMb", "Modeled payload traffic", "MB (decimal)", 1),
            ("energyJoules", "Modeled device energy", "Model MJ", 1e6),
            ("processedTuples", "Results arriving at cloud storage", "Tuple arrivals", 1),
            ("wallClockMillis", "Java controller-region runtime", "Wall-clock ms", 1)]):
            for scenario, color, marker in (("cloud", "#35618d", "s"), ("edge", "#c15a29", "o")):
                stats = [next(r for r in summary["rows"] if r["caseId"] == name and r["scenario"] == scenario)["statistics"][metric] for name in ids]
                ax.errorbar(range(len(ids)), [s["mean"] / divisor for s in stats],
                            yerr=[[ (s["mean"]-s["minimum"])/divisor for s in stats], [(s["maximum"]-s["mean"])/divisor for s in stats]],
                            marker=marker, color=color, linestyle="--" if scenario == "cloud" else "-", capsize=3, label=scenario)
            ax.set(title=title, ylabel=unit, xticks=range(len(ids)), xticklabels=[x.replace("virtual-", "") for x in ids])
            ax.tick_params(axis="x", rotation=20 if family == "recordings" else 0)
            ax.grid(alpha=.2); ax.legend(frameon=False, fontsize=8)
            ax.ticklabel_format(axis="y", style="plain", useOffset=False)
        fig.suptitle(f"Stage 7 | {'Synthetic virtual cameras' if family == 'virtual' else 'Synthetic recording-derived cases'} | {summary['repetitions']} repeats")
        fig.supxlabel("Means and observed min/max; not confidence intervals. Model outputs are not hardware measurements.", fontsize=10)
        fig.savefig(destination / f"{family}.png", dpi=160)
        plt.close(fig)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--analyze", type=Path, help="Analyze an existing raw file without running inference/simulation")
    args = parser.parse_args()
    if args.analyze:
        write_outputs(args.analyze, args.output or args.analyze.parent)
        return
    output = (args.output or ROOT / "results/experiments" / ("stage7-" + uuid.uuid4().hex[:12])).resolve()
    output.mkdir(parents=True, exist_ok=False)
    raw = {"schemaVersion": 1, "type": "stage7_evaluation", "status": "running", "repetitions": 5,
           "startedAt": datetime.now(timezone.utc).isoformat(), "cases": [], "runs": [], "warmups": [],
           "sourceCommit": checked(["git", "rev-parse", "HEAD"]).strip(),
           "simulatorRevision": checked(["git", "-C", "simulation/vendor/iFogSim", "rev-parse", "HEAD"]).strip(),
           "units": UNITS, "design": "Rotate case order; alternate scenario order. Fresh JVM each scenario; one excluded virtual-5 warmup pair. Two local video analyses only; no inference repetition or accuracy claim."}
    sources = sorted((ROOT / "simulation/src/main/java").rglob("*.java")) + sorted((ROOT / "video_analytics/app").rglob("*.py")) + [Path(__file__).resolve(), ROOT / "simulation/experiments/run_experiments.py", ROOT / "simulation/experiments/analyze_experiments.py", ROOT / "simulation/build.ps1", ROOT / "video_analytics/tests/make_multi_camera_fixture.py"]
    raw["sourceHashes"] = {str(p.relative_to(ROOT)).replace("\\", "/"): digest(p) for p in sources}
    try:
        powershell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
        print("Building unchanged production model...", flush=True)
        checked([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "simulation/build.ps1")])
        java_home = Path(os.environ.get("JAVA_HOME", ""))
        if not (java_home / "bin/java.exe").is_file():
            java_home = Path(os.environ["LOCALAPPDATA"]) / "EdgeVision/jdk-23.0.2+7"
        java = java_home / "bin/java.exe"
        jars = ROOT / "simulation/vendor/iFogSim/jars"
        cp = os.pathsep.join([str(ROOT / "simulation/target/classes"), str(jars / "*"), str(jars / "commons-math3-3.5/*")])
        raw["environment"] = {"os": platform.platform(), "logicalCpuCount": os.cpu_count(), "processor": platform.processor(),
                              "python": platform.python_version(), "node": checked(["node", "--version"]).strip(),
                              "java": subprocess.run([str(java), "-version"], capture_output=True, text=True, check=True).stderr.strip()}
        profiles, raw["videoAnalyses"], raw["pipelineHashes"] = prepare_profiles(output)
        raw["cases"] = make_cases(profiles)
        inputs = output / "profiles"; inputs.mkdir()
        for case in raw["cases"]:
            if "inputProfile" in case:
                save(inputs / (case["caseId"] + ".json"), case["inputProfile"])
                case["inputSha256"] = digest(inputs / (case["caseId"] + ".json"))

        def run_pair(case, repetition, order):
            pair = {"caseId": case["caseId"], "repetition": repetition, "order": order}
            for scenario in order:
                params = [str(case["cameraCount"]), case["identity"]] if case["family"] == "virtual" else [str(inputs / (case["caseId"] + ".json"))]
                if "inputProfile" in case and digest(inputs / (case["caseId"] + ".json")) != case["inputSha256"]:
                    raise ValueError("Immutable profile changed")
                start = time.perf_counter()
                stdout = checked([str(java), "-cp", cp, "com.edgevision.simulation.EdgeVisionSimulation", scenario, *params])
                elapsed = (time.perf_counter() - start) * 1000
                records = [line[len("RESULT_JSON:"):] for line in stdout.splitlines() if line.startswith("RESULT_JSON:")]
                if len(records) != 1:
                    raise ValueError("Expected exactly one simulation record")
                pair[scenario] = {"result": json.loads(records[0]), "driverWallClockMillis": elapsed}
            attempts = output / "attempts"
            attempts.mkdir(exist_ok=True)
            save(attempts / f"{case['caseId']}-{repetition}.json", pair)
            validate(pair, case)
            return pair

        raw["warmups"].append(run_pair(raw["cases"][3], 0, ["cloud", "edge"]))
        save(output / "raw.json", raw)
        for rep in range(1, 6):
            cases = raw["cases"]; shift = (rep - 1) % len(cases)
            for case in cases[shift:] + cases[:shift]:
                order = ["cloud", "edge"] if (rep + CASE_IDS.index(case["caseId"])) % 2 else ["edge", "cloud"]
                raw["runs"].append(run_pair(case, rep, order))
                save(output / "raw.json", raw)
                print(f"PASS repeat {rep}/5 {case['caseId']}: {case['tupleCount']} tuples each placement", flush=True)
        raw["status"] = "completed"; raw["completedAt"] = datetime.now(timezone.utc).isoformat()
        save(output / "raw.json", raw)
        write_outputs(output / "raw.json", output)
        print("Completed evaluation:", output, flush=True)
    except Exception as error:
        raw["status"] = "failed"; raw["error"] = str(error)
        save(output / "raw.json", raw)
        raise


if __name__ == "__main__":
    main()
