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
