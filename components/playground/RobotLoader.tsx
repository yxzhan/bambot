"use client";

import { useEffect, useState, useRef, Suspense, useCallback } from "react";
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
  const [rosControlEnabled, setRosControlEnabled] = useState(false);
  const [rosLeaderBroadcastEnabled, setRosLeaderBroadcastEnabled] = useState(false);
  const config = robotConfigMap[robotName];

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

  // Scenario 1: publish leader arm state to ROS (/leader/joint_states)
  const publishLeaderStateToROS = useCallback(
    (leaderAngles: { servoId: number; angle: number }[]) => {
      if (!rosLeaderBroadcastEnabled || ros2Status !== "connected") return;
      const names: string[] = [];
      const positions: number[] = [];
      leaderAngles.forEach(({ servoId, angle }) => {
        const joint = jointDetails.find((j) => j.servoId === servoId);
        if (joint) {
          names.push(joint.name);
          positions.push(degreesToRadians(angle));
        }
      });
      if (names.length > 0) {
        publishJointState({ topicName: "/leader/joint_states", jointNames: names, positions });
      }
    },
    [rosLeaderBroadcastEnabled, ros2Status, jointDetails, publishJointState]
  );

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
        onCreated={({ scene }) => {
          scene.background = new THREE.Color(0x263238);
        }}
      >
        <Suspense fallback={<Loader />}>
          <RobotScene
            robotName={robotName}
            urdfUrl={urdfUrl}
            orbitTarget={orbitTarget}
            setJointDetails={setJointDetails}
            jointStates={jointStates}
          />
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
        onPublishToROS={publishLeaderStateToROS}
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
        rosLeaderBroadcastEnabled={rosLeaderBroadcastEnabled}
        onLeaderBroadcastToggle={() => setRosLeaderBroadcastEnabled((prev) => !prev)}
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
