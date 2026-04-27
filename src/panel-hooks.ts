// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
//
// Reusable React hooks that every panel in this extension needs:
// - useSharedConnection: state + cross-panel listener for the gateway URL
// - useColorSchemeTheme: Foxglove colorScheme watcher returning Theme
//
// Without these, each panel re-implemented the same boilerplate (~10 lines
// per panel * 3 panels), drifting subtly each time we touched it.

import type { Immutable, PanelExtensionContext, RenderState } from "@foxglove/extension";
import { useEffect, useLayoutEffect, useState } from "react";

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
    return {
        conn,
        update: (next) => {
            saveSharedConnection(next);
            setConn(next);
        },
    };
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
    }, [context]);

    useEffect(() => {
        renderDone?.();
    }, [renderDone]);

    return theme;
}
