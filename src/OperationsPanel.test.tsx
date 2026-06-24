// Copyright 2024-2026 bburda. Apache-2.0 license.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { OperationsPanel } from "./OperationsPanel";
import type { MedkitApiClient } from "./medkit-api";
import type { CreateExecutionResponse, Operation } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SERVICE_OP: Operation = {
  name: "set_speed",
  path: "/set_speed",
  type: "std_srvs/SetBool",
  kind: "service",
};

// Operation with a non-empty schema - expects real form fields to render.
const SERVICE_OP_WITH_SCHEMA: Operation = {
  name: "set_bool",
  path: "/set_bool",
  type: "std_srvs/SetBool",
  kind: "service",
  type_info: {
    schema: {
      data: { type: "bool" },
    },
  },
};

const ACTION_OP: Operation = {
  name: "navigate_to_pose",
  path: "/navigate_to_pose",
  type: "nav2_msgs/NavigateToPose",
  kind: "action",
};

const SERVICE_RESPONSE: CreateExecutionResponse = {
  status: "completed",
  kind: "service",
  result: { success: true, message: "OK" },
};

const ACTION_RESPONSE: CreateExecutionResponse = {
  id: "exec-abc-123",
  status: "accepted",
  kind: "action",
};

const THEME = "dark" as const;

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

function makeClient(
  ops: Operation[] = [],
  execResponse: CreateExecutionResponse = SERVICE_RESPONSE,
): MedkitApiClient {
  return {
    listOperations: vi.fn().mockResolvedValue(ops),
    createExecution: vi.fn().mockResolvedValue(execResponse),
  } as unknown as MedkitApiClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OperationsPanel - empty state", () => {
  it("shows empty state when no operations are returned", async () => {
    const client = makeClient([]);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="my-comp"
        theme={THEME}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("No operations")).toBeInTheDocument();
    });
  });

  it("calls listOperations with the correct entity type and id", async () => {
    const client = makeClient([]);
    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="robot-app"
        theme={THEME}
      />,
    );
    await waitFor(() => {
      expect(client.listOperations).toHaveBeenCalledWith("apps", "robot-app");
    });
  });
});

describe("OperationsPanel - loading and error states", () => {
  it("shows loading indicator while fetching", () => {
    const client = {
      listOperations: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as MedkitApiClient;
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    expect(screen.getByText("Loading operations...")).toBeInTheDocument();
  });

  it("shows error when listOperations rejects", async () => {
    const client = {
      listOperations: vi.fn().mockRejectedValue(new Error("network error")),
    } as unknown as MedkitApiClient;
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });
});

describe("OperationsPanel - operations list renders", () => {
  it("renders a service operation by name", async () => {
    const client = makeClient([SERVICE_OP]);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: SERVICE_OP.name })).toBeInTheDocument();
    });
  });

  it("renders an action operation by name", async () => {
    const client = makeClient([ACTION_OP]);
    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: ACTION_OP.name })).toBeInTheDocument();
    });
  });

  it("renders both services and actions", async () => {
    const client = makeClient([SERVICE_OP, ACTION_OP]);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: SERVICE_OP.name })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: ACTION_OP.name })).toBeInTheDocument();
    });
  });

  it("shows 'Services' and 'Actions' section labels when both kinds are present", async () => {
    const client = makeClient([SERVICE_OP, ACTION_OP]);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Services")).toBeInTheDocument();
      expect(screen.getByText("Actions")).toBeInTheDocument();
    });
  });
});

