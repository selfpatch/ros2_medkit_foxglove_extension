// Copyright 2026 bburda. Apache-2.0 license.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { EntityStatusControl } from "./EntityStatusControl";
import type { MedkitApiClient } from "./medkit-api";
import { MedkitApiError } from "./gateway-client";

const THEME = "dark" as const;

// Transitions are gated by the readiness the gateway reports, not by link fields
// (the gateway reports status only). ready -> Start disabled; notReady -> Restart
// / Shutdown / Force shutdown disabled.
const READY = { status: "ready" } as const;
const NOT_READY = { status: "notReady" } as const;

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

const ALL_BUTTONS = [
  "Start app1",
  "Restart app1",
  "Force restart app1",
  "Shutdown app1",
  "Force shutdown app1",
];

describe("EntityStatusControl - status display", () => {
  it("shows the ready badge", async () => {
    renderControl(makeClient({ getEntityStatus: vi.fn().mockResolvedValue(READY) }));
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
  });

  it("shows the notReady badge", async () => {
    renderControl(makeClient({ getEntityStatus: vi.fn().mockResolvedValue(NOT_READY) }));
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
  });

  it("shows a not-available state with disabled actions on 501 (no lifecycle provider)", async () => {
    renderControl(makeClient({ getEntityStatus: vi.fn().mockResolvedValue("unavailable") }));
    await waitFor(() => expect(screen.getByText("not available")).toBeInTheDocument());
    const start = screen.getByRole("button", { name: "Start app1" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start).toHaveAttribute("title", "No lifecycle provider configured");
  });

  it("surfaces a status read error and fails closed (all transitions disabled)", async () => {
    const client = makeClient({ getEntityStatus: vi.fn().mockRejectedValue(new Error("boom")) });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("unknown")).toBeInTheDocument());
    expect(screen.getByText(/Could not load status: boom/)).toBeInTheDocument();
    // Readiness is unknown, so no transition (including destructive ones) is allowed.
    for (const name of ALL_BUTTONS) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByRole("button", { name: "Shutdown app1" })).toHaveAttribute("title", "Status unknown");
  });
});

describe("EntityStatusControl - action gating (by readiness)", () => {
  it("disables Start (already running) and enables Restart/Shutdown when ready", async () => {
    renderControl(makeClient({ getEntityStatus: vi.fn().mockResolvedValue(READY) }));
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    const start = screen.getByRole("button", { name: "Start app1" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start).toHaveAttribute("title", "Already running");
    expect((screen.getByRole("button", { name: "Restart app1" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Shutdown app1" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("enables Start and disables Restart/Shutdown (not running) when notReady", async () => {
    renderControl(makeClient({ getEntityStatus: vi.fn().mockResolvedValue(NOT_READY) }));
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
    expect((screen.getByRole("button", { name: "Start app1" }) as HTMLButtonElement).disabled).toBe(false);
    const restart = screen.getByRole("button", { name: "Restart app1" }) as HTMLButtonElement;
    expect(restart.disabled).toBe(true);
    expect(restart).toHaveAttribute("title", "Entity is not running");
    expect((screen.getByRole("button", { name: "Shutdown app1" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("EntityStatusControl - confirmation", () => {
  it("dispatches Start immediately without a confirmation", async () => {
    const setEntityStatus = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({ getEntityStatus: vi.fn().mockResolvedValue(NOT_READY), setEntityStatus });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Start app1" }));
    await waitFor(() => expect(setEntityStatus).toHaveBeenCalledWith("apps", "app1", "start"));
  });

  it("asks for confirmation before Restart (non-start transition)", async () => {
    const setEntityStatus = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({ getEntityStatus: vi.fn().mockResolvedValue(READY), setEntityStatus });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Restart app1" }));
    expect(setEntityStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(setEntityStatus).toHaveBeenCalledWith("apps", "app1", "restart"));
  });

  it("asks for confirmation before a destructive Shutdown", async () => {
    const setEntityStatus = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({ getEntityStatus: vi.fn().mockResolvedValue(READY), setEntityStatus });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Shutdown app1" }));
    expect(setEntityStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(setEntityStatus).toHaveBeenCalledWith("apps", "app1", "shutdown"));
  });

  it("cancels a transition without dispatching", async () => {
    const setEntityStatus = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({ getEntityStatus: vi.fn().mockResolvedValue(READY), setEntityStatus });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Shutdown app1" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(setEntityStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
  });

  it("drops an armed confirmation when the entity changes (no carry-over)", async () => {
    const setEntityStatus = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({ getEntityStatus: vi.fn().mockResolvedValue(READY), setEntityStatus });
    const { rerender } = render(
      <EntityStatusControl client={client} entityType="apps" entityId="app1" theme={THEME} />,
    );
    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Shutdown app1" }));
    expect(screen.getByRole("button", { name: /Confirm/ })).toBeInTheDocument();

    rerender(<EntityStatusControl client={client} entityType="apps" entityId="app2" theme={THEME} />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument());
    expect(setEntityStatus).not.toHaveBeenCalled();
  });
});

describe("EntityStatusControl - results and feedback", () => {
  it("toasts success and re-fetches status after a transition", async () => {
    const getEntityStatus = vi.fn().mockResolvedValue(NOT_READY);
    const client = makeClient({ getEntityStatus, setEntityStatus: vi.fn().mockResolvedValue(undefined) });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
    expect(getEntityStatus).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Start app1" }));
    expect(await screen.findByText(/Start requested for app1/)).toBeInTheDocument();
    await waitFor(() => expect(getEntityStatus).toHaveBeenCalledTimes(2));
  });

  it("toasts a failure when a transition errors", async () => {
    const setEntityStatus = vi.fn().mockRejectedValue(new Error("boom"));
    const client = makeClient({ getEntityStatus: vi.fn().mockResolvedValue(NOT_READY), setEntityStatus });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Start app1" }));
    expect(await screen.findByText(/Failed to start app1: boom/)).toBeInTheDocument();
  });

  it("toasts and disables all transitions when one returns 501", async () => {
    const setEntityStatus = vi.fn().mockRejectedValue(
      new MedkitApiError({ status: 501, message: "no provider", code: "x", error_code: "x" }),
    );
    const client = makeClient({ getEntityStatus: vi.fn().mockResolvedValue(NOT_READY), setEntityStatus });
    renderControl(client);
    await waitFor(() => expect(screen.getByText("notReady")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Start app1" }));
    expect(await screen.findByText(/Start is not implemented by this gateway/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/Transitions not implemented by this gateway/i)).toBeInTheDocument(),
    );
    await act(async () => {
      await Promise.resolve();
    });
    for (const name of ALL_BUTTONS) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
