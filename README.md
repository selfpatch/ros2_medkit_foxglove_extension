# ros2_medkit Diagnostics - Foxglove Extension

Foxglove Studio panels for browsing and interacting with the **ros2\_medkit gateway** HTTP API.

## Panels

| Panel | Description |
|-------|-------------|
| **ros2_medkit Entity Browser** | Tree view of areas -> components -> apps. Select an entity to see its data, operations, configurations, faults, and logs in tabbed detail view. The Operations tab builds a request/goal form from the operation schema, runs service or action operations, and for actions polls execution status with progress, cancel, and per-operation history. Edit ROS 2 parameters inline. The Logs tab queries entity logs with a severity filter and context search; rows are expandable to show the source location (file:line) and full timestamp; an aggregation header appears for function/area-level log aggregation; optional auto-refresh pauses automatically when the panel is not visible; a clear "no LogManager configured" state is shown when the gateway has no LogManager. |
| **ros2_medkit Faults Dashboard** | Real-time monitoring of all system faults with severity summary cards, SSE live streaming, severity filtering, and fault clearing. |
| **ros2_medkit Updates** | SOVD `/updates` package catalog. Register packages (with client-side validation) and run Prepare, Execute, Prepare & execute, or Delete with live status polling and per-update progress. Delete, Execute, and Prepare & execute require confirmation; Prepare/Execute/Prepare & execute are disabled on completed/failed updates. Shows a clear banner when the gateway has no UpdateProvider (HTTP 501). |

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
- **ros2_medkit Updates**

## Configuration

Each panel has a settings editor (gear icon) where you configure:

- **Server URL** - Gateway address (e.g., `http://localhost:8080`)
- **Base path** - API path prefix (default: `api/v1`)

The Server URL and Base path are shared across all three panels (backed by
`localStorage`), so setting them on one panel updates the others. The Faults
Dashboard has additional, panel-local settings for refresh rate and SSE
streaming.

## Architecture

```
src/
├── index.ts                   # Extension entry - registers all three panels
├── types.ts                   # ros2_medkit gateway type definitions
├── gateway-client.ts          # Typed client factory (@selfpatch/ros2-medkit-client-ts)
├── api-dispatch.ts            # Per-entity-type typed path dispatch helpers
├── medkit-api.ts              # HTTP API client for ros2_medkit gateway
├── updates-api.ts             # SOVD /updates resource client
├── shared-connection.ts       # Cross-panel gateway connection (localStorage)
├── panel-hooks.ts             # Shared hooks (connection, theme, dialog a11y)
├── schema-utils.ts            # JSON-schema to form model conversion + defaults
├── styles.ts                  # Inline style helpers (dark/light theme)
├── EntityBrowserPanel.tsx     # Entity tree + detail tabs
├── FaultsDashboardPanel.tsx   # Faults monitoring + SSE
├── LogsPanel.tsx              # Logs tab (severity/context filter, expandable rows, auto-refresh)
├── OperationRequestForm.tsx   # Schema-driven request/goal form (controlled)
├── OperationsPanel.tsx        # Operation request forms + execution lifecycle
└── UpdatesPanel.tsx           # SOVD updates catalog + actions
```

The HTTP layer (`medkit-api.ts`, `updates-api.ts`) uses the generated typed client from
`@selfpatch/ros2-medkit-client-ts` (runtime dependency). `gateway-client.ts` builds an
openapi-fetch client bound to the current gateway connection; `api-dispatch.ts` routes
each call to the correct typed per-entity-type path.

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
