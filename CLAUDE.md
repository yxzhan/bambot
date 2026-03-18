# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bambot is an open-source, low-cost humanoid robot (~$300) built with 3D printed parts and STS3215 servo motors. The repository contains:

1. **feetech.js/**: JavaScript SDK for feetech STS3215 servos
2. **website/**: Next.js site (bambot.org) showcasing the robot with 3D models, assembly instructions, and a playground for controlling robots
3. **hardware/**: Hardware documentation and BOM

## Architecture

### Website (Next.js 15 + v0)

The website is generated from v0 with shadcn/ui components:

```
website/
├── app/
│   ├── assemble/so-101/     # SO-101 assembly instructions
│   ├── feetech.js/          # feetech.js SDK docs
│   ├── play/[slug]/         # Robot playground control interface
│   └── layout.tsx           # Root layout
├── components/
│   ├── playground/          # Playground components (robot control, chat, recording)
│   ├── ui/                  # shadcn/ui primitives
│   └── Header.tsx           # Site header
└── config/
    ├── robotConfig.ts       # Robot configuration
    └── uiConfig.ts          # UI configuration
```

**Key features**:
- 3D robot rendering with Three.js / @react-three/fiber
- Keyboard/leader robot control
- Chat integration with @ai-sdk/openai
- Robot state recording and replay

### feetech.js SDK

A JavaScript/TypeScript SDK for feetech STS3215 servos:

```
feetech.js/
├── index.mjs        # Main entry point
└── *.ts            # TypeScript definitions
```

### Hardware

BOM includes STS3215 servos (15x), motor control board, omni wheels, and wiring. Based on SO-100 arm + LeKiwi design.

## Development Commands

```bash
# Website
npm run dev          # Start dev server (with Turbopack)
npm run build        # Build for production
npm run start        # Run production build
npm run lint         # Lint code

# feetech.js
# Use npm/bun for TypeScript with module support
```

## Key Dependencies

- `next`: 15.3.2
- `react`: 19
- `@react-three/fiber`: 9.1.2 (3D rendering)
- `@ai-sdk/openai`: 1.3.22 (chat integration)
- `feetech.js`: 0.1.2 (local package for servo control)
- `three`: 0.175.0

## UI/UX Patterns

The site uses shadcn/ui Radix components. Common patterns:
- Accordions for step-by-step instructions
- Tabs for different robot modes
- Dialogs for settings/help
- Custom Tailwind utility classes via `cn()` from `class-variance-authority`

## Testing

No tests are currently defined. Add tests as needed using Jest/Vitest.

## License

MIT
