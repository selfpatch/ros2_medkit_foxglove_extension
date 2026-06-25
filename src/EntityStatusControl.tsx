// Copyright 2026 bburda. Apache-2.0 license.
//
// Entity lifecycle status control for apps and components (gateway 0.6.0
// lifecycle API). Shows the current readiness as a badge and exposes the five
// transitions (start / restart / force-restart / shutdown / force-shutdown).
//
// The gateway returns 501 until a lifecycle provider is configured; that case
// surfaces as a disabled "not available" state rather than an error, so the
// control degrades gracefully on a stock gateway. Shutdown and force-shutdown
// ask for inline confirmation before dispatching.

import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { type MedkitApiClient } from "./medkit-api";
import { MedkitApiError } from "./gateway-client";
import type { LifecycleAction, LifecycleStatus, LifecycleStatusResponse } from "./types";
import type { LifecycleEntityType } from "./api-dispatch";
import * as S from "./styles";
import type { Theme } from "./styles";

// "unknown" = loaded but an unrecognized status; "unavailable" = 501 (no provider).
type DisplayStatus = LifecycleStatus | "unavailable" | "unknown";

interface ActionConfig {
  action: LifecycleAction;
  label: string;
  /** Destructive transitions use the danger button variant + confirmation. */
  destructive: boolean;
}

const ACTIONS: ActionConfig[] = [
  { action: "start", label: "Start", destructive: false },
  { action: "restart", label: "Restart", destructive: false },
  { action: "force-restart", label: "Force restart", destructive: false },
  { action: "shutdown", label: "Shutdown", destructive: true },
  { action: "force-shutdown", label: "Force shutdown", destructive: true },
];

// The gateway advertises the transitions it will accept as link fields on the
// status response (one URI per action). Gate each button on whether its link is
// present, so the UI permits exactly what the gateway permits and stays closed
// (fail-safe) on an unknown/odd status, a status we couldn't read, or a gateway
// that exposes readiness but no transitions.
function allowedActionsFromResponse(res: LifecycleStatusResponse): ReadonlySet<LifecycleAction> {
  const allowed = new Set<LifecycleAction>();
  for (const { action } of ACTIONS) {
    if (res[action] != null) allowed.add(action);
  }
  return allowed;
}

export interface EntityStatusControlProps {
  client: MedkitApiClient;
  entityType: LifecycleEntityType;
  entityId: string;
  theme: Theme;
  /** Called whenever the resolved status changes, so a parent (e.g. the tree
   * lamp) can stay in sync after a transition. */
  onStatus?: (status: DisplayStatus) => void;
}

