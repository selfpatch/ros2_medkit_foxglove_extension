# Task 2c Report: Faults + Bulk-Data migration

## Dispatch extensions (api-dispatch.ts)

Added four fault dispatch functions:
- `getEntityFaults` - GET `/{type}/{id}/faults` (apps/components/areas/functions)
- `deleteEntityFault` - DELETE `/{type}/{id}/faults/{fault_code}`
- `deleteAllEntityFaults` - DELETE `/{type}/{id}/faults`
- `getEntityFault` - GET `/{type}/{id}/faults/{fault_code}`

Added two bulk-data dispatch functions:
- `getEntityBulkDataCategories` - GET `/{type}/{id}/bulk-data`
- `getEntityBulkDataDescriptors` - GET `/{type}/{id}/bulk-data/{category_id}`

All use exhaustive switch over `SovdResourceEntityType` ("apps"|"components"|"areas"|"functions") with typed literal paths - no `as never`.

## Per-method changes (medkit-api.ts)

| Method | Before | After |
|---|---|---|
| `listAllFaults` | `fetchJSON(this.url("faults"))` | `this.client.GET("/faults")` |
| `listEntityFaults` | `fetchJSON(this.url(...))` | `getEntityFaults(...)` dispatch |
| `clearFault` | `fetch(..., {method:"DELETE"})` + manual ok-check | `deleteEntityFault(...)` + `throwApiError` |
| `clearAllFaults` | `fetch(..., {method:"DELETE"})` + manual ok-check | `deleteAllEntityFaults(...)` + `throwApiError` |
| `getFaultWithEnvironmentData` | `fetchJSON<FaultResponse>(...)` | `getEntityFault(...)` + `throwApiError` |
| `listBulkDataCategories` | `fetchJSON(...)` in try/catch returning `{items:[]}` | `getEntityBulkDataCategories(...)` + `throwApiError` |
| `listBulkData` | `fetchJSON(...)` in try/catch returning `{items:[]}` | `getEntityBulkDataDescriptors(...)` + `throwApiError` |
| `getBulkDataDownloadUrl` | URL-builder using `this.url()` | Unchanged - no typed-client equivalent for binary download URLs |
| `subscribeFaultStream` | SSE via `this.url("faults/stream")` | Unchanged (T4 scope) |

## Response->return mapping

- `listAllFaults` / `listEntityFaults`: `data as unknown as { items?: unknown[]; "x-medkit"?: { count?: number } }` then `transformFault()` per item - same mapping as before.
- `getFaultWithEnvironmentData`: `data as unknown as FaultResponse` - schema response is open-form; FaultResponse maps the wire shape exactly.
- `listBulkDataCategories`: `data as unknown as BulkDataCategory` - open-form.
- `listBulkData`: `data as unknown as BulkDataList` - open-form.
- `clearFault` / `clearAllFaults`: void - delete responses have no body.

## Value-side casts and justification

All casts are `as unknown as <LocalType>`. The generated schema uses open/generic response shapes for faults and bulk-data (not narrowly typed structs), so the generated `data` type is too broad to assign directly to our local TS interfaces without the intermediate `unknown`. This is the same pattern used in T2a/T2b for the same reason. No `as any` anywhere.

## Silent empty-on-error removal

`listBulkDataCategories` and `listBulkData` previously had `try/catch { return { items: [] } }` suppressing all errors. These are now replaced by `throwApiError` per the task brief ("No silent empty-on-error"). This is a behavior change but aligns with the error semantics contract.

## fetchJSON / ensureOk dead-code status

`fetchJSON` is defined in medkit-api.ts but now has zero call sites in production code. `ensureOk` was never in medkit-api.ts. Both are candidates for T6 cleanup. Left in place as instructed.

## Test evidence

Before (baseline):
```
Test Files  6 passed | 1 skipped (7)
Tests  50 passed | 3 skipped (53)
```

After:
```
npx tsc --noEmit  -> (no output, clean)
npx vitest run    -> Test Files 6 passed | 1 skipped (7), Tests 50 passed | 3 skipped (53)
npm run build:prod -> Build complete
```

No test stubs were modified. The existing `medkit-api.test.ts` only covers `listComponents` - there are no pre-existing faults/bulk-data unit tests to break or adjust.

## Files changed

- `/home/bburda/workspace/wt/foxglove-migrate-client/src/api-dispatch.ts` - added 6 dispatch functions (faults + bulk-data)
- `/home/bburda/workspace/wt/foxglove-migrate-client/src/medkit-api.ts` - migrated 7 methods, updated imports

## Self-review

- No path-level `as never` / `as any` - all dispatch uses typed literal paths.
- All public signatures unchanged (panels compile without change).
- `getBulkDataDownloadUrl` retained as URL-builder; `this.base` and `this.prefix` remain.
- `subscribeFaultStream` untouched.
- Error semantics: throw-on-error via `throwApiError` for all migrated methods.
- No em-dashes; copyright headers retained.
- `fetchJSON` dead after this task - left for T6.

## Concerns

None. All paths confirmed present in 0.5.0 schema before implementation.
