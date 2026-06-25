// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Register-update dialog: a JSON editor for the SOVD UpdatePackage metadata
// POSTed to /updates. Validation and submission live in the parent; this is
// the form UI inside the shared Modal shell.

import { type ReactElement, type RefObject } from "react";

import { Modal } from "./Modal";
import * as S from "./styles";
import type { Theme } from "./styles";

export interface RegisterDialogProps {
    theme: Theme;
    json: string;
    onJsonChange: (json: string) => void;
    busy: boolean;
    error?: string;
    onSubmit: () => void;
    onClose: () => void;
    dialogRef: RefObject<HTMLDivElement>;
}

export function RegisterDialog({
    theme,
    json,
    onJsonChange,
    busy,
    error,
    onSubmit,
    onClose,
    dialogRef,
}: RegisterDialogProps): ReactElement {
    const c = S.colors(theme);
    return (
        <Modal
            theme={theme}
            ariaLabel="Register update"
            onBackdropClick={() => !busy && onClose()}
            dialogRef={dialogRef}
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
                <button style={S.btn(theme, "ghost")} onClick={onClose} disabled={busy}>
                    Close
                </button>
            </div>
            <p style={{ fontSize: 12, color: c.textMuted, margin: "0 0 8px" }}>
                POST <code>/updates</code> with SOVD ISO 17978-3 metadata. Pick exactly one of
                <code> updated_components</code>, <code>added_components</code>, <code>removed_components</code>
                to set the operation kind. <code>x_medkit_*</code> fields are vendor extensions.
            </p>
            <textarea
                value={json}
                onChange={(e) => onJsonChange(e.target.value)}
                disabled={busy}
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
            {error && (
                <div style={S.errorBox(theme)} role="alert">
                    {error}
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
                <button style={S.btn(theme, "ghost")} onClick={onClose} disabled={busy}>
                    Cancel
                </button>
                <button style={S.btn(theme, "primary")} onClick={onSubmit} disabled={busy}>
                    {busy ? "Registering..." : "Register"}
                </button>
            </div>
        </Modal>
    );
}
