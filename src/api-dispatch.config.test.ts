// Copyright 2024-2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi } from "vitest";

import { deleteEntityConfiguration, deleteEntityConfigurations } from "./api-dispatch";
import type { MedkitClient } from "./gateway-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(): {
  client: MedkitClient;
  deleteCalls: Array<[string, unknown]>;
} {
  const deleteCalls: Array<[string, unknown]> = [];
  const client = {
    DELETE: vi.fn((path: string, opts: unknown) => {
      deleteCalls.push([path, opts]);
      return Promise.resolve({ data: undefined, error: undefined });
    }),
  } as unknown as MedkitClient;
  return { client, deleteCalls };
}

// ---------------------------------------------------------------------------
// deleteEntityConfiguration - path dispatch
// ---------------------------------------------------------------------------

describe("deleteEntityConfiguration - dispatches to correct path", () => {
  it("apps: DELETE /apps/{app_id}/configurations/{config_id}", async () => {
    const { client, deleteCalls } = makeClient();
    await deleteEntityConfiguration(client, "apps", "motor-app", "speed_limit");
    expect(deleteCalls).toHaveLength(1);
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/apps/{app_id}/configurations/{config_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      app_id: "motor-app",
      config_id: "speed_limit",
    });
  });

  it("components: DELETE /components/{component_id}/configurations/{config_id}", async () => {
    const { client, deleteCalls } = makeClient();
    await deleteEntityConfiguration(client, "components", "host-1", "timeout");
    expect(deleteCalls).toHaveLength(1);
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/components/{component_id}/configurations/{config_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      component_id: "host-1",
      config_id: "timeout",
    });
  });

  it("areas: DELETE /areas/{area_id}/configurations/{config_id}", async () => {
    const { client, deleteCalls } = makeClient();
    await deleteEntityConfiguration(client, "areas", "warehouse", "max_velocity");
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/areas/{area_id}/configurations/{config_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      area_id: "warehouse",
      config_id: "max_velocity",
    });
  });

  it("functions: DELETE /functions/{function_id}/configurations/{config_id}", async () => {
    const { client, deleteCalls } = makeClient();
    await deleteEntityConfiguration(client, "functions", "safety-fn", "threshold");
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/functions/{function_id}/configurations/{config_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      function_id: "safety-fn",
      config_id: "threshold",
    });
  });
});

// ---------------------------------------------------------------------------
// deleteEntityConfigurations - path dispatch
// ---------------------------------------------------------------------------

describe("deleteEntityConfigurations - dispatches to correct path", () => {
  it("apps: DELETE /apps/{app_id}/configurations", async () => {
    const { client, deleteCalls } = makeClient();
    await deleteEntityConfigurations(client, "apps", "motor-app");
    expect(deleteCalls).toHaveLength(1);
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/apps/{app_id}/configurations");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      app_id: "motor-app",
    });
  });

  it("components: DELETE /components/{component_id}/configurations", async () => {
    const { client, deleteCalls } = makeClient();
    await deleteEntityConfigurations(client, "components", "host-1");
    expect(deleteCalls).toHaveLength(1);
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/components/{component_id}/configurations");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      component_id: "host-1",
    });
  });

  it("areas: DELETE /areas/{area_id}/configurations", async () => {
    const { client, deleteCalls } = makeClient();
    await deleteEntityConfigurations(client, "areas", "warehouse");
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/areas/{area_id}/configurations");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      area_id: "warehouse",
    });
  });

  it("functions: DELETE /functions/{function_id}/configurations", async () => {
    const { client, deleteCalls } = makeClient();
    await deleteEntityConfigurations(client, "functions", "safety-fn");
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/functions/{function_id}/configurations");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      function_id: "safety-fn",
    });
  });
});
