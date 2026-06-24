# Changelog

## Unreleased

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
- Display cap of 200 rows with a "Show all (N)" button when more entries are
  returned.
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
