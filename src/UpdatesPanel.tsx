// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Foxglove panel for the SOVD /updates resource. Mirrors the structure of
// ros2_medkit_web_ui's UpdatesDashboard so the two clients stay aligned:
// list IDs from /updates, fetch /status per ID, lazy-load details.

import type { PanelExtensionContext } from "@foxglove/extension";
import {
    type CSSProperties,
    type ReactElement,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createRoot } from "react-dom/client";

import {
    UpdatesApiError,
    fetchUpdateIds,
    fetchUpdateStatus,
    fetchUpdateDetail,
    registerUpdate,
    triggerPrepare,
    triggerExecute,
    triggerAutomated,
    deleteUpdate,
    type UpdateStatus,
} from "./updates-api";
import { type GatewayConnection, joinConnection } from "./shared-connection";
import { useColorSchemeTheme, useDialogA11y, useSharedConnection } from "./panel-hooks";
import * as S from "./styles";
import type { Theme } from "./styles";

const IDLE_INTERVAL_MS = 5000;
const ACTIVE_INTERVAL_MS = 2000;

interface UpdateEntry {
    id: string;
    status: UpdateStatus | null;
    // Set when the per-id /status fetch failed for a reason other than the
    // benign "no status yet" 404, so a real error is not shown as "Ready".
    error?: string;
}

function statusColor(status: string | undefined, theme: Theme): string {
    const c = S.colors(theme);
    switch (status) {
        case "pending":
        case "inProgress":
            return c.accent;
        case "completed":
            return c.success;
        case "failed":
            return c.critical;
        default:
            return c.textMuted;
    }
}

