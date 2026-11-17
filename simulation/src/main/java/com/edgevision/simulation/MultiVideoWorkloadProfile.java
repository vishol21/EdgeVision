package com.edgevision.simulation;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;

/** Independent finite per-recording traces. No fabricated common FPS or cross-camera identities. */
final class MultiVideoWorkloadProfile {
    record Camera(String cameraId, String jobId, VideoWorkloadProfile profile) {
        String inputType() { return "CAMERA_" + cameraId; }
        String analyzedType() { return "ANALYZED_" + cameraId; }
        String resultType() { return "RESULT_" + cameraId; }
    }
    final String jobId;
    final List<Camera> cameras = new ArrayList<>();
    final long tupleCount;
    final double durationSeconds;
    private final Map<String, List<Double>> emissions = new HashMap<>();
    private final Map<String, Long> processed = new HashMap<>();
    private final Map<Integer, String> tupleSources = new HashMap<>();
    private final Map<Integer, Double> emitTimes = new HashMap<>();
    private double fullLatencyTotal;
    private long fullLatencyCount;

    static JSONObject readRoot(Path path) throws Exception {
        String text = Files.readString(path, java.nio.charset.StandardCharsets.UTF_8);
        if (text.startsWith("\uFEFF")) text = text.substring(1);
        Object root = new JSONParser().parse(text);
        if (!(root instanceof JSONObject)) throw new IllegalArgumentException("Profile root must be an object.");
        return (JSONObject) root;
    }

    MultiVideoWorkloadProfile(JSONObject root) {
        jobId = String.valueOf(root.get("jobId"));
        require(jobId.matches("[a-f0-9]{32}"), "Invalid batch identity.");
        require("multi_video".equals(root.get("profileType")) && Long.valueOf(2).equals(root.get("schemaVersion")), "Invalid combined profile schema.");
        require("concurrent_start_independent_traces".equals(root.get("aggregationPolicy")), "Unsupported aggregation policy.");
        require(root.get("sources") instanceof List<?>, "Camera sources are required.");
        List<?> sources = (List<?>) root.get("sources");
        require(!sources.isEmpty() && sources.size() <= 10, "Combined profile requires 1-10 successful cameras.");
        HashSet<String> ids = new HashSet<>();
        HashSet<String> jobs = new HashSet<>();
        long count = 0;
        double duration = 0;
        for (Object value : sources) {
            require(value instanceof JSONObject, "Invalid camera source.");
            JSONObject source = (JSONObject) value;
            String cameraId = String.valueOf(source.get("cameraId"));
            String cameraJob = String.valueOf(source.get("jobId"));
            require(cameraId.matches("[a-f0-9]{32}") && ids.add(cameraId), "Camera identities must be safe and unique.");
            require(cameraJob.matches("[a-f0-9]{32}") && jobs.add(cameraJob) && !cameraJob.equals(jobId), "Video job identities must be distinct.");
            require(source.get("workloadProfile") instanceof JSONObject, "Missing per-camera profile.");
            VideoWorkloadProfile profile = VideoWorkloadProfile.fromJson((JSONObject) source.get("workloadProfile"));
            require(profile.jobId.equals(cameraJob) && profile.virtualCameraSources == 1, "Camera/profile identity mismatch.");
            cameras.add(new Camera(cameraId, cameraJob, profile));
            emissions.put(cameraId, new ArrayList<>());
            processed.put(cameraId, 0L);
            count = Math.addExact(count, profile.tupleCount);
            duration = Math.max(duration, profile.durationSeconds);
        }
        tupleCount = count;
        durationSeconds = duration;
        require(root.get("tupleCount") instanceof Number && ((Number) root.get("tupleCount")).doubleValue() == count, "Combined tuple count is inconsistent.");
        require(root.get("cameraCount") instanceof Number && ((Number) root.get("cameraCount")).doubleValue() == cameras.size(), "Combined camera count is inconsistent.");
        require(root.get("durationSeconds") instanceof Number && Math.abs(((Number) root.get("durationSeconds")).doubleValue() - duration) <= 1e-8,
                "Combined duration must equal the longest source duration.");
        simulationHorizon();
    }

