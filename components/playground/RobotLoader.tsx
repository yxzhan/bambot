"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  Suspense,
} from "react";
import { degreesToRadians } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import { robotConfigMap } from "@/config/robotConfig";
import * as THREE from "three";
import { Html, useProgress } from "@react-three/drei";
import { ControlPanel } from "./keyboardControl/KeyboardControl";
import { useRobotControl } from "@/hooks/useRobotControl";
import { useROS2 } from "@/hooks/useROS2";
import { Canvas } from "@react-three/fiber";
import { ChatControl } from "./chatControl/ChatControl";
import LeaderControl from "../playground/leaderControl/LeaderControl";
import { useLeaderRobotControl } from "@/hooks/useLeaderRobotControl";
import { RobotScene } from "./RobotScene";
import KeyboardControlButton from "../playground/controlButtons/KeyboardControlButton";
import ChatControlButton from "../playground/controlButtons/ChatControlButton";
import LeaderControlButton from "../playground/controlButtons/LeaderControlButton";
import RecordButton from "./controlButtons/RecordButton";
import WebcamButton from "./controlButtons/WebcamButton";
import RecordControl from "./recordControl/RecordControl";
import { CameraPanel } from "./cameraControl/CameraPanel";
import ROS2Button from "./ros2Control/ROS2Button";
import { ROS2Panel } from "./ros2Control/ROS2Panel";
import HandControlButton from "./controlButtons/HandControlButton";
import { HandControl } from "./handControl/HandControl";
import { HandMarker } from "./handControl/HandMarker";
import { useHandLandmarker } from "@/hooks/useHandLandmarker";
import { useHandTeleop } from "@/hooks/useHandTeleop";
import { useHandCalibration } from "@/hooks/useHandCalibration";
import {
  DEFAULT_HAND_CONTROL_SETTINGS,
  HandControlSettings,
} from "@/config/handControlConfig";
import {
  clearHandSettingsFromLocalStorage,
  getHandSettingsFromLocalStorage,
  setHandSettingsToLocalStorage,
} from "@/lib/handSettings";
import VRControlButton from "./controlButtons/VRControlButton";
import { VRControl } from "./vrControl/VRControl";
import { VRTeleop } from "./vrControl/VRTeleop";
import { useVRSession } from "@/hooks/useVRSession";
import type { VRTeleopStatus } from "@/hooks/useVRTeleop";
import { VRControlSettings } from "@/config/vrControlConfig";
import {
  clearVRSettingsFromLocalStorage,
  getVRSettingsFromLocalStorage,
  setVRSettingsToLocalStorage,
} from "@/lib/vrSettings";
import type { URDFRobot } from "urdf-loader";
import {
  getPanelStateFromLocalStorage,
  setPanelStateToLocalStorage,
} from "@/lib/panelSettings";

export type JointDetails = {
  name: string;
  servoId: number;
  limit: {
    lower?: number;
    upper?: number;
  };
  jointType: "revolute" | "continuous";
};

type RobotLoaderProps = {
  robotName: string;
};

function Loader() {
  const { progress } = useProgress();
  return (
    <Html center className="text-4xl text-white">
      {progress} % loaded
    </Html>
  );
}

