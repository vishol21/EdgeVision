"""Repeat the existing Java model without overwriting standalone/video result files."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
COUNTS = (1, 2, 3, 5, 6, 10)


def checked(command: list[str], *, cwd: Path = ROOT) -> str:
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=900)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {result.stdout}\n{result.stderr}")
    return result.stdout


def validate_pair(pair: dict, count: int, identity: str) -> None:
    expected_ids = [f"virtual-camera-{index + 1:02d}" for index in range(count)]
    profiles = []
    for scenario in ("cloud", "edge"):
        record = pair[scenario]["result"]
        if record["scenario"] != scenario:
            raise ValueError("Scenario result identity mismatch.")
        profile = record["workloadProfile"]
        expected = {"type": "standalone_virtual_camera", "workloadProfileId": identity,
                    "virtualCameraSources": count, "sourceIds": expected_ids,
                    "durationSeconds": 15, "tupleIntervalMs": 100,
                    "tuplesPerCamera": 150, "tupleCount": count * 150}
        if profile != expected:
            raise ValueError("Experiment workload does not match the requested finite camera trace.")
        if record["metrics"]["processedTuples"] != count * 150:
            raise ValueError("Experiment did not process the complete workload.")
        if record["metrics"]["simulationTimeSeconds"] != 2000:
            raise ValueError("Simulation horizon differs from the established experiment assumptions.")
        profiles.append(profile)
    if profiles[0] != profiles[1]:
        raise ValueError("Cloud and edge must receive exactly the same workload profile.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repetitions", type=int, default=5)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 2 <= args.repetitions <= 30:
        parser.error("Use 2-30 measured repetitions; default is 5.")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = args.output or ROOT / "results" / "experiments" / f"{stamp}-{uuid.uuid4().hex[:8]}"
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    powershell = Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    print("Building the pinned production simulation...", flush=True)
    checked([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
             "-File", str(ROOT / "simulation/build.ps1")])
    java_home = Path(os.environ.get("JAVA_HOME", ""))
    if not (java_home / "bin/java.exe").is_file():
        java_home = Path(os.environ["LOCALAPPDATA"]) / "EdgeVision/jdk-23.0.2+7"
    java = java_home / "bin/java.exe"
    jars = ROOT / "simulation/vendor/iFogSim/jars"
    classpath = os.pathsep.join([str(ROOT / "simulation/target/classes"), str(jars / "*"), str(jars / "commons-math3-3.5/*")])
    java_version = subprocess.run([str(java), "-version"], capture_output=True, text=True, check=True).stderr.strip()
    source_files = ["simulation/build.ps1", *[str(p.relative_to(ROOT)).replace("\\", "/")
                    for p in sorted((ROOT / "simulation/src/main/java").rglob("*.java"))]]
    report = {
        "schemaVersion": 1, "type": "synthetic_virtual_camera_experiment",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "sourceCommit": checked(["git", "rev-parse", "HEAD"]).strip(),
        "simulatorRevision": checked(["git", "-C", "simulation/vendor/iFogSim", "rev-parse", "HEAD"]).strip(),
        "sourceHashes": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in source_files},
        "environment": {"operatingSystem": platform.system(), "osVersion": platform.version(),
                        "logicalCpuCount": os.cpu_count(), "processor": platform.processor(),
                        "python": platform.python_version(), "java": java_version,
                        "node": checked(["node", "--version"]).strip()},
        "design": {"cameraCounts": list(COUNTS), "measuredRepetitionsPerCount": args.repetitions,
                   "warmupPairs": 1, "warmupCameraCount": 5,
                   "warmupScope": "OS/file caches only; every scenario still starts a fresh JVM, with no shared JIT warmup.",
                   "ordering": "Alternate cloud-first and edge-first by repetition and camera-count index.",
                   "profilePolicy": "One fixed profile ID/trace per camera count across measured repetitions; identical profile for each pair.",
                   "tupleIntervalSeconds": 0.1, "workloadDurationSeconds": 15,
                   "tuplesPerCamera": 150, "simulationHorizon": 2000},
        "measurementNotes": {
            "loopLatencyMs": "Legacy key: raw TimeKeeper clock average; report as simulator time units, not milliseconds.",
            "analyticsLatencyMs": "Legacy key: emission-to-Event_Detector arrival clock average; excludes Event_Detector computation and final delivery.",
            "processedTuples": "Result tuple arrivals at the cloud-storage module, not decoded frames or confirmed storage-computation completions.",
            "wallClockMillis": "Java measurement from controller setup through metrics collection, excluding build, JVM startup and topology construction.",
            "driverWallClockMillis": "External Java subprocess elapsed wall-clock, including JVM startup; excludes build.",
            "inference": "No Python video analysis or YOLO/ByteTrack inference is run by these experiments."},
        "warmups": [], "runs": []}
    destination = output / "raw.json"

    def checkpoint() -> None:
        temporary = output / "raw.json.tmp"
        temporary.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        temporary.replace(destination)

    def run_pair(count: int, identity: str, order: list[str], repetition: int) -> dict:
        pair = {"cameraCount": count, "repetition": repetition, "order": order}
        for scenario in order:
            started = time.perf_counter()
            stdout = checked([str(java), "-cp", classpath, "com.edgevision.simulation.EdgeVisionSimulation",
                              scenario, str(count), identity])
            elapsed = (time.perf_counter() - started) * 1000
            lines = [line[len("RESULT_JSON:"):] for line in stdout.splitlines() if line.startswith("RESULT_JSON:")]
            if len(lines) != 1:
                raise ValueError("Each scenario must emit exactly one result record.")
            pair[scenario] = {"result": json.loads(lines[0]), "driverWallClockMillis": elapsed}
        validate_pair(pair, count, identity)
        return pair

    checkpoint()
    try:
        report["warmups"].append(run_pair(5, uuid.uuid4().hex, ["cloud", "edge"], 0))
        checkpoint()
        print("PASS excluded warm-up pair (5 cameras).", flush=True)
        identities = {count: uuid.uuid4().hex for count in COUNTS}
        # Rotate camera-count order between repetitions to spread host/cache effects.
        for repetition in range(1, args.repetitions + 1):
            shift = (repetition - 1) % len(COUNTS)
            order_counts = COUNTS[shift:] + COUNTS[:shift]
            for count in order_counts:
                cloud_first = (repetition + COUNTS.index(count)) % 2 == 1
                order = ["cloud", "edge"] if cloud_first else ["edge", "cloud"]
                pair = run_pair(count, identities[count], order, repetition)
                report["runs"].append(pair)
                checkpoint()
                print(f"PASS repetition {repetition}/{args.repetitions}, {count} cameras, {count * 150} tuples per placement.", flush=True)
        report["completedAt"] = datetime.now(timezone.utc).isoformat()
        report["status"] = "completed"
    except Exception as error:
        report["status"] = "failed"
        report["error"] = str(error)
        raise
    finally:
        checkpoint()
    print(f"Saved validated raw experiments to {destination}", flush=True)


if __name__ == "__main__":
    main()
