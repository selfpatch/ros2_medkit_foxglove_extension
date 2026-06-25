// Copyright 2026 bburda. Apache-2.0 license.
import { afterEach, describe, expect, it, vi } from "vitest";

import { MedkitApiClient } from "./medkit-api";
import { getEntityLogs, getEntityLogsConfiguration, putEntityLogsConfiguration } from "./api-dispatch";
import { MedkitApiError } from "./gateway-client";
import type { MedkitClient } from "./gateway-client";

// ---------------------------------------------------------------------------
// Fetch stubs (for MedkitApiClient tests)
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(json: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(json), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Dispatch-level tests (unit tests on raw dispatch helpers)
// ---------------------------------------------------------------------------

/** Build a minimal MedkitClient stub that records method+path+opts calls. */
function makeClient(): {
  client: MedkitClient;
  getCalls: Array<[string, unknown]>;
  putCalls: Array<[string, unknown]>;
} {
  const getCalls: Array<[string, unknown]> = [];
  const putCalls: Array<[string, unknown]> = [];

  const client = {
    GET: vi.fn((path: string, opts: unknown) => {
      getCalls.push([path, opts]);
      return Promise.resolve({ data: { items: [] }, error: undefined });
    }),
    PUT: vi.fn((path: string, opts: unknown) => {
      putCalls.push([path, opts]);
      return Promise.resolve({ data: undefined, error: undefined });
    }),
  } as unknown as MedkitClient;

  return { client, getCalls, putCalls };
}

// ---------------------------------------------------------------------------
// getEntityLogs - dispatch paths
// ---------------------------------------------------------------------------

describe("getEntityLogs - dispatches to correct path", () => {
  it("apps: GET /apps/{app_id}/logs", async () => {
    const { client, getCalls } = makeClient();
    await getEntityLogs(client, "apps", "motor", { severity: "error" });
    expect(getCalls).toHaveLength(1);
    const [path, opts] = getCalls[0]!;
    expect(path).toBe("/apps/{app_id}/logs");
    const params = (opts as { params: Record<string, unknown> }).params;
    expect((params.path as Record<string, string>).app_id).toBe("motor");
    // query is passed through (runtime only - schema marks it `never`)
    expect((params.query as Record<string, string>).severity).toBe("error");
  });

  it("components: GET /components/{component_id}/logs", async () => {
    const { client, getCalls } = makeClient();
    await getEntityLogs(client, "components", "host-1");
    const [path, opts] = getCalls[0]!;
    expect(path).toBe("/components/{component_id}/logs");
    expect(
      ((opts as { params: { path: Record<string, string> } }).params.path).component_id,
    ).toBe("host-1");
  });

  it("areas: GET /areas/{area_id}/logs with context filter", async () => {
    const { client, getCalls } = makeClient();
    await getEntityLogs(client, "areas", "factory", { context: "/sensor" });
    const [path, opts] = getCalls[0]!;
    expect(path).toBe("/areas/{area_id}/logs");
    expect(
      ((opts as { params: { path: Record<string, string> } }).params.path).area_id,
    ).toBe("factory");
    expect(
      ((opts as { params: { query: Record<string, string> } }).params.query).context,
    ).toBe("/sensor");
  });

  it("functions: GET /functions/{function_id}/logs", async () => {
    const { client, getCalls } = makeClient();
    await getEntityLogs(client, "functions", "safety-fn");
    const [path, opts] = getCalls[0]!;
    expect(path).toBe("/functions/{function_id}/logs");
    expect(
      ((opts as { params: { path: Record<string, string> } }).params.path).function_id,
    ).toBe("safety-fn");
  });

  it("omits severity/context keys when params are absent", async () => {
    const { client, getCalls } = makeClient();
    await getEntityLogs(client, "apps", "motor");
    const query = (getCalls[0]![1] as { params: { query: Record<string, string> } }).params.query;
    expect(Object.keys(query)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getEntityLogsConfiguration - dispatch paths
// ---------------------------------------------------------------------------

describe("getEntityLogsConfiguration - dispatches to correct path", () => {
  it("apps: GET /apps/{app_id}/logs/configuration", async () => {
    const { client, getCalls } = makeClient();
    await getEntityLogsConfiguration(client, "apps", "motor");
    const [path, opts] = getCalls[0]!;
    expect(path).toBe("/apps/{app_id}/logs/configuration");
    expect(
      ((opts as { params: { path: Record<string, string> } }).params.path).app_id,
    ).toBe("motor");
  });

  it("components: GET /components/{component_id}/logs/configuration", async () => {
    const { client, getCalls } = makeClient();
    await getEntityLogsConfiguration(client, "components", "host-1");
    const [path] = getCalls[0]!;
    expect(path).toBe("/components/{component_id}/logs/configuration");
  });

  it("areas: GET /areas/{area_id}/logs/configuration", async () => {
    const { client, getCalls } = makeClient();
    await getEntityLogsConfiguration(client, "areas", "factory");
    const [path] = getCalls[0]!;
    expect(path).toBe("/areas/{area_id}/logs/configuration");
  });

  it("functions: GET /functions/{function_id}/logs/configuration", async () => {
    const { client, getCalls } = makeClient();
    await getEntityLogsConfiguration(client, "functions", "safety-fn");
    const [path] = getCalls[0]!;
    expect(path).toBe("/functions/{function_id}/logs/configuration");
  });
});

// ---------------------------------------------------------------------------
// putEntityLogsConfiguration - dispatch paths + body
// ---------------------------------------------------------------------------

describe("putEntityLogsConfiguration - dispatches to correct path with body", () => {
  it("apps: PUT /apps/{app_id}/logs/configuration with full body", async () => {
    const { client, putCalls } = makeClient();
    await putEntityLogsConfiguration(client, "apps", "motor", {
      severity_filter: "warning",
      max_entries: 500,
    });
    const [path, opts] = putCalls[0]!;
    expect(path).toBe("/apps/{app_id}/logs/configuration");
    expect(
      ((opts as { params: { path: Record<string, string> } }).params.path).app_id,
    ).toBe("motor");
    const body = (opts as { body: unknown }).body;
    expect(body).toEqual({ severity_filter: "warning", max_entries: 500 });
  });

  it("functions: PUT /functions/{function_id}/logs/configuration", async () => {
    const { client, putCalls } = makeClient();
    await putEntityLogsConfiguration(client, "functions", "safety-fn", { severity_filter: "error" });
    const [path] = putCalls[0]!;
    expect(path).toBe("/functions/{function_id}/logs/configuration");
  });

  it("components: PUT /components/{component_id}/logs/configuration", async () => {
    const { client, putCalls } = makeClient();
    await putEntityLogsConfiguration(client, "components", "host-1", { max_entries: 200 });
    const [path, opts] = putCalls[0]!;
    expect(path).toBe("/components/{component_id}/logs/configuration");
    expect(
      ((opts as { params: { path: Record<string, string> } }).params.path).component_id,
    ).toBe("host-1");
    expect((opts as { body: unknown }).body).toEqual({ max_entries: 200 });
  });

  it("areas: PUT /areas/{area_id}/logs/configuration", async () => {
    const { client, putCalls } = makeClient();
    await putEntityLogsConfiguration(client, "areas", "factory", { severity_filter: "warning" });
    const [path, opts] = putCalls[0]!;
    expect(path).toBe("/areas/{area_id}/logs/configuration");
    expect(
      ((opts as { params: { path: Record<string, string> } }).params.path).area_id,
    ).toBe("factory");
  });
});

// ---------------------------------------------------------------------------
// MedkitApiClient.listEntityLogs - integration via fetch stub
// ---------------------------------------------------------------------------

describe("MedkitApiClient.listEntityLogs", () => {
  it("returns mapped LogEntry array for apps", async () => {
    stubFetch({
      items: [
        {
          id: "log_1",
          timestamp: "2026-01-01T00:00:00.000Z",
          severity: "ERROR",
          message: "Motor overheated",
          context: { node: "motor_controller", file: "motor.cpp", line: 42 },
        },
      ],
    });
    const client = new MedkitApiClient("http://gw", "api/v1");
    const result = await client.listEntityLogs("apps", "motor");
    expect(result.items).toHaveLength(1);
    const entry = result.items[0]!;
    expect(entry.id).toBe("log_1");
    expect(entry.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(entry.severity).toBe("error"); // lowercased
    expect(entry.message).toBe("Motor overheated");
    expect(entry.context.node).toBe("motor_controller");
    expect(entry.context.file).toBe("motor.cpp");
    expect(entry.context.line).toBe(42);
  });

  it("normalizes severities to the LogSeverity union and falls back to info", async () => {
    stubFetch({
      items: [
        { id: "log_1", timestamp: "2026-01-01T00:00:00.000Z", severity: "WARNING", message: "a", context: { node: "n" } },
        { id: "log_2", timestamp: "2026-01-01T00:00:01.000Z", severity: "Fatal", message: "b", context: { node: "n" } },
        { id: "log_3", timestamp: "2026-01-01T00:00:02.000Z", severity: "trace", message: "c", context: { node: "n" } },
        { id: "log_4", timestamp: "2026-01-01T00:00:03.000Z", message: "d", context: { node: "n" } },
      ],
    });
    const client = new MedkitApiClient("http://gw", "api/v1");
    const result = await client.listEntityLogs("apps", "motor");
    expect(result.items.map((e) => e.severity)).toEqual([
      "warning", // WARNING -> lowercased, in-union
      "fatal", // Fatal -> lowercased, in-union
      "info", // trace -> unknown -> safe fallback
      "info", // missing -> safe fallback
    ]);
  });

  it("preserves x-medkit aggregation metadata", async () => {
    stubFetch({
      items: [],
      "x-medkit": {
        aggregated: true,
        aggregation_level: "function",
        host_count: 3,
        aggregation_sources: ["app-1", "app-2", "app-3"],
      },
    });
    const client = new MedkitApiClient("http://gw", "api/v1");
    const result = await client.listEntityLogs("functions", "safety-fn");
    expect(result["x-medkit"]).toEqual({
      aggregated: true,
      aggregation_level: "function",
      host_count: 3,
      aggregation_sources: ["app-1", "app-2", "app-3"],
    });
  });

  it("uses { node: 'unknown' } fallback when context is absent", async () => {
    stubFetch({
      items: [
        { id: "log_2", timestamp: "2026-01-01T00:00:01.000Z", severity: "info", message: "OK" },
      ],
    });
    const client = new MedkitApiClient("http://gw", "api/v1");
    const result = await client.listEntityLogs("components", "host-1");
    expect(result.items[0]!.context).toEqual({ node: "unknown" });
  });

  it("throws on 503 (no LogManager), preserving the error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "x-medkit-503", message: "Log manager not available" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const client = new MedkitApiClient("http://gw", "api/v1");
    const err = await client.listEntityLogs("apps", "motor").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MedkitApiError);
    expect((err as MedkitApiError).status).toBe(503);
  });

  it("throws on 404 (entity not found)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "ERR_ENTITY_NOT_FOUND", message: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const client = new MedkitApiClient("http://gw", "api/v1");
    const err = await client.listEntityLogs("apps", "ghost").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MedkitApiError);
    expect((err as MedkitApiError).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// MedkitApiClient.listEntityLogs - severity normalization
// ---------------------------------------------------------------------------

describe("MedkitApiClient.listEntityLogs - severity normalization", () => {
  it.each([
    // Gateway canonical (already lowercase) - pass through unchanged
    ["error", "error"],
    ["warning", "warning"],
    ["info", "info"],
    ["debug", "debug"],
    ["fatal", "fatal"],
    // Gateway may send uppercase (normalize to lowercase)
    ["ERROR", "error"],
    ["WARNING", "warning"],
    ["INFO", "info"],
    ["DEBUG", "debug"],
    ["FATAL", "fatal"],
  ] as [string, string][])(
    "severity=%j is lowercased to %j",
    async (rawSeverity, expectedSeverity) => {
      stubFetch({
        items: [
          {
            id: "s1",
            timestamp: "2026-01-01T00:00:00.000Z",
            severity: rawSeverity,
            message: "test",
            context: { node: "n" },
          },
        ],
      });
      const client = new MedkitApiClient("http://gw", "api/v1");
      const result = await client.listEntityLogs("apps", "motor");
      expect(result.items[0]!.severity).toBe(expectedSeverity);
    },
  );

  it("uses 'info' fallback when severity is null/missing", async () => {
    stubFetch({
      items: [
        {
          id: "s2",
          timestamp: "2026-01-01T00:00:00.000Z",
          // severity absent
          message: "test",
          context: { node: "n" },
        },
      ],
    });
    const client = new MedkitApiClient("http://gw", "api/v1");
    const result = await client.listEntityLogs("apps", "motor");
    expect(result.items[0]!.severity).toBe("info");
  });
});

// ---------------------------------------------------------------------------
// MedkitApiClient.getLogsConfiguration
// ---------------------------------------------------------------------------

describe("MedkitApiClient.getLogsConfiguration", () => {
  it("returns LogConfiguration for apps", async () => {
    stubFetch({ max_entries: 1000, severity_filter: "warning" });
    const client = new MedkitApiClient("http://gw", "api/v1");
    const config = await client.getLogsConfiguration("apps", "motor");
    expect(config.max_entries).toBe(1000);
    expect(config.severity_filter).toBe("warning");
  });

  it("throws on 404 (no LogManager), preserving the error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "ERR_ENTITY_NOT_FOUND", message: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const client = new MedkitApiClient("http://gw", "api/v1");
    const err = await client.getLogsConfiguration("components", "host-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MedkitApiError);
    expect((err as MedkitApiError).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// MedkitApiClient.updateLogsConfiguration
// ---------------------------------------------------------------------------

describe("MedkitApiClient.updateLogsConfiguration", () => {
  it("resolves (void) on 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const client = new MedkitApiClient("http://gw", "api/v1");
    await expect(
      client.updateLogsConfiguration("apps", "motor", { max_entries: 500, severity_filter: "error" }),
    ).resolves.toBeUndefined();
  });

  it("throws on 400 (bad body), preserving the error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "ERR_INVALID_BODY", message: "Bad request" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const client = new MedkitApiClient("http://gw", "api/v1");
    const err = await client
      .updateLogsConfiguration("functions", "safety-fn", { max_entries: -1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MedkitApiError);
    expect((err as MedkitApiError).status).toBe(400);
  });
});
