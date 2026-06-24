# Changelog

## Unreleased

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
