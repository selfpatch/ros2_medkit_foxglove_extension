// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";

import { UpdatesPanelView } from "./UpdatesPanel";
import type { UpdatesApi } from "./updates-api";

function fakeApi(overrides: Partial<UpdatesApi>): UpdatesApi {
  return {
    listUpdates: vi.fn(async () => []),
    getStatus: vi.fn(async () => ({ status: "Idle" })),
    prepare: vi.fn(async () => {}),
    execute: vi.fn(async () => {}),
    ...overrides,
  } as UpdatesApi;
}

describe("UpdatesPanelView", () => {
  it("renders rows with derived kind badges", async () => {
    const api = fakeApi({
      listUpdates: vi.fn(async () => [
        { id: "u1", name: "fixed_lidar 2.1.0", updated_components: ["scan_sensor_node"] },
        { id: "u2", name: "Install obstacle_classifier", added_components: ["obstacle_classifier"] },
      ]),
    });
    render(<UpdatesPanelView api={api} pollMs={0} />);
    await waitFor(() => {
      expect(screen.getByText("fixed_lidar 2.1.0")).toBeInTheDocument();
      expect(screen.getByText("Install obstacle_classifier")).toBeInTheDocument();
      expect(screen.getByText("Update")).toBeInTheDocument();
      expect(screen.getByText("Install")).toBeInTheDocument();
    });
  });

  it("disables Prepare for Uninstall rows", async () => {
    const api = fakeApi({
      listUpdates: vi.fn(async () => [
        { id: "u3", name: "Remove legacy", removed_components: ["broken_lidar_legacy"] },
      ]),
    });
    render(<UpdatesPanelView api={api} pollMs={0} />);
    await waitFor(() => screen.getByText("Remove legacy"));
    expect(screen.getByRole("button", { name: /prepare/i })).toBeDisabled();
  });

  it("calls api.prepare on click", async () => {
    const api = fakeApi({
      listUpdates: vi.fn(async () => [
        { id: "u1", name: "fixed_lidar 2.1.0", updated_components: ["scan_sensor_node"] },
      ]),
    });
    const user = userEvent.setup();
    render(<UpdatesPanelView api={api} pollMs={0} />);
    await waitFor(() => screen.getByText("fixed_lidar 2.1.0"));
    await user.click(screen.getByRole("button", { name: /prepare/i }));
    expect(api.prepare).toHaveBeenCalledWith("u1");
  });

  it("calls api.execute on click", async () => {
    const api = fakeApi({
      listUpdates: vi.fn(async () => [
        { id: "u1", name: "fixed_lidar 2.1.0", updated_components: ["scan_sensor_node"] },
      ]),
    });
    const user = userEvent.setup();
    render(<UpdatesPanelView api={api} pollMs={0} />);
    await waitFor(() => screen.getByText("fixed_lidar 2.1.0"));
    await user.click(screen.getByRole("button", { name: /execute/i }));
    expect(api.execute).toHaveBeenCalledWith("u1");
  });

  it("renders error banner when listUpdates throws", async () => {
    const api = fakeApi({
      listUpdates: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    render(<UpdatesPanelView api={api} pollMs={0} />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });
});
