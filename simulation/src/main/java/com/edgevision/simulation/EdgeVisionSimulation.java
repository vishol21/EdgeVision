package com.edgevision.simulation;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.LinkedList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;

import org.cloudbus.cloudsim.Host;
import org.cloudbus.cloudsim.Log;
import org.cloudbus.cloudsim.Pe;
import org.cloudbus.cloudsim.Storage;
import org.cloudbus.cloudsim.core.CloudSim;
import org.cloudbus.cloudsim.power.PowerHost;
import org.cloudbus.cloudsim.provisioners.RamProvisionerSimple;
import org.cloudbus.cloudsim.sdn.overbooking.BwProvisionerOverbooking;
import org.cloudbus.cloudsim.sdn.overbooking.PeProvisionerOverbooking;
import org.fog.application.AppEdge;
import org.fog.application.AppLoop;
import org.fog.application.Application;
import org.fog.application.selectivity.FractionalSelectivity;
import org.fog.entities.FogBroker;
import org.fog.entities.FogDevice;
import org.fog.entities.FogDeviceCharacteristics;
import org.fog.entities.Sensor;
import org.fog.entities.Tuple;
import org.fog.placement.ModuleMapping;
import org.fog.placement.ModulePlacementMapping;
import org.fog.policy.AppModuleAllocationPolicy;
import org.fog.scheduler.StreamOperatorScheduler;
import org.fog.utils.FogLinearPowerModel;
import org.fog.utils.FogEvents;
import org.fog.utils.FogUtils;
import org.fog.utils.distribution.DeterministicDistribution;

/** Runs one EdgeVision placement scenario in a fresh JVM. */
public final class EdgeVisionSimulation {
    private static final String APP_ID = "edgevision";
    private static final String VIDEO_ANALYZER = "Video_Analyzer";
    private static final String EVENT_DETECTOR = "Event_Detector";
    private static final String CLOUD_RESULT_STORAGE = "Cloud_Result_Storage";

    // Workload/topology choices for this project model; they are not claimed as paper values.
    private static final int DEFAULT_VIRTUAL_CAMERA_COUNT = 5;
    private static final int MIN_VIRTUAL_CAMERA_COUNT = 1;
    private static final int MAX_VIRTUAL_CAMERA_COUNT = 10;
    private static final double CAMERA_INTERVAL_SECONDS = 0.1;
    private static final int STANDALONE_WORKLOAD_DURATION_SECONDS = 15;
    private static final double SENSOR_TO_EDGE_LATENCY = 1.0;
    private static final double EDGE_TO_CLOUD_LATENCY = 100.0;
    private static final long CAMERA_FRAME_BYTES = 20_000;
    private static final long ANALYZED_FRAME_BYTES = 2_000;
    private static final long EVENT_RECORD_BYTES = 500;
    private static final int SIMULATION_HORIZON = 2_000;

    private EdgeVisionSimulation() { }
    static MultiVideoWorkloadProfile activeMultiProfile;

