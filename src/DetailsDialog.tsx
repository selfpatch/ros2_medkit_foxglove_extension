// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Update-details dialog: shows the lazily-fetched GET /updates/{id} body as
// pretty-printed JSON inside the shared Modal shell.

import { type ReactElement, type RefObject } from "react";

import { Modal } from "./Modal";
import * as S from "./styles";
import type { Theme } from "./styles";

export interface DetailsDialogProps {
    theme: Theme;
    id: string;
    loading: boolean;
    detail?: Record<string, unknown>;
    onClose: () => void;
    dialogRef: RefObject<HTMLDivElement>;
}

export function DetailsDialog({
    theme,
    id,
    loading,
    detail,
    onClose,
    dialogRef,
}: DetailsDialogProps): ReactElement {
    const c = S.colors(theme);
    return (
        <Modal theme={theme} ariaLabel="Update details" onBackdropClick={onClose} dialogRef={dialogRef}>
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
                    title={id}
                    style={{
                        fontFamily: "ui-monospace, monospace",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: "1 1 auto",
                    }}
                >
                    {id}
                </strong>
                <button style={S.btn(theme, "ghost")} onClick={onClose}>
                    Close
                </button>
            </div>
            {loading ? (
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
        </Modal>
    );
}
