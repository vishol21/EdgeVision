package com.edgevision.simulation;

import java.util.HashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/** Counters for modeled tuple payload traffic and results arriving at cloud storage. */
final class SimulationTelemetry {
    private static final AtomicLong NETWORK_BYTES = new AtomicLong();
    private static final AtomicLong STORED_RESULTS = new AtomicLong();
    private static final AtomicLong CAMERA_EMISSIONS = new AtomicLong();
    private static final Map<Integer, Double> CAMERA_EMIT_TIMES = new HashMap<>();
    private static final List<Double> CAMERA_EMISSION_TIMES = new ArrayList<>();
    private static double analyticsLatencyTotal;
    private static long analyticsLatencyCount;

    private SimulationTelemetry() { }

    static void reset() {
        NETWORK_BYTES.set(0);
        STORED_RESULTS.set(0);
        CAMERA_EMISSIONS.set(0);
        CAMERA_EMIT_TIMES.clear();
        CAMERA_EMISSION_TIMES.clear();
        analyticsLatencyTotal = 0;
        analyticsLatencyCount = 0;
    }

    static void addNetworkBytes(long bytes) {
        NETWORK_BYTES.addAndGet(bytes);
    }

    static long getNetworkBytes() {
        return NETWORK_BYTES.get();
    }

    static void recordStoredResult() {
        STORED_RESULTS.incrementAndGet();
    }

    static long getStoredResults() {
        return STORED_RESULTS.get();
    }

    static void recordCameraEmission(int tupleId, double simulationTime) {
        CAMERA_EMISSIONS.incrementAndGet();
        CAMERA_EMISSION_TIMES.add(simulationTime);
        if (tupleId >= 0) CAMERA_EMIT_TIMES.put(tupleId, simulationTime);
    }

    static long getCameraEmissions() {
        return CAMERA_EMISSIONS.get();
    }

    static List<Double> getCameraEmissionTimes() {
        return List.copyOf(CAMERA_EMISSION_TIMES);
    }

    static void recordAnalyticsArrival(int tupleId, double simulationTime) {
        Double emittedAt = CAMERA_EMIT_TIMES.remove(tupleId);
        if (emittedAt == null) return;
        analyticsLatencyTotal += simulationTime - emittedAt;
        analyticsLatencyCount++;
    }

    static Double getAnalyticsLatencyAverage() {
        return analyticsLatencyCount == 0 ? null : analyticsLatencyTotal / analyticsLatencyCount;
    }
}
