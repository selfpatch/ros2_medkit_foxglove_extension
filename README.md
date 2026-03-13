# ros2_medkit Diagnostics — Foxglove Extension

Foxglove Studio panels for browsing and interacting with the **ros2\_medkit gateway** HTTP API.

## Panels

| Panel | Description |
|-------|-------------|
| **ros2_medkit Entity Browser** | Tree view of areas → components → apps. Select an entity to see its data, operations, configurations, and faults in tabbed detail view. Invoke service/action operations and edit ROS 2 parameters inline. |
| **ros2_medkit Faults Dashboard** | Real-time monitoring of all system faults with severity summary cards, SSE live streaming, severity filtering, and fault clearing. |

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
- **ros2_medkit Entity Browser**
- **ros2_medkit Faults Dashboard**

## Configuration

Each panel has a settings editor (gear icon) where you configure:

- **Server URL** — Gateway address (e.g., `http://localhost:8080`)
- **Base path** — API path prefix (default: `api/v1`)

The Faults Dashboard has additional settings for refresh rate and SSE streaming.

## Architecture

```
src/
├── index.ts                   # Extension entry — registers both panels
├── types.ts                   # ros2_medkit gateway type definitions
├── medkit-api.ts              # HTTP API client for ros2_medkit gateway
├── styles.ts                  # Inline style helpers (dark/light theme)
├── EntityBrowserPanel.tsx     # Entity tree + detail tabs
└── FaultsDashboardPanel.tsx   # Faults monitoring + SSE
```

## Compatibility

- Foxglove Studio ≥ 2.x
- ros2\_medkit gateway ≥ 0.2.0
- Supports both dark and light Foxglove themes

## Development

```bash
# Build in watch mode (if using foxglove-extension CLI v2+)
npm run build -- --mode development

# Production build
npm run build:prod
```

The extension uses inline styles (no external CSS) because Foxglove sandboxes extensions without access to global stylesheets. Theme colors adapt automatically based on Foxglove's `colorScheme` render state.

## Releasing

Releases are automated via GitHub Actions. To publish a new version:

1. Bump version: `npm version X.Y.Z` (updates both `package.json` and `package-lock.json`, creates a commit and tag)
2. Push: `git push origin main && git push origin vX.Y.Z`

CI will validate that the tag matches `package.json`, build the `.foxe`, and create a GitHub Release with:
- The `.foxe` file as a downloadable asset
- `sha256sum` and download URL ready for the [Foxglove extension registry](https://github.com/foxglove/extension-registry) PR

## License

Apache-2.0 — see [LICENSE](LICENSE).
