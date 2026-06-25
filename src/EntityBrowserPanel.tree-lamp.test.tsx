// Copyright 2026 bburda. Apache-2.0 license.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { TreeNodeRow } from "./EntityBrowserPanel";
import { colors } from "./styles";
import type { SovdEntity } from "./types";

const THEME = "dark" as const;
const c = colors(THEME);

function node(entity: Partial<SovdEntity> & { type: string; id: string }) {
  return { entity: entity as SovdEntity, isExpanded: false, isLoading: false };
}

function renderRow(
  entity: Partial<SovdEntity> & { type: string; id: string },
  statusByEntity: Record<string, "ready" | "notReady" | "unavailable" | "unknown" | "error">,
) {
  return render(
    <TreeNodeRow
      node={node(entity)}
      path={[0]}
      depth={0}
      theme={THEME}
      selected={null}
      statusByEntity={statusByEntity}
      onToggle={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
}

describe("EntityBrowser tree readiness lamp", () => {
  it("shows a ready lamp for a running app", () => {
    renderRow({ type: "app", id: "talker", name: "talker", href: "" }, { "apps:talker": "ready" });
    expect(screen.getByLabelText("status ready")).toBeInTheDocument();
  });

  it("shows a notReady lamp for a stopped component", () => {
    renderRow({ type: "component", id: "host", name: "host", href: "" }, { "components:host": "notReady" });
    expect(screen.getByLabelText("status notReady")).toBeInTheDocument();
  });

  it("shows no lamp when the gateway has no lifecycle provider (unavailable)", () => {
    renderRow({ type: "app", id: "talker", name: "talker", href: "" }, { "apps:talker": "unavailable" });
    expect(screen.queryByLabelText(/^status /)).not.toBeInTheDocument();
  });

  it("shows no lamp for areas/functions (no lifecycle status)", () => {
    renderRow({ type: "area", id: "a1", name: "a1", href: "" }, {});
    expect(screen.queryByLabelText(/^status /)).not.toBeInTheDocument();
  });

  it("shows no lamp before the status is fetched", () => {
    renderRow({ type: "app", id: "talker", name: "talker", href: "" }, {});
    expect(screen.queryByLabelText(/^status /)).not.toBeInTheDocument();
  });

  it("paints ready green and notReady amber (distinct colors)", () => {
    const { unmount } = renderRow({ type: "app", id: "a", name: "a", href: "" }, { "apps:a": "ready" });
    expect(screen.getByLabelText("status ready")).toHaveStyle({ background: c.success });
    unmount();
    renderRow({ type: "app", id: "b", name: "b", href: "" }, { "apps:b": "notReady" });
    expect(screen.getByLabelText("status notReady")).toHaveStyle({ background: c.warning });
    expect(c.success).not.toBe(c.warning);
  });

  it("shows a 'status read failed' lamp when the status read errored", () => {
    renderRow({ type: "component", id: "host", name: "host", href: "" }, { "components:host": "error" });
    const lamp = screen.getByLabelText("status error");
    expect(lamp).toBeInTheDocument();
    expect(lamp).toHaveAttribute("title", "status read failed");
  });
});
