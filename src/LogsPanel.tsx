// Copyright 2026 bburda. Apache-2.0 license.
//
// LogsPanel: query an entity's logs with severity filter + context search,
// expandable rows (context.function / context.file:line + full ISO timestamp),
// aggregation header from x-medkit metadata, display cap (200 rows) with
// show-all overflow control, 404/503 no-LogManager fallback, manual Refresh,
// and auto-refresh with document-visibility pause.

import { type ReactElement, Fragment, useCallback, useEffect, useRef, useState } from "react";

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
  // The gateway cap is a non-nullable 1..10000 size_t (no "unlimited"), so this
  // is always a concrete number.
  const [configMaxEntries, setConfigMaxEntries] = useState<number>(100);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | undefined>(undefined);

  // Stale-result guards used by every fetch path (not just the param-effect's
  // AbortController): a fetch that resolves after unmount or after an entity
  // switch must never overwrite newer state.
  const mountedRef = useRef(true);
  const entityKeyRef = useRef(`${entityType}/${entityId}`);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Debounce context filter ──────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => setContextFilter(contextDraft), 300);
    return () => clearTimeout(id);
  }, [contextDraft]);

  // ── Reset on entity change ───────────────────────────────────────
  useEffect(() => {
    entityKeyRef.current = `${entityType}/${entityId}`;
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
  // `signal` (from the param-effect's AbortController) plus the mountedRef /
  // entityKeyRef guards ensure a slow response never overwrites newer state,
  // regardless of which path triggered the fetch (param-effect, auto-refresh,
  // manual Refresh, post-save reload, or retry).
  const doFetch = useCallback((signal?: AbortSignal) => {
    const key = `${entityType}/${entityId}`;
    const isStale = () => signal?.aborted === true || !mountedRef.current || entityKeyRef.current !== key;
    setIsLoading(true);
    setLastRefreshFailed(false);
    const params: { severity?: LogSeverity; context?: string } = {};
    if (severity !== "debug") params.severity = severity;
    if (contextFilter) params.context = contextFilter;
    // `listEntityLogs` does not yet accept AbortSignal; we guard stale results
    // via isStale() after the await instead.
    void client.listEntityLogs(entityType, entityId, params).then(
      (result) => {
        if (isStale()) return;
        setEntries(result.items);
        setAggregation(result["x-medkit"]);
        setErrorStatus(null);
      },
      (err: unknown) => {
        if (isStale()) return;
        if (err instanceof MedkitApiError && (err.status === 404 || err.status === 503)) {
          setErrorStatus(err.status);
          setEntries([]);
          setAggregation(undefined);
        } else {
          setLastRefreshFailed(true);
        }
      },
    ).finally(() => {
      if (!isStale()) setIsLoading(false);
    });
  }, [client, entityType, entityId, severity, contextFilter]);

  // Keep a ref to the latest doFetch so the auto-refresh interval can call it
  // without listing doFetch as a dep (which would re-run the effect on every
  // filter change and fire a redundant leading fetch alongside the param-effect).
  const doFetchRef = useRef(doFetch);
  useEffect(() => {
    doFetchRef.current = doFetch;
  }, [doFetch]);

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
    // Leading fetch only on enable / visibility-resume - NOT on filter changes
    // (doFetch is read via the ref, so this effect no longer re-runs when the
    // filters change; the param-effect owns the leading-edge fetch there). This
    // prevents a redundant second fetch racing the param-effect's.
    doFetchRef.current();
    const id = setInterval(() => {
      doFetchRef.current();
    }, refreshIntervalMs);
    return () => clearInterval(id);
  }, [autoRefreshEnabled, isDocumentVisible, refreshIntervalMs]);

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
      // The gateway always returns a concrete cap; fall back to 100 defensively.
      setConfigMaxEntries(cfg.max_entries ?? 100);
      setConfigLoaded(true);
    } catch {
      if (!signal?.aborted) setConfigError("Failed to load configuration");
    } finally {
      if (!signal?.aborted) setConfigLoading(false);
    }
  }, [client, entityType, entityId]);

  const handleConfigSave = useCallback(async (signal?: AbortSignal) => {
    // The gateway cap must be a concrete 1..10000 value (it rejects 0 and
    // ignores null), so reject anything out of range rather than no-op silently.
    if (!Number.isInteger(configMaxEntries) || configMaxEntries < 1 || configMaxEntries > 10000) return;
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
  // The gateway returns entries oldest-first (ascending by id) and drops from
  // the front when over its own cap. Show newest-first and, when capping the
  // display, keep the newest DISPLAY_CAP - not the oldest - so opening the tab
  // on a busy entity shows what just happened rather than stale history.
  const ordered = [...filtered].reverse();
  const isCapped = !showAll && ordered.length > DISPLAY_CAP;
  const displayed = isCapped ? ordered.slice(0, DISPLAY_CAP) : ordered;

  // The cap must be an integer in 1..10000 (the gateway has no "unlimited").
  const configValid =
    Number.isInteger(configMaxEntries) && configMaxEntries >= 1 && configMaxEntries <= 10000;

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
      {isLoading && entries.length > 0 && (
        <span style={{ fontSize: 11, color: c.textMuted }} role="status" aria-label="Refreshing">
          Refreshing...
        </span>
      )}
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
              value={Number.isNaN(configMaxEntries) ? "" : configMaxEntries}
              min={1}
              max={10000}
              onChange={(e) => setConfigMaxEntries(e.target.value === "" ? NaN : Number(e.target.value))}
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

  // Full-screen loader only on the initial/empty load. A background refresh
  // (auto-refresh tick or manual Refresh while rows are shown) keeps the table
  // mounted - a small toolbar indicator covers it - so a live tail no longer
  // blanks the table every cycle.
  if (isLoading && entries.length === 0 && errorStatus === null) {
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
            {displayed.map((entry) => {
              // Gateway log ids (log_<n>) are unique, so key by id alone. A
              // positional suffix would change every row's key as the gateway
              // drops the oldest entries on refresh, scrambling expand state.
              const isExpanded = expandedIds.has(entry.id);
              const sevColor = S.severityColor(entry.severity, theme);
              return (
                <Fragment key={entry.id}>
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
                        onClick={() => toggleExpand(entry.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleExpand(entry.id);
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
      {trimmedSearch && (
        <div style={{ fontSize: 11, color: c.textMuted, marginBottom: 6 }} aria-label="search scope note">
          Message search matches only the currently loaded page; the gateway caps
          how many entries it returns, so a match in an older entry may not appear.
        </div>
      )}
      {body}
    </div>
  );
}
