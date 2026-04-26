// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";

import { UpdatesPanelView } from "./UpdatesPanel";

const BASE = "http://gw/api/v1";

interface FakeRoute {
    method: "GET" | "PUT" | "DELETE";
    pathSuffix: string;
    response: () => Response;
}

function buildFetch(routes: FakeRoute[]): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET") as "GET" | "PUT" | "DELETE";
        const path = url.replace(BASE, "");
        for (const route of routes) {
            if (route.method === method && path === route.pathSuffix) {
                return route.response();
            }
        }
        return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
}

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("UpdatesPanelView", () => {
    it("renders update IDs and status badges", async () => {
        const f = buildFetch([
            {
                method: "GET",
                pathSuffix: "/updates",
                response: () =>
                    jsonResponse({ items: ["fixed_lidar_2_1_0", "obstacle_classifier_v2_1_0_0"] }),
            },
            {
                method: "GET",
                pathSuffix: "/updates/fixed_lidar_2_1_0/status",
                response: () => jsonResponse({ status: "completed", progress: 100 }),
            },
            {
                method: "GET",
                pathSuffix: "/updates/obstacle_classifier_v2_1_0_0/status",
                response: () => jsonResponse({ status: "pending" }),
            },
        ]);
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => {
            expect(screen.getByText("fixed_lidar_2_1_0")).toBeInTheDocument();
            expect(screen.getByText("obstacle_classifier_v2_1_0_0")).toBeInTheDocument();
            expect(screen.getByText("completed")).toBeInTheDocument();
            expect(screen.getByText("pending")).toBeInTheDocument();
        });
    });

    it("shows 'no UpdateProvider' message when gateway returns 501", async () => {
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({}, 501) },
        ]);
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => {
            expect(screen.getByText(/no UpdateProvider/i)).toBeInTheDocument();
        });
    });

    it("shows action buttons appropriate for each status", async () => {
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({ items: ["u1"] }) },
            {
                method: "GET",
                pathSuffix: "/updates/u1/status",
                response: () => jsonResponse({ status: "pending" }),
            },
        ]);
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => screen.getByText("u1"));
        // pending -> prepare, execute, automated, delete
        expect(screen.getByRole("button", { name: /^prepare$/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^execute$/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^automated$/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
    });

    it("triggers PUT /updates/{id}/prepare when Prepare clicked", async () => {
        const prepareCall = vi.fn(() => new Response(null, { status: 202 }));
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({ items: ["u1"] }) },
            {
                method: "GET",
                pathSuffix: "/updates/u1/status",
                response: () => jsonResponse({ status: "pending" }),
            },
            { method: "PUT", pathSuffix: "/updates/u1/prepare", response: prepareCall },
        ]);
        const user = userEvent.setup();
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => screen.getByText("u1"));
        await user.click(screen.getByRole("button", { name: /^prepare$/i }));
        expect(prepareCall).toHaveBeenCalled();
    });

    it("opens details dialog and fetches GET /updates/{id} lazily", async () => {
        const detailCall = vi.fn(() =>
            jsonResponse({
                id: "u1",
                update_name: "lidar fix",
                updated_components: ["scan_sensor_node"],
                x_medkit_version: "2.1.0",
            }),
        );
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({ items: ["u1"] }) },
            {
                method: "GET",
                pathSuffix: "/updates/u1/status",
                response: () => jsonResponse({ status: "completed", progress: 100 }),
            },
            { method: "GET", pathSuffix: "/updates/u1", response: detailCall },
        ]);
        const user = userEvent.setup();
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => screen.getByText("u1"));
        await user.click(screen.getByRole("button", { name: /^details$/i }));
        await waitFor(() => {
            expect(detailCall).toHaveBeenCalled();
            expect(screen.getByText(/lidar fix/)).toBeInTheDocument();
            expect(screen.getByText(/x_medkit_version/)).toBeInTheDocument();
        });
    });

    it("renders error banner when /updates throws non-501", async () => {
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({ message: "boom" }, 500) },
        ]);
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => {
            expect(screen.getByRole("alert").textContent).toContain("boom");
        });
    });
});
