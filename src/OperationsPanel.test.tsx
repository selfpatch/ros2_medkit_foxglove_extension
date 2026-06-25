// Copyright 2024-2026 bburda. Apache-2.0 license.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { OperationsPanel } from "./OperationsPanel";
import type { MedkitApiClient } from "./medkit-api";
import { MedkitApiError } from "./gateway-client";
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

// Action operation with a non-empty schema - expects real form fields to render.
const ACTION_OP_WITH_SCHEMA: Operation = {
  name: "navigate_to_pose",
  path: "/navigate_to_pose",
  type: "nav2_msgs/NavigateToPose",
  kind: "action",
  type_info: {
    schema: {
      target_x: { type: "float64" },
      target_y: { type: "float64" },
    },
  },
};

// Real gateway shapes: a synchronous service returns `{parameters}` only (no
// status/kind/result), and an async action's 202 returns `{id, status:"running"}`.
const SERVICE_RESPONSE: CreateExecutionResponse = {
  parameters: { success: true, message: "OK" },
};

const ACTION_RESPONSE: CreateExecutionResponse = {
  id: "exec-abc-123",
  status: "running",
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

describe("OperationsPanel - action op field-render and lifecycle start", () => {
  // Real timers: these tests only assert the immediate post-Run state (panel
  // shown, Run disabled while polling) and never advance the poll clock, so
  // waitFor works without fake timers.
  it("renders goal fields (not 'No parameters') when action op.type_info.schema has fields", async () => {
    const client = makeClient([ACTION_OP_WITH_SCHEMA], ACTION_RESPONSE);
    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP_WITH_SCHEMA.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP_WITH_SCHEMA.name }));

    // Schema has target_x and target_y fields - "No parameters" must not appear.
    expect(screen.queryByText("No parameters")).not.toBeInTheDocument();
    expect(screen.getByText("target_x")).toBeInTheDocument();
    expect(screen.getByText("target_y")).toBeInTheDocument();
    // "Goal" label shown for actions
    expect(screen.getByText("Goal")).toBeInTheDocument();
  });

  it("calls createExecution then starts polling when Run is clicked for action with schema", async () => {
    const client = makeClient([ACTION_OP_WITH_SCHEMA], ACTION_RESPONSE);
    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await waitFor(() => screen.getByRole("button", { name: ACTION_OP_WITH_SCHEMA.name }));
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP_WITH_SCHEMA.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP_WITH_SCHEMA.name}` }));

    // createExecution called with goal key and the schema-defaulted form value
    await waitFor(() => {
      expect(client.createExecution).toHaveBeenCalledWith(
        "apps",
        "a1",
        "navigate_to_pose",
        { type: ACTION_OP_WITH_SCHEMA.type, goal: { target_x: 0, target_y: 0 } },
      );
    });

    // ActionExecutionPanel appears with the execution id from ACTION_RESPONSE
    await waitFor(() => {
      expect(screen.getByText("exec-abc-123")).toBeInTheDocument();
    });

    // Run button is disabled while polling
    expect(screen.getByRole("button", { name: `Run ${ACTION_OP_WITH_SCHEMA.name}` })).toBeDisabled();
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

  it("omits the type field when the operation type is empty", async () => {
    // The gateway treats a present body `type` (even "") as an override of the
    // discovered type, so an empty-type operation must send no `type` key.
    const noTypeOp: Operation = { name: "act_notype", path: "/act_notype", type: "", kind: "action" };
    const client = makeClient([noTypeOp], ACTION_RESPONSE);
    render(
      <OperationsPanel client={client} entityType="apps" entityId="a1" theme={THEME} />,
    );
    await waitFor(() => screen.getByRole("button", { name: noTypeOp.name }));
    fireEvent.click(screen.getByRole("button", { name: noTypeOp.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${noTypeOp.name}` }));

    await waitFor(() => {
      expect(client.createExecution).toHaveBeenCalledWith("apps", "a1", "act_notype", { goal: {} });
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
  it("shows the action badge and Cancel control in the lifecycle panel after run", async () => {
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

    // T3: action response is shown via ActionExecutionPanel (polling lifecycle).
    // Differentiated from the id test below: assert the lifecycle-panel chrome
    // (the "action" badge inside the panel + the non-terminal Cancel control),
    // not just the id.
    await waitFor(() => {
      // Two "action" badges: one in the op list, one in the lifecycle panel.
      expect(screen.getAllByText("action").length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByRole("button", { name: "Cancel execution" })).toBeInTheDocument();
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
      // The gateway's 202 carries status:"running"; the lifecycle panel shows it
      // verbatim (no "accepted" alias remap).
      const statusBadges = screen.getAllByText("running");
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

  it("selects an operation on Space key and prevents default page scroll", async () => {
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
    // fireEvent.keyDown returns false if any handler called preventDefault().
    const notPrevented = fireEvent.keyDown(opBtn, { key: " " });
    expect(notPrevented).toBe(false); // default (scroll) was prevented
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

/**
 * Drive the post-Run async flow that runs on MICROTASKS (createExecution
 * resolving -> setActiveExecution/setPolling). With fake timers, waitFor cannot
 * poll, so we flush microtasks inside act() until the lifecycle panel appears.
 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await flushMicrotasksRaw();
  });
}

/** Microtask flush WITHOUT its own act() wrapper (for use inside an act block). */
async function flushMicrotasksRaw(): Promise<void> {
  // A few rounds covers: promise resolve -> state set -> re-render.
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/**
 * Advance the recursive-setTimeout poll by exactly one tick and flush the
 * getExecution microtask + the resulting state update. advanceTimersByTimeAsync
 * runs due timers AND drains the microtask queue between them, which is what the
 * async tick body needs.
 */
async function advanceOnePoll(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_TICK_MS);
  });
}

// One full poll interval (the panel uses 1000ms); advancing past it fires the
// next scheduled tick.
const POLL_TICK_MS = 1000;

describe("OperationsPanel - action polling lifecycle", () => {
  beforeEach(() => {
    // Fake setTimeout/clearTimeout for the recursive-setTimeout poll loop.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
    // listOperations resolves on a microtask, not a timer.
    await flushMicrotasks();
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    // After run (createExecution resolves), the panel shows the execution id and
    // the initial status "running" from the 202 response.
    await flushMicrotasks();
    expect(screen.getByText("exec-abc-123")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(client.getExecution).toHaveBeenCalledTimes(0); // first poll not yet due

    // Tick 1: getExecution -> pending
    await advanceOnePoll();
    expect(client.getExecution).toHaveBeenCalledTimes(1);
    expect(screen.getByText("pending")).toBeInTheDocument();

    // Tick 2: running + feedback value (assert the VALUE 42, not the key)
    await advanceOnePoll();
    expect(client.getExecution).toHaveBeenCalledTimes(2);
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText(/"feedback":\s*42/)).toBeInTheDocument();

    // Tick 3: completed (terminal) -> poll stops
    await advanceOnePoll();
    expect(client.getExecution).toHaveBeenCalledTimes(3);
    expect(screen.getByText("completed")).toBeInTheDocument();

    const callCountAtTerminal = (client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length;

    // No next tick scheduled after terminal: advancing further makes no new call.
    await advanceOnePoll();
    await advanceOnePoll();
    expect((client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountAtTerminal);
  });

  it("stops polling and surfaces an error when getExecution returns 404 (evicted goal)", async () => {
    // A goal the gateway has evicted returns a hard 404 on the executions/{id}
    // poll. The loop must stop, surface the error, and log a terminal entry -
    // not loop forever leaving Run stuck on "Polling...".
    const getExecution = vi.fn().mockRejectedValue(
      new MedkitApiError({
        status: 404,
        message: "execution not found",
        code: "x-medkit-not-found",
        error_code: "x-medkit-not-found",
      }),
    );
    const client = {
      listOperations: vi.fn().mockResolvedValue([ACTION_OP]),
      createExecution: vi.fn().mockResolvedValue(ACTION_RESPONSE),
      getExecution,
      cancelExecution: vi.fn(async () => undefined),
    } as unknown as MedkitApiClient;

    render(
      <OperationsPanel client={client} entityType="apps" entityId="a1" theme={THEME} />,
    );
    await flushMicrotasks();
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));
    await flushMicrotasks();

    // Tick 1: the 404 rejection stops the loop terminally.
    await advanceOnePoll();
    expect(getExecution).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Execution polling stopped/)).toBeInTheDocument();
    // A terminal entry is recorded (history toggle shows one entry).
    expect(screen.getByText(/History \(1\)/)).toBeInTheDocument();
    // Run is re-enabled, not frozen on "Polling...".
    expect(
      (screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }) as HTMLButtonElement).disabled,
    ).toBe(false);

    // No further polls after the terminal 404.
    await advanceOnePoll();
    await advanceOnePoll();
    expect(getExecution).toHaveBeenCalledTimes(1);
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
    await flushMicrotasks();
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    await flushMicrotasks();
    expect(screen.getByText("exec-abc-123")).toBeInTheDocument();

    await advanceOnePoll();
    expect(screen.getByText("completed")).toBeInTheDocument();

    // History toggle button should appear
    expect(screen.getByRole("button", { name: "Toggle execution history" })).toBeInTheDocument();
  });
});

describe("OperationsPanel - Run button disabled while polling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("disables Run while action is polling; re-enables at terminal", async () => {
    const client = makePollingClient([
      { status: "running" },
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
    await flushMicrotasks();
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));

    const runBtn = screen.getByRole("button", { name: `Run ${ACTION_OP.name}` });
    expect(runBtn).not.toBeDisabled();

    fireEvent.click(runBtn);

    // After createExecution resolves, polling=true => button must be disabled
    // and labeled "Polling...".
    await flushMicrotasks();
    expect(screen.getByText("exec-abc-123")).toBeInTheDocument();
    expect(runBtn).toBeDisabled();
    expect(runBtn).toHaveTextContent("Polling...");

    // Tick 1: running (still non-terminal) => still disabled
    await advanceOnePoll();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(runBtn).toBeDisabled();

    // Tick 2: completed (terminal) => polling stops => re-enabled
    await advanceOnePoll();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(runBtn).not.toBeDisabled();
    expect(runBtn).toHaveTextContent("Run");
  });
});

