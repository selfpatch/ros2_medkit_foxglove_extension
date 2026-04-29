// Copyright 2024–2026 Selfpatch GmbH. Apache-2.0 license.

/**
 * Entity Browser panel — tree view of ros2_medkit areas → components → apps.
 * Shows entity details, topic data, configurations, operations, and faults for selected entity.
 */

import { type PanelExtensionContext } from "@foxglove/extension";
import {
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";

import { MedkitApiClient, MedkitApiError } from "./medkit-api";
import { type GatewayConnection } from "./shared-connection";
import { useColorSchemeTheme, useSharedConnection } from "./panel-hooks";
import { onEntityGraphChanged } from "./cross-panel-events";
import type {
  SovdEntity,
  ComponentTopic,
  Parameter,
  Operation,
  Fault,
  SovdResourceEntityType,
  FaultResponse,
  Snapshot,
  LogEntry,
  LogSeverity,
} from "./types";
import { isRosbagSnapshot } from "./types";
import { SchemaForm } from "./SchemaForm";
import {
  convertJsonSchemaToTopicSchema,
  getSchemaDefaults,
} from "./schema-utils";
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

  // Tree
  const [tree, setTree] = useState<TreeNode[]>([]);
  // Tracks whether the root tree is showing Areas or Components - the
  // gateway returns one of the two (manifests with areas defined go via
  // /areas; manifest-less or area-less ones fall back to /components),
  // and the section header in the UI should reflect that.
  const [treeKind, setTreeKind] = useState<"areas" | "components">("areas");
  const [functions, setFunctions] = useState<TreeNode[]>([]);

  // Selection
  const [selected, setSelected] = useState<SovdEntity | null>(null);
  const [selectedType, setSelectedType] = useState<SovdResourceEntityType>("components");
  const [activeTab, setActiveTab] = useState<Tab>("data");

  // Tab data
  const [topics, setTopics] = useState<ComponentTopic[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [configs, setConfigs] = useState<Parameter[]>([]);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logSeverity, setLogSeverity] = useState<LogSeverity>("info");
  const [logContext, setLogContext] = useState<string>("");
  const [logRefreshSec, setLogRefreshSec] = useState<number>(0);  // 0 = off
  const [logsUnsupported, setLogsUnsupported] = useState(false);
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

  // Cancellation token: only the most-recent doConnect run is allowed
  // to commit state. The entity-graph-changed signal fires doConnect
  // twice (immediate + 2.5s retry), and the user can change the gateway
  // URL while a connect is in flight - without this guard, a stale run
  // can land setClient/setTree after a fresher run already finished,
  // tearing the panel state.
  const connectId = useRef(0);
  const doConnect = useCallback(async () => {
    const myId = ++connectId.current;
    const c = new MedkitApiClient(state.gatewayUrl, state.basePath);
    setConnError(undefined);
    try {
      const ok = await c.ping();
      if (myId !== connectId.current) return;
      if (!ok) {
        setConnError("Server not reachable");
        return;
      }
      setClient(c);
      setConnected(true);

      // Load areas and functions in parallel.
      const [areas, funcs] = await Promise.all([
        c.listAreas(),
        c.listFunctions().catch(() => [] as SovdEntity[]),
      ]);
      if (myId !== connectId.current) return;
      // Gateways running without a manifest (or with one that omits
      // areas) report zero areas but still expose components. Fall
      // back to /components so the tree is not empty just because the
      // manifest didn't declare areas, and remember which collection
      // we drew from so the section header reads correctly.
      let roots: SovdEntity[];
      let kind: "areas" | "components";
      if (areas.length > 0) {
        roots = areas;
        kind = "areas";
      } else {
        roots = await c.listComponents().catch(() => [] as SovdEntity[]);
        kind = "components";
      }
      if (myId !== connectId.current) return;
      setTree(roots.map((r) => ({ entity: r, isExpanded: false, isLoading: false })));
      setTreeKind(kind);
      setFunctions(funcs.map((f) => ({ entity: f, isExpanded: false, isLoading: false })));
    } catch (err) {
      if (myId !== connectId.current) return;
      setConnError(err instanceof Error ? err.message : "Connection failed");
    }
  }, [state.gatewayUrl, state.basePath]);

  // Auto-connect
  useEffect(() => {
    void doConnect();
  }, [doConnect]);

  // Refresh tree when another panel signals the entity graph changed
  // (currently raised by UpdatesPanel after execute / automated). The
  // gateway's runtime discovery picks up forked processes via ROS 2 graph
  // events, which can lag the OTA action by 1-3s - so we refresh now AND
  // again after a delay to catch the post-fork state.
  useEffect(() => {
    let pending: number | null = null;
    const unsubscribe = onEntityGraphChanged(() => {
      void doConnect();
      if (pending != null) window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        pending = null;
        void doConnect();
      }, 2500);
    });
    return () => {
      unsubscribe();
      if (pending != null) window.clearTimeout(pending);
    };
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
        } else if (e.type === "function") {
          // Functions have a /hosts collection too - the apps that
          // together deliver the capability. Without this, expanding
          // a function in the tree did nothing and the operator had no
          // way to see what "Autonomous Navigation" actually contained.
          const appList = await client.listFunctionApps(e.id);
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
      setOperations([]);
      setConfigs([]);
      setFaults([]);
      setLogs([]);

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
      } catch (err) {
        setTabError(err instanceof Error ? err.message : "Load failed");
      } finally {
        setTabLoading(false);
      }
    },
    [client],
  );

  // Reset log filters when the selected entity changes - inheriting the
  // previous entity's severity floor silently hides entries below it,
  // matching what web UI's LogsPanel does on entity change.
  useEffect(() => {
    setLogSeverity("info");
    setLogContext("");
    setLogsUnsupported(false);
  }, [selected?.id, selectedType]);

  // ── Lazy-load + auto-refresh logs (kept off the main entity-load
  //    Promise.all so the initial selection stays fast - logs can be
  //    hundreds of KB).

  useEffect(() => {
    if (!client || !selected || activeTab !== "logs") return;
    let cancelled = false;
    let intervalId: number | null = null;

    const fetchOnce = async () => {
      try {
        const items = await client.listLogs(selectedType, selected.id, {
          severity: logSeverity,
          limit: 200,
          context: logContext || undefined,
        });
        if (cancelled) return;
        setLogs(items);
        setLogsUnsupported(false);
        setTabError(undefined);
      } catch (err) {
        if (cancelled) return;
        // 404 = this entity does not expose /logs. Don't render the
        // generic "Logs load failed" - render an explanatory placeholder.
        if (err instanceof MedkitApiError && (err.status === 404 || err.status === 503)) {
          setLogsUnsupported(true);
          setLogs([]);
          setTabError(undefined);
          return;
        }
        setTabError(err instanceof Error ? err.message : "Logs load failed");
      }
    };

    void fetchOnce();
    if (logRefreshSec > 0) {
      intervalId = window.setInterval(() => void fetchOnce(), logRefreshSec * 1000);
    }
    return () => {
      cancelled = true;
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [client, selected, selectedType, activeTab, logSeverity, logContext, logRefreshSec]);

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
            <div style={{ fontSize: 11, fontWeight: 600, color: c.textMuted, marginBottom: 2, marginTop: 4 }}>
              {treeKind === "areas" ? "Areas" : "Components"}
            </div>
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

            {/* Tabs */}
            <div style={{ display: "flex", gap: 2, marginBottom: 8 }}>
              {(["data", "operations", "configurations", "faults", "logs"] as Tab[]).map((t) => (
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
            {!tabLoading && activeTab === "logs" && (
              <LogsTab
                logs={logs}
                severity={logSeverity}
                onSeverityChange={setLogSeverity}
                contextFilter={logContext}
                onContextChange={setLogContext}
                refreshSec={logRefreshSec}
                onRefreshSecChange={setLogRefreshSec}
                unsupported={logsUnsupported}
                entityType={selectedType}
                theme={theme}
              />
            )}

            {/* Child apps are surfaced via the tree (expand the component
                node) and via the logs aggregation when present, so we
                deliberately do NOT render a separate Apps card list here -
                it duplicated information already on screen and crowded the
                detail panel on narrower layouts. */}
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
  // Areas, Components, and Functions all expose hosted children.
  // Apps are the leaves of the tree.
  const hasChildren = node.entity.type !== "app";
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
  client: MedkitApiClient | null;
  theme: Theme;
}): ReactElement {
  if (operations.length === 0) return <div style={S.emptyState(theme)}>No operations</div>;
  return (
    <div>
      {operations.map((op) => (
        <OperationCard
          key={op.name}
          op={op}
          entityId={entityId}
          entityType={entityType}
          client={client}
          theme={theme}
        />
      ))}
    </div>
  );
}

// One card per operation: header row with kind/type badges + invoke button,
// expandable schema form for typed args, JSON result panel below. Each op
// owns its own form state so opening navigate_to_pose doesn't reset
// change_state's form, etc.
function OperationCard({
  op,
  entityId,
  entityType,
  client,
  theme,
}: {
  op: Operation;
  entityId: string;
  entityType: SovdResourceEntityType;
  client: MedkitApiClient | null;
  theme: Theme;
}): ReactElement {
  const c = S.colors(theme);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);

  // Pull request/goal schema once per op. Memoize so the form doesn't
  // re-init defaults on every render.
  // Memoize on the structural identity of the operation, not on the
  // `op` object reference - listOperations() returns a fresh array on
  // every entity (re-)select, so depending on `op` would re-build the
  // schema and (via the reset effect below) wipe in-progress user edits
  // every time the parent re-fetches.
  const opKey = `${op.name}|${op.kind}|${op.type}`;
  const inputSchema = useMemo(() => {
    if (!op.typeInfo) return null;
    const raw = op.kind === "action" ? op.typeInfo.goal : op.typeInfo.request;
    return convertJsonSchemaToTopicSchema(raw) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opKey]);

  const hasInputs = inputSchema != null && Object.keys(inputSchema).length > 0;
  const [expanded, setExpanded] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>(() =>
    inputSchema ? getSchemaDefaults(inputSchema) : {},
  );

  // Reset to schema defaults only when the operation's structural
  // identity changes (a new op was selected). Re-fetches that hand us a
  // structurally-identical op must NOT clobber form edits.
  const lastOpKey = useRef(opKey);
  useEffect(() => {
    if (lastOpKey.current === opKey) return;
    lastOpKey.current = opKey;
    setFormData(inputSchema ? getSchemaDefaults(inputSchema) : {});
  }, [opKey, inputSchema]);

  // Track the in-flight execution so we can poll for terminal state and
  // expose a cancel button. SOVD `executions` lifecycle: created/POST
  // returns an `id` immediately with status="pending" or "running"; we
  // then GET the same path until status moves to a terminal state
  // (completed / succeeded / failed / aborted / cancelled / error).
  const [executionId, setExecutionId] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const TERMINAL_STATUSES = useMemo(
    () => new Set(["completed", "succeeded", "failed", "aborted", "cancelled", "canceled", "error"]),
    [],
  );

  const stopPolling = useCallback(() => {
    if (pollTimer.current != null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // Stop the timer when the card unmounts (entity switch tears the
  // OperationCards down). Without this, an action poll keeps firing
  // against a non-mounted node.
  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollUntilTerminal = useCallback(
    async (execId: string) => {
      if (!client) return;
      try {
        const snap = await client.getExecution(entityType, entityId, op.name, execId);
        setResult(snap);
        const status = String(snap?.status ?? "").toLowerCase();
        if (TERMINAL_STATUSES.has(status)) {
          setRunning(false);
          setExecutionId(null);
          return;
        }
        pollTimer.current = window.setTimeout(() => void pollUntilTerminal(execId), 1000);
      } catch (err) {
        setResult({ error: err instanceof Error ? err.message : "Poll failed" });
        setRunning(false);
        setExecutionId(null);
      }
    },
    [client, entityType, entityId, op.name, TERMINAL_STATUSES],
  );

  const invoke = useCallback(async () => {
    if (!client) return;
    stopPolling();
    setRunning(true);
    setResult(null);
    try {
      const req: import("./types").CreateExecutionRequest = op.kind === "action"
        ? { type: op.type, goal: hasInputs ? formData : {} }
        : { type: op.type, request: hasInputs ? formData : {} };
      const res = await client.createExecution(entityType, entityId, op.name, req);
      setResult(res);
      // Services usually complete synchronously - the gateway returns a
      // terminal status on the POST. Actions return an in-flight id;
      // start polling.
      const status = String(res?.status ?? "").toLowerCase();
      if (res?.id && !TERMINAL_STATUSES.has(status)) {
        setExecutionId(res.id);
        pollTimer.current = window.setTimeout(() => void pollUntilTerminal(res.id!), 1000);
      } else {
        setRunning(false);
      }
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Failed" });
      setRunning(false);
    }
  }, [client, entityId, entityType, op, formData, hasInputs, pollUntilTerminal, stopPolling, TERMINAL_STATUSES]);

  const cancel = useCallback(async () => {
    if (!client || !executionId) return;
    stopPolling();
    try {
      await client.cancelExecution(entityType, entityId, op.name, executionId);
    } catch (err) {
      setResult((prev: unknown) => ({
        ...((prev as Record<string, unknown>) ?? {}),
        cancel_error: err instanceof Error ? err.message : "Cancel failed",
      }));
    } finally {
      setRunning(false);
      setExecutionId(null);
    }
  }, [client, entityType, entityId, op.name, executionId, stopPolling]);

  const currentStatus = useMemo(() => {
    if (result == null) return null;
    const r = result as { status?: unknown };
    return typeof r.status === "string" ? r.status : null;
  }, [result]);

  const statusColor = useMemo(() => {
    if (!currentStatus) return c.textMuted;
    const s = currentStatus.toLowerCase();
    if (s === "completed" || s === "succeeded") return c.success;
    if (s === "failed" || s === "error" || s === "aborted") return c.critical;
    if (s === "cancelled" || s === "canceled") return c.warning;
    return c.info;
  }, [currentStatus, c]);

  return (
    <div style={S.card(theme)}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12 }}>{op.name}</strong>
        <span style={S.badge("#fff", op.kind === "action" ? c.warning : c.accent)}>
          {op.kind}
        </span>
        <span style={{ color: c.textMuted, fontSize: 11, flex: 1, minWidth: 100 }}>
          {op.type || "—"}
        </span>
        {hasInputs && (
          <button
            style={{ ...S.btn(theme, "ghost"), fontSize: 11 }}
            onClick={() => setExpanded((p) => !p)}
          >
            {expanded ? "Hide args" : "Edit args"}
          </button>
        )}
        <button
          style={S.btn(theme)}
          disabled={running}
          onClick={() => void invoke()}
        >
          {running ? "⏳" : "▶"} {op.kind === "action" ? "Send goal" : "Call"}
        </button>
        {running && executionId && (
          <button
            style={S.btn(theme, "danger")}
            onClick={() => void cancel()}
            title={`Cancel execution ${executionId}`}
          >
            ✕ Cancel
          </button>
        )}
      </div>
      {currentStatus && (
        <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
          <span style={{ color: c.textMuted }}>status:</span>
          <span style={{ ...S.badge("#fff", statusColor), fontSize: 10 }}>
            {currentStatus}
          </span>
          {executionId && (
            <span style={{ color: c.textMuted, fontFamily: "monospace", fontSize: 10 }}>
              {executionId}
            </span>
          )}
        </div>
      )}
      {hasInputs && expanded && inputSchema && (
        <div style={{
          marginTop: 8,
          padding: 8,
          background: c.bgAlt,
          borderRadius: 4,
        }}>
          <SchemaForm
            schema={inputSchema}
            value={formData}
            onChange={setFormData}
            theme={theme}
          />
        </div>
      )}
      {result != null && (
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
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Logs
// ---------------------------------------------------------------------------

const LOG_SEVERITIES: LogSeverity[] = ["debug", "info", "warning", "error", "fatal"];

const LOG_SEVERITY_COLOR: Record<LogSeverity, "info" | "success" | "warning" | "critical"> = {
  debug: "info",
  info: "success",
  warning: "warning",
  error: "critical",
  fatal: "critical",
};

const LOG_REFRESH_OPTIONS = [
  { label: "off", value: 0 },
  { label: "2s", value: 2 },
  { label: "5s", value: 5 },
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
];

function LogsTab({
  logs,
  severity,
  onSeverityChange,
  contextFilter,
  onContextChange,
  refreshSec,
  onRefreshSecChange,
  unsupported,
  entityType,
  theme,
}: {
  logs: LogEntry[];
  severity: LogSeverity;
  onSeverityChange: (s: LogSeverity) => void;
  contextFilter: string;
  onContextChange: (v: string) => void;
  refreshSec: number;
  onRefreshSecChange: (v: number) => void;
  unsupported: boolean;
  entityType: SovdResourceEntityType;
  theme: Theme;
}): ReactElement {
  const c = S.colors(theme);
  const [search, setSearch] = useState("");
  const trimmed = search.trim().toLowerCase();
  const filtered = trimmed
    ? logs.filter((l) => l.message.toLowerCase().includes(trimmed))
    : logs;
  // Web UI skips context filter for `apps` (a single node has no children
  // to disambiguate); mirror that here.
  const showContextFilter = entityType !== "apps";

  if (unsupported) {
    return (
      <div style={S.emptyState(theme)}>
        This entity does not expose a /logs endpoint.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 11, color: c.textMuted }}>Severity ≥</label>
        <select
          value={severity}
          onChange={(e) => onSeverityChange(e.target.value as LogSeverity)}
          style={{ ...S.input(theme), fontSize: 11, padding: "2px 6px" }}
        >
          {LOG_SEVERITIES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label style={{ fontSize: 11, color: c.textMuted, marginLeft: 6 }}>Auto-refresh</label>
        <select
          value={refreshSec}
          onChange={(e) => onRefreshSecChange(Number(e.target.value))}
          style={{ ...S.input(theme), fontSize: 11, padding: "2px 6px" }}
        >
          {LOG_REFRESH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {showContextFilter && (
          <input
            type="text"
            value={contextFilter}
            onChange={(e) => onContextChange(e.target.value)}
            placeholder="Filter context (node)…"
            style={{ ...S.input(theme), fontSize: 11, width: 160 }}
          />
        )}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter messages…"
          style={{ ...S.input(theme), flex: 1, minWidth: 140, fontSize: 11 }}
        />
      </div>
      {filtered.length === 0 ? (
        <div style={S.emptyState(theme)}>No log entries</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {filtered.map((log) => {
            const colorKey = LOG_SEVERITY_COLOR[log.severity] ?? "info";
            const bg =
              colorKey === "critical" ? c.critical :
              colorKey === "warning" ? c.warning :
              colorKey === "success" ? c.success :
              c.info;
            return (
              <div key={log.id} style={{
                ...S.card(theme),
                padding: "4px 6px",
                margin: 0,
                fontSize: 11,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ ...S.badge("#fff", bg), fontSize: 9, minWidth: 50, textAlign: "center" }}>
                    {log.severity}
                  </span>
                  <span style={{ color: c.textMuted, fontSize: 10, fontFamily: "monospace" }}>
                    {log.timestamp.replace("T", " ").replace("Z", "")}
                  </span>
                  {log.context?.node && (
                    <span style={{ color: c.textMuted, fontSize: 10 }}>
                      {log.context.node}
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: "monospace", marginTop: 2 }}>
                  {log.message}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  client: MedkitApiClient | null;
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
