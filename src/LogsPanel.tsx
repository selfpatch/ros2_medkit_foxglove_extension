// Copyright 2026 bburda. Apache-2.0 license.
//
// LogsPanel: query an entity's logs with severity filter + context search,
// expandable rows (context.function / context.file:line + full ISO timestamp),
// aggregation header from x-medkit metadata, display cap (200 rows) with
// show-all overflow control, 404/503 no-LogManager fallback, manual Refresh,
// and auto-refresh with document-visibility pause.

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

  // ── Auto-refresh ─────────────────────────────────────────────────
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );

  // ── Config panel ─────────────────────────────────────────────────
  const [configOpen, setConfigOpen] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSeverity, setConfigSeverity] = useState<LogSeverity>("debug");
  /** null = unlimited (gateway's null = no cap); number = explicit cap */
  const [configMaxEntries, setConfigMaxEntries] = useState<number | null>(100);
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
    setAutoRefreshEnabled(false);
    setRefreshIntervalMs(5000);
    setConfigOpen(false);
    setConfigLoaded(false);
    setConfigLoading(false);
    setConfigSeverity("debug");
    setConfigMaxEntries(100);
    setConfigSaving(false);
    setConfigError(undefined);
  }, [entityId, entityType]);

  // ── Fetch ────────────────────────────────────────────────────────
  // Returns an AbortController whose signal is passed to the fetch.
  // Callers must call controller.abort() when the result is stale (entity
  // changed, component unmounted) so a slow response never overwrites newer
  // state.
  const doFetch = useCallback((signal?: AbortSignal) => {
    setIsLoading(true);
    setLastRefreshFailed(false);
    const params: { severity?: LogSeverity; context?: string } = {};
    if (severity !== "debug") params.severity = severity;
    if (contextFilter) params.context = contextFilter;
    // `listEntityLogs` does not yet accept AbortSignal; we guard stale results
    // via the signal check after the await instead.
    void client.listEntityLogs(entityType, entityId, params).then(
      (result) => {
        if (signal?.aborted) return;
        setEntries(result.items);
        setAggregation(result["x-medkit"]);
        setErrorStatus(null);
      },
      (err: unknown) => {
        if (signal?.aborted) return;
        if (err instanceof MedkitApiError && (err.status === 404 || err.status === 503)) {
          setErrorStatus(err.status);
          setEntries([]);
          setAggregation(undefined);
        } else {
          setLastRefreshFailed(true);
        }
      },
    ).finally(() => {
      if (!signal?.aborted) setIsLoading(false);
    });
  }, [client, entityType, entityId, severity, contextFilter]);

  // Initial load + re-fetch when entity/filters change.
  // An AbortController aborts any in-flight fetch when params change or the
  // component unmounts, preventing stale results from overwriting newer state.
  useEffect(() => {
    const controller = new AbortController();
    doFetch(controller.signal);
    return () => controller.abort();
  }, [doFetch]);

  // ── Visibility tracking ──────────────────────────────────────────
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // ── Auto-refresh interval ────────────────────────────────────────
  // Fires doFetch on a setInterval when auto-refresh is enabled and the
  // document is visible. Clears the interval (and removes no listener here -
  // the visibility listener is managed by the effect above) on:
  //   - auto-refresh toggled off
  //   - document becomes hidden (isDocumentVisible false)
  //   - entity/filter change (doFetch identity changes -> effect re-runs)
  //   - unmount
  // When the document becomes visible again (and auto-refresh is still on),
  // the effect re-runs, sets up a fresh interval, and immediately calls
  // doFetch so the view is current.
  useEffect(() => {
    if (!autoRefreshEnabled || !isDocumentVisible) return;
    doFetch();
    const id = setInterval(() => {
      doFetch();
    }, refreshIntervalMs);
    return () => clearInterval(id);
  }, [autoRefreshEnabled, isDocumentVisible, refreshIntervalMs, doFetch]);

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
  const loadConfig = useCallback(async (signal?: AbortSignal) => {
    setConfigLoading(true);
    setConfigError(undefined);
    try {
      const cfg = await client.getLogsConfiguration(entityType, entityId);
      if (signal?.aborted) return;
      const rawSeverity = cfg.severity_filter ?? "debug";
      // Validate against the known set; fall back to "debug" if out of set.
      const validatedSeverity: LogSeverity =
        (SEVERITY_LEVELS as readonly string[]).includes(rawSeverity)
          ? (rawSeverity as LogSeverity)
          : "debug";
      setConfigSeverity(validatedSeverity);
      // null from the gateway means "unlimited"; preserve it rather than collapsing to 100.
      setConfigMaxEntries(cfg.max_entries ?? null);
      setConfigLoaded(true);
    } catch {
      if (!signal?.aborted) setConfigError("Failed to load configuration");
    } finally {
      if (!signal?.aborted) setConfigLoading(false);
    }
  }, [client, entityType, entityId]);

  const handleConfigSave = useCallback(async (signal?: AbortSignal) => {
    // null = unlimited (send null); number must be in 1-10000
    if (configMaxEntries !== null && (configMaxEntries < 1 || configMaxEntries > 10000)) return;
    setConfigSaving(true);
    try {
      await client.updateLogsConfiguration(entityType, entityId, {
        severity_filter: configSeverity,
        max_entries: configMaxEntries,
      });
      if (signal?.aborted) return;
      setConfigOpen(false);
      doFetch();
    } catch {
      if (!signal?.aborted) setConfigError("Failed to save configuration");
    } finally {
      if (!signal?.aborted) setConfigSaving(false);
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

  // null = unlimited (always valid); a number must be in 1-10000
  const configValid = configMaxEntries === null || (configMaxEntries >= 1 && configMaxEntries <= 10000);

  // ── Toolbar ──────────────────────────────────────────────────────
  const toolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
      <label htmlFor="logs-severity-filter" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
        <span style={{ color: c.textMuted }}>Severity:</span>
        <select
          id="logs-severity-filter"
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
        onClick={() => doFetch()}
        aria-label="Refresh"
        title="Refresh"
      >
        ↻ Refresh
      </button>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
        <input
          type="checkbox"
          aria-label="Auto-refresh"
          checked={autoRefreshEnabled}
          onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
        />
        <span style={{ color: c.textMuted }}>Auto-refresh</span>
      </label>
      {autoRefreshEnabled && (
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <span style={{ color: c.textMuted }}>Interval:</span>
          <select
            aria-label="Refresh interval"
            style={{ ...S.input(theme), width: "auto", padding: "2px 6px" }}
            value={refreshIntervalMs}
            onChange={(e) => setRefreshIntervalMs(Number(e.target.value))}
          >
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
            <option value={30000}>30s</option>
          </select>
        </label>
      )}
      <button
        style={S.btn(theme, "ghost")}
        onClick={() => void toggleConfig()}
        aria-label="Settings"
        title="Log configuration"
      >
        ⚙
      </button>
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
          <label htmlFor="config-severity-filter" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
            <span style={{ color: c.textMuted }}>Saved severity:</span>
            <select
              id="config-severity-filter"
              style={{ ...S.input(theme), width: "auto", padding: "2px 6px" }}
              value={configSeverity}
              onChange={(e) => setConfigSeverity(e.target.value as LogSeverity)}
            >
              {SEVERITY_LEVELS.map((lvl) => (
                <option key={lvl} value={lvl}>{lvl}</option>
              ))}
            </select>
          </label>
          <label htmlFor="config-max-entries" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
            <span style={{ color: c.textMuted }}>Max entries:</span>
            <input
              type="number"
              id="config-max-entries"
              style={{ ...S.input(theme), width: 80 }}
              value={configMaxEntries ?? ""}
              placeholder="unlimited"
              min={1}
              max={10000}
              onChange={(e) => {
                const v = e.target.value;
                setConfigMaxEntries(v === "" ? null : Number(v));
              }}
            />
          </label>
          {configMaxEntries === null && (
            <span style={{ fontSize: 11, color: c.textMuted }}>unlimited</span>
          )}
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

  // Aggregation header: rendered whenever aggregation metadata is present,
  // regardless of whether rows pass the message search filter (item 9).
  const aggregationHeader = aggregation?.aggregation_level ? (
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
      {aggregation.aggregation_sources != null && aggregation.aggregation_sources.length > 0 && (
        <span style={{ color: c.textMuted }}>
          {" "}({aggregation.aggregation_sources.join(", ")})
        </span>
      )}
    </div>
  ) : null;

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
      <div>
        {aggregationHeader}
        <div style={{ ...S.emptyState(theme) }}>
          <div style={{ marginBottom: 8 }}>{msg}</div>
          <button style={S.btn(theme, "ghost")} onClick={() => doFetch()}>Retry</button>
        </div>
      </div>
    );
  } else if (displayed.length === 0) {
    body = (
      <div>
        {aggregationHeader}
        {lastRefreshFailed && (
          <div style={{ ...S.errorBox(theme), marginBottom: 8, fontSize: 12 }}>
            Last refresh failed - data may be stale
          </div>
        )}
        <div style={S.emptyState(theme)}>
          No log entries
          {trimmedSearch || contextFilter || severity !== "debug"
            ? " - try a lower severity or different filter"
            : ""}
        </div>
      </div>
    );
  } else {
    body = (
      <div>
        {aggregationHeader}
        {lastRefreshFailed && (
          <div style={{ ...S.errorBox(theme), marginBottom: 8, fontSize: 12 }}>
            Last refresh failed - data may be stale
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
            {displayed.map((entry, idx) => {
              // Use id+index as key to avoid collisions when the gateway returns
              // duplicate ids (item 12). Expand state is also tracked by id+idx.
              const rowKey = `${entry.id}-${idx}`;
              const isExpanded = expandedIds.has(rowKey);
              const sevColor = S.severityColor(entry.severity, theme);
              return (
                <Fragment key={rowKey}>
                  <tr
                    style={{
                      background: isExpanded ? c.bgAlt : "transparent",
                    }}
                  >
                    {/* First cell contains the expand button (item 10): the
                        interactive affordance lives on a real <button> inside
                        the cell, not on the <tr> itself, so screen-reader table
                        navigation is not overridden. */}
                    <td style={{ ...S.td(theme), fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap", padding: 0 }}>
                      <button
                        style={{
                          all: "unset",
                          display: "block",
                          width: "100%",
                          padding: "4px 6px",
                          cursor: "pointer",
                          fontFamily: "monospace",
                          fontSize: 11,
                          whiteSpace: "nowrap",
                          color: "inherit",
                        }}
                        onClick={() => toggleExpand(rowKey)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleExpand(rowKey);
                          }
                        }}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? "Collapse" : "Expand"} log entry at ${formatTime(entry.timestamp)}`}
                      >
                        {formatTime(entry.timestamp)}
                      </button>
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
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "8px 0",
              borderTop: `1px solid ${c.borderLight}`,
            }}
          >
            {/* Status text and Show-all are separate so the button's accessible
                name is only "Show all (N)", not the full status sentence (item 11). */}
            <span style={{ fontSize: 12, color: c.textMuted }}>
              Showing {DISPLAY_CAP} of {filtered.length} entries
            </span>
            <button
              style={{ ...S.btn(theme, "ghost"), fontSize: 12 }}
              onClick={() => setShowAll(true)}
            >
              Show all ({filtered.length})
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
