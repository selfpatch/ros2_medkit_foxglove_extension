// Copyright 2024-2026 bburda. Apache-2.0 license.
//
// Foxglove panel showing the gateway root overview (GET /): server name,
// version, supported capability badges, and API entry points.
// Mirrors the three-section layout of ros2_medkit_web_ui's ServerInfoPanel.

import type { PanelExtensionContext } from "@foxglove/extension";
import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { MedkitApiClient } from "./medkit-api";
import type { RootCapabilities, RootOverview, VersionInfo } from "./types";
import { type GatewayConnection, joinConnection } from "./shared-connection";
import { useColorSchemeTheme, useSharedConnection } from "./panel-hooks";
import * as S from "./styles";
import type { Theme } from "./styles";

// ---------------------------------------------------------------------------
// Capability key -> human-readable label
// ---------------------------------------------------------------------------

const CAPABILITY_LABELS: Record<keyof RootCapabilities, string> = {
    aggregation: "Aggregation",
    async_actions: "Async Actions",
    authentication: "Authentication",
    bulk_data: "Bulk Data",
    configurations: "Configurations",
    cyclic_subscriptions: "Cyclic Subscriptions",
    data_access: "Data Access",
    discovery: "Discovery",
    faults: "Faults",
    locking: "Locking",
    logs: "Logs",
    operations: "Operations",
    scripts: "Scripts",
    tls: "TLS",
    triggers: "Triggers",
    updates: "Updates",
    vendor_extensions: "Vendor Extensions",
};

const CAP_KEYS = Object.keys(CAPABILITY_LABELS) as Array<keyof RootCapabilities>;

// ---------------------------------------------------------------------------
// Pure view (testable without Foxglove runtime)
// ---------------------------------------------------------------------------

export interface ServerInfoPanelViewProps {
    baseUrl: string;
    theme?: Theme;
    fetchImpl?: typeof fetch;
}

