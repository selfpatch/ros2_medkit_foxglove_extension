// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// SOVD ISO 17978-3 client for the gateway's /updates resource. Mirrors the
// canonical implementation in ros2_medkit_web_ui's `lib/updates-api.ts` so
// the Foxglove panel and the web UI stay structurally identical.

import { createMedkitClient, isMedkitError } from "@selfpatch/ros2-medkit-client-ts";

export class UpdatesApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = "UpdatesApiError";
        this.status = status;
    }
}

export interface UpdateStatus {
    status: string;
    progress?: number;
    sub_progress?: { name: string; progress: number }[];
    [extension: string]: unknown;
}

/** Throw an UpdatesApiError from the typed client's error value.
 *
 * The typed client's errorMiddleware transforms all non-2xx responses into a
 * MedkitError object (with `.status`, `.message`, `.error_code`). We re-wrap
 * it as UpdatesApiError so callers (UpdatesPanel) only have to deal with one
 * error type and can branch on `.status` (501 -> notAvailable, 404 -> ready,
 * 0 -> invalid status response). A raw MedkitApiError must never escape. */
function throwFromClientError(error: unknown): never {
    if (isMedkitError(error)) {
        throw new UpdatesApiError(error.message, error.status);
    }
    const msg =
        typeof error === "object" && error !== null && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
    throw new UpdatesApiError(msg, 0);
}

/** GET /updates - returns list of update IDs (SOVD: `{items: [<id>]}`). */
export async function fetchUpdateIds(
    baseUrl: string,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<string[]> {
    const client = createMedkitClient({ baseUrl, fetch: fetchImpl });
    const { data, error } = await client.GET("/updates", { signal });
    if (error) throwFromClientError(error);
    // Accept both the SOVD `{items: [<id string>]}` shape and gateways that
    // return `{items: [{id, ...}]}` objects; anything else is dropped so a
    // malformed item never reaches the panel's `id.localeCompare` sort.
    const items = (data as unknown as { items?: unknown })?.items;
    if (!Array.isArray(items)) return [];
    return (items as unknown[])
        .map((it): string | undefined => {
            if (typeof it === "string") return it;
            if (it && typeof it === "object" && typeof (it as { id?: unknown }).id === "string") {
                return (it as { id: string }).id;
            }
            return undefined;
        })
        .filter((x): x is string => x !== undefined);
}

/** GET /updates/{id}/status - returns status with progress. */
export async function fetchUpdateStatus(
    baseUrl: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<UpdateStatus> {
    const client = createMedkitClient({ baseUrl, fetch: fetchImpl });
    const { data, error } = await client.GET("/updates/{update_id}/status", {
        params: { path: { update_id: id } },
        signal,
    });
    if (error) throwFromClientError(error);
    const raw = data as unknown as Partial<UpdateStatus>;
    if (typeof raw?.status !== "string") {
        throw new UpdatesApiError("Invalid status response", 0);
    }
    // `status` is the only field we hard-require; drop a non-numeric
    // `progress` so the panel never renders `NaN%` / a bogus aria-valuenow
    // from a non-conformant gateway.
    if (raw.progress !== undefined && typeof raw.progress !== "number") {
        delete raw.progress;
    }
    return raw as UpdateStatus;
}

/** GET /updates/{id} - returns full plugin-defined detail. Untyped because
 * the SOVD detail set is fully open and gateways can return arbitrary
 * `x_*` extensions alongside the spec fields. */
export async function fetchUpdateDetail(
    baseUrl: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<Record<string, unknown>> {
    const client = createMedkitClient({ baseUrl, fetch: fetchImpl });
    const { data, error } = await client.GET("/updates/{update_id}", {
        params: { path: { update_id: id } },
        signal,
    });
    if (error) throwFromClientError(error);
    return data as unknown as Record<string, unknown>;
}

/** POST /updates - register a new update package (201 Created). The body
 * is the SOVD update detail object (id + update_name + one of
 * added/updated/removed_components, plus any x_* extensions the gateway's
 * UpdateProvider plugin understands). */
export async function registerUpdate(
    baseUrl: string,
    metadata: Record<string, unknown>,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<void> {
    const client = createMedkitClient({ baseUrl, fetch: fetchImpl });
    // UpdateRegisterRequest schema is `{[key: string]: unknown}` - cast through
    // unknown to satisfy the typed body parameter.
    const { error } = await client.POST("/updates", {
        body: metadata as unknown as Record<string, never>,
        signal,
    });
    if (error) throwFromClientError(error);
}

/** PUT /updates/{id}/prepare - start preparation (202 Accepted).
 * The body param is accepted for API compatibility; the SOVD schema for this
 * endpoint defines no requestBody so the typed client takes no body. */
export async function triggerPrepare(
    baseUrl: string,
    id: string,
    body?: unknown,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<void> {
    void body; // schema has no requestBody for this verb
    const client = createMedkitClient({ baseUrl, fetch: fetchImpl });
    const { error } = await client.PUT("/updates/{update_id}/prepare", {
        params: { path: { update_id: id } },
        signal,
    });
    if (error) throwFromClientError(error);
}

/** PUT /updates/{id}/execute - start execution (202 Accepted). */
export async function triggerExecute(
    baseUrl: string,
    id: string,
    body?: unknown,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<void> {
    void body;
    const client = createMedkitClient({ baseUrl, fetch: fetchImpl });
    const { error } = await client.PUT("/updates/{update_id}/execute", {
        params: { path: { update_id: id } },
        signal,
    });
    if (error) throwFromClientError(error);
}

/** PUT /updates/{id}/automated - prepare+execute combined (202 Accepted). */
export async function triggerAutomated(
    baseUrl: string,
    id: string,
    body?: unknown,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<void> {
    void body;
    const client = createMedkitClient({ baseUrl, fetch: fetchImpl });
    const { error } = await client.PUT("/updates/{update_id}/automated", {
        params: { path: { update_id: id } },
        signal,
    });
    if (error) throwFromClientError(error);
}

/** DELETE /updates/{id} - remove the update package (204 No Content). */
export async function deleteUpdate(
    baseUrl: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<void> {
    const client = createMedkitClient({ baseUrl, fetch: fetchImpl });
    const { error } = await client.DELETE("/updates/{update_id}", {
        params: { path: { update_id: id } },
        signal,
    });
    if (error) throwFromClientError(error);
}