describe("OperationsPanel - selecting an operation shows form", () => {
  it("shows 'No parameters' message (empty schema) and Run button after selecting an op", async () => {
    const client = makeClient([SERVICE_OP]);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: SERVICE_OP.name }));

    // The form renders with empty schema -> "No parameters" hint
    expect(screen.getByText("No parameters")).toBeInTheDocument();
    // Run button appears
    expect(screen.getByRole("button", { name: `Run ${SERVICE_OP.name}` })).toBeInTheDocument();
  });

  it("renders form fields (not 'No parameters') when op.type_info.schema has fields", async () => {
    const client = makeClient([SERVICE_OP_WITH_SCHEMA]);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP_WITH_SCHEMA.name }));
    fireEvent.click(screen.getByRole("button", { name: SERVICE_OP_WITH_SCHEMA.name }));

    // The form renders a field row for "data" - "No parameters" must not appear.
    expect(screen.queryByText("No parameters")).not.toBeInTheDocument();
    // OperationRequestForm renders a label containing the field name "data".
    expect(screen.getByText("data")).toBeInTheDocument();
  });

  it("shows 'Request' label for a service operation", async () => {
    const client = makeClient([SERVICE_OP]);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: SERVICE_OP.name }));
    expect(screen.getByText("Request")).toBeInTheDocument();
  });

  it("shows 'Goal' label for an action operation", async () => {
    const client = makeClient([ACTION_OP]);
    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    expect(screen.getByText("Goal")).toBeInTheDocument();
  });

  it("marks the selected operation as aria-pressed=true", async () => {
    const client = makeClient([SERVICE_OP, ACTION_OP]);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: SERVICE_OP.name }));

    expect(screen.getByRole("button", { name: SERVICE_OP.name })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: ACTION_OP.name })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("OperationsPanel - Run calls createExecution", () => {
  it("calls createExecution with correct args when Run is clicked for a service", async () => {
    const client = makeClient([SERVICE_OP], SERVICE_RESPONSE);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${SERVICE_OP.name}` }));

    await waitFor(() => {
      expect(client.createExecution).toHaveBeenCalledWith(
        "components",
        "c1",
        "set_speed",
        { type: SERVICE_OP.type, request: {} },
      );
    });
  });

  it("calls createExecution with goal key for an action", async () => {
    const client = makeClient([ACTION_OP], ACTION_RESPONSE);
    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    await waitFor(() => {
      expect(client.createExecution).toHaveBeenCalledWith(
        "apps",
        "a1",
        "navigate_to_pose",
        { type: ACTION_OP.type, goal: {} },
      );
    });
  });

  it("disables the Run button while in-flight", async () => {
    let resolveExec!: (v: CreateExecutionResponse) => void;
    const hangingPromise = new Promise<CreateExecutionResponse>((resolve) => {
      resolveExec = resolve;
    });
    const client = {
      listOperations: vi.fn().mockResolvedValue([SERVICE_OP]),
      createExecution: vi.fn().mockReturnValue(hangingPromise),
    } as unknown as MedkitApiClient;

    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: SERVICE_OP.name }));
    const runBtn = screen.getByRole("button", { name: `Run ${SERVICE_OP.name}` });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(runBtn).toBeDisabled();
    });

    // Resolve and clean up
    resolveExec(SERVICE_RESPONSE);
  });
});

describe("OperationsPanel - service response display", () => {
  it("shows the service result JSON after a successful run", async () => {
    const client = makeClient([SERVICE_OP], SERVICE_RESPONSE);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${SERVICE_OP.name}` }));

    await waitFor(() => {
      // The result object is shown as pretty JSON
      expect(screen.getByText(/success/)).toBeInTheDocument();
    });
  });

  it("shows 'service' badge in the response area", async () => {
    const client = makeClient([SERVICE_OP], SERVICE_RESPONSE);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${SERVICE_OP.name}` }));

    await waitFor(() => {
      // There will be two "service" badges: one in the op list, one in the response.
      const serviceBadges = screen.getAllByText("service");
      expect(serviceBadges.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("OperationsPanel - action response display", () => {
  it("shows the action execution panel (status badge) after run", async () => {
    const client = makeClient([ACTION_OP], ACTION_RESPONSE);
    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    // T3: action response is now shown via ActionExecutionPanel (polling lifecycle).
    // The panel renders an "action" badge and the execution id.
    await waitFor(() => {
      // execution id shown in the panel
      expect(screen.getByText("exec-abc-123")).toBeInTheDocument();
    });
  });

  it("shows the execution id for an action response", async () => {
    const client = makeClient([ACTION_OP], ACTION_RESPONSE);
    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    await waitFor(() => {
      expect(screen.getByText("exec-abc-123")).toBeInTheDocument();
    });
  });

  it("shows the initial status for an action response", async () => {
    const client = makeClient([ACTION_OP], ACTION_RESPONSE);
    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    await waitFor(() => {
      // Status badge in response
      const statusBadges = screen.getAllByText("accepted");
      expect(statusBadges.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("OperationsPanel - execution error display", () => {
  it("shows the error message when createExecution rejects", async () => {
    const client = {
      listOperations: vi.fn().mockResolvedValue([SERVICE_OP]),
      createExecution: vi.fn().mockRejectedValue(new Error("gateway timeout")),
    } as unknown as MedkitApiClient;

    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${SERVICE_OP.name}` }));

    await waitFor(() => {
      expect(screen.getByText(/gateway timeout/i)).toBeInTheDocument();
    });
  });
});