    public static void main(String[] args) throws Exception {
        if ((args.length < 1 || args.length > 3)
                || !(args[0].equalsIgnoreCase("cloud") || args[0].equalsIgnoreCase("edge"))) {
            throw new IllegalArgumentException("Usage: EdgeVisionSimulation <cloud|edge> [camera-count [workload-profile-id]|workload-profile.json]");
        }
        String scenario = args[0].toLowerCase();
        VideoWorkloadProfile workloadProfile = null;
        activeMultiProfile = null;
        int virtualCameraCount = DEFAULT_VIRTUAL_CAMERA_COUNT;
        String standaloneWorkloadProfileId = null;
        if (args.length >= 2) {
            if (args[1].matches("[0-9]+")) {
                virtualCameraCount = Integer.parseInt(args[1]);
                if (virtualCameraCount < MIN_VIRTUAL_CAMERA_COUNT || virtualCameraCount > MAX_VIRTUAL_CAMERA_COUNT) {
                    throw new IllegalArgumentException("Virtual camera count must be between 1 and 10.");
                }
                if (args.length == 3) {
                    if (!args[2].matches("[a-f0-9]{32}")) {
                        throw new IllegalArgumentException("Standalone workload profile ID must be 32 lowercase hexadecimal characters.");
                    }
                    standaloneWorkloadProfileId = args[2];
                }
            } else {
                if (args.length == 3) {
                    throw new IllegalArgumentException("A workload profile file cannot be combined with a standalone workload profile ID.");
                }
                java.nio.file.Path profilePath = java.nio.file.Path.of(args[1]);
                org.json.simple.JSONObject profileRoot = MultiVideoWorkloadProfile.readRoot(profilePath);
                if ("multi_video".equals(profileRoot.get("profileType"))) activeMultiProfile = new MultiVideoWorkloadProfile(profileRoot);
                else workloadProfile = VideoWorkloadProfile.read(profilePath);
            }
        }
        if (workloadProfile == null && activeMultiProfile == null && standaloneWorkloadProfileId == null) {
            standaloneWorkloadProfileId = java.util.UUID.randomUUID().toString().replace("-", "");
        }
        SimulationTelemetry.reset();
        org.fog.utils.Config.MAX_SIMULATION_TIME = activeMultiProfile != null ? activeMultiProfile.simulationHorizon()
                : workloadProfile == null ? SIMULATION_HORIZON : workloadProfile.simulationHorizon();

        Log.disable();
        CloudSim.init(1, Calendar.getInstance(), false);
        FogBroker broker = new FogBroker("edgevision-broker");
        List<FogDevice> devices = createTopology();
        Application application = activeMultiProfile == null ? createApplication(broker.getId(), workloadProfile)
                : createMultiApplication(broker.getId(), activeMultiProfile);
        application.setUserId(broker.getId());
        List<Sensor> sensors = activeMultiProfile != null ? createMultiSources(broker.getId(), devices, activeMultiProfile) : workloadProfile == null
                ? createVirtualCameraSources(broker.getId(), devices, virtualCameraCount)
                : createProfileCameras(broker.getId(), devices, workloadProfile);
        ModuleMapping mapping = createModuleMapping(scenario);

        long wallClockStartNanos = System.nanoTime();
        final int configuredCameraCount = virtualCameraCount;
        final String configuredWorkloadProfileId = standaloneWorkloadProfileId;
        MetricsController controller = new MetricsController("edgevision-controller", devices,
                sensors, application, scenario, wallClockStartNanos,
                activeMultiProfile != null ? activeMultiProfile::resultMetadata : workloadProfile == null
                        ? () -> standaloneWorkloadMetadata(configuredCameraCount, configuredWorkloadProfileId)
                        : workloadProfile::resultMetadata);
        controller.submitApplication(application,
                new ModulePlacementMapping(devices, application, mapping));

        CloudSim.startSimulation();
        System.out.println("RESULT_JSON:" + controller.getResult().toJson());
    }

    private static List<FogDevice> createTopology() throws Exception {
        List<FogDevice> devices = new ArrayList<>();
        MeteredFogDevice cloud = createDevice("cloud", 44_800, 40_000,
                10_000, 10_000, 0, 16 * 103.0, 16 * 83.25);
        cloud.setParentId(-1);
        devices.add(cloud);

        MeteredFogDevice edge01 = createDevice("edge-01", 2_800, 4_000,
                10_000, 10_000, 1, 107.339, 83.4333);
        edge01.setParentId(cloud.getId());
        edge01.setUplinkLatency(EDGE_TO_CLOUD_LATENCY);
        devices.add(edge01);

        MeteredFogDevice edge02 = createDevice("edge-02", 2_800, 4_000,
                10_000, 10_000, 1, 107.339, 83.4333);
        edge02.setParentId(cloud.getId());
        edge02.setUplinkLatency(EDGE_TO_CLOUD_LATENCY);
        devices.add(edge02);
        return devices;
    }

