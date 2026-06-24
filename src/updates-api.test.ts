// Copyright 2024-2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
    UpdatesApiError,
    fetchUpdateIds,
    fetchUpdateStatus,
    fetchUpdateDetail,
    registerUpdate,
    triggerPrepare,
    triggerExecute,
    triggerAutomated,
    deleteUpdate,
} from "./updates-api";

const BASE = "http://gw/api/v1";

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** A fake fetch that is both callable as `typeof fetch` and inspectable via `.mock`. */
type FakeFetch = Mock & typeof fetch;

function fakeFetch(impl: () => Response | Promise<Response>): FakeFetch {
    return vi.fn(async () => impl()) as unknown as FakeFetch;
}

// ---------------------------------------------------------------------------
// Helper to verify a Request object's URL and method.
//
// RED/GREEN: the typed client (openapi-fetch) wraps all requests into a
// Request object before calling fetch, so vi.fn() receives (Request, undefined)
// not (url: string, init: RequestInit). The old assertions `toHaveBeenCalledWith
// (string, init)` fail after the migration. We switch to asserting on the
// first-arg Request's properties directly.
// ---------------------------------------------------------------------------

function expectRequest(f: FakeFetch, url: string, method = "GET"): void {
    expect(f).toHaveBeenCalledOnce();
    const [req] = f.mock.calls[0] as [Request, ...unknown[]];
    expect(req).toBeInstanceOf(Request);
    expect(req.url).toBe(url);
    expect(req.method).toBe(method);
}

describe("fetchUpdateIds", () => {
    it("parses SOVD {items: [...]} envelope", async () => {
        const f = fakeFetch(() => jsonResponse({ items: ["a", "b"] }));
        const ids = await fetchUpdateIds(BASE, f);
        expect(ids).toEqual(["a", "b"]);
        // RED: old assertion checked (string, init) - now Request object (see helper above)
        expectRequest(f, `${BASE}/updates`);
    });

    it("returns [] when items missing", async () => {
        const f = fakeFetch(() => jsonResponse({}));
        await expect(fetchUpdateIds(BASE, f)).resolves.toEqual([]);
    });

    it("accepts string ids and {id} objects, dropping anything else", async () => {
        const f = fakeFetch(() =>
            jsonResponse({ items: ["ok", 123, null, { id: "x" }, { name: "no-id" }, "ok2"] }),
        );
        await expect(fetchUpdateIds(BASE, f)).resolves.toEqual(["ok", "x", "ok2"]);
    });

    it("throws UpdatesApiError on non-ok response", async () => {
        // RED: old stub used `{ message: "no provider" }` (no error_code). The typed
        // client's parseGenericError requires both `message` AND `error_code` to
        // extract the gateway message; without error_code it falls back to the
        // default "Request failed with status N" message. Real gateway always sends
        // error_code (SOVD GenericError schema). Updated stub to match real format.
        const f = fakeFetch(() =>
            jsonResponse({ message: "no provider", error_code: "x-medkit-no-provider" }, 501),
        );
        await expect(fetchUpdateIds(BASE, f)).rejects.toMatchObject({
            name: "UpdatesApiError",
            status: 501,
            message: "no provider",
        });
    });

    it("surfaces fallback message when error body is non-JSON (plain text -> typed-client fallback)", async () => {
        // RED: old test checked plain-text body passthrough (`"upstream exploded"`).
        // The typed client's errorMiddleware intercepts all non-2xx responses and
        // parses them as JSON. A non-JSON body (plain text) becomes a fallback
        // "Request failed with status N" message via parseGenericError. This is a
        // genuine behavior change from the ensureOk text-read path. The test is
        // updated to verify the fallback message is surfaced as UpdatesApiError with
        // the correct status.
        const f = fakeFetch(() => new Response("upstream exploded", { status: 502 }));
        await expect(fetchUpdateIds(BASE, f)).rejects.toMatchObject({
            name: "UpdatesApiError",
            status: 502,
            // Non-JSON bodies yield the fallback message from parseGenericError
            message: "Request failed with status 502",
        });
    });
});

