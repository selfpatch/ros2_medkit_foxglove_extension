// Copyright 2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { EntityBrowserTabBar } from "./EntityBrowserPanel";
import type { MedkitApiClient } from "./medkit-api";
import type { RootCapabilities, ListFaultsResponse } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DARK = "dark" as const;

const ALL_CAPS: RootCapabilities = {
  aggregation: false,
  async_actions: true,
  authentication: false,
  bulk_data: false,
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
  updates: false,
  vendor_extensions: false,
};

const NO_CAPS: RootCapabilities = {
  ...ALL_CAPS,
  data_access: false,
  operations: false,
  configurations: false,
  faults: false,
  logs: false,
};

// ---------------------------------------------------------------------------
// Client stub factory
// ---------------------------------------------------------------------------

function makeClient(
  overrides: Partial<{
    listOperations: MedkitApiClient["listOperations"];
    listConfigurations: MedkitApiClient["listConfigurations"];
    listEntityFaults: MedkitApiClient["listEntityFaults"];
  }> = {},
): MedkitApiClient {
  return {
    listOperations: vi.fn().mockResolvedValue([]),
    listConfigurations: vi.fn().mockResolvedValue({ component_id: "e1", node_name: "n1", parameters: [] }),
    listEntityFaults: vi.fn().mockResolvedValue({ items: [], count: 0 } as ListFaultsResponse),
    ...overrides,
  } as unknown as MedkitApiClient;
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

interface RenderTabBarProps {
  client: MedkitApiClient | null;
  capabilities: RootCapabilities | null;
  entityId: string;
  entityType?: "apps" | "components";
  activeTab?: string;
  onTabChange?: (t: string) => void;
}

function renderTabBar({
  client,
  capabilities,
  entityId,
  entityType = "apps",
  activeTab = "data",
  onTabChange = vi.fn(),
}: RenderTabBarProps) {
  return render(
    <EntityBrowserTabBar
      client={client}
      capabilities={capabilities}
      entityId={entityId}
      entityType={entityType}
      activeTab={activeTab}
      onTabChange={onTabChange}
      theme={DARK}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests: data tab always shown
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - data tab", () => {
  it("shows data tab when data_access capability is true", async () => {
    const client = makeClient();
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => expect(screen.getByRole("button", { name: /^data/i })).toBeInTheDocument());
  });

  it("hides data tab when data_access capability is false", async () => {
    const client = makeClient();
    const caps = { ...ALL_CAPS, data_access: false };
    renderTabBar({ client, capabilities: caps, entityId: "e1" });
    // Wait for prefetch to complete
    await waitFor(() => {
      expect(client.listOperations).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: /^data/i })).not.toBeInTheDocument();
  });

  it("shows data tab when capabilities is null (fallback mode)", async () => {
    const client = makeClient();
    renderTabBar({ client, capabilities: null, entityId: "e1" });
    // In fallback mode, standard tabs shown immediately (no prefetch needed)
    expect(screen.getByRole("button", { name: /^data/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: tab hidden when count is 0
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - count=0 hides tab", () => {
  it("hides operations tab when prefetch returns 0 operations", async () => {
    const client = makeClient({
      listOperations: vi.fn().mockResolvedValue([]),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => expect(client.listOperations).toHaveBeenCalled());
    // Wait for render after prefetch
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: /^operations/i })).not.toBeInTheDocument();
  });

  it("hides configurations tab when prefetch returns 0 parameters", async () => {
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue({
        component_id: "e1", node_name: "n1", parameters: [],
      }),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => expect(client.listConfigurations).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: /^configurations/i })).not.toBeInTheDocument();
  });

  it("hides faults tab when prefetch returns 0 faults", async () => {
    const client = makeClient({
      listEntityFaults: vi.fn().mockResolvedValue({ items: [], count: 0 }),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => expect(client.listEntityFaults).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: /^faults/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: count>0 shows tab with badge
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - count>0 shows tab with badge", () => {
  it("shows operations tab with badge when count > 0", async () => {
    const client = makeClient({
      listOperations: vi.fn().mockResolvedValue([
        { name: "op1", path: "/op1", type: "", kind: "service" },
        { name: "op2", path: "/op2", type: "", kind: "service" },
      ]),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^operations/i })).toBeInTheDocument();
    });
    // Badge showing count "2"
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows configurations tab with badge when parameters > 0", async () => {
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue({
        component_id: "e1",
        node_name: "n1",
        parameters: [
          { name: "p1", value: true, type: "bool" as const },
          { name: "p2", value: 42, type: "int" as const },
          { name: "p3", value: "hello", type: "string" as const },
        ],
      }),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^configurations/i })).toBeInTheDocument();
    });
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows faults tab with badge when fault count > 0", async () => {
    const client = makeClient({
      listEntityFaults: vi.fn().mockResolvedValue({
        items: [
          {
            code: "F001", message: "overheat", severity: "error" as const,
            status: "active" as const, timestamp: "2026-01-01T00:00:00Z",
            entity_id: "e1", entity_type: "app",
          },
        ],
        count: 1,
      }),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^faults/i })).toBeInTheDocument();
    });
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: capability disabled hides tab even with content
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - capability-disabled hides tab", () => {
  it("hides operations even when count > 0 if operations capability is false", async () => {
    const caps = { ...ALL_CAPS, operations: false };
    const client = makeClient({
      listOperations: vi.fn().mockResolvedValue([
        { name: "op1", path: "/op1", type: "", kind: "service" as const },
      ]),
    });
    renderTabBar({ client, capabilities: caps, entityId: "e1" });
    await waitFor(() => {
      // prefetch for ops is skipped when capability is false; just faults/configs
      expect(client.listEntityFaults).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: /^operations/i })).not.toBeInTheDocument();
  });

  it("hides faults even when count > 0 if faults capability is false", async () => {
    const caps = { ...ALL_CAPS, faults: false };
    const client = makeClient({
      listEntityFaults: vi.fn().mockResolvedValue({
        items: [
          {
            code: "F001", message: "err", severity: "error" as const,
            status: "active" as const, timestamp: "2026-01-01T00:00:00Z",
            entity_id: "e1", entity_type: "app",
          },
        ],
        count: 1,
      }),
    });
    renderTabBar({ client, capabilities: caps, entityId: "e1" });
    // Wait for prefetch to settle (faults cap is false so listEntityFaults is skipped,
    // but operations/configurations prefetch still run)
    await waitFor(() => expect(client.listConfigurations).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: /^faults/i })).not.toBeInTheDocument();
  });

  it("hides logs tab when logs capability is false", async () => {
    const caps = { ...ALL_CAPS, logs: false };
    const client = makeClient();
    renderTabBar({ client, capabilities: caps, entityId: "e1" });
    await waitFor(() => expect(client.listEntityFaults).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /^logs/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: getRoot failure fallback (capabilities null)
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - null capabilities fallback", () => {
  it("shows all standard tabs when capabilities is null (getRoot failed)", async () => {
    const client = makeClient();
    renderTabBar({ client, capabilities: null, entityId: "e1" });
    // Fallback: show all tabs without a prefetch
    expect(screen.getByRole("button", { name: /^data/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^operations/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^configurations/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^faults/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^logs/i })).toBeInTheDocument();
  });

  it("does not call prefetch methods when capabilities is null", async () => {
    const client = makeClient();
    renderTabBar({ client, capabilities: null, entityId: "e1" });
    // Small delay to ensure no async calls were made
    await act(async () => { await Promise.resolve(); });
    expect(client.listOperations).not.toHaveBeenCalled();
    expect(client.listConfigurations).not.toHaveBeenCalled();
    expect(client.listEntityFaults).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: logs tab visibility
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - logs tab", () => {
  it("shows logs tab when logs capability is true (no count check)", async () => {
    const client = makeClient();
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    // logs tab visible when logs cap enabled, regardless of prefetch
    await waitFor(() => expect(client.listEntityFaults).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("button", { name: /^logs/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: loading skeleton
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - loading skeleton", () => {
  it("shows loading state while prefetch is in flight", async () => {
    let resolveOps!: () => void;
    const pending = new Promise<void>((r) => { resolveOps = r; });
    const client = makeClient({
      listOperations: vi.fn().mockReturnValue(pending.then(() => [])),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    // Before prefetch resolves, skeleton/loading indicator must be visible
    expect(screen.getByRole("status", { name: /prefetching/i })).toBeInTheDocument();
    resolveOps();
    await waitFor(() => {
      expect(screen.queryByRole("status", { name: /prefetching/i })).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: prefetch is parallel
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - parallel prefetch", () => {
  it("calls listOperations, listConfigurations, and listEntityFaults in parallel", async () => {
    const listOperations = vi.fn().mockResolvedValue([]);
    const listConfigurations = vi.fn().mockResolvedValue({ component_id: "e1", node_name: "n1", parameters: [] });
    const listEntityFaults = vi.fn().mockResolvedValue({ items: [], count: 0 });
    const client = makeClient({ listOperations, listConfigurations, listEntityFaults });

    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => {
      expect(listOperations).toHaveBeenCalledTimes(1);
      expect(listConfigurations).toHaveBeenCalledTimes(1);
      expect(listEntityFaults).toHaveBeenCalledTimes(1);
    });
    // All three called with the right entity
    expect(listOperations).toHaveBeenCalledWith("apps", "e1");
    expect(listConfigurations).toHaveBeenCalledWith("apps", "e1");
    expect(listEntityFaults).toHaveBeenCalledWith("apps", "e1");
  });

  it("shows remaining tabs when one prefetch fails (per-count error tolerance)", async () => {
    const client = makeClient({
      listOperations: vi.fn().mockRejectedValue(new Error("Network error")),
      listConfigurations: vi.fn().mockResolvedValue({
        component_id: "e1", node_name: "n1",
        parameters: [{ name: "p1", value: 1, type: "int" as const }],
      }),
      listEntityFaults: vi.fn().mockResolvedValue({ items: [], count: 0 }),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => {
      // configurations visible (count=1), operations hidden (error treated as 0), faults hidden (count=0)
      expect(screen.getByRole("button", { name: /^configurations/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /^operations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^faults/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: no setState after entity change (stale guard)
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - stale guard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores stale prefetch result when entityId changes before prefetch resolves", async () => {
    // First entity prefetch resolves AFTER the component re-renders with a new entityId.
    // The stale result should not override counts for the new entity.
    let resolveFirst!: (ops: { name: string; path: string; type: string; kind: "service" }[]) => void;
    const firstPending = new Promise<{ name: string; path: string; type: string; kind: "service" }[]>(
      (r) => { resolveFirst = r; }
    );

    const listOperations = vi.fn()
      .mockReturnValueOnce(firstPending) // first entity - slow
      .mockResolvedValue([]);            // second entity - fast, no ops

    const listConfigurations = vi.fn().mockResolvedValue({ component_id: "e2", node_name: "n1", parameters: [] });
    const listEntityFaults = vi.fn().mockResolvedValue({ items: [], count: 0 });
    const client = makeClient({ listOperations, listConfigurations, listEntityFaults });

    const { rerender } = renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });

    // Immediately change entity before first prefetch resolves
    rerender(
      <EntityBrowserTabBar
        client={client}
        capabilities={ALL_CAPS}
        entityId="e2"
        entityType="apps"
        activeTab="data"
        onTabChange={vi.fn()}
        theme={DARK}
      />
    );

    // Now resolve the first (stale) prefetch with some ops
    resolveFirst([{ name: "op1", path: "/op1", type: "", kind: "service" }]);

    // Wait for second entity prefetch to complete
    await waitFor(() => {
      expect(listOperations).toHaveBeenCalledTimes(2);
    });
    await act(async () => { await Promise.resolve(); });

    // Operations tab should NOT show (stale result discarded, second entity has 0 ops)
    expect(screen.queryByRole("button", { name: /^operations/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: no setState after unmount
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - no setState after unmount", () => {
  it("does not throw or call setState after unmount (prefetch still in flight)", async () => {
    let resolveOps!: () => void;
    const pending = new Promise<void>((r) => { resolveOps = r; });
    const listOperations = vi.fn().mockReturnValue(pending.then(() => []));
    const client = makeClient({ listOperations });

    const consoleSpy = vi.spyOn(console, "error");
    const { unmount } = renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });

    // Unmount while prefetch is still pending
    unmount();

    // Now resolve the stale prefetch - should not cause any errors
    resolveOps();
    await act(async () => { await Promise.resolve(); });

    // No React "setState on unmounted component" or similar error
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringMatching(/unmounted/));
    consoleSpy.mockRestore();
  });
});
