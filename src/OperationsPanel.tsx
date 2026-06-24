// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Operations tab: list operations -> pick one -> form -> Run -> show response.
// Service vs action detection is via Operation.kind ("service" | "action").
// Operation.type_info.schema carries the gateway's input schema (request for
// services, goal for actions); the form renders real fields when present, or
// "No parameters" when the operation has no inputs.
//
// Action lifecycle (T3): createExecution -> poll GET executions/{id} ~1s ->
// show status/feedback -> Cancel via DELETE; execution history capped at 10.

import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { type MedkitApiClient } from "./medkit-api";
import { OperationRequestForm } from "./OperationRequestForm";
import { getSchemaDefaults } from "./schema-utils";
import type { TopicSchema } from "./schema-utils";
import type { CreateExecutionResponse, Operation, SovdResourceEntityType } from "./types";
import * as S from "./styles";
import type { Theme } from "./styles";

// =============================================================================
// Helpers
// =============================================================================

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function statusColor(status: string, c: ReturnType<typeof S.colors>): string {
  if (status === "completed") return c.success;
  if (status === "failed" || status === "canceled") return c.critical;
  if (status === "running") return c.accent;
  return c.warning; // pending
}

// =============================================================================
// Active execution state
// =============================================================================

interface ActiveExecution {
  id: string;
  status: string;
  parameters?: unknown;
  ros2Status?: string | null;
}

interface ExecutionHistoryEntry {
  id: string;
  timestamp: Date;
  terminalStatus: string;
}

// =============================================================================
// Service response display (unchanged from T2)
// =============================================================================

interface ResponseDisplayProps {
  response: CreateExecutionResponse;
  theme: Theme;
}

