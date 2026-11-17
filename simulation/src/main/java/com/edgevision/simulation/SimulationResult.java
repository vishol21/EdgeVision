package com.edgevision.simulation;

import java.util.LinkedHashMap;
import java.util.Map;
import org.json.simple.JSONObject;

/** Values captured from one completed iFogSim run. */
public final class SimulationResult {
    private final String scenario;
    private final Double loopLatencyMs;
    private final Double analyticsLatencyMs;
    private final double networkUsageMb;
    private final double nativeNetworkUsageIndex;
    private final double energyJoules;
    private final double simulatedTime;
    private final long processedTuples;
    private final long wallClockMillis;
    private final Map<String, Object> workloadProfile;

    public SimulationResult(String scenario, Double loopLatencyMs, Double analyticsLatencyMs,
            double networkUsageMb,
            double nativeNetworkUsageIndex, double energyJoules, double simulatedTime,
            long processedTuples, long wallClockMillis, Map<String, Object> workloadProfile) {
        this.scenario = scenario;
        this.loopLatencyMs = loopLatencyMs;
        this.analyticsLatencyMs = analyticsLatencyMs;
        this.networkUsageMb = networkUsageMb;
        this.nativeNetworkUsageIndex = nativeNetworkUsageIndex;
        this.energyJoules = energyJoules;
        this.simulatedTime = simulatedTime;
        this.processedTuples = processedTuples;
        this.wallClockMillis = wallClockMillis;
        this.workloadProfile = workloadProfile;
    }

    @SuppressWarnings("unchecked")
    public String toJson() {
        Map<String, Object> metrics = new LinkedHashMap<>();
        metrics.put("loopLatencyMs", loopLatencyMs);
        metrics.put("analyticsLatencyMs", analyticsLatencyMs);
        metrics.put("networkUsageMb", networkUsageMb);
        metrics.put("nativeNetworkUsageIndex", nativeNetworkUsageIndex);
        metrics.put("energyJoules", energyJoules);
        metrics.put("simulationTimeSeconds", simulatedTime);
        metrics.put("processedTuples", processedTuples);
        metrics.put("wallClockMillis", wallClockMillis);

        JSONObject payload = new JSONObject();
        payload.put("scenario", scenario);
        payload.put("completedAt", java.time.Instant.now().toString());
        payload.put("metrics", metrics);
        if (workloadProfile != null) payload.put("workloadProfile", workloadProfile);
        return payload.toJSONString();
    }
}