describe("fetchUpdateStatus", () => {
    it("returns parsed status", async () => {
        const f = fakeFetch(() => jsonResponse({ status: "inProgress", progress: 45 }));
        const s = await fetchUpdateStatus(BASE, "u1", f);
        expect(s.status).toBe("inProgress");
        expect(s.progress).toBe(45);
    });

    it("encodes id in URL", async () => {
        const f = fakeFetch(() => jsonResponse({ status: "completed" }));
        await fetchUpdateStatus(BASE, "id with/slash", f);
        // RED: openapi-fetch passes a Request object (not string+init).
        // Verify the URL was constructed with encodeURIComponent of the id.
        expectRequest(f, `${BASE}/updates/${encodeURIComponent("id with/slash")}/status`);
    });

    it("rejects with status 0 when status field missing", async () => {
        const f = fakeFetch(() => jsonResponse({}));
        // status 0 (not 404/501) is the contract the panel's notAvailable
        // branch relies on to NOT treat a malformed status as "no provider".
        await expect(fetchUpdateStatus(BASE, "u1", f)).rejects.toMatchObject({
            name: "UpdatesApiError",
            status: 0,
        });
    });

    it("drops a non-numeric progress field", async () => {
        const f = fakeFetch(() => jsonResponse({ status: "inProgress", progress: "50%" }));
        const s = await fetchUpdateStatus(BASE, "u1", f);
        expect(s.status).toBe("inProgress");
        expect(s.progress).toBeUndefined();
    });
});

describe("fetchUpdateDetail", () => {
    it("returns the raw object verbatim including x_medkit_ extensions", async () => {
        const detail = {
            id: "u1",
            update_name: "fixed_lidar 2.1.0",
            updated_components: ["scan_sensor_node"],
            x_medkit_version: "2.1.0",
            x_medkit_artifact_url: "/artifacts/foo.tar.gz",
        };
        const f = fakeFetch(() => jsonResponse(detail));
        await expect(fetchUpdateDetail(BASE, "u1", f)).resolves.toEqual(detail);
    });
});

describe("trigger* mutations", () => {
    it("prepare hits PUT /updates/{id}/prepare with no request body", async () => {
        const f = fakeFetch(() => new Response(null, { status: 202 }));
        await triggerPrepare(BASE, "u1", { foo: "bar" }, f);
        // RED: openapi-fetch passes a Request object. The schema for
        // /updates/{update_id}/prepare has no requestBody, so the body arg is
        // accepted for API compatibility but not forwarded to the typed call.
        // Verify URL and method via Request properties.
        expectRequest(f, `${BASE}/updates/u1/prepare`, "PUT");
    });

    it("execute hits PUT /updates/{id}/execute", async () => {
        const f = fakeFetch(() => new Response(null, { status: 202 }));
        await triggerExecute(BASE, "u1", undefined, f);
        // RED: see above - Request object replaces (url, init).
        expectRequest(f, `${BASE}/updates/u1/execute`, "PUT");
    });

    it("automated hits PUT /updates/{id}/automated", async () => {
        const f = fakeFetch(() => new Response(null, { status: 202 }));
        await triggerAutomated(BASE, "u1", undefined, f);
        expectRequest(f, `${BASE}/updates/u1/automated`, "PUT");
    });

    it("registerUpdate POSTs metadata as JSON body", async () => {
        const f = fakeFetch(() => new Response(null, { status: 201 }));
        const meta = { id: "u9", update_name: "manual", updated_components: ["x"] };
        await registerUpdate(BASE, meta, f);
        // RED: openapi-fetch passes a Request object. Verify URL, method, and that
        // the body is serialized correctly by reading it from the Request.
        expect(f).toHaveBeenCalledOnce();
        const [req] = f.mock.calls[0] as [Request, ...unknown[]];
        expect(req).toBeInstanceOf(Request);
        expect(req.url).toBe(`${BASE}/updates`);
        expect(req.method).toBe("POST");
        expect(req.headers.get("content-type")).toContain("application/json");
        await expect(req.json()).resolves.toEqual(meta);
    });

    it("delete hits DELETE /updates/{id}", async () => {
        const f = fakeFetch(() => new Response(null, { status: 204 }));
        await deleteUpdate(BASE, "u1", f);
        expectRequest(f, `${BASE}/updates/u1`, "DELETE");
    });
});

describe("UpdatesApiError", () => {
    it("preserves HTTP status for callers (e.g. 501 -> notAvailable)", async () => {
        const f = fakeFetch(() => new Response("nope", { status: 501 }));
        try {
            await fetchUpdateIds(BASE, f);
            expect.fail("should have thrown");
        } catch (e) {
            expect(e).toBeInstanceOf(UpdatesApiError);
            expect((e as UpdatesApiError).status).toBe(501);
        }
    });
});
