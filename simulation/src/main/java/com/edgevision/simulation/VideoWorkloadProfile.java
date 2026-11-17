package com.edgevision.simulation;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import java.util.List;
import java.util.regex.Pattern;

import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;

/** Validated Stage 1 profile input. Profile-derived measurements stay distinct from model assumptions. */
final class VideoWorkloadProfile {
    private static final Pattern JOB_ID = Pattern.compile("[a-f0-9]{32}");

    final String jobId;
    final String sourceClassification;
    final double durationSeconds;
    final double sourceFps;
    final long processedFrameCount;
    final long frameProcessingInterval;
    final int virtualCameraSources;
    final long framesPerTuple;
    final long tupleCount;
    final double tupleIntervalSeconds;
    final double effectiveTupleArrivalRate;
    final Long tuplePayloadBytes;
    final Double videoAnalyzerMI;
    final Double eventDetectorMI;
    final String cpuDemandStatus;
    final String cpuCalibrationReferenceHardware;
    final String cpuCalibrationMethod;
    final String tuplePayloadBasis;

    private VideoWorkloadProfile(JSONObject root) {
        jobId = string(root, "jobId");
        if (!JOB_ID.matcher(jobId).matches()) fail("jobId must be 32 lowercase hexadecimal characters");
        sourceClassification = string(root, "sourceClassification");
        if (sourceClassification.isBlank()) fail("sourceClassification must not be empty");

        JSONObject video = object(root, "video");
        durationSeconds = positive(video, "durationSeconds");
        sourceFps = positive(video, "sourceFps");
        processedFrameCount = positiveInteger(video, "processedFrameCount");
        frameProcessingInterval = positiveInteger(video, "frameProcessingInterval");

        JSONObject workload = object(root, "iFogSimWorkload");
        virtualCameraSources = Math.toIntExact(positiveInteger(workload, "virtualCameraSources"));
        JSONObject batching = object(workload, "frameBatching");
        framesPerTuple = positiveInteger(batching, "framesPerTuple");
        tupleCount = positiveInteger(batching, "tupleCount");
        tupleIntervalSeconds = positive(workload, "proposedTupleGenerationIntervalSeconds");
        effectiveTupleArrivalRate = positive(workload, "effectiveTupleArrivalRatePerSecond");

        Object payload = required(workload, "tuplePayloadBytes");
        if (payload == null) tuplePayloadBytes = null;
        else {
            tuplePayloadBytes = integerValue(payload, "iFogSimWorkload.tuplePayloadBytes");
            if (tuplePayloadBytes <= 0) fail("iFogSimWorkload.tuplePayloadBytes must be positive or null");
        }
        tuplePayloadBasis = optionalString(workload, "tuplePayloadBasis");
        if (tuplePayloadBytes == null && !"unavailable_not_serialized".equals(tuplePayloadBasis)) {
            fail("iFogSimWorkload.tuplePayloadBasis must be unavailable_not_serialized when tuplePayloadBytes is null");
        }
        if (tuplePayloadBytes != null && !"configured_assumption".equals(tuplePayloadBasis)) {
            fail("iFogSimWorkload.tuplePayloadBasis must be configured_assumption when tuplePayloadBytes is present");
        }

        JSONObject cpu = object(workload, "cpuDemand");
        Object analyzer = required(cpu, "videoAnalyzerMI");
        Object eventDetector = required(cpu, "eventDetectorMI");
        if ((analyzer == null) != (eventDetector == null)) {
            fail("cpuDemand.videoAnalyzerMI and eventDetectorMI must both be numbers or both be null");
        }
        videoAnalyzerMI = analyzer == null ? null : positiveNumber(analyzer, "cpuDemand.videoAnalyzerMI");
        eventDetectorMI = eventDetector == null ? null : positiveNumber(eventDetector, "cpuDemand.eventDetectorMI");
        cpuDemandStatus = optionalString(cpu, "status");
        cpuCalibrationReferenceHardware = optionalString(cpu, "referenceHardware");
        cpuCalibrationMethod = optionalString(cpu, "calibrationMethod");
        if (videoAnalyzerMI == null && !"unavailable".equals(cpuDemandStatus)) {
            fail("cpuDemand.status must be unavailable when CPU MI values are null");
        }
        if (videoAnalyzerMI != null && (!"estimated_from_configured_calibration".equals(cpuDemandStatus)
                || cpuCalibrationReferenceHardware == null || cpuCalibrationReferenceHardware.isBlank()
                || cpuCalibrationMethod == null || cpuCalibrationMethod.isBlank())) {
            fail("non-null cpuDemand MI values require estimated_from_configured_calibration status, "
                    + "referenceHardware, and calibrationMethod");
        }

        long expectedTuples = (processedFrameCount + framesPerTuple - 1) / framesPerTuple;
        if (tupleCount != expectedTuples) {
            fail("iFogSimWorkload.frameBatching.tupleCount is inconsistent: expected " + expectedTuples
                    + " from processedFrameCount and framesPerTuple, got " + tupleCount);
        }
        double expectedInterval = frameProcessingInterval * (double) framesPerTuple / sourceFps;
        if (!closeEnough(tupleIntervalSeconds, expectedInterval, 0.02)) {
            fail("iFogSimWorkload.proposedTupleGenerationIntervalSeconds is inconsistent with frame interval, "
                    + "framesPerTuple, and sourceFps (expected about " + expectedInterval + " seconds)");
        }
        double expectedRate = tupleCount / durationSeconds;
        if (!closeEnough(effectiveTupleArrivalRate, expectedRate, Math.max(0.02, expectedRate * 0.02))) {
            fail("iFogSimWorkload.effectiveTupleArrivalRatePerSecond is inconsistent with tupleCount / durationSeconds");
        }
        double lastEmission = (tupleCount - 1) * tupleIntervalSeconds;
        if (!Double.isFinite(lastEmission) || lastEmission > Integer.MAX_VALUE - 500.0) {
            fail("profile trace is too long for the simulation time horizon");
        }
    }