describe("OperationsPanel - entity change resets state", () => {
  it("re-fetches operations when entityId changes", async () => {
    const client = makeClient([SERVICE_OP]);
    const { rerender } = render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP.name }));
    expect(client.listOperations).toHaveBeenCalledWith("components", "c1");

    rerender(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c2"
        theme={THEME}
      />,
    );
    await waitFor(() => {
      expect(client.listOperations).toHaveBeenCalledWith("components", "c2");
    });
  });
});

describe("OperationsPanel - keyboard accessibility", () => {
  it("selects an operation on Enter key", async () => {
    const client = makeClient([SERVICE_OP]);
    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP.name }));
    const opBtn = screen.getByRole("button", { name: SERVICE_OP.name });
    fireEvent.keyDown(opBtn, { key: "Enter" });
    expect(screen.getByRole("button", { name: `Run ${SERVICE_OP.name}` })).toBeInTheDocument();
  });
});

// =============================================================================
// T3: Action polling lifecycle tests
// =============================================================================

/**
 * Build a client stub for polling lifecycle tests.
 * getExecution returns a sequence of responses (one per call index).
 * cancelExecution resolves immediately.
 */
function makePollingClient(
  pollSequence: Array<{ status: "pending" | "running" | "completed" | "failed"; parameters?: unknown }>,
): MedkitApiClient & { getExecution: ReturnType<typeof vi.fn>; cancelExecution: ReturnType<typeof vi.fn> } {
  let callIndex = 0;
  const getExecution = vi.fn(async () => {
    const resp = pollSequence[callIndex] ?? pollSequence[pollSequence.length - 1]!;
    callIndex++;
    return resp;
  });
  const cancelExecution = vi.fn(async () => undefined);

  return {
    listOperations: vi.fn().mockResolvedValue([ACTION_OP]),
    createExecution: vi.fn().mockResolvedValue(ACTION_RESPONSE),
    getExecution,
    cancelExecution,
  } as unknown as MedkitApiClient & { getExecution: ReturnType<typeof vi.fn>; cancelExecution: ReturnType<typeof vi.fn> };
}

describe("OperationsPanel - action polling lifecycle", () => {
  beforeEach(() => {
    // Only fake setInterval/clearInterval; leave setTimeout real so waitFor works.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts polling after run; shows status on each tick; stops at terminal", async () => {
    const client = makePollingClient([
      { status: "pending" },
      { status: "running", parameters: { feedback: 42 } },
      { status: "completed", parameters: { result: "done" } },
    ]);

    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    // After run, ActionExecutionPanel is shown with initial status from createExecution
    await waitFor(() => {
      expect(screen.getByText("exec-abc-123")).toBeInTheDocument();
    });

    // Tick 1: pending
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText("pending")).toBeInTheDocument();
    });
    expect(client.getExecution).toHaveBeenCalledTimes(1);

    // Tick 2: running + feedback
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText("running")).toBeInTheDocument();
    });
    expect(screen.getByText(/feedback/)).toBeInTheDocument();

    // Tick 3: completed (terminal)
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText("completed")).toBeInTheDocument();
    });

    const callCountAtTerminal = (client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length;

    // No more calls after terminal - advance more ticks
    await act(async () => {
      vi.advanceTimersByTime(3100);
      await Promise.resolve();
    });
    expect((client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountAtTerminal);
  });

  it("adds history entry when execution reaches terminal status", async () => {
    const client = makePollingClient([
      { status: "completed" },
    ]);

    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    await waitFor(() => screen.getByText("exec-abc-123"));

    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText("completed")).toBeInTheDocument();
    });

    // History toggle button should appear
    expect(screen.getByRole("button", { name: "Toggle execution history" })).toBeInTheDocument();
  });
});

