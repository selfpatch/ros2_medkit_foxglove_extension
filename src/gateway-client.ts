// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Factory that builds a typed Medkit client from the extension's shared
// gateway connection. Used by medkit-api.ts and updates-api.ts as the engine
// for all gateway communication instead of raw fetch.

import { createMedkitClient } from "@selfpatch/ros2-medkit-client-ts";
export type { MedkitClient } from "@selfpatch/ros2-medkit-client-ts";
export { MedkitApiError, isMedkitError } from "@selfpatch/ros2-medkit-client-ts";

import { joinConnection, type GatewayConnection } from "./shared-connection";

/** Shared timeout config for all gateway calls. */
const GATEWAY_TIMEOUTS = { operations: 30_000, downloads: 300_000 } as const;

/** Build a typed Medkit client for the given base URL.
 *
 * Applies the shared timeout defaults (30 s operations, 300 s downloads).
 * Pass `opts.fetch` to inject a fake fetch in tests.
 *
 * @example
 *   const client = createGatewayClientForUrl('http://robot:8080/api/v1');
 *   const { data, error } = await client.GET('/apps');
 */
export function createGatewayClientForUrl(
    baseUrl: string,
    opts?: { fetch?: typeof globalThis.fetch },
) {
    return createMedkitClient({
        baseUrl,
        timeout: GATEWAY_TIMEOUTS,
        fetch: opts?.fetch,
    });
}

/** Build a typed Medkit client for the given gateway connection.
 *
 * The returned client is an openapi-fetch client extended with `.streams`
 * for SSE subscriptions. Pass `opts.fetch` to inject a fake fetch in tests.
 *
 * @example
 *   const client = createGatewayClient(conn);
 *   const { data, error } = await client.GET('/apps');
 */
export function createGatewayClient(
    conn: GatewayConnection,
    opts?: { fetch?: typeof globalThis.fetch },
) {
    return createGatewayClientForUrl(joinConnection(conn), opts);
}
