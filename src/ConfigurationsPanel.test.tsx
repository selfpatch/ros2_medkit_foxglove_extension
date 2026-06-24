// Copyright 2024-2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { ConfigurationsPanel } from "./ConfigurationsPanel";
import type { MedkitApiClient } from "./medkit-api";
import type { ComponentConfigurations, Parameter } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THEME = "dark" as const;
const ENTITY_TYPE = "apps" as const;
const ENTITY_ID = "motor-app";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeParam(overrides: Partial<Parameter> = {}): Parameter {
  return {
    name: "my_param",
    value: 42,
    type: "int",
    ...overrides,
  };
}

function makeConfigs(params: Parameter[]): ComponentConfigurations {
  return {
    component_id: ENTITY_ID,
    node_name: ENTITY_ID,
    parameters: params,
  };
}

// ---------------------------------------------------------------------------
// Client stub factory
// ---------------------------------------------------------------------------

function makeClient(
  overrides: Partial<{
    listConfigurations: MedkitApiClient["listConfigurations"];
    setConfiguration: MedkitApiClient["setConfiguration"];
    resetConfiguration: MedkitApiClient["resetConfiguration"];
    resetAllConfigurations: MedkitApiClient["resetAllConfigurations"];
  }> = {},
): MedkitApiClient {
  return {
    listConfigurations: vi.fn().mockResolvedValue(makeConfigs([])),
    setConfiguration: vi.fn().mockResolvedValue(undefined),
    resetConfiguration: vi.fn().mockResolvedValue(undefined),
    resetAllConfigurations: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MedkitApiClient;
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderPanel(client: MedkitApiClient) {
  return render(
    <ConfigurationsPanel
      client={client}
      entityType={ENTITY_TYPE}
      entityId={ENTITY_ID}
      theme={THEME}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests: loading state
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - loading state", () => {
  it("shows Loading... while fetch is pending", () => {
    const client = makeClient({
      listConfigurations: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    renderPanel(client);
    expect(screen.getByRole("status", { name: /loading configurations/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: error state
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - error state", () => {
  it("shows error when listConfigurations throws", async () => {
    const client = makeClient({
      listConfigurations: vi.fn().mockRejectedValue(new Error("network timeout")),
    });
    renderPanel(client);
    await waitFor(() => {
      expect(screen.getByText(/network timeout/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: empty state
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - empty state", () => {
  it("shows No configurations when parameter list is empty", async () => {
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([])),
    });
    renderPanel(client);
    await waitFor(() => {
      expect(screen.getByText("No configurations")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: parameter display
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - parameter display", () => {
  it("shows parameter name, value, and type badge", async () => {
    const param = makeParam({ name: "speed_limit", value: 1.5, type: "double" });
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
    });
    renderPanel(client);
    await waitFor(() => {
      expect(screen.getByText("speed_limit")).toBeInTheDocument();
      expect(screen.getByText("double")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: bool parameter - toggle
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - bool parameter", () => {
  it("renders toggle button showing current bool value and calls setConfiguration with !value on click", async () => {
    const param = makeParam({ name: "enabled", value: false, type: "bool" });
    const setConfiguration = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
      setConfiguration,
    });
    renderPanel(client);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /toggle enabled/i })).toBeInTheDocument();
    });

    const toggleBtn = screen.getByRole("button", { name: /toggle enabled/i });
    expect(toggleBtn).toHaveTextContent("false");

    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(setConfiguration).toHaveBeenCalledWith(ENTITY_TYPE, ENTITY_ID, "enabled", true);
    });
  });

  it("shows true for a param with value true", async () => {
    const param = makeParam({ name: "enabled", value: true, type: "bool" });
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
    });
    renderPanel(client);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /toggle enabled/i })).toHaveTextContent("true");
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: int / double parameter
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - int/double parameter", () => {
  it("renders a number input for int param; Save calls setConfiguration with numeric value", async () => {
    const param = makeParam({ name: "max_speed", value: 10, type: "int" });
    const setConfiguration = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
      setConfiguration,
    });
    renderPanel(client);

    await waitFor(() => {
      expect(screen.getByLabelText(/value for max_speed/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/value for max_speed/i);
    expect(input).toHaveAttribute("type", "number");

    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /save max_speed/i }));

    await waitFor(() => {
      expect(setConfiguration).toHaveBeenCalledWith(ENTITY_TYPE, ENTITY_ID, "max_speed", 25);
    });
  });

  it("renders a number input for double param", async () => {
    const param = makeParam({ name: "gain", value: 0.5, type: "double" });
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
    });
    renderPanel(client);
    await waitFor(() => {
      const input = screen.getByLabelText(/value for gain/i);
      expect(input).toHaveAttribute("type", "number");
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: string parameter
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - string parameter", () => {
  it("renders text input for string param; Save calls setConfiguration with string value", async () => {
    const param = makeParam({ name: "robot_name", value: "r2d2", type: "string" });
    const setConfiguration = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
      setConfiguration,
    });
    renderPanel(client);

    await waitFor(() => {
      expect(screen.getByLabelText(/value for robot_name/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/value for robot_name/i);
    expect(input).toHaveAttribute("type", "text");

    fireEvent.change(input, { target: { value: "bb8" } });
    fireEvent.click(screen.getByRole("button", { name: /save robot_name/i }));

    await waitFor(() => {
      expect(setConfiguration).toHaveBeenCalledWith(ENTITY_TYPE, ENTITY_ID, "robot_name", "bb8");
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: *_array parameter
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - *_array parameter", () => {
  it("renders text input for int_array; Save parses JSON and calls setConfiguration", async () => {
    const param = makeParam({ name: "limits", value: [1, 2, 3], type: "int_array" });
    const setConfiguration = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
      setConfiguration,
    });
    renderPanel(client);

    await waitFor(() => {
      expect(screen.getByLabelText(/value for limits/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/value for limits/i);
    fireEvent.change(input, { target: { value: "[10,20,30]" } });
    fireEvent.click(screen.getByRole("button", { name: /save limits/i }));

    await waitFor(() => {
      expect(setConfiguration).toHaveBeenCalledWith(ENTITY_TYPE, ENTITY_ID, "limits", [10, 20, 30]);
    });
  });

  it("shows inline parse error and does NOT call setConfiguration for invalid JSON", async () => {
    const param = makeParam({ name: "tags", value: ["a", "b"], type: "string_array" });
    const setConfiguration = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
      setConfiguration,
    });
    renderPanel(client);

    await waitFor(() => {
      expect(screen.getByLabelText(/value for tags/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/value for tags/i);
    fireEvent.change(input, { target: { value: "not-valid-json{{{" } });
    fireEvent.click(screen.getByRole("button", { name: /save tags/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
    });
    expect(setConfiguration).not.toHaveBeenCalled();
  });

  it("shows inline parse error and does NOT call setConfiguration when value is not an array", async () => {
    const param = makeParam({ name: "ids", value: [1], type: "int_array" });
    const setConfiguration = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
      setConfiguration,
    });
    renderPanel(client);

    await waitFor(() => {
      expect(screen.getByLabelText(/value for ids/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/value for ids/i);
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: /save ids/i }));

    await waitFor(() => {
      expect(screen.getByText(/must be a json array/i)).toBeInTheDocument();
    });
    expect(setConfiguration).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: read-only parameter
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - read-only parameter", () => {
  it("disables input and shows (locked) text for a read_only param", async () => {
    const param = makeParam({ name: "hw_version", value: "1.0", type: "string", read_only: true });
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
    });
    renderPanel(client);
    await waitFor(() => {
      expect(screen.getByText("hw_version")).toBeInTheDocument();
      expect(screen.getByText("(locked)")).toBeInTheDocument();
    });
    // No save button for read-only param
    expect(screen.queryByRole("button", { name: /save hw_version/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: Reset button per parameter
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - Reset button", () => {
  it("Reset button calls resetConfiguration then reloads (listConfigurations called again)", async () => {
    const param = makeParam({ name: "timeout", value: 30, type: "int" });
    const resetConfiguration = vi.fn().mockResolvedValue(undefined);
    const listConfigurations = vi.fn().mockResolvedValue(makeConfigs([param]));
    const client = makeClient({ listConfigurations, resetConfiguration });
    renderPanel(client);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reset timeout/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /reset timeout/i }));

    await waitFor(() => {
      expect(resetConfiguration).toHaveBeenCalledWith(ENTITY_TYPE, ENTITY_ID, "timeout");
      // reload: listConfigurations called at least twice (initial + after reset)
      expect(listConfigurations.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("does not render Reset button for read_only param", async () => {
    const param = makeParam({ name: "hw_rev", value: "2", type: "string", read_only: true });
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
    });
    renderPanel(client);
    await waitFor(() => expect(screen.getByText("hw_rev")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /reset hw_rev/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: Reset All button
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - Reset All button", () => {
  it("Reset All calls resetAllConfigurations; shows Reset N, M failed when result has counts", async () => {
    const param = makeParam({ name: "speed", value: 5, type: "int" });
    const resetAllConfigurations = vi.fn().mockResolvedValue({ reset_count: 3, failed_count: 1 });
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
      resetAllConfigurations,
    });
    renderPanel(client);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reset all configurations/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /reset all configurations/i }));

    await waitFor(() => {
      expect(resetAllConfigurations).toHaveBeenCalledWith(ENTITY_TYPE, ENTITY_ID);
      expect(screen.getByText("Reset 3, 1 failed")).toBeInTheDocument();
    });
  });

  it("Reset All with void result (no body) does not show status banner", async () => {
    const param = makeParam({ name: "speed", value: 5, type: "int" });
    const resetAllConfigurations = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
      resetAllConfigurations,
    });
    renderPanel(client);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reset all configurations/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /reset all configurations/i }));

    await waitFor(() => {
      expect(resetAllConfigurations).toHaveBeenCalled();
    });
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: byte_array parameter
// ---------------------------------------------------------------------------

describe("ConfigurationsPanel - byte_array parameter", () => {
  it("renders array editor for byte_array; valid JSON array saves", async () => {
    const param = makeParam({ name: "raw_bytes", value: [0, 1, 255], type: "byte_array" });
    const setConfiguration = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
      setConfiguration,
    });
    renderPanel(client);

    await waitFor(() => {
      expect(screen.getByLabelText(/value for raw_bytes/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/value for raw_bytes/i);
    fireEvent.change(input, { target: { value: "[10, 20, 30]" } });
    fireEvent.click(screen.getByRole("button", { name: /save raw_bytes/i }));

    await waitFor(() => {
      expect(setConfiguration).toHaveBeenCalledWith(ENTITY_TYPE, ENTITY_ID, "raw_bytes", [10, 20, 30]);
    });
  });

  it("shows inline parse error and blocks submit for invalid JSON in byte_array", async () => {
    const param = makeParam({ name: "raw_bytes", value: [1, 2], type: "byte_array" });
    const setConfiguration = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listConfigurations: vi.fn().mockResolvedValue(makeConfigs([param])),
      setConfiguration,
    });
    renderPanel(client);

    await waitFor(() => {
      expect(screen.getByLabelText(/value for raw_bytes/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/value for raw_bytes/i);
    fireEvent.change(input, { target: { value: "not-json" } });
    fireEvent.click(screen.getByRole("button", { name: /save raw_bytes/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
    });
    expect(setConfiguration).not.toHaveBeenCalled();
  });
});
