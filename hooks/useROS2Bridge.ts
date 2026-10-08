/**
 * What this page does on the ROS 2 network, by role (see `ROS2Role`).
 *
 * Two topics, both `sensor_msgs/JointState` in radians:
 *
 *   leader --(command topic, /joint_commands)--> follower
 *   leader <--(state topic, /joint_states)------ follower
 *
 * `/joint_states` follows the ROS convention of being the robot's own state,
 * so it is only ever published by the follower, and RViz, robot_state_publisher
 * or the MuJoCo twin can consume it as usual. Keeping commands on a topic of
 * their own also means no page ever receives its own messages back.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { RosJointState } from "@/types/ros";
import type { UseROS2Return } from "@/hooks/useROS2";
import type { JointState, UpdateJointsDegrees } from "@/hooks/useRobotControl";
import type { JointDetails } from "@/components/playground/RobotScene";
import type { ROS2Settings } from "@/lib/ros2Settings";
import { degreesToRadians, radiansToDegrees } from "@/lib/utils";

/** How often the panel's view of the topics is refreshed. */
const FEED_REFRESH_MS = 500;
/**
 * The follower re-applies a joint only when it is further than this from the
 * command (degrees), so a leader sitting still does not cause a stream of
 * identical servo writes.
 */
const APPLY_EPSILON_DEG = 0.05;

/** Latest message seen on one topic, for display. */
export type TopicFeed = {
  message: RosJointState | null;
  /** Messages per second over the last refresh window. */
  hz: number;
  /** `performance.now()` of the last message, or null if none yet. */
  receivedAt: number | null;
};

export type UseROS2BridgeResult = {
  /** Commands as seen on the network (follower and monitor only). */
  command: TopicFeed;
  /** The follower's state as seen on the network (leader and monitor only). */
  state: TopicFeed;
};

type UseROS2BridgeParams = {
  ros: UseROS2Return;
  settings: ROS2Settings;
  jointDetails: JointDetails[];
  jointStatesRef: React.RefObject<JointState[]>;
  updateJointsDegrees: UpdateJointsDegrees;
};

const EMPTY_FEED: TopicFeed = { message: null, hz: 0, receivedAt: null };

type FeedTracker = {
  message: RosJointState | null;
  count: number;
  receivedAt: number | null;
};

export function useROS2Bridge({
  ros,
  settings,
  jointDetails,
  jointStatesRef,
  updateJointsDegrees,
}: UseROS2BridgeParams): UseROS2BridgeResult {
  const { status, subscribeJointState, publishJointState } = ros;
  const connected = status === "connected";
  const { role, commandTopic, stateTopic, publishHz } = settings;

  const [command, setCommand] = useState<TopicFeed>(EMPTY_FEED);
  const [state, setState] = useState<TopicFeed>(EMPTY_FEED);

  const jointDetailsRef = useRef(jointDetails);
  jointDetailsRef.current = jointDetails;
  const updateJointsDegreesRef = useRef(updateJointsDegrees);
  updateJointsDegreesRef.current = updateJointsDegrees;

  const commandTracker = useRef<FeedTracker>({ message: null, count: 0, receivedAt: null });
  const stateTracker = useRef<FeedTracker>({ message: null, count: 0, receivedAt: null });

  // --- publish: commands (leader) or own state (follower) ------------------
  const publishTopic =
    role === "leader" ? commandTopic : role === "follower" ? stateTopic : null;
  const hasJoints = jointDetails.length > 0;

  useEffect(() => {
    if (!connected || !publishTopic || !hasJoints) return;
    const timer = setInterval(() => {
      const names: string[] = [];
      const positions: number[] = [];
      for (const joint of jointStatesRef.current ?? []) {
        if (joint.jointType === "revolute" && typeof joint.degrees === "number") {
          names.push(joint.name);
          positions.push(degreesToRadians(joint.degrees));
        }
      }
      if (names.length > 0) publishJointState(publishTopic, names, positions);
    }, 1000 / publishHz);
    return () => clearInterval(timer);
  }, [connected, publishTopic, publishHz, hasJoints, jointStatesRef, publishJointState]);

  // --- subscribe: commands (follower drives its robot; monitor watches) ----
  const listenToCommands = role === "follower" || role === "monitor";
  useEffect(() => {
    if (!connected || !listenToCommands) return;
    const tracker = commandTracker.current;

    const unsubscribe = subscribeJointState(commandTopic, (message) => {
      tracker.message = message;
      tracker.count++;
      tracker.receivedAt = performance.now();
      if (role !== "follower") return;

      const updates: { servoId: number; value: number }[] = [];
      message.name.forEach((name, i) => {
        const radians = message.position[i];
        if (typeof radians !== "number" || !Number.isFinite(radians)) return;
        const detail = jointDetailsRef.current.find((d) => d.name === name);
        if (!detail || detail.jointType !== "revolute") return;
        // Compared with where the follower is, not with the last command: a
        // local nudge on the follower is undone on the next message, so the
        // two arms never quietly disagree.
        const degrees = radiansToDegrees(radians);
        const current = jointStatesRef.current?.find((j) => j.name === name)?.degrees;
        if (typeof current === "number" && Math.abs(degrees - current) < APPLY_EPSILON_DEG) {
          return;
        }
        updates.push({ servoId: detail.servoId, value: degrees });
      });
      if (updates.length > 0) updateJointsDegreesRef.current(updates);
    });

    return () => {
      unsubscribe?.();
      tracker.message = null;
      tracker.receivedAt = null;
    };
  }, [connected, listenToCommands, role, commandTopic, subscribeJointState, jointStatesRef]);

  // --- subscribe: the follower's state (leader and monitor watch it) --------
  const listenToState = role === "leader" || role === "monitor";
  useEffect(() => {
    if (!connected || !listenToState) return;
    const tracker = stateTracker.current;
    const unsubscribe = subscribeJointState(stateTopic, (message) => {
      tracker.message = message;
      tracker.count++;
      tracker.receivedAt = performance.now();
    });
    return () => {
      unsubscribe?.();
      tracker.message = null;
      tracker.receivedAt = null;
    };
  }, [connected, listenToState, stateTopic, subscribeJointState]);

  // --- refresh the panel's view at a gentle rate ----------------------------
  useEffect(() => {
    const toFeed = (tracker: FeedTracker): TopicFeed => {
      const feed = {
        message: tracker.message,
        hz: (tracker.count * 1000) / FEED_REFRESH_MS,
        receivedAt: tracker.receivedAt,
      };
      tracker.count = 0;
      return feed;
    };
    const timer = setInterval(() => {
      setCommand(toFeed(commandTracker.current));
      setState(toFeed(stateTracker.current));
    }, FEED_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return { command, state };
}
