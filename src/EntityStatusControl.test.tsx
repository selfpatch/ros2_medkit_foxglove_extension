// Copyright 2026 bburda. Apache-2.0 license.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { EntityStatusControl } from "./EntityStatusControl";
import type { MedkitApiClient } from "./medkit-api";
import { MedkitApiError } from "./gateway-client";
import type { LifecycleStatusResponse } from "./types";

const THEME = "dark" as const;

// The gateway advertises acceptable transitions as link fields on the status
// response; the control gates each button on its link. A ready entity offers
// restart/shutdown (not start); a notReady one offers start/force-restart.
const READY: LifecycleStatusResponse = {
  status: "ready",
  restart: "/restart",
  "force-restart": "/force-restart",
  shutdown: "/shutdown",
  "force-shutdown": "/force-shutdown",
};
const NOT_READY: LifecycleStatusResponse = {
  status: "notReady",
  start: "/start",
  "force-restart": "/force-restart",
};

afterEach(() => {
  vi.restoreAllMocks();
});

function makeClient(
  overrides: Partial<{
    getEntityStatus: MedkitApiClient["getEntityStatus"];
    setEntityStatus: MedkitApiClient["setEntityStatus"];
  }> = {},
): MedkitApiClient {
  return {
    getEntityStatus: vi.fn().mockResolvedValue(READY),
    setEntityStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MedkitApiClient;
}

function renderControl(client: MedkitApiClient, entityId = "app1") {
  return render(
    <EntityStatusControl client={client} entityType="apps" entityId={entityId} theme={THEME} />,
  );
}

describe("EntityStatusControl - status display", () => {
  it("shows the ready badge", async () => {
    renderControl(makeClient({ getEntityStatus: vi.fn().mockResolvedValue({ status: "ready" }) }));
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
  });

  it("shows the notReady badge", async () => {
    renderControl(makeClient({ getEntityStatus: vi.fn().mockResolvedValue({ status: "notReady" }) }));
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
  });

  it("shows a not-available state and no action buttons on 501 (no lifecycle provider)", async () => {
    renderControl(makeClient({ getEntityStatus: vi.fn().mockResolvedValue("unavailable") }));
    await waitFor(() => expect(screen.getByText("not available")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Start/ })).not.toBeInTheDocument();
  });
});

describe("EntityStatusControl - action gating", () => {
  it("enables the transitions the gateway advertises (ready: restart/shutdown, not start)", async () => {
    renderControl(makeClient({ getEntityStatus: vi.fn().mockResolvedValue(READY) }));
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    expect((screen.getByRole("button", { name: "Start app1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Restart app1" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Shutdown app1" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("enables the transitions the gateway advertises (notReady: start, not restart/shutdown)", async () => {
    renderControl(makeClient({ getEntityStatus: vi.fn().mockResolvedValue(NOT_READY) }));
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
    expect((screen.getByRole("button", { name: "Start app1" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Restart app1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Shutdown app1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables every transition when the gateway advertises none (fail-safe)", async () => {
    // status known but no transition links -> nothing actionable.
    renderControl(makeClient({ getEntityStatus: vi.fn().mockResolvedValue({ status: "ready" }) }));
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    for (const name of [
      "Start app1",
      "Restart app1",
      "Force restart app1",
      "Shutdown app1",
      "Force shutdown app1",
    ]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe("EntityStatusControl - transitions", () => {
  it("dispatches Start immediately without a confirmation", async () => {
    const setEntityStatus = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      getEntityStatus: vi.fn().mockResolvedValue(NOT_READY),
      setEntityStatus,
    });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Start app1" }));
    await waitFor(() => expect(setEntityStatus).toHaveBeenCalledWith("apps", "app1", "start"));
  });

  it("asks for confirmation before a destructive Shutdown", async () => {
    const setEntityStatus = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      getEntityStatus: vi.fn().mockResolvedValue(READY),
      setEntityStatus,
    });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Shutdown app1" }));
    // Not dispatched yet - confirmation required.
    expect(setEntityStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(setEntityStatus).toHaveBeenCalledWith("apps", "app1", "shutdown"));
  });

  it("cancels a destructive action without dispatching", async () => {
    const setEntityStatus = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      getEntityStatus: vi.fn().mockResolvedValue(READY),
      setEntityStatus,
    });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Shutdown app1" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(setEntityStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
  });

  it("re-fetches status after a successful transition", async () => {
    const getEntityStatus = vi.fn().mockResolvedValue(NOT_READY);
    const client = makeClient({ getEntityStatus, setEntityStatus: vi.fn().mockResolvedValue(undefined) });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
    expect(getEntityStatus).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Start app1" }));
    await waitFor(() => expect(getEntityStatus).toHaveBeenCalledTimes(2));
  });

  it("shows the action's label (not its raw id) in a transition error", async () => {
    // A non-Error rejection hits the fallback message, which should read
    // "Force restart failed", not "Failed to force-restart".
    const setEntityStatus = vi.fn().mockRejectedValue("nope");
    const client = makeClient({ getEntityStatus: vi.fn().mockResolvedValue(NOT_READY), setEntityStatus });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Force restart app1" }));
    expect(await screen.findByText("Force restart failed")).toBeInTheDocument();
  });

  it("disables all actions and notes it when a transition returns 501", async () => {
    const setEntityStatus = vi.fn().mockRejectedValue(
      new MedkitApiError({ status: 501, message: "no provider", code: "x", error_code: "x" }),
    );
    const client = makeClient({
      getEntityStatus: vi.fn().mockResolvedValue(NOT_READY),
      setEntityStatus,
    });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Start app1" }));
    await waitFor(() => expect(screen.getByText(/not implemented by this gateway/i)).toBeInTheDocument());
    await act(async () => { await Promise.resolve(); });
    // Every transition is now disabled gateway-wide.
    expect((screen.getByRole("button", { name: "Start app1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Force restart app1" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
