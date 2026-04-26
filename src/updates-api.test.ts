// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.

import { describe, expect, it, vi } from "vitest";
import { createUpdatesApi } from "./updates-api";

describe("UpdatesApi", () => {
  it("listUpdates returns array", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [{ id: "a" }],
    })) as unknown as typeof fetch;
    const api = createUpdatesApi("http://gw/api/v1", fetchMock);
    const out = await api.listUpdates();
    expect(out).toEqual([{ id: "a" }]);
  });

  it("prepare hits PUT /updates/{id}/prepare", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    const api = createUpdatesApi("http://gw/api/v1", fetchMock);
    await api.prepare("u1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://gw/api/v1/updates/u1/prepare",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("execute hits PUT /updates/{id}/execute", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    const api = createUpdatesApi("http://gw/api/v1", fetchMock);
    await api.execute("u1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://gw/api/v1/updates/u1/execute",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("getStatus parses body", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: "Idle" }),
    })) as unknown as typeof fetch;
    const api = createUpdatesApi("http://gw/api/v1", fetchMock);
    const status = await api.getStatus("u1");
    expect(status).toEqual({ status: "Idle" });
  });

  it("listUpdates throws on non-ok response", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    const api = createUpdatesApi("http://gw/api/v1", fetchMock);
    await expect(api.listUpdates()).rejects.toThrow();
  });
});
