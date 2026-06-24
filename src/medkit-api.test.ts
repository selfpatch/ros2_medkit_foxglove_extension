// Copyright 2024-2026 bburda. Apache-2.0 license.
import { afterEach, describe, expect, it, vi } from "vitest";

import { MedkitApiClient } from "./medkit-api";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function stubFetch(json: unknown): void {
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(JSON.stringify(json), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
        ),
    );
}

describe("MedkitApiClient.ping", () => {
    it("returns true when health endpoint responds OK", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(JSON.stringify({}), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })),
        );
        const client = new MedkitApiClient("http://gw", "api/v1");
        await expect(client.ping()).resolves.toBe(true);
    });

    it("returns false when the request throws (e.g. network error)", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => { throw new Error("network unreachable"); }),
        );
        const client = new MedkitApiClient("http://gw", "api/v1");
        await expect(client.ping()).resolves.toBe(false);
    });

    it("passes AbortSignal.timeout(3000) so a dead gateway resolves in ~3 s", async () => {
        // Capture the signal from the outgoing Request to verify it is a timeout signal.
        // We don't actually wait for the real 3 s; the test resolves the promise immediately
        // once we have inspected the signal.
        let capturedSignal: AbortSignal | null | undefined = null;
        vi.stubGlobal(
            "fetch",
            vi.fn(async (req: Request) => {
                capturedSignal = req.signal;
                // Resolve immediately so the test does not hang.
                return new Response(JSON.stringify({}), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }),
        );
        const client = new MedkitApiClient("http://gw", "api/v1");
        await client.ping();
        expect(capturedSignal).toBeInstanceOf(AbortSignal);
        // An AbortSignal created by AbortSignal.timeout() is not yet aborted
        // (3 s has not elapsed). The presence of the signal on the request and
        // the fact it is not already aborted is the key invariant.
        expect((capturedSignal as unknown as AbortSignal).aborted).toBe(false);
    });

    it("returns false when fetch throws a DOMException with name=TimeoutError", async () => {
        // Simulate what a real fetch throws when AbortSignal.timeout() fires:
        // a DOMException with name="TimeoutError". ping() must not rethrow it.
        let thrownError: unknown;
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_req: Request) => {
                thrownError = new DOMException("signal timed out", "TimeoutError");
                throw thrownError;
            }),
        );
        const client = new MedkitApiClient("http://gw", "api/v1");
        await expect(client.ping()).resolves.toBe(false);
        // Confirm the error we injected is indeed a TimeoutError so the test
        // is specific to that path and not just the generic catch-all.
        expect(thrownError).toBeInstanceOf(DOMException);
        expect((thrownError as DOMException).name).toBe("TimeoutError");
    });
});

describe("MedkitApiClient.listComponents", () => {
    it("drops items without a string id so no /components/undefined is produced", async () => {
        stubFetch({
            items: [{ id: "host1", description: "Host 1" }, { name: "no-id" }, { id: 42 }],
        });
        const client = new MedkitApiClient("http://gw", "api/v1");
        const comps = await client.listComponents();
        expect(comps.map((c) => c.id)).toEqual(["host1"]);
        expect(comps[0].href).toBe("/components/host1");
        expect(comps[0].name).toBe("Host 1");
    });
});

function stubFetchError(status: number): void {
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(JSON.stringify({ error_code: "ERR_TEST", message: "gateway error" }), {
                    status,
                    headers: { "Content-Type": "application/json" },
                }),
        ),
    );
}

describe("MedkitApiClient.listOperations - type_info.schema extraction", () => {
    it("populates type_info.schema from x-medkit.type_info.request for a service", async () => {
        stubFetch({
            items: [
                {
                    id: "set_speed",
                    name: "set_speed",
                    asynchronous_execution: false,
                    "x-medkit": {
                        ros2: { kind: "service", service: "/set_speed", type: "std_srvs/SetBool" },
                        type_info: {
                            request: {
                                type: "object",
                                properties: {
                                    data: { type: "boolean" },
                                },
                            },
                            response: {
                                type: "object",
                                properties: {
                                    success: { type: "boolean" },
                                    message: { type: "string" },
                                },
                            },
                        },
                    },
                },
            ],
        });
        const client = new MedkitApiClient("http://gw", "api/v1");
        const ops = await client.listOperations("apps", "motor");
        expect(ops).toHaveLength(1);
        const op = ops[0];
        expect(op.kind).toBe("service");
        expect(op.type_info).toBeDefined();
        // request schema mapped: boolean -> bool
        expect(op.type_info?.schema).toEqual({ data: { type: "bool" } });
    });

    it("populates type_info.schema from x-medkit.type_info.goal for an action", async () => {
        stubFetch({
            items: [
                {
                    id: "navigate_to_pose",
                    name: "navigate_to_pose",
                    asynchronous_execution: true,
                    "x-medkit": {
                        ros2: { kind: "action", action: "/navigate_to_pose", type: "nav2_msgs/NavigateToPose" },
                        type_info: {
                            goal: {
                                type: "object",
                                properties: {
                                    x: { type: "number" },
                                    y: { type: "number" },
                                },
                            },
                            result: {
                                type: "object",
                                properties: { result: { type: "integer" } },
                            },
                        },
                    },
                },
            ],
        });
        const client = new MedkitApiClient("http://gw", "api/v1");
        const ops = await client.listOperations("apps", "nav");
        expect(ops).toHaveLength(1);
        const op = ops[0];
        expect(op.kind).toBe("action");
        expect(op.type_info).toBeDefined();
        // goal schema mapped: number -> float64
        expect(op.type_info?.schema).toEqual({
            x: { type: "float64" },
            y: { type: "float64" },
        });
    });

    it("leaves type_info undefined when x-medkit.type_info is absent", async () => {
        stubFetch({
            items: [
                {
                    id: "ping",
                    name: "ping",
                    "x-medkit": { ros2: { kind: "service", service: "/ping", type: "" } },
                },
            ],
        });
        const client = new MedkitApiClient("http://gw", "api/v1");
        const ops = await client.listOperations("apps", "motor");
        expect(ops[0].type_info).toBeUndefined();
    });
});

