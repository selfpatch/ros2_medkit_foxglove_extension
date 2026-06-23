// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Factory that builds a typed Medkit client from the extension's shared
// gateway connection. Downstream tasks will use this as the engine for
// medkit-api.ts and updates-api.ts instead of raw fetch.

import { createMedkitClient } from "@selfpatch/ros2-medkit-client-ts";
export type { MedkitClient } from "@selfpatch/ros2-medkit-client-ts";
export { MedkitApiError } from "@selfpatch/ros2-medkit-client-ts";

import { joinConnection, type GatewayConnection } from "./shared-connection";

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
    return createMedkitClient({
        baseUrl: joinConnection(conn),
        timeout: { operations: 30_000, downloads: 300_000 },
        fetch: opts?.fetch,
    });
}
