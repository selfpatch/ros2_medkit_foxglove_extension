// Copyright 2024–2026 Selfpatch GmbH. Apache-2.0 license.

/**
 * Entity Browser panel — tree view of SOVD areas → components → apps.
 * Shows entity details, topic data, configurations, operations, and faults for selected entity.
 */

import {
  type PanelExtensionContext,
  type Immutable,
  type RenderState,
} from "@foxglove/extension";
import {
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";

import { SovdApiClient } from "./sovd-api";
import type {
  SovdEntity,
  ComponentTopic,
  Parameter,
  Operation,
  Fault,
  App,
  SovdResourceEntityType,
  FaultResponse,
  Snapshot,
} from "./types";
import { isRosbagSnapshot } from "./types";
import * as S from "./styles";
import type { Theme } from "./styles";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface PanelState {
  gatewayUrl: string;
  basePath: string;
}

const DEFAULT_STATE: PanelState = {
  gatewayUrl: "http://localhost:8080",
  basePath: "api/v1",
};

interface TreeNode {
  entity: SovdEntity;
  children?: TreeNode[];
  isExpanded: boolean;
  isLoading: boolean;
}

type Tab = "data" | "operations" | "configurations" | "faults";

// ---------------------------------------------------------------------------
// Panel Component
// ---------------------------------------------------------------------------

function EntityBrowserPanel({
  context,
}: {
  context: PanelExtensionContext;
}): ReactElement {
  // Foxglove integration
  const [theme, setTheme] = useState<Theme>("dark");
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();

  // Connection
  const [state, setState] = useState<PanelState>(() => ({
    ...DEFAULT_STATE,
    ...(context.initialState as Partial<PanelState>),
  }));
  const [client, setClient] = useState<SovdApiClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState<string | undefined>();

  // Tree
  const [tree, setTree] = useState<TreeNode[]>([]);

  // Selection
  const [selected, setSelected] = useState<SovdEntity | null>(null);
  const [selectedType, setSelectedType] = useState<SovdResourceEntityType>("components");
  const [activeTab, setActiveTab] = useState<Tab>("data");

  // Tab data
  const [topics, setTopics] = useState<ComponentTopic[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [configs, setConfigs] = useState<Parameter[]>([]);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState<string | undefined>();

  // ── Foxglove lifecycle ──────────────────────────────────────────

  useLayoutEffect(() => {
    context.watch("colorScheme");
    context.onRender = (_rs: Immutable<RenderState>, done) => {
      if (_rs.colorScheme) setTheme(_rs.colorScheme);
      setRenderDone(() => done);
    };
  }, [context]);

  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  useEffect(() => {
    context.saveState(state);
  }, [context, state]);

  // ── Settings editor ─────────────────────────────────────────────

  useEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: (action) => {
        if (action.action !== "update") return;
        const [section, key] = action.payload.path;
        if (section === "conn") {
          if (key === "gatewayUrl")
            setState((p) => ({ ...p, gatewayUrl: action.payload.value as string }));
          if (key === "basePath")
            setState((p) => ({ ...p, basePath: action.payload.value as string }));
        }
      },
      nodes: {
        conn: {
          label: "Gateway Connection",
          fields: {
            gatewayUrl: { label: "Server URL", input: "string", value: state.gatewayUrl },
            basePath: { label: "Base path", input: "string", value: state.basePath },
          },
        },
      },
    });
  }, [context, state]);

  // ── Connect ─────────────────────────────────────────────────────

  const doConnect = useCallback(async () => {
    const c = new SovdApiClient(state.gatewayUrl, state.basePath);
    setConnError(undefined);
    try {
      const ok = await c.ping();
      if (!ok) {
        setConnError("Server not reachable");
        return;
      }
      setClient(c);
      setConnected(true);

      // Load areas
      const areas = await c.listAreas();
      setTree(areas.map((a) => ({ entity: a, isExpanded: false, isLoading: false })));
    } catch (err) {
      setConnError(err instanceof Error ? err.message : "Connection failed");
    }
  }, [state.gatewayUrl, state.basePath]);

  // Auto-connect
  useEffect(() => {
    void doConnect();
  }, [doConnect]);

  // ── Tree expand ─────────────────────────────────────────────────

  const toggleNode = useCallback(
    async (path: number[]) => {
      if (!client) return;

      setTree((prev) => {
        const copy = JSON.parse(JSON.stringify(prev)) as TreeNode[];
        const node = getNode(copy, path);
        if (!node) return prev;

        if (node.isExpanded) {
          node.isExpanded = false;
          return copy;
        }

        node.isExpanded = true;
        if (node.children != null) return copy; // Already loaded

        node.isLoading = true;
        return copy;
      });

      // Fetch children asynchronously
      const currentTree = JSON.parse(JSON.stringify(tree)) as TreeNode[];
      const node = getNode(currentTree, path);
      if (!node || node.children != null) return;

      try {
        let children: TreeNode[] = [];
        const e = node.entity;

        if (e.type === "area") {
          const comps = await client.listAreaComponents(e.id);
          children = comps.map((c) => ({ entity: c, isExpanded: false, isLoading: false }));
        } else if (e.type === "component") {
          const appList = await client.listComponentApps(e.id);
          children = appList.map((a) => ({
            entity: a,
            isExpanded: false,
            isLoading: false,
          }));
        }

        setTree((prev) => {
          const copy = JSON.parse(JSON.stringify(prev)) as TreeNode[];
          const n = getNode(copy, path);
          if (!n) return prev;
          n.children = children;
          n.isLoading = false;
          n.isExpanded = true;
          return copy;
        });
      } catch {
        setTree((prev) => {
          const copy = JSON.parse(JSON.stringify(prev)) as TreeNode[];
          const n = getNode(copy, path);
          if (n) n.isLoading = false;
          return copy;
        });
      }
    },
    [client, tree],
  );

  // ── Selection handler ───────────────────────────────────────────

  const selectEntity = useCallback(
    async (entity: SovdEntity) => {
      if (!client) return;
      setSelected(entity);
      const eType: SovdResourceEntityType =
        entity.type === "area" ? "areas" :
        entity.type === "app" ? "apps" :
        "components";
      setSelectedType(eType);
      setActiveTab("data");
      setTabLoading(true);
      setTabError(undefined);
      setTopics([]);
      setOperations([]);
      setConfigs([]);
      setFaults([]);
      setApps([]);

      try {
        const [dataRes, opsRes, cfgRes, faultsRes] = await Promise.all([
          client.listEntityData(eType, entity.id).catch(() => [] as ComponentTopic[]),
          client.listOperations(eType, entity.id).catch(() => [] as Operation[]),
          client.listConfigurations(eType, entity.id).catch(() => ({ parameters: [] as Parameter[] })),
          client.listEntityFaults(eType, entity.id).catch(() => ({ items: [] as Fault[] })),
        ]);
        setTopics(dataRes);
        setOperations(opsRes);
        setConfigs(cfgRes.parameters);
        setFaults(faultsRes.items);

        if (entity.type === "component") {
          const componentApps = await client.listComponentApps(entity.id).catch(() => []);
          setApps(componentApps);
        }
      } catch (err) {
        setTabError(err instanceof Error ? err.message : "Load failed");
      } finally {
        setTabLoading(false);
      }
    },
    [client],
  );

  // ── Render ──────────────────────────────────────────────────────

  const c = S.colors(theme);

  if (!connected) {
    return (
      <div style={S.panelRoot(theme)}>
        <h3 style={S.heading(theme)}>SOVD Entity Browser</h3>
        {connError && <div style={S.errorBox(theme)}>⚠ {connError}</div>}
        <p style={{ color: c.textMuted, fontSize: 12, marginBottom: 8 }}>
          Configure the gateway URL in panel settings (gear icon).
        </p>
        <button style={S.btn(theme)} onClick={() => void doConnect()}>
          Connect
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...S.panelRoot(theme), display: "flex", gap: 8 }}>
      {/* Left: Tree */}
      <div style={{ width: "40%", minWidth: 180, overflow: "auto", borderRight: `1px solid ${c.borderLight}`, paddingRight: 8 }}>
        <h3 style={{ ...S.heading(theme), fontSize: 13 }}>Entities</h3>
        {tree.length === 0 && <div style={S.emptyState(theme)}>No areas found</div>}
        {tree.map((node, i) => (
          <TreeNodeRow
            key={node.entity.id}
            node={node}
            path={[i]}
            depth={0}
            theme={theme}
            selected={selected}
            onToggle={toggleNode}
            onSelect={selectEntity}
          />
        ))}
      </div>

      {/* Right: Details */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {!selected ? (
          <div style={S.emptyState(theme)}>Select an entity to view details</div>
        ) : (
          <>
            <h3 style={S.heading(theme)}>
              {selected.name}
              <span style={{ ...S.badge(c.textInvert, c.accent), marginLeft: 8 }}>
                {selected.type}
              </span>
            </h3>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 2, marginBottom: 8 }}>
              {(["data", "operations", "configurations", "faults"] as Tab[]).map((t) => (
                <button
                  key={t}
                  style={{
                    ...S.btn(theme, activeTab === t ? "primary" : "ghost"),
                    textTransform: "capitalize",
                  }}
                  onClick={() => setActiveTab(t)}
                >
                  {t}
                  {t === "faults" && faults.length > 0 && (
                    <span style={{ ...S.badge("#fff", c.critical), marginLeft: 4, fontSize: 10 }}>
                      {faults.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {tabError && <div style={S.errorBox(theme)}>⚠ {tabError}</div>}
            {tabLoading && <div style={{ color: c.textMuted }}>Loading…</div>}

            {!tabLoading && activeTab === "data" && (
              <DataTab topics={topics} theme={theme} />
            )}
            {!tabLoading && activeTab === "operations" && (
              <OperationsTab
                operations={operations}
                entityId={selected.id}
                entityType={selectedType}
                client={client}
                theme={theme}
              />
            )}
            {!tabLoading && activeTab === "configurations" && (
              <ConfigurationsTab
                configs={configs}
                entityId={selected.id}
                entityType={selectedType}
                client={client}
                theme={theme}
                onRefresh={() => void selectEntity(selected)}
              />
            )}
            {!tabLoading && activeTab === "faults" && (
              <FaultsTab
                faults={faults}
                entityId={selected.id}
                entityType={selectedType}
                client={client}
                theme={theme}
                onRefresh={() => void selectEntity(selected)}
              />
            )}

            {/* Apps under component */}
            {apps.length > 0 && (
              <>
                <h4 style={S.subheading(theme)}>Apps ({apps.length})</h4>
                {apps.map((app) => (
                  <div
                    key={app.id}
                    style={{ ...S.card(theme), cursor: "pointer" }}
                    onClick={() => void selectEntity(app)}
                  >
                    <strong>{app.name}</strong>
                    <span style={{ color: c.textMuted, marginLeft: 8, fontSize: 11 }}>
                      {app.fqn}
                    </span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree Node Component
// ---------------------------------------------------------------------------

function TreeNodeRow({
  node,
  path,
  depth,
  theme,
  selected,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  path: number[];
  depth: number;
  theme: Theme;
  selected: SovdEntity | null;
  onToggle: (path: number[]) => void;
  onSelect: (entity: SovdEntity) => void;
}): ReactElement {
  const c = S.colors(theme);
  const isSelected = selected?.id === node.entity.id;
  const hasChildren = node.entity.type !== "app";
  const icon = node.entity.type === "area" ? "📁" : node.entity.type === "component" ? "🔧" : "📦";

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "3px 4px",
          paddingLeft: depth * 16 + 4,
          cursor: "pointer",
          borderRadius: 4,
          background: isSelected ? c.accent + "22" : "transparent",
          borderLeft: isSelected ? `2px solid ${c.accent}` : "2px solid transparent",
        }}
        onClick={() => onSelect(node.entity)}
      >
        {hasChildren && (
          <span
            style={{ marginRight: 4, fontSize: 10, userSelect: "none", cursor: "pointer", width: 14, textAlign: "center" }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(path);
            }}
          >
            {node.isLoading ? "⏳" : node.isExpanded ? "▼" : "▶"}
          </span>
        )}
        {!hasChildren && <span style={{ width: 18 }} />}
        <span style={{ marginRight: 4 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: isSelected ? 600 : 400, color: c.text }}>
          {node.entity.name}
        </span>
      </div>
      {node.isExpanded &&
        node.children?.map((child, i) => (
          <TreeNodeRow
            key={child.entity.id}
            node={child}
            path={[...path, i]}
            depth={depth + 1}
            theme={theme}
            selected={selected}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Data (topics)
// ---------------------------------------------------------------------------

function DataTab({ topics, theme }: { topics: ComponentTopic[]; theme: Theme }): ReactElement {
  const c = S.colors(theme);
  if (topics.length === 0) return <div style={S.emptyState(theme)}>No data items</div>;

  return (
    <table style={S.table(theme)}>
      <thead>
        <tr>
          <th style={S.th(theme)}>Topic</th>
          <th style={S.th(theme)}>Type</th>
          <th style={S.th(theme)}>Dir</th>
        </tr>
      </thead>
      <tbody>
        {topics.map((t) => (
          <tr key={t.topic}>
            <td style={S.td(theme)}>{t.topic}</td>
            <td style={{ ...S.td(theme), color: c.textMuted, fontSize: 11 }}>{t.type || "—"}</td>
            <td style={S.td(theme)}>
              {t.isPublisher && <span style={S.badge("#fff", c.success)}>pub</span>}
              {t.isSubscriber && (
                <span style={{ ...S.badge("#fff", c.info), marginLeft: 2 }}>sub</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Tab: Operations
// ---------------------------------------------------------------------------

function OperationsTab({
  operations,
  entityId,
  entityType,
  client,
  theme,
}: {
  operations: Operation[];
  entityId: string;
  entityType: SovdResourceEntityType;
  client: SovdApiClient | null;
  theme: Theme;
}): ReactElement {
  const c = S.colors(theme);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, unknown>>({});

  const invokeOp = useCallback(
    async (op: Operation) => {
      if (!client) return;
      setRunning(op.name);
      try {
        const res = await client.createExecution(entityType, entityId, op.name, {});
        setResults((prev) => ({ ...prev, [op.name]: res }));
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [op.name]: { error: err instanceof Error ? err.message : "Failed" },
        }));
      } finally {
        setRunning(null);
      }
    },
    [client, entityId, entityType],
  );

  if (operations.length === 0) return <div style={S.emptyState(theme)}>No operations</div>;

  return (
    <div>
      {operations.map((op) => (
        <div key={op.name} style={S.card(theme)}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <strong style={{ fontSize: 12 }}>{op.name}</strong>
            <span style={S.badge(
              "#fff",
              op.kind === "action" ? c.warning : c.accent,
            )}>
              {op.kind}
            </span>
            <span style={{ color: c.textMuted, fontSize: 11, flex: 1 }}>{op.type}</span>
            <button
              style={S.btn(theme)}
              disabled={running === op.name}
              onClick={() => void invokeOp(op)}
            >
              {running === op.name ? "⏳" : "▶"} Invoke
            </button>
          </div>
          {results[op.name] != null && (
            <pre style={{
              margin: "6px 0 0",
              padding: 6,
              background: c.bgAlt,
              borderRadius: 4,
              fontSize: 11,
              overflow: "auto",
              maxHeight: 200,
              whiteSpace: "pre-wrap",
            }}>
              {JSON.stringify(results[op.name], null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Configurations
// ---------------------------------------------------------------------------

function ConfigurationsTab({
  configs,
  entityId,
  entityType,
  client,
  theme,
  onRefresh,
}: {
  configs: Parameter[];
  entityId: string;
  entityType: SovdResourceEntityType;
  client: SovdApiClient | null;
  theme: Theme;
  onRefresh: () => void;
}): ReactElement {
  const c = S.colors(theme);
  const [editingParam, setEditingParam] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const saveParam = useCallback(
    async (name: string) => {
      if (!client) return;
      setSaving(true);
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(editValue);
        } catch {
          parsed = editValue;
        }
        await client.setConfiguration(entityType, entityId, name, parsed);
        setEditingParam(null);
        onRefresh();
      } catch {
        // Error handled silently in extension context
      } finally {
        setSaving(false);
      }
    },
    [client, entityType, entityId, editValue, onRefresh],
  );

  if (configs.length === 0) return <div style={S.emptyState(theme)}>No configurations</div>;

  return (
    <table style={S.table(theme)}>
      <thead>
        <tr>
          <th style={S.th(theme)}>Parameter</th>
          <th style={S.th(theme)}>Value</th>
          <th style={S.th(theme)}>Type</th>
          <th style={S.th(theme)}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {configs.map((p) => (
          <tr key={p.name}>
            <td style={S.td(theme)}>
              {p.name}
              {p.read_only && <span style={{ ...S.badge(c.textMuted, c.bgAlt), marginLeft: 4 }}>🔒</span>}
            </td>
            <td style={S.td(theme)}>
              {editingParam === p.name ? (
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    style={{ ...S.input(theme), flex: 1 }}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveParam(p.name);
                      if (e.key === "Escape") setEditingParam(null);
                    }}
                    autoFocus
                  />
                  <button
                    style={S.btn(theme)}
                    disabled={saving}
                    onClick={() => void saveParam(p.name)}
                  >
                    ✓
                  </button>
                  <button
                    style={S.btn(theme, "ghost")}
                    onClick={() => setEditingParam(null)}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <code style={{ fontSize: 11, color: c.accent }}>
                  {JSON.stringify(p.value)}
                </code>
              )}
            </td>
            <td style={S.td(theme)}>
              <span style={S.badge(c.textMuted, c.bgAlt)}>{p.type}</span>
            </td>
            <td style={S.td(theme)}>
              {!p.read_only && editingParam !== p.name && (
                <button
                  style={S.btn(theme, "ghost")}
                  onClick={() => {
                    setEditingParam(p.name);
                    setEditValue(JSON.stringify(p.value));
                  }}
                >
                  ✏️ Edit
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Tab: Faults
// ---------------------------------------------------------------------------

function FaultsTab({
  faults,
  entityId,
  entityType,
  client,
  theme,
  onRefresh,
}: {
  faults: Fault[];
  entityId: string;
  entityType: SovdResourceEntityType;
  client: SovdApiClient | null;
  theme: Theme;
  onRefresh: () => void;
}): ReactElement {
  const c = S.colors(theme);
  const [expandedFault, setExpandedFault] = useState<string | null>(null);
  const [faultDetail, setFaultDetail] = useState<FaultResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleClear = useCallback(
    async (faultCode: string) => {
      if (!client) return;
      try {
        await client.clearFault(entityType, entityId, faultCode);
        onRefresh();
      } catch {
        // handled silently
      }
    },
    [client, entityType, entityId, onRefresh],
  );

  const handleExpand = useCallback(
    async (faultCode: string) => {
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
        const detail = await client.getFaultWithEnvironmentData(entityType, entityId, faultCode);
        setFaultDetail(detail);
      } catch {
        // If environment data endpoint fails, show empty
        setFaultDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [client, entityType, entityId, expandedFault],
  );

  const handleDownload = useCallback(
    (bulkDataUri: string, faultCode: string) => {
      if (!client) return;
      setDownloading(faultCode);
      try {
        const url = client.getBulkDataDownloadUrl(bulkDataUri);
        // Open in new tab/trigger browser download
        window.open(url, "_blank");
      } finally {
        setTimeout(() => setDownloading(null), 1000);
      }
    },
    [client],
  );

  if (faults.length === 0) {
    return (
      <div style={S.emptyState(theme)}>
        ✅ No active faults
      </div>
    );
  }

  return (
    <div>
      {faults.map((f) => (
        <div
          key={f.code}
          style={{
            ...S.card(theme),
            borderLeft: `3px solid ${S.severityColor(f.severity, theme)}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <strong style={{ fontSize: 12 }}>{f.code}</strong>
            <span style={S.badge("#fff", S.severityColor(f.severity, theme))}>
              {f.severity}
            </span>
            <span style={S.badge(c.text, c.bgAlt)}>{f.status}</span>
            <span style={{ flex: 1 }} />
            <button
              style={S.btn(theme, "ghost")}
              onClick={() => void handleExpand(f.code)}
              title="View snapshots"
            >
              {expandedFault === f.code ? "▾ Snapshots" : "▸ Snapshots"}
            </button>
            <button
              style={S.btn(theme, "danger")}
              onClick={() => void handleClear(f.code)}
            >
              Clear
            </button>
          </div>
          <div style={{ fontSize: 12 }}>{f.message}</div>
          <div style={{ fontSize: 11, color: c.textMuted, marginTop: 2 }}>
            {f.entity_id} · {new Date(f.timestamp).toLocaleString()}
          </div>

          {/* Expanded snapshots */}
          {expandedFault === f.code && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.borderLight}` }}>
              {detailLoading && (
                <div style={{ color: c.textMuted, fontSize: 12 }}>Loading snapshots…</div>
              )}
              {!detailLoading && faultDetail && (
                <SnapshotList
                  snapshots={faultDetail.environment_data?.snapshots || []}
                  environmentData={faultDetail.environment_data}
                  theme={theme}
                  onDownload={handleDownload}
                  downloading={downloading}
                  faultCode={f.code}
                />
              )}
              {!detailLoading && !faultDetail && (
                <div style={{ color: c.textMuted, fontSize: 12 }}>No environment data available</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Snapshot List Component
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

function SnapshotList({
  snapshots,
  environmentData,
  theme,
  onDownload,
  downloading,
  faultCode,
}: {
  snapshots: Snapshot[];
  environmentData?: { extended_data_records?: { first_occurrence?: string; last_occurrence?: string } };
  theme: Theme;
  onDownload: (uri: string, faultCode: string) => void;
  downloading: string | null;
  faultCode: string;
}): ReactElement {
  const c = S.colors(theme);

  if (snapshots.length === 0) {
    return <div style={{ color: c.textMuted, fontSize: 12 }}>No snapshots captured</div>;
  }

  // Show occurrence timeline if available
  const records = environmentData?.extended_data_records;

  return (
    <div>
      {records && (records.first_occurrence || records.last_occurrence) && (
        <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 6 }}>
          📅 First: {records.first_occurrence ? new Date(records.first_occurrence).toLocaleString() : "—"}
          {" · "}
          Last: {records.last_occurrence ? new Date(records.last_occurrence).toLocaleString() : "—"}
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 600, color: c.textMuted, marginBottom: 4 }}>
        {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""}
      </div>
      {snapshots.map((snap, idx) => {
        if (isRosbagSnapshot(snap)) {
          return (
            <div
              key={idx}
              style={{
                ...S.card(theme),
                borderLeft: `3px solid ${c.accent}`,
                padding: 8,
                marginBottom: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 14 }}>📦</span>
                <strong style={{ fontSize: 12 }}>Rosbag Recording</strong>
                <span style={S.badge("#fff", c.accent)}>{snap.format}</span>
                <span style={{ flex: 1 }} />
                <button
                  style={S.btn(theme)}
                  onClick={() => onDownload(snap.bulk_data_uri, faultCode)}
                  disabled={downloading === faultCode}
                >
                  {downloading === faultCode ? "⏳" : "⬇"} Download
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px", fontSize: 11 }}>
                <span style={{ color: c.textMuted }}>Size:</span>
                <span>{formatBytes(snap.size_bytes)}</span>
                <span style={{ color: c.textMuted }}>Duration:</span>
                <span>{formatDuration(snap.duration_sec)}</span>
                <span style={{ color: c.textMuted }}>URI:</span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: c.textMuted }}>{snap.bulk_data_uri}</span>
              </div>
            </div>
          );
        }

        // Freeze frame snapshot
        const ffData = snap.type === "freeze_frame" ? snap.data : null;
        const xm = snap["x-medkit"];
        return (
          <div
            key={idx}
            style={{
              ...S.card(theme),
              borderLeft: `3px solid ${c.success}`,
              padding: 8,
              marginBottom: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 14 }}>📸</span>
              <strong style={{ fontSize: 12 }}>Freeze Frame</strong>
              {xm && "message_type" in xm && (
                <span style={S.badge(c.textMuted, c.bgAlt)}>{(xm as { message_type: string }).message_type}</span>
              )}
            </div>
            {xm && "topic" in xm && (
              <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 4 }}>
                Topic: <code style={{ color: c.accent }}>{(xm as { topic: string }).topic}</code>
                {" · "}
                Captured: {(xm as { captured_at?: string }).captured_at
                  ? new Date((xm as { captured_at: string }).captured_at).toLocaleString()
                  : "—"}
              </div>
            )}
            {ffData != null && (
              <pre style={{
                margin: 0,
                padding: 6,
                background: c.bgAlt,
                borderRadius: 4,
                fontSize: 10,
                overflow: "auto",
                maxHeight: 150,
                whiteSpace: "pre-wrap",
              }}>
                {typeof ffData === "object" ? JSON.stringify(ffData, null, 2) : String(ffData)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNode(nodes: TreeNode[], path: number[]): TreeNode | null {
  let current: TreeNode | undefined = nodes[path[0]!];
  for (let i = 1; i < path.length; i++) {
    if (!current?.children) return null;
    current = current.children[path[i]!];
  }
  return current ?? null;
}

// ---------------------------------------------------------------------------
// Panel Init
// ---------------------------------------------------------------------------

export function initEntityBrowserPanel(
  context: PanelExtensionContext,
): () => void {
  const root = createRoot(context.panelElement);
  root.render(<EntityBrowserPanel context={context} />);
  return () => root.unmount();
}
