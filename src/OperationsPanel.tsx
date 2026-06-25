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
import { MedkitApiError } from "./gateway-client";
import { OperationRequestForm } from "./OperationRequestForm";
import { getSchemaDefaults } from "./schema-utils";
import type { TopicSchema } from "./schema-utils";
import type {
  CreateExecutionResponse,
  ExecutionStatus,
  Operation,
  SovdResourceEntityType,
} from "./types";
import * as S from "./styles";
import type { Theme } from "./styles";

// Poll interval for action execution lifecycle (ms). The next poll is scheduled
// only AFTER the previous getExecution resolves (recursive setTimeout), so polls
// never overlap regardless of gateway latency.
const POLL_INTERVAL_MS = 1000;

// After this many consecutive transient (5xx / network) poll failures, give up
// rather than looping forever on a gateway that never recovers.
const MAX_POLL_FAILURES = 5;

// =============================================================================
// Helpers
// =============================================================================

function isTerminal(status: ExecutionStatus): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function statusColor(status: ExecutionStatus, c: ReturnType<typeof S.colors>): string {
  if (status === "completed") return c.success;
  if (status === "failed" || status === "canceled") return c.critical;
  if (status === "running") return c.accent;
  return c.warning; // pending
}

// Map a createExecution response status to the execution-lifecycle status used
// for the active-execution view. The async (202) response carries
// status:"running"; default to "running" if a producer omits it, since an
// execution with an id is already in flight.
function initialActiveStatus(status: CreateExecutionResponse["status"]): ExecutionStatus {
  return status ?? "running";
}

// =============================================================================
// Active execution state
// =============================================================================

interface ActiveExecution {
  id: string;
  status: ExecutionStatus;
  parameters?: unknown;
  ros2Status?: string | null;
}

interface ExecutionHistoryEntry {
  id: string;
  timestamp: Date;
  terminalStatus: ExecutionStatus;
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
        {/* The gateway's synchronous service response is `{parameters}` only -
            no status/kind field - so a status badge is shown only on the rare
            path where a producer does include one. */}
        {response.status != null && (
          <span style={S.badge(c.text, c.bgCard)}>{response.status}</span>
        )}
      </div>

