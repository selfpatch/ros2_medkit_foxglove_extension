// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// One row in the Updates list: the update id, its status badge, an optional
// progress bar, and the per-status action buttons. Pure presentation - Details
// and the SOVD actions are delegated to the parent via callbacks.

import { type ReactElement } from "react";

import type { UpdateStatus } from "./updates-api";
import * as S from "./styles";
import type { Theme } from "./styles";

export interface UpdateEntry {
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
export function actionsForStatus(status: string | undefined): string[] {
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
    automated: "Prepare & execute",
    delete: "Delete",
};

export interface UpdateRowProps {
    entry: UpdateEntry;
    theme: Theme;
    busy: boolean;
    onDetail: (id: string) => void;
    /** Invoked for every action button; the parent routes confirm vs. run. */
    onAction: (id: string, action: string) => void;
}

export function UpdateRow({ entry, theme, busy, onDetail, onAction }: UpdateRowProps): ReactElement {
    const c = S.colors(theme);
    // A carried error (non-404 /status failure) shows a distinct "Error" badge
    // so it is not masked as healthy. Otherwise the gateway returns 404 on
    // /status until the first operation runs, so "no status" maps to a
    // friendlier "Ready" badge (== ready to prepare/execute).
    const hasError = entry.error !== undefined;
    const statusLabel = hasError ? "Error" : entry.status?.status ?? "Ready";
    const sColor = hasError ? c.critical : statusColor(entry.status?.status, theme);
    const actions = actionsForStatus(entry.status?.status);

    return (
        <li style={S.card(theme)}>
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
                <button style={S.btn(theme, "ghost")} onClick={() => onDetail(entry.id)} disabled={busy}>
                    Details
                </button>
                {actions.map((action) => {
                    const reason = actionDisabledReason(action, entry.status?.status);
                    return (
                        <button
                            key={action}
                            style={S.btn(theme, action === "delete" ? "danger" : "primary")}
                            disabled={busy || reason !== undefined}
                            title={reason}
                            onClick={() => onAction(entry.id, action)}
                        >
                            {ACTION_LABEL[action]}
                        </button>
                    );
                })}
            </div>
        </li>
    );
}
