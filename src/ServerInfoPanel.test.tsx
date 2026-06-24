// Copyright 2024-2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { ServerInfoPanelView } from "./ServerInfoPanel";
import type { RootOverview, VersionInfo } from "./types";

const BASE = "http://gw/api/v1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function buildFetch(path: string, data: unknown, status = 200): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : input.toString();
        // Match exact path suffix or trailing slash variant
        if (url === BASE + path || url === BASE + path + "/") {
            return jsonResponse(data, status);
        }
        return jsonResponse({ message: "not found" }, 404);
    }) as unknown as typeof fetch;
}

/** Build a fetch stub that serves GET / with rootData and GET /version-info with viData. */
function buildMultiFetch(rootData: unknown, viData: unknown | "error"): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
        const url = (input instanceof Request ? input.url : input.toString());
        // version-info path
        if (url === BASE + "/version-info" || url === BASE + "/version-info/") {
            if (viData === "error") {
                return jsonResponse({ message: "not found" }, 404);
            }
            return jsonResponse(viData);
        }
        // root path
        if (url === BASE + "/" || url === BASE) {
            return jsonResponse(rootData);
        }
        return jsonResponse({ message: "not found" }, 404);
    }) as unknown as typeof fetch;
}

const VERSION_INFO: VersionInfo = {
    items: [
        {
            version: "1.0.0-sovd",
            base_uri: "/api/v1",
            vendor_info: { name: "ros2_medkit", version: "2.3.0" },
        },
    ],
};

