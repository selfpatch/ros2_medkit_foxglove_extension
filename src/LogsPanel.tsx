// Copyright 2026 bburda. Apache-2.0 license.
//
// LogsPanel: query an entity's logs with severity filter + context search,
// expandable rows (context.function / context.file:line + full ISO timestamp),
// aggregation header from x-medkit metadata, display cap (200 rows) with
// show-all overflow control, 404/503 no-LogManager fallback, manual Refresh.
//
// Filter approach: server-side params (severity + context) via listEntityLogs,
// plus client-side message search applied to the returned result set. This
// matches the web_ui approach: the severity + context filters are sent as query
// params to the gateway; message text search is local because the gateway
// does not expose a message-content filter.
//
// Auto-refresh / visibility-pause is T3. Only a manual Refresh button here.

import { type ReactElement, Fragment, useCallback, useEffect, useState } from "react";

import { type MedkitApiClient } from "./medkit-api";
import { MedkitApiError } from "./gateway-client";
import type { LogEntry, LogListXMedkit, LogSeverity, SovdResourceEntityType } from "./types";
import * as S from "./styles";
import type { Theme } from "./styles";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISPLAY_CAP = 200;
const SEVERITY_LEVELS: LogSeverity[] = ["debug", "info", "warning", "error", "fatal"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO 8601 timestamp as HH:MM:SS.sss (UTC).
 * Nanosecond-precision gateway timestamps are truncated to 3 fractional digits
 * before Date parsing to avoid cross-engine precision issues.
 */
function formatTime(iso: string): string {
  const normalized = iso.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:?\d{2})/, "$1$2");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "--:--:--.---";
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LogsPanelProps {
  client: MedkitApiClient;
  entityType: SovdResourceEntityType;
  entityId: string;
  theme: Theme;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LogsPanel({ client, entityType, entityId, theme }: LogsPanelProps): ReactElement {
  const c = S.colors(theme);

  // ── Fetch state ──────────────────────────────────────────────────
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [aggregation, setAggregation] = useState<LogListXMedkit | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  /** null = loaded OK; 404/503 = no LogManager */
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [lastRefreshFailed, setLastRefreshFailed] = useState(false);

  // ── Filter state ─────────────────────────────────────────────────
  const [severity, setSeverity] = useState<LogSeverity>("debug");
  const [contextDraft, setContextDraft] = useState("");
  const [contextFilter, setContextFilter] = useState("");
  const [messageSearch, setMessageSearch] = useState("");

  // ── Expand state ─────────────────────────────────────────────────
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // ── Display cap ──────────────────────────────────────────────────
  const [showAll, setShowAll] = useState(false);

  // ── Config panel ─────────────────────────────────────────────────
  const [configOpen, setConfigOpen] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSeverity, setConfigSeverity] = useState<LogSeverity>("debug");
  const [configMaxEntries, setConfigMaxEntries] = useState(100);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | undefined>(undefined);

  // ── Debounce context filter ──────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => setContextFilter(contextDraft), 300);
    return () => clearTimeout(id);
  }, [contextDraft]);

  // ── Reset on entity change ───────────────────────────────────────
  useEffect(() => {
    setEntries([]);
    setAggregation(undefined);
    setIsLoading(true);
    setErrorStatus(null);
    setLastRefreshFailed(false);
    setSeverity("debug");
    setContextDraft("");
    setContextFilter("");
    setMessageSearch("");
    setExpandedIds(new Set());
    setShowAll(false);
    setConfigOpen(false);
    setConfigLoaded(false);
    setConfigLoading(false);
    setConfigSeverity("debug");
    setConfigMaxEntries(100);
    setConfigSaving(false);
    setConfigError(undefined);
  }, [entityId, entityType]);

  // ── Fetch ────────────────────────────────────────────────────────
  const doFetch = useCallback(async () => {
    setIsLoading(true);
    setLastRefreshFailed(false);
    try {
      const params: { severity?: LogSeverity; context?: string } = {};
      if (severity !== "debug") params.severity = severity;
      if (contextFilter) params.context = contextFilter;
      const result = await client.listEntityLogs(entityType, entityId, params);
      setEntries(result.items);
      setAggregation(result["x-medkit"]);
      setErrorStatus(null);
      setShowAll(false);
    } catch (err) {
      if (err instanceof MedkitApiError && (err.status === 404 || err.status === 503)) {
        setErrorStatus(err.status);
        setEntries([]);
        setAggregation(undefined);
      } else {
        setLastRefreshFailed(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [client, entityType, entityId, severity, contextFilter]);

  // Initial load + re-fetch when entity/filters change.
  useEffect(() => {
    void doFetch();
  }, [doFetch]);

  // ── Row expand toggle ────────────────────────────────────────────
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Config helpers ───────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(undefined);
    try {
      const cfg = await client.getLogsConfiguration(entityType, entityId);
      setConfigSeverity((cfg.severity_filter as LogSeverity) ?? "debug");
      setConfigMaxEntries(cfg.max_entries ?? 100);
      setConfigLoaded(true);
    } catch {
      setConfigError("Failed to load configuration");
    } finally {
      setConfigLoading(false);
    }
  }, [client, entityType, entityId]);

  const handleConfigSave = useCallback(async () => {
    if (configMaxEntries < 1 || configMaxEntries > 10000) return;
    setConfigSaving(true);
    try {
      await client.updateLogsConfiguration(entityType, entityId, {
        severity_filter: configSeverity,
        max_entries: configMaxEntries,
      });
      setConfigOpen(false);
      void doFetch();
    } catch {
      setConfigError("Failed to save configuration");
    } finally {
      setConfigSaving(false);
    }
  }, [client, entityType, entityId, configSeverity, configMaxEntries, doFetch]);

  const toggleConfig = useCallback(async () => {
    const next = !configOpen;
    setConfigOpen(next);
    if (next && !configLoaded) {
      await loadConfig();
    }
  }, [configOpen, configLoaded, loadConfig]);

  // ── Derived display data ─────────────────────────────────────────
  const trimmedSearch = messageSearch.trim().toLowerCase();
  const filtered = trimmedSearch
    ? entries.filter((e) => e.message.toLowerCase().includes(trimmedSearch))
    : entries;
  const isCapped = !showAll && filtered.length > DISPLAY_CAP;
  const displayed = isCapped ? filtered.slice(0, DISPLAY_CAP) : filtered;

  const configValid = configMaxEntries >= 1 && configMaxEntries <= 10000;

  // ── Toolbar ──────────────────────────────────────────────────────
  const toolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
        <span style={{ color: c.textMuted }}>Severity:</span>
        <select
          aria-label="severity"
          style={{ ...S.input(theme), width: "auto", padding: "2px 6px" }}
          value={severity}
          onChange={(e) => setSeverity(e.target.value as LogSeverity)}
        >
          {SEVERITY_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>{lvl}</option>
          ))}
        </select>
      </label>
      <input
        type="text"
        placeholder="Context filter"
        aria-label="context filter"
        style={{ ...S.input(theme), width: 140 }}
        value={contextDraft}
        onChange={(e) => setContextDraft(e.target.value)}
      />
      <input
        type="text"
        placeholder="Search messages"
        aria-label="message search"
        style={{ ...S.input(theme), width: 160 }}
        value={messageSearch}
        onChange={(e) => setMessageSearch(e.target.value)}
      />
      <button
        style={S.btn(theme, "ghost")}
        onClick={() => void doFetch()}
        aria-label="Refresh"
        title="Refresh"
      >
        ↻ Refresh
      </button>
      <button
        style={S.btn(theme, "ghost")}
        onClick={() => void toggleConfig()}
        aria-label="Settings"
        title="Log configuration"
      >
        ⚙
      </button>
      {lastRefreshFailed && (
        <span style={{ fontSize: 11, color: c.critical }}>Last refresh failed</span>
      )}
    </div>
  );

  // ── Config panel ─────────────────────────────────────────────────
  const configPanel = configOpen && (
    <div
      style={{
        border: `1px solid ${c.border}`,
        borderRadius: 4,
        padding: 10,
        marginBottom: 8,
        background: c.bgAlt,
      }}
    >
      {configLoading ? (
        <span style={{ fontSize: 12, color: c.textMuted }}>Loading configuration...</span>
      ) : configError ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: c.critical }}>{configError}</span>
          <button style={S.btn(theme, "ghost")} onClick={() => void loadConfig()}>Retry</button>
        </div>
      ) : !configLoaded ? (
        <span style={{ fontSize: 12, color: c.textMuted }}>Configuration not loaded</span>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
            <span style={{ color: c.textMuted }}>Saved severity:</span>
            <select
              aria-label="saved severity"
              style={{ ...S.input(theme), width: "auto", padding: "2px 6px" }}
              value={configSeverity}
              onChange={(e) => setConfigSeverity(e.target.value as LogSeverity)}
            >
              {SEVERITY_LEVELS.map((lvl) => (
                <option key={lvl} value={lvl}>{lvl}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
            <span style={{ color: c.textMuted }}>Max entries:</span>
            <input
              type="number"
              aria-label="max entries"
              style={{ ...S.input(theme), width: 80 }}
              value={configMaxEntries}
              min={1}
              max={10000}
              onChange={(e) => setConfigMaxEntries(Number(e.target.value))}
            />
          </label>
          <button
            style={S.btn(theme)}
            disabled={!configValid || configSaving}
            onClick={() => void handleConfigSave()}
          >
            Save
          </button>
          {!configValid && (
            <span style={{ fontSize: 11, color: c.critical }}>max_entries must be 1..10000</span>
          )}
        </div>
      )}
    </div>
  );

  // ── Body ─────────────────────────────────────────────────────────
  let body: ReactElement;

  if (isLoading) {
    body = (
      <div style={{ ...S.emptyState(theme) }} role="status" aria-label="Loading logs">
        Loading logs...
      </div>
    );
  } else if (errorStatus === 404 || errorStatus === 503) {
    const msg =
      errorStatus === 503
        ? "Logs not available on this gateway (no LogManager configured)"
        : "Logs not available for this entity (no LogManager configured)";
    body = (
      <div style={{ ...S.emptyState(theme) }}>
        <div style={{ marginBottom: 8 }}>{msg}</div>
        <button style={S.btn(theme, "ghost")} onClick={() => void doFetch()}>Retry</button>
      </div>
    );
  } else if (displayed.length === 0) {
    body = (
      <div style={S.emptyState(theme)}>
        No log entries
        {trimmedSearch || contextFilter || severity !== "debug"
          ? " - try a lower severity or different filter"
          : ""}
      </div>
    );
  } else {
    body = (
      <div>
        {/* Aggregation header */}
        {aggregation?.aggregation_level && (
          <div
            style={{
              fontSize: 12,
              color: c.textMuted,
              padding: "4px 8px",
              borderBottom: `1px solid ${c.borderLight}`,
              marginBottom: 4,
            }}
            title={aggregation.aggregation_sources?.join("\n")}
            aria-label="aggregation header"
          >
            Aggregated from{" "}
            {aggregation.host_count ?? aggregation.aggregation_sources?.length ?? 0} sources
            {aggregation.aggregation_sources && aggregation.aggregation_sources.length > 0 && (
              <span style={{ color: c.textMuted }}>
                {" "}({aggregation.aggregation_sources.join(", ")})
              </span>
            )}
          </div>
        )}

        <table style={{ ...S.table(theme), tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={{ ...S.th(theme), width: 80 }}>Time</th>
              <th style={{ ...S.th(theme), width: 68 }}>Severity</th>
              <th style={{ ...S.th(theme), width: 140 }}>Node</th>
              <th style={S.th(theme)}>Message</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((entry) => {
              const isExpanded = expandedIds.has(entry.id);
              const sevColor = S.severityColor(entry.severity, theme);
              return (
                <Fragment key={entry.id}>
                  <tr
                    style={{
                      cursor: "pointer",
                      background: isExpanded ? c.bgAlt : "transparent",
                    }}
                    onClick={() => toggleExpand(entry.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleExpand(entry.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                  >
                    <td style={{ ...S.td(theme), fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                      {formatTime(entry.timestamp)}
                    </td>
                    <td style={S.td(theme)}>
                      <span
                        style={{
                          ...S.badge("#fff", sevColor),
                          fontSize: 10,
                          textTransform: "uppercase",
                        }}
                        aria-label={`severity ${entry.severity}`}
                      >
                        {entry.severity}
                      </span>
                    </td>
                    <td
                      style={{
                        ...S.td(theme),
                        fontFamily: "monospace",
                        fontSize: 11,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={entry.context.node}
                    >
                      {entry.context.node}
                    </td>
                    <td
                      style={{
                        ...S.td(theme),
                        fontSize: 12,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={entry.message}
                    >
                      {entry.message}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr style={{ background: c.bgAlt }}>
                      <td
                        colSpan={4}
                        style={{
                          ...S.td(theme),
                          padding: "6px 12px",
                          fontSize: 11,
                          color: c.textMuted,
                        }}
                      >
                        {entry.context.function || entry.context.file ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {entry.context.function && (
                              <div>
                                Function:{" "}
                                <code style={{ fontFamily: "monospace", color: c.accent }}>
                                  {entry.context.function}
                                </code>
                              </div>
                            )}
                            {entry.context.file && (
                              <div>
                                Location:{" "}
                                <code style={{ fontFamily: "monospace", color: c.accent }}>
                                  {entry.context.file}
                                  {entry.context.line != null ? `:${entry.context.line}` : ""}
                                </code>
                              </div>
                            )}
                            <div>
                              Full timestamp:{" "}
                              <code style={{ fontFamily: "monospace" }}>{entry.timestamp}</code>
                            </div>
                          </div>
                        ) : (
                          <div>
                            No source location.{" "}
                            Full timestamp:{" "}
                            <code style={{ fontFamily: "monospace" }}>{entry.timestamp}</code>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {isCapped && (
          <div
            style={{
              textAlign: "center",
              padding: "8px 0",
              borderTop: `1px solid ${c.borderLight}`,
            }}
          >
            <button
              style={{ ...S.btn(theme, "ghost"), fontSize: 12 }}
              onClick={() => setShowAll(true)}
            >
              Showing {DISPLAY_CAP} of {filtered.length} entries - Show all ({filtered.length})
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {toolbar}
      {configPanel}
      {body}
    </div>
  );
}
