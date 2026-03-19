# AGENTS.md

This file provides guidance for AI agents working in this repository.

## Project Overview

Bambot is an open-source, low-cost humanoid robot (~$300) built with 3D printed parts and STS3215 servo motors.

### Repository Structure

```
bambot/
├── website/           # Next.js 15 website (bambot.org)
├── feetech.js/        # JavaScript SDK for feetech STS3215 servos
├── hardware/          # Hardware documentation and BOM
├── AGENTS.md          # This file
└── CLAUDE.md          # Human-focused project documentation
```

---

## Development Commands

All commands run from the `website/` directory.

```bash
cd website

# Development
npm run dev          # Start dev server with Turbopack (http://localhost:3000)
npm run build        # Production build
npm run start        # Run production server

# Linting
npm run lint          # Lint all code

# Testing
# No tests currently defined. Add tests with Vitest/Jest when needed.
```

### Running Single Tests

When tests are added, use:
```bash
npm run test -- <test-file>    # Run specific test file
npm run test -- --watch       # Watch mode
```

---

## Code Style Guidelines

### TypeScript Configuration

- **Strict mode enabled** in `tsconfig.json`
- Module resolution: `bundler`
- Path aliases: `@/*` maps to `./website/*`

### File Organization

```
website/
├── app/                    # Next.js App Router pages
│   ├── page.tsx           # Home page
│   ├── assemble/           # Assembly instructions
│   ├── feetech.js/         # SDK documentation
│   └── play/[slug]/        # Robot playground routes
├── components/
│   ├── playground/         # Robot control components
│   ├── ui/                # shadcn/ui primitives
│   └── *.tsx              # Shared components
├── config/                # Configuration files
├── hooks/                 # Custom React hooks
└── lib/                   # Utilities
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
  // ...
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

| Package | Version | Purpose |
|---------|---------|---------|
| next | 15.3.2 | Framework |
| react | 19 | UI library |
| @react-three/fiber | 9.1.2 | 3D rendering |
| three | 0.175.0 | 3D graphics |
| @ai-sdk/openai | 1.3.22 | Chat integration |
| shadcn/ui | - | UI components |
| tailwindcss | 3.4 | Styling |
| zod | 3.24.1 | Validation |

---

## Testing Guidelines

**When adding tests:**
- Use Vitest for unit tests, React Testing Library for components
- Place tests next to source files: `Component.tsx` → `Component.test.tsx`
- Mock external dependencies (feetech.js SDK, browser APIs)
- Aim for >80% coverage on utility functions

---

## Git Workflow

- Create feature branches from `main`
- Commit messages: imperative mood, 50 chars max subject
  - `feat: add robot recording feature`
  - `fix: resolve servo connection timeout`
- Run `npm run lint` before committing
- Open PRs against `main` branch

---

## License

MIT
