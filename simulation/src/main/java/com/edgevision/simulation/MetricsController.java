package com.edgevision.simulation;

import java.util.List;
import org.cloudbus.cloudsim.core.CloudSim;
import org.cloudbus.cloudsim.core.SimEvent;
import org.fog.application.Application;
import org.fog.entities.FogDevice;
import org.fog.entities.Sensor;
import org.fog.placement.Controller;
import org.fog.utils.Config;
import org.fog.utils.FogEvents;
import org.fog.utils.NetworkUsageMonitor;
import org.fog.utils.TimeKeeper;

/** Captures iFogSim metrics without the upstream Controller's System.exit call. */
final class MetricsController extends Controller {
    private final String scenario;
    private final List<FogDevice> devices;
    private final Application application;
    private final long wallClockStartNanos;
    private final java.util.function.Supplier<java.util.Map<String, Object>> workloadProfileSupplier;
    private SimulationResult result;

    MetricsController(String name, List<FogDevice> devices, List<Sensor> sensors, Application application,
            String scenario, long wallClockStartNanos,
            java.util.function.Supplier<java.util.Map<String, Object>> workloadProfileSupplier) {
        super(name, devices, sensors, java.util.Collections.emptyList());
        this.devices = devices;
        this.application = application;
        this.scenario = scenario;
        this.wallClockStartNanos = wallClockStartNanos;
        this.workloadProfileSupplier = workloadProfileSupplier;
    }

    @Override
    public void processEvent(SimEvent event) {
        if (event.getTag() != FogEvents.STOP_SIMULATION) {
            super.processEvent(event);
            return;
        }

        double simulatedTime = CloudSim.clock();
        double energyJoules = devices.stream().mapToDouble(FogDevice::getEnergyConsumption).sum();
        double nativeNetworkIndex = NetworkUsageMonitor.getNetworkUsage() / Config.MAX_SIMULATION_TIME;
        Double applicationLoopLatencyMs = EdgeVisionSimulation.activeMultiProfile == null ? getLoopLatency(0)
                : EdgeVisionSimulation.activeMultiProfile.loopLatency();
        Double analyticsLatencyMs = SimulationTelemetry.getAnalyticsLatencyAverage();
        double networkUsageMb = SimulationTelemetry.getNetworkBytes() / 1_000_000.0;
        long wallClockMillis = (System.nanoTime() - wallClockStartNanos) / 1_000_000L;
        result = new SimulationResult(scenario, applicationLoopLatencyMs, analyticsLatencyMs, networkUsageMb,
                nativeNetworkIndex, energyJoules, simulatedTime,
                SimulationTelemetry.getStoredResults(), wallClockMillis,
                workloadProfileSupplier.get());

        // The stock Controller calls System.exit here. Schedule CloudSim's supported timed
        // termination just after this event so the caller can receive the collected result.
        CloudSim.terminateSimulation(CloudSim.clock() + CloudSim.getMinTimeBetweenEvents());
    }

    private Double getLoopLatency(int index) {
        if (application.getLoops().size() <= index) return null;
        int loopId = application.getLoops().get(index).getLoopId();
        Integer completed = TimeKeeper.getInstance().getLoopIdToCurrentNum().get(loopId);
        if (completed == null || completed == 0) return null;
        return TimeKeeper.getInstance().getLoopIdToCurrentAverage().get(loopId);
    }

    SimulationResult getResult() {
        if (result == null) throw new IllegalStateException("Simulation ended without a metrics result.");
        return result;
    }
}
