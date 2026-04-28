// Copyright 2024-2026 Selfpatch GmbH. Apache-2.0 license.
//
// Same-window event bus for panels in this extension to notify each
// other about side-effects that change global state - currently just
// "the gateway entity graph likely changed" (raised after an OTA
// execute / automated trigger so EntityBrowser can refresh its tree
// without the user clicking Reconnect).
//
// Mirrors the CustomEvent + window.addEventListener pattern used by
// shared-connection.ts. localStorage isn't involved here because these
// events are transient signals, not persisted state.

const ENTITY_GRAPH_EVENT = "selfpatch:entity-graph-changed";

/** Broadcast that the SOVD entity graph likely changed (e.g. after an OTA swap). */
export function notifyEntityGraphChanged(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(ENTITY_GRAPH_EVENT));
}

/** Subscribe to entity-graph changes. Returns an unsubscribe fn. */
export function onEntityGraphChanged(handler: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    const wrapper = () => handler();
    window.addEventListener(ENTITY_GRAPH_EVENT, wrapper);
    return () => window.removeEventListener(ENTITY_GRAPH_EVENT, wrapper);
}
