# Changelog

## Unreleased

- Entity Browser: new **logs** tab per entity (severity floor, context filter,
  message search, off / 2s / 5s / 10s / 30s auto-refresh). Renders a friendly
  placeholder for entities whose gateway returns 404 / 503 on `/logs`.
- Entity Browser: Operations tab now drives a JSON-Schema form derived from
  the gateway's `x-medkit.type_info`, so service requests and action goals
  (e.g. nav2 `navigate_to_pose`) can be invoked with typed arguments instead
  of an empty body.
- Entity Browser: full action lifecycle - polls `GET /executions/{id}` every
  1s after invoke until the gateway reports a terminal status, exposes a
  cancel button while running, and color-codes the status badge
  (completed / failed / cancelled).
- Updates panel: emits a same-window `selfpatch:entity-graph-changed` event
  after `execute` / `automated`, so Entity Browser refreshes its tree and
  the user sees `broken_lidar` disappear / `fixed_lidar` appear without a
  manual reconnect.
- `useSharedConnection`: stable `update` reference (was rebuilt every render
  and re-registered the Foxglove settings editor on every render, which
  discarded mid-typing edits to the Server URL field in Faults Dashboard).
- New API surface: `MedkitApiClient.listLogs / getExecution / cancelExecution`,
  `MedkitApiError` exposing the HTTP status code.

## 0.0.1

- Initial release
- Entity Browser panel: browse areas, components, apps with data/operations/configurations/faults tabs
- Faults Dashboard panel: real-time fault monitoring with SSE streaming