function ResponseDisplay({ response, theme }: ResponseDisplayProps): ReactElement {
  const c = S.colors(theme);
  const preStyle = {
    margin: "6px 0 0",
    padding: 6,
    background: c.bgAlt,
    borderRadius: 4,
    fontSize: 11,
    overflow: "auto" as const,
    maxHeight: 200,
    whiteSpace: "pre-wrap" as const,
    fontFamily: "ui-monospace, monospace",
  };

  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        background: c.bgAlt,
        borderRadius: 4,
        border: `1px solid ${c.borderLight}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={S.badge("#fff", c.success)}>service</span>
        <span style={S.badge(c.text, c.bgCard)}>{response.status}</span>
      </div>

      {response.result != null && (
        <pre style={preStyle}>{JSON.stringify(response.result, null, 2)}</pre>
      )}
      {response.parameters != null && (
        <pre style={preStyle}>{JSON.stringify(response.parameters, null, 2)}</pre>
      )}
      {response.result == null && response.parameters == null && (
        <div style={{ fontSize: 12, color: c.textMuted }}>
          Service completed with status: {response.status}
        </div>
      )}

      {response.error != null && (
        <div style={{ ...S.errorBox(theme), marginTop: 6, marginBottom: 0 }}>
          {String(response.error)}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Action execution panel
// =============================================================================

interface ActionExecutionPanelProps {
  activeExecution: ActiveExecution;
  cancelBusy: boolean;
  onCancel: () => void;
  theme: Theme;
}

function ActionExecutionPanel({
  activeExecution,
  cancelBusy,
  onCancel,
  theme,
}: ActionExecutionPanelProps): ReactElement {
  const c = S.colors(theme);
  const terminal = isTerminal(activeExecution.status);
  const preStyle = {
    margin: "4px 0 0",
    padding: 6,
    background: c.bgAlt,
    borderRadius: 4,
    fontSize: 11,
    overflow: "auto" as const,
    maxHeight: 160,
    whiteSpace: "pre-wrap" as const,
    fontFamily: "ui-monospace, monospace",
  };

  return (
    <div
      style={{
        marginTop: 8,
        padding: 8,
        background: c.bgAlt,
        borderRadius: 4,
        border: `1px solid ${c.borderLight}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={S.badge("#fff", c.warning)}>action</span>
        <span
          style={S.badge(
            "#fff",
            statusColor(activeExecution.status, c),
          )}
        >
          {activeExecution.status}
        </span>
        <span style={{ fontSize: 11, color: c.textMuted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          id: <code style={{ color: c.accent }}>{activeExecution.id}</code>
        </span>
        {!terminal && (
          <button
            style={{ ...S.btn(theme, "danger"), fontSize: 11, padding: "2px 8px" }}
            disabled={cancelBusy}
            onClick={onCancel}
            aria-label="Cancel execution"
          >
            {cancelBusy ? "Canceling..." : "Cancel"}
          </button>
        )}
      </div>

      {!terminal && activeExecution.parameters != null && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: c.textMuted, marginBottom: 2 }}>
            Last Feedback:
          </div>
          <pre style={preStyle}>{JSON.stringify(activeExecution.parameters, null, 2)}</pre>
        </div>
      )}

      {terminal && (
        <div>
          {activeExecution.parameters != null && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: c.textMuted, marginBottom: 2 }}>
                Result:
              </div>
              <pre style={preStyle}>{JSON.stringify(activeExecution.parameters, null, 2)}</pre>
            </>
          )}
          {activeExecution.ros2Status != null && (
            <div style={{ marginTop: 4, fontSize: 11, color: c.textMuted }}>
              ROS 2 status: <code style={{ color: c.text }}>{activeExecution.ros2Status}</code>
            </div>
          )}
          {activeExecution.parameters == null && activeExecution.ros2Status == null && (
            <div style={{ fontSize: 12, color: c.textMuted }}>
              Execution {activeExecution.status}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Execution history
// =============================================================================

interface ExecutionHistoryProps {
  entries: ExecutionHistoryEntry[];
  show: boolean;
  onToggle: () => void;
  onClear: () => void;
  theme: Theme;
}

function ExecutionHistory({
  entries,
  show,
  onToggle,
  onClear,
  theme,
}: ExecutionHistoryProps): ReactElement {
  const c = S.colors(theme);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          style={{ ...S.btn(theme, "ghost"), fontSize: 11 }}
          onClick={onToggle}
          aria-expanded={show}
          aria-label="Toggle execution history"
        >
          History ({entries.length}){show ? " ▲" : " ▼"}
        </button>
        <button
          style={{ ...S.btn(theme, "ghost"), fontSize: 11 }}
          onClick={onClear}
          aria-label="Clear execution history"
        >
          Clear
        </button>
      </div>

      {show && (
        <div
          style={{
            marginTop: 4,
            border: `1px solid ${c.borderLight}`,
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          {entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderBottom: `1px solid ${c.borderLight}`,
                fontSize: 11,
              }}
            >
              <code
                style={{
                  color: c.accent,
                  maxWidth: 120,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: "inline-block",
                }}
                title={entry.id}
              >
                {entry.id}
              </code>
              <span style={{ flex: 1, color: c.textMuted }}>
                {entry.timestamp.toLocaleTimeString()}
              </span>
              <span
                style={S.badge(
                  "#fff",
                  statusColor(entry.terminalStatus, c),
                )}
              >
                {entry.terminalStatus}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// OperationsPanel - public API
// =============================================================================

export interface OperationsPanelProps {
  client: MedkitApiClient;
  entityType: SovdResourceEntityType;
  entityId: string;
  theme: Theme;
}

/**
 * Operations tab: list operations for an entity, select one, render
 * OperationRequestForm seeded with schema defaults, Run via createExecution,
 * display the immediate response with service/action distinction.
 *
 * Service: synchronous result - shows result/parameters JSON.
 * Action: asynchronous execution - polls GET executions/{id} ~1s, shows
 * status/feedback, Cancel via DELETE, history capped at 10.
 */
export function OperationsPanel({
  client,
  entityType,
  entityId,
  theme,
}: OperationsPanelProps): ReactElement {
  const c = S.colors(theme);

  // Operations list state
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [operations, setOperations] = useState<Operation[]>([]);

  // Selection + form
  const [selectedOp, setSelectedOp] = useState<Operation | null>(null);
  const [schema, setSchema] = useState<TopicSchema>({});
  const [formValue, setFormValue] = useState<Record<string, unknown>>({});

  // Execution state (services use response; actions use activeExecution)
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | undefined>();
  const [response, setResponse] = useState<CreateExecutionResponse | null>(null);

  // Action lifecycle state
  const [activeExecution, setActiveExecution] = useState<ActiveExecution | null>(null);
  const [polling, setPolling] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [executionHistory, setExecutionHistory] = useState<ExecutionHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Lifecycle refs
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const pollSeqRef = useRef(0);

  // Set mountedRef false on component unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Stop polling helper (stable - no deps that change)
  const stopPolling = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    pollSeqRef.current++;
    setPolling(false);
  }, []);

  // Load operations on mount or when entity changes
  useEffect(() => {
    stopPolling();
    setSelectedOp(null);
    setSchema({});
    setFormValue({});
    setResponse(null);
    setRunError(undefined);
    setLoadError(undefined);
    setOperations([]);
    setLoading(true);
    setActiveExecution(null);
    setExecutionHistory([]);
    setShowHistory(false);

    let cancelled = false;
    client.listOperations(entityType, entityId).then(
      (ops) => {
        if (!cancelled) {
          setOperations(ops);
          setLoading(false);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load operations");
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, entityType, entityId]);

  // Polling effect: drives when activeExecution?.id is set and polling=true
  useEffect(() => {
    if (activeExecution?.id == null || !polling) return;
    const mySeq = ++pollSeqRef.current;
    const execId = activeExecution.id;

    intervalRef.current = setInterval(() => {
      if (!mountedRef.current || pollSeqRef.current !== mySeq) {
        clearInterval(intervalRef.current!);
        return;
      }
      void (async () => {
        try {
          const exec = await client.getExecution(entityType, entityId, selectedOp!.name, execId);
          if (!mountedRef.current || pollSeqRef.current !== mySeq) return;
          setActiveExecution({
            id: execId,
            status: exec.status,
            parameters: exec.parameters,
            ros2Status: exec.ros2_status,
          });
          if (isTerminal(exec.status)) {
            clearInterval(intervalRef.current!);
            intervalRef.current = null;
            setPolling(false);
            setExecutionHistory((prev) => [
              { id: execId, timestamp: new Date(), terminalStatus: exec.status },
              ...prev.slice(0, 9),
            ]);
          }
        } catch {
          // ignore transient poll errors
        }
      })();
    }, 1000);

    return () => {
      if (intervalRef.current != null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExecution?.id, polling]);

  // When an operation is selected, derive the schema from its type_info.schema.
  // For services this is the request schema; for actions the goal schema.
  // Falls back to an empty schema when type_info is absent (no parameters).
  const handleSelectOp = useCallback(
    (op: Operation) => {
      stopPolling();
      setSelectedOp(op);
      setResponse(null);
      setRunError(undefined);
      setActiveExecution(null);
      setExecutionHistory([]);
      setShowHistory(false);

      const derivedSchema = op.type_info?.schema ?? {};
      setSchema(derivedSchema);
      setFormValue(getSchemaDefaults(derivedSchema));
    },
    [stopPolling],
  );

  const handleCancel = useCallback(async () => {
    if (activeExecution?.id == null || selectedOp == null) return;
    const execId = activeExecution.id;
    setCancelBusy(true);
    stopPolling();
    try {
      await client.cancelExecution(entityType, entityId, selectedOp.name, execId);
    } catch {
      // still show canceled in UI
    }
    if (mountedRef.current) {
      const canceledStatus = "canceled";
      setActiveExecution((prev) => (prev != null ? { ...prev, status: canceledStatus } : null));
      setExecutionHistory((prev) => [
        { id: execId, timestamp: new Date(), terminalStatus: canceledStatus },
        ...prev.slice(0, 9),
      ]);
      setCancelBusy(false);
    }
  }, [activeExecution, client, entityType, entityId, selectedOp, stopPolling]);

  const handleRun = useCallback(async () => {
    if (selectedOp == null) return;
    stopPolling();
    setRunning(true);
    setRunError(undefined);
    setResponse(null);
    setActiveExecution(null);

    try {
      const request =
        selectedOp.kind === "action"
          ? { type: selectedOp.type, goal: formValue }
          : { type: selectedOp.type, request: formValue };

      const res = await client.createExecution(entityType, entityId, selectedOp.name, request);

      if (selectedOp.kind === "action" && res.id != null) {
        // Start lifecycle polling
        setActiveExecution({ id: res.id, status: res.status, parameters: undefined, ros2Status: undefined });
        setPolling(true);
      } else {
        // Service or action without id: show immediate response
        setResponse(res);
      }
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setRunning(false);
    }
  }, [client, entityType, entityId, selectedOp, formValue, stopPolling]);

  // ── Render ──────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ color: c.textMuted, fontSize: 12 }}>Loading operations...</div>;
  }

  if (loadError != null) {
    return <div style={S.errorBox(theme)}>Failed to load operations: {loadError}</div>;
  }

  if (operations.length === 0) {
    return <div style={S.emptyState(theme)}>No operations</div>;
  }

  const services = operations.filter((op) => op.kind === "service");
  const actions = operations.filter((op) => op.kind === "action");

  return (
    <div>
      {/* Operation list */}
      <div style={{ marginBottom: 12 }}>
        {services.length > 0 && (
          <>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: c.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 4,
              }}
            >
              Services
            </div>
            {services.map((op) => (
              <OperationListItem
                key={op.name}
                op={op}
                selected={selectedOp?.name === op.name}
                theme={theme}
                onSelect={handleSelectOp}
              />
            ))}
          </>
        )}
        {actions.length > 0 && (
          <>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: c.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 4,
                marginTop: services.length > 0 ? 8 : 0,
              }}
            >
              Actions
            </div>
            {actions.map((op) => (
              <OperationListItem
                key={op.name}
                op={op}
                selected={selectedOp?.name === op.name}
                theme={theme}
                onSelect={handleSelectOp}
              />
            ))}
          </>
        )}
      </div>

      {/* Form area */}
      {selectedOp != null && (
        <div
          style={{
            ...S.card(theme),
            padding: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>{selectedOp.name}</strong>
            <span
              style={S.badge(
                "#fff",
                selectedOp.kind === "action" ? c.warning : c.accent,
              )}
            >
              {selectedOp.kind}
            </span>
            {selectedOp.type !== "" && (
              <span style={{ fontSize: 11, color: c.textMuted, flex: 1 }}>
                {selectedOp.type}
              </span>
            )}
          </div>

          {/* Request / Goal label */}
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: c.textMuted,
              marginBottom: 6,
            }}
          >
            {selectedOp.kind === "action" ? "Goal" : "Request"}
          </div>

          {Object.keys(schema).length > 0 ? (
            <OperationRequestForm
              schema={schema}
              value={formValue}
              onChange={setFormValue}
              theme={theme}
            />
          ) : (
            <div style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>
              No parameters
            </div>
          )}

          {runError != null && (
            <div style={{ ...S.errorBox(theme), marginTop: 8 }}>{runError}</div>
          )}

          <button
            style={{ ...S.btn(theme, "primary"), marginTop: 10, width: "100%" }}
            disabled={running}
            onClick={() => void handleRun()}
            aria-label={`Run ${selectedOp.name}`}
          >
            {running ? "Running..." : "Run"}
          </button>

          {/* Service response */}
          {response != null && selectedOp.kind === "service" && (
            <ResponseDisplay response={response} theme={theme} />
          )}

          {/* Action execution lifecycle */}
          {activeExecution != null && selectedOp.kind === "action" && (
            <ActionExecutionPanel
              activeExecution={activeExecution}
              cancelBusy={cancelBusy}
              onCancel={() => void handleCancel()}
              theme={theme}
            />
          )}

          {/* Execution history */}
          {executionHistory.length > 0 && (
            <ExecutionHistory
              entries={executionHistory}
              show={showHistory}
              onToggle={() => setShowHistory((v) => !v)}
              onClear={() => setExecutionHistory([])}
              theme={theme}
            />
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// OperationListItem
// =============================================================================

function OperationListItem({
  op,
  selected,
  theme,
  onSelect,
}: {
  op: Operation;
  selected: boolean;
  theme: Theme;
  onSelect: (op: Operation) => void;
}): ReactElement {
  const c = S.colors(theme);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={op.name}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        borderRadius: 4,
        marginBottom: 4,
        cursor: "pointer",
        background: selected ? c.accent + "22" : c.bgCard,
        border: `1px solid ${selected ? c.accent : c.borderLight}`,
      }}
      onClick={() => onSelect(op)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(op);
      }}
    >
      <span style={{ fontSize: 12, fontWeight: selected ? 600 : 400, color: c.text, flex: 1 }}>
        {op.name}
      </span>
      <span
        style={S.badge(
          "#fff",
          op.kind === "action" ? c.warning : c.accent,
        )}
      >
        {op.kind}
      </span>
      {op.type !== "" && (
        <span style={{ fontSize: 11, color: c.textMuted, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {op.type}
        </span>
      )}
    </div>
  );
}