      {/* The service result is returned under `parameters` (the gateway maps the
          service response into it). */}
      {response.parameters != null ? (
        <pre style={preStyle}>{JSON.stringify(response.parameters, null, 2)}</pre>
      ) : (
        <div style={{ fontSize: 12, color: c.textMuted }}>
          Service completed (no result payload).
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

      {!terminal && (
        <>
          {activeExecution.ros2Status != null && (
            <div style={{ marginBottom: 4, fontSize: 11, color: c.textMuted }}>
              ROS 2 status: <code style={{ color: c.text }}>{activeExecution.ros2Status}</code>
            </div>
          )}
          {activeExecution.parameters != null && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: c.textMuted, marginBottom: 2 }}>
                Last Feedback:
              </div>
              <pre style={preStyle}>{JSON.stringify(activeExecution.parameters, null, 2)}</pre>
            </div>
          )}
        </>
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

  // Operations list state. `loading` starts true so the first paint shows the
  // loading indicator rather than flashing "No operations" before the
  // entity-change effect kicks off the initial listOperations call.
  const [loading, setLoading] = useState(true);
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
  // History is per-operation: switching to another op and back must not lose the
  // first op's runs. Keyed by operation name; the displayed history is the
  // selected op's bucket.
  const [historyByOp, setHistoryByOp] = useState<Record<string, ExecutionHistoryEntry[]>>({});
  const [showHistory, setShowHistory] = useState(false);

  const executionHistory =
    selectedOp != null ? (historyByOp[selectedOp.name] ?? []) : [];

  // Lifecycle refs
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const pollSeqRef = useRef(0);

  // Set mountedRef false on component unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Stop polling helper (stable - no deps that change). Clears any pending tick
  // and bumps the sequence so an in-flight tick that resolves later is discarded.
  const stopPolling = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    pollSeqRef.current++;
    setPolling(false);
  }, []);

  // Append a terminal entry to a given op's history, deduped by execution id
  // across the whole (capped) bucket. First write wins: if a poll-tick already
  // logged a real terminal (completed/failed) for this id, a later cancel's
  // "canceled" entry is dropped, so the history and active panel cannot disagree
  // for the same execution. Capped at the most recent 10.
  const appendHistory = useCallback(
    (opName: string, entry: ExecutionHistoryEntry) => {
      setHistoryByOp((prev) => {
        const bucket = prev[opName] ?? [];
        if (bucket.some((e) => e.id === entry.id)) return prev; // already logged
        return { ...prev, [opName]: [entry, ...bucket.slice(0, 9)] };
      });
    },
    [],
  );

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
    setHistoryByOp({});
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

  // Polling effect: drives when activeExecution?.id is set and polling=true.
  //
  // Uses a RECURSIVE setTimeout (not setInterval): each tick schedules the next
  // one only after its own getExecution resolves, so requests never overlap even
  // if a poll outlasts the interval. Hygiene preserved from the prior setInterval
  // version:
  //   - mountedRef gate: no setState after unmount.
  //   - pollSeqRef gate (mySeq): a stale tick (from a superseded execution /
  //     entity / op change) is discarded and never overwrites newer state.
  //   - opName captured at effect entry (no stale-closure non-null assertion).
  //   - terminal / cancel / unmount / entity-or-op change all stop the loop.
  useEffect(() => {
    const execId = activeExecution?.id;
    if (execId == null || !polling) return;
    // Capture the op name now; never read a stale selectedOp inside the loop.
    const opName = selectedOp?.name;
    if (opName == null) return;

    const mySeq = ++pollSeqRef.current;
    let consecutiveFailures = 0;

    // Stop the loop and record a terminal failure entry. Used when polling can
    // never recover (the goal is gone, or too many transient errors in a row).
    const failTerminally = (message: string): void => {
      timeoutRef.current = null;
      setPolling(false);
      setRunError(message);
      appendHistory(opName, { id: execId, timestamp: new Date(), terminalStatus: "failed" });
    };

    const tick = async (): Promise<void> => {
      if (!mountedRef.current || pollSeqRef.current !== mySeq) return;
      let exec;
      try {
        exec = await client.getExecution(entityType, entityId, opName, execId);
      } catch (err) {
        if (!mountedRef.current || pollSeqRef.current !== mySeq) return;
        const status = err instanceof MedkitApiError ? err.status : undefined;
        // A 4xx (notably 404 once the gateway evicts a terminal/stuck goal) is
        // terminal - retrying can never recover it. Stop, surface it, and log a
        // terminal entry instead of looping silently on "Polling...".
        if (status != null && status >= 400 && status < 500) {
          const detail = err instanceof Error ? err.message : `HTTP ${status}`;
          failTerminally(`Execution polling stopped: ${detail}`);
          return;
        }
        // Transient (5xx / network): retry up to a cap, then give up.
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_POLL_FAILURES) {
          failTerminally(`Execution polling stopped after ${MAX_POLL_FAILURES} consecutive errors`);
          return;
        }
        timeoutRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        return;
      }
      // Re-check after the await: discard if unmounted or superseded.
      if (!mountedRef.current || pollSeqRef.current !== mySeq) return;
      consecutiveFailures = 0; // a successful poll resets the transient counter

      setActiveExecution({
        id: execId,
        status: exec.status,
        parameters: exec.parameters,
        ros2Status: exec.ros2_status,
      });

      if (isTerminal(exec.status)) {
        timeoutRef.current = null;
        setPolling(false);
        appendHistory(opName, {
          id: execId,
          timestamp: new Date(),
          terminalStatus: exec.status,
        });
      } else {
        timeoutRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      }
    };

    timeoutRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);

    return () => {
      if (timeoutRef.current != null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Bump the sequence so an in-flight tick resolving after teardown is
      // discarded (no setState, no re-schedule).
      pollSeqRef.current++;
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
      // Do NOT clear historyByOp here: history is per-operation, so switching
      // away and back to an op must retain that op's prior runs. The displayed
      // executionHistory is derived from historyByOp[selectedOp.name].
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
    const opName = selectedOp.name;
    setCancelBusy(true);
    stopPolling();
    try {
      await client.cancelExecution(entityType, entityId, opName, execId);
    } catch (err) {
      // The DELETE failed - the execution was NOT canceled, so do not stamp it
      // canceled. Surface the failure instead.
      if (mountedRef.current) {
        setRunError(err instanceof Error ? err.message : "Cancel failed");
        setCancelBusy(false);
      }
      return;
    }
    if (mountedRef.current) {
      const canceledStatus: ExecutionStatus = "canceled";
      setActiveExecution((prev) => (prev != null ? { ...prev, status: canceledStatus } : null));
      // appendHistory dedupes by id across the bucket, so if a terminal poll-tick
      // already logged this execution its status wins and this canceled entry is
      // dropped (no history/panel disagreement).
      appendHistory(opName, { id: execId, timestamp: new Date(), terminalStatus: canceledStatus });
      setCancelBusy(false);
    }
  }, [activeExecution, client, entityType, entityId, selectedOp, stopPolling, appendHistory]);

  const handleRun = useCallback(async () => {
    if (selectedOp == null) return;
    stopPolling();
    setRunning(true);
    setRunError(undefined);
    setResponse(null);
    setActiveExecution(null);

    try {
      // Include `type` only when the operation has a non-empty type. The gateway
      // treats a present body `type` (even "") as an override of the discovered
      // action/service type, so sending type:"" breaks introspection.
      const typeField = selectedOp.type ? { type: selectedOp.type } : {};
      const request =
        selectedOp.kind === "action"
          ? { ...typeField, goal: formValue }
          : { ...typeField, request: formValue };

      const res = await client.createExecution(entityType, entityId, selectedOp.name, request);

      if (!mountedRef.current) return;
      if (selectedOp.kind === "action" && res.id != null) {
        // Start lifecycle polling
        setActiveExecution({
          id: res.id,
          status: initialActiveStatus(res.status),
          parameters: undefined,
          ros2Status: undefined,
        });
        setPolling(true);
      } else {
        // Service or action without id: show immediate response
        setResponse(res);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setRunError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      if (mountedRef.current) setRunning(false);
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
            disabled={running || polling}
            onClick={() => void handleRun()}
            aria-label={`Run ${selectedOp.name}`}
          >
            {running ? "Running..." : polling ? "Polling..." : "Run"}
          </button>

          {/* Service response */}
          {response != null && selectedOp.kind === "service" && (
            <ResponseDisplay response={response} theme={theme} />
          )}

          {/* Action execution lifecycle.
              Deliberate divergence from web_ui: web_ui auto-hides the action
              panel ~3s after the execution reaches a terminal state; the
              Foxglove panel keeps it visible so the operator retains the final
              status/result until they select another op or re-run. No auto-hide
              timer here by design. */}
          {activeExecution != null && selectedOp.kind === "action" && (
            <ActionExecutionPanel
              activeExecution={activeExecution}
              cancelBusy={cancelBusy}
              onCancel={() => void handleCancel()}
              theme={theme}
            />
          )}

          {/* Execution history (per-operation, from historyByOp[selectedOp.name]) */}
          {executionHistory.length > 0 && (
            <ExecutionHistory
              entries={executionHistory}
              show={showHistory}
              onToggle={() => setShowHistory((v) => !v)}
              onClear={() =>
                setHistoryByOp((prev) => ({ ...prev, [selectedOp.name]: [] }))
              }
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
  // Inline styles cannot use :focus-visible, so track focus in state to render a
  // visible keyboard-focus ring on this role="button" element.
  const [focused, setFocused] = useState(false);
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
        outline: focused ? `2px solid ${c.accent}` : "none",
        outlineOffset: focused ? 1 : 0,
        boxShadow: focused ? `0 0 0 2px ${c.accent}55` : "none",
      }}
      onClick={() => onSelect(op)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        // Space would scroll the panel by default; prevent that and activate.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(op);
        }
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
