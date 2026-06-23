// Copyright 2024-2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi } from "vitest";
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

describe("fetchUpdateIds", () => {
    it("parses SOVD {items: [...]} envelope", async () => {
        const f = vi.fn(async () => jsonResponse({ items: ["a", "b"] })) as unknown as typeof fetch;
        const ids = await fetchUpdateIds(BASE, f);
        expect(ids).toEqual(["a", "b"]);
        expect(f).toHaveBeenCalledWith(`${BASE}/updates`, expect.objectContaining({}));
    });

    it("returns [] when items missing", async () => {
        const f = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
        await expect(fetchUpdateIds(BASE, f)).resolves.toEqual([]);
    });

    it("filters out non-string items instead of crashing on a malformed list", async () => {
        const f = vi.fn(async () =>
            jsonResponse({ items: ["ok", 123, null, { id: "x" }, "ok2"] }),
        ) as unknown as typeof fetch;
        await expect(fetchUpdateIds(BASE, f)).resolves.toEqual(["ok", "ok2"]);
    });

    it("throws UpdatesApiError on non-ok response", async () => {
        const f = vi.fn(async () => jsonResponse({ message: "no provider" }, 501)) as unknown as typeof fetch;
        await expect(fetchUpdateIds(BASE, f)).rejects.toMatchObject({
            name: "UpdatesApiError",
            status: 501,
            message: "no provider",
        });
    });
});

describe("fetchUpdateStatus", () => {
    it("returns parsed status", async () => {
        const f = vi.fn(async () =>
            jsonResponse({ status: "inProgress", progress: 45 }),
        ) as unknown as typeof fetch;
        const s = await fetchUpdateStatus(BASE, "u1", f);
        expect(s.status).toBe("inProgress");
        expect(s.progress).toBe(45);
    });

    it("encodes id in URL", async () => {
        const f = vi.fn(async () => jsonResponse({ status: "completed" })) as unknown as typeof fetch;
        await fetchUpdateStatus(BASE, "id with/slash", f);
        expect(f).toHaveBeenCalledWith(
            `${BASE}/updates/${encodeURIComponent("id with/slash")}/status`,
            expect.any(Object),
        );
    });

    it("rejects with status 0 when status field missing", async () => {
        const f = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
        // status 0 (not 404/501) is the contract the panel's notAvailable
        // branch relies on to NOT treat a malformed status as "no provider".
        await expect(fetchUpdateStatus(BASE, "u1", f)).rejects.toMatchObject({
            name: "UpdatesApiError",
            status: 0,
        });
    });

    it("drops a non-numeric progress field", async () => {
        const f = vi.fn(async () =>
            jsonResponse({ status: "inProgress", progress: "50%" }),
        ) as unknown as typeof fetch;
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
        const f = vi.fn(async () => jsonResponse(detail)) as unknown as typeof fetch;
        await expect(fetchUpdateDetail(BASE, "u1", f)).resolves.toEqual(detail);
    });
});

describe("trigger* mutations", () => {
    it("prepare hits PUT /updates/{id}/prepare with JSON body", async () => {
        const f = vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch;
        await triggerPrepare(BASE, "u1", { foo: "bar" }, f);
        expect(f).toHaveBeenCalledWith(
            `${BASE}/updates/u1/prepare`,
            expect.objectContaining({
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ foo: "bar" }),
            }),
        );
    });

    it("execute hits PUT /updates/{id}/execute", async () => {
        const f = vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch;
        await triggerExecute(BASE, "u1", undefined, f);
        expect(f).toHaveBeenCalledWith(
            `${BASE}/updates/u1/execute`,
            expect.objectContaining({ method: "PUT" }),
        );
    });

    it("automated hits PUT /updates/{id}/automated", async () => {
        const f = vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch;
        await triggerAutomated(BASE, "u1", undefined, f);
        expect(f).toHaveBeenCalledWith(
            `${BASE}/updates/u1/automated`,
            expect.objectContaining({ method: "PUT" }),
        );
    });

    it("registerUpdate POSTs metadata as JSON body", async () => {
        const f = vi.fn(async () => new Response(null, { status: 201 })) as unknown as typeof fetch;
        const meta = { id: "u9", update_name: "manual", updated_components: ["x"] };
        await registerUpdate(BASE, meta, f);
        expect(f).toHaveBeenCalledWith(
            `${BASE}/updates`,
            expect.objectContaining({
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(meta),
            }),
        );
    });

    it("delete hits DELETE /updates/{id}", async () => {
        const f = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
        await deleteUpdate(BASE, "u1", f);
        expect(f).toHaveBeenCalledWith(
            `${BASE}/updates/u1`,
            expect.objectContaining({ method: "DELETE" }),
        );
    });
});

describe("UpdatesApiError", () => {
    it("preserves HTTP status for callers (e.g. 501 -> notAvailable)", async () => {
        const f = vi.fn(async () => new Response("nope", { status: 501 })) as unknown as typeof fetch;
        try {
            await fetchUpdateIds(BASE, f);
            expect.fail("should have thrown");
        } catch (e) {
            expect(e).toBeInstanceOf(UpdatesApiError);
            expect((e as UpdatesApiError).status).toBe(501);
        }
    });
});
