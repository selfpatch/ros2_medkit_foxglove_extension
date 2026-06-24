// Copyright 2024-2026 bburda. Apache-2.0 license.

/**
 * Entity Browser panel — tree view of ros2_medkit areas → components → apps.
 * Shows entity details, topic data, configurations, operations, and faults for selected entity.
 */

import { type PanelExtensionContext } from "@foxglove/extension";
import {
  type ReactElement,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";

import { MedkitApiClient } from "./medkit-api";
import { type GatewayConnection } from "./shared-connection";
import { useColorSchemeTheme, useSharedConnection } from "./panel-hooks";
import { OperationsPanel } from "./OperationsPanel";
import { LogsPanel } from "./LogsPanel";
import { ConfigurationsPanel } from "./ConfigurationsPanel";
import type {
  SovdEntity,
  ComponentTopic,
  Fault,
  App,
  SovdResourceEntityType,
  FaultResponse,
  Snapshot,
  RootCapabilities,
} from "./types";
import { isRosbagSnapshot } from "./types";
import * as S from "./styles";
import type { Theme } from "./styles";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Connection settings live in shared-connection.ts so all three panels in
// this extension share one Server URL / Base path.
type PanelState = GatewayConnection;

interface TreeNode {
  entity: SovdEntity;
  children?: TreeNode[];
  isExpanded: boolean;
  isLoading: boolean;
}

type Tab = "data" | "operations" | "configurations" | "faults" | "logs";

const STANDARD_TABS: Tab[] = ["data", "operations", "configurations", "faults", "logs"];

// ---------------------------------------------------------------------------
// Capability -> tab mapping
//   data_access     -> "data"         (always shown; no count prefetch)
//   operations      -> "operations"   (shown when cap enabled AND count > 0)
//   configurations  -> "configurations" (shown when cap enabled AND count > 0)
//   faults          -> "faults"       (shown when cap enabled AND count > 0)
//   logs            -> "logs"         (shown when cap enabled; no count check)
// ---------------------------------------------------------------------------

interface ResourceCounts {
  operations: number;
  configurations: number;
  faults: number;
}

function deriveVisibleTabs(capabilities: RootCapabilities | null, counts: ResourceCounts | null): Tab[] {
  if (capabilities === null) return STANDARD_TABS;
  const tabs: Tab[] = [];
  if (capabilities.data_access) tabs.push("data");
  if (capabilities.operations && counts !== null && counts.operations > 0) tabs.push("operations");
  if (capabilities.configurations && counts !== null && counts.configurations > 0) tabs.push("configurations");
  if (capabilities.faults && counts !== null && counts.faults > 0) tabs.push("faults");
  if (capabilities.logs) tabs.push("logs");
  return tabs;
}

// ---------------------------------------------------------------------------
// EntityBrowserTabBar
// Exported for testing. Handles capability-driven tab visibility, parallel
// prefetch of resource counts, and the loading skeleton.
// ---------------------------------------------------------------------------

export interface EntityBrowserTabBarProps {
  client: MedkitApiClient | null;
  capabilities: RootCapabilities | null;
  entityId: string;
  entityType: SovdResourceEntityType;
  activeTab: string;
  onTabChange: (tab: Tab) => void;
  theme: Theme;
}

export function EntityBrowserTabBar({
  client,
  capabilities,
  entityId,
  entityType,
  activeTab,
  onTabChange,
  theme,
}: EntityBrowserTabBarProps): ReactElement {
  const c = S.colors(theme);

  // null = still prefetching; set after Promise.all resolves or caps is null
  const [counts, setCounts] = useState<ResourceCounts | null>(null);
  const [prefetching, setPrefetching] = useState(false);

  // Track the current entity to detect stale results and unmount
  const entityRef = useRef<string>(entityId);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    entityRef.current = entityId;

    // No client or no capabilities -> fallback mode, no prefetch
    if (!client || capabilities === null) {
      setCounts(null);
      setPrefetching(false);
      return;
    }

    // Reset counts for new entity
    setCounts(null);
    setPrefetching(true);
    const currentEntityId = entityId;

    const fetchOps = capabilities.operations
      ? client.listOperations(entityType, entityId).then((ops) => ops.length).catch(() => 0)
      : Promise.resolve(0);

    const fetchConfigs = capabilities.configurations
      ? client.listConfigurations(entityType, entityId).then((r) => r.parameters.length).catch(() => 0)
      : Promise.resolve(0);

    const fetchFaults = capabilities.faults
      ? client.listEntityFaults(entityType, entityId).then((r) => r.items.length).catch(() => 0)
      : Promise.resolve(0);

    void Promise.all([fetchOps, fetchConfigs, fetchFaults]).then(([ops, configs, faults]) => {
      if (!mountedRef.current) return;
      if (entityRef.current !== currentEntityId) return;
      setCounts({ operations: ops, configurations: configs, faults });
      setPrefetching(false);
    });
  }, [client, capabilities, entityId, entityType]);

  const visibleTabs = deriveVisibleTabs(capabilities, counts);

  // If the current active tab became hidden (prefetch finished, count=0), fall back to first visible
  const resolvedActive: Tab =
    visibleTabs.includes(activeTab as Tab)
      ? (activeTab as Tab)
      : (visibleTabs[0] ?? "data");

  // Notify parent of active-tab fallback on the next tick (avoid setState during render)
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;
  useEffect(() => {
    if (resolvedActive !== activeTab && visibleTabs.length > 0) {
      onTabChangeRef.current(resolvedActive);
    }
  }, [resolvedActive, activeTab, visibleTabs]);

  if (prefetching) {
    return (
      <div
        role="status"
        aria-label="prefetching resource counts"
        style={{ display: "flex", gap: 4, marginBottom: 8 }}
      >
        {STANDARD_TABS.map((t) => (
          <div
            key={t}
            style={{
              height: 28,
              width: 80,
              borderRadius: 4,
              background: c.bgAlt,
              opacity: 0.5,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 2, marginBottom: 8 }}>
      {visibleTabs.map((t) => {
        const count = counts
          ? (t === "operations" ? counts.operations : t === "configurations" ? counts.configurations : t === "faults" ? counts.faults : 0)
          : 0;
        const isActive = resolvedActive === t;
        return (
          <button
            key={t}
            aria-label={t}
            style={{
              ...S.btn(theme, isActive ? "primary" : "ghost"),
              textTransform: "capitalize",
            }}
            onClick={() => onTabChange(t)}
          >
            {t}
            {count > 0 && (
              <span
                style={{
                  ...S.badge(
                    "#fff",
                    t === "faults" ? c.critical : c.accent,
                  ),
                  marginLeft: 4,
                  fontSize: 10,
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel Component
// ---------------------------------------------------------------------------

function EntityBrowserPanel({
  context,
}: {
  context: PanelExtensionContext;
}): ReactElement {
  // Foxglove integration: theme follows the host's color scheme.
  const theme = useColorSchemeTheme(context);

  // Connection settings shared across every panel in this extension.
  const { conn: state, update: updateConnection } = useSharedConnection(
    context.initialState as Partial<PanelState>,
  );

  const [client, setClient] = useState<MedkitApiClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState<string | undefined>();

  // null = not yet fetched or getRoot failed (fallback mode)
  const [capabilities, setCapabilities] = useState<RootCapabilities | null>(null);

  // Tree
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [functions, setFunctions] = useState<TreeNode[]>([]);
  // Heading for the root section: "Areas" normally, "Components" when the
  // gateway exposed no areas and we fell back to /components.
  const [rootLabel, setRootLabel] = useState<"Areas" | "Components">("Areas");

  // Selection
  const [selected, setSelected] = useState<SovdEntity | null>(null);
  const [selectedType, setSelectedType] = useState<SovdResourceEntityType>("components");
  const [activeTab, setActiveTab] = useState<Tab>("data");

  // Tab data
  const [topics, setTopics] = useState<ComponentTopic[]>([]);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState<string | undefined>();

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
        const next = { ...state };
        if (key === "gatewayUrl") next.gatewayUrl = action.payload.value as string;
        else if (key === "basePath") next.basePath = action.payload.value as string;
        else return;
        updateConnection(next);
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
  }, [context, state, updateConnection]);

  // ── Connect ─────────────────────────────────────────────────────

  const doConnect = useCallback(async () => {
    const c = new MedkitApiClient(state.gatewayUrl, state.basePath);
    setConnError(undefined);
    try {
      const ok = await c.ping();
      if (!ok) {
        setConnError("Server not reachable");
        return;
      }
      setClient(c);
      setConnected(true);

      // Fetch capabilities from GET /. Failure is non-fatal: null = fallback mode.
      void c.getRoot().then((root) => setCapabilities(root.capabilities)).catch(() => {
        setCapabilities(null);
      });

      // Load areas and functions in parallel.
      const [areas, funcs] = await Promise.all([
        c.listAreas(),
        c.listFunctions().catch(() => [] as SovdEntity[]),
      ]);
      // Gateways running in runtime_only mode without a manifest report
      // zero areas but still expose the host machine as a single Component
      // (via HostInfoProvider). Fall back to /components so the tree is not
      // empty just because no manifest is configured.
      const roots: SovdEntity[] =
        areas.length > 0 ? areas : await c.listComponents().catch(() => [] as SovdEntity[]);
      setRootLabel(areas.length > 0 ? "Areas" : "Components");
      setTree(roots.map((r) => ({ entity: r, isExpanded: false, isLoading: false })));
      setFunctions(funcs.map((f) => ({ entity: f, isExpanded: false, isLoading: false })));
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
        entity.type === "function" ? "functions" :
        "components";
      setSelectedType(eType);
      setActiveTab("data");
      setTabLoading(true);
      setTabError(undefined);
      setTopics([]);
      setFaults([]);
      setApps([]);

      try {
        const [dataRes, faultsRes] = await Promise.all([
          client.listEntityData(eType, entity.id).catch(() => [] as ComponentTopic[]),
          client.listEntityFaults(eType, entity.id).catch(() => ({ items: [] as Fault[] })),
        ]);
        setTopics(dataRes);
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
        <h3 style={S.heading(theme)}>ros2_medkit Entity Browser</h3>
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
        {tree.length === 0 && functions.length === 0 && <div style={S.emptyState(theme)}>No entities found</div>}
        {tree.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: c.textMuted, marginBottom: 2, marginTop: 4 }}>{rootLabel}</div>
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
          </>
        )}
        {functions.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: c.textMuted, marginBottom: 2, marginTop: 8 }}>Functions</div>
            {functions.map((node) => (
              <TreeNodeRow
                key={node.entity.id}
                node={node}
                path={[]}
                depth={0}
                theme={theme}
                selected={selected}
                onToggle={toggleNode}
                onSelect={selectEntity}
              />
            ))}
          </>
        )}
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

            {/* Capability-driven tab bar */}
            <EntityBrowserTabBar
              client={client}
              capabilities={capabilities}
              entityId={selected.id}
              entityType={selectedType}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              theme={theme}
            />

            {tabError && <div style={S.errorBox(theme)}>⚠ {tabError}</div>}
            {tabLoading && <div style={{ color: c.textMuted }}>Loading…</div>}

            {!tabLoading && activeTab === "data" && (
              <DataTab topics={topics} theme={theme} />
            )}
            {activeTab === "operations" && client != null && (
              <OperationsPanel
                client={client}
                entityType={selectedType}
                entityId={selected.id}
                theme={theme}
              />
            )}
            {activeTab === "configurations" && client != null && (
              <ConfigurationsPanel
                client={client}
                entityType={selectedType}
                entityId={selected.id}
                theme={theme}
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
            {activeTab === "logs" && client != null && (
              <LogsPanel
                client={client}
                entityType={selectedType}
                entityId={selected.id}
                theme={theme}
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
  const hasChildren = node.entity.type !== "app" && node.entity.type !== "function";
  const icon = node.entity.type === "area" ? "📁" : node.entity.type === "component" ? "🔧" : node.entity.type === "function" ? "⚡" : "📦";

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
  client: MedkitApiClient | null;
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
