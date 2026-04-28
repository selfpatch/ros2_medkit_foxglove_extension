// Copyright 2024–2026 Selfpatch GmbH. Apache-2.0 license.

/**
 * Faults Dashboard panel — real-time monitoring of all system faults.
 * Supports SSE fault streaming, severity filtering, and fault clearing.
 */

import { type PanelExtensionContext } from "@foxglove/extension";
import {
  type ReactElement,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";

import { MedkitApiClient } from "./medkit-api";
import { type GatewayConnection } from "./shared-connection";
import { useColorSchemeTheme, useSharedConnection } from "./panel-hooks";
import type { Fault, FaultSeverity, FaultResponse, Snapshot, SovdResourceEntityType } from "./types";
import { isRosbagSnapshot } from "./types";
import * as S from "./styles";
import type { Theme } from "./styles";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// gatewayUrl + basePath come from shared-connection so all panels share
// one Server URL setting. Panel-specific knobs stay local.
interface PanelKnobs {
  refreshIntervalSec: number;
  enableStream: boolean;
}

interface PanelState extends GatewayConnection, PanelKnobs {}

const DEFAULT_PANEL_KNOBS: PanelKnobs = {
  refreshIntervalSec: 5,
  enableStream: true,
};

// ---------------------------------------------------------------------------
// Panel Component
// ---------------------------------------------------------------------------

function FaultsDashboardPanel({
  context,
}: {
  context: PanelExtensionContext;
}): ReactElement {
  // Theme + shared connection come from the panel hooks (deduped across
  // EntityBrowserPanel, FaultsDashboardPanel, UpdatesPanel).
  const theme = useColorSchemeTheme(context);
  const { conn, update: updateConnection } = useSharedConnection(
    context.initialState as Partial<GatewayConnection>,
  );

  // Panel-specific knobs that are NOT shared.
  const [knobs, setKnobs] = useState<PanelKnobs>(() => ({
    ...DEFAULT_PANEL_KNOBS,
    ...((context.initialState ?? {}) as Partial<PanelKnobs>),
  }));

  // Memoize the merged state so its identity only changes when conn or
  // knobs actually change. Without this the object literal recreates on
  // every render, the settings-editor effect re-runs every render, and
  // Foxglove resets the input mid-typing - the user sees their edits
  // discarded (Server URL, Base path, etc.).
  const state: PanelState = useMemo(() => ({ ...conn, ...knobs }), [conn, knobs]);

  const [client, setClient] = useState<MedkitApiClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const [faults, setFaults] = useState<Fault[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FaultSeverity | "all">("all");
  const [expandedFault, setExpandedFault] = useState<string | null>(null);
  const [faultDetail, setFaultDetail] = useState<FaultResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const streamCleanup = useRef<(() => void) | null>(null);

  // ── Foxglove state persistence + settings editor ───────────────

  useEffect(() => {
    context.saveState(state);
  }, [context, state]);

  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: (action) => {
        if (action.action !== "update") return;
        const [section, key] = action.payload.path;
        if (section !== "conn") return;
        if (key === "gatewayUrl" || key === "basePath") {
          updateConnection({
            gatewayUrl: key === "gatewayUrl" ? (action.payload.value as string) : conn.gatewayUrl,
            basePath: key === "basePath" ? (action.payload.value as string) : conn.basePath,
          });
          return;
        }
        if (key === "refreshInterval") {
          setKnobs((p) => ({ ...p, refreshIntervalSec: Number(action.payload.value) }));
        }
        if (key === "enableStream") {
          setKnobs((p) => ({ ...p, enableStream: action.payload.value === "true" }));
        }
      },
      nodes: {
        conn: {
          label: "Configuration",
          fields: {
            gatewayUrl: { label: "Server URL", input: "string", value: state.gatewayUrl },
            basePath: { label: "Base path", input: "string", value: state.basePath },
            refreshInterval: {
              label: "Poll interval (s)",
              input: "select",
              value: String(state.refreshIntervalSec),
              options: [
                { label: "1s", value: "1" },
                { label: "5s", value: "5" },
                { label: "10s", value: "10" },
                { label: "30s", value: "30" },
              ],
            },
            enableStream: {
              label: "SSE live stream",
              input: "boolean",
              value: state.enableStream,
            },
          },
        },
      },
    });
  }, [context, state]);

  // ── Connection & data ───────────────────────────────────────────

  const fetchFaults = useCallback(
    async (c: MedkitApiClient) => {
      try {
        const res = await c.listAllFaults();
        setFaults(res.items);
        setError(undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fetch failed");
      }
    },
    [],
  );

  // Connect + initial fetch + polling
  useEffect(() => {
    const c = new MedkitApiClient(state.gatewayUrl, state.basePath);
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    void (async () => {
      try {
        const ok = await c.ping();
        if (cancelled) return;
        if (!ok) {
          setError("Server not reachable");
          return;
        }
        setClient(c);
        setConnected(true);
        setLoading(true);
        await fetchFaults(c);
        setLoading(false);

        interval = setInterval(() => void fetchFaults(c), state.refreshIntervalSec * 1000);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Connection failed");
      }
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [state.gatewayUrl, state.basePath, state.refreshIntervalSec, fetchFaults]);

  // SSE stream
  useEffect(() => {
    if (!client || !state.enableStream) return;

    streamCleanup.current?.();
    streamCleanup.current = client.subscribeFaultStream(
      (fault) => {
        setFaults((prev) => {
          const idx = prev.findIndex((f) => f.code === fault.code && f.entity_id === fault.entity_id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = fault;
            return copy;
          }
          return [fault, ...prev];
        });
      },
      (fault) => {
        setFaults((prev) => prev.filter((f) => !(f.code === fault.code && f.entity_id === fault.entity_id)));
      },
    );

    return () => {
      streamCleanup.current?.();
      streamCleanup.current = null;
    };
  }, [client, state.enableStream]);

  // ── Handlers ────────────────────────────────────────────────────

  const handleClearAll = useCallback(async () => {
    if (!client || faults.length === 0) return;
    try {
      // Group faults by entity and clear per-entity (no global DELETE /faults endpoint)
      const byEntity = new Map<string, { type: SovdResourceEntityType; id: string }>();
      for (const f of faults) {
        const key = `${f.entity_type}:${f.entity_id}`;
        if (!byEntity.has(key)) {
          const eType = (f.entity_type === "component" ? "components"
            : f.entity_type === "app" ? "apps"
            : f.entity_type === "area" ? "areas"
            : "apps") as SovdResourceEntityType;
          byEntity.set(key, { type: eType, id: f.entity_id });
        }
      }
      await Promise.all(
        Array.from(byEntity.values()).map((e) => client.clearAllFaults(e.type, e.id).catch(() => {})),
      );
      setFaults([]);
    } catch {
      // ignore
    }
  }, [client, faults]);

  // ── Render ──────────────────────────────────────────────────────

  const c = S.colors(theme);
  const visible = filter === "all" ? faults : faults.filter((f) => f.severity === filter);

  // Summary counts
  const counts = { critical: 0, error: 0, warning: 0, info: 0 };
  for (const f of faults) {
    if (f.severity in counts) counts[f.severity as keyof typeof counts]++;
  }

  if (!connected && !error) {
    return (
      <div style={S.panelRoot(theme)}>
        <h3 style={S.heading(theme)}>Faults Dashboard</h3>
        <div style={{ color: c.textMuted }}>Connecting…</div>
      </div>
    );
  }

  return (
    <div style={S.panelRoot(theme)}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h3 style={{ ...S.heading(theme), margin: 0, flex: 1 }}>
          Faults Dashboard
          {state.enableStream && connected && (
            <span style={{ ...S.badge("#fff", c.success), marginLeft: 8 }}>● LIVE</span>
          )}
        </h3>
        <button style={S.btn(theme, "ghost")} onClick={() => client && void fetchFaults(client)}>
          ↻ Refresh
        </button>
        {faults.length > 0 && (
          <button style={S.btn(theme, "danger")} onClick={() => void handleClearAll()}>
            Clear All
          </button>
        )}
      </div>

      {error && <div style={S.errorBox(theme)}>⚠ {error}</div>}

      {/* Summary cards */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["critical", "error", "warning", "info"] as const).map((sev) => (
          <div
            key={sev}
            style={{
              ...S.card(theme),
              flex: 1,
              textAlign: "center",
              cursor: "pointer",
              borderTop: `3px solid ${S.severityColor(sev, theme)}`,
              background: filter === sev ? c.accent + "15" : c.bgCard,
            }}
            onClick={() => setFilter(filter === sev ? "all" : sev)}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: S.severityColor(sev, theme) }}>
              {counts[sev]}
            </div>
            <div style={{ fontSize: 11, color: c.textMuted, textTransform: "capitalize" }}>
              {sev}
            </div>
          </div>
        ))}
      </div>

      {/* Filter indicator */}
      {filter !== "all" && (
        <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 6 }}>
          Showing {filter} only ·{" "}
          <span style={{ cursor: "pointer", color: c.accent }} onClick={() => setFilter("all")}>
            show all
          </span>
        </div>
      )}

      {loading && <div style={{ color: c.textMuted }}>Loading faults…</div>}

      {!loading && visible.length === 0 && (
        <div style={S.emptyState(theme)}>
          {faults.length === 0 ? "✅ No active faults" : "No faults matching filter"}
        </div>
      )}

      {/* Fault list */}
      {visible.map((f) => (
        <FaultCard
          key={`${f.code}-${f.entity_id}`}
          fault={f}
          theme={theme}
          client={client}
          expandedFault={expandedFault}
          faultDetail={faultDetail}
          detailLoading={detailLoading}
          downloading={downloading}
          onExpand={async (faultCode: string, entityId: string, entityType: string) => {
            if (expandedFault === faultCode) {
              setExpandedFault(null);
              setFaultDetail(null);
              return;
            }
            if (!client) return;
            setExpandedFault(faultCode);
            setDetailLoading(true);
            setFaultDetail(null);
            try {
              const eType = (entityType + "s") as "apps" | "components" | "areas";
              const detail = await client.getFaultWithEnvironmentData(eType, entityId, faultCode);
              setFaultDetail(detail);
            } catch {
              setFaultDetail(null);
            } finally {
              setDetailLoading(false);
            }
          }}
          onDownload={(uri: string, code: string) => {
            if (!client) return;
            setDownloading(code);
            try {
              const url = client.getBulkDataDownloadUrl(uri);
              window.open(url, "_blank");
            } finally {
              setTimeout(() => setDownloading(null), 1000);
            }
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]!;
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Fault Card with Snapshot Expand
// ---------------------------------------------------------------------------

function FaultCard({
  fault,
  theme,
  client,
  expandedFault,
  faultDetail,
  detailLoading,
  downloading,
  onExpand,
  onDownload,
}: {
  fault: Fault;
  theme: Theme;
  client: MedkitApiClient | null;
  expandedFault: string | null;
  faultDetail: FaultResponse | null;
  detailLoading: boolean;
  downloading: string | null;
  onExpand: (faultCode: string, entityId: string, entityType: string) => void;
  onDownload: (uri: string, faultCode: string) => void;
}): ReactElement {
  const c = S.colors(theme);
  const f = fault;
  const isExpanded = expandedFault === f.code;
  const snapshots: Snapshot[] = isExpanded && faultDetail?.environment_data?.snapshots || [];

  return (
    <div
      style={{
        ...S.card(theme),
        borderLeft: `3px solid ${S.severityColor(f.severity, theme)}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <strong style={{ fontSize: 12 }}>{f.code}</strong>
        <span style={S.badge("#fff", S.severityColor(f.severity, theme))}>
          {f.severity}
        </span>
        <span style={S.badge(c.text, c.bgAlt)}>{f.status}</span>
        <span style={{ flex: 1 }} />
        <button
          style={S.btn(theme, "ghost")}
          onClick={() => onExpand(f.code, f.entity_id, f.entity_type)}
          title="View snapshots & recordings"
        >
          {isExpanded ? "▾ Snapshots" : "▸ Snapshots"}
        </button>
        <span style={{ fontSize: 10, color: c.textMuted }}>
          {f.entity_id}
        </span>
      </div>
      <div style={{ fontSize: 12 }}>{f.message}</div>
      <div style={{ fontSize: 10, color: c.textMuted, marginTop: 2 }}>
        {new Date(f.timestamp).toLocaleString()}
        {f.parameters?.occurrence_count != null &&
          ` · ${f.parameters.occurrence_count as number} occurrences`}
      </div>

      {/* Expanded snapshots */}
      {isExpanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.borderLight}` }}>
          {detailLoading && (
            <div style={{ color: c.textMuted, fontSize: 12 }}>Loading snapshots…</div>
          )}
          {!detailLoading && snapshots.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: c.textMuted, marginBottom: 4 }}>
                {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""}
              </div>
              {snapshots.map((snap, idx) => {
                if (isRosbagSnapshot(snap)) {
                  return (
                    <div
                      key={idx}
                      style={{
                        background: c.bgAlt,
                        borderRadius: 6,
                        padding: 8,
                        marginBottom: 6,
                        borderLeft: `3px solid ${c.accent}`,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span>📦</span>
                        <strong style={{ fontSize: 11 }}>Rosbag</strong>
                        <span style={S.badge("#fff", c.accent)}>{snap.format}</span>
                        <span style={{ fontSize: 11, color: c.textMuted }}>
                          {formatBytes(snap.size_bytes)} · {formatDuration(snap.duration_sec)}
                        </span>
                        <span style={{ flex: 1 }} />
                        <button
                          style={S.btn(theme)}
                          onClick={() => onDownload(snap.bulk_data_uri, f.code)}
                          disabled={downloading === f.code}
                        >
                          {downloading === f.code ? "⏳" : "⬇"} Download
                        </button>
                      </div>
                    </div>
                  );
                }

                // Freeze frame
                const ffData = snap.type === "freeze_frame" ? snap.data : null;
                const xm = snap["x-medkit"];
                return (
                  <div
                    key={idx}
                    style={{
                      background: c.bgAlt,
                      borderRadius: 6,
                      padding: 8,
                      marginBottom: 6,
                      borderLeft: `3px solid ${c.success}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span>📸</span>
                      <strong style={{ fontSize: 11 }}>Freeze Frame</strong>
                      {xm && "message_type" in xm && (
                        <span style={S.badge(c.textMuted, c.bgCard)}>{(xm as { message_type: string }).message_type}</span>
                      )}
                      {xm && "topic" in xm && (
                        <span style={{ fontSize: 10, color: c.textMuted }}>
                          {(xm as { topic: string }).topic}
                        </span>
                      )}
                    </div>
                    {ffData != null && (
                      <pre style={{
                        margin: 0,
                        padding: 6,
                        background: c.bgCard,
                        borderRadius: 4,
                        fontSize: 10,
                        overflow: "auto",
                        maxHeight: 120,
                        whiteSpace: "pre-wrap",
                      }}>
                        {typeof ffData === "object" ? JSON.stringify(ffData, null, 2) : String(ffData)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!detailLoading && snapshots.length === 0 && !faultDetail && (
            <div style={{ color: c.textMuted, fontSize: 12 }}>No environment data available</div>
          )}
          {!detailLoading && faultDetail && snapshots.length === 0 && (
            <div style={{ color: c.textMuted, fontSize: 12 }}>No snapshots captured for this fault</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel Init
// ---------------------------------------------------------------------------

export function initFaultsDashboardPanel(
  context: PanelExtensionContext,
): () => void {
  const root = createRoot(context.panelElement);
  root.render(<FaultsDashboardPanel context={context} />);
  return () => root.unmount();
}