    private static MeteredFogDevice createDevice(String name, long mips, int ram,
            long uplinkBandwidth, long downlinkBandwidth, int level,
            double busyPower, double idlePower) throws Exception {
        List<Pe> processingElements = new ArrayList<>();
        processingElements.add(new Pe(0, new PeProvisionerOverbooking(mips)));
        int hostId = FogUtils.generateEntityId();
        int bandwidth = 10_000;
        long storage = 1_000_000;
        PowerHost host = new PowerHost(hostId,
                new RamProvisionerSimple(ram),
                new BwProvisionerOverbooking(bandwidth), storage,
                processingElements, new StreamOperatorScheduler(processingElements),
                new FogLinearPowerModel(busyPower, idlePower));
        List<Host> hosts = new ArrayList<>();
        hosts.add(host);
        FogDeviceCharacteristics characteristics = new FogDeviceCharacteristics(
                "x86", "Linux", "Xen", host, 10.0, 3.0, 0.05, 0.001, 0.0);
        MeteredFogDevice device = new MeteredFogDevice(name, characteristics,
                new AppModuleAllocationPolicy(hosts), new LinkedList<Storage>(),
                10, uplinkBandwidth, downlinkBandwidth, 0, 0.01);
        device.setLevel(level);
        return device;
    }

    private static List<Sensor> createVirtualCameraSources(int userId, List<FogDevice> devices, int cameraCount) {
        List<Sensor> sensors = new ArrayList<>();
        long tuplesPerCamera = Math.round(STANDALONE_WORKLOAD_DURATION_SECONDS / CAMERA_INTERVAL_SECONDS);
        for (int cameraIndex = 0; cameraIndex < cameraCount; cameraIndex++) {
            int gatewayId = devices.get(cameraIndex % 2 + 1).getId();
            sensors.add(new FiniteCameraSensor("virtual-camera-%02d".formatted(cameraIndex + 1),
                    userId, APP_ID, gatewayId, cameraIndex, cameraCount, tuplesPerCamera));
        }
        return sensors;
    }

    private static Map<String, Object> standaloneWorkloadMetadata(int cameraCount, String workloadProfileId) {
        long tuplesPerCamera = Math.round(STANDALONE_WORKLOAD_DURATION_SECONDS / CAMERA_INTERVAL_SECONDS);
        List<String> sourceIds = new ArrayList<>();
        for (int cameraIndex = 0; cameraIndex < cameraCount; cameraIndex++) {
            sourceIds.add("virtual-camera-%02d".formatted(cameraIndex + 1));
        }
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("type", "standalone_virtual_camera");
        metadata.put("workloadProfileId", workloadProfileId);
        metadata.put("virtualCameraSources", cameraCount);
        metadata.put("sourceIds", sourceIds);
        metadata.put("durationSeconds", STANDALONE_WORKLOAD_DURATION_SECONDS);
        metadata.put("tupleIntervalMs", Math.round(CAMERA_INTERVAL_SECONDS * 1_000));
        metadata.put("tuplesPerCamera", tuplesPerCamera);
        metadata.put("tupleCount", tuplesPerCamera * cameraCount);
        return metadata;
    }

    private static List<Sensor> createProfileCameras(int userId, List<FogDevice> devices,
            VideoWorkloadProfile profile) {
        List<Sensor> sensors = new ArrayList<>();
        long base = profile.tupleCount / profile.virtualCameraSources;
        long extra = profile.tupleCount % profile.virtualCameraSources;
        for (int cameraIndex = 0; cameraIndex < profile.virtualCameraSources; cameraIndex++) {
            long cameraTupleCount = base + (cameraIndex < extra ? 1 : 0);
            int edgeIndex = cameraIndex % 2;
            int gatewayId = devices.get(edgeIndex + 1).getId();
            sensors.add(new FiniteProfileSensor("profile-camera-%03d".formatted(cameraIndex + 1),
                    userId, APP_ID, gatewayId, profile.tupleIntervalSeconds,
                    profile.virtualCameraSources, cameraIndex, cameraTupleCount));
        }
        return sensors;
    }

