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
import { useControlAuthority } from "@/hooks/useControlAuthority";
import { LeaderAngle, useLeaderSync } from "@/hooks/useLeaderSync";
import {
  getLeaderSettingsFromLocalStorage,
  LeaderSettings,
  setLeaderSettingsToLocalStorage,
} from "@/lib/leaderSettings";
import { ControlIndicator } from "./ControlBadge";
import { useROS2Bridge } from "@/hooks/useROS2Bridge";
import {
  getROS2SettingsFromLocalStorage,
  parseROS2Role,
  ROS2Settings,
  setROS2SettingsToLocalStorage,
} from "@/lib/ros2Settings";
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

/**
 * Webcam hand control is hidden for now - VR control replaced it. Its code is
 * kept; flip this to bring the button, panel and marker back.
 */
const HAND_CONTROL_ENABLED = false;

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
    if (!HAND_CONTROL_ENABLED) return false;
    return getPanelStateFromLocalStorage("handControl", robotName) ?? false;
  });
  const [showVRControl, setShowVRControl] = useState(() => {
    return getPanelStateFromLocalStorage("vrControl", robotName) ?? false;
  });
  // The camera only starts once the operator opts in, and stops again as soon
  // as the panel is closed.
  const [handCameraEnabled, setHandCameraEnabled] = useState(false);
  // ?ros2role=follower overrides the stored role, so a launcher can open the
  // page ready for its job.
  const [ros2Settings, setROS2Settings] = useState<ROS2Settings>(() => {
    const stored = getROS2SettingsFromLocalStorage();
    const role = parseROS2Role(searchParams.get("ros2role"));
    return role ? { ...stored, role } : stored;
  });
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

  const ros2 = useROS2();
  const {
    status: ros2Status,
    error: ros2Error,
    connect: connectROS2,
    disconnect: disconnectROS2,
  } = ros2;

  // Get leader robot servo IDs (exclude continuous joint types)
  const leaderServoIds = jointDetails
    .filter((j) => j.jointType !== "continuous")
    .map((j) => j.servoId);

  // Initialize leader robot control hook
  const leaderControl = useLeaderRobotControl(leaderServoIds);
  const [leaderSettings, setLeaderSettings] = useState<LeaderSettings>(() =>
    getLeaderSettingsFromLocalStorage()
  );
  const updateLeaderSettings = useCallback((next: LeaderSettings) => {
    setLeaderSettings(next);
    setLeaderSettingsToLocalStorage(next);
  }, []);

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
    acceleration,
    setAcceleration,
  } = useRobotControl(jointDetails, urdfInitJointAngles);

  useEffect(() => {
    updateJointDetails(jointDetails);
  }, [jointDetails, updateJointDetails]);

  // One input drives the arm at a time; each mode below gets writers that
  // only reach the arm while it holds control (see useControlAuthority).
  const control = useControlAuthority({
    updateJointDegrees,
    updateJointsDegrees,
    updateJointSpeed,
    updateJointsSpeed,
  });
  const { claim, release, writers } = control;

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
    updateJointsDegrees: writers.hand.updateJointsDegrees,
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

  // Keep a ref to the latest jointStates so the ROS publish interval doesn't
  // restart on every state change (which would stall it during key holds).
  const jointStatesRef = useRef(jointStates);
  jointStatesRef.current = jointStates;

  // In ROS mode each leader reading is published as it arrives, so the
  // bridge's fixed-rate timer stands down while the leader drives the arm.
  const leaderPublishing =
    leaderSettings.mode === "ros" && leaderControl.isConnected && control.owner === "leader";

  const ros2Bridge = useROS2Bridge({
    ros: ros2,
    settings: ros2Settings,
    jointDetails,
    jointStatesRef,
    updateJointsDegrees: writers.ros.updateJointsDegrees,
    eventDriven: leaderPublishing,
  });

  const leaderPublishingRef = useRef(leaderPublishing);
  leaderPublishingRef.current = leaderPublishing;
  const handleLeaderReading = useCallback(
    (angles: LeaderAngle[]) => {
      const revolute = new Map(
        jointDetails.filter((j) => j.jointType === "revolute").map((j) => [j.servoId, j.name])
      );
      const updates = angles.filter((a) => revolute.has(a.servoId));
      writers.leader.updateJointsDegrees(
        updates.map(({ servoId, angle }) => ({ servoId, value: angle }))
      );
      if (leaderPublishingRef.current) {
        ros2Bridge.publishCommands(
          updates.map((a) => revolute.get(a.servoId)!),
          updates.map((a) => degreesToRadians(a.angle))
        );
      }
    },
    [jointDetails, writers, ros2Bridge.publishCommands]
  );
  const leaderSync = useLeaderSync({
    isConnected: leaderControl.isConnected,
    getPositions: leaderControl.getPositions,
    servoIds: leaderServoIds,
    hz: leaderSettings.hz,
    onReading: handleLeaderReading,
  });

  // Starting a mode is the explicit action that hands it control; stopping it
  // gives control back to the keyboard if it still had it.
  const followingRos = ros2Status === "connected" && ros2Settings.role === "follower";
  useEffect(() => {
    if (followingRos) claim("ros");
    else release("ros");
  }, [followingRos, claim, release]);
  useEffect(() => {
    if (leaderControl.isConnected) claim("leader");
    else release("leader");
  }, [leaderControl.isConnected, claim, release]);
  const inVR = vrSession.activeMode !== null;
  useEffect(() => {
    if (inVR) claim("vr");
    else release("vr");
  }, [inVR, claim, release]);
  useEffect(() => {
    if (handTrackingEnabled) claim("hand");
    else release("hand");
  }, [handTrackingEnabled, claim, release]);

  const updateROS2Settings = useCallback((next: ROS2Settings) => {
    setROS2Settings(next);
    setROS2SettingsToLocalStorage(next);
  }, []);

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
            {HAND_CONTROL_ENABLED && <HandMarker markerRef={handTeleop.markerRef} />}
            <VRTeleop
              robotRef={robotRef}
              settings={vrSettings}
              ikConfig={config.ik}
              jointDetails={jointDetails}
              updateJointsDegrees={writers.vr.updateJointsDegrees}
              onStatus={setVRStatus}
            />
          </RobotScene>
        </Suspense>
      </Canvas>

      <ControlPanel
        show={showControlPanel}
        onHide={hideControlPanel}
        updateJointsSpeed={writers.manual.updateJointsSpeed}
        jointStates={jointStates}
        updateJointDegrees={writers.manual.updateJointDegrees}
        updateJointsDegrees={writers.manual.updateJointsDegrees}
        updateJointSpeed={writers.manual.updateJointSpeed}
        control={control}
        isConnected={isConnected}
        connectRobot={connectRobot}
        disconnectRobot={disconnectRobot}
        keyboardControlMap={keyboardControlMap}
        compoundMovements={compoundMovements}
        acceleration={acceleration}
        onAccelerationChange={setAcceleration}
      />
      <ChatControl
        show={showChatControl}
        onHide={hideChatControl}
        robotName={robotName}
        systemPrompt={systemPrompt}
        rosConnected={ros2Status === "connected"}
        subscribeCompressedImage={ros2.subscribeCompressedImage}
        listTopicsForType={ros2.listTopicsForType}
      />
      {/* LeaderControl overlay */}
      <LeaderControl
        show={showLeaderControl}
        onHide={hideLeaderControl}
        leaderControl={leaderControl}
        jointDetails={jointDetails}
        control={control}
        angles={leaderSync.angles}
        measuredHz={leaderSync.measuredHz}
        settings={leaderSettings}
        onSettingsChange={updateLeaderSettings}
        followerConnected={isConnected}
        ros={{
          status: ros2Status,
          role: ros2Settings.role,
          commandTopic: ros2Settings.commandTopic,
          followerState: ros2Bridge.state,
          connectAsLeader: () => {
            if (ros2Settings.role !== "leader") {
              updateROS2Settings({ ...ros2Settings, role: "leader" });
            }
            if (ros2Status !== "connected" && ros2Status !== "connecting") {
              connectROS2(ros2WsUrl);
            }
          },
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
        updateJointsDegrees={writers.replay.updateJointsDegrees}
        updateJointsSpeed={writers.replay.updateJointsSpeed}
        control={control}
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
        rosConnected={ros2Status === "connected"}
        publishCompressedImage={ros2.publishCompressedImage}
        subscribeCompressedImage={ros2.subscribeCompressedImage}
        listTopicsForType={ros2.listTopicsForType}
      />

      {/* Hand Control overlay */}
      {HAND_CONTROL_ENABLED && (
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
      )}

      {/* VR Control overlay */}
      <VRControl
        show={showVRControl}
        onHide={hideVRControl}
        session={vrSession}
        status={vrStatus}
        settings={vrSettings}
        onSettingsChange={updateVRSettings}
        onResetSettings={resetVRSettings}
        control={control}
      />

      {/* ROS 2 Panel overlay */}
      <ROS2Panel
        show={showROS2Panel}
        onHide={hideROS2Panel}
        status={ros2Status}
        error={ros2Error}
        onConnect={connectROS2}
        onDisconnect={disconnectROS2}
        defaultUrl={ros2WsUrl}
        settings={ros2Settings}
        onSettingsChange={updateROS2Settings}
        bridge={ros2Bridge}
        control={control}
      />

      <div className="absolute bottom-5 left-0 right-0">
        <ControlIndicator control={control} />
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
            {HAND_CONTROL_ENABLED && (
              <HandControlButton
                showControlPanel={showHandControl}
                onToggleControlPanel={toggleHandControl}
              />
            )}
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
