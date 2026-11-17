"""Reference evidence and failure cases for the Stage 7 evaluator (no inference)."""
import copy
import unittest

from stage7_evaluation import make_cases, summarize, validate, expected_horizon, METRICS


def reference_profile(frames, fps, identity):
    return {"jobId": identity, "sourceClassification": "synthetic_test",
            "video": {"durationSeconds": frames / fps, "sourceFps": fps,
                      "processedFrameCount": frames, "frameProcessingInterval": 1},
            "iFogSimWorkload": {"frameBatching": {"tupleCount": frames, "framesPerTuple": 1},
                               "proposedTupleGenerationIntervalSeconds": 1 / fps}}


def reference_pair(case, repetition=1):
    pair = {"caseId": case["caseId"], "repetition": repetition, "order": ["cloud", "edge"]}
    for scenario, value in (("cloud", 10), ("edge", 15)):
        meta = {}
        if case["family"] == "virtual":
            n = case["cameraCount"]
            meta = {"type": "standalone_virtual_camera", "workloadProfileId": case["identity"],
                    "virtualCameraSources": n, "sourceIds": [f"virtual-camera-{i+1:02d}" for i in range(n)],
                    "durationSeconds": 15, "tupleIntervalMs": 100, "tuplesPerCamera": 150, "tupleCount": 150*n}
        else:
            p = case["inputProfile"]
            meta = {"jobId": p["jobId"], "virtualCameraSources": case["cameraCount"],
                    "generatedTuples": case["tupleCount"], "tupleCountFromProfile": case["tupleCount"],
                    "simulatedVideoFramesSent": False, "tupleIntervalsMatchProfile": True}
            if case["family"] == "single":
                v = p["video"]
                meta.update(sourceClassification="synthetic_test", durationSeconds=v["durationSeconds"],
                            sourceFps=v["sourceFps"], processedFrameCount=v["processedFrameCount"],
                            frameProcessingInterval=1, framesPerTuple=1, tupleGenerationIntervalSeconds=1/v["sourceFps"],
                            maxTupleIntervalDeviationSeconds=0, actualFirstTupleEmissionTimeSeconds=1,
                            actualLastTupleEmissionTimeSeconds=1+(v["processedFrameCount"]-1)/v["sourceFps"],
                            simulationAssumptions={"videoAnalyzerMIPerTupleUsed": 1000,
                             "eventDetectorMIPerTupleUsed": 2000, "cameraTuplePayloadBytesUsed": 20000})
            else:
                sources = []
                for s in p["sources"]:
                    v = s["workloadProfile"]["video"]; n = v["processedFrameCount"]
                    sources.append({"cameraId": s["cameraId"], "jobId": s["jobId"], "tupleCount": n,
                        "tupleIntervalSeconds": 1/v["sourceFps"], "durationSeconds": v["durationSeconds"],
                        "sourceClassification": "synthetic_test", "generatedTuples": n, "processedTuples": n,
                        "videoAnalyzerMIPerTupleUsed": 1000, "eventDetectorMIPerTupleUsed": 2000,
                        "cameraTuplePayloadBytesUsed": 20000, "tupleIntervalsMatchProfile": True,
                        "firstEmissionSeconds": 1, "lastEmissionSeconds": 1+(n-1)/v["sourceFps"],
                        "maxIntervalDeviationSeconds": 0})
                meta["sources"] = sources
        metrics = {m: value for m in METRICS if m != "driverWallClockMillis"}
        metrics.update(processedTuples=case["tupleCount"], simulationTimeSeconds=2023 if case["caseId"] == "recordings-10" else 2000,
                       wallClockMillis=repetition * (1 if scenario == "cloud" else 2))
        pair[scenario] = {"result": {"scenario": scenario, "metrics": metrics, "workloadProfile": meta},
                          "driverWallClockMillis": repetition * 3}
    return pair


