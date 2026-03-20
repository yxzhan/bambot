"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import ROSLIB from "roslib";
import type { RosJointState } from "@/types/ros";

export type ROS2ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type UseROS2Options = {
  jointStateTopic?: string;
  connectionTimeout?: number;
};

export type UseROS2Return = {
  status: ROS2ConnectionStatus;
  error: string | null;
  jointState: RosJointState | null;
  connect: (url: string) => void;
  disconnect: () => void;
  publishJointCommand: (positions: { name: string; position: number }[]) => void;
};

const DEFAULT_JOINT_STATE_TOPIC = "/joint_states";
const DEFAULT_CONNECTION_TIMEOUT = 5000;

export function useROS2(options: UseROS2Options = {}): UseROS2Return {
  const jointStateTopic = options.jointStateTopic ?? DEFAULT_JOINT_STATE_TOPIC;
  const connectionTimeout = options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT;

  const [status, setStatus] = useState<ROS2ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [jointState, setJointState] = useState<RosJointState | null>(null);

  const rosRef = useRef<ROSLIB.Ros | null>(null);
  const jointTopicRef = useRef<ROSLIB.Topic<ROSLIB.Message> | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const clearConnectionTimeout = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearConnectionTimeout();

    if (jointTopicRef.current) {
      try {
        jointTopicRef.current.unsubscribe();
      } catch (e) {
        console.warn("Error unsubscribing from topic:", e);
      }
      jointTopicRef.current = null;
    }

    if (rosRef.current) {
      try {
        rosRef.current.close();
      } catch (e) {
        console.warn("Error closing ROS connection:", e);
      }
      rosRef.current = null;
    }

    if (isMountedRef.current) {
      setStatus("disconnected");
      setJointState(null);
    }
  }, [clearConnectionTimeout]);

  const connect = useCallback((url: string) => {
    if (rosRef.current) {
      disconnect();
    }

    if (isMountedRef.current) {
      setStatus("connecting");
      setError(null);
    }

    try {
      const ros = new ROSLIB.Ros({ url });

      ros.on("connection", () => {
        if (!isMountedRef.current) return;
        
        clearConnectionTimeout();
        setStatus("connected");
        setError(null);
        console.log("ROS 2 connected via rosbridge");
      });

      ros.on("error", (err) => {
        if (!isMountedRef.current) return;
        
        const errorMsg = err instanceof Error ? err.message : "Connection error";
        setStatus("error");
        setError(errorMsg);
        console.warn("ROS 2 connection error:", errorMsg);
      });

      ros.on("close", () => {
        if (!isMountedRef.current) return;
        
        rosRef.current = null;
        jointTopicRef.current = null;
        setStatus("disconnected");
      });

      const jointTopic = new ROSLIB.Topic({
        ros,
        name: jointStateTopic,
        messageType: "sensor_msgs/JointState",
      });

      jointTopic.subscribe((message) => {
        if (!isMountedRef.current) return;
        try {
          const msg = message as RosJointState;
          setJointState(msg);
        } catch (e) {
          console.warn("Error processing joint state message:", e);
        }
      });

      rosRef.current = ros;
      jointTopicRef.current = jointTopic;

      timeoutRef.current = setTimeout(() => {
        if (rosRef.current) {
          const errorMsg = `Connection timeout after ${connectionTimeout}ms`;
          if (isMountedRef.current) {
            setStatus("error");
            setError(errorMsg);
          }
          try {
            rosRef.current.close();
          } catch (e) {
            console.warn("Error closing ROS connection on timeout:", e);
          }
          rosRef.current = null;
          jointTopicRef.current = null;
        }
      }, connectionTimeout);

    } catch (err) {
      if (!isMountedRef.current) return;
      
      const errorMsg = err instanceof Error ? err.message : "Failed to create ROS connection";
      setStatus("error");
      setError(errorMsg);
    }
  }, [jointStateTopic, connectionTimeout, clearConnectionTimeout, disconnect]);

  const publishJointCommand = useCallback((positions: { name: string; position: number }[]) => {
    if (!rosRef.current) {
      console.warn("Cannot publish: ROS not connected");
      return;
    }

    try {
      const commandTopic = new ROSLIB.Topic({
        ros: rosRef.current,
        name: "/joint_trajectory_controller/joint_trajectory",
        messageType: "trajectory_msgs/JointTrajectory",
      });

      const trajectoryMsg = new ROSLIB.Message({
        joint_names: positions.map((p) => p.name),
        points: [
          {
            positions: positions.map((p) => p.position),
            time_from_start: { sec: 0, nanosec: 500000000 },
          },
        ],
      });

      commandTopic.publish(trajectoryMsg);
    } catch (e) {
      console.warn("Error publishing joint command:", e);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    error,
    jointState,
    connect,
    disconnect,
    publishJointCommand,
  };
}
