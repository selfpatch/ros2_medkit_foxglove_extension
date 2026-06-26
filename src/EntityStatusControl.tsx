// Copyright 2026 bburda. Apache-2.0 license.
//
// Entity lifecycle status control for apps and components (gateway 0.6.0
// lifecycle API). Shows the current readiness as a badge and exposes the five
// transitions (start / restart / force-restart / shutdown / force-shutdown).
//
// Transitions are gated by the readiness the gateway reports (an already-running
// entity can't Start; a stopped one can't Restart/Shutdown), and disabled
// buttons are greyed with a tooltip explaining why. Every transition except
// Start asks for confirmation first. A gateway with no actuation provider answers
// a transition with 501; that surfaces as a toast plus a greyed-out "not
// implemented" state, so the control degrades gracefully. Action results are
// reported via a short-lived in-panel toast (the extension is sandboxed and has
// no global toast library like the web UI).

import { type CSSProperties, type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { type MedkitApiClient } from "./medkit-api";
import { MedkitApiError } from "./gateway-client";
import type { LifecycleAction, LifecycleStatus } from "./types";
import type { LifecycleEntityType } from "./api-dispatch";
import * as S from "./styles";
import type { Theme } from "./styles";

// "unknown" = loaded but an unrecognized status; "unavailable" = 501 on GET (no
// status provider).
type DisplayStatus = LifecycleStatus | "unavailable" | "unknown";

interface ActionConfig {
  action: LifecycleAction;
  label: string;
  /** Destructive transitions use the danger button variant. */
  destructive: boolean;
}

const ACTIONS: ActionConfig[] = [
  { action: "start", label: "Start", destructive: false },
  { action: "restart", label: "Restart", destructive: false },
  { action: "force-restart", label: "Force restart", destructive: false },
  { action: "shutdown", label: "Shutdown", destructive: true },
  { action: "force-shutdown", label: "Force shutdown", destructive: true },
];

// Transitions that don't apply to a given readiness value (disabled + tooltip).
const DISABLED_BY_STATUS: Record<string, ReadonlySet<LifecycleAction>> = {
  ready: new Set<LifecycleAction>(["start"]),
  notReady: new Set<LifecycleAction>(["restart", "shutdown", "force-shutdown"]),
};

// Transitions that get the danger confirm-button variant.
const DESTRUCTIVE_ACTIONS = new Set<LifecycleAction>(["shutdown", "force-shutdown"]);

const TOAST_MS = 5000;
type ToastKind = "success" | "warning" | "error";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<LifecycleAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<LifecycleAction | null>(null);
  // A 501 from any transition means the gateway has no actuation provider:
  // disable every action gateway-wide (not just for this entity's readiness).
  const [actuationUnsupported, setActuationUnsupported] = useState(false);
  const [toast, setToast] = useState<{ kind: ToastKind; msg: string } | null>(null);

  const mountedRef = useRef(true);
  // Monotonic token so only the latest status fetch updates state - guards both
  // an entity switch and two in-flight reads for the same entity.
  const loadSeqRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = useCallback((kind: ToastKind, msg: string) => {
    setToast({ kind, msg });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setToast(null);
    }, TOAST_MS);
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
    setLoadError(null);
    void client.getEntityStatus(entityType, entityId).then(
      (res) => {
        if (stale()) return;
        if (res === "unavailable") {
          setStatus("unavailable");
        } else {
          setStatus(res.status === "ready" || res.status === "notReady" ? res.status : "unknown");
        }
      },
      (err: unknown) => {
        if (stale()) return;
        setStatus("unknown");
        setLoadError(err instanceof Error ? err.message : "Failed to load status");
      },
    );
  }, [client, entityType, entityId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Drop any armed confirmation / pending action / toast / unsupported flag when
  // the entity changes, so they can't carry over to the newly selected entity
  // (the parent also keys this control per entity; this is defense in depth).
  useEffect(() => {
    setConfirmAction(null);
    setPendingAction(null);
    setActuationUnsupported(false);
    setToast(null);
  }, [entityType, entityId]);

  const dispatchAction = useCallback(
    async (action: LifecycleAction) => {
      const label = ACTIONS.find((a) => a.action === action)?.label ?? action;
      setPendingAction(action);
      try {
        await client.setEntityStatus(entityType, entityId, action);
        if (!mountedRef.current) return;
        // Any success proves the gateway can actuate; clear a stale "unsupported".
        setActuationUnsupported(false);
        showToast("success", `${label} requested for ${entityId}`);
        loadStatus();
      } catch (err) {
        if (!mountedRef.current) return;
        if (err instanceof MedkitApiError && err.status === 501) {
          // No actuation provider: a missing capability, not a failed request.
          // Disable every transition gateway-wide and warn (not error).
          setActuationUnsupported(true);
          showToast("warning", `${label} is not implemented by this gateway`);
        } else {
          const msg = err instanceof Error ? err.message : "Unknown error";
          showToast("error", `Failed to ${label.toLowerCase()} ${entityId}: ${msg}`);
        }
      } finally {
        if (mountedRef.current) setPendingAction(null);
      }
    },
    [client, entityType, entityId, loadStatus, showToast],
  );

  const handleClick = useCallback(
    (cfg: ActionConfig) => {
      // Start does not interrupt a running entity, so dispatch immediately.
      // Every other transition interrupts it, so confirm first.
      if (cfg.action === "start") {
        void dispatchAction(cfg.action);
      } else {
        setConfirmAction(cfg.action);
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
    (DISABLED_BY_STATUS[status ?? ""]?.has(action) ?? false);

  // Why a button is disabled, for the title tooltip.
  const disabledReason = (action: LifecycleAction): string => {
    if (notAvailable) return "No lifecycle provider configured";
    if (actuationUnsupported) return "Not implemented by this gateway";
    if (status === "ready" && action === "start") return "Already running";
    if (status === "notReady" && (DISABLED_BY_STATUS.notReady?.has(action) ?? false)) {
      return "Entity is not running";
    }
    return "";
  };

  const statusBadge = (() => {
    if (status === "ready") return <span style={S.badge("#fff", c.success)}>ready</span>;
    if (status === "notReady") return <span style={S.badge("#fff", c.warning)}>notReady</span>;
    if (status === "unavailable") return <span style={S.badge(c.textMuted, c.bgAlt)}>not available</span>;
    if (status === null) return <span style={{ fontSize: 11, color: c.textMuted }}>loading...</span>;
    return <span style={S.badge(c.textMuted, c.bgAlt)}>unknown</span>;
  })();

  const confirmLabel =
    confirmAction != null ? (ACTIONS.find((a) => a.action === confirmAction)?.label ?? confirmAction) : "";

  const toastStyle = (kind: ToastKind): CSSProperties => ({
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 4,
    color: "#fff",
    background: kind === "success" ? c.success : kind === "warning" ? c.warning : c.critical,
  });

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
          <span style={{ fontSize: 11, color: c.textMuted }}>no lifecycle provider configured</span>
        )}
        <span style={{ flex: 1 }} />
        {ACTIONS.map((cfg) => {
          const disabled = isDisabled(cfg.action);
          const reason = disabled ? disabledReason(cfg.action) : "";
          return (
            <button
              key={cfg.action}
              style={{
                ...S.btn(theme, cfg.destructive ? "danger" : "ghost", disabled),
                fontSize: 11,
                padding: "2px 8px",
              }}
              disabled={disabled}
              title={reason || undefined}
              aria-label={`${cfg.label} ${entityId}`}
              onClick={() => handleClick(cfg)}
            >
              {pendingAction === cfg.action ? "..." : cfg.label}
            </button>
          );
        })}
      </div>

      {confirmAction != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: c.text }}>
            {confirmLabel} {entityId}? This interrupts the entity and may trigger faults.
          </span>
          <button
            style={{
              ...S.btn(theme, DESTRUCTIVE_ACTIONS.has(confirmAction) ? "danger" : "primary"),
              fontSize: 11,
              padding: "2px 8px",
            }}
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

      {actuationUnsupported && (
        <span style={{ fontSize: 11, color: c.textMuted }}>
          Transitions not implemented by this gateway (yet)
        </span>
      )}

      {toast != null && (
        <div role={toast.kind === "error" ? "alert" : "status"} style={toastStyle(toast.kind)}>
          {toast.msg}
        </div>
      )}

      {loadError != null && status === "unknown" && (
        <div style={{ fontSize: 11, color: c.textMuted }}>Could not load status: {loadError}</div>
      )}
    </div>
  );
}