describe("OperationsPanel - action cancel", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
    await flushMicrotasks();
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    await flushMicrotasks();
    expect(screen.getByText("exec-abc-123")).toBeInTheDocument();

    // Advance one tick so the poll runs once and the Cancel button is visible.
    await advanceOnePoll();
    expect(client.getExecution).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancel execution" })).toBeInTheDocument();

    const callsBeforeCancel = (client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length;

    // Await the cancel resolution (cancelExecution + state update) BEFORE
    // asserting the poll count is frozen, so the freeze is real, not incidental
    // timing.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel execution" }));
      await flushMicrotasksRaw();
    });
    expect(client.cancelExecution).toHaveBeenCalledTimes(1);
    expect(screen.getByText("canceled")).toBeInTheDocument();

    // Advance further - no new getExecution calls (polling stopped on cancel).
    await advanceOnePoll();
    await advanceOnePoll();
    const callsAfterCancel = (client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterCancel).toBe(callsBeforeCancel);
  });

  it("does not mark the execution canceled when the cancel DELETE fails", async () => {
    const getExecution = vi.fn(async () => ({
      status: "running" as const,
      parameters: undefined,
      ros2_status: null,
    }));
    const cancelExecution = vi.fn().mockRejectedValue(new Error("cancel failed: 500"));
    const client = {
      listOperations: vi.fn().mockResolvedValue([ACTION_OP]),
      createExecution: vi.fn().mockResolvedValue(ACTION_RESPONSE),
      getExecution,
      cancelExecution,
    } as unknown as MedkitApiClient;

    render(
      <OperationsPanel client={client} entityType="apps" entityId="a1" theme={THEME} />,
    );
    await flushMicrotasks();
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));
    await flushMicrotasks();

    await advanceOnePoll();
    expect(screen.getByRole("button", { name: "Cancel execution" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel execution" }));
      await flushMicrotasksRaw();
    });
    expect(cancelExecution).toHaveBeenCalledTimes(1);
    // The DELETE failed, so the execution is NOT canceled: no canceled badge,
    // and the failure is surfaced instead.
    expect(screen.queryByText("canceled")).not.toBeInTheDocument();
    expect(screen.getByText(/cancel failed/i)).toBeInTheDocument();
  });
});