// Relative luminance (WCAG) of a #rgb or #rrggbb color.
function luminance(hex: string): number {
    let h = hex.trim().replace(/^#/, "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-f]{6}$/i.test(h)) return 0;
    const int = parseInt(h, 16);
    const chan = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

// Pick black or white text for AA contrast against a status-badge color,
// instead of hardcoding #fff (which fails AA on the green/blue/red badges).
function readableTextOn(bg: string): string {
    return luminance(bg) > 0.179 ? "#000000" : "#ffffff";
}

// Mid-flight: no actions. Otherwise every SOVD action stays on the table,
// but prepare/execute/automated are disabled with a tooltip on terminal
// states (completed/failed) where re-running is a no-op the gateway would
// reject with a 409. Delete is always offered.
function actionsForStatus(status: string | undefined): string[] {
    if (status === "inProgress") return [];
    return ["prepare", "execute", "automated", "delete"];
}

// Tooltip / disabled reason for an action given the current status, or
// undefined when the action is applicable.
function actionDisabledReason(action: string, status: string | undefined): string | undefined {
    if (action === "delete") return undefined;
    if (status === "completed") return "Update already completed - re-running would be rejected by the gateway";
    if (status === "failed") return "Update has failed - re-running would be rejected by the gateway";
    return undefined;
}

const ACTION_LABEL: Record<string, string> = {
    prepare: "Prepare",
    execute: "Execute",
    automated: "Automated",
    delete: "Delete",
};

// Friendly message + 501 detection shared by the action/register handlers
// so a "no UpdateProvider" backend surfaces consistently, not as a raw
// string on some verbs and the dedicated banner on others.
function describeUpdatesError(e: unknown): { message: string; notAvailable: boolean } {
    if (e instanceof UpdatesApiError && e.status === 501) {
        return { message: "The gateway has no UpdateProvider configured (HTTP 501).", notAvailable: true };
    }
    return { message: e instanceof Error ? e.message : String(e), notAvailable: false };
}

// Responsive modal: backdrop fills the panel, card grows up to ~600px but
// shrinks to 100% width on narrow Foxglove panels (no minWidth). Scrolls
// internally if the content overflows.
const modalBackdrop: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: 12,
    zIndex: 100,
    overflow: "auto",
};

function modalCard(theme: Theme): CSSProperties {
    const c = S.colors(theme);
    return {
        background: c.bgCard,
        color: c.text,
        padding: 12,
        borderRadius: 6,
        border: `1px solid ${c.border}`,
        width: "100%",
        maxWidth: 600,
        maxHeight: "100%",
        overflow: "auto",
        boxSizing: "border-box",
    };
}

export interface UpdatesPanelViewProps {
    baseUrl: string;
    pollMs?: number;
    fetchImpl?: typeof fetch;
    theme?: Theme;
}

export function UpdatesPanelView({
    baseUrl,
    pollMs,
    fetchImpl,
    theme = "dark",
}: UpdatesPanelViewProps): JSX.Element {
    const c = S.colors(theme);
    const [entries, setEntries] = useState<UpdateEntry[]>([]);
    const [error, setError] = useState<string | undefined>();
    // Action errors live separately from the poll `error` so a background
    // refresh's success-clear cannot wipe the message before the user reads
    // it; cleared only when the user starts another action.
    const [actionError, setActionError] = useState<string | undefined>();
    const [notAvailable, setNotAvailable] = useState(false);
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
    const [detailFor, setDetailFor] = useState<string | undefined>();
    const [detail, setDetail] = useState<Record<string, unknown> | undefined>();
    const [detailLoading, setDetailLoading] = useState(false);
    const [registerOpen, setRegisterOpen] = useState(false);
    const [registerJson, setRegisterJson] = useState<string>("");
    const [registerError, setRegisterError] = useState<string | undefined>();
    const [registerBusy, setRegisterBusy] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const detailAbortRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            detailAbortRef.current?.abort();
        };
    }, []);
    const fImpl = fetchImpl ?? fetch;

    const refresh = useCallback(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const ids = await fetchUpdateIds(baseUrl, fImpl, controller.signal);
            if (controller.signal.aborted) return;
            const next: UpdateEntry[] = await Promise.all(
                ids.map(async (id): Promise<UpdateEntry> => {
                    try {
                        const status = await fetchUpdateStatus(baseUrl, id, fImpl, controller.signal);
                        return { id, status };
                    } catch (e) {
                        // 404 = no status until the first operation runs
                        // (benign -> "Ready"); AbortError = this refresh was
                        // superseded and is discarded below. Any other error
                        // (500/network) is carried so it is not masked as
                        // "Ready".
                        if (
                            (e as { name?: string }).name === "AbortError" ||
                            (e instanceof UpdatesApiError && e.status === 404)
                        ) {
                            return { id, status: null };
                        }
                        return { id, status: null, error: e instanceof Error ? e.message : String(e) };
                    }
                }),
            );
            if (controller.signal.aborted) return;
            setEntries(next);
            setError(undefined);
            setNotAvailable(false);
        } catch (e) {
            if ((e as { name?: string }).name === "AbortError") return;
            if (e instanceof UpdatesApiError && e.status === 501) {
                setNotAvailable(true);
                setEntries([]);
                setError(undefined);
            } else {
                setNotAvailable(false);
                setError(e instanceof Error ? e.message : String(e));
            }
        }
    }, [baseUrl, fImpl]);

    // Initial fetch + adaptive polling.
    const hasActive = entries.some(
        (e) => e.status?.status === "inProgress" || e.status?.status === "pending",
    );
    const effectiveInterval = pollMs ?? (hasActive ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);

    useEffect(() => {
        void refresh();
        return () => abortRef.current?.abort();
    }, [refresh]);

    useEffect(() => {
        if (effectiveInterval <= 0) return;
        const handle = window.setInterval(() => void refresh(), effectiveInterval);
        return () => window.clearInterval(handle);
    }, [effectiveInterval, refresh]);

    const runAction = useCallback(
        async (id: string, action: string) => {
            setActionError(undefined);
            setBusyIds((prev) => new Set(prev).add(id));
            try {
                if (action === "prepare") await triggerPrepare(baseUrl, id, undefined, fImpl);
                else if (action === "execute") await triggerExecute(baseUrl, id, undefined, fImpl);
                else if (action === "automated") await triggerAutomated(baseUrl, id, undefined, fImpl);
                else if (action === "delete") await deleteUpdate(baseUrl, id, fImpl);
                await refresh();
            } catch (e) {
                if (!mountedRef.current) return;
                const { message, notAvailable } = describeUpdatesError(e);
                if (notAvailable) {
                    // The dedicated "no UpdateProvider" banner covers this;
                    // don't also show a duplicate red action-error banner.
                    setNotAvailable(true);
                    setActionError(undefined);
                } else {
                    setActionError(message);
                }
            } finally {
                if (mountedRef.current) {
                    setBusyIds((prev) => {
                        const next = new Set(prev);
                        next.delete(id);
                        return next;
                    });
                }
            }
        },
        [baseUrl, fImpl, refresh],
    );

    const openDetail = useCallback(
        async (id: string) => {
            // Cancel a previous in-flight detail fetch so a late response
            // for another id cannot overwrite the current modal.
            detailAbortRef.current?.abort();
            const controller = new AbortController();
            detailAbortRef.current = controller;
            setDetailFor(id);
            setDetail(undefined);
            setDetailLoading(true);
            try {
                const data = await fetchUpdateDetail(baseUrl, id, fImpl, controller.signal);
                if (controller.signal.aborted) return;
                setDetail(data);
            } catch (e) {
                if (controller.signal.aborted || (e as { name?: string }).name === "AbortError") return;
                setDetail({ error: e instanceof Error ? e.message : String(e) });
            } finally {
                if (!controller.signal.aborted) setDetailLoading(false);
            }
        },
        [baseUrl, fImpl],
    );

    const closeDetail = useCallback(() => {
        detailAbortRef.current?.abort();
        setDetailFor(undefined);
        setDetail(undefined);
    }, []);

    const openRegister = useCallback(() => {
        setRegisterError(undefined);
        // Sensible default template - mirrors what pack_artifact.py emits.
        setRegisterJson(
            JSON.stringify(
                {
                    id: "my_update_1_0_0",
                    update_name: "My update 1.0.0",
                    automated: false,
                    origins: ["remote"],
                    notes: "",
                    updated_components: ["target_node"],
                    x_medkit_target_package: "my_package",
                    x_medkit_executable: "my_node",
                    x_medkit_artifact_url: "/artifacts/my_package-1.0.0.tar.gz",
                },
                null,
                2,
            ),
        );
        setRegisterOpen(true);
    }, []);

    const submitRegister = useCallback(async () => {
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(registerJson);
        } catch (e) {
            setRegisterError("Invalid JSON: " + (e instanceof Error ? e.message : String(e)));
            return;
        }
        setRegisterBusy(true);
        setRegisterError(undefined);
        try {
            await registerUpdate(baseUrl, parsed, fImpl);
            if (!mountedRef.current) return;
            setRegisterOpen(false);
            await refresh();
        } catch (e) {
            if (!mountedRef.current) return;
            const { message, notAvailable } = describeUpdatesError(e);
            if (notAvailable) setNotAvailable(true);
            setRegisterError(message);
        } finally {
            if (mountedRef.current) setRegisterBusy(false);
        }
    }, [baseUrl, fImpl, refresh, registerJson]);

    const registerDialogRef = useDialogA11y(registerOpen, () => {
        if (!registerBusy) setRegisterOpen(false);
    });
    const detailDialogRef = useDialogA11y(detailFor !== undefined, closeDetail);
    const confirmDialogRef = useDialogA11y(confirmDelete !== undefined, () => setConfirmDelete(undefined));

    const sorted = useMemo(() => [...entries].sort((a, b) => a.id.localeCompare(b.id)), [entries]);

    return (
        <div style={S.panelRoot(theme)}>
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 6,
                    marginBottom: 8,
                }}
            >
                <h2 style={{ ...S.heading(theme), margin: 0, minWidth: 0 }}>Updates</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <button style={S.btn(theme, "ghost")} onClick={openRegister}>
                        Register
                    </button>
                    <button style={S.btn(theme, "ghost")} onClick={() => void refresh()}>
                        Refresh
                    </button>
                </div>
            </div>

            {notAvailable && (
                <div
                    style={{
                        color: c.textMuted,
                        padding: 8,
                        border: `1px dashed ${c.border}`,
                        borderRadius: 4,
                        fontSize: 12,
                    }}
                >
                    The gateway has no UpdateProvider configured (HTTP 501).
                </div>
            )}
            {error && (
                <div style={S.errorBox(theme)} role="alert">
                    {error}
                </div>
            )}
            {actionError && (
                <div style={S.errorBox(theme)} role="alert">
                    {actionError}
                </div>
            )}

            {!notAvailable && sorted.length === 0 && !error && (
                <div style={S.emptyState(theme)}>No updates registered.</div>
            )}

            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {sorted.map((entry) => {
                    // A carried error (non-404 /status failure) shows a
                    // distinct "Error" badge so it is not masked as healthy.
                    // Otherwise the gateway returns 404 on /status until the
                    // first operation runs, so "no status" maps to a
                    // friendlier "Ready" badge (== ready to prepare/execute).
                    const hasError = entry.error !== undefined;
                    const statusLabel = hasError ? "Error" : entry.status?.status ?? "Ready";
                    const sColor = hasError
                        ? S.colors(theme).critical
                        : statusColor(entry.status?.status, theme);
                    const actions = actionsForStatus(entry.status?.status);
                    const isBusy = busyIds.has(entry.id);
                    return (
                        <li key={entry.id} style={S.card(theme)}>
                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    gap: 6,
                                }}
                            >
                                <span
                                    title={entry.id}
                                    style={{
                                        fontFamily: "ui-monospace, monospace",
                                        fontSize: 12,
                                        minWidth: 0,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        flex: "1 1 auto",
                                    }}
                                >
                                    {entry.id}
                                </span>
                                <span style={S.badge(readableTextOn(sColor), sColor)} title={entry.error}>
                                    {statusLabel}
                                </span>
                            </div>
                            {entry.status?.progress !== undefined && (
                                <div
                                    role="progressbar"
                                    aria-label={`Progress for ${entry.id}`}
                                    aria-valuenow={entry.status.progress}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuetext={`${Math.min(100, Math.max(0, entry.status.progress))}%`}
                                    style={{
                                        height: 4,
                                        background: c.bgAlt,
                                        borderRadius: 2,
                                        marginTop: 6,
                                        overflow: "hidden",
                                    }}
                                >
                                    <div
                                        style={{
                                            width: `${Math.min(100, Math.max(0, entry.status.progress))}%`,
                                            height: "100%",
                                            background: sColor,
                                        }}
                                    />
                                </div>
                            )}
                            <div
                                style={{
                                    display: "flex",
                                    gap: 6,
                                    marginTop: 8,
                                    flexWrap: "wrap",
                                }}
                            >
                                <button
                                    style={S.btn(theme, "ghost")}
                                    onClick={() => void openDetail(entry.id)}
                                    disabled={isBusy}
                                >
                                    Details
                                </button>
                                {actions.map((action) => {
                                    const reason = actionDisabledReason(action, entry.status?.status);
                                    return (
                                        <button
                                            key={action}
                                            style={S.btn(theme, action === "delete" ? "danger" : "primary")}
                                            disabled={isBusy || reason !== undefined}
                                            title={reason}
                                            onClick={() =>
                                                action === "delete"
                                                    ? setConfirmDelete(entry.id)
                                                    : void runAction(entry.id, action)
                                            }
                                        >
                                            {ACTION_LABEL[action]}
                                        </button>
                                    );
                                })}
                            </div>
                        </li>
                    );
                })}
            </ul>

            {registerOpen && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Register update"
                    style={modalBackdrop}
                    onClick={() => !registerBusy && setRegisterOpen(false)}
                >
                    <div
                        ref={registerDialogRef}
                        tabIndex={-1}
                        style={modalCard(theme)}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 6,
                                justifyContent: "space-between",
                                marginBottom: 8,
                            }}
                        >
                            <strong style={{ minWidth: 0 }}>Register update</strong>
                            <button
                                style={S.btn(theme, "ghost")}
                                onClick={() => setRegisterOpen(false)}
                                disabled={registerBusy}
                            >
                                Close
                            </button>
                        </div>
                        <p style={{ fontSize: 12, color: c.textMuted, margin: "0 0 8px" }}>
                            POST <code>/updates</code> with SOVD ISO 17978-3 metadata. Pick exactly one of
                            <code> updated_components</code>, <code>added_components</code>, <code>removed_components</code>
                            to set the operation kind. <code>x_medkit_*</code> fields are vendor extensions.
                        </p>
                        <textarea
                            value={registerJson}
                            onChange={(e) => setRegisterJson(e.target.value)}
                            disabled={registerBusy}
                            spellCheck={false}
                            aria-label="Update registration JSON"
                            style={{
                                ...S.input(theme),
                                width: "100%",
                                minHeight: 220,
                                fontFamily: "ui-monospace, monospace",
                                resize: "vertical",
                            }}
                        />
                        {registerError && (
                            <div style={S.errorBox(theme)} role="alert">
                                {registerError}
                            </div>
                        )}
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                justifyContent: "flex-end",
                                gap: 6,
                                marginTop: 8,
                            }}
                        >
                            <button
                                style={S.btn(theme, "ghost")}
                                onClick={() => setRegisterOpen(false)}
                                disabled={registerBusy}
                            >
                                Cancel
                            </button>
                            <button
                                style={S.btn(theme, "primary")}
                                onClick={() => void submitRegister()}
                                disabled={registerBusy}
                            >
                                {registerBusy ? "Registering..." : "Register"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {detailFor && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Update details"
                    style={modalBackdrop}
                    onClick={closeDetail}
                >
                    <div
                        ref={detailDialogRef}
                        tabIndex={-1}
                        style={modalCard(theme)}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 6,
                                justifyContent: "space-between",
                                marginBottom: 8,
                            }}
                        >
                            <strong
                                title={detailFor}
                                style={{
                                    fontFamily: "ui-monospace, monospace",
                                    minWidth: 0,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    flex: "1 1 auto",
                                }}
                            >
                                {detailFor}
                            </strong>
                            <button style={S.btn(theme, "ghost")} onClick={closeDetail}>
                                Close
                            </button>
                        </div>
                        {detailLoading ? (
                            <div style={{ color: c.textMuted, fontSize: 12 }}>Loading...</div>
                        ) : (
                            <pre
                                style={{
                                    fontSize: 12,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                    margin: 0,
                                    background: c.bgAlt,
                                    padding: 8,
                                    borderRadius: 4,
                                    color: c.text,
                                }}
                            >
                                {JSON.stringify(detail, null, 2)}
                            </pre>
                        )}
                    </div>
                </div>
            )}

            {confirmDelete !== undefined && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Confirm delete update"
                    style={modalBackdrop}
                    onClick={() => setConfirmDelete(undefined)}
                >
                    <div
                        ref={confirmDialogRef}
                        tabIndex={-1}
                        style={{ ...modalCard(theme), maxWidth: 440 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <strong style={{ display: "block", marginBottom: 8 }}>Delete update</strong>
                        <p style={{ fontSize: 12, color: c.text, margin: "0 0 4px" }}>
                            Permanently remove this update package from the gateway? This cannot be undone.
                        </p>
                        <p
                            title={confirmDelete}
                            style={{
                                fontFamily: "ui-monospace, monospace",
                                fontSize: 12,
                                color: c.textMuted,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                margin: "0 0 8px",
                            }}
                        >
                            {confirmDelete}
                        </p>
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                justifyContent: "flex-end",
                                gap: 6,
                            }}
                        >
                            <button style={S.btn(theme, "ghost")} onClick={() => setConfirmDelete(undefined)}>
                                Cancel
                            </button>
                            <button
                                style={S.btn(theme, "danger")}
                                onClick={() => {
                                    const id = confirmDelete;
                                    setConfirmDelete(undefined);
                                    if (id !== undefined) void runAction(id, "delete");
                                }}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Wrapper that owns the Foxglove panel lifecycle: shared gateway-
// connection settings (synced across all panels in this extension via
// localStorage + a same-tab CustomEvent), state persistence, and the
// colorScheme watcher. Hands the resolved baseUrl to the pure
// UpdatesPanelView (kept testable without a Foxglove runtime).
function UpdatesPanelWrapper({
    context,
}: {
    context: PanelExtensionContext;
}): ReactElement {
    const { conn, update } = useSharedConnection(
        context.initialState as Partial<GatewayConnection>,
    );
    const theme = useColorSchemeTheme(context);

    // Persist via Foxglove for layouts that resume without localStorage
    // (e.g. exported layout files); shared-connection remains the runtime
    // source of truth.
    useEffect(() => {
        context.saveState(conn);
    }, [context, conn]);

    useEffect(() => {
        context.updatePanelSettingsEditor({
            actionHandler: (action) => {
                if (action.action !== "update") return;
                const [section, key] = action.payload.path;
                if (section !== "conn") return;
                const next = { ...conn };
                if (key === "gatewayUrl") next.gatewayUrl = action.payload.value as string;
                else if (key === "basePath") next.basePath = action.payload.value as string;
                else return;
                update(next);
            },
            nodes: {
                conn: {
                    label: "Gateway Connection",
                    fields: {
                        gatewayUrl: { label: "Server URL", input: "string", value: conn.gatewayUrl },
                        basePath: { label: "Base path", input: "string", value: conn.basePath },
                    },
                },
            },
        });
    }, [context, conn, update]);

    return <UpdatesPanelView baseUrl={joinConnection(conn)} theme={theme} />;
}

export function initUpdatesPanel(context: PanelExtensionContext): () => void {
    const root = createRoot(context.panelElement);
    root.render(<UpdatesPanelWrapper context={context} />);
    return () => root.unmount();
}
