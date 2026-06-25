// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Shared modal shell for the Updates panel dialogs. The backdrop fills the
// panel; the card grows up to `maxWidth` but shrinks to 100% width on narrow
// panels and scrolls internally on overflow. Owns the dialog role/aria, the
// click-outside-to-close, stopPropagation on the card, and the focus container
// ref (wired by useDialogA11y in the caller).

import { type CSSProperties, type ReactNode, type RefObject } from "react";

import * as S from "./styles";
import type { Theme } from "./styles";

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

function modalCard(theme: Theme, maxWidth: number): CSSProperties {
    const c = S.colors(theme);
    return {
        background: c.bgCard,
        color: c.text,
        padding: 12,
        borderRadius: 6,
        border: `1px solid ${c.border}`,
        width: "100%",
        maxWidth,
        maxHeight: "100%",
        overflow: "auto",
        boxSizing: "border-box",
    };
}

export interface ModalProps {
    theme: Theme;
    ariaLabel: string;
    /** Invoked on backdrop click; the caller decides whether to honor it (e.g.
     * ignore while a submit is in flight). */
    onBackdropClick: () => void;
    dialogRef: RefObject<HTMLDivElement>;
    maxWidth?: number;
    children: ReactNode;
}

export function Modal({
    theme,
    ariaLabel,
    onBackdropClick,
    dialogRef,
    maxWidth = 600,
    children,
}: ModalProps): JSX.Element {
    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            style={modalBackdrop}
            onClick={onBackdropClick}
        >
            <div
                ref={dialogRef}
                tabIndex={-1}
                style={modalCard(theme, maxWidth)}
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
}
