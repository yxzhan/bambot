# AGENTS.md

This file provides guidance for AI agents working in this repository.

## Project Overview

Bambot is an open-source, low-cost humanoid robot (~$300) built with 3D printed parts and STS3215 servo motors. The website is a Next.js 15 application for robot visualization and control.

### Repository Structure

```
bambot/
├── app/               # Next.js App Router pages
├── components/        # React components
│   └── playground/   # Robot control components
├── config/           # Configuration files
├── hooks/            # Custom React hooks
├── lib/              # Utilities
├── public/           # Static assets (URDFs, images)
├── types/            # TypeScript type definitions
├── styles/           # Global styles
├── config/           # Robot configurations
└── AGENTS.md         # This file
```

---

## Development Commands

All commands run from the repository root (not a subdirectory).

```bash
# Development
pnpm dev          # Start dev server with Turbopack (http://localhost:3000)
pnpm build        # Production build
pnpm start        # Run production server

# Linting
pnpm lint         # Lint all code with Next.js ESLint

# Testing
# No tests currently defined
```

### Running Single Tests

When tests are added, use:
```bash
pnpm test -- <test-file>    # Run specific test file
pnpm test -- --watch        # Watch mode
```

---

## Code Style Guidelines

### TypeScript Configuration

- **Strict mode enabled** in `tsconfig.json`
- Module resolution: `bundler`
- Path aliases: `@/*` maps to `./` (project root)

### File Organization

```
app/
├── page.tsx              # Home page
├── layout.tsx            # Root layout
├── assemble/             # Assembly instructions
├── feetech.js/            # SDK documentation
└── play/[slug]/           # Robot playground routes

components/
├── playground/            # Robot 3D control components
│   ├── ros2Control/       # ROS2 bridge panel
│   ├── keyboardControl/   # Keyboard control
│   └── *.tsx
├── ui/                   # shadcn/ui primitives
└── *.tsx                 # Shared components

config/
└── robotConfig.ts        # Robot configurations

hooks/
└── use*.ts               # Custom React hooks

lib/
├── utils.ts              # Utilities (cn, etc.)
└── panelSettings.ts      # Panel state persistence

types/
└── ros.ts                # ROS type definitions
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `use-robot-control.ts` |
| Components | PascalCase | `RobotControl.tsx` |
| Hooks | camelCase with `use` prefix | `useRobotControl` |
| Types/Interfaces | PascalCase | `RobotConfig`, `JointState` |
| Constants | SCREAMING_SNAKE_CASE | `RECORDING_INTERVAL` |
| Functions | camelCase | `servoPositionToAngle` |

### Imports

**Order imports:**
1. React / Next.js built-ins
2. Third-party libraries
3. Internal components/hooks
4. Config/utils
5. Relative imports

```typescript
// Example imports
import { useState, useCallback } from "react";
import Link from "next/link";
import { ScsServoSDK } from "feetech.js";
import { cn } from "@/lib/utils";
import { robotConfigMap } from "@/config/robotConfig";
import { NotificationDialog } from "@/components/NotificationDialog";
```

**Use path aliases (`@/`) for internal imports.**

### Component Patterns

**Client Components:**
```typescript
"use client";
import { useState } from "react";

export default function MyComponent() {
  const [state, setState] = useState(false);
  return <div>...</div>;
}
```

**Use functional components with hooks only.**

### TypeScript Patterns

**Define types near usage:**
```typescript
type JointDetails = {
  name: string;
  servoId: number;
  jointType: "revolute" | "continuous";
  limit?: { lower?: number; upper?: number };
};

export type JointState = {
  name: string;
  servoId?: number;
  jointType: "revolute" | "continuous";
};
```

**Avoid `any` - use proper types or `unknown` with type guards.**

### Error Handling

**Use try/catch with descriptive errors:**
```typescript
try {
  await scsServoSDK.connect();
} catch (error) {
  console.error("Failed to connect to robot:", error);
  setIsConnected(false);
}
```

**Use console.warn for recoverable issues, console.error for failures.**

### UI/Styling

**Use Tailwind CSS classes:**
- Use `cn()` from `lib/utils.ts` to merge conditional classes
- Follow shadcn/ui component patterns
- Use `zinc-*` for neutral colors, Tailwind spacing scale

**Example:**
```typescript
import { cn } from "@/lib/utils";

<div className={cn(
  "base-class",
  isActive && "active-class",
  className
)}>
```

### Common Patterns

**React hooks for state:**
```typescript
const [state, setState] = useState<Type>(initialValue);
const callback = useCallback(async () => {
  // async logic
}, [dependencies]);
```

**useRef for SDK instances:**
```typescript
const scsServoSDK = useRef(new ScsServoSDK()).current;
```

---

## Key Dependencies

| Package | Purpose |
|---------|---------|
| next 15.3.2 | Framework |
| react 19 | UI library |
| @react-three/fiber | 3D rendering |
| three | 3D graphics |
| roslib | ROS bridge integration |
| feetech.js | Servo motor SDK |
| @ai-sdk/openai | Chat integration |
| shadcn/ui | UI components |
| tailwindcss | Styling |
| zod | Validation |

---

## Git Workflow

- Create feature branches from `main`
- Commit messages: imperative mood, 50 chars max subject
  - `feat: add robot recording feature`
  - `fix: resolve servo connection timeout`
- Run `pnpm lint` before committing
- Open PRs against `main` branch

---

## License

MIT