def reference_report():
    cases = make_cases([reference_profile(20, 10, "a"*32), reference_profile(12, 4, "b"*32)])
    return {"type": "stage7_evaluation", "status": "completed", "repetitions": 2, "cases": cases,
            "warmups": [reference_pair(cases[3], 0)],
            "runs": [reference_pair(c, r) for r in (1, 2) for c in cases]}


class EvaluationTests(unittest.TestCase):
    def test_complete_reference_signed_comparison_and_statistics(self):
        raw = reference_report(); summary = summarize(raw)
        self.assertEqual(len(summary["rows"]), 22)
        stats = summary["rows"][0]["statistics"]["wallClockMillis"]
        self.assertEqual(stats["mean"], 1.5)
        self.assertAlmostEqual(stats["sampleStddev"], 2**-.5)
        self.assertEqual(summary["comparisons"][0]["edgeChangeVsCloudPercent"]["energyJoules"], 50)
        self.assertEqual([c["tupleCount"] for c in raw["cases"][-3:]], [32, 84, 160])

    def test_incomplete_failed_duplicate_or_missing_warmup_rejected(self):
        for mutation in (lambda r: r.update(status="failed"), lambda r: r["runs"].pop(),
                         lambda r: r["runs"].__setitem__(-1, copy.deepcopy(r["runs"][0])), lambda r: r.update(warmups=[])):
            raw = reference_report(); mutation(raw)
            with self.assertRaises(ValueError): summarize(raw)

    def test_swapped_identity_rejected_even_when_both_scenarios_match(self):
        raw = reference_report(); pair = raw["runs"][-1]
        for scenario in ("cloud", "edge"):
            pair[scenario]["result"]["workloadProfile"]["sources"][0]["cameraId"] = "f"*32
        with self.assertRaisesRegex(ValueError, "identity"): summarize(raw)

    def test_missing_arrivals_horizon_or_source_timing_rejected(self):
        for mutate in (lambda p: p["edge"]["result"]["metrics"].update(processedTuples=159),
                       lambda p: p["edge"]["result"]["metrics"].update(simulationTimeSeconds=2001),
                       lambda p: p["edge"]["result"]["workloadProfile"]["sources"][0].update(lastEmissionSeconds=100)):
            raw = reference_report(); mutate(raw["runs"][-1])
            with self.assertRaises(ValueError): summarize(raw)

    def test_nonfinite_boolean_negative_and_missing_values_rejected(self):
        for bad in (float('nan'), float('inf'), True, -1, None):
            raw = reference_report(); raw["runs"][0]["edge"]["result"]["metrics"]["loopLatencyMs"] = bad
            with self.assertRaises(ValueError): summarize(raw)

    def test_repetition_metadata_mutation_rejected(self):
        raw = reference_report()
        for scenario in ("cloud", "edge"):
            raw["runs"][-1][scenario]["result"]["workloadProfile"]["extra"] = "changed"
        with self.assertRaisesRegex(ValueError, "changed across repetitions"): summarize(raw)

    def test_single_trace_or_cpu_assumption_mutation_rejected(self):
        for change in ({"sourceFps": 30}, {"tupleGenerationIntervalSeconds": .2}):
            raw = reference_report(); pair = raw["runs"][6]
            for scenario in ("cloud", "edge"): pair[scenario]["result"]["workloadProfile"].update(change)
            with self.assertRaises(ValueError): validate(pair, raw["cases"][6])
        raw = reference_report(); pair = raw["runs"][6]
        for scenario in ("cloud", "edge"):
            pair[scenario]["result"]["workloadProfile"]["simulationAssumptions"]["eventDetectorMIPerTupleUsed"] = 1000
        with self.assertRaisesRegex(ValueError, "assumptions"): validate(pair, raw["cases"][6])

    def test_longer_ten_source_horizon_preserved(self):
        raw = reference_report()
        self.assertEqual(expected_horizon(raw["cases"][-1]), 2023)
        self.assertEqual(expected_horizon(raw["cases"][-2]), 2000)


if __name__ == '__main__':
    unittest.main()
