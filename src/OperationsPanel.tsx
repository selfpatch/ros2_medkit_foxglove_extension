// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Operations tab: list operations -> pick one -> form -> Run -> show response.
// Service vs action detection is via Operation.kind ("service" | "action").
// Operation.type_info.schema carries the gateway's input schema (request for
// services, goal for actions); the form renders real fields when present, or
// "No parameters" when the operation has no inputs.

import { type ReactElement, useCallback, useEffect, useState } from "react";

import { type MedkitApiClient } from "./medkit-api";
import { OperationRequestForm } from "./OperationRequestForm";
import { getSchemaDefaults } from "./schema-utils";
import type { TopicSchema } from "./schema-utils";
import type { CreateExecutionResponse, Operation, SovdResourceEntityType } from "./types";
import * as S from "./styles";
import type { Theme } from "./styles";

// =============================================================================
// Response display
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

  const isAction = response.kind === "action";

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
        <span
          style={S.badge(
            "#fff",
            isAction ? c.warning : c.success,
          )}
        >
          {isAction ? "action" : "service"}
        </span>
        <span
          style={S.badge(
            c.text,
            c.bgCard,
          )}
        >
          {response.status}
        </span>
        {isAction && response.id != null && (
          <span style={{ fontSize: 11, color: c.textMuted }}>
            id: <code style={{ color: c.accent }}>{String(response.id)}</code>
          </span>
        )}
      </div>

      {isAction ? (
        /* Action: execution was created - show initial status and id */
        <div style={{ fontSize: 12, color: c.text }}>
          Execution created
          {response.id != null && (
            <span style={{ color: c.textMuted }}> ({String(response.id)})</span>
          )}
          . Status: <strong>{response.status}</strong>
        </div>
      ) : (
        /* Service: synchronous result - show result or parameters */
        <>
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
        </>
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
 * Action: asynchronous execution created - shows id + initial status.
 * Full lifecycle (polling/cancel/feedback) is T3.
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

  // Execution state
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | undefined>();
  const [response, setResponse] = useState<CreateExecutionResponse | null>(null);

  // Load operations on mount or when entity changes
  useEffect(() => {
    setSelectedOp(null);
    setSchema({});
    setFormValue({});
    setResponse(null);
    setRunError(undefined);
    setLoadError(undefined);
    setOperations([]);
    setLoading(true);

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
  }, [client, entityType, entityId]);

  // When an operation is selected, derive the schema from its type_info.schema.
  // For services this is the request schema; for actions the goal schema.
  // Falls back to an empty schema when type_info is absent (no parameters).
  const handleSelectOp = useCallback((op: Operation) => {
    setSelectedOp(op);
    setResponse(null);
    setRunError(undefined);

    const derivedSchema = op.type_info?.schema ?? {};
    setSchema(derivedSchema);
    setFormValue(getSchemaDefaults(derivedSchema));
  }, []);

  const handleRun = useCallback(async () => {
    if (!selectedOp) return;
    setRunning(true);
    setRunError(undefined);
    setResponse(null);

    try {
      const request =
        selectedOp.kind === "action"
          ? { type: selectedOp.type, goal: formValue }
          : { type: selectedOp.type, request: formValue };

      const res = await client.createExecution(entityType, entityId, selectedOp.name, request);
      setResponse(res);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setRunning(false);
    }
  }, [client, entityType, entityId, selectedOp, formValue]);

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

          {response != null && <ResponseDisplay response={response} theme={theme} />}
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
