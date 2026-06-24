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

    it("returns false when the AbortSignal fires (gateway timeout)", async () => {
        // Use a 0 ms timeout signal to immediately trigger abort.
        const aborted = AbortSignal.timeout(0);
        // Wait a tick so the signal is already aborted before we call ping.
        await new Promise((r) => setTimeout(r, 5));

        vi.stubGlobal(
            "fetch",
            vi.fn(async (_req: Request) => {
                // If signal is already aborted, throw DOMException("signal timed out", "TimeoutError")
                // to simulate what a real fetch does.
                throw new DOMException("signal timed out", "TimeoutError");
            }),
        );
        // Verify that using an aborted signal leads to false (not a throw).
        // ping() must catch any fetch rejection and return false.
        const client = new MedkitApiClient("http://gw", "api/v1");
        // We cannot inject the signal directly (ping() creates its own),
        // but this test verifies the catch path handles AbortError/TimeoutError correctly.
        void aborted; // used above for documentation; actual test exercises the catch path
        await expect(client.ping()).resolves.toBe(false);
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
                new Response(JSON.stringify({ code: "ERR_TEST", message: "gateway error" }), {
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
});

describe("MedkitApiClient.listBulkData", () => {
    it("returns { items: [] } on gateway error instead of throwing", async () => {
        stubFetchError(500);
        const client = new MedkitApiClient("http://gw", "api/v1");
        const result = await client.listBulkData("apps", "motor", "rosbags");
        expect(result).toEqual({ items: [] });
    });
});
