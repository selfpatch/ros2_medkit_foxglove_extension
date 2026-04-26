// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
//
// SOVD ISO 17978-3 client for the gateway's /updates resource. Mirrors the
// canonical implementation in ros2_medkit_web_ui's `lib/updates-api.ts` so
// the Foxglove panel and the web UI stay structurally identical.

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

async function ensureOk(res: Response): Promise<void> {
    if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
            const body = (await res.json()) as { message?: string };
            if (body.message) message = body.message;
        } catch {
            // ignore parse errors
        }
        throw new UpdatesApiError(message, res.status);
    }
}

function updatePath(baseUrl: string, id: string, suffix?: string): string {
    const encoded = encodeURIComponent(id);
    return suffix ? `${baseUrl}/updates/${encoded}/${suffix}` : `${baseUrl}/updates/${encoded}`;
}

/** GET /updates - returns list of update IDs (SOVD: `{items: [<id>]}`). */
export async function fetchUpdateIds(
    baseUrl: string,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<string[]> {
    const res = await fetchImpl(`${baseUrl}/updates`, { signal });
    await ensureOk(res);
    const data = (await res.json()) as { items?: unknown };
    return Array.isArray(data?.items) ? (data.items as string[]) : [];
}

/** GET /updates/{id}/status - returns status with progress. */
export async function fetchUpdateStatus(
    baseUrl: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<UpdateStatus> {
    const res = await fetchImpl(updatePath(baseUrl, id, "status"), { signal });
    await ensureOk(res);
    const data = (await res.json()) as Partial<UpdateStatus>;
    if (typeof data?.status !== "string") {
        throw new UpdatesApiError("Invalid status response", 0);
    }
    return data as UpdateStatus;
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
    const res = await fetchImpl(updatePath(baseUrl, id), { signal });
    await ensureOk(res);
    return (await res.json()) as Record<string, unknown>;
}

/** PUT /updates/{id}/prepare - start preparation (202 Accepted). */
export async function triggerPrepare(
    baseUrl: string,
    id: string,
    body?: unknown,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<void> {
    const res = await fetchImpl(updatePath(baseUrl, id, "prepare"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal,
    });
    await ensureOk(res);
}

/** PUT /updates/{id}/execute - start execution (202 Accepted). */
export async function triggerExecute(
    baseUrl: string,
    id: string,
    body?: unknown,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<void> {
    const res = await fetchImpl(updatePath(baseUrl, id, "execute"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal,
    });
    await ensureOk(res);
}

/** PUT /updates/{id}/automated - prepare+execute combined (202 Accepted). */
export async function triggerAutomated(
    baseUrl: string,
    id: string,
    body?: unknown,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<void> {
    const res = await fetchImpl(updatePath(baseUrl, id, "automated"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal,
    });
    await ensureOk(res);
}

/** DELETE /updates/{id} - remove the update package (204 No Content). */
export async function deleteUpdate(
    baseUrl: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<void> {
    const res = await fetchImpl(updatePath(baseUrl, id), { method: "DELETE", signal });
    await ensureOk(res);
}