const FULL_OVERVIEW: RootOverview = {
    name: "ros2_medkit Gateway",
    version: "1.0.0",
    api_base: "/api/v1",
    endpoints: ["/api/v1/areas", "/api/v1/components", "/api/v1/apps"],
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
        updates: true,
        vendor_extensions: true,
    },
    auth: null,
    tls: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ServerInfoPanelView", () => {
    it("renders server overview with name, version, and api_base", async () => {
        const f = buildFetch("/", FULL_OVERVIEW);
        render(<ServerInfoPanelView baseUrl={BASE} fetchImpl={f} />);
        await waitFor(() => {
            expect(screen.getByText("ros2_medkit Gateway")).toBeInTheDocument();
            expect(screen.getByText("1.0.0")).toBeInTheDocument();
            expect(screen.getByText("/api/v1")).toBeInTheDocument();
        });
    });

    it("renders a badge for each ENABLED capability only", async () => {
        const f = buildFetch("/", FULL_OVERVIEW);
        render(<ServerInfoPanelView baseUrl={BASE} fetchImpl={f} />);
        await waitFor(() => {
            // Enabled capabilities
            expect(screen.getByText("Async Actions")).toBeInTheDocument();
            expect(screen.getByText("Bulk Data")).toBeInTheDocument();
            expect(screen.getByText("Configurations")).toBeInTheDocument();
            expect(screen.getByText("Data Access")).toBeInTheDocument();
            expect(screen.getByText("Discovery")).toBeInTheDocument();
            expect(screen.getByText("Faults")).toBeInTheDocument();
            expect(screen.getByText("Logs")).toBeInTheDocument();
            expect(screen.getByText("Operations")).toBeInTheDocument();
            expect(screen.getByText("Updates")).toBeInTheDocument();
            expect(screen.getByText("Vendor Extensions")).toBeInTheDocument();
        });
        // Disabled capabilities must NOT be rendered as badges
        expect(screen.queryByText("Aggregation")).not.toBeInTheDocument();
        expect(screen.queryByText("Authentication")).not.toBeInTheDocument();
        expect(screen.queryByText("Cyclic Subscriptions")).not.toBeInTheDocument();
        expect(screen.queryByText("Locking")).not.toBeInTheDocument();
        expect(screen.queryByText("Scripts")).not.toBeInTheDocument();
        expect(screen.queryByText("TLS")).not.toBeInTheDocument();
        expect(screen.queryByText("Triggers")).not.toBeInTheDocument();
    });

    it("renders the API entry points list", async () => {
        const f = buildFetch("/", FULL_OVERVIEW);
        render(<ServerInfoPanelView baseUrl={BASE} fetchImpl={f} />);
        await waitFor(() => {
            expect(screen.getByText("/api/v1/areas")).toBeInTheDocument();
            expect(screen.getByText("/api/v1/components")).toBeInTheDocument();
            expect(screen.getByText("/api/v1/apps")).toBeInTheDocument();
        });
    });

    it("shows loading state while fetching", () => {
        // Never resolves - keep in loading state
        const f = vi.fn(async () => await new Promise<Response>(() => {})) as unknown as typeof fetch;
        render(<ServerInfoPanelView baseUrl={BASE} fetchImpl={f} />);
        expect(screen.getByText(/loading server info/i)).toBeInTheDocument();
    });

    it("shows error state when getRoot fails", async () => {
        const f = vi.fn(async () => jsonResponse({ message: "Connection refused" }, 500)) as unknown as typeof fetch;
        render(<ServerInfoPanelView baseUrl={BASE} fetchImpl={f} />);
        await waitFor(() => {
            // Error box should be visible
            expect(screen.getByRole("alert")).toBeInTheDocument();
        });
    });

    it("shows no badges when all capabilities are false", async () => {
        const allOff: RootOverview = {
            ...FULL_OVERVIEW,
            capabilities: {
                aggregation: false,
                async_actions: false,
                authentication: false,
                bulk_data: false,
                configurations: false,
                cyclic_subscriptions: false,
                data_access: false,
                discovery: false,
                faults: false,
                locking: false,
                logs: false,
                operations: false,
                scripts: false,
                tls: false,
                triggers: false,
                updates: false,
                vendor_extensions: false,
            },
        };
        const f = buildFetch("/", allOff);
        render(<ServerInfoPanelView baseUrl={BASE} fetchImpl={f} />);
        await waitFor(() => {
            expect(screen.getByText(/no capabilities reported/i)).toBeInTheDocument();
        });
    });

    it("shows section headings", async () => {
        const f = buildFetch("/", FULL_OVERVIEW);
        render(<ServerInfoPanelView baseUrl={BASE} fetchImpl={f} />);
        await waitFor(() => {
            expect(screen.getByText("Server Overview")).toBeInTheDocument();
            expect(screen.getByText("Supported Features")).toBeInTheDocument();
            expect(screen.getByText("API Entry Points")).toBeInTheDocument();
        });
    });

    it("renders SOVD version and base URI from version-info in the overview", async () => {
        const f = buildMultiFetch(FULL_OVERVIEW, VERSION_INFO);
        render(<ServerInfoPanelView baseUrl={BASE} fetchImpl={f} />);
        await waitFor(() => {
            // SOVD/api version from version-info (distinct from implementation version)
            expect(screen.getByText("SOVD Version")).toBeInTheDocument();
            expect(screen.getByText("1.0.0-sovd")).toBeInTheDocument();
            // base_uri from version-info
            expect(screen.getByText("Base URI")).toBeInTheDocument();
        });
        // Implementation version from getRoot still shown
        expect(screen.getByText("1.0.0")).toBeInTheDocument();
    });

    it("still renders getRoot data when version-info errors (non-fatal)", async () => {
        const f = buildMultiFetch(FULL_OVERVIEW, "error");
        render(<ServerInfoPanelView baseUrl={BASE} fetchImpl={f} />);
        await waitFor(() => {
            // getRoot fields rendered as usual
            expect(screen.getByText("ros2_medkit Gateway")).toBeInTheDocument();
            expect(screen.getByText("1.0.0")).toBeInTheDocument();
            expect(screen.getByText("/api/v1")).toBeInTheDocument();
        });
        // SOVD version label absent when version-info unavailable
        expect(screen.queryByText("SOVD Version")).not.toBeInTheDocument();
        expect(screen.queryByText("Base URI")).not.toBeInTheDocument();
    });
});
