// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
//
// Single source of truth for the gateway connection used by every panel
// in this extension. Without this, every panel had its own gatewayUrl /
// basePath fields and the user had to enter them three times. Backed by
// localStorage so the value survives Foxglove restarts; broadcasts a
// custom event so panels mounted in the same window stay in sync when
// any one of them changes the value.

const KEY_GATEWAY_URL = "selfpatch.gatewayUrl";
const KEY_BASE_PATH = "selfpatch.basePath";
const CHANGE_EVENT = "selfpatch:gateway-connection-change";

export interface GatewayConnection {
    gatewayUrl: string;
    basePath: string;
}

export const DEFAULT_CONNECTION: GatewayConnection = {
    gatewayUrl: "http://localhost:8080",
    basePath: "api/v1",
};

function readStorage(): Partial<GatewayConnection> {
    if (typeof localStorage === "undefined") return {};
    return {
        gatewayUrl: localStorage.getItem(KEY_GATEWAY_URL) ?? undefined,
        basePath: localStorage.getItem(KEY_BASE_PATH) ?? undefined,
    };
}

/** Resolve the active connection. Precedence: localStorage > overrides > defaults. */
export function loadSharedConnection(overrides: Partial<GatewayConnection> = {}): GatewayConnection {
    const stored = readStorage();
    return {
        gatewayUrl: stored.gatewayUrl ?? overrides.gatewayUrl ?? DEFAULT_CONNECTION.gatewayUrl,
        basePath: stored.basePath ?? overrides.basePath ?? DEFAULT_CONNECTION.basePath,
    };
}

/** Persist connection settings and notify other panels in the same window. */
export function saveSharedConnection(conn: GatewayConnection): void {
    if (typeof localStorage !== "undefined") {
        localStorage.setItem(KEY_GATEWAY_URL, conn.gatewayUrl);
        localStorage.setItem(KEY_BASE_PATH, conn.basePath);
    }
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent<GatewayConnection>(CHANGE_EVENT, { detail: conn }));
    }
}

/** Subscribe to connection changes from any panel. Returns an unsubscribe fn. */
export function onSharedConnectionChange(handler: (conn: GatewayConnection) => void): () => void {
    if (typeof window === "undefined") return () => {};
    const sameTab = (e: Event) => {
        const detail = (e as CustomEvent<GatewayConnection>).detail;
        if (detail) handler(detail);
    };
    const crossTab = (e: StorageEvent) => {
        if (e.key !== KEY_GATEWAY_URL && e.key !== KEY_BASE_PATH) return;
        handler(loadSharedConnection());
    };
    window.addEventListener(CHANGE_EVENT, sameTab);
    window.addEventListener("storage", crossTab);
    return () => {
        window.removeEventListener(CHANGE_EVENT, sameTab);
        window.removeEventListener("storage", crossTab);
    };
}

/** Compose the full base URL the SOVD client expects (e.g. http://gw:8080/api/v1). */
export function joinConnection(conn: GatewayConnection): string {
    const url = conn.gatewayUrl.replace(/\/$/, "");
    const path = conn.basePath.replace(/^\/|\/$/g, "");
    return path ? `${url}/${path}` : url;
}