describe("OperationsPanel - action cancel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls cancelExecution on Cancel click and stops polling", async () => {
    const client = makePollingClient([
      { status: "running" },
      { status: "running" },
    ]);

    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    await waitFor(() => screen.getByText("exec-abc-123"));

    // Advance one tick so polling starts and Cancel button is visible
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel execution" })).toBeInTheDocument();
    });

    const callsBeforeCancel = (client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Cancel execution" }));

    await waitFor(() => {
      expect(client.cancelExecution).toHaveBeenCalledTimes(1);
    });

    // Advance more - no new getExecution calls
    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
    });
    const callsAfterCancel = (client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterCancel).toBe(callsBeforeCancel);

    // Status shown as canceled
    await waitFor(() => {
      expect(screen.getByText("canceled")).toBeInTheDocument();
    });
  });
});

describe("OperationsPanel - action history", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accumulates history entries across multiple runs", async () => {
    const client = makePollingClient([
      { status: "completed" },
      { status: "failed" },
    ]);
    // Override createExecution to return different ids per run
    let runCount = 0;
    (client.createExecution as ReturnType<typeof vi.fn>) = vi.fn(async () => ({
      id: `exec-${runCount++}`,
      status: "pending",
      kind: "action",
    }));

    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));

    // Run 1
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));
    await waitFor(() => screen.getByText("exec-0"));
    await act(async () => { vi.advanceTimersByTime(1100); await Promise.resolve(); });
    await waitFor(() => screen.getByText("completed"));

    // Run 2
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));
    await waitFor(() => screen.getByText("exec-1"));
    await act(async () => { vi.advanceTimersByTime(1100); await Promise.resolve(); });
    await waitFor(() => screen.getByText("failed"));

    // History should have 2 entries
    const historyBtn = screen.getByRole("button", { name: "Toggle execution history" });
    expect(historyBtn.textContent).toContain("2");
  });
});

describe("OperationsPanel - lifecycle hygiene (unmount stops polling)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops calling getExecution after unmount", async () => {
    const client = makePollingClient([
      { status: "running" },
      { status: "running" },
      { status: "running" },
    ]);

    const { unmount } = render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    await waitFor(() => screen.getByText("exec-abc-123"));

    // One tick to establish polling
    await act(async () => { vi.advanceTimersByTime(1100); await Promise.resolve(); });
    await waitFor(() => expect(client.getExecution).toHaveBeenCalledTimes(1));
    const callsBeforeUnmount = (client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length;

    unmount();

    // Advance more ticks - no new calls
    await act(async () => { vi.advanceTimersByTime(3100); await Promise.resolve(); });
    expect((client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeUnmount);
  });
});

describe("OperationsPanel - entity change stops polling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops calling getExecution when entityId changes", async () => {
    const client = makePollingClient([
      { status: "running" },
      { status: "running" },
    ]);

    const { rerender } = render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    await waitFor(() => screen.getByText("exec-abc-123"));

    await act(async () => { vi.advanceTimersByTime(1100); await Promise.resolve(); });
    await waitFor(() => expect(client.getExecution).toHaveBeenCalledTimes(1));
    const callsBeforeRerender = (client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length;

    // Change entity - should stop polling
    rerender(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a2"
        theme={THEME}
      />,
    );

    await act(async () => { vi.advanceTimersByTime(2100); await Promise.resolve(); });
    expect((client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeRerender);
  });
});

describe("OperationsPanel - service still sync (no polling)", () => {
  it("does not call getExecution for a service operation", async () => {
    const getExecution = vi.fn();
    const client: MedkitApiClient = {
      listOperations: vi.fn().mockResolvedValue([SERVICE_OP]),
      createExecution: vi.fn().mockResolvedValue(SERVICE_RESPONSE),
      getExecution,
    } as unknown as MedkitApiClient;

    render(
      <OperationsPanel
        client={client}
        entityType="components"
        entityId="c1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: SERVICE_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${SERVICE_OP.name}` }));

    await waitFor(() => {
      // Service result shown
      expect(screen.getByText(/success/)).toBeInTheDocument();
    });

    expect(getExecution).not.toHaveBeenCalled();
  });
});
