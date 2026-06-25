// Copyright 2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { EntityBrowserTabBar } from "./EntityBrowserPanel";
import type { EntityBrowserTabBarProps } from "./EntityBrowserPanel";
import type { MedkitApiClient } from "./medkit-api";
import type { RootCapabilities, ListFaultsResponse } from "./types";

type Tab = EntityBrowserTabBarProps["activeTab"];

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
  activeTab?: Tab;
  onTabChange?: (t: Tab) => void;
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
// Tests: data tab shown when the data_access capability is enabled
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - data tab", () => {
  it("shows data tab when data_access capability is true", async () => {
    const client = makeClient();
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => expect(screen.getByRole("tab", { name: /^data/i })).toBeInTheDocument());
  });

  it("hides data tab when data_access capability is false", async () => {
    const client = makeClient();
    const caps = { ...ALL_CAPS, data_access: false };
    renderTabBar({ client, capabilities: caps, entityId: "e1" });
    // Wait for prefetch to complete
    await waitFor(() => {
      expect(client.listOperations).toHaveBeenCalled();
    });
    expect(screen.queryByRole("tab", { name: /^data/i })).not.toBeInTheDocument();
  });

  it("shows data tab when capabilities is null (fallback mode)", async () => {
    const client = makeClient();
    renderTabBar({ client, capabilities: null, entityId: "e1" });
    // In fallback mode, standard tabs shown immediately (no prefetch needed)
    expect(screen.getByRole("tab", { name: /^data/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: tab hidden when count is 0
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - zero count does not hide a tab", () => {
  // Visibility is capability-only: a count of 0 must NOT hide a tab, so an entity
  // with no items still exposes the tab (its panel shows an empty state inside).
  it("shows operations tab even when there are 0 operations", async () => {
    const client = makeClient({
      listOperations: vi.fn().mockResolvedValue([]),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => expect(client.listOperations).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("tab", { name: /^operations/i })).toBeInTheDocument();
  });

  it("shows configurations tab even when there are 0 parameters", async () => {
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue({
        component_id: "e1", node_name: "n1", parameters: [],
      }),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => expect(client.listConfigurations).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("tab", { name: /^configurations/i })).toBeInTheDocument();
  });

  it("shows the faults tab when there are 0 faults", async () => {
    const client = makeClient({
      listEntityFaults: vi.fn().mockResolvedValue({ items: [], count: 0 }),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    await waitFor(() => expect(client.listEntityFaults).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("tab", { name: /^faults/i })).toBeInTheDocument();
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
    // Badge count "2" must live INSIDE the operations tab (scoped so it cannot
    // pass vacuously against some unrelated "2" elsewhere in the DOM). The count
    // resolves asynchronously, so wait for it rather than reading it eagerly.
    await waitFor(() => {
      const opsTab = screen.getByRole("tab", { name: /^operations/i });
      expect(within(opsTab).getByText("2")).toBeInTheDocument();
    });
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
      const configTab = screen.getByRole("tab", { name: /^configurations/i });
      expect(within(configTab).getByText("3")).toBeInTheDocument();
    });
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
      const faultsTab = screen.getByRole("tab", { name: /^faults/i });
      expect(within(faultsTab).getByText("1")).toBeInTheDocument();
    });
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
    expect(screen.queryByRole("tab", { name: /^operations/i })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("tab", { name: /^faults/i })).not.toBeInTheDocument();
  });

  it("hides logs tab when logs capability is false", async () => {
    const caps = { ...ALL_CAPS, logs: false };
    const client = makeClient();
    renderTabBar({ client, capabilities: caps, entityId: "e1" });
    await waitFor(() => expect(client.listEntityFaults).toHaveBeenCalled());
    expect(screen.queryByRole("tab", { name: /^logs/i })).not.toBeInTheDocument();
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
    expect(screen.getByRole("tab", { name: /^data/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^operations/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^configurations/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^faults/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^logs/i })).toBeInTheDocument();
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

  it("shows standard tabs (no crash) when capabilities is undefined", async () => {
    // A gateway whose GET / omits the capabilities field yields undefined here.
    // The tab bar must fall back to standard tabs, not throw on undefined access.
    const client = makeClient();
    renderTabBar({ client, capabilities: undefined as unknown as RootCapabilities | null, entityId: "e1" });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("tab", { name: /^data/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^logs/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: NO_CAPS - all capabilities off
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - NO_CAPS (all capabilities off)", () => {
  it("hides all tabs when every capability is false", async () => {
    const client = makeClient();
    renderTabBar({ client, capabilities: NO_CAPS, entityId: "e1" });
    // No prefetch is triggered for any disabled cap; wait for the effect cycle
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("tab", { name: /^data/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^operations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^configurations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^faults/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^logs/i })).not.toBeInTheDocument();
  });

  it("does not call prefetch methods when all capabilities are false", async () => {
    const client = makeClient();
    renderTabBar({ client, capabilities: NO_CAPS, entityId: "e1" });
    await act(async () => { await Promise.resolve(); });
    // All capability flags are false so no prefetch requests should be issued
    expect(client.listOperations).not.toHaveBeenCalled();
    expect(client.listConfigurations).not.toHaveBeenCalled();
    expect(client.listEntityFaults).not.toHaveBeenCalled();
  });

  it("does not show a blank/invalid active tab when no tabs are visible", async () => {
    const onTabChange = vi.fn();
    renderTabBar({ client: makeClient(), capabilities: NO_CAPS, entityId: "e1", activeTab: "data", onTabChange });
    await act(async () => { await Promise.resolve(); });
    // The active tab should not trigger an onTabChange call with an invalid value
    // when visibleTabs is empty (resolvedActive falls back to "data" which equals activeTab)
    expect(onTabChange).not.toHaveBeenCalled();
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
    expect(screen.getByRole("tab", { name: /^logs/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: loading skeleton
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - tabs render before counts resolve", () => {
  it("shows capability tabs immediately while the count fetch is still in flight", async () => {
    // The count fetch only feeds the badges, so the tabs must be visible right
    // away (no blocking skeleton) even before listOperations resolves.
    let resolveOps!: (ops: never[]) => void;
    const pending = new Promise<never[]>((r) => { resolveOps = r; });
    const client = makeClient({
      listOperations: vi.fn().mockReturnValue(pending),
    });
    renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });
    // Tabs are present immediately, before the count promise settles.
    expect(screen.getByRole("tab", { name: /^operations/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^logs/i })).toBeInTheDocument();
    resolveOps([]);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("tab", { name: /^operations/i })).toBeInTheDocument();
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

  it("keeps every capability tab visible even when one count fetch fails", async () => {
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
      expect(screen.getByRole("tab", { name: /^configurations/i })).toBeInTheDocument();
    });
    // A failed count fetch only drops the badge, never the tab.
    const opsTab = screen.getByRole("tab", { name: /^operations/i });
    expect(opsTab).toBeInTheDocument();
    expect(within(opsTab).queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^faults/i })).toBeInTheDocument();
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

    // Operations tab shows (capability-only). The stale e1 count (1) must not
    // leak into the badge - e2 has 0 ops, so no count badge.
    const opsTab = screen.getByRole("tab", { name: /^operations/i });
    expect(opsTab).toBeInTheDocument();
    expect(within(opsTab).queryByText("1")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: no setState after unmount
// ---------------------------------------------------------------------------

describe("EntityBrowserTabBar - no setState after unmount", () => {
  it("freezes prefetch work after unmount (resolving the stale prefetch causes no new client calls or tab render)", async () => {
    // The unmounted component's prefetch is still pending. When it resolves
    // after unmount, the cancel/mounted guard must discard the result: no extra
    // client calls, and a freshly-mounted sibling (different entity, 0 ops) must
    // not show an operations tab from the stale resolution.
    let resolveOps!: (ops: { name: string; path: string; type: string; kind: "service" }[]) => void;
    const pending = new Promise<{ name: string; path: string; type: string; kind: "service" }[]>(
      (r) => { resolveOps = r; },
    );
    const listOperations = vi.fn().mockReturnValue(pending);
    const client = makeClient({ listOperations });

    const { unmount } = renderTabBar({ client, capabilities: ALL_CAPS, entityId: "e1" });

    await waitFor(() => expect(listOperations).toHaveBeenCalledTimes(1));

    // Unmount while prefetch is still pending, then resolve the stale prefetch
    // with a non-empty op list that WOULD have shown an operations tab.
    unmount();
    resolveOps([{ name: "op1", path: "/op1", type: "", kind: "service" }]);
    await act(async () => { await Promise.resolve(); });

    // Call count is frozen: the resolved stale promise triggered no re-fetch.
    expect(listOperations).toHaveBeenCalledTimes(1);

    // A fresh sibling for a different entity with 0 ops shows the operations tab
    // (capability-only) but must not inherit the unmounted component's stale
    // count as a badge.
    const siblingClient = makeClient({ listOperations: vi.fn().mockResolvedValue([]) });
    renderTabBar({ client: siblingClient, capabilities: ALL_CAPS, entityId: "e2" });
    await waitFor(() => expect(siblingClient.listOperations).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    const opsTab = screen.getByRole("tab", { name: /^operations/i });
    expect(opsTab).toBeInTheDocument();
    expect(within(opsTab).queryByText("1")).not.toBeInTheDocument();
  });
});