    static VideoWorkloadProfile read(Path path) throws Exception {
        Object parsed;
        try {
            String json = java.nio.file.Files.readString(path, StandardCharsets.UTF_8);
            if (!json.isEmpty() && json.charAt(0) == '\uFEFF') json = json.substring(1);
            parsed = new JSONParser().parse(json);
        } catch (Exception exception) {
            String detail = exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage();
            throw new IllegalArgumentException("Could not read workload profile " + path + ": "
                    + detail, exception);
        }
        if (!(parsed instanceof JSONObject)) fail("profile root must be a JSON object");
        try {
            return new VideoWorkloadProfile((JSONObject) parsed);
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException("Invalid workload profile: integer value is out of range", exception);
        }
    }

    static VideoWorkloadProfile fromJson(JSONObject root) {
        return new VideoWorkloadProfile(root);
    }

    long analyzerMiPerTuple() {
        return videoAnalyzerMI == null ? 1_000L : Math.max(1L, Math.round(videoAnalyzerMI / tupleCount));
    }

    long eventDetectorMiPerTuple() {
        return eventDetectorMI == null ? 2_000L : Math.max(1L, Math.round(eventDetectorMI / tupleCount));
    }

    long cameraPayloadBytes() {
        return tuplePayloadBytes == null ? 20_000L : tuplePayloadBytes;
    }

