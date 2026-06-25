# Changelog

## Unreleased

### Entity lifecycle status control in Entity Browser

Apps and components now show a lifecycle control in the entity detail (gateway
0.6.0 lifecycle API):

- Live readiness badge (ready / notReady) fetched from `GET /{entity}/status`.
- Transition actions: start, restart, force-restart, shutdown, force-shutdown.
  Actions are gated by the current readiness (e.g. Start is disabled when ready),
  and the destructive ones (shutdown / force-shutdown) ask for inline confirmation.
- A gateway without a lifecycle provider returns 501; this shows as a disabled
  "not available" state rather than an error.
- Areas and functions have no lifecycle status, so the control is not shown for them.

### Capability-driven resource tabs in Entity Browser

The Entity Browser tab bar shows tabs based on the gateway's reported capabilities:

- A tab is shown whenever the gateway reports the matching capability; the tab's
  own panel shows an empty state when the selected entity has no items. Tab
  visibility is not gated on item counts, so tabs no longer appear and disappear
  as you move between entities.
- Each tab shows a count badge (e.g. "3" next to "configurations") populated by a
  background fetch on entity selection. The count is informational only - a slow
  or failed count fetch never hides the tab.
- If the gateway does not report capabilities (fallback mode, or an older gateway),
  all standard tabs are shown.

### Configurations tab: type-aware editors and reset

The Configurations tab in the Entity Browser now provides full inline editing:

- Each ROS 2 parameter is rendered with a type-aware editor: toggle for bool,
  numeric input for int and double, text field for string.
- Individual parameters can be saved one at a time with a Save button per row.
- A per-parameter Reset restores a single parameter to its gateway-reported default;
  a failed reset is surfaced inline rather than silently stopping the spinner.
- A Reset all button restores every parameter to its gateway-reported default in a
  single request. A clean reset is confirmed; partial failures are surfaced as
  "Reset N of T node(s), M failed" (the gateway reports one result per backing node,
  so the counts are node counts, not per-parameter).
- Parameters the gateway marks read-only are shown locked, with no editor or
  Save/Reset controls.

### ros2_medkit Server Info panel

A new Server Info panel displays a live snapshot of the connected gateway:

- Gateway version and server metadata.
- List of supported capabilities as reported by `GET /`.
- API entry points (links to resource collections exposed by the gateway).

### Logs tab in Entity Browser panel

The Entity Browser panel now includes a Logs tab for each entity:

- Queries entity logs via `GET /{entity-type}/{id}/logs` with server-side severity
  filtering (debug / info / warning / error / fatal) and a context search parameter
  (debounced, 300 ms).
- Expandable rows reveal the source location (file:line), called function, and full
  ISO 8601 nanosecond timestamp.
- Aggregation header shown when the gateway merges logs from multiple sources
  (function- or area-level aggregation); lists source names and count.
- Optional auto-refresh (5 s interval) that pauses automatically while the panel
  is not visible (Page Visibility API) and resumes with an immediate fetch.
- Manual Refresh button always available regardless of auto-refresh state.
- Entries are shown newest-first; a display cap of 200 rows keeps the most
  recent entries with a "Show all (N)" button when more are returned.
- Log configuration editor (severity filter and max-entries cap, 1..10000) via
  the settings control.
- Clear "no LogManager configured" state for HTTP 503/404 responses.
- Note: log trigger endpoints are not included in this release (deferred).

### Operations request forms and action execution lifecycle

The Operations tab in the Entity Browser panel now provides full interactive
operation support:

- Request/goal form generated from the operation schema (service request or
  action goal); fields are rendered per-type (numeric, boolean, string, nested
  object, array) with schema-seeded default values.
- Run service operations synchronously - result JSON is shown inline.
- Run action operations asynchronously - createExecution starts the action,
  then the panel polls GET executions/{id} every ~1 s, displaying live status,
  ROS 2 status code, and feedback parameters.
- Cancel running actions via DELETE.
- Per-operation execution history (last 10 runs) with timestamp and terminal
  status.
- `int64`/`uint64` form fields are carried as decimal strings end-to-end (the
  gateway parses them back losslessly) so values beyond 2^53 are not rounded by
  a JS number. This diverges from `ros2_medkit_web_ui`, which uses plain numbers.

### Migrate HTTP layer to generated typed client

All HTTP calls and SSE streams now route through the generated
`@selfpatch/ros2-medkit-client-ts` client instead of raw fetch.

**Accepted behavior changes (disclosure):**
- Non-JSON / proxy error bodies (e.g. plain-text 502 from a reverse proxy) now surface a
  generic "Request failed with status N" message instead of the raw text. Gateway errors
  are JSON GenericError and are unaffected.
- The `body` argument on `triggerPrepare`, `triggerExecute`, and `triggerAutomated` in
  `updates-api.ts` is now unused at the wire level - the SOVD updates API has no request
  body for those triggers. The parameter is kept for call-site compatibility.

**Other changes:**
- `ping()` now uses `AbortSignal.timeout(3000)` so a dead gateway fails in ~3 s instead
  of the client's default 10 s.
- Dead `fetchJSON` helper removed from `medkit-api.ts`.

## 0.0.1

- Initial release
- Entity Browser panel: browse areas, components, apps with data/operations/configurations/faults tabs
- Faults Dashboard panel: real-time fault monitoring with SSE streaming