    private static Application createApplication(int userId, VideoWorkloadProfile profile) {
        Application application = Application.createApplication(APP_ID, userId);
        application.addAppModule(VIDEO_ANALYZER, 512);
        application.addAppModule(EVENT_DETECTOR, 512);
        application.addAppModule(CLOUD_RESULT_STORAGE, 512);

        long analyzerMi = profile == null ? 1_000L : profile.analyzerMiPerTuple();
        long eventDetectorMi = profile == null ? 2_000L : profile.eventDetectorMiPerTuple();
        long cameraPayloadBytes = profile == null ? CAMERA_FRAME_BYTES : profile.cameraPayloadBytes();
        application.addAppEdge("CAMERA", VIDEO_ANALYZER, analyzerMi, cameraPayloadBytes,
                "CAMERA", Tuple.UP, AppEdge.SENSOR);
        application.addAppEdge(VIDEO_ANALYZER, EVENT_DETECTOR, eventDetectorMi,
                ANALYZED_FRAME_BYTES, "ANALYZED_FRAME", Tuple.UP, AppEdge.MODULE);
        application.addAppEdge(EVENT_DETECTOR, CLOUD_RESULT_STORAGE, 500,
                EVENT_RECORD_BYTES, "EVENT_RECORD", Tuple.UP, AppEdge.MODULE);

        // Selectivity 1.0 makes every modeled frame produce one derived record.
        // This is tuple processing, not visual detection of a real event.
        application.addTupleMapping(VIDEO_ANALYZER, "CAMERA", "ANALYZED_FRAME",
                new FractionalSelectivity(1.0));
        application.addTupleMapping(EVENT_DETECTOR, "ANALYZED_FRAME", "EVENT_RECORD",
                new FractionalSelectivity(1.0));
        application.setLoops(new ArrayList<>(Arrays.asList(new AppLoop(new ArrayList<>(Arrays.asList(
                "CAMERA", VIDEO_ANALYZER, EVENT_DETECTOR, CLOUD_RESULT_STORAGE))))));
        return application;
    }

    private static Application createMultiApplication(int userId, MultiVideoWorkloadProfile profile) {
        Application application = Application.createApplication(APP_ID, userId);
        application.addAppModule(VIDEO_ANALYZER, 512);
        application.addAppModule(EVENT_DETECTOR, 512);
        application.addAppModule(CLOUD_RESULT_STORAGE, 512);
        List<AppLoop> loops = new ArrayList<>();
        for (MultiVideoWorkloadProfile.Camera camera : profile.cameras) {
            VideoWorkloadProfile p = camera.profile();
            application.addAppEdge(camera.inputType(), VIDEO_ANALYZER, p.analyzerMiPerTuple(), p.cameraPayloadBytes(), camera.inputType(), Tuple.UP, AppEdge.SENSOR);
            application.addAppEdge(VIDEO_ANALYZER, EVENT_DETECTOR, p.eventDetectorMiPerTuple(), ANALYZED_FRAME_BYTES, camera.analyzedType(), Tuple.UP, AppEdge.MODULE);
            application.addAppEdge(EVENT_DETECTOR, CLOUD_RESULT_STORAGE, 500, EVENT_RECORD_BYTES, camera.resultType(), Tuple.UP, AppEdge.MODULE);
            application.addTupleMapping(VIDEO_ANALYZER, camera.inputType(), camera.analyzedType(), new FractionalSelectivity(1.0));
            application.addTupleMapping(EVENT_DETECTOR, camera.analyzedType(), camera.resultType(), new FractionalSelectivity(1.0));
            loops.add(new AppLoop(new ArrayList<>(Arrays.asList(camera.inputType(), VIDEO_ANALYZER, EVENT_DETECTOR, CLOUD_RESULT_STORAGE))));
        }
        application.setLoops(loops);
        return application;
    }

    private static List<Sensor> createMultiSources(int userId, List<FogDevice> devices, MultiVideoWorkloadProfile profile) {
        List<Sensor> sensors = new ArrayList<>();
        for (int i = 0; i < profile.cameras.size(); i++) {
            sensors.add(new MultiCameraSensor(userId, devices.get(i % 2 + 1).getId(), profile.cameras.get(i), profile));
        }
        return sensors;
    }