    int simulationHorizon() {
        double finalEmission = 1.0 + (tupleCount - 1) * tupleIntervalSeconds;
        return (int) Math.max(2_000L, (long) Math.ceil(finalEmission + 3 * 100 + 10));
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> resultMetadata() {
        Map<String, Object> profile = new java.util.LinkedHashMap<>();
        profile.put("jobId", jobId);
        profile.put("sourceClassification", sourceClassification);
        profile.put("durationSeconds", durationSeconds);
        profile.put("sourceFps", sourceFps);
        profile.put("processedFrameCount", processedFrameCount);
        profile.put("frameProcessingInterval", frameProcessingInterval);
        profile.put("virtualCameraSources", virtualCameraSources);
        profile.put("framesPerTuple", framesPerTuple);
        profile.put("tupleCountFromProfile", tupleCount);
        profile.put("tupleGenerationIntervalSeconds", tupleIntervalSeconds);
        profile.put("effectiveTupleArrivalRatePerSecond", effectiveTupleArrivalRate);
        profile.put("tuplePayloadBytesFromProfile", tuplePayloadBytes);
        profile.put("tuplePayloadBasisFromProfile", tuplePayloadBasis);
        Map<String, Object> cpuFromProfile = new java.util.LinkedHashMap<>();
        cpuFromProfile.put("videoAnalyzerMI", videoAnalyzerMI);
        cpuFromProfile.put("eventDetectorMI", eventDetectorMI);
        profile.put("cpuDemandFromProfileMI", cpuFromProfile);
        profile.put("cpuDemandStatusFromProfile", cpuDemandStatus);
        profile.put("generatedTuples", SimulationTelemetry.getCameraEmissions());
        List<Double> emissionTimes = SimulationTelemetry.getCameraEmissionTimes();
        double maximumIntervalError = 0.0;
        for (int index = 1; index < emissionTimes.size(); index++) {
            maximumIntervalError = Math.max(maximumIntervalError,
                    Math.abs((emissionTimes.get(index) - emissionTimes.get(index - 1)) - tupleIntervalSeconds));
        }
        profile.put("actualFirstTupleEmissionTimeSeconds", emissionTimes.isEmpty() ? null : emissionTimes.get(0));
        profile.put("actualLastTupleEmissionTimeSeconds", emissionTimes.isEmpty()
                ? null : emissionTimes.get(emissionTimes.size() - 1));
        profile.put("maxTupleIntervalDeviationSeconds", maximumIntervalError);
        profile.put("tupleIntervalsMatchProfile", emissionTimes.size() == tupleCount
                && maximumIntervalError <= Math.max(1.0e-8, tupleIntervalSeconds * 1.0e-6));
        profile.put("simulatedVideoFramesSent", false);

        Map<String, Object> assumptions = new java.util.LinkedHashMap<>();
        assumptions.put("cpuMIStatus", videoAnalyzerMI == null
                ? "existing_java_assumption"
                : "estimated_from_profile_calibration_rounded_per_tuple");
        assumptions.put("videoAnalyzerMIPerTupleUsed", analyzerMiPerTuple());
        assumptions.put("eventDetectorMIPerTupleUsed", eventDetectorMiPerTuple());
        assumptions.put("resultStorageMIPerTupleUsed", 500L);
        assumptions.put("payloadSizeStatus", tuplePayloadBytes == null
                ? "existing_java_assumption" : "profile_configured_assumption");
        assumptions.put("cameraTuplePayloadBytesUsed", cameraPayloadBytes());
        assumptions.put("analyzedTuplePayloadBytesUsed", 2_000L);
        assumptions.put("eventTuplePayloadBytesUsed", 500L);
        assumptions.put("cpuCalibrationReferenceHardware", cpuCalibrationReferenceHardware);
        assumptions.put("cpuCalibrationMethod", cpuCalibrationMethod);
        profile.put("simulationAssumptions", assumptions);
        return profile;
    }

    private static boolean closeEnough(double actual, double expected, double tolerance) {
        return Math.abs(actual - expected) <= Math.max(tolerance, Math.abs(expected) * 0.02);
    }

    private static JSONObject object(JSONObject parent, String key) {
        Object value = required(parent, key);
        if (!(value instanceof JSONObject)) fail(key + " must be a JSON object");
        return (JSONObject) value;
    }

    private static Object required(JSONObject parent, String key) {
        if (!parent.containsKey(key)) fail("missing required field: " + key);
        return parent.get(key);
    }

    private static String string(JSONObject parent, String key) {
        Object value = required(parent, key);
        if (!(value instanceof String)) fail(key + " must be a string");
        return (String) value;
    }

    private static String optionalString(JSONObject parent, String key) {
        Object value = parent.get(key);
        return value instanceof String ? (String) value : null;
    }

    private static double positive(JSONObject parent, String key) {
        return positiveNumber(required(parent, key), key);
    }

    private static double positiveNumber(Object value, String key) {
        if (!(value instanceof Number)) fail(key + " must be a number");
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number <= 0) fail(key + " must be finite and greater than zero");
        return number;
    }

    private static long positiveInteger(JSONObject parent, String key) {
        return integerValue(required(parent, key), key);
    }

    private static long integerValue(Object value, String key) {
        if (!(value instanceof Number)) fail(key + " must be an integer");
        double number = ((Number) value).doubleValue();
        if (!Double.isFinite(number) || number <= 0 || number != Math.rint(number) || number > Long.MAX_VALUE) {
            fail(key + " must be a positive integer");
        }
        return ((Number) value).longValue();
    }

    private static void fail(String message) {
        throw new IllegalArgumentException("Invalid workload profile: " + message);
    }
}
