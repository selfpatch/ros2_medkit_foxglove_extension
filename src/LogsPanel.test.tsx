// Copyright 2026 bburda. Apache-2.0 license.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { LogsPanel } from "./LogsPanel";
import { MedkitApiError } from "./gateway-client";
import type { MedkitApiClient } from "./medkit-api";
import type { LogEntry, LogListXMedkit } from "./types";

// ---------------------------------------------------------------------------
// Global cleanup: always restore real timers after each test
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let _entryCounter = 0;

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `log-${++_entryCounter}`,
    timestamp: "2026-01-01T12:00:00.000Z",
    severity: "info",
    message: "Nominal operation",
    context: { node: "/sensor_node" },
    ...overrides,
  };
}

const THEME = "dark" as const;

// ---------------------------------------------------------------------------
// Client stub factory
// ---------------------------------------------------------------------------

function makeClient(
  overrides: Partial<{
    listEntityLogs: MedkitApiClient["listEntityLogs"];
    getLogsConfiguration: MedkitApiClient["getLogsConfiguration"];
    updateLogsConfiguration: MedkitApiClient["updateLogsConfiguration"];
  }> = {},
): MedkitApiClient {
  return {
    listEntityLogs: vi.fn().mockResolvedValue({ items: [], "x-medkit": undefined }),
    getLogsConfiguration: vi.fn().mockResolvedValue({ max_entries: 100, severity_filter: "debug" }),
    updateLogsConfiguration: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MedkitApiClient;
}

// ---------------------------------------------------------------------------
// MedkitApiError factory
// ---------------------------------------------------------------------------

function makeApiError(status: number): MedkitApiError {
  return new MedkitApiError({
    status,
    code: `x-medkit-${status}`,
    error_code: `x-medkit-${status}`,
    message: "No LogManager",
  });
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderPanel(client: MedkitApiClient) {
  return render(
    <LogsPanel
      client={client}
      entityType="apps"
      entityId="motor"
      theme={THEME}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests: loading state
// ---------------------------------------------------------------------------

describe("LogsPanel - loading state", () => {
  it("shows loading indicator on mount before fetch resolves", async () => {
    let resolvePromise!: () => void;
    const pending = new Promise<void>((r) => { resolvePromise = r; });
    const client = makeClient({
      listEntityLogs: vi.fn().mockReturnValue(
        pending.then(() => ({ items: [], "x-medkit": undefined })),
      ),
    });

    renderPanel(client);
    // Loading indicator should be visible before fetch resolves
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();

    // Resolve the pending fetch
    resolvePromise();
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: /loading/i })).not.toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: logs render
// ---------------------------------------------------------------------------

describe("LogsPanel - logs render", () => {
  it("renders log rows with severity badge and message", async () => {
    const client = makeClient({
      listEntityLogs: vi.fn().mockResolvedValue({
        items: [
          makeEntry({ severity: "error", message: "Motor overheated", context: { node: "/motor" } }),
          makeEntry({ severity: "info", message: "Nominal operation", context: { node: "/sensor" } }),
        ],
      }),
    });
    renderPanel(client);
    await waitFor(() => {
      expect(screen.getByText("Motor overheated")).toBeInTheDocument();
      expect(screen.getByText("Nominal operation")).toBeInTheDocument();
    });
    // Severity badges - use aria-label to distinguish from dropdown options
    expect(screen.getByLabelText("severity error")).toBeInTheDocument();
    expect(screen.getByLabelText("severity info")).toBeInTheDocument();
  });

  it("shows empty state when no log entries returned", async () => {
    const client = makeClient({ listEntityLogs: vi.fn().mockResolvedValue({ items: [] }) });
    renderPanel(client);
    await waitFor(() => expect(screen.getByText(/no log entries/i)).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Tests: severity filter (server-side)
// ---------------------------------------------------------------------------

describe("LogsPanel - severity filter", () => {
  it("re-fetches with severity param when filter changes", async () => {
    const listEntityLogs = vi.fn().mockResolvedValue({ items: [] });
    const client = makeClient({ listEntityLogs });
    renderPanel(client);
    await waitFor(() => expect(listEntityLogs).toHaveBeenCalledTimes(1));

    const select = screen.getByRole("combobox", { name: /severity/i });
    fireEvent.change(select, { target: { value: "error" } });

    await waitFor(() => expect(listEntityLogs).toHaveBeenCalledTimes(2));
    const lastCall = listEntityLogs.mock.calls[1] as unknown[];
    expect((lastCall[2] as { severity?: string })?.severity).toBe("error");
  });

  it("does not include severity param when filter is 'debug' (default)", async () => {
    const listEntityLogs = vi.fn().mockResolvedValue({ items: [] });
    const client = makeClient({ listEntityLogs });
    renderPanel(client);
    await waitFor(() => expect(listEntityLogs).toHaveBeenCalledTimes(1));
    const params = listEntityLogs.mock.calls[0]![2] as { severity?: string } | undefined;
    expect(params?.severity).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: message search (client-side)
// ---------------------------------------------------------------------------

describe("LogsPanel - message search narrows results", () => {
  it("hides rows that do not match the message search term", async () => {
    const client = makeClient({
      listEntityLogs: vi.fn().mockResolvedValue({
        items: [
          makeEntry({ id: "search-1", message: "Motor overheated" }),
          makeEntry({ id: "search-2", message: "Sensor nominal" }),
        ],
      }),
    });
    renderPanel(client);
    await waitFor(() => expect(screen.getByText("Motor overheated")).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText(/search messages/i);
    fireEvent.change(searchInput, { target: { value: "overheated" } });

    expect(screen.getByText("Motor overheated")).toBeInTheDocument();
    expect(screen.queryByText("Sensor nominal")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: context filter (server-side, debounced)
// ---------------------------------------------------------------------------

describe("LogsPanel - context filter", () => {
  it("passes context param to listEntityLogs after debounce elapses", async () => {
    vi.useFakeTimers();
    const listEntityLogs = vi.fn().mockResolvedValue({ items: [] });
    const client = makeClient({ listEntityLogs });

    renderPanel(client);
    // Let initial fetch settle
    await act(async () => { await Promise.resolve(); });
    const countAfterInit = listEntityLogs.mock.calls.length;
    expect(countAfterInit).toBeGreaterThanOrEqual(1);

    const contextInput = screen.getByPlaceholderText(/context filter/i);
    await act(async () => {
      fireEvent.change(contextInput, { target: { value: "/sensor" } });
    });

    // Advance by exactly the debounce delay (300ms)
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(listEntityLogs).toHaveBeenCalledTimes(countAfterInit + 1);
    const lastCall = listEntityLogs.mock.calls[countAfterInit] as unknown[];
    expect((lastCall[2] as { context?: string })?.context).toBe("/sensor");
  });
});

// ---------------------------------------------------------------------------
// Tests: expandable rows
// ---------------------------------------------------------------------------

describe("LogsPanel - expandable rows", () => {
  it("clicking a row reveals context.file:line and full timestamp", async () => {
    const entry = makeEntry({
      timestamp: "2026-01-01T12:34:56.789000000Z",
      context: {
        node: "/motor",
        file: "motor.cpp",
        line: 42,
        function: "handle_cmd",
      },
    });
    const client = makeClient({
      listEntityLogs: vi.fn().mockResolvedValue({ items: [entry] }),
    });
    renderPanel(client);
    await waitFor(() => expect(screen.getByText("Nominal operation")).toBeInTheDocument());

    // Detail is not visible initially
    expect(screen.queryByText(/Location:/)).not.toBeInTheDocument();

    // Click the log row to expand (first row with role="button" that has aria-expanded)
    const rows = screen.getAllByRole("button");
    const logRow = rows.find((el) => el.getAttribute("aria-expanded") !== null);
    expect(logRow).toBeDefined();
    fireEvent.click(logRow!);

    // Detail row appears with file:line
    await waitFor(() => {
      expect(screen.getByText(/Location:/)).toBeInTheDocument();
      expect(screen.getByText(/motor\.cpp:42/)).toBeInTheDocument();
      expect(screen.getByText(/Function:/)).toBeInTheDocument();
      expect(screen.getByText(/handle_cmd/)).toBeInTheDocument();
      // Full ISO timestamp visible
      expect(screen.getByText(/2026-01-01T12:34:56\.789000000Z/)).toBeInTheDocument();
    });

    // Clicking again collapses
    fireEvent.click(logRow!);
    await waitFor(() => expect(screen.queryByText(/Location:/)).not.toBeInTheDocument());
  });

  it("shows 'No source location' when context has no file or function", async () => {
    const entry = makeEntry({ context: { node: "/sensor" } });
    const client = makeClient({
      listEntityLogs: vi.fn().mockResolvedValue({ items: [entry] }),
    });
    renderPanel(client);
    await waitFor(() => expect(screen.getByText("Nominal operation")).toBeInTheDocument());

    const rows = screen.getAllByRole("button");
    const logRow = rows.find((el) => el.getAttribute("aria-expanded") !== null);
    expect(logRow).toBeDefined();
    fireEvent.click(logRow!);

    await waitFor(() => expect(screen.getByText(/No source location/i)).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Tests: aggregation header
// ---------------------------------------------------------------------------

describe("LogsPanel - aggregation header", () => {
  it("shows 'Aggregated from N sources' when x-medkit aggregation_level is set", async () => {
    const xMedkit: LogListXMedkit = {
      aggregation_level: "function",
      host_count: 3,
      aggregation_sources: ["app-1", "app-2", "app-3"],
    };
    const client = makeClient({
      listEntityLogs: vi.fn().mockResolvedValue({
        items: [makeEntry()],
        "x-medkit": xMedkit,
      }),
    });
    renderPanel(client);
    await waitFor(() => {
      const header = screen.getByLabelText("aggregation header");
      expect(header).toBeInTheDocument();
      expect(header).toHaveTextContent(/Aggregated from 3 sources/);
      expect(header).toHaveTextContent(/app-1/);
      expect(header).toHaveTextContent(/app-2/);
      expect(header).toHaveTextContent(/app-3/);
    });
  });

  it("does not show aggregation header when aggregation_level is absent", async () => {
    const client = makeClient({
      listEntityLogs: vi.fn().mockResolvedValue({
        items: [makeEntry()],
        "x-medkit": { host_count: 1 },
      }),
    });
    renderPanel(client);
    await waitFor(() => expect(screen.getByText("Nominal operation")).toBeInTheDocument());
    expect(screen.queryByLabelText("aggregation header")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: display cap + show all
// ---------------------------------------------------------------------------

describe("LogsPanel - display cap and show all", () => {
  it("caps at 200 rows and shows a show-all button with total count", async () => {
    const entries = Array.from({ length: 250 }, (_, i) =>
      makeEntry({ message: `Log message ${i}` }),
    );
    const client = makeClient({
      listEntityLogs: vi.fn().mockResolvedValue({ items: entries }),
    });
    renderPanel(client);

    // Wait for 200 expandable rows (log rows have aria-expanded)
    await waitFor(() => {
      const logRows = screen.getAllByRole("button").filter(
        (el) => el.getAttribute("aria-expanded") !== null,
      );
      expect(logRows).toHaveLength(200);
    });

    // Show-all button mentions the total
    expect(screen.getByText(/Showing 200 of 250 entries/)).toBeInTheDocument();
    expect(screen.getByText(/Show all \(250\)/)).toBeInTheDocument();

    // Click show-all
    fireEvent.click(screen.getByText(/Show all \(250\)/));
    await waitFor(() => {
      const logRows = screen.getAllByRole("button").filter(
        (el) => el.getAttribute("aria-expanded") !== null,
      );
      expect(logRows).toHaveLength(250);
    });
    expect(screen.queryByText(/Showing 200/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: 503 / 404 no-LogManager state
// ---------------------------------------------------------------------------

describe("LogsPanel - no-LogManager state (503/404)", () => {
  it("shows 'no LogManager' message on 503", async () => {
    const client = makeClient({
      listEntityLogs: vi.fn().mockRejectedValue(makeApiError(503)),
    });
    renderPanel(client);
    await waitFor(() => {
      expect(
        screen.getByText(/Logs not available on this gateway \(no LogManager configured\)/i),
      ).toBeInTheDocument();
    });
  });

  it("shows 'no LogManager' message on 404", async () => {
    const client = makeClient({
      listEntityLogs: vi.fn().mockRejectedValue(makeApiError(404)),
    });
    renderPanel(client);
    await waitFor(() => {
      expect(
        screen.getByText(/Logs not available for this entity \(no LogManager configured\)/i),
      ).toBeInTheDocument();
    });
  });

  it("does NOT show 'no LogManager' for generic errors; shows refresh-failed indicator", async () => {
    const client = makeClient({
      listEntityLogs: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    renderPanel(client);
    await waitFor(() => {
      expect(screen.getByText(/Last refresh failed/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/no LogManager/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: Refresh button
// ---------------------------------------------------------------------------

describe("LogsPanel - manual Refresh button", () => {
  it("re-fetches when Refresh is clicked", async () => {
    const listEntityLogs = vi.fn().mockResolvedValue({ items: [] });
    const client = makeClient({ listEntityLogs });
    renderPanel(client);
    await waitFor(() => expect(listEntityLogs).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(listEntityLogs).toHaveBeenCalledTimes(2));
  });
});

// ---------------------------------------------------------------------------
// Tests: auto-refresh
// ---------------------------------------------------------------------------

describe("LogsPanel - auto-refresh", () => {
  // Helper: enable auto-refresh checkbox. Default interval in the panel is 5s.
  function enableAutoRefresh() {
    fireEvent.click(screen.getByRole("checkbox", { name: /auto-refresh/i }));
  }

  it("auto-refresh checkbox is off by default", async () => {
    const client = makeClient();
    renderPanel(client);
    // Wait for initial render so checkbox is present
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /auto-refresh/i })).not.toBeChecked(),
    );
  });

  it("re-fetches after the interval elapses when auto-refresh is on", async () => {
    vi.useFakeTimers();
    const listEntityLogs = vi.fn().mockResolvedValue({ items: [] });
    const client = makeClient({ listEntityLogs });
    renderPanel(client);

    // Wait for initial fetch (time-based: resolve the microtask queue)
    await act(async () => {
      await Promise.resolve();
    });
    const countAfterInit = listEntityLogs.mock.calls.length;
    // Should have at least 1 call from initial load
    expect(countAfterInit).toBeGreaterThanOrEqual(1);

    // Enable auto-refresh (triggers an immediate re-fetch + sets up 5s interval)
    await act(async () => {
      enableAutoRefresh();
    });

    const countAfterEnable = listEntityLogs.mock.calls.length;
    // Immediate call on enable
    expect(countAfterEnable).toBeGreaterThan(countAfterInit);

    // Advance clock by one interval (5s)
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(listEntityLogs.mock.calls.length).toBeGreaterThan(countAfterEnable);
  });

  it("advancing the clock without auto-refresh does NOT trigger extra fetches", async () => {
    vi.useFakeTimers();
    const listEntityLogs = vi.fn().mockResolvedValue({ items: [] });
    const client = makeClient({ listEntityLogs });
    renderPanel(client);

    await act(async () => {
      await Promise.resolve();
    });
    const countAfterInit = listEntityLogs.mock.calls.length;
    // Sanity: initial fetch must have fired before we advance the clock
    expect(countAfterInit).toBeGreaterThanOrEqual(1);

    // Auto-refresh stays off; advance 10 seconds
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });

    // Only debounce timers fire - no additional listEntityLogs calls
    expect(listEntityLogs.mock.calls.length).toBe(countAfterInit);
  });

  it("stops fetching when auto-refresh is turned off", async () => {
    vi.useFakeTimers();
    const listEntityLogs = vi.fn().mockResolvedValue({ items: [] });
    const client = makeClient({ listEntityLogs });
    renderPanel(client);

    await act(async () => { await Promise.resolve(); });

    // Enable
    await act(async () => { enableAutoRefresh(); });
    const countAfterEnable = listEntityLogs.mock.calls.length;

    // Disable
    await act(async () => { enableAutoRefresh(); }); // toggle off

    // Advance - should NOT call again
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });

    expect(listEntityLogs.mock.calls.length).toBe(countAfterEnable);
  });

  it("visibility hidden pauses auto-refresh; visible again resumes and immediately refreshes", async () => {
    vi.useFakeTimers();
    const listEntityLogs = vi.fn().mockResolvedValue({ items: [] });
    const client = makeClient({ listEntityLogs });
    renderPanel(client);

    await act(async () => { await Promise.resolve(); });

    // Enable auto-refresh
    await act(async () => { enableAutoRefresh(); });
    const countAfterEnable = listEntityLogs.mock.calls.length;

    // Simulate document becoming hidden
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Advance - should NOT trigger more fetches while hidden
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    const countWhileHidden = listEntityLogs.mock.calls.length;
    expect(countWhileHidden).toBe(countAfterEnable);

    // Simulate document becoming visible again
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // Should immediately fetch on resume
    expect(listEntityLogs.mock.calls.length).toBeGreaterThan(countWhileHidden);
  });

  it("honors the current severity filter in auto-refresh fetches", async () => {
    vi.useFakeTimers();
    const listEntityLogs = vi.fn().mockResolvedValue({ items: [] });
    const client = makeClient({ listEntityLogs });
    renderPanel(client);

    await act(async () => { await Promise.resolve(); });

    // Change severity to "error"
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: /severity/i }), {
        target: { value: "error" },
      });
      await Promise.resolve();
    });

    // Enable auto-refresh (triggers immediate fetch with current filters)
    await act(async () => { enableAutoRefresh(); });

    // The most recent call should include severity=error
    const calls = listEntityLogs.mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    expect((lastCall[2] as { severity?: string })?.severity).toBe("error");

    // Advance one interval - next call should also honor the filter
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    const latestCall = listEntityLogs.mock.calls[listEntityLogs.mock.calls.length - 1] as unknown[];
    expect((latestCall[2] as { severity?: string })?.severity).toBe("error");
  });

  it("no fetch after unmount (no leak)", async () => {
    vi.useFakeTimers();
    const listEntityLogs = vi.fn().mockResolvedValue({ items: [] });
    const client = makeClient({ listEntityLogs });
    const { unmount } = renderPanel(client);

    await act(async () => { await Promise.resolve(); });

    // Enable auto-refresh
    await act(async () => { enableAutoRefresh(); });
    const countAfterEnable = listEntityLogs.mock.calls.length;

    // Unmount
    unmount();

    // Advance clock after unmount - no more fetches
    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });

    expect(listEntityLogs.mock.calls.length).toBe(countAfterEnable);
  });
});

// ---------------------------------------------------------------------------
// Tests: config panel
// ---------------------------------------------------------------------------

describe("LogsPanel - config panel", () => {
  function openConfig() {
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
  }

  it("getLogsConfiguration is called and fields render when config is opened", async () => {
    const getLogsConfiguration = vi.fn().mockResolvedValue({
      max_entries: 500,
      severity_filter: "warning",
    });
    const client = makeClient({ getLogsConfiguration });
    renderPanel(client);
    await waitFor(() => expect(screen.queryByRole("status", { name: /loading/i })).not.toBeInTheDocument());

    openConfig();

    await waitFor(() => {
      expect(getLogsConfiguration).toHaveBeenCalledWith("apps", "motor");
      // saved severity select should show "warning"
      const severitySelect = screen.getByLabelText(/saved severity/i);
      expect(severitySelect).toHaveValue("warning");
      // max entries input should show 500
      const maxEntriesInput = screen.getByLabelText(/max entries/i);
      expect(maxEntriesInput).toHaveValue(500);
    });
  });

  it("Save triggers updateLogsConfiguration with current values", async () => {
    const updateLogsConfiguration = vi.fn().mockResolvedValue(undefined);
    const getLogsConfiguration = vi.fn().mockResolvedValue({ max_entries: 500, severity_filter: "error" });
    const client = makeClient({ getLogsConfiguration, updateLogsConfiguration });
    renderPanel(client);
    await waitFor(() => expect(screen.queryByRole("status", { name: /loading/i })).not.toBeInTheDocument());

    openConfig();
    await waitFor(() => expect(screen.getByLabelText(/saved severity/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(updateLogsConfiguration).toHaveBeenCalledWith("apps", "motor", {
        severity_filter: "error",
        max_entries: 500,
      });
    });
  });

  it("max_entries null (unlimited) is preserved and sent as null on save", async () => {
    const updateLogsConfiguration = vi.fn().mockResolvedValue(undefined);
    const getLogsConfiguration = vi.fn().mockResolvedValue({ max_entries: null, severity_filter: "debug" });
    const client = makeClient({ getLogsConfiguration, updateLogsConfiguration });
    renderPanel(client);
    await waitFor(() => expect(screen.queryByRole("status", { name: /loading/i })).not.toBeInTheDocument());

    openConfig();
    await waitFor(() => expect(screen.getByLabelText(/max entries/i)).toBeInTheDocument());

    // Input should be empty (null = unlimited)
    const maxEntriesInput = screen.getByLabelText(/max entries/i);
    expect(maxEntriesInput).toHaveValue(null);
    // "unlimited" hint should be visible
    expect(screen.getByText(/unlimited/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(updateLogsConfiguration).toHaveBeenCalledWith("apps", "motor", {
        severity_filter: "debug",
        max_entries: null,
      });
    });
  });

  it("shows config error state when getLogsConfiguration fails", async () => {
    const getLogsConfiguration = vi.fn().mockRejectedValue(new Error("Config fetch failed"));
    const client = makeClient({ getLogsConfiguration });
    renderPanel(client);
    await waitFor(() => expect(screen.queryByRole("status", { name: /loading/i })).not.toBeInTheDocument());

    openConfig();

    await waitFor(() => {
      expect(screen.getByText(/failed to load configuration/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
