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

Five control modes, each with its own panel + hook:

| Panel | Hook | Purpose |
|-------|------|---------|
| `keyboardControl/` | `useRobotControl` | Keyboard + sliders → servo SDK |
| `chatControl/` | — | OpenAI tool-calling → simulates key presses |
| `leaderControl/` | `useLeaderRobotControl` | Teleoperation from leader robot |
| `recordControl/` | (in `useRobotControl`) | Record/replay joint sequences at 20ms intervals |
| `ros2Control/` | `useROS2` | ROS2 bridge via rosbridge WebSocket |

### 3D Visualization

`components/playground/RobotScene.tsx` uses `@react-three/fiber` + `urdf-loader` to render the robot from `public/URDFs/so101.urdf`. Joint states are updated by mutating Three.js joint objects directly.

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
