# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Bambot is a Next.js 15 web app for visualizing and controlling a low-cost open-source humanoid robot (~$300) with 3D-printed parts and STS3215 servo motors.

## Commands

```bash
pnpm dev      # Dev server with Turbopack at http://localhost:3000
pnpm build    # Production build
pnpm lint     # ESLint via Next.js
```

`predev` / `prebuild` run `scripts/fetch-mediapipe-assets.mjs`, which copies the
MediaPipe wasm bundle out of node_modules and downloads the hand landmarker
model into `public/mediapipe/` (gitignored). Re-run it with `--force` to refresh
after bumping `@mediapipe/tasks-vision`.

No tests are currently defined.

## Architecture

### Routing

- `/` — Home page listing available robots
- `/play/[slug]` — Robot playground (e.g., `/play/so-arm101`)
- `/assemble/so-101` — Assembly instructions
- `/feetech.js/` — SDK docs

### Robot Configuration

All robot definitions live in `config/robotConfig.ts` as entries in `robotConfigMap` keyed by URL slug. Each entry defines:
- URDF URL, camera position, orbit target
- `keyboardControlMap` — key bindings to joint movements
- `jointNameIdMap` — URDF joint name → servo ID
- `urdfInitJointAngles` — initial angles
- `compoundMovements` — linked joint movements with formulas
- `systemPrompt` — LLM prompt for AI chat control

### Control Panel System

`components/playground/RobotLoader.tsx` is the top-level container that renders the 3D scene and all control panels. Panels are independently draggable (via `react-rnd`) and their visibility is toggled by button components in `controlButtons/`. Panel visibility persists in `localStorage` via `lib/panelSettings.ts`.

Seven control modes, each with its own panel + hook:

| Panel | Hook | Purpose |
|-------|------|---------|
| `keyboardControl/` | `useRobotControl` | Keyboard + sliders → servo SDK |
| `chatControl/` | — | OpenAI tool-calling → simulates key presses |
| `leaderControl/` | `useLeaderRobotControl` | Teleoperation from leader robot |
| `recordControl/` | (in `useRobotControl`) | Record/replay joint sequences at 20ms intervals |
| `ros2Control/` | `useROS2` + `useROS2Bridge` | Leader / follower teleop over rosbridge |
| `handControl/` | `useHandLandmarker` + `useHandTeleop` | Webcam hand tracking → IK → end effector |
| `vrControl/` | `useVRSession` + `useVRTeleop` | WebXR controllers → IK → end effector |

### 3D Visualization

`components/playground/RobotScene.tsx` uses `@react-three/fiber` + `urdf-loader` to render the robot from `public/URDFs/so101.urdf`. Joint states are updated by mutating Three.js joint objects directly.

### Hand Control

`useHandLandmarker` runs MediaPipe's Hand Landmarker over a webcam stream and
writes the pose into a ref (never state - it updates at camera frame rate). The
pose is anchored at the wrist, the steadiest landmark, so opening and closing
the hand works the jaws without dragging the arm around.
`useHandTeleop` maps that pose into a marker in the 3D scene; once the marker
lines up with the gripper it latches on and `lib/ik.ts` solves the arm joints
that follow it, which are then pushed through `updateJointsDegrees` like any
other control mode. Detaching happens when the target leaves the reachable
workspace (the IK position residual stays above tolerance), when the hand leaves
the frame, or on Esc.

`useHandCalibration` measures the operator rather than assuming: four corners
give the part of the frame the hand sweeps, a reach forward and back gives the
apparent hand sizes that bracket the depth axis, and a three second hold fixes
both the orientation offset and the workspace centre - so the marker is sitting
on the gripper the moment calibration ends. `lib/handCalibration.ts` holds that
maths, free of React. `lib/handGuide.ts` runs the whole mapping backwards to
draw the target hand pose over the preview.