describe("OperationsPanel - action history", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accumulates history entries across multiple runs of the same op", async () => {
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
    await flushMicrotasks();
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));

    // Run 1 -> completed
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));
    await flushMicrotasks();
    expect(screen.getByText("exec-0")).toBeInTheDocument();
    await advanceOnePoll();
    expect(screen.getByText("completed")).toBeInTheDocument();

    // Run 2 -> failed
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));
    await flushMicrotasks();
    expect(screen.getByText("exec-1")).toBeInTheDocument();
    await advanceOnePoll();
    expect(screen.getByText("failed")).toBeInTheDocument();

    // History should have 2 entries with the right ids + terminal statuses.
    const historyBtn = screen.getByRole("button", { name: "Toggle execution history" });
    expect(historyBtn.textContent).toContain("2");
    fireEvent.click(historyBtn);
    // exec-0 appears only in history (run 1 was superseded); exec-1 appears in
    // both the still-visible lifecycle panel and the history list.
    expect(screen.getByText("exec-0")).toBeInTheDocument();
    expect(screen.getAllByText("exec-1").length).toBeGreaterThanOrEqual(1);
    // Terminal status badges for both runs are present.
    expect(screen.getAllByText("completed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("failed").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps history per-operation: switching away and back retains the prior op's runs", async () => {
    // Two action ops; each createExecution returns a stable id keyed by op name.
    const ACTION_A: Operation = { name: "act_a", path: "/act_a", type: "T/A", kind: "action" };
    const ACTION_B: Operation = { name: "act_b", path: "/act_b", type: "T/B", kind: "action" };
    const getExecution = vi.fn(async (_t: string, _id: string, opName: string) => ({
      id: `exec-${opName}`,
      status: "completed" as const,
      parameters: undefined,
      ros2_status: null,
    }));
    const createExecution = vi.fn(async (_t: string, _id: string, opName: string) => ({
      id: `exec-${opName}`,
      status: "pending",
      kind: "action",
    }));
    const client = {
      listOperations: vi.fn().mockResolvedValue([ACTION_A, ACTION_B]),
      createExecution,
      getExecution,
      cancelExecution: vi.fn(async () => undefined),
    } as unknown as MedkitApiClient;

    render(
      <OperationsPanel
        client={client}
        entityType="apps"
        entityId="a1"
        theme={THEME}
      />,
    );
    await flushMicrotasks();

    // Select op A, run it to terminal -> A has one history entry.
    fireEvent.click(screen.getByRole("button", { name: "act_a" }));
    fireEvent.click(screen.getByRole("button", { name: "Run act_a" }));
    await flushMicrotasks();
    await advanceOnePoll();
    expect(screen.getByRole("button", { name: "Toggle execution history" }).textContent).toContain("1");

    // Switch to op B: its history is empty (no history button).
    fireEvent.click(screen.getByRole("button", { name: "act_b" }));
    expect(screen.queryByRole("button", { name: "Toggle execution history" })).not.toBeInTheDocument();

    // Switch back to op A: A's prior run is RETAINED (not cleared on op-select).
    fireEvent.click(screen.getByRole("button", { name: "act_a" }));
    const histBtn = screen.getByRole("button", { name: "Toggle execution history" });
    expect(histBtn.textContent).toContain("1");
    fireEvent.click(histBtn);
    // Content assertion: the exact execution id + terminal status are shown.
    expect(screen.getByText("exec-act_a")).toBeInTheDocument();
    expect(screen.getAllByText("completed").length).toBeGreaterThanOrEqual(1);
  });
});