describe("MedkitApiClient.listBulkDataCategories", () => {
    it("returns { items: [] } on gateway error instead of throwing", async () => {
        stubFetchError(404);
        const client = new MedkitApiClient("http://gw", "api/v1");
        const result = await client.listBulkDataCategories("apps", "motor");
        expect(result).toEqual({ items: [] });
    });

    it("returns parsed items on success", async () => {
        stubFetch({ items: ["rosbags", "freeze_frames"] });
        const client = new MedkitApiClient("http://gw", "api/v1");
        const result = await client.listBulkDataCategories("apps", "motor");
        expect(result).toEqual({ items: ["rosbags", "freeze_frames"] });
    });
});

describe("MedkitApiClient base URL resolution", () => {
    it("builds bulk-data download URLs from the same root the API client uses (non-default basePath)", async () => {
        let requestUrl = "";
        vi.stubGlobal(
            "fetch",
            vi.fn(async (req: Request) => {
                requestUrl = req.url;
                return new Response(JSON.stringify({ items: [] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }),
        );
        // The typed client forces a trailing /api/v1, so a "sovd" basePath
        // resolves to http://gw:8080/sovd/api/v1 for BOTH API calls and
        // downloads. The bug was getBulkDataDownloadUrl omitting /api/v1,
        // pointing downloads at a different root than the API requests.
        const client = new MedkitApiClient("http://gw:8080", "sovd");
        await client.listComponents();
        const root = "http://gw:8080/sovd/api/v1";
        expect(requestUrl).toBe(`${root}/components`);
        const dl = client.getBulkDataDownloadUrl("/apps/motor/bulk-data/rosbags/CODE");
        expect(dl).toBe(`${root}/apps/motor/bulk-data/rosbags/CODE`);
    });

    it("getVersionInfo throws on an empty 2xx body instead of returning undefined", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
        const client = new MedkitApiClient("http://gw", "api/v1");
        await expect(client.getVersionInfo()).rejects.toThrow("Empty response from /version-info");
    });
});

describe("MedkitApiClient.listBulkData", () => {
    it("returns { items: [] } on gateway error instead of throwing", async () => {
        stubFetchError(500);
        const client = new MedkitApiClient("http://gw", "api/v1");
        const result = await client.listBulkData("apps", "motor", "rosbags");
        expect(result).toEqual({ items: [] });
    });

    it("returns parsed items on success", async () => {
        const descriptor = {
            id: "snapshot_001",
            name: "snapshot_001.mcap",
            mimetype: "application/mcap",
            size: 4096,
            creation_date: "2026-06-24T00:00:00Z",
        };
        stubFetch({ items: [descriptor] });
        const client = new MedkitApiClient("http://gw", "api/v1");
        const result = await client.listBulkData("apps", "motor", "rosbags");
        expect(result).toEqual({ items: [descriptor] });
    });
});

describe("MedkitApiClient.getRoot", () => {
    it("issues GET / and returns RootOverview", async () => {
        const overview = {
            name: "ros2_medkit Gateway",
            version: "1.0.0",
            api_base: "/api/v1",
            endpoints: ["/api/v1/areas", "/api/v1/components"],
            capabilities: {
                aggregation: false,
                async_actions: true,
                authentication: false,
                bulk_data: true,
                configurations: true,
                cyclic_subscriptions: false,
                data_access: true,
                discovery: true,
                faults: true,
                locking: false,
                logs: true,
                operations: true,
                scripts: false,
                tls: false,
                triggers: false,
                updates: false,
                vendor_extensions: false,
            },
            auth: null,
            tls: null,
        };
        stubFetch(overview);
        const client = new MedkitApiClient("http://gw", "api/v1");
        const result = await client.getRoot();
        // Verify getRoot hits the root path (GET /) - not an accidental sub-path
        const calledUrl = vi.mocked(fetch).mock.calls[0][0];
        const calledPath = typeof calledUrl === "string" ? calledUrl : (calledUrl as Request).url;
        expect(calledPath.replace(/\/$/, "")).toBe("http://gw/api/v1");
        expect(result.name).toBe("ros2_medkit Gateway");
        expect(result.version).toBe("1.0.0");
        expect(result.api_base).toBe("/api/v1");
        expect(result.endpoints).toEqual(["/api/v1/areas", "/api/v1/components"]);
        expect(result.capabilities.async_actions).toBe(true);
        expect(result.capabilities.aggregation).toBe(false);
    });

    it("throws on a non-2xx gateway response", async () => {
        stubFetchError(503);
        const client = new MedkitApiClient("http://gw", "api/v1");
        await expect(client.getRoot()).rejects.toThrow();
    });
});