    void emitted(String cameraId, int tupleId, double time) {
        emissions.get(cameraId).add(time);
        tupleSources.put(tupleId, cameraId);
        emitTimes.put(tupleId, time);
    }

    void arrived(int tupleId) {
        String source = tupleSources.remove(tupleId);
        if (source != null) {
            processed.put(source, processed.get(source) + 1);
            fullLatencyTotal += org.cloudbus.cloudsim.core.CloudSim.clock() - emitTimes.remove(tupleId);
            fullLatencyCount++;
        }
    }

    Double loopLatency() { return fullLatencyCount == 0 ? null : fullLatencyTotal / fullLatencyCount; }

    int simulationHorizon() {
        double last = 0;
        double maxCpu = 0;
        double maxPayload = 0;
        for (Camera camera : cameras) {
            VideoWorkloadProfile p = camera.profile();
            last = Math.max(last, (p.tupleCount - 1) * p.tupleIntervalSeconds);
            maxCpu = Math.max(maxCpu, (double) p.analyzerMiPerTuple() + p.eventDetectorMiPerTuple() + 500);
            maxPayload = Math.max(maxPayload, p.cameraPayloadBytes() + 2500.0);
        }
        double horizon = Math.max(2000, Math.ceil(last + tupleCount * (4 * maxCpu / 2800 + 2 * maxPayload / 10000) + 500));
        require(Double.isFinite(horizon) && horizon < Integer.MAX_VALUE, "Combined workload exceeds the supported horizon.");
        return (int) horizon;
    }

    Map<String, Object> resultMetadata() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", "multi_video");
        result.put("jobId", jobId);
        result.put("virtualCameraSources", cameras.size());
        result.put("tupleCountFromProfile", tupleCount);
        result.put("generatedTuples", SimulationTelemetry.getCameraEmissions());
        result.put("durationSeconds", durationSeconds);
        result.put("aggregationPolicy", "concurrent_start_independent_traces");
        result.put("simulatedVideoFramesSent", false);
        List<Map<String, Object>> records = new ArrayList<>();
        boolean allMatch = true;
        for (Camera camera : cameras) {
            VideoWorkloadProfile p = camera.profile();
            List<Double> times = emissions.get(camera.cameraId());
            double error = 0;
            for (int i = 1; i < times.size(); i++) error = Math.max(error, Math.abs(times.get(i) - times.get(i - 1) - p.tupleIntervalSeconds));
            boolean match = times.size() == p.tupleCount && error <= Math.max(1e-8, p.tupleIntervalSeconds * 1e-6);
            allMatch &= match && processed.get(camera.cameraId()) == p.tupleCount;
            Map<String, Object> record = new LinkedHashMap<>();
            record.put("cameraId", camera.cameraId());
            record.put("jobId", camera.jobId());
            record.put("tupleCount", p.tupleCount);
            record.put("tupleIntervalSeconds", p.tupleIntervalSeconds);
            record.put("durationSeconds", p.durationSeconds);
            record.put("sourceClassification", p.sourceClassification);
            record.put("generatedTuples", times.size());
            record.put("processedTuples", processed.get(camera.cameraId()));
            record.put("firstEmissionSeconds", times.isEmpty() ? null : times.getFirst());
            record.put("lastEmissionSeconds", times.isEmpty() ? null : times.getLast());
            record.put("maxIntervalDeviationSeconds", error);
            record.put("tupleIntervalsMatchProfile", match);
            record.put("videoAnalyzerMIPerTupleUsed", p.analyzerMiPerTuple());
            record.put("eventDetectorMIPerTupleUsed", p.eventDetectorMiPerTuple());
            record.put("cameraTuplePayloadBytesUsed", p.cameraPayloadBytes());
            record.put("cpuDemandStatus", p.cpuDemandStatus);
            record.put("tuplePayloadBasis", p.tuplePayloadBasis);
            records.add(record);
        }
        result.put("sources", records);
        result.put("tupleIntervalsMatchProfile", allMatch);
        return result;
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalArgumentException("Invalid multi-video profile: " + message);
    }
}