describe("OperationsPanel - lifecycle hygiene (unmount stops polling)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
    await flushMicrotasks();
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    await flushMicrotasks();
    expect(screen.getByText("exec-abc-123")).toBeInTheDocument();

    // Two ticks to PROVE polling is actively running (status went non-terminal
    // "running" and getExecution was called more than once), so the post-unmount
    // freeze is a real stop, not a 0==0 no-op.
    await advanceOnePoll();
    await advanceOnePoll();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect((client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    const callsBeforeUnmount = (client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length;

    unmount();

    // Advance more ticks - no new calls after unmount.
    await advanceOnePoll();
    await advanceOnePoll();
    await advanceOnePoll();
    expect((client.getExecution as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeUnmount);
  });
});

describe("OperationsPanel - entity change stops polling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
    await flushMicrotasks();
    fireEvent.click(screen.getByRole("button", { name: ACTION_OP.name }));
    fireEvent.click(screen.getByRole("button", { name: `Run ${ACTION_OP.name}` }));

    await flushMicrotasks();
    expect(screen.getByText("exec-abc-123")).toBeInTheDocument();

    await advanceOnePoll();
    expect(client.getExecution).toHaveBeenCalledTimes(1);
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
    await flushMicrotasks();

    await advanceOnePoll();
    await advanceOnePoll();
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
