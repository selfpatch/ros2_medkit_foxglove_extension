// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.

/**
 * Updates panel - renders SOVD update packages from the ros2_medkit gateway
 * and exposes Prepare / Execute action buttons. Polls the gateway via
 * UpdatesApi. The view component is exported separately so tests can drive
 * it with a stubbed API.
 */

import type { PanelExtensionContext } from "@foxglove/extension";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { createUpdatesApi, UpdatesApi, UpdateListItem } from "./updates-api";
import { deriveKind, UpdateKind } from "./update-kind";

const KIND_COLOR: Record<UpdateKind, string> = {
  Update: "#3b82f6",
  Install: "#22c55e",
  Uninstall: "#f59e0b",
  Unknown: "#6b7280",
};

export function UpdatesPanelView({
  api,
  pollMs,
}: {
  api: UpdatesApi;
  pollMs: number;
}): ReactElement {
  const [items, setItems] = useState<UpdateListItem[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await api.listUpdates();
        if (!cancelled) {
          setItems(data);
          setError(undefined);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    void tick();
    if (pollMs > 0) {
      const handle = window.setInterval(tick, pollMs);
      return () => {
        cancelled = true;
        window.clearInterval(handle);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [api, pollMs]);

  const rows = useMemo(
    () => items.map((it) => ({ ...it, kind: deriveKind(it) })),
    [items],
  );

  return (
    <div style={{ padding: 12, fontFamily: "system-ui", color: "#e5e7eb" }}>
      <h2 style={{ marginTop: 0 }}>Updates</h2>
      {error && <div style={{ color: "#ef4444", marginBottom: 8 }}>{error}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: 4 }}>Name</th>
            <th style={{ textAlign: "left", padding: 4 }}>Kind</th>
            <th style={{ textAlign: "left", padding: 4 }}>Components</th>
            <th style={{ textAlign: "left", padding: 4 }}>Status</th>
            <th style={{ padding: 4 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const components =
              row.updated_components ??
              row.added_components ??
              row.removed_components ??
              [];
            return (
              <tr key={row.id} style={{ borderTop: "1px solid #374151" }}>
                <td style={{ padding: 4 }}>{row.name ?? row.id}</td>
                <td style={{ padding: 4 }}>
                  <span
                    style={{
                      background: KIND_COLOR[row.kind],
                      color: "white",
                      padding: "2px 6px",
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    {row.kind}
                  </span>
                </td>
                <td style={{ padding: 4 }}>{components.join(", ")}</td>
                <td style={{ padding: 4 }}>{row.status ?? "Idle"}</td>
                <td style={{ padding: 4 }}>
                  <button
                    disabled={row.kind === "Uninstall"}
                    onClick={() => {
                      void api.prepare(row.id);
                    }}
                    style={{ marginRight: 6 }}
                  >
                    Prepare
                  </button>
                  <button
                    onClick={() => {
                      void api.execute(row.id);
                    }}
                  >
                    Execute
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function initUpdatesPanel(context: PanelExtensionContext): () => void {
  const baseUrl =
    (context.initialState as { baseUrl?: string } | undefined)?.baseUrl ??
    "http://localhost:8080/api/v1";
  const api = createUpdatesApi(baseUrl);
  const root = createRoot(context.panelElement);
  root.render(<UpdatesPanelView api={api} pollMs={2000} />);
  return () => root.unmount();
}
