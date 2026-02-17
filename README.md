# SOVD Diagnostics — Foxglove Extension

Foxglove Studio panels for browsing and interacting with the **ros2\_medkit SOVD gateway** HTTP API.

## Panels

| Panel | Description |
|-------|-------------|
| **SOVD Entity Tree** | Tree view of SOVD areas → components → apps. Select an entity to see its data, operations, configurations, and faults in tabbed detail view. Invoke service/action operations and edit ROS 2 parameters inline. |
| **SOVD Faults Dashboard** | Real-time monitoring of all system faults with severity summary cards, SSE live streaming, severity filtering, and fault clearing. |

## Prerequisites

- A running **ros2\_medkit gateway** (default at `http://localhost:8080/api/v1`)
- [Foxglove Studio](https://foxglove.dev/) (desktop app or web)

## Quick Start

```bash
# Install dependencies
npm install

# Build the extension
npm run build

# Install into Foxglove Studio (local development)
npm run local-install

# Package for distribution (.foxe file)
npm run package
```

After `local-install`, restart Foxglove Studio and add panels from the panel menu:
- **SOVD Entity Tree**
- **SOVD Faults Dashboard**

## Configuration

Each panel has a settings editor (gear icon) where you configure:

- **Server URL** — Gateway address (e.g., `http://localhost:8080`)
- **Base path** — API path prefix (default: `api/v1`)

The Faults Dashboard has additional settings for refresh rate and SSE streaming.

## Architecture

```
src/
├── index.ts                   # Extension entry — registers both panels
├── types.ts                   # SOVD type definitions
├── sovd-api.ts                # HTTP API client for ros2_medkit gateway
├── styles.ts                  # Inline style helpers (dark/light theme)
├── EntityBrowserPanel.tsx     # Entity tree + detail tabs
└── FaultsDashboardPanel.tsx   # Faults monitoring + SSE
```

## Compatibility

- Foxglove Studio ≥ 2.x
- ros2\_medkit gateway ≥ 0.7.0
- Supports both dark and light Foxglove themes

## Development

```bash
# Build in watch mode (if using foxglove-extension CLI v2+)
npm run build -- --mode development

# Production build
npm run build:prod
```

The extension uses inline styles (no external CSS) because Foxglove sandboxes extensions without access to global stylesheets. Theme colors adapt automatically based on Foxglove's `colorScheme` render state.

## License

Apache-2.0 — see [LICENSE](LICENSE).
