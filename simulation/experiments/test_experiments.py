"""Independent reference cases for fairness checks and descriptive calculations."""
import copy
import unittest

from analyze_experiments import describe, summarize
from run_experiments import validate_pair


def pair(count=1, identity="a" * 32):
    profile = {"type": "standalone_virtual_camera", "workloadProfileId": identity,
               "virtualCameraSources": count, "sourceIds": [f"virtual-camera-{i+1:02d}" for i in range(count)],
               "durationSeconds": 15, "tupleIntervalMs": 100, "tuplesPerCamera": 150, "tupleCount": count * 150}
    return {scenario: {"result": {"scenario": scenario, "workloadProfile": copy.deepcopy(profile),
                                  "metrics": {"processedTuples": count * 150, "simulationTimeSeconds": 2000}}}
            for scenario in ("cloud", "edge")}


class ExperimentTests(unittest.TestCase):
    def test_reference_statistics_and_runtime_variation(self):
        result = describe([2.0, 4.0, 6.0])
        self.assertEqual(result, {"n": 3, "mean": 4, "sampleStddev": 2, "minimum": 2, "maximum": 6})

    def test_nonfinite_or_insufficient_measurements_rejected(self):
        for values in ([1], [1, float("nan")], [1, float("inf")], [True, 2], [1, "2"]):
            with self.subTest(values=values), self.assertRaises(ValueError):
                describe(values)

    def test_valid_pair_and_profile_identity_mismatch(self):
        records = pair()
        validate_pair(records, 1, "a" * 32)
        records["edge"]["result"]["workloadProfile"]["workloadProfileId"] = "b" * 32
        with self.assertRaisesRegex(ValueError, "workload"):
            validate_pair(records, 1, "a" * 32)

    def test_incomplete_tuple_processing_rejected(self):
        records = pair()
        records["edge"]["result"]["metrics"]["processedTuples"] = 149
        with self.assertRaisesRegex(ValueError, "complete workload"):
            validate_pair(records, 1, "a" * 32)

    def test_failed_or_incomplete_evidence_rejected(self):
        with self.assertRaises(ValueError):
            summarize({"status": "failed"})
        with self.assertRaises(ValueError):
            summarize({"status": "completed", "design": {"cameraCounts": [1, 2, 3, 5, 6, 10],
                       "measuredRepetitionsPerCount": 5}, "runs": []})

    def test_complete_matrix_excludes_warmup_and_preserves_tradeoff_sign(self):
        report = {"status": "completed", "sourceCommit": "reference-case", "warmups": [{}],
                  "design": {"cameraCounts": [1, 2, 3, 5, 6, 10], "measuredRepetitionsPerCount": 2}, "runs": []}
        for count in report["design"]["cameraCounts"]:
            for repetition in (1, 2):
                run = pair(count, f"{count:032x}")
                run.update(cameraCount=count, repetition=repetition)
                for scenario in ("cloud", "edge"):
                    metrics = run[scenario]["result"]["metrics"]
                    metrics.update(loopLatencyMs=10 if scenario == "cloud" else 15,
                                   analyticsLatencyMs=10 if scenario == "cloud" else 5,
                                   networkUsageMb=100 if scenario == "cloud" else 50,
                                   energyJoules=20, wallClockMillis=100 + repetition)
                    run[scenario]["driverWallClockMillis"] = 200 + repetition
                report["runs"].append(run)
        summary = summarize(report)
        self.assertEqual(len(summary["rows"]), 12)
        self.assertEqual(summary["warmupPairsExcluded"], 1)
        for comparison in summary["comparisons"]:
            self.assertEqual(comparison["edgeChangeVsCloudPercent"]["loopLatencyMs"], 50)
            self.assertEqual(comparison["edgeChangeVsCloudPercent"]["analyticsLatencyMs"], -50)
            self.assertEqual(comparison["edgeChangeVsCloudPercent"]["energyJoules"], 0)
        report["runs"][-1] = report["runs"][0]
        with self.assertRaisesRegex(ValueError, "duplicate"):
            summarize(report)


if __name__ == "__main__":
    unittest.main()
