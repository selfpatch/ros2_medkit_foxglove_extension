// Copyright 2024-2026 bburda. Apache-2.0 license.
import { afterEach, describe, expect, it, vi } from "vitest";

import { MedkitApiClient } from "./medkit-api";

afterEach(() => vi.unstubAllGlobals());

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