`lib/ik.ts` is a generic damped least squares solver over a URDF joint chain -
it works in world space on the live Three.js transforms, so the scene scale and
rotation need no special handling. Each robot declares its chain in
`robotConfig.ts` via `ik: { chainJoints, tcpLinkName, gripperJoint }`.

### VR Control

`useVRSession` (outside the canvas) checks WebXR support and starts an
`immersive-vr` or `immersive-ar` (passthrough) session on the renderer that
`RobotLoader` captures in `onCreated`; react-three-fiber switches to the XR
render loop by itself. `useVRTeleop` runs inside the canvas, because controller
poses only exist on the `XRFrame` passed to `useFrame`.

For the session the camera is parented to an XR rig carrying the robot's scene
scale, so the robot appears life size and controller motion maps 1:1. The rig
is placed so the operator stands behind the arm, looking along its reach
(recomputed on A / X). Control is a clutch: while grip is held the gripper
target is the anchor TCP pose plus the controller's motion since engaging, so
nothing has to be lined up and the arm never jumps; the trigger drives the
gripper once it has been brought to the gripper's current opening. IK runs
without random restarts and joint steps are rate limited; once the target is
out of reach the arm stops following and holds its last reachable pose (the
gripper still follows the trigger) until the hand brings the target back. The maths is in `lib/vrTeleop.ts`.

The VR panel can also put the page on a headset without typing its address:
`lib/shareLink.ts` (ported from cramera's `core/share-link.js`) asks the
pairing service at `https://vr.aicor.dev` (override with `?pair=`) for a short
code that the headset redeems for this page's link. The link carries the
page's `?token=` (for Jupyter's proxy) and `ros2role=leader`.

WebXR needs a secure context (HTTPS or localhost). The Quest Browser has no
Web Serial, so moving the physical arm needs desktop Chrome with a PC VR
runtime (Quest Link / Air Link / SteamVR), or a ROS 2 relay.

### ROS 2 Bridge

`useROS2` owns the rosbridge connection and joint state publish/subscribe;
`useROS2Bridge` decides what to do with it from the page's role
(`lib/ros2Settings.ts`, persisted, overridable with `?ros2role=`; the old name
`commander` is still accepted for `leader`):

- **leader** publishes this page's joint positions on `/joint_commands`
  (whatever moved them: leader arm, VR, keyboard) and shows `/joint_states`.
- **follower** applies `/joint_commands` through `updateJointsDegrees` (so its
  servos move) and publishes its own state on `/joint_states`. It re-applies a
  joint whenever it differs from the command, so a local nudge is undone.
- **monitor** only listens.

Both topics are `sensor_msgs/JointState` in radians, published at the panel's
publish rate (default 30 Hz, 1–60). `/joint_states` is
only ever published by the follower, as the ROS convention expects. The state
the follower publishes is what it applied, not servo read-back. The MuJoCo sim
in the parent repo is a follower on the same contract.

### State Management

No Redux or Zustand. State is local to hooks and components via `useState`/`useRef`. SDK instances (servo, ROS) are held in `useRef`. Persistence is via `localStorage` only.

### Servo / Joint Utilities

`lib/utils.ts` provides conversions between servo positions (0–4096), degrees (0–360), and radians. Use these instead of manual math.

### AI Chat Control

`chatControl/ChatControl.tsx` uses the Vercel `ai` SDK with OpenAI. The AI is given a `keyPress` tool that simulates keyboard input, which flows through the standard keyboard control path. API key, base URL, and model are stored in `localStorage` via `lib/chatSettings.ts`.

## Key Conventions

- All `"use client"` — this app has no server components in the playground
- Path alias `@/` maps to the project root
- `cn()` from `lib/utils.ts` for conditional Tailwind class merging
- Hooks instantiate SDK objects with `useRef(new ScsServoSDK()).current` (not useState)
- Types defined inline near usage, not in a central types file (except `types/ros.ts`)