export function EntityStatusControl({
  client,
  entityType,
  entityId,
  theme,
  onStatus,
}: EntityStatusControlProps): ReactElement {
  const c = S.colors(theme);

  const [status, setStatus] = useState<DisplayStatus | null>(null);
  // Transitions the gateway currently accepts (from the status response links).
  // Empty until loaded, so every action stays disabled until readiness is known.
  const [allowedActions, setAllowedActions] = useState<ReadonlySet<LifecycleAction>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<LifecycleAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<LifecycleAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // A 501 from any transition means the gateway has no actuation provider:
  // disable every action gateway-wide (not just for this entity's status).
  const [actuationUnsupported, setActuationUnsupported] = useState(false);

  const mountedRef = useRef(true);
  // Monotonic token so only the latest status fetch updates state - guards both
  // an entity switch and two in-flight reads for the same entity (e.g. the
  // initial load racing a post-transition refresh).
  const loadSeqRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Notify the parent (tree lamp) whenever the resolved status changes. Via a ref
  // so a changing callback identity doesn't re-fire this effect.
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => {
    if (status != null) onStatusRef.current?.(status);
  }, [status]);

  const loadStatus = useCallback(() => {
    const seq = ++loadSeqRef.current;
    const stale = () => !mountedRef.current || loadSeqRef.current !== seq;
    setStatus(null);
    setAllowedActions(new Set());
    setLoadError(null);
    void client.getEntityStatus(entityType, entityId).then(
      (res) => {
        if (stale()) return;
        if (res === "unavailable") {
          setStatus("unavailable");
          setAllowedActions(new Set());
        } else {
          setStatus(res.status === "ready" || res.status === "notReady" ? res.status : "unknown");
          setAllowedActions(allowedActionsFromResponse(res));
        }
      },
      (err: unknown) => {
        if (stale()) return;
        setStatus("unknown");
        setAllowedActions(new Set());
        setLoadError(err instanceof Error ? err.message : "Failed to load status");
      },
    );
  }, [client, entityType, entityId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Defense in depth: the parent keys this control per entity so it remounts on
  // selection change, but don't rely on that - drop any armed confirmation,
  // pending action, or error when the entity changes so they can't fire on the
  // newly selected entity.
  useEffect(() => {
    setConfirmAction(null);
    setPendingAction(null);
    setActionError(null);
    setActuationUnsupported(false);
  }, [entityType, entityId]);

  const dispatchAction = useCallback(
    async (action: LifecycleAction) => {
      setPendingAction(action);
      setActionError(null);
      try {
        await client.setEntityStatus(entityType, entityId, action);
        if (!mountedRef.current) return;
        // Any success proves the gateway can actuate; clear a stale "unsupported".
        setActuationUnsupported(false);
        loadStatus();
      } catch (err) {
        if (!mountedRef.current) return;
        if (err instanceof MedkitApiError && err.status === 501) {
          // No actuation provider: disable all transitions and note it, rather
          // than showing a hard error.
          setActuationUnsupported(true);
          setActionError("Not implemented by this gateway");
        } else {
          const label = ACTIONS.find((a) => a.action === action)?.label ?? action;
          setActionError(err instanceof Error ? err.message : `${label} failed`);
        }
      } finally {
        if (mountedRef.current) setPendingAction(null);
      }
    },
    [client, entityType, entityId, loadStatus],
  );

  const handleClick = useCallback(
    (cfg: ActionConfig) => {
      // Destructive transitions (shutdown / force-shutdown) confirm first;
      // the rest dispatch immediately.
      if (cfg.destructive) {
        setConfirmAction(cfg.action);
      } else {
        void dispatchAction(cfg.action);
      }
    },
    [dispatchAction],
  );

  const notAvailable = status === "unavailable";

  const isDisabled = (action: LifecycleAction): boolean =>
    notAvailable ||
    actuationUnsupported ||
    pendingAction !== null ||
    confirmAction !== null ||
    !allowedActions.has(action);

  const statusBadge = (() => {
    if (status === "ready") return <span style={S.badge("#fff", c.success)}>ready</span>;
    if (status === "notReady") return <span style={S.badge("#fff", c.warning)}>notReady</span>;
    if (status === "unavailable") {
      return <span style={S.badge(c.textMuted, c.bgAlt)}>not available</span>;
    }
    if (status === null) return <span style={{ fontSize: 11, color: c.textMuted }}>loading...</span>;
    return <span style={S.badge(c.textMuted, c.bgAlt)}>unknown</span>;
  })();

  const confirmLabel =
    confirmAction != null ? (ACTIONS.find((a) => a.action === confirmAction)?.label ?? confirmAction) : "";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "6px 0",
        marginBottom: 8,
        borderBottom: `1px solid ${c.borderLight}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: c.textMuted }}>Lifecycle</span>
        {statusBadge}
        {notAvailable && (
          <span style={{ fontSize: 11, color: c.textMuted }}>
            no lifecycle provider configured
          </span>
        )}
        <span style={{ flex: 1 }} />
        {!notAvailable &&
          ACTIONS.map((cfg) => (
            <button
              key={cfg.action}
              style={{ ...S.btn(theme, cfg.destructive ? "danger" : "ghost"), fontSize: 11, padding: "2px 8px" }}
              disabled={isDisabled(cfg.action)}
              aria-label={`${cfg.label} ${entityId}`}
              onClick={() => handleClick(cfg)}
            >
              {pendingAction === cfg.action ? "..." : cfg.label}
            </button>
          ))}
      </div>

      {confirmAction != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: c.text }}>
            {confirmLabel} {entityId}?
          </span>
          <button
            style={{ ...S.btn(theme, "danger"), fontSize: 11, padding: "2px 8px" }}
            aria-label={`Confirm ${confirmLabel}`}
            onClick={() => {
              const action = confirmAction;
              setConfirmAction(null);
              void dispatchAction(action);
            }}
          >
            Confirm
          </button>
          <button
            style={{ ...S.btn(theme, "ghost"), fontSize: 11, padding: "2px 8px" }}
            aria-label="Cancel"
            onClick={() => setConfirmAction(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {actionError != null && (
        <div style={{ ...S.errorBox(theme), marginTop: 0, marginBottom: 0, fontSize: 11 }}>{actionError}</div>
      )}
      {loadError != null && status === "unknown" && (
        <div style={{ fontSize: 11, color: c.textMuted }}>Could not load status: {loadError}</div>
      )}
    </div>
  );
}
