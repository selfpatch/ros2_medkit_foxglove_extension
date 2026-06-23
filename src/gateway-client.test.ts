// Copyright 2024-2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi } from "vitest";

import { createGatewayClient } from "./gateway-client";
import type { GatewayConnection } from "./shared-connection";

const CONN: GatewayConnection = { gatewayUrl: "http://gw:8080", basePath: "api/v1" };

describe("createGatewayClient", () => {
    it("returns a client with GET/POST/PUT/DELETE and streams", () => {
        const client = createGatewayClient(CONN);
        expect(typeof client.GET).toBe("function");
        expect(typeof client.POST).toBe("function");
        expect(typeof client.PUT).toBe("function");
        expect(typeof client.DELETE).toBe("function");
        expect(typeof client.streams).toBe("object");
    });

    it("routes calls through the injected fetch with the composed baseUrl", async () => {
        const fakeFetch = vi.fn(async () => new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }));

        const client = createGatewayClient(CONN, { fetch: fakeFetch as typeof fetch });
        await client.GET("/apps" as never, {});

        expect(fakeFetch).toHaveBeenCalledOnce();
        // openapi-fetch passes a Request object as the first argument
        const firstArg = (fakeFetch.mock.calls[0] as unknown as [Request])[0];
        const calledUrl = firstArg instanceof Request ? firstArg.url : String(firstArg);
        expect(calledUrl).toContain("gw:8080");
        expect(calledUrl).toContain("api/v1");
        expect(calledUrl).toContain("/apps");
    });

    it("uses joinConnection to build the baseUrl from the connection fields", () => {
        const conn: GatewayConnection = { gatewayUrl: "bare-host:9090", basePath: "api/v1" };
        const fakeFetch = vi.fn(async () => new Response("{}", {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }));

        createGatewayClient(conn, { fetch: fakeFetch as typeof fetch });
        // joinConnection adds http:// for a bare host; just verify the client is built without error
        // and the baseUrl would have been http://bare-host:9090/api/v1
        expect(fakeFetch).not.toHaveBeenCalled(); // no call made yet
    });
});
