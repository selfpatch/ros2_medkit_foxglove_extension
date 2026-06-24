// Copyright 2024-2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi } from "vitest";

import { getExecution, cancelExecution } from "./api-dispatch";
import type { MedkitClient } from "./gateway-client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal MedkitClient stub that records GET/DELETE calls. */
function makeClient(): {
  client: MedkitClient;
  getCalls: Array<[string, unknown]>;
  deleteCalls: Array<[string, unknown]>;
} {
  const getCalls: Array<[string, unknown]> = [];
  const deleteCalls: Array<[string, unknown]> = [];

  const client = {
    GET: vi.fn((path: string, opts: unknown) => {
      getCalls.push([path, opts]);
      return Promise.resolve({ data: { status: "running" }, error: undefined });
    }),
    DELETE: vi.fn((path: string, opts: unknown) => {
      deleteCalls.push([path, opts]);
      return Promise.resolve({ data: undefined, error: undefined });
    }),
  } as unknown as MedkitClient;

  return { client, getCalls, deleteCalls };
}

// ---------------------------------------------------------------------------
// getExecution - path dispatch
// ---------------------------------------------------------------------------

describe("getExecution - dispatches to correct path", () => {
  it("apps: GET /apps/{app_id}/operations/{operation_id}/executions/{execution_id}", async () => {
    const { client, getCalls } = makeClient();
    await getExecution(client, "apps", "my-app", "nav_to_pose", "exec-1");
    expect(getCalls).toHaveLength(1);
    const [path, opts] = getCalls[0]!;
    expect(path).toBe("/apps/{app_id}/operations/{operation_id}/executions/{execution_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      app_id: "my-app",
      operation_id: "nav_to_pose",
      execution_id: "exec-1",
    });
  });

  it("components: GET /components/{component_id}/operations/{operation_id}/executions/{execution_id}", async () => {
    const { client, getCalls } = makeClient();
    await getExecution(client, "components", "host-1", "reboot", "exec-2");
    expect(getCalls).toHaveLength(1);
    const [path, opts] = getCalls[0]!;
    expect(path).toBe("/components/{component_id}/operations/{operation_id}/executions/{execution_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      component_id: "host-1",
      operation_id: "reboot",
      execution_id: "exec-2",
    });
  });

  it("areas: GET /areas/{area_id}/operations/{operation_id}/executions/{execution_id}", async () => {
    const { client, getCalls } = makeClient();
    await getExecution(client, "areas", "warehouse", "scan", "exec-3");
    const [path, opts] = getCalls[0]!;
    expect(path).toBe("/areas/{area_id}/operations/{operation_id}/executions/{execution_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      area_id: "warehouse",
      operation_id: "scan",
      execution_id: "exec-3",
    });
  });

  it("functions: GET /functions/{function_id}/operations/{operation_id}/executions/{execution_id}", async () => {
    const { client, getCalls } = makeClient();
    await getExecution(client, "functions", "safety-fn", "estop", "exec-4");
    const [path, opts] = getCalls[0]!;
    expect(path).toBe("/functions/{function_id}/operations/{operation_id}/executions/{execution_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      function_id: "safety-fn",
      operation_id: "estop",
      execution_id: "exec-4",
    });
  });
});

// ---------------------------------------------------------------------------
// cancelExecution - path dispatch
// ---------------------------------------------------------------------------

describe("cancelExecution - dispatches to correct path", () => {
  it("apps: DELETE /apps/{app_id}/operations/{operation_id}/executions/{execution_id}", async () => {
    const { client, deleteCalls } = makeClient();
    await cancelExecution(client, "apps", "my-app", "nav_to_pose", "exec-1");
    expect(deleteCalls).toHaveLength(1);
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/apps/{app_id}/operations/{operation_id}/executions/{execution_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      app_id: "my-app",
      operation_id: "nav_to_pose",
      execution_id: "exec-1",
    });
  });

  it("components: DELETE /components/{component_id}/operations/{operation_id}/executions/{execution_id}", async () => {
    const { client, deleteCalls } = makeClient();
    await cancelExecution(client, "components", "host-1", "reboot", "exec-2");
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/components/{component_id}/operations/{operation_id}/executions/{execution_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      component_id: "host-1",
      operation_id: "reboot",
      execution_id: "exec-2",
    });
  });

  it("areas: DELETE /areas/{area_id}/operations/{operation_id}/executions/{execution_id}", async () => {
    const { client, deleteCalls } = makeClient();
    await cancelExecution(client, "areas", "warehouse", "scan", "exec-3");
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/areas/{area_id}/operations/{operation_id}/executions/{execution_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      area_id: "warehouse",
      operation_id: "scan",
      execution_id: "exec-3",
    });
  });

  it("functions: DELETE /functions/{function_id}/operations/{operation_id}/executions/{execution_id}", async () => {
    const { client, deleteCalls } = makeClient();
    await cancelExecution(client, "functions", "safety-fn", "estop", "exec-4");
    const [path, opts] = deleteCalls[0]!;
    expect(path).toBe("/functions/{function_id}/operations/{operation_id}/executions/{execution_id}");
    expect((opts as { params: { path: Record<string, string> } }).params.path).toEqual({
      function_id: "safety-fn",
      operation_id: "estop",
      execution_id: "exec-4",
    });
  });
});