    private static final class MultiCameraSensor extends Sensor {
        private final MultiVideoWorkloadProfile.Camera camera;
        private final MultiVideoWorkloadProfile owner;
        private long remaining;
        MultiCameraSensor(int userId, int gatewayId, MultiVideoWorkloadProfile.Camera camera, MultiVideoWorkloadProfile owner) {
            super("recording-" + camera.cameraId(), camera.inputType(), userId, APP_ID,
                    new DeterministicDistribution(camera.profile().tupleIntervalSeconds));
            this.camera = camera;
            this.owner = owner;
            remaining = camera.profile().tupleCount;
            setGatewayDeviceId(gatewayId);
            setLatency(SENSOR_TO_EDGE_LATENCY);
        }
        @Override public void transmit() {
            super.transmit();
            SimulationTelemetry.addNetworkBytes(camera.profile().cameraPayloadBytes());
        }
        @Override protected int updateTimings(String source, String destination) {
            int id = super.updateTimings(source, destination);
            SimulationTelemetry.recordCameraEmission(id, CloudSim.clock());
            owner.emitted(camera.cameraId(), id, CloudSim.clock());
            return id;
        }
        @Override public void startEntity() {
            send(getGatewayDeviceId(), CloudSim.getMinTimeBetweenEvents(), FogEvents.SENSOR_JOINED, getGeoLocation());
            send(getId(), CloudSim.getMinTimeBetweenEvents(), FogEvents.EMIT_TUPLE);
        }
        @Override public void processEvent(org.cloudbus.cloudsim.core.SimEvent event) {
            if (event.getTag() == FogEvents.EMIT_TUPLE && remaining > 0) {
                transmit();
                if (--remaining > 0) send(getId(), camera.profile().tupleIntervalSeconds, FogEvents.EMIT_TUPLE);
            } else if (event.getTag() != FogEvents.TUPLE_ACK) {
                throw new IllegalStateException("Unexpected multi-camera sensor event.");
            }
        }
    }

    private static ModuleMapping createModuleMapping(String scenario) {
        ModuleMapping mapping = ModuleMapping.createModuleMapping();
        mapping.addModuleToDevice(CLOUD_RESULT_STORAGE, "cloud");
        if (scenario.equals("cloud")) {
            mapping.addModuleToDevice(VIDEO_ANALYZER, "cloud");
            mapping.addModuleToDevice(EVENT_DETECTOR, "cloud");
        } else {
            for (String edgeName : Arrays.asList("edge-01", "edge-02")) {
                mapping.addModuleToDevice(VIDEO_ANALYZER, edgeName);
                mapping.addModuleToDevice(EVENT_DETECTOR, edgeName);
            }
        }
        return mapping;
    }

    private static class MeteredSensor extends Sensor {
        MeteredSensor(String name, String tupleType, int userId, String appId,
                DeterministicDistribution distribution) {
            super(name, tupleType, userId, appId, distribution);
        }

        @Override
        public void transmit() {
            super.transmit();
            SimulationTelemetry.addNetworkBytes(CAMERA_FRAME_BYTES);
        }

        @Override
        protected int updateTimings(String source, String destination) {
            int tupleId = super.updateTimings(source, destination);
            SimulationTelemetry.recordCameraEmission(tupleId, CloudSim.clock());
            return tupleId;
        }
    }

    /** Emits exactly its assigned share of the profile's global, round-robin finite trace. */
    private static final class FiniteProfileSensor extends MeteredSensor {
        private final double intervalSeconds;
        private final int sourceCount;
        private final int sourceIndex;
        private long remainingEmissions;

        FiniteProfileSensor(String name, int userId, String appId, int gatewayId,
                double intervalSeconds, int sourceCount, int sourceIndex, long emissionCount) {
            super(name, "CAMERA", userId, appId,
                    new DeterministicDistribution(intervalSeconds * sourceCount));
            this.intervalSeconds = intervalSeconds;
            this.sourceCount = sourceCount;
            this.sourceIndex = sourceIndex;
            this.remainingEmissions = emissionCount;
            setGatewayDeviceId(gatewayId);
            setLatency(SENSOR_TO_EDGE_LATENCY);
        }

        @Override
        public void startEntity() {
            send(getGatewayDeviceId(), CloudSim.getMinTimeBetweenEvents(), FogEvents.SENSOR_JOINED,
                    getGeoLocation());
            if (remainingEmissions > 0) {
                double firstEmission = CloudSim.getMinTimeBetweenEvents()
                        + sourceIndex * intervalSeconds;
                send(getId(), firstEmission, FogEvents.EMIT_TUPLE);
            }
        }

