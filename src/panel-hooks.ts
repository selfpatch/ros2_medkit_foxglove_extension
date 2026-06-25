// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Reusable React hooks that every panel in this extension needs:
// - useSharedConnection: state + cross-panel listener for the gateway URL
// - useColorSchemeTheme: Foxglove colorScheme watcher returning Theme
//
// Without these, each panel re-implemented the same boilerplate (~10 lines
// per panel * 3 panels), drifting subtly each time we touched it.

import type {
    Immutable,
    PanelExtensionContext,
    RenderState,
    SettingsTreeAction,
    SettingsTreeFields,
} from "@foxglove/extension";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
    type GatewayConnection,
    loadSharedConnection,
    onSharedConnectionChange,
    saveSharedConnection,
} from "./shared-connection";
import type { Theme } from "./styles";

export interface SharedConnectionApi {
    /** Current resolved connection. */
    conn: GatewayConnection;
    /** Update connection in-process AND broadcast to peer panels + storage. */
    update: (next: GatewayConnection) => void;
}

/**
 * Wires a panel into the cross-panel shared gateway connection.
 *
 * - Initial value resolves: localStorage > overrides > DEFAULT_CONNECTION
 * - Listens for changes from peer panels (same tab) and other tabs/windows
 * - update() persists + broadcasts so peers stay in sync
 */
export function useSharedConnection(overrides?: Partial<GatewayConnection>): SharedConnectionApi {
    const [conn, setConn] = useState<GatewayConnection>(() => loadSharedConnection(overrides));
    useEffect(() => onSharedConnectionChange(setConn), []);
    // Stable identity so consumer effects that list `update` in their
    // dependency array (e.g. the settings-editor effect) do not re-run on
    // every render. setConn covers the no-window/test path where
    // saveSharedConnection dispatches no event.
    const update = useCallback((next: GatewayConnection) => {
        saveSharedConnection(next);
        setConn(next);
    }, []);
    return { conn, update };
}

export interface GatewayConnectionSettingsOptions {
    /** Node label; defaults to "Gateway Connection". */
    label?: string;
    /** Panel-specific fields rendered after Server URL / Base path in the same node. */
    extraFields?: SettingsTreeFields;
    /** Handles "update" actions for keys other than gatewayUrl / basePath. */
    onExtraAction?: (key: string, value: unknown) => void;
}

/**
 * Wires the gateway-connection node into a panel's Foxglove settings editor:
 * the shared Server URL / Base path fields (whose edits flow back through
 * `update`), plus any panel-specific fields composed on top via `options`.
 * Collapses the identical settings-editor boilerplate each panel used to repeat.
 */
export function useGatewayConnectionSettings(
    context: PanelExtensionContext,
    conn: GatewayConnection,
    update: (next: GatewayConnection) => void,
    options?: GatewayConnectionSettingsOptions,
): void {
    const label = options?.label ?? "Gateway Connection";
    const extraFields = options?.extraFields;
    // Keep the extra-action handler current without making it an effect dep
    // (callers pass an inline closure).
    const onExtraActionRef = useRef(options?.onExtraAction);
    onExtraActionRef.current = options?.onExtraAction;
    // Re-register when the rendered extra-field values change (they encode panel
    // state like a poll interval) rather than on every render.
    const extraFieldsKey = extraFields ? JSON.stringify(extraFields) : "";

    useEffect(() => {
        context.updatePanelSettingsEditor({
            actionHandler: (action: SettingsTreeAction) => {
                if (action.action !== "update") return;
                const [section, key] = action.payload.path;
                if (section !== "conn") return;
                if (key === "gatewayUrl") update({ ...conn, gatewayUrl: action.payload.value as string });
                else if (key === "basePath") update({ ...conn, basePath: action.payload.value as string });
                else onExtraActionRef.current?.(key, action.payload.value);
            },
            nodes: {
                conn: {
                    label,
                    fields: {
                        gatewayUrl: { label: "Server URL", input: "string", value: conn.gatewayUrl },
                        basePath: { label: "Base path", input: "string", value: conn.basePath },
                        ...(extraFields ?? {}),
                    },
                },
            },
        });
        // extraFieldsKey stands in for extraFields' content; the closure reads
        // the current extraFields on each (re-)registration.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [context, conn, update, label, extraFieldsKey]);
}

/**
 * Watches Foxglove's color scheme and returns the resolved Theme. Also
 * wires up the renderDone callback the platform expects after every
 * render request.
 */
export function useColorSchemeTheme(context: PanelExtensionContext): Theme {
    const [theme, setTheme] = useState<Theme>("dark");
    const [renderDone, setRenderDone] = useState<(() => void) | undefined>();

    useLayoutEffect(() => {
        context.watch("colorScheme");
        context.onRender = (rs: Immutable<RenderState>, done) => {
            if (rs.colorScheme === "light" || rs.colorScheme === "dark") {
                setTheme(rs.colorScheme);
            }
            setRenderDone(() => done);
        };
        // Clear the handler on unmount / context change so Foxglove cannot
        // fire our captured closure (and setTheme/setRenderDone) after the
        // React tree is gone.
        return () => {
            context.onRender = undefined;
        };
    }, [context]);

    useEffect(() => {
        renderDone?.();
    }, [renderDone]);

    return theme;
}

/**
 * Accessibility wiring for a modal dialog. While `active`:
 * - moves keyboard focus into the dialog (first focusable, else container),
 * - traps Tab / Shift+Tab within the dialog's focusables,
 * - closes on Escape,
 * - restores focus to the previously-focused element on close.
 *
 * Returns a ref to attach to the dialog container. SSR/jsdom-safe: bails out
 * when `document` is unavailable.
 */
export function useDialogA11y(
    active: boolean,
    onClose: () => void,
): RefObject<HTMLDivElement> {
    const ref = useRef<HTMLDivElement>(null);
    // Keep the latest onClose without re-running the effect on every render.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!active || typeof document === "undefined") return;
        const container = ref.current;
        const previouslyFocused = document.activeElement as HTMLElement | null;

        const focusables = (): HTMLElement[] =>
            container
                ? Array.from(
                      container.querySelectorAll<HTMLElement>(
                          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
                      ),
                  )
                : [];

        // Initial focus: first focusable, else the container itself.
        const first = focusables()[0];
        (first ?? container)?.focus();

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (e.key !== "Tab") return;
            const items = focusables();
            if (items.length === 0) {
                e.preventDefault();
                container?.focus();
                return;
            }
            const firstEl = items[0];
            const lastEl = items[items.length - 1];
            const activeEl = document.activeElement;
            if (e.shiftKey && activeEl === firstEl) {
                e.preventDefault();
                lastEl.focus();
            } else if (!e.shiftKey && activeEl === lastEl) {
                e.preventDefault();
                firstEl.focus();
            }
        };

        document.addEventListener("keydown", onKeyDown, true);
        return () => {
            document.removeEventListener("keydown", onKeyDown, true);
            previouslyFocused?.focus?.();
        };
    }, [active]);

    return ref;
}
