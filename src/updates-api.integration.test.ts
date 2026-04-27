// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
//
// Integration smoke: drive the actual updates-api.ts (not a mock) against
// a live ros2_medkit gateway and assert SOVD spec shape end-to-end.
//
// Skipped unless OTA_GATEWAY_BASE is set, so this does not run in unit-test
// CI. Run manually with:
//   docker compose up -d --build           # in the demo
//   docker network connect ota_nav2_sensor_fix_otanet $(hostname)
//   OTA_GATEWAY_BASE=http://ota_demo_gateway:8080/api/v1 npx vitest run \
//       src/updates-api.integration.test.ts

import { describe, expect, it } from "vitest";
import {
    UpdatesApiError,
    fetchUpdateIds,
    fetchUpdateStatus,
    fetchUpdateDetail,
} from "./updates-api";

const BASE = process.env.OTA_GATEWAY_BASE;

const skipUnlessLive = BASE ? describe : describe.skip;

skipUnlessLive("updates-api against live gateway", () => {
    it("fetches all 3 catalog ids via /updates {items: [...]}", async () => {
        const ids = await fetchUpdateIds(BASE!);
        expect(ids).toContain("fixed_lidar_2_1_0");
        expect(ids).toContain("obstacle_classifier_v2_1_0_0");
        expect(ids).toContain("broken_lidar_legacy_remove");
    });

    it("fixed_lidar detail follows SOVD spec field names", async () => {
        const d = await fetchUpdateDetail(BASE!, "fixed_lidar_2_1_0");
        expect(d.update_name).toBeTypeOf("string");
        expect(d).not.toHaveProperty("name");
        expect(d.x_medkit_version).toBe("2.1.0");
        expect(d).not.toHaveProperty("version");
        expect(d.updated_components).toContain("scan_sensor_node");
        expect(d.x_medkit_replaces_executable).toBe("broken_lidar_node");
    });

    it("status before any operation throws UpdatesApiError(404)", async () => {
        try {
            await fetchUpdateStatus(BASE!, "fixed_lidar_2_1_0");
            throw new Error("expected throw");
        } catch (e) {
            expect(e).toBeInstanceOf(UpdatesApiError);
            expect((e as UpdatesApiError).status).toBe(404);
        }
    });
});