export function ServerInfoPanelView({
    baseUrl,
    theme = "dark",
    fetchImpl,
}: ServerInfoPanelViewProps): JSX.Element {
    const c = S.colors(theme);
    const [overview, setOverview] = useState<RootOverview | undefined>();
    const [versionInfo, setVersionInfo] = useState<VersionInfo | undefined>();
    const [error, setError] = useState<string | undefined>();
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        setLoading(true);
        setError(undefined);
        setOverview(undefined);
        setVersionInfo(undefined);

        // Abort the in-flight root fetch when baseUrl changes (or on unmount)
        // so a stale response from a previous URL cannot land after a newer one.
        const ac = new AbortController();

        // Pass fetchImpl into the client so the typed openapi-fetch client
        // uses the injected fetch (useful for tests).
        const client = new MedkitApiClient(baseUrl, "", fetchImpl);

        void Promise.all([
            client.getRoot(ac.signal),
            client.getVersionInfo().catch(() => undefined),
        ])
            .then(([root, vi]) => {
                if (ac.signal.aborted || !mountedRef.current) return;
                setOverview(root);
                setVersionInfo(vi);
                setLoading(false);
            })
            .catch((e: unknown) => {
                // A deliberate abort surfaces as a rejection here; ignore it so
                // the panel does not flash an error on a superseded fetch.
                if (ac.signal.aborted || !mountedRef.current) return;
                setError(e instanceof Error ? e.message : String(e));
                setLoading(false);
            });

        return () => {
            ac.abort();
        };
    }, [baseUrl, fetchImpl]);

    if (loading) {
        return (
            <div style={S.panelRoot(theme)}>
                <div style={{ color: c.textMuted, fontSize: 12 }}>Loading server info...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={S.panelRoot(theme)}>
                <h2 style={{ ...S.heading(theme), marginBottom: 8 }}>Server Info</h2>
                <div style={S.errorBox(theme)} role="alert">
                    {error}
                </div>
            </div>
        );
    }

    if (!overview) {
        return (
            <div style={S.panelRoot(theme)}>
                <div style={{ color: c.textMuted, fontSize: 12 }}>No data.</div>
            </div>
        );
    }

    const enabledCaps = CAP_KEYS.filter((k) => overview.capabilities[k]);
    const sovdInfo = versionInfo?.items?.[0];

    return (
        <div style={S.panelRoot(theme)}>
            {/* ---- Section 1: Server Overview ---- */}
            <section aria-labelledby="si-overview-hd">
                <h2 id="si-overview-hd" style={{ ...S.heading(theme), marginBottom: 8 }}>
                    Server Overview
                </h2>
                <div style={S.card(theme)}>
                    <OverviewRow label="Name" value={overview.name} theme={theme} mono={false} />
                    <OverviewRow label="Version" value={overview.version} theme={theme} mono />
                    <OverviewRow label="API Base" value={overview.api_base} theme={theme} mono />
                    {sovdInfo?.version != null && (
                        <OverviewRow label="SOVD Version" value={sovdInfo.version} theme={theme} mono />
                    )}
                    {sovdInfo?.base_uri != null && (
                        <OverviewRow label="Base URI" value={sovdInfo.base_uri} theme={theme} mono />
                    )}
                    {overview.auth?.enabled === true && (
                        <OverviewRow label="Auth" value={overview.auth.algorithm} theme={theme} mono={false} />
                    )}
                    {overview.tls?.enabled === true && (
                        <OverviewRow label="TLS Min" value={overview.tls.min_version} theme={theme} mono={false} />
                    )}
                </div>
            </section>

            {/* ---- Section 2: Supported Features ---- */}
            <section aria-labelledby="si-caps-hd" style={{ marginTop: 16 }}>
                <h2 id="si-caps-hd" style={{ ...S.heading(theme), marginBottom: 8 }}>
                    Supported Features
                </h2>
                {enabledCaps.length === 0 ? (
                    <div style={{ color: c.textMuted, fontSize: 12 }}>No capabilities reported.</div>
                ) : (
                    <div
                        role="list"
                        aria-label="Supported Features"
                        style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                    >
                        {enabledCaps.map((k) => (
                            <span key={k} role="listitem" style={capBadgeStyle(theme)}>
                                {CAPABILITY_LABELS[k]}
                            </span>
                        ))}
                    </div>
                )}
            </section>

            {/* ---- Section 3: API Entry Points ---- */}
            <section aria-labelledby="si-ep-hd" style={{ marginTop: 16 }}>
                <h2 id="si-ep-hd" style={{ ...S.heading(theme), marginBottom: 8 }}>
                    API Entry Points
                </h2>
                {overview.endpoints.length === 0 ? (
                    <div style={{ color: c.textMuted, fontSize: 12 }}>No entry points reported.</div>
                ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                        {overview.endpoints.map((ep) => (
                            <li
                                key={ep}
                                style={{
                                    fontFamily: "ui-monospace, monospace",
                                    fontSize: 12,
                                    padding: "3px 0",
                                    borderBottom: `1px solid ${c.borderLight}`,
                                    color: c.text,
                                    wordBreak: "break-all",
                                }}
                            >
                                {ep}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function OverviewRow({
    label,
    value,
    theme,
    mono,
}: {
    label: string;
    value: string;
    theme: Theme;
    mono: boolean;
}): JSX.Element {
    const c = S.colors(theme);
    return (
        <div style={{ display: "flex", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ color: c.textMuted, fontSize: 12, minWidth: 80 }}>{label}</span>
            <span
                style={{
                    fontSize: 12,
                    fontFamily: mono ? "ui-monospace, monospace" : undefined,
                    color: c.text,
                    wordBreak: "break-all",
                }}
            >
                {value}
            </span>
        </div>
    );
}

function capBadgeStyle(theme: Theme): CSSProperties {
    const c = S.colors(theme);
    return {
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        color: "#fff",
        background: c.accent,
        lineHeight: "18px",
    };
}

// ---------------------------------------------------------------------------
// Wrapper (Foxglove lifecycle)
// ---------------------------------------------------------------------------

function ServerInfoPanelWrapper({
    context,
}: {
    context: PanelExtensionContext;
}): ReactElement {
    const { conn, update } = useSharedConnection(
        context.initialState as Partial<GatewayConnection>,
    );
    const theme = useColorSchemeTheme(context);

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

    return <ServerInfoPanelView baseUrl={joinConnection(conn)} theme={theme} />;
}

// ---------------------------------------------------------------------------
// Panel init
// ---------------------------------------------------------------------------

export function initServerInfoPanel(context: PanelExtensionContext): () => void {
    const root = createRoot(context.panelElement);
    root.render(<ServerInfoPanelWrapper context={context} />);
    return () => root.unmount();
}
