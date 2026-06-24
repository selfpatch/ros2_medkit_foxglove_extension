// Copyright 2024-2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("shows 'Execution created' message for an action response", async () => {
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
      expect(screen.getByText(/Execution created/)).toBeInTheDocument();
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