        @Override
        public void processEvent(org.cloudbus.cloudsim.core.SimEvent event) {
            if (event.getTag() == FogEvents.EMIT_TUPLE) {
                if (remainingEmissions <= 0) return;
                transmit();
                remainingEmissions--;
                if (remainingEmissions > 0) {
                    send(getId(), intervalSeconds * sourceCount, FogEvents.EMIT_TUPLE);
                }
                return;
            }
            if (event.getTag() != FogEvents.TUPLE_ACK) {
                throw new IllegalStateException("Unexpected profile sensor event: " + event.getTag());
            }
        }
    }

    /** Emits one camera's 10 Hz input trace for the fixed 15-second standalone workload. */
    private static final class FiniteCameraSensor extends MeteredSensor {
        private final int cameraIndex;
        private final int cameraCount;
        private long remainingEmissions;

        FiniteCameraSensor(String name, int userId, String appId, int gatewayId,
                int cameraIndex, int cameraCount, long emissionCount) {
            super(name, "CAMERA", userId, appId, new DeterministicDistribution(CAMERA_INTERVAL_SECONDS));
            this.cameraIndex = cameraIndex;
            this.cameraCount = cameraCount;
            this.remainingEmissions = emissionCount;
            setGatewayDeviceId(gatewayId);
            setLatency(SENSOR_TO_EDGE_LATENCY);
        }

        @Override
        public void startEntity() {
            send(getGatewayDeviceId(), CloudSim.getMinTimeBetweenEvents(), FogEvents.SENSOR_JOINED,
                    getGeoLocation());
            if (remainingEmissions > 0) {
                double firstEmission = CloudSim.getMinTimeBetweenEvents()
                        + cameraIndex * CAMERA_INTERVAL_SECONDS / cameraCount;
                send(getId(), firstEmission, FogEvents.EMIT_TUPLE);
            }
        }

        @Override
        public void processEvent(org.cloudbus.cloudsim.core.SimEvent event) {
            if (event.getTag() == FogEvents.EMIT_TUPLE) {
                if (remainingEmissions <= 0) return;
                transmit();
                remainingEmissions--;
                if (remainingEmissions > 0) {
                    send(getId(), CAMERA_INTERVAL_SECONDS, FogEvents.EMIT_TUPLE);
                }
                return;
            }
            if (event.getTag() != FogEvents.TUPLE_ACK) {
                throw new IllegalStateException("Unexpected virtual camera event: " + event.getTag());
            }
        }
    }

    private static final class MeteredFogDevice extends FogDevice {
        MeteredFogDevice(String name, FogDeviceCharacteristics characteristics,
                AppModuleAllocationPolicy allocationPolicy, List<Storage> storage,
                double schedulingInterval, double uplinkBandwidth, double downlinkBandwidth,
                double uplinkLatency, double ratePerMips) throws Exception {
            super(name, characteristics, allocationPolicy, storage, schedulingInterval,
                    uplinkBandwidth, downlinkBandwidth, uplinkLatency, ratePerMips);
        }

        @Override
        protected void sendUpFreeLink(Tuple tuple) {
            SimulationTelemetry.addNetworkBytes(tuple.getCloudletFileSize());
            super.sendUpFreeLink(tuple);
        }

        @Override
        protected void sendDownFreeLink(Tuple tuple, int childId) {
            SimulationTelemetry.addNetworkBytes(tuple.getCloudletFileSize());
            super.sendDownFreeLink(tuple, childId);
        }

        @Override
        protected void processTupleArrival(org.cloudbus.cloudsim.core.SimEvent event) {
            Object payload = event.getData();
            if ("cloud".equals(getName()) && payload instanceof Tuple
                    && CLOUD_RESULT_STORAGE.equals(((Tuple) payload).getDestModuleName())) {
                SimulationTelemetry.recordStoredResult();
                if (activeMultiProfile != null) activeMultiProfile.arrived(((Tuple) payload).getActualTupleId());
            }
            if (payload instanceof Tuple && EVENT_DETECTOR.equals(((Tuple) payload).getDestModuleName())) {
                SimulationTelemetry.recordAnalyticsArrival(((Tuple) payload).getActualTupleId(), CloudSim.clock());
            }
            super.processTupleArrival(event);
        }
    }
}
