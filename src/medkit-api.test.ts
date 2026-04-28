// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MedkitApiClient, MedkitApiError } from "./medkit-api";

const BASE = "http://gateway:8080";
const PATH = "api/v1";

function mockJson(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
        ...init,
    });
}

describe("MedkitApiClient.listLogs", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            mockJson({
                items: [
                    { id: "log_1", message: "hello", severity: "info", timestamp: "2026-01-01T00:00:00Z" },
                ],
            }),
        );
    });
    afterEach(() => fetchSpy.mockRestore());

    it("issues GET on the entity-scoped /logs path", async () => {
        const c = new MedkitApiClient(BASE, PATH);
        const items = await c.listLogs("apps", "bt_navigator");
        expect(items).toEqual([
            { id: "log_1", message: "hello", severity: "info", timestamp: "2026-01-01T00:00:00Z" },
        ]);
        expect(fetchSpy).toHaveBeenCalledWith(
            `${BASE}/${PATH}/apps/bt_navigator/logs`,
            expect.any(Object),
        );
    });

    it("encodes severity / limit / context as query params", async () => {
        const c = new MedkitApiClient(BASE, PATH);
        await c.listLogs("components", "lidar-cmp", {
            severity: "warning",
            limit: 50,
            context: "scan_sensor",
        });
        const calledUrl = (fetchSpy.mock.calls[0]?.[0] as string) ?? "";
        expect(calledUrl).toContain("/components/lidar-cmp/logs?");
        expect(calledUrl).toContain("severity=warning");
        expect(calledUrl).toContain("limit=50");
        expect(calledUrl).toContain("context=scan_sensor");
    });

    it("throws MedkitApiError with status on non-2xx", async () => {
        fetchSpy.mockResolvedValueOnce(mockJson({ error: "no logs here" }, { status: 404 }));
        const c = new MedkitApiClient(BASE, PATH);
        await expect(c.listLogs("apps", "ghost")).rejects.toMatchObject({
            name: "MedkitApiError",
            status: 404,
        });
    });
});

describe("MedkitApiClient.getExecution / cancelExecution", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        fetchSpy = vi.spyOn(globalThis, "fetch");
    });
    afterEach(() => fetchSpy.mockRestore());

    it("getExecution polls the /executions/{id} path and parses the snapshot", async () => {
        fetchSpy.mockResolvedValueOnce(
            mockJson({ id: "exec_42", status: "running", kind: "action" }),
        );
        const c = new MedkitApiClient(BASE, PATH);
        const snap = await c.getExecution("apps", "bt_navigator", "navigate_to_pose", "exec_42");
        expect(snap).toEqual({ id: "exec_42", status: "running", kind: "action" });
        const calledUrl = fetchSpy.mock.calls[0]?.[0];
        expect(calledUrl).toBe(
            `${BASE}/${PATH}/apps/bt_navigator/operations/navigate_to_pose/executions/exec_42`,
        );
    });

    it("getExecution percent-encodes operation name and execution id", async () => {
        fetchSpy.mockResolvedValueOnce(mockJson({ status: "completed" }));
        const c = new MedkitApiClient(BASE, PATH);
        await c.getExecution("apps", "n", "op/with slashes", "id with spaces");
        const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
        expect(calledUrl).toContain("/operations/op%2Fwith%20slashes/executions/id%20with%20spaces");
    });

    it("cancelExecution issues DELETE on the same path", async () => {
        fetchSpy.mockResolvedValueOnce(mockJson({}));
        const c = new MedkitApiClient(BASE, PATH);
        await c.cancelExecution("apps", "bt_navigator", "navigate_to_pose", "exec_42");
        const [url, init] = fetchSpy.mock.calls[0] ?? [];
        expect(url).toBe(
            `${BASE}/${PATH}/apps/bt_navigator/operations/navigate_to_pose/executions/exec_42`,
        );
        expect((init as RequestInit | undefined)?.method).toBe("DELETE");
    });
});

describe("MedkitApiError", () => {
    it("preserves the HTTP status so callers can branch on 404 / 503", () => {
        const e = new MedkitApiError("HTTP 404", 404);
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe("MedkitApiError");
        expect(e.status).toBe(404);
    });
});
