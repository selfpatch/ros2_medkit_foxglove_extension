// Copyright 2024-2026 bburda. Apache-2.0 license.
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
    if (res.ok) return;
    let message = `HTTP ${res.status}`;
    try {
        // Read as text first so a non-JSON error body (plain text / HTML
        // from a proxy) is still surfaced instead of dropped to "HTTP <n>".
        const text = await res.text();
        if (text) {
            try {
                const body = JSON.parse(text) as { message?: unknown };
                message =
                    typeof body.message === "string" && body.message
                        ? body.message
                        : text.slice(0, 500);
            } catch {
                message = text.slice(0, 500);
            }
        }
    } catch {
        // ignore body read errors
    }
    throw new UpdatesApiError(message, res.status);
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
    // Accept both the SOVD `{items: [<id string>]}` shape and gateways that
    // return `{items: [{id, ...}]}` objects; anything else is dropped so a
    // malformed item never reaches the panel's `id.localeCompare` sort.
    if (!Array.isArray(data?.items)) return [];
    return (data.items as unknown[])
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
    const res = await fetchImpl(updatePath(baseUrl, id, "status"), { signal });
    await ensureOk(res);
    const data = (await res.json()) as Partial<UpdateStatus>;
    if (typeof data?.status !== "string") {
        throw new UpdatesApiError("Invalid status response", 0);
    }
    // `status` is the only field we hard-require; drop a non-numeric
    // `progress` so the panel never renders `NaN%` / a bogus aria-valuenow
    // from a non-conformant gateway.
    if (data.progress !== undefined && typeof data.progress !== "number") {
        delete data.progress;
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
    const res = await fetchImpl(`${baseUrl}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
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
