// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
//
// Foxglove panel for the SOVD /updates resource. Mirrors the structure of
// ros2_medkit_web_ui's UpdatesDashboard so the two clients stay aligned:
// list IDs from /updates, fetch /status per ID, lazy-load details.

import type { PanelExtensionContext } from "@foxglove/extension";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
    UpdatesApiError,
    fetchUpdateIds,
    fetchUpdateStatus,
    fetchUpdateDetail,
    triggerPrepare,
    triggerExecute,
    triggerAutomated,
    deleteUpdate,
    type UpdateStatus,
} from "./updates-api";

const IDLE_INTERVAL_MS = 5000;
const ACTIVE_INTERVAL_MS = 2000;

interface UpdateEntry {
    id: string;
    status: UpdateStatus | null;
}

const STATUS_COLOR: Record<string, string> = {
    pending: "#3b82f6",
    inProgress: "#3b82f6",
    completed: "#22c55e",
    failed: "#ef4444",
};

// Mirrors web UI's actionButtonsForStatus.
function actionsForStatus(status: string | undefined): string[] {
    switch (status) {
        case "pending":
            return ["prepare", "execute", "automated", "delete"];
        case "inProgress":
            return [];
        case "completed":
            return ["delete"];
        case "failed":
            return ["prepare", "execute", "delete"];
        default:
            // Pre-prepare state: gateway returns 404 on /status. Show
            // automated as the bootstrap action.
            return ["automated", "delete"];
    }
}

const ACTION_LABEL: Record<string, string> = {
    prepare: "Prepare",
    execute: "Execute",
    automated: "Automated",
    delete: "Delete",
};

export interface UpdatesPanelViewProps {
    baseUrl: string;
    pollMs?: number;
    fetchImpl?: typeof fetch;
}

export function UpdatesPanelView({ baseUrl, pollMs, fetchImpl }: UpdatesPanelViewProps): JSX.Element {
    const [entries, setEntries] = useState<UpdateEntry[]>([]);
    const [error, setError] = useState<string | undefined>();
    const [notAvailable, setNotAvailable] = useState(false);
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    const [detailFor, setDetailFor] = useState<string | undefined>();
    const [detail, setDetail] = useState<Record<string, unknown> | undefined>();
    const [detailLoading, setDetailLoading] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const fImpl = fetchImpl ?? fetch;

    const refresh = useCallback(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const ids = await fetchUpdateIds(baseUrl, fImpl, controller.signal);
            if (controller.signal.aborted) return;
            const next: UpdateEntry[] = await Promise.all(
                ids.map(async (id) => {
                    try {
                        const status = await fetchUpdateStatus(baseUrl, id, fImpl, controller.signal);
                        return { id, status };
                    } catch {
                        return { id, status: null };
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
            setBusyIds((prev) => new Set(prev).add(id));
            try {
                if (action === "prepare") await triggerPrepare(baseUrl, id, undefined, fImpl);
                else if (action === "execute") await triggerExecute(baseUrl, id, undefined, fImpl);
                else if (action === "automated") await triggerAutomated(baseUrl, id, undefined, fImpl);
                else if (action === "delete") await deleteUpdate(baseUrl, id, fImpl);
                await refresh();
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setBusyIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
            }
        },
        [baseUrl, fImpl, refresh],
    );

    const openDetail = useCallback(
        async (id: string) => {
            setDetailFor(id);
            setDetail(undefined);
            setDetailLoading(true);
            try {
                const data = await fetchUpdateDetail(baseUrl, id, fImpl);
                setDetail(data);
            } catch (e) {
                setDetail({ error: e instanceof Error ? e.message : String(e) });
            } finally {
                setDetailLoading(false);
            }
        },
        [baseUrl, fImpl],
    );

    const closeDetail = useCallback(() => {
        setDetailFor(undefined);
        setDetail(undefined);
    }, []);

    const sorted = useMemo(() => [...entries].sort((a, b) => a.id.localeCompare(b.id)), [entries]);

    return (
        <div style={{ padding: 12, fontFamily: "system-ui", color: "#e5e7eb", height: "100%", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>Updates</h2>
                <button onClick={() => void refresh()}>Refresh</button>
            </div>

            {notAvailable && (
                <div style={{ color: "#9ca3af", padding: 8, border: "1px dashed #374151", borderRadius: 4 }}>
                    The gateway has no UpdateProvider configured (HTTP 501).
                </div>
            )}
            {error && (
                <div style={{ color: "#ef4444", marginBottom: 8 }} role="alert">
                    {error}
                </div>
            )}

            {!notAvailable && sorted.length === 0 && !error && (
                <div style={{ color: "#9ca3af" }}>No updates registered.</div>
            )}

            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {sorted.map((entry) => {
                    const statusLabel = entry.status?.status ?? "no status";
                    const color = STATUS_COLOR[entry.status?.status ?? ""] ?? "#6b7280";
                    const actions = actionsForStatus(entry.status?.status);
                    const isBusy = busyIds.has(entry.id);
                    return (
                        <li
                            key={entry.id}
                            style={{
                                border: "1px solid #374151",
                                borderRadius: 4,
                                padding: 8,
                                marginBottom: 8,
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontFamily: "monospace" }}>{entry.id}</span>
                                <span
                                    style={{
                                        background: color,
                                        color: "white",
                                        padding: "2px 6px",
                                        borderRadius: 4,
                                        fontSize: 12,
                                    }}
                                >
                                    {statusLabel}
                                </span>
                            </div>
                            {entry.status?.progress !== undefined && (
                                <div
                                    role="progressbar"
                                    aria-valuenow={entry.status.progress}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    style={{
                                        height: 4,
                                        background: "#1f2937",
                                        borderRadius: 2,
                                        marginTop: 6,
                                        overflow: "hidden",
                                    }}
                                >
                                    <div
                                        style={{
                                            width: `${Math.min(100, Math.max(0, entry.status.progress))}%`,
                                            height: "100%",
                                            background: color,
                                        }}
                                    />
                                </div>
                            )}
                            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                                <button onClick={() => void openDetail(entry.id)} disabled={isBusy}>
                                    Details
                                </button>
                                {actions.map((action) => (
                                    <button
                                        key={action}
                                        disabled={isBusy}
                                        onClick={() => void runAction(entry.id, action)}
                                    >
                                        {ACTION_LABEL[action]}
                                    </button>
                                ))}
                            </div>
                        </li>
                    );
                })}
            </ul>

            {detailFor && (
                <div
                    role="dialog"
                    aria-label="Update details"
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.5)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 100,
                    }}
                    onClick={closeDetail}
                >
                    <div
                        style={{
                            background: "#1f2937",
                            color: "#e5e7eb",
                            padding: 16,
                            borderRadius: 8,
                            minWidth: 480,
                            maxWidth: "90%",
                            maxHeight: "80%",
                            overflow: "auto",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                            <strong style={{ fontFamily: "monospace" }}>{detailFor}</strong>
                            <button onClick={closeDetail}>Close</button>
                        </div>
                        {detailLoading ? (
                            <div>Loading...</div>
                        ) : (
                            <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                                {JSON.stringify(detail, null, 2)}
                            </pre>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export function initUpdatesPanel(context: PanelExtensionContext): () => void {
    const baseUrl =
        (context.initialState as { baseUrl?: string } | undefined)?.baseUrl ??
        "http://localhost:8080/api/v1";
    const root = createRoot(context.panelElement);
    root.render(<UpdatesPanelView baseUrl={baseUrl} />);
    return () => root.unmount();
}
