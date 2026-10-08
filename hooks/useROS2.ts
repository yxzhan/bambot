"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import ROSLIB from "roslib";
import type { RosJointState } from "@/types/ros";

export type ROS2ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type UseROS2Options = {
  connectionTimeout?: number;
};

export type UseROS2Return = {
  status: ROS2ConnectionStatus;
  error: string | null;
  connect: (url: string) => void;
  disconnect: () => void;
  /**
   * Subscribes to a `sensor_msgs/JointState` topic while connected.
   *
   * @returns An unsubscribe function, or null when not connected.
   */
  subscribeJointState: (
    topicName: string,
    callback: (message: RosJointState) => void
  ) => (() => void) | null;
  /** Publishes positions (radians) as a `sensor_msgs/JointState` message. */
  publishJointState: (topicName: string, names: string[], positions: number[]) => void;
  /**
   * Publishes a `sensor_msgs/CompressedImage`. `base64Data` is the encoded
   * image, base64 - rosbridge turns it back into the message's uint8[] data.
   */
  publishCompressedImage: (
    topicName: string,
    frameId: string,
    format: string,
    base64Data: string
  ) => void;
};

const DEFAULT_CONNECTION_TIMEOUT = 5000;

/** Wall-clock time as a ROS 2 `builtin_interfaces/Time`. */
export function rosNow(): { sec: number; nanosec: number } {
  const ms = Date.now();
  return { sec: Math.floor(ms / 1000), nanosec: (ms % 1000) * 1_000_000 };
}

/**
 * Connection to a rosbridge WebSocket server, plus joint state publish and
 * subscribe primitives. What gets published where is decided by
 * `useROS2Bridge`, which knows this page's role.
 */
export function useROS2(options: UseROS2Options = {}): UseROS2Return {
  const connectionTimeout = options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT;

  const [status, setStatus] = useState<ROS2ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);

  const rosRef = useRef<ROSLIB.Ros | null>(null);
  const publishTopicsRef = useRef<Map<string, ROSLIB.Topic>>(new Map());
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

    for (const topic of publishTopicsRef.current.values()) {
      try {
        topic.unadvertise();
      } catch (e) {
        console.warn("Error unadvertising topic:", e);
      }
    }
    publishTopicsRef.current.clear();

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
        publishTopicsRef.current.clear();
        setStatus((prev) => (prev === "error" ? prev : "disconnected"));
      });

      rosRef.current = ros;

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
        }
      }, connectionTimeout);

    } catch (err) {
      if (!isMountedRef.current) return;

      const errorMsg = err instanceof Error ? err.message : "Failed to create ROS connection";
      setStatus("error");
      setError(errorMsg);
    }
  }, [connectionTimeout, clearConnectionTimeout, disconnect]);

  const subscribeJointState = useCallback(
    (topicName: string, callback: (message: RosJointState) => void) => {
      if (!rosRef.current) return null;

      const topic = new ROSLIB.Topic({
        ros: rosRef.current,
        name: topicName,
        messageType: "sensor_msgs/JointState",
      });
      topic.subscribe((message) => {
        if (!isMountedRef.current) return;
        callback(message as RosJointState);
      });

      return () => {
        try {
          topic.unsubscribe();
        } catch (e) {
          console.warn("Error unsubscribing from topic:", e);
        }
      };
    },
    []
  );

  /** The advertised topic for publishing, created on first use. */
  const publishTopic = useCallback((topicName: string, messageType: string) => {
    if (!rosRef.current) return null;
    let topic = publishTopicsRef.current.get(topicName);
    if (!topic) {
      topic = new ROSLIB.Topic({ ros: rosRef.current, name: topicName, messageType });
      publishTopicsRef.current.set(topicName, topic);
    }
    return topic;
  }, []);

  const publishJointState = useCallback(
    (topicName: string, names: string[], positions: number[]) => {
      try {
        const topic = publishTopic(topicName, "sensor_msgs/JointState");
        if (!topic) return;

        topic.publish(new ROSLIB.Message({
          header: { stamp: rosNow(), frame_id: "" },
          name: names,
          position: positions,
          velocity: [],
          effort: [],
        }));
      } catch (e) {
        console.warn("Error publishing joint state:", e);
      }
    },
    [publishTopic]
  );

  const publishCompressedImage = useCallback(
    (topicName: string, frameId: string, format: string, base64Data: string) => {
      try {
        const topic = publishTopic(topicName, "sensor_msgs/CompressedImage");
        if (!topic) return;
        topic.publish(new ROSLIB.Message({
          header: { stamp: rosNow(), frame_id: frameId },
          format,
          data: base64Data,
        }));
      } catch (e) {
        console.warn("Error publishing image:", e);
      }
    },
    [publishTopic]
  );

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
    connect,
    disconnect,
    subscribeJointState,
    publishJointState,
    publishCompressedImage,
  };
}
