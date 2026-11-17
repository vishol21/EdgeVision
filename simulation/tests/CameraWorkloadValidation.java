package com.edgevision.simulation;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.cloudbus.cloudsim.Log;
import org.cloudbus.cloudsim.core.CloudSim;
import org.fog.entities.FogBroker;
import org.fog.entities.FogDevice;
import org.fog.entities.Sensor;
import org.json.simple.JSONObject;

/** Test-only inspection of instantiated sensors and captured simulation-clock emissions.
 * Run each invocation in a fresh JVM, as required by the production simulator. */
public final class CameraWorkloadValidation {
    private static final double INTERVAL = 0.1;
    private static final long PER_CAMERA = 150;
    private static final double TOLERANCE = 1e-7;

    public static void main(String[] args) throws Exception {
        if (args.length < 2) throw new IllegalArgumentException("Expected sources|cloud|edge and camera count.");
        int count = Integer.parseInt(args[1]);
        if (count < 1 || count > 10) throw new IllegalArgumentException("Camera count must be 1-10.");
        Map<String, Object> evidence = args[0].equals("sources")
                ? inspectSources(count) : inspectSimulation(args[0], count, args[2]);
        System.out.println("VALIDATION_JSON:" + JSONObject.toJSONString(evidence));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> inspectSources(int count) throws Exception {
        Log.disable();
        CloudSim.init(1, Calendar.getInstance(), false);
        FogBroker broker = new FogBroker("validation-broker");
        Method topologyFactory = EdgeVisionSimulation.class.getDeclaredMethod("createTopology");
        topologyFactory.setAccessible(true);
        List<FogDevice> devices = (List<FogDevice>) topologyFactory.invoke(null);
        Method sourceFactory = EdgeVisionSimulation.class.getDeclaredMethod(
                "createVirtualCameraSources", int.class, List.class, int.class);
        sourceFactory.setAccessible(true);
        List<Sensor> sensors = (List<Sensor>) sourceFactory.invoke(null, broker.getId(), devices, count);
        require(sensors.size() == count, "Actual sensor count differs from the request.");
        List<String> ids = new ArrayList<>();
        List<Map<String, Object>> sources = new ArrayList<>();
        for (int index = 0; index < sensors.size(); index++) {
            Sensor sensor = sensors.get(index);
            String expectedId = "virtual-camera-%02d".formatted(index + 1);
            require(sensor.getName().equals(expectedId), "Unexpected camera source ID.");
            require(sensor.getGatewayDeviceId() == devices.get(index % 2 + 1).getId(), "Wrong fog gateway.");
            double interval = sensor.getTransmitDistribution().getNextValue();
            require(Math.abs(interval - INTERVAL) < TOLERANCE, "Sensor interval is not 100 ms.");
            Field remaining = sensor.getClass().getDeclaredField("remainingEmissions");
            remaining.setAccessible(true);
            require(remaining.getLong(sensor) == PER_CAMERA, "Sensor is not configured for exactly 150 tuples.");
            ids.add(sensor.getName());
            Map<String, Object> source = new LinkedHashMap<>();
            source.put("sourceId", sensor.getName());
            source.put("gateway", devices.get(index % 2 + 1).getName());
            source.put("tupleIntervalSeconds", interval);
            source.put("finiteTupleCount", remaining.getLong(sensor));
            sources.add(source);
        }
        require(new HashSet<>(ids).size() == count, "Camera source IDs are not distinct.");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("cameraCount", count);
        result.put("actualSensorCount", sensors.size());
        result.put("sources", sources);
        return result;
    }

    private static Map<String, Object> inspectSimulation(String scenario, int count, String id) throws Exception {
        EdgeVisionSimulation.main(new String[] { scenario, Integer.toString(count), id });
        List<Double> times = new ArrayList<>(SimulationTelemetry.getCameraEmissionTimes());
        times.sort(Double::compare);
        long expected = count * PER_CAMERA;
        require(times.size() == expected, "Captured camera emission count differs from expected.");
        require(SimulationTelemetry.getCameraEmissions() == expected, "Emission counter differs from trace.");
        require(SimulationTelemetry.getStoredResults() == expected, "Not all camera tuples reached cloud storage.");
        double offset = CloudSim.getMinTimeBetweenEvents();
        double maximumError = 0;
        for (int slot = 0; slot < times.size(); slot++) {
            // Round-robin phases: each camera emits every 0.1 s, offset by index * 0.1 / count.
            double expectedTime = offset + (slot / count) * INTERVAL + (slot % count) * INTERVAL / count;
            maximumError = Math.max(maximumError, Math.abs(times.get(slot) - expectedTime));
        }
        require(maximumError < TOLERANCE, "Actual simulation-clock emissions differ from the finite 100 ms schedule.");
        List<Map<String, Object>> phases = new ArrayList<>();
        for (int camera = 0; camera < count; camera++) {
            double minGap = Double.POSITIVE_INFINITY;
            double maxGap = 0;
            for (int tuple = 1; tuple < PER_CAMERA; tuple++) {
                double gap = times.get(tuple * count + camera) - times.get((tuple - 1) * count + camera);
                minGap = Math.min(minGap, gap);
                maxGap = Math.max(maxGap, gap);
                require(Math.abs(gap - INTERVAL) < TOLERANCE, "A round-robin camera phase violates the 100 ms interval.");
            }
            Map<String, Object> phase = new LinkedHashMap<>();
            phase.put("phaseIndex", camera);
            phase.put("tupleCount", PER_CAMERA);
            phase.put("firstEmissionSeconds", times.get(camera));
            phase.put("lastEmissionSeconds", times.get((int) ((PER_CAMERA - 1) * count + camera)));
            phase.put("minimumIntervalSeconds", minGap);
            phase.put("maximumIntervalSeconds", maxGap);
            phases.add(phase);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("scenario", scenario);
        result.put("cameraCount", count);
        result.put("workloadProfileId", id);
        result.put("expectedTuples", expected);
        result.put("actualEmittedTuples", times.size());
        result.put("actualProcessedTuples", SimulationTelemetry.getStoredResults());
        result.put("simulationStartupOffsetSeconds", offset);
        result.put("workloadWindowSeconds", 15);
        result.put("firstEmissionSeconds", times.getFirst());
        result.put("lastEmissionSeconds", times.getLast());
        result.put("maximumScheduleErrorSeconds", maximumError);
        result.put("roundRobinPhases", phases);
        return result;
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