export default function RobotLoader({ robotName }: RobotLoaderProps) {
  const searchParams = useSearchParams();
  const ros2WsUrl = searchParams.get("ros2ws") ?? "ws://localhost:9090";

  const [jointDetails, setJointDetails] = useState<JointDetails[]>([]);
  const [showControlPanel, setShowControlPanel] = useState(() => {
    const stored = getPanelStateFromLocalStorage("keyboardControl", robotName);
    return stored !== null ? stored : window.innerWidth >= 900;
  });
  const [showLeaderControl, setShowLeaderControl] = useState(() => {
    return getPanelStateFromLocalStorage("leaderControl", robotName) ?? false;
  });
  const [showChatControl, setShowChatControl] = useState(() => {
    return getPanelStateFromLocalStorage("chatControl", robotName) ?? false;
  });
  const [showRecordControl, setShowRecordControl] = useState(() => {
    return getPanelStateFromLocalStorage("recordControl", robotName) ?? false;
  });
  const [showWebcamPanel, setShowWebcamPanel] = useState(() => {
    return getPanelStateFromLocalStorage("webcamPanel", robotName) ?? false;
  });
  const [showROS2Panel, setShowROS2Panel] = useState(() => {
    return getPanelStateFromLocalStorage("ros2Panel", robotName) ?? false;
  });
  const [showHandControl, setShowHandControl] = useState(() => {
    return getPanelStateFromLocalStorage("handControl", robotName) ?? false;
  });
  const [showVRControl, setShowVRControl] = useState(() => {
    return getPanelStateFromLocalStorage("vrControl", robotName) ?? false;
  });
  // The camera only starts once the operator opts in, and stops again as soon
  // as the panel is closed.
  const [handCameraEnabled, setHandCameraEnabled] = useState(false);
  const [rosControlEnabled, setRosControlEnabled] = useState(false);
  const config = robotConfigMap[robotName];

  const handDefaults: HandControlSettings = useMemo(
    () => ({
      ...DEFAULT_HAND_CONTROL_SETTINGS,
      ...(robotConfigMap[robotName]?.handControl ?? {}),
    }),
    [robotName]
  );
  const [handSettings, setHandSettings] = useState<HandControlSettings>(() =>
    getHandSettingsFromLocalStorage(robotName, {
      ...DEFAULT_HAND_CONTROL_SETTINGS,
      ...(robotConfigMap[robotName]?.handControl ?? {}),
    })
  );
  const robotRef = useRef<URDFRobot | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const [vrSettings, setVRSettings] = useState<VRControlSettings>(() =>
    getVRSettingsFromLocalStorage(robotName)
  );
  const [vrStatus, setVRStatus] = useState<VRTeleopStatus>({
    phase: "off",
    activeHand: null,
    controllers: [],
    posError: 0,
    gripperOpenness: 1,
    gripperFollowing: false,
  });
  const vrSession = useVRSession(glRef);

  const {
    status: ros2Status,
    error: ros2Error,
    jointState: ros2JointState,
    connect: connectROS2,
    disconnect: disconnectROS2,
    publishJointState,
  } = useROS2({ subscribeEnabled: rosControlEnabled });

  // Get leader robot servo IDs (exclude continuous joint types)
  const leaderServoIds = jointDetails
    .filter((j) => j.jointType !== "continuous")
    .map((j) => j.servoId);

  // Initialize leader robot control hook
  const leaderControl = useLeaderRobotControl(leaderServoIds);

  if (!config) {
    throw new Error(`Robot configuration for "${robotName}" not found.`);
  }

  const {
    urdfUrl,
    orbitTarget,
    camera,
    keyboardControlMap,
    compoundMovements,
    systemPrompt,
    urdfInitJointAngles,
  } = config;

  const {
    isConnected,
    connectRobot,
    disconnectRobot,
    jointStates,
    updateJointSpeed,
    setJointDetails: updateJointDetails,
    updateJointDegrees,
    updateJointsDegrees,
    updateJointsSpeed,
    isRecording,
    recordData,
    startRecording,
    stopRecording,
    clearRecordData,
  } = useRobotControl(jointDetails, urdfInitJointAngles);

  useEffect(() => {
    updateJointDetails(jointDetails);
  }, [jointDetails, updateJointDetails]);

  // --- Webcam hand control ------------------------------------------------
  const handTrackingEnabled = showHandControl && handCameraEnabled;

  const handleRobotLoaded = useCallback((robot: URDFRobot) => {
    robotRef.current = robot;
  }, []);

  const updateHandSettings = useCallback(
    (next: HandControlSettings) => {
      setHandSettings(next);
      setHandSettingsToLocalStorage(robotName, next);
    },
    [robotName]
  );

  const resetHandSettings = useCallback(() => {
    setHandSettings(handDefaults);
    clearHandSettingsFromLocalStorage(robotName);
  }, [robotName, handDefaults]);

  // Set by the calibration wizard; the teleop loop reads it to stand down while
  // the operator is being measured.
  const calibrationActiveRef = useRef(false);

  const handLandmarker = useHandLandmarker(handTrackingEnabled);
  const handTeleop = useHandTeleop({
    enabled: handTrackingEnabled,
    robotRef,
    handPoseRef: handLandmarker.handPoseRef,
    settings: handSettings,
    ikConfig: config.ik,
    jointDetails,
    updateJointsDegrees,
    pausedRef: calibrationActiveRef,
    onOrientationCalibrated: (offset) =>
      updateHandSettings({ ...handSettings, orientationOffset: offset }),
  });
  const handCalibration = useHandCalibration({
    enabled: handTrackingEnabled,
    handPoseRef: handLandmarker.handPoseRef,
    gripperRef: handTeleop.gripperRef,
    settings: handSettings,
    activeRef: calibrationActiveRef,
    onComplete: (patch) =>
      updateHandSettings({ ...handSettings, ...patch }),
  });

  // --- VR controller control ------------------------------------------------
  const updateVRSettings = useCallback(
    (next: VRControlSettings) => {
      setVRSettings(next);
      setVRSettingsToLocalStorage(robotName, next);
    },
    [robotName]
  );

  const resetVRSettings = useCallback(() => {
    clearVRSettingsFromLocalStorage(robotName);
    setVRSettings(getVRSettingsFromLocalStorage(robotName));
  }, [robotName]);

  const lastRosPositionRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!rosControlEnabled || !ros2JointState || jointDetails.length === 0) return;
    if (ros2JointState.name.length === 0 || ros2JointState.position.length === 0) return;

    const updates: { servoId: number; value: number }[] = [];

    for (const joint of jointDetails) {
      if (joint.jointType !== "revolute") continue;

      const rosIndex = ros2JointState.name.indexOf(joint.name);
      if (rosIndex === -1) continue;

      const radians = ros2JointState.position[rosIndex];
      const lastPos = lastRosPositionRef.current[joint.name] ?? 0;
      if (Math.abs(radians - lastPos) < 0.001) continue;

      lastRosPositionRef.current[joint.name] = radians;

      const degrees = radians * (180 / Math.PI);
      updates.push({ servoId: joint.servoId, value: degrees });
    }

    if (updates.length > 0) {
      updateJointsDegrees(updates);
    }
  }, [ros2JointState, rosControlEnabled, jointDetails, updateJointsDegrees]);

  // Keep a ref to the latest jointStates so the broadcast interval
  // doesn't restart on every state change (which would stall it during key holds).
  const jointStatesRef = useRef(jointStates);
  jointStatesRef.current = jointStates;

  // Broadcast follower joint state to ROS at ~30Hz
  useEffect(() => {
    if (ros2Status !== "connected" || jointDetails.length === 0) return;
    const timer = setInterval(() => {
      const names: string[] = [];
      const positions: number[] = [];
      for (const js of jointStatesRef.current) {
        if (typeof js.degrees === "number") {
          names.push(js.name);
          positions.push(degreesToRadians(js.degrees));
        }
      }
      if (names.length > 0) {
        publishJointState({ topicName: "/joint_states", jointNames: names, positions });
      }
    }, 33);
    return () => clearInterval(timer);
  }, [ros2Status, jointDetails.length, publishJointState]);

  // Functions to handle panel state changes and localStorage updates
  const toggleControlPanel = () => {
    setShowControlPanel((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("keyboardControl", newState, robotName);
      return newState;
    });
  };

  const toggleLeaderControl = () => {
    setShowLeaderControl((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("leaderControl", newState, robotName);
      return newState;
    });
  };

  const toggleChatControl = () => {
    setShowChatControl((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("chatControl", newState, robotName);
      return newState;
    });
  };

  const toggleRecordControl = () => {
    setShowRecordControl((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("recordControl", newState, robotName);
      return newState;
    });
  };

  const toggleWebcamPanel = () => {
    setShowWebcamPanel((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("webcamPanel", newState, robotName);
      return newState;
    });
  };

  const hideControlPanel = () => {
    setShowControlPanel(false);
    setPanelStateToLocalStorage("keyboardControl", false, robotName);
  };

  const hideLeaderControl = () => {
    setShowLeaderControl(false);
    setPanelStateToLocalStorage("leaderControl", false, robotName);
  };

  const hideChatControl = () => {
    setShowChatControl(false);
    setPanelStateToLocalStorage("chatControl", false, robotName);
  };

  const hideRecordControl = () => {
    setShowRecordControl(false);
    setPanelStateToLocalStorage("recordControl", false, robotName);
  };

  const hideWebcamPanel = () => {
    setShowWebcamPanel(false);
    setPanelStateToLocalStorage("webcamPanel", false, robotName);
  };

  const toggleROS2Panel = () => {
    setShowROS2Panel((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("ros2Panel", newState, robotName);
      if (newState) {
        connectROS2(ros2WsUrl);
      } else {
        disconnectROS2();
      }
      return newState;
    });
  };

  const toggleHandControl = () => {
    setShowHandControl((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("handControl", newState, robotName);
      return newState;
    });
  };

  const hideHandControl = () => {
    setShowHandControl(false);
    setPanelStateToLocalStorage("handControl", false, robotName);
  };

  const toggleVRControl = () => {
    setShowVRControl((prev) => {
      const newState = !prev;
      setPanelStateToLocalStorage("vrControl", newState, robotName);
      return newState;
    });
  };

  const hideVRControl = () => {
    setShowVRControl(false);
    setPanelStateToLocalStorage("vrControl", false, robotName);
  };

  const hideROS2Panel = () => {
    setShowROS2Panel(false);
    setPanelStateToLocalStorage("ros2Panel", false, robotName);
    disconnectROS2();
  };

  return (
    <>
      <Canvas
        shadows
        camera={{
          position: camera.position,
          fov: camera.fov,
        }}
        onCreated={({ scene, gl }) => {
          scene.background = new THREE.Color(0x263238);
          glRef.current = gl;
        }}
      >
        <Suspense fallback={<Loader />}>
          <RobotScene
            robotName={robotName}
            urdfUrl={urdfUrl}
            orbitTarget={orbitTarget}
            setJointDetails={setJointDetails}
            jointStates={jointStates}
            onRobotLoaded={handleRobotLoaded}
            showGround={vrSession.activeMode !== "immersive-ar"}
          >
            <HandMarker markerRef={handTeleop.markerRef} />
            <VRTeleop
              robotRef={robotRef}
              settings={vrSettings}
              ikConfig={config.ik}
              jointDetails={jointDetails}
              updateJointsDegrees={updateJointsDegrees}
              onStatus={setVRStatus}
            />
          </RobotScene>
        </Suspense>
      </Canvas>

      <ControlPanel
        show={showControlPanel}
        onHide={hideControlPanel}
        updateJointsSpeed={updateJointsSpeed}
        jointStates={jointStates}
        updateJointDegrees={updateJointDegrees}
        updateJointsDegrees={updateJointsDegrees}
        updateJointSpeed={updateJointSpeed}
        isConnected={isConnected}
        connectRobot={connectRobot}
        disconnectRobot={disconnectRobot}
        keyboardControlMap={keyboardControlMap}
        compoundMovements={compoundMovements}
      />
      <ChatControl
        show={showChatControl}
        onHide={hideChatControl}
        robotName={robotName}
        systemPrompt={systemPrompt}
      />
      {/* LeaderControl overlay */}
      <LeaderControl
        show={showLeaderControl}
        onHide={hideLeaderControl}
        leaderControl={leaderControl}
        jointDetails={jointDetails}
        onSync={(leaderAngles: { servoId: number; angle: number }[]) => {
          const revoluteJoints = jointDetails.filter(
            (j) => j.jointType === "revolute"
          );
          const revoluteServoIds = new Set(
            revoluteJoints.map((j) => j.servoId)
          );
          updateJointsDegrees(
            leaderAngles
              .filter((la) => revoluteServoIds.has(la.servoId))
              .map(
                ({ servoId, angle }: { servoId: number; angle: number }) => ({
                  servoId,
                  value: angle,
                })
              )
          );
        }}
      />

      {/* Record Control overlay */}
      <RecordControl
        show={showRecordControl}
        onHide={hideRecordControl}
        isRecording={isRecording}
        recordData={recordData}
        startRecording={startRecording}
        stopRecording={stopRecording}
        clearRecordData={clearRecordData}
        updateJointsDegrees={updateJointsDegrees}
        updateJointsSpeed={updateJointsSpeed}
        jointDetails={jointDetails}
        leaderControl={{
          isConnected: leaderControl.isConnected,
          disconnectLeader: leaderControl.disconnectLeader,
        }}
      />

      {/* Camera Panel overlay */}
      <CameraPanel
        show={showWebcamPanel}
        onHide={hideWebcamPanel}
      />

      {/* Hand Control overlay */}
      <HandControl
        show={showHandControl}
        onHide={hideHandControl}
        enabled={handCameraEnabled}
        onEnabledChange={setHandCameraEnabled}
        landmarker={handLandmarker}
        teleop={handTeleop}
        calibration={handCalibration}
        settings={handSettings}
        onSettingsChange={updateHandSettings}
        onResetSettings={resetHandSettings}
      />

      {/* VR Control overlay */}
      <VRControl
        show={showVRControl}
        onHide={hideVRControl}
        session={vrSession}
        status={vrStatus}
        settings={vrSettings}
        onSettingsChange={updateVRSettings}
        onResetSettings={resetVRSettings}
      />

      {/* ROS 2 Panel overlay */}
      <ROS2Panel
        show={showROS2Panel}
        onHide={hideROS2Panel}
        status={ros2Status}
        error={ros2Error}
        jointState={ros2JointState}
        onConnect={connectROS2}
        onDisconnect={disconnectROS2}
        rosControlEnabled={rosControlEnabled}
        onRosControlToggle={() => setRosControlEnabled((prev) => !prev)}
        defaultUrl={ros2WsUrl}
      />

      <div className="absolute bottom-5 left-0 right-0">
        <div className="flex justify-center items-center">
          <div className="flex gap-2 max-w-md">
            <LeaderControlButton
              showControlPanel={showLeaderControl}
              onToggleControlPanel={toggleLeaderControl}
            />
            <KeyboardControlButton
              showControlPanel={showControlPanel}
              onToggleControlPanel={toggleControlPanel}
            />
            <ChatControlButton
              showControlPanel={showChatControl}
              onToggleControlPanel={toggleChatControl}
            />
            <RecordButton
              showControlPanel={showRecordControl}
              onToggleControlPanel={toggleRecordControl}
            />
            <WebcamButton
              showControlPanel={showWebcamPanel}
              onToggleControlPanel={toggleWebcamPanel}
            />
            <HandControlButton
              showControlPanel={showHandControl}
              onToggleControlPanel={toggleHandControl}
            />
            <VRControlButton
              showControlPanel={showVRControl}
              onToggleControlPanel={toggleVRControl}
            />
            <ROS2Button
              showControlPanel={showROS2Panel}
              onToggleControlPanel={toggleROS2Panel}
            />
          </div>
        </div>
      </div>
    </>
  );
}
