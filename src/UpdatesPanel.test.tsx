// Copyright 2024-2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";

import { UpdatesPanelView } from "./UpdatesPanel";

const BASE = "http://gw/api/v1";

interface FakeRoute {
    method: "GET" | "PUT" | "DELETE" | "POST";
    pathSuffix: string;
    response: () => Response | Promise<Response>;
}

function buildFetch(routes: FakeRoute[]): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = (init?.method ?? "GET") as "GET" | "PUT" | "DELETE" | "POST";
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
        // pending -> prepare, execute, prepare & execute (automated), delete
        expect(screen.getByRole("button", { name: /^prepare$/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /^execute$/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /prepare & execute/i })).toBeInTheDocument();
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

    it("shows an Error badge (not Ready) when a per-id /status fetch fails", async () => {
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({ items: ["u1"] }) },
            {
                method: "GET",
                pathSuffix: "/updates/u1/status",
                response: () => jsonResponse({ message: "boom" }, 500),
            },
        ]);
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => expect(screen.getByText("Error")).toBeInTheDocument());
        expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    });

    it("disables Prepare/Execute/Automated for a completed update but keeps Delete", async () => {
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({ items: ["u1"] }) },
            {
                method: "GET",
                pathSuffix: "/updates/u1/status",
                response: () => jsonResponse({ status: "completed", progress: 100 }),
            },
        ]);
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => screen.getByText("u1"));
        expect(screen.getByRole("button", { name: /^prepare$/i })).toBeDisabled();
        expect(screen.getByRole("button", { name: /^execute$/i })).toBeDisabled();
        expect(screen.getByRole("button", { name: /prepare & execute/i })).toBeDisabled();
        expect(screen.getByRole("button", { name: /^delete$/i })).toBeEnabled();
    });

    it("asks for confirmation before issuing DELETE", async () => {
        const deleteCall = vi.fn(() => new Response(null, { status: 204 }));
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({ items: ["u1"] }) },
            {
                method: "GET",
                pathSuffix: "/updates/u1/status",
                response: () => jsonResponse({ status: "pending" }),
            },
            { method: "DELETE", pathSuffix: "/updates/u1", response: deleteCall },
        ]);
        const user = userEvent.setup();
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => screen.getByText("u1"));
        await user.click(screen.getByRole("button", { name: /^delete$/i }));
        const dialog = await screen.findByRole("dialog", { name: /confirm delete/i });
        expect(deleteCall).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));
        expect(deleteCall).toHaveBeenCalled();
    });

    it("closes the Register dialog on Escape", async () => {
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({ items: [] }) },
        ]);
        const user = userEvent.setup();
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await user.click(screen.getByRole("button", { name: /^register$/i }));
        expect(await screen.findByRole("dialog", { name: /register update/i })).toBeInTheDocument();
        await user.keyboard("{Escape}");
        await waitFor(() =>
            expect(screen.queryByRole("dialog", { name: /register update/i })).not.toBeInTheDocument(),
        );
    });

    it("asks for confirmation before issuing Execute", async () => {
        const executeCall = vi.fn(() => new Response(null, { status: 202 }));
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({ items: ["u1"] }) },
            {
                method: "GET",
                pathSuffix: "/updates/u1/status",
                response: () => jsonResponse({ status: "pending" }),
            },
            { method: "PUT", pathSuffix: "/updates/u1/execute", response: executeCall },
        ]);
        const user = userEvent.setup();
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => screen.getByText("u1"));
        await user.click(screen.getByRole("button", { name: /^execute$/i }));
        const dialog = await screen.findByRole("dialog", { name: /confirm execute/i });
        expect(executeCall).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole("button", { name: /^execute$/i }));
        expect(executeCall).toHaveBeenCalled();
    });

    it("blocks Register submit on an invalid package and does not POST", async () => {
        const postCall = vi.fn(() => new Response(null, { status: 201 }));
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({ items: [] }) },
            { method: "POST", pathSuffix: "/updates", response: postCall },
        ]);
        const user = userEvent.setup();
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await user.click(screen.getByRole("button", { name: /^register$/i }));
        const dialog = await screen.findByRole("dialog", { name: /register update/i });
        // Missing update_name and a components field -> validation rejects it.
        fireEvent.change(within(dialog).getByRole("textbox"), {
            target: { value: JSON.stringify({ id: "x" }) },
        });
        await user.click(within(dialog).getByRole("button", { name: /^register$/i }));
        expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
        expect(postCall).not.toHaveBeenCalled();
    });

    it("does not POST twice when Register is double-clicked", async () => {
        let releasePost: (r: Response) => void = () => {};
        const postCall = vi.fn(
            () => new Promise<Response>((res) => (releasePost = res)),
        );
        const f = buildFetch([
            { method: "GET", pathSuffix: "/updates", response: () => jsonResponse({ items: [] }) },
            { method: "POST", pathSuffix: "/updates", response: postCall },
        ]);
        const user = userEvent.setup();
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await user.click(screen.getByRole("button", { name: /^register$/i }));
        const dialog = await screen.findByRole("dialog", { name: /register update/i });
        // Default template is valid; both clicks land while the POST hangs.
        const submit = within(dialog).getByRole("button", { name: /^register$/i });
        await user.click(submit);
        await user.click(submit);
        expect(postCall).toHaveBeenCalledTimes(1);
        releasePost(new Response(null, { status: 201 }));
    });

    it("discards a stale refresh response so the latest result wins", async () => {
        let releaseFirst: (r: Response) => void = () => {};
        let listCall = 0;
        const f = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/updates")) {
                listCall += 1;
                if (listCall === 1) return new Promise<Response>((res) => (releaseFirst = res));
                return jsonResponse({ items: ["new1"] });
            }
            return jsonResponse({ status: "completed", progress: 100 });
        }) as unknown as typeof fetch;
        const user = userEvent.setup();
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        // Initial load (call 1) hangs; a manual Refresh (call 2) returns first.
        await user.click(screen.getByRole("button", { name: /^refresh$/i }));
        await waitFor(() => expect(screen.getByText("new1")).toBeInTheDocument());
        // Releasing the stale first response must not overwrite the latest.
        releaseFirst(jsonResponse({ items: ["stale0"] }));
        await new Promise((r) => setTimeout(r, 10));
        expect(screen.queryByText("stale0")).not.toBeInTheDocument();
        expect(screen.getByText("new1")).toBeInTheDocument();
    });

    it("caps concurrent /status requests at 5", async () => {
        const ids = Array.from({ length: 12 }, (_, i) => `u${i}`);
        let inFlight = 0;
        let maxInFlight = 0;
        const f = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/updates")) return jsonResponse({ items: ids });
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            inFlight -= 1;
            return jsonResponse({ status: "pending" });
        }) as unknown as typeof fetch;
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => expect(screen.getByText("u0")).toBeInTheDocument());
        expect(maxInFlight).toBeLessThanOrEqual(5);
    });

    it("does not re-poll /status for a terminal (completed) update", async () => {
        const statusCalls = vi.fn();
        const f = vi.fn(async (input: RequestInfo | URL) => {
            const url = input.toString();
            if (url.endsWith("/updates")) return jsonResponse({ items: ["u1"] });
            if (url.endsWith("/u1/status")) {
                statusCalls();
                return jsonResponse({ status: "completed", progress: 100 });
            }
            return new Response("nf", { status: 404 });
        }) as unknown as typeof fetch;
        const user = userEvent.setup();
        render(<UpdatesPanelView baseUrl={BASE} pollMs={0} fetchImpl={f} />);
        await waitFor(() => expect(screen.getByText("completed")).toBeInTheDocument());
        expect(statusCalls).toHaveBeenCalledTimes(1);
        await user.click(screen.getByRole("button", { name: /^refresh$/i }));
        await waitFor(() => screen.getByText("completed"));
        expect(statusCalls).toHaveBeenCalledTimes(1);
    });
});
